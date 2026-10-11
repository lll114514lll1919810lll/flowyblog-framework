/**
 * 步骤 6：构建并发布。NEXT_OUTPUT=export 静态导出 → 直接上传 Cloudflare
 * Pages（wrangler.toml 里的 pages_build_output_dir / D1 绑定会被自动采用）
 * → 把 state 里生成的密钥回填为线上 Pages 环境变量。
 *
 * 这是全程唯一「有副作用且每次都变」的步骤，因此 probe 判定 done 后
 * 编排器默认跳过；想重新发布用 pnpm run setup --step deploy 强制重跑。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { humanizeCloudflareError } from "../context";
import type { SetupContext, SetupStep } from "../types";

function projectName(ctx: SetupContext): string {
  const text = readFileSync(join(ctx.root, "wrangler.toml"), "utf8");
  return /^name\s*=\s*"([^"]+)"/m.exec(text)?.[1] ?? "flowyblog-framework";
}

/** 依赖装没装的判据：next 包在 node_modules 里（pnpm 也会为直接依赖建实体目录）。 */
function depsInstalled(ctx: SetupContext): boolean {
  return existsSync(join(ctx.root, "node_modules", "next"));
}

export const deploy: SetupStep = {
  id: "deploy",
  title: "构建并发布",

  async probe(ctx) {
    if (ctx.state.steps.deploy?.status === "done") {
      const url = typeof ctx.state.steps.deploy.data?.url === "string"
        ? ctx.state.steps.deploy.data.url
        : "已发布";
      return { status: "done", detail: `${url}（重新发布：pnpm run setup --step deploy）` };
    }
    return { status: "pending", detail: "还没有发布过" };
  },

  async run(ctx) {
    const name = projectName(ctx);

    // 无 git 仓库（如直接下载源码包）也能部署，但要让用户明白代价：
    // AGPL 的源码提供义务 + 无法升级/换机器，都从这里开始
    if (!existsSync(join(ctx.root, ".git"))) {
      ctx.logger.warn(
        "当前目录不是 git 仓库：可以直接部署，但 (1) AGPL 要求向访客提供完整源码，" +
          "请尽快在 GitHub fork 本项目、推送代码，并更新站点地址里的仓库链接；" +
          "(2) 以后无法通过 git pull 获取框架更新，也无法用推送自动部署。",
      );
    }

    // 1. 依赖兜底：全新 clone 直接跑向导的人很可能还没装依赖，
    //    与其让 next 报一堆「command not found」，不如向导直接替用户装
    if (!depsInstalled(ctx)) {
      ctx.logger.log("还没安装依赖，正在执行 pnpm install（视网络一两分钟）…");
      const install = ctx.run("pnpm install", { capture: false });
      if (install.code !== 0) {
        throw new Error("依赖安装失败。请检查网络（或代理）后重试本步骤。");
      }
    }

    // 2. 静态导出构建。输出直通终端，方便看到真实的构建进度和报错位置。
    ctx.logger.log("静态导出构建中（NEXT_OUTPUT=export）…");
    const build = ctx.run("pnpm run build", {
      env: { NEXT_OUTPUT: "export" },
      capture: false,
    });
    if (build.code !== 0) {
      throw new Error("构建失败。可先在本地跑 pnpm build 定位问题，再重试本步骤。");
    }

    // 3. 建 Pages 项目；已存在（重跑发布 / 项目名撞上账号里的现有项目）
    //    不能静默——后者会直接覆盖人家线上版本，必须明示
    const create = ctx.run(
      `npx wrangler pages project create ${name} --production-branch=main`,
    );
    if (create.code !== 0) {
      const out = create.stderr + create.stdout;
      if (/already exists/i.test(out)) {
        ctx.logger.warn(
          `Pages 项目「${name}」已存在，本次发布将覆盖它的当前线上版本（重跑发布即属此类，属正常操作；若这不是你的项目，去改 wrangler.toml 里的 name）`,
        );
      } else {
        const tail = out.trim().split(/\r?\n/).slice(-1)[0] ?? "";
        ctx.logger.warn(
          `创建 Pages 项目未成功（${humanizeCloudflareError(tail) || "未知原因"}），尝试直接部署…`,
        );
      }
    }
    ctx.logger.log("发布到 Cloudflare Pages…");
    const upload = ctx.run("npx wrangler pages deploy --branch main", {
      capture: false,
    });
    if (upload.code !== 0) {
      throw new Error("Pages 发布失败。请检查网络与授权后重试本步骤。");
    }
    const url = `https://${name}.pages.dev`;

    // 4. 回填线上环境变量。项目此时已存在，secret put 失败只警告不中断——
    //    可以去 dash.cloudflare.com 手动补，评论区功能依赖这四个变量。
    if (ctx.state.secrets) {
      ctx.logger.log("回填线上环境变量…");
      const failed: string[] = [];
      for (const [key, value] of Object.entries(ctx.state.secrets)) {
        const r = ctx.run(
          `npx wrangler pages secret put ${key} --project-name ${name}`,
          { input: value },
        );
        if (r.code !== 0) failed.push(key);
      }
      if (failed.length > 0) {
        ctx.logger.warn(
          `以下环境变量未能自动写入，请到 dash.cloudflare.com → Pages → ${name} → 设置 → 环境变量 手动补齐：${failed.join(", ")}`,
        );
      }
    } else {
      ctx.logger.warn("未找到已生成的密钥（跳过了「生成密钥」步骤？），线上环境变量需要手动配置。");
    }

    return {
      data: { url, project: name },
      detail: url,
    };
  },
};
