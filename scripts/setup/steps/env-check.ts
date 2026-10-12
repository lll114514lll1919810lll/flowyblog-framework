/** 步骤 1：环境检测。只探测不动手改任何东西。 */
import type { SetupContext, SetupStep } from "../types";

/** 取命令首行输出作为版本号；失败返回 null。 */
function versionOf(ctx: SetupContext, command: string): string | null {
  const r = ctx.run(command);
  if (r.code !== 0) return null;
  return r.stdout.trim().split(/\r?\n/)[0] ?? null;
}

/** 解析 `node -v` 输出的主版本号（v22.14.0 → 22）；解析不出返回 null。 */
function nodeMajor(version: string): number | null {
  const m = /^v?(\d+)\./.exec(version.trim());
  return m ? Number(m[1]) : null;
}

/** 向导要求的 Node 最低主版本（Next.js 16 与 CI 一致） */
const MIN_NODE_MAJOR = 20;

export const envCheck: SetupStep = {
  id: "env-check",
  title: "环境检测",

  async probe(ctx) {
    const node = versionOf(ctx, "node -v");
    if (!node) return { status: "pending", detail: "未检测到 Node.js" };
    // 命令存在 ≠ 版本够：老版本的问题会推迟到构建/部署时才炸，
    // 这里就地把数字拦下来
    const major = nodeMajor(node);
    if (major === null) {
      return { status: "pending", detail: `无法识别 Node 版本（${node}）` };
    }
    if (major < MIN_NODE_MAJOR) {
      return {
        status: "pending",
        detail: `Node ${node} 低于要求的 ${MIN_NODE_MAJOR}+`,
      };
    }
    const pnpm = versionOf(ctx, "pnpm -v");
    if (!pnpm) return { status: "pending", detail: `Node ${node}，但缺少 pnpm` };
    return { status: "done", detail: `Node ${node} · pnpm ${pnpm}` };
  },

  async run(ctx) {
    const node = versionOf(ctx, "node -v");
    if (!node) {
      throw new Error("未检测到 Node.js。请先安装 Node.js 20+：https://nodejs.org");
    }
    const major = nodeMajor(node);
    if (major === null || major < MIN_NODE_MAJOR) {
      throw new Error(
        `Node.js 版本过低（当前 ${node}，要求 ${MIN_NODE_MAJOR}+）。` +
          `请到 https://nodejs.org 升级后重试本步骤。`,
      );
    }
    ctx.logger.log(`Node.js：${node}`);

    const pnpm = versionOf(ctx, "pnpm -v");
    if (!pnpm) {
      throw new Error(
        "未检测到 pnpm。运行 corepack enable（Node 20 自带）或 npm i -g pnpm，然后重试本步骤。",
      );
    }
    ctx.logger.log(`pnpm：${pnpm}`);

    const git = versionOf(ctx, "git --version");
    if (git) {
      ctx.logger.log(`Git：${git}`);
    } else {
      ctx.logger.warn(
        "未检测到 Git。直传部署用不到它，但以后想走「push 自动重新部署」需要装。",
      );
    }
    return { detail: `Node ${node} · pnpm ${pnpm}` };
  },
};
