import { syncFileToDust, restoreFileSyncDust } from "./FileDustSync.js";
import fs from "fs";

async function main() {
    const filePath = "test.md";
    const password = "my_super_secret_password";

    // 初始化文件 (如果不存在则创建一个小的测试文件)
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, "这是原始文档的第一行内容。\n", "utf8");
    }

    console.log("==========================================");
    console.log("= 测试阶段 1: 创建初始 V1 版本并同步备份 =");
    console.log("==========================================");

    // 1. 同步第一个版本
    const manifestPath = await syncFileToDust(filePath, password, 90);

    console.log("\n=============================================");
    console.log("= 测试阶段 2: 修改本地文件，同步产生 V2 版本 =");
    console.log("=============================================");

    // 2. 模拟用户修改了文件 (在前头插入一行，后头追加一行)
    const oldData = fs.readFileSync(filePath, "utf8");
    fs.writeFileSync(filePath, oldData + "【V3新增尾部】\n", "utf8");

    // 再次同步，由于大部分内容使用 CDC 且记录在历史版本里，会触发【CDC 跨版本数据去重】
    await syncFileToDust(filePath, password, 90);

    console.log("\n=============================================");
    console.log("= 测试阶段 3: 文件丢失或需要回滚，从云端恢复 =");
    console.log("=============================================");

    // 3. 从云端恢复最新的 V2 版本 (不传版本号默认最新)
    console.log(">> 正在拉取恢复最新版本 (V2):");
    await restoreFileSyncDust(manifestPath, null, password);

    // 4. 从云端恢复历史的 V1 版本
    console.log("\n>> 正在拉取恢复历史快照记录 (V1):");
    await restoreFileSyncDust(manifestPath, 1, password);

    console.log("\n[完成] 可以查看当前目录下生成的 restored_v1_... 和 restored_v2_... 检验内容是否符合多版本预期！");
}

main().catch(console.error);
