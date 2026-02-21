import fs from "fs";
import path from "path";
import { syncFileToDust } from "./FileDustSync.js";

// 获取命令行参数
const filePath = process.argv[2] || "test.md";
const password = process.argv[3] || "my_super_secret_password";

if (!fs.existsSync(filePath)) {
    console.error(`❌ 错误：找不到文件 "${filePath}"`);
    console.log("用法: node watchsync.js <文件路径> <你的密码>");
    process.exit(1);
}

console.log(`\n👁️  深空凝视者 (Space Watcher) 已启动`);
console.log(`🎯 正在全天候监听文件变动: ${path.resolve(filePath)}`);
console.log(`🔒 当前使用的加密口令: ${password.slice(0, 3)}***${password.slice(-2)}`);
console.log(`(按 Ctrl+C 即可终止防卫进程)\n`);

let isSyncing = false;
let syncTimeout = null;

// 使用防抖 (Debounce) 机制，防止保存时编辑器触发多次 change 事件
const triggerSync = async () => {
    if (isSyncing) {
        console.log(`⏳ 系统正在同步中，当前变动将在本次同步完成后重试...`);
        return;
    }

    isSyncing = true;
    const timeStr = new Date().toLocaleTimeString();
    console.log(`\n==========================================`);
    console.log(`⏰ [${timeStr}] 探测到文件实质性改变，激活时空引擎！`);

    try {
        await syncFileToDust(filePath, password, 90);
    } catch (err) {
        console.error(`❌ 同步引擎运转异常:`, err.message);
    } finally {
        console.log(`👁️  同步结束，继续保持凝视...`);
        isSyncing = false;
    }
};

fs.watch(filePath, (eventType, filename) => {
    if (eventType === 'change') {
        // 清除上一个计时器
        if (syncTimeout) {
            clearTimeout(syncTimeout);
        }

        // 延迟 1.5 秒后执行同步，避免文件依然被别的文件编辑器独占锁定
        syncTimeout = setTimeout(() => {
            triggerSync();
        }, 1500);
    }
});
