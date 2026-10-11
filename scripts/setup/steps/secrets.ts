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

export const secrets: SetupStep = {
  id: "secrets",
  title: "生成密钥",

  async probe(ctx) {
    if (ctx.state.secrets?.ADMIN_KEY) {
      return { status: "done", detail: "密钥已生成（.dev.vars）" };
    }
    return { status: "pending", detail: "还没有生成管理密钥" };
  },

  async run(ctx) {
    if (ctx.state.secrets) {
      const regenerate = await ctx.confirm(
        "secretsRegen",
        "已生成过密钥。重新生成会使已部署环境里的旧密钥失效（管理员要重新登录），确认重新生成？",
        false,
      );
      if (!regenerate) return { detail: "沿用已有密钥" };
    }

    const siteUrl = ctx.state.answers.siteUrl;
    if (!siteUrl) {
      throw new Error("缺少站点域名，请先完成「站点配置」步骤再生成密钥。");
    }

    const entries: Record<string, string> = {
      ADMIN_KEY: gen(24),
      SESSION_SECRET: gen(32),
      IP_SALT: gen(16),
      // 线上评论接口只接受这几个来源；绑自定义域名后要把新域名补进来
      ALLOWED_ORIGINS: `${siteUrl},http://localhost:3000`,
    };

    upsertEnvFile(ctx, entries);
    ctx.state.secrets = entries;
    ctx.saveState();

    ctx.logger.log(
      `已写入 ${DEV_VARS_FILE}（已在 .gitignore 中，不会被提交）：ADMIN_KEY / SESSION_SECRET / IP_SALT / ALLOWED_ORIGINS`,
    );
    ctx.logger.log("管理后台的登录密钥（ADMIN_KEY）请自行查看该文件，向导不会展示。");
    return { data: { keys: Object.keys(entries) }, detail: "本地密钥就绪" };
  },
};
