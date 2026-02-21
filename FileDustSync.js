import fs from "node:fs";
import { open, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import pLimit from "p-limit";
import { fileURLToPath } from "node:url";

import { loadOrGenerateKey, encrypt, decrypt } from "./CryptoUtils.js";
import { uploadDataStream } from "./ArweaveSDK.js";
import { FastCDC, FastCDCConfig } from "./FastCDC.js";
import axios from "axios";

// 控制并发数，防 Irys/Turbo 封 IP
const uploadLimit = pLimit(3);
const downloadLimit = pLimit(5);

const calculateFileHash = (filePath) => {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        const stream = fs.createReadStream(filePath);
        stream.on("data", (data) => hash.update(data));
        stream.on("end", () => resolve(hash.digest("hex")));
        stream.on("error", reject);
    });
};

const retry = async (fn, retries = 3, delayMs = 1000) => {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            console.warn(`⚠️ 重试 ${i + 1}/${retries} 失败: ${error.message}`);
            if (i < retries - 1) {
                const jitter = Math.random() * 500;
                await new Promise((resolve) => setTimeout(resolve, delayMs + jitter));
            }
        }
    }
    throw new Error(`已尝试 ${retries} 次，全部失败`);
};

export const syncFileToDust = async (filePath, password, chunkSizeKB = 90) => {
    const fileName = path.basename(filePath);
    const stats = fs.statSync(filePath);
    const fileSize = stats.size;

    console.log(`\n📚 [Sync] 🚀 开始跨版本快照同步文件: ${fileName} (${fileSize} bytes)`);
    console.log(`📚 [Sync] ⏱️  正在计算当前原始文件完整 Hash，请稍候...`);
    const fileHash = await calculateFileHash(filePath);

    const maxChunkSize = chunkSizeKB * 1024;
    const avgChunkSize = Math.floor(maxChunkSize / 2);
    const minChunkSize = Math.floor(avgChunkSize / 4);

    const cdcConfig = new FastCDCConfig(minChunkSize, avgChunkSize, maxChunkSize);
    const chunker = new FastCDC(cdcConfig);
    const manifestName = `${fileName}.sync.dust`;

    let manifest = { filename: fileName, pool: {}, versions: [] };
    let currentVersionIndex = -1;

    if (fs.existsSync(manifestName)) {
        try {
            const existingManifest = JSON.parse(fs.readFileSync(manifestName, "utf8"));
            manifest = { filename: fileName, pool: {}, versions: [], ...existingManifest };
            if (!manifest.pool) manifest.pool = {};
            if (!manifest.versions) manifest.versions = [];

            // 向前兼容：把老版本格式升维到 pool 全局去重字典结构
            for (const ver of manifest.versions) {
                if (ver.chunks && ver.chunks.length > 0) {
                    const newChunks = [];
                    for (let i = 0; i < ver.chunks.length; i++) {
                        const chunk = ver.chunks[i];
                        if (typeof chunk === 'object' && chunk !== null && chunk.plain_hash) {
                            manifest.pool[chunk.plain_hash] = {
                                hash: chunk.hash,
                                url: chunk.url
                            };
                            newChunks[chunk.part !== undefined ? chunk.part : i] = chunk.plain_hash;
                        } else if (typeof chunk === 'string') {
                            newChunks[i] = chunk;
                        }
                    }
                    ver.chunks = newChunks;
                }
            }

            // 检查最近的一个版本是否与当前文件 Hash 相同（可能是重试或者不需要同步）
            if (manifest.versions.length > 0) {
                const lastVer = manifest.versions[manifest.versions.length - 1];
                if (lastVer.file_hash === fileHash) {
                    if (lastVer.status === "completed") {
                        console.log(`📚 [Sync] ♻️  当前文件已经是最新版本(v${lastVer.version})，已完全同步跳过操作！`);
                        return manifestName;
                    } else {
                        console.log(`📚 [Sync] ♻️  发现未完成的当前版本同名星图缓存，开启断点续传同步模式...`);
                        currentVersionIndex = manifest.versions.length - 1;
                    }
                }
            }
        } catch (e) {
            console.warn(`📚 [Sync] ⚠️  读取已有同步历史星图失败，新建同步点...`);
        }
    }

    if (currentVersionIndex === -1) {
        // 创建新版本
        const newVersionNum = manifest.versions.length + 1;
        const newVersion = {
            version: newVersionNum,
            timestamp: new Date().toISOString(),
            file_hash: fileHash,
            total_size: fileSize,
            status: "pending",
            chunks: [],
        };
        manifest.versions.push(newVersion);
        currentVersionIndex = manifest.versions.length - 1;
        console.log(`📚 [Sync] 🆕 已创建新的历史版本记录节点: v${newVersionNum}`);
    }

    const saveManifest = () => {
        fs.writeFileSync(manifestName, JSON.stringify(manifest, null, 4));
    };
    saveManifest();

    const { key } = await loadOrGenerateKey(password);
    const fileHandle = await open(filePath, "r");
    const readBuffer = Buffer.alloc(maxChunkSize);

    let partNum = 0;
    let fileOffset = 0;
    const uploadTasks = [];
    const currentVersionChunks = manifest.versions[currentVersionIndex].chunks;

    try {
        while (fileOffset < fileSize) {
            const remaining = fileSize - fileOffset;
            const toRead = Math.min(maxChunkSize, remaining);

            const { bytesRead } = await fileHandle.read(readBuffer, 0, toRead, fileOffset);
            if (bytesRead === 0) break;

            const chunkLen = chunker.getChunkSize(readBuffer, 0, bytesRead);
            const actualChunk = Buffer.from(readBuffer.subarray(0, chunkLen));
            fileOffset += chunkLen;

            const currentPartNum = partNum;
            const chunkName = `${fileName}.v${manifest.versions.length}.part${String(currentPartNum).padStart(3, "0")}`;

            // 1. 断点续传逻辑
            const existingPlainHash = currentVersionChunks[currentPartNum];
            if (existingPlainHash && manifest.pool[existingPlainHash]) {
                console.log(`📚 [Sync] ⏩ [断点续传] 跳过本版本已成功上传的碎片片段 [${currentPartNum}] (CDC片段大小: ${chunkLen} bytes)`);
                partNum++;
                continue;
            }

            // 2. 跨版本增量秒传逻辑 (CDC)
            const plainHash = crypto.createHash("md5").update(actualChunk).digest("hex");
            if (manifest.pool[plainHash]) {
                console.log(`📚 [Sync] ⚡ [CDC 跨版本数据去重] 发现历史版本内容，零消耗复用云端片段！(本地片段: v${manifest.versions.length}-part${currentPartNum} | 大小: ${chunkLen} bytes)`);

                currentVersionChunks[currentPartNum] = plainHash;
                saveManifest();
                partNum++;
                continue;
            }

            // 3. 全新数据碎片上传
            uploadTasks.push(
                uploadLimit(async () => {
                    const encryptedChunk = await encrypt(actualChunk, key, { returnBuffer: true });
                    const hash = crypto.createHash("md5").update(encryptedChunk).digest("hex");

                    const downloadUrl = await retry(async () => uploadDataStream(encryptedChunk, chunkName), 3, 2000);

                    console.log(`📚 [Sync] ✅ 【全新上传】v${manifest.versions.length} 分片 ${currentPartNum} 成功 | 尺寸: ${chunkLen} | URL: ${downloadUrl}`);

                    // 加入全局哈希特征池 (Pool)
                    manifest.pool[plainHash] = {
                        hash,
                        url: downloadUrl,
                    };

                    // 将新上传的分片指针记录到当前版本的序列中
                    currentVersionChunks[currentPartNum] = plainHash;
                    saveManifest();

                    return plainHash;
                })
            );
            partNum++;
        }
        await Promise.all(uploadTasks);
        manifest.versions[currentVersionIndex].status = "completed";
    } finally {
        await fileHandle.close();
    }

    saveManifest();
    console.log(`📚 [Sync] 🎉 v${manifest.versions.length} 历史版本同步快照创建完毕！已记录多版本时间线清单: ${manifestName}\n`);
    return manifestName;
};

// --- 下方为将快照（特定版本）拉取恢复到本地的代码 ---

export const restoreFileSyncDust = async (manifestPath, targetVersion, password) => {
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`找不到星图同步清单: ${manifestPath}`);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (!manifest.versions || manifest.versions.length === 0) {
        throw new Error(`该星图没有历史版本数据！`);
    }

    const { key } = await loadOrGenerateKey(password);

    // 如果 targetVersion 为 null，则恢复最新版本
    let versionToRestore;
    if (targetVersion) {
        versionToRestore = manifest.versions.find(v => v.version === Number(targetVersion));
        if (!versionToRestore) {
            throw new Error(`清单中不存在版本号为 v${targetVersion} 的镜像快照！`);
        }
    } else {
        versionToRestore = manifest.versions[manifest.versions.length - 1];
    }

    if (versionToRestore.status !== "completed") {
        console.warn(`[恢复警告] 正在恢复的 v${versionToRestore.version} 快照当时并未完全同步到云端！内容可能破损。`);
    }

    const { filename } = manifest;
    // 自动在输出名称附加版本号
    const outputFilename = `restored_v${versionToRestore.version}_${filename}`;

    console.log(`\n⏳ [Sync Restore] 开始从去中心化网络中恢复历史版本: ${filename} (快照版本号: v${versionToRestore.version})，目标体积: ${versionToRestore.total_size}`);

    const chunks = versionToRestore.chunks;
    const pool = manifest.pool || {};
    const downloadedBuffers = [];
    let downloadedSize = 0;

    const downloadTasks = chunks.map((plainHash, index) => {
        if (!plainHash || !pool[plainHash]) return Promise.resolve();

        return downloadLimit(async () => {
            const chunkInfo = pool[plainHash];
            const partNum = index;
            const url = chunkInfo.url;
            console.log(`📡 [Sync Restore] 正在提取区块资源 [v${versionToRestore.version}_Part ${partNum}]...`);

            const buf = await retry(async () => {
                const response = await axios.get(url, { responseType: "arraybuffer", timeout: 10000 });
                return Buffer.from(response.data);
            }, 3);

            // 校验提取的密文哈希
            const currentHash = crypto.createHash("md5").update(buf).digest("hex");
            if (currentHash !== chunkInfo.hash) {
                console.warn(`⚠️  警告：提取回来的区块 [Part ${partNum}] 似乎在网络中遭遇破损 (HASH 不一致)`);
            }

            // 解密
            const decryptedChunk = await decrypt(buf, key, { autoJson: false });

            // 校验解密明文哈希
            const currentPlainHash = crypto.createHash("md5").update(decryptedChunk).digest("hex");
            if (currentPlainHash !== plainHash) {
                throw new Error(`[Sync Restore] 致命错误：解密还原后原文 Hash 未命中原始 CDC 指纹记录，此快照节点存在内容篡改！(Part ${partNum})`);
            }

            downloadedSize += decryptedChunk.byteLength;
            console.log(`✅ [Sync Restore] 解密并还原区块 [Part ${partNum}] 成功. (${downloadedSize}/${versionToRestore.total_size})`);
            downloadedBuffers[partNum] = decryptedChunk;
        });
    });

    await Promise.all(downloadTasks);

    console.log(`\n🧩 [Sync Restore] 所有历史切片已拉取完毕，正在将散乱碎块逆向拼接到硬盘实体文件...`);
    const finalBuffer = Buffer.concat(downloadedBuffers.filter(b => b));

    await writeFile(outputFilename, finalBuffer);

    // 校验文件总体 Hash
    const restoredFileHash = crypto.createHash("sha256").update(finalBuffer).digest("hex");
    if (restoredFileHash !== versionToRestore.file_hash) {
        console.error(`❌ [Sync Restore] 此历史快照全量重建完成，但最终文件的沙箱 Hash 与原始镜像 Hash 对不上！`);
    } else {
        console.log(`🎉 [Sync Restore] 历史版本 [v${versionToRestore.version}] 完全校验一致并于本地复活成功，重塑出世 : ${outputFilename}`);
    }

    return outputFilename;
};
