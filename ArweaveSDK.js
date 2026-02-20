import fs from "fs";
import path from "path";
import Arweave from "arweave";
import mime from "mime";
import { TurboFactory, ArweaveSigner } from "@ardrive/turbo-sdk/node";

const arweave = Arweave.init({
    host: "arweave.net",
    port: 443,
    protocol: "https",
});

const WALLET_PATH = path.resolve("wallet.json");

async function initTurboClient() {
    let jwk;
    if (fs.existsSync(WALLET_PATH)) {
        jwk = JSON.parse(fs.readFileSync(WALLET_PATH, "utf-8"));
    } else {
        console.log("未找到 wallet.json，正在生成新钱包...");
        jwk = await arweave.wallets.generate();
        fs.writeFileSync(WALLET_PATH, JSON.stringify(jwk, null, 2));
        console.log("新钱包生成并保存到 wallet.json（请备份！）");
    }

    const signer = new ArweaveSigner(jwk);
    const turbo = TurboFactory.authenticated({ signer });
    return turbo;
}

export async function uploadDataStream(data, filename) {
    if (!Buffer.isBuffer(data)) {
        throw new Error("data 必须是 Buffer 类型");
    }

    const dataSize = data.byteLength;
    const contentType = mime.getType(filename) || "application/octet-stream";

    const turbo = await initTurboClient();

    try {
        const uploadResult = await turbo.uploadFile({
            fileStreamFactory: () => data,
            fileSizeFactory: () => dataSize,
            dataItemOpts: {
                tags: [
                    { name: "Content-Type", value: contentType },
                    { name: "App-Name", value: "FileDust" },
                    { name: "File-Name", value: filename },
                    { name: "Uploaded-With", value: "@ardrive/turbo-sdk" },
                ],
            },
        });

        return "https://arweave.net/" + uploadResult.id;
    } catch (error) {
        throw new Error(`上传失败: ${error.message} (File: ${filename}, Size: ${dataSize})`);
    }
}
