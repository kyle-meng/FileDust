import fs from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import pLimit from "p-limit";
import { fileURLToPath } from "node:url";

import { loadOrGenerateKey, encrypt } from "./CryptoUtils.js";
import { uploadDataStream } from "./ArweaveSDK.js";

// 控制并发数，防 Irys/Turbo 封 IP
const limit = pLimit(3);

export const uploadToDust = async (filePath, password, chunkSizeKB = 90) => {
    const fileName = path.basename(filePath);
    const stats = fs.statSync(filePath);
    const fileSize = stats.size;

    // 控制切片大小，保证加密后的密文不会超过 100KB (Arweave 免费线)
    const chunkSize = chunkSizeKB * 1024;
    const manifest = { filename: fileName, total_size: fileSize, chunks: [] };

    // 加载或生成密钥
    const { key } = await loadOrGenerateKey(password);

    console.log(`🚀 开始处理文件: ${fileName} (${fileSize} bytes)`);

    const fileHandle = await open(filePath, "r");
    const buffer = Buffer.alloc(chunkSize);

    let partNum = 0;
    const uploadTasks = [];

    try {
        while (true) {
            const { bytesRead } = await fileHandle.read(buffer, 0, chunkSize, null);
            if (bytesRead === 0) break;

            const actualChunk = Buffer.from(buffer.subarray(0, bytesRead));
            const currentPartNum = partNum;
            const chunkName = `${fileName}.part${String(currentPartNum).padStart(3, "0")}`;

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

                    console.log(`✅ 分片 ${currentPartNum} 完成 | 大小: ${encryptedChunk.byteLength} 字节 | URL: ${downloadUrl}`);

                    return { part: currentPartNum, name: chunkName, hash, url: downloadUrl };
                })
            );

            partNum++;
        }

        // 等待所有分片并发上传完毕
        const results = await Promise.all(uploadTasks);

        // 排序并存入 manifest
        manifest.chunks = results.sort((a, b) => a.part - b.part);

    } finally {
        await fileHandle.close();
    }

    const manifestName = `${fileName}.manifest.json`;
    fs.writeFileSync(manifestName, JSON.stringify(manifest, null, 4));
    console.log(`🎉 全部完成！Manifest已生成: ${manifestName}，原文件可安心删除以节省空间！`);
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
