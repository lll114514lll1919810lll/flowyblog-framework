/**
 * 步骤 5：密钥生成。ADMIN_KEY / SESSION_SECRET / IP_SALT 本地随机生成，
 * 连同 ALLOWED_ORIGINS 一起写入 .dev.vars（本地预览用），并留存在
 * .setup/state.json 里供 deploy 步骤回填线上环境变量。
 *
 * 注意：state.json 含密钥明文，.setup/ 必须保持 gitignore 状态。
 * 这里绝不把密钥值打到日志或事件里，只报键名。
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SetupContext, SetupStep } from "../types";

const DEV_VARS_FILE = ".dev.vars";

/** base64url：无换行、无引号歧义，适合直接写进 env 文件。 */
const gen = (bytes: number) => randomBytes(bytes).toString("base64url");

/** 把 entries 合并进 env 文件：同名键重写，其余行原样保留。 */
function upsertEnvFile(ctx: SetupContext, entries: Record<string, string>): void {
  const file = join(ctx.root, DEV_VARS_FILE);
  const kept = existsSync(file)
    ? readFileSync(file, "utf8")
        .split(/\r?\n/)
        .filter((line) => {
          const m = /^([A-Za-z0-9_]+)\s*=/.exec(line);
          return !(m && m[1] in entries) && line.trim() !== "";
        })
    : [];
  const ours = Object.entries(entries).map(([k, v]) => `${k}=${v}`);
  writeFileSync(file, [...ours, ...kept].join("\n") + "\n", "utf8");
}

/** 读取 .dev.vars 里的 KEY=VALUE（probe 只信这个真实文件，不信 state 记录）。 */
function readDevVars(root: string): Record<string, string> {
  const file = join(root, DEV_VARS_FILE);
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

/** 本步骤负责的四个键。 */
const SECRET_KEYS = ["ADMIN_KEY", "SESSION_SECRET", "IP_SALT", "ALLOWED_ORIGINS"] as const;

export const secrets: SetupStep = {
  id: "secrets",
  title: "生成密钥",

  async probe(ctx) {
    const file = readDevVars(ctx.root);
    // probe 检查真实文件而不是 state 记录（types.ts 的硬约定）：
    // state.json 可能被删过（换机器、误删 .setup/），只有 .dev.vars
    // 才是密钥的实际落点；反过来文件丢了 state 还在时也能被发现
    const missing = SECRET_KEYS.filter((k) => !file[k]);
    if (missing.length === 0) {
      return { status: "done", detail: "密钥已生成（.dev.vars）" };
    }
    if (file.ADMIN_KEY) {
      return { status: "pending", detail: `.dev.vars 缺少键：${missing.join(" / ")}` };
    }
    return { status: "pending", detail: "还没有生成管理密钥" };
  },

  async run(ctx) {
    const siteUrl = ctx.state.answers.siteUrl;
    if (!siteUrl) {
      throw new Error("缺少站点域名，请先完成「站点配置」步骤再生成密钥。");
    }

    const file = readDevVars(ctx.root);
    const state = ctx.state.secrets;

    /*
      三个来源按优先级合并：文件里的现值 > state 里的记录 > 现场新生成。
      只补缺失键，绝不覆盖已有值——线上 Pages 环境变量仍是旧值，
      这里一重新生成，已部署的密钥就意外失效（管理员登录不上、IP 哈希变基）。
      需要换密钥时直接改 .dev.vars 再重跑本步骤 + deploy 即可。
    */
    const merged: Record<string, string> = {};
    const regenerated: string[] = [];
    for (const key of SECRET_KEYS) {
      const value = file[key] || state?.[key];
      if (value) {
        merged[key] = value;
      } else {
        merged[key] =
          key === "ADMIN_KEY"
            ? gen(24)
            : key === "SESSION_SECRET"
              ? gen(32)
              : key === "IP_SALT"
                ? gen(16)
                : `${siteUrl},http://localhost:3000`;
        regenerated.push(key);
      }
    }

    upsertEnvFile(ctx, merged);
    ctx.state.secrets = merged;
    ctx.saveState();

    if (regenerated.length > 0) {
      ctx.logger.warn(
        `${regenerated.join(" / ")} 在 .dev.vars 和向导状态里都不存在，已重新生成` +
          `${state ? "（其余键沿用旧值）" : ""}。` +
          "若这些键曾部署到线上，请重跑「构建并发布」同步环境变量。",
      );
    }
    ctx.logger.log(
      `已写入 ${DEV_VARS_FILE}（已在 .gitignore 中，不会被提交）：${SECRET_KEYS.join(" / ")}`,
    );
    ctx.logger.log("管理后台的登录密钥（ADMIN_KEY）请自行查看该文件，向导不会展示。");
    return {
      data: { keys: SECRET_KEYS.slice() },
      detail: regenerated.length === SECRET_KEYS.length ? "本地密钥就绪" : "密钥沿用已有值",
    };
  },
};
