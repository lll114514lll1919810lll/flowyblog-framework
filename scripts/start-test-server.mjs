#!/usr/bin/env node
/**
 * 跨平台的测试服务器启动脚本（替代原 start-test-server.bat）。
 *
 * 用法：pnpm test:server [-- 端口]
 * 校验端口是 1-65535 的十进制数后转发给 pnpm dev。
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raw = process.argv[2];
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let port = 3000;
if (raw !== undefined) {
  if (!/^\d+$/.test(raw)) {
    console.error(`Invalid port: ${raw} (expected a number between 1 and 65535)`);
    process.exit(1);
  }
  port = Number.parseInt(raw, 10); // Number.parseInt 自动丢弃前导零，保持十进制
  if (port < 1 || port > 65535) {
    console.error(`Invalid port: ${raw} (expected a number between 1 and 65535)`);
    process.exit(1);
  }
}

if (!existsSync(join(root, "node_modules"))) {
  console.error("node_modules was not found. Run pnpm install first.");
  process.exit(1);
}

console.log(`Starting test server: http://localhost:${port}`);
console.log("Press Ctrl+C to stop the server.");

// stdio inherit：dev server 的实时输出与 Ctrl+C 中断直通终端
const result = spawnSync("pnpm", ["dev", "--port", String(port)], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exitCode = result.status ?? 1;
