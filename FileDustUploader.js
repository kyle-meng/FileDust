import fs from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import pLimit from "p-limit";
import { fileURLToPath } from "node:url";

import { loadOrGenerateKey, encrypt } from "./CryptoUtils.js";
import { uploadDataStream } from "./ArweaveSDK.js";
import { FastCDC, FastCDCConfig } from "./FastCDC.js";

// 控制并发数，防 Irys/Turbo 封 IP
const limit = pLimit(3);

const calculateFileHash = (filePath) => {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        const stream = fs.createReadStream(filePath);
        stream.on("data", (data) => hash.update(data));
        stream.on("end", () => resolve(hash.digest("hex")));
        stream.on("error", reject);
    });
};

export const uploadToDust = async (filePath, password, chunkSizeKB = 90) => {
    const fileName = path.basename(filePath);
    const stats = fs.statSync(filePath);
    const fileSize = stats.size;

    console.log(`🚀 开始处理文件: ${fileName} (${fileSize} bytes)`);
    console.log(`⏱️  正在计算原始文件完整 Hash，请稍候...`);
    const fileHash = await calculateFileHash(filePath);

    // 控制切片大小，保证加密后的密文不会超过 100KB (Arweave 免费线).
    // 由于使用了 FastCDC, 我们将 maxChunkSize 设置为这个限制.
    const maxChunkSize = chunkSizeKB * 1024;
    // 平均大小设置为最大大小的一半，最小大小为平均值的四分之一，这是CDC的推荐比例
    const avgChunkSize = Math.floor(maxChunkSize / 2);
    const minChunkSize = Math.floor(avgChunkSize / 4);

    const cdcConfig = new FastCDCConfig(minChunkSize, avgChunkSize, maxChunkSize);
    const chunker = new FastCDC(cdcConfig);
    const manifestName = `${fileName}.dust`;
    let manifest = { filename: fileName, total_size: fileSize, file_hash: fileHash, chunks: [] };

    let previousChunksMap = new Map();

    if (fs.existsSync(manifestName)) {
        try {
            const existingManifest = JSON.parse(fs.readFileSync(manifestName, "utf8"));
            // 将旧版本的所有 chunk 放入一个哈希池中用于 CDC 的重复数据剔除匹配
            if (existingManifest.chunks && existingManifest.chunks.length > 0) {
                for (const chunk of existingManifest.chunks) {
                    if (chunk.plain_hash) {
                        previousChunksMap.set(chunk.plain_hash, chunk);
                    }
                }
            }

            if (existingManifest.file_hash === fileHash) {
                console.log(`♻️  发现匹配的星图文件，开启断点续传模式...`);
                manifest = existingManifest;
            } else {
                console.warn(`⚠️  发现同名星图且原始文件被修改，将使用 CDC 算法进行增量匹配与重新组装！`);
                // 虽然重置 manifest，但我们刚刚已经把有价值的旧 chunks 提取到 previousChunksMap 里了
            }
        } catch (e) {
            console.warn(`⚠️  读取已有星图文件失败，重新生成...`);
        }
    }

    // 安全保存 Manifest 的辅助函数
    const saveManifest = () => {
        manifest.chunks.sort((a, b) => a.part - b.part);
        fs.writeFileSync(manifestName, JSON.stringify(manifest, null, 4));
    };

    saveManifest(); // 初始化或更新进度文件

    // 加载或生成密钥
    const { key } = await loadOrGenerateKey(password);

    const fileHandle = await open(filePath, "r");
    const readBuffer = Buffer.alloc(maxChunkSize);

    let partNum = 0;
    let fileOffset = 0;
    const uploadTasks = [];

    try {
        while (fileOffset < fileSize) {
            const remaining = fileSize - fileOffset;
            const toRead = Math.min(maxChunkSize, remaining);

            // 每次从 fileOffset 读取最多 maxChunkSize 个字节
            const { bytesRead } = await fileHandle.read(readBuffer, 0, toRead, fileOffset);
            if (bytesRead === 0) break;

            // 使用 FastCDC 计算当前块长度！因为 FastCDC 最多往后看 maxChunkSize，所以我们读这么多足够了
            const chunkLen = chunker.getChunkSize(readBuffer, 0, bytesRead);

            // 提取出计算得出的实际 chunk 数据
            const actualChunk = Buffer.from(readBuffer.subarray(0, chunkLen));
            fileOffset += chunkLen;

            const currentPartNum = partNum;
            const chunkName = `${fileName}.part${String(currentPartNum).padStart(3, "0")}`;

            // 1. 断点续传逻辑 (如果在同一个版本传了一半断开了)
            const existingChunk = manifest.chunks.find((c) => c.part === currentPartNum);
            if (existingChunk) {
                console.log(`⏩ [断点续传] 跳过已完成分片 [${currentPartNum}] (CDC动态大小: ${chunkLen} bytes) | URL: ${existingChunk.url}`);
                partNum++;
                continue;
            }

            // 2. 增量秒传逻辑 (如果是新版本文件，但是 CDC 切除了跟老版本一样的内容块！)
            const plainHash = crypto.createHash("md5").update(actualChunk).digest("hex");
            if (previousChunksMap.has(plainHash)) {
                const matchedOldChunk = previousChunksMap.get(plainHash);
                console.log(`⚡ [CDC 秒传] 匹配到旧版本中相同内容的分片，免上传复用！(位置: ${currentPartNum} | 大小: ${chunkLen} bytes)`);

                // 将旧的属性复制到新的分片，只是更新它的 part 序号等基本信息
                const chunkResult = {
                    part: currentPartNum,
                    name: chunkName,
                    hash: matchedOldChunk.hash,
                    plain_hash: plainHash,
                    url: matchedOldChunk.url
                };
                manifest.chunks.push(chunkResult);
                saveManifest();
                partNum++;
                continue;
            }

            // 将加密和提交流加入到并发队列中
            uploadTasks.push(
                limit(async () => {
                    // 1. 本地加密 (安全：即使上公链也不会被窥探)
                    const encryptedChunk = await encrypt(actualChunk, key, { returnBuffer: true });

                    if (encryptedChunk.byteLength >= 100 * 1024) {
                        console.warn(`[警告] 切片 ${currentPartNum} 加密后超出100KB，可能产生费用! (${encryptedChunk.byteLength} 字节)`);
                    }

                    // 2. 计算密文 Hash，用于下载时校验网络包
                    const hash = crypto.createHash("md5").update(encryptedChunk).digest("hex");

                    // 3. 上传分片 (带重试机制)
                    const downloadUrl = await retry(async () => uploadDataStream(encryptedChunk, chunkName), 3, 2000);

                    console.log(`✅ 分片 ${currentPartNum} 完成 | CDC提取大小: ${chunkLen} | 加密大小: ${encryptedChunk.byteLength} | URL: ${downloadUrl}`);

                    const chunkResult = {
                        part: currentPartNum,
                        name: chunkName,
                        hash,
                        plain_hash: plainHash,  // <- 将原文 Hash 保存，才能跨版本进行 CDC 匹配
                        url: downloadUrl
                    };
                    manifest.chunks.push(chunkResult);
                    saveManifest(); // 边传边写，实时保存进度

                    return chunkResult;
                })
            );

            partNum++;
        }

        // 等待所有新增的分片并发上传完毕
        await Promise.all(uploadTasks);

    } finally {
        await fileHandle.close();
    }

    saveManifest(); // 最终确认写入
    console.log(`🎉 全部完成！已生成 FileDust 星图文件: ${manifestName}，原文件可安心删除以节省空间！`);
    return manifestName;
};

const retry = async (fn, retries = 3, delayMs = 1000) => {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            console.warn(`⚠️ 重试 ${i + 1}/${retries} 失败: ${error.message}`);
            if (i < retries - 1) {
                // 增加随机休眠 (Jitter) 进一步防刷封禁
                const jitter = Math.random() * 500;
                await new Promise(resolve => setTimeout(resolve, delayMs + jitter));
            }
        }
    }
    throw new Error(`已尝试 ${retries} 次，全部失败`);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    console.log("FileDust Uploader \n请使用引入的方式调用 uploadToDust(filePath, password)");
}
