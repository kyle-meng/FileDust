import fs from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import crypto from "node:crypto";
import axios from "axios";
import { fileURLToPath } from "node:url";

import { loadOrGenerateKey, decrypt } from "./CryptoUtils.js";

const calculateHash = (buffer) => {
    return crypto.createHash("md5").update(buffer).digest("hex");
};

export const downloadFromDust = async (manifestPath, password) => {
    const manifestContent = fs.readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(manifestContent);

    // 临时文件，一边下一边写
    const tempFilename = `restored_${manifest.filename}.tmp`;
    const finalFilename = `restored_${manifest.filename}`;

    const { key } = await loadOrGenerateKey(password);

    const chunks = manifest.chunks.sort((a, b) => a.part - b.part);

    console.log(`📦 正在从星尘中重组: ${finalFilename}`);
    console.log(`🧩 总碎片数: ${chunks.length}`);

    // 使用 write 模式 (顺带清空之前可能遗留的断点残余)
    const outputFileHandle = await open(tempFilename, "w");

    // 不使用并发，顺序下载写入，保证写入顺序且完美控制内存消耗 (恒定约 100KB)
    try {
        for (const chunkInfo of chunks) {
            const { part, url, hash: expectedHash } = chunkInfo;

            process.stdout.write(`[${part}] ☁️  捕捉飘落的碎片: ${url.substring(0, 30)}... `);

            let netData = null;
            try {
                // 下载密文分片
                const response = await axios.get(url, {
                    responseType: "arraybuffer", // 必须以二进制进行下载
                    timeout: 30000,
                });

                netData = Buffer.from(response.data);

                // 根据 manifest 校验网络下载的包有无损坏
                if (calculateHash(netData) !== expectedHash) {
                    throw new Error("云端碎片 Hash 校验跌出预期，碎片可能已损坏或丢包!");
                }

                // 本地瞬时解密还原
                const decryptedChunk = await decrypt(netData, key, { autoJson: false });

                // 追加写入到本地临时文件
                await outputFileHandle.write(decryptedChunk);

                console.log("✅ 成功");

            } catch (e) {
                console.error(`\n❌ 获取或拼装失败: ${e.message}`);
                // 出现致命错误，清理现场
                await outputFileHandle.close();
                if (fs.existsSync(tempFilename)) {
                    await unlink(tempFilename);
                }
                return;
            }
        }
    } finally {
        await outputFileHandle.close();
    }

    // 全部写入完毕，将临时文件重命名为原格式
    if (fs.existsSync(finalFilename)) {
        await unlink(finalFilename); // 如果已存在同名还原文件则覆盖
    }
    await rename(tempFilename, finalFilename);
    console.log(`\n🎉 浩瀚星尘重组完毕！还原所得文件: ${finalFilename}`);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    console.log("FileDust Merger \n请使用引入的方式调用 downloadFromDust(manifestPath, password)");
}
