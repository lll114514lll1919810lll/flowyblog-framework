/**
 * 步骤 3：Cloudflare 授权。走 wrangler 官方的浏览器 OAuth 流程，
 * 不要求用户去后台手动创建 API Token。
 */
import type { SetupContext, SetupStep } from "../types";

function whoami(ctx: SetupContext) {
  // 首次运行 npx 会先下载 wrangler，属正常现象
  return ctx.run("npx wrangler whoami");
}

/**
 * 未登录时 whoami 也以退出码 0 结束（只打印 "You are not authenticated"），
 * 所以不能只看退出码，必须解析输出内容。
 */
function isLoggedIn(r: { code: number; stdout: string }): boolean {
  return r.code === 0 && /logged in/i.test(r.stdout) && !/not authenticated/i.test(r.stdout);
}

export const cfAuth: SetupStep = {
  id: "cf-auth",
  title: "Cloudflare 授权",

  async probe(ctx) {
    const r = whoami(ctx);
    if (isLoggedIn(r)) {
      const account = /Account Name:\s*(.+)/.exec(r.stdout)?.[1]?.trim();
      return { status: "done", detail: account ? `已登录（${account}）` : "已登录" };
    }
    return { status: "pending", detail: "尚未登录 Cloudflare" };
  },

  async run(ctx) {
    if (isLoggedIn(whoami(ctx))) {
      ctx.logger.log("已经登录，跳过授权。");
      return { detail: "已登录" };
    }
    const go = await ctx.confirm(
      "cfLogin",
      "将打开浏览器完成 Cloudflare 登录（没有账号可先在 dash.cloudflare.com/sign-up 免费注册），是否继续？",
    );
    if (!go) {
      throw new Error(
        "已取消。部署需要 Cloudflare 账号；也可以先手动运行 npx wrangler login 再重跑本步骤。",
      );
    }
    ctx.logger.log("启动 wrangler login…（首次运行会先自动下载 wrangler，稍等）");
    const login = ctx.run("npx wrangler login", { capture: false });
    if (login.code !== 0) {
      throw new Error("wrangler login 失败。可手动运行 npx wrangler login 后重跑本步骤。");
    }
    if (!isLoggedIn(whoami(ctx))) {
      throw new Error("登录后 whoami 仍未通过校验，请重试本步骤。");
    }
    return { detail: "Cloudflare 授权完成" };
  },
};
