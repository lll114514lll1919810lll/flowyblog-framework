/**
 * pnpm run setup —— FlowyBlog 一键安装向导（v0 交互式 CLI）。
 *
 * 注意必须写成 `pnpm run setup`：裸 `pnpm setup` 会被 pnpm 的内建
 * setup 命令（配置 PNPM_HOME）拦截，轮不到我们的脚本。
 *
 * 用法：
 *   pnpm run setup                  全流程
 *   pnpm run setup --step deploy    只跑某一步（probe done 也会强制执行）
 *   pnpm run setup --answers a.json 预填答案，跳过提问（非交互）
 *   pnpm run setup --json           机器可读事件流，供 v1 Web 向导订阅
 *   pnpm run setup --list           列出全部步骤
 *
 * 幂等：每步执行前先 probe 真实状态，已完成的自动跳过；中断后重跑即可续装。
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  c,
  closeStdin,
  consoleLogger,
  jsonLogger,
  loadState,
  makeContext,
  saveState,
} from "./context";
import { cfAuth } from "./steps/cf-auth";
import { d1Init } from "./steps/d1-init";
import { deploy } from "./steps/deploy";
import { envCheck } from "./steps/env-check";
import { secrets } from "./steps/secrets";
import { siteConfig } from "./steps/site-config";
import type { SetupStep } from "./types";

const STEPS: SetupStep[] = [envCheck, siteConfig, cfAuth, d1Init, secrets, deploy];

const HELP = `FlowyBlog 一键安装向导

用法：
  pnpm run setup                   全流程
  pnpm run setup --step <id>       只跑某一步（配合 --list 查看可用步骤）
  pnpm run setup --answers <file>  预填答案（JSON 对象），非交互执行
  pnpm run setup --json            以 JSON 事件流输出（供图形界面订阅）
  pnpm run setup --list            列出全部步骤

（必须带 run：裸 pnpm setup 是 pnpm 的内建命令，会被它拦截。）

--answers 示例（键名与各步骤提问一致）：
  {
    "siteName": "我的博客", "author": "博主",
    "description": "一句话简介", "siteUrl": "https://xxx.pages.dev",
    "github": "https://github.com/you",
    "repo": "https://github.com/you/your-blog",
    "cfLogin": "y", "d1Create": "y"
  }`;

function argValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return;
  }
  const json = args.includes("--json");
  const only = argValue(args, "--step");
  const answersFile = argValue(args, "--answers");

  if (args.includes("--list")) {
    for (const step of STEPS) console.log(`${step.id.padEnd(14)} ${step.title}`);
    return;
  }

  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const state = loadState(root);
  let answers: Record<string, string> = {};
  if (answersFile) {
    answers = JSON.parse(readFileSync(answersFile, "utf8")) as Record<string, string>;
  }
  const logger = json ? jsonLogger() : consoleLogger();
  const ctx = makeContext({ root, state, answers, logger, interactive: !json });

  if (only && !STEPS.some((s) => s.id === only)) {
    logger.warn(`未知步骤：${only}（用 pnpm run setup --list 查看）`);
    process.exitCode = 1;
    return;
  }

  if (!json) {
    console.log(c.bold("FlowyBlog 一键安装向导"));
    console.log(
      c.dim(
        "把「配置站点 → Cloudflare 授权 → 建库 → 密钥 → 部署」压缩成一次问答。\n" +
          "全程幂等：中断后重跑会自动跳过已完成步骤（状态在 .setup/，已 gitignore）。\n" +
          "开始前请准备一个 Cloudflare 账号（免费）：https://dash.cloudflare.com/sign-up",
      ),
    );
  }
  logger.event("setup-start", { steps: STEPS.map((s) => s.id) });

  // 预检：向导会覆盖的两个跟踪文件若已有未提交改动，先明示出来
  const dirty = ctx.run("git status --porcelain -- src/lib/site.ts wrangler.toml");
  if (dirty.code === 0 && dirty.stdout.trim()) {
    logger.warn(
      "src/lib/site.ts / wrangler.toml 存在未提交的改动，向导会直接覆盖它们（介意的话先 git stash 或提交）",
    );
    logger.event("warn-dirty", { files: dirty.stdout.trim().split(/\r?\n/) });
  }

  const queue = only ? STEPS.filter((s) => s.id === only) : STEPS;
  for (const step of queue) {
    // 交互模式：done 跳过；--step 单步模式视为「强制重跑」，不跳过。
    const probe = await step.probe(ctx);
    if (probe.status === "done" && !only) {
      logger.log(`${c.green("✓")} ${step.title} —— ${probe.detail ?? "已完成，跳过"}`);
      logger.event("step-skip", { id: step.id, detail: probe.detail });
      continue;
    }
    if (!json) {
      console.log(
        `\n${c.bold(`▸ ${step.title}`)}${probe.detail ? c.dim(`（${probe.detail}）`) : ""}`,
      );
    }
    logger.event("step-start", { id: step.id, detail: probe.detail });

    for (;;) {
      try {
        const result = await step.run(ctx);
        state.steps[step.id] = {
          status: "done",
          at: new Date().toISOString(),
          data: result.data,
        };
        saveState(root, state);
        logger.log(`${c.green("✓")} ${step.title}${result.detail ? c.dim(` —— ${result.detail}`) : ""}`);
        logger.event("step-end", { id: step.id, detail: result.detail, data: result.data });
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(message);
        logger.event("step-error", { id: step.id, message });
        if (!ctx.interactive) {
          logger.event("setup-end", { ok: false, failedStep: step.id });
          process.exitCode = 1;
          return;
        }
        const how = (
          await ctx.raw("处理方式：[r] 重试 / [s] 跳过 / [a] 中止（回车 = 重试）：")
        ).toLowerCase();
        if (how === "s") {
          state.steps[step.id] = { status: "skipped", at: new Date().toISOString() };
          saveState(root, state);
          logger.event("step-skip", { id: step.id, detail: "用户选择跳过" });
          break;
        }
        if (how === "a") {
          logger.event("setup-end", { ok: false, failedStep: step.id, aborted: true });
          process.exitCode = 1;
          return;
        }
      }
    }
  }

  logger.event("setup-end", { ok: true });
  if (!json) {
    const deployed = state.steps.deploy?.data;
    console.log("");
    if (typeof deployed?.url === "string") {
      console.log(c.bold(`全部完成，博客已上线：${c.green(deployed.url as string)}`));
    } else {
      console.log(c.bold("向导结束。"));
    }
    console.log(
      c.dim(
        [
          `本地预览评论接口：pnpm preview:cf`,
          `重新发布：pnpm run setup --step deploy`,
          `绑自定义域名 / 查看评论数据：dash.cloudflare.com → Pages / D1`,
        ].join("\n"),
      ),
    );
  }
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(c.red(`setup 异常终止：${message}`));
    process.exitCode = 1;
  })
  .finally(() => {
    closeStdin();
  });
