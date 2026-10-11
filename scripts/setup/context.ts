/**
 * Setup 流程的运行时环境：状态落盘、交互问答、shell 执行、日志与事件。
 *
 * v1 的接入点：Web 向导只需要构造自己的 Logger（把 event() 桥接到
 * WebSocket/SSE）+ 预填 answers，复用同一套步骤实现；makeContext 的
 * interactive 传 false 即可关掉所有交互。
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import type { Logger, SetupContext, SetupState } from "./types";

export const STATE_DIR = ".setup";
export const STATE_FILE = join(STATE_DIR, "state.json");

/** wrangler.toml 里出厂占位的 Pages 项目名；全网只能有一个账号用它部署。 */
export const DEFAULT_PROJECT_NAME = "flowyblog-framework";

/** wrangler.toml 里的 Pages 项目名（顶层 name 字段），决定默认站点地址。 */
export function projectName(root: string): string {
  const file = join(root, "wrangler.toml");
  if (!existsSync(file)) return DEFAULT_PROJECT_NAME;
  return (
    /^name\s*=\s*"([^"]+)"/m.exec(readFileSync(file, "utf8"))?.[1] ??
    DEFAULT_PROJECT_NAME
  );
}

/**
 * 没有自有域名时的默认站点地址：部署完成后即可访问的
 * https://<项目名>.pages.dev。站点的正式域名可以之后再换。
 */
export function defaultSiteUrl(root: string): string {
  return `https://${projectName(root)}.pages.dev`;
}

/** 归一成可用于 Pages 项目名 / D1 库名的片段：小写字母、数字、连字符。 */
export function slugifyId(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** 取仓库 URL 路径最后一段当 slug（如 .../your-blog.git → your-blog）。 */
export function repoSlugFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
    return slugifyId(last.replace(/\.git$/, ""));
  } catch {
    return "";
  }
}

/** 终端着色。非 TTY（管道 / CI / --json）时原样返回，避免转义串污染日志。 */
export const c = {
  green: (s: string) => (process.stdout.isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (process.stdout.isTTY ? `\x1b[33m${s}\x1b[0m` : s),
  red: (s: string) => (process.stdout.isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  bold: (s: string) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s: string) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s),
};

export function loadState(root: string): SetupState {
  const file = join(root, STATE_FILE);
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as SetupState;
      // 版本不认识 / 结构损坏时当作全新安装，宁可重问也不带病运行
      if (parsed && parsed.version === 1 && parsed.steps && parsed.answers) {
        return parsed;
      }
    } catch {
      // 状态文件损坏：静默忽略，重新开始
    }
  }
  return { version: 1, steps: {}, answers: {} };
}

export function saveState(root: string, state: SetupState): void {
  const dir = join(root, STATE_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(root, STATE_FILE),
    JSON.stringify(state, null, 2) + "\n",
    "utf8",
  );
}

export function consoleLogger(): Logger {
  return {
    log: (message) => console.log(message),
    warn: (message) => console.log(c.yellow(`! ${message}`)),
    event: () => {},
  };
}

/** --json 模式：全部输出收敛为单行 JSON 事件流，供 v1 Web 向导订阅。 */
export function jsonLogger(): Logger {
  const emitLine = (name: string, payload?: Record<string, unknown>) =>
    console.log(
      JSON.stringify({ event: name, ts: new Date().toISOString(), ...payload }),
    );
  return {
    log: (message) => emitLine("log", { message }),
    warn: (message) => emitLine("warn", { message }),
    event: emitLine,
  };
}

let activeRl: ReturnType<typeof createInterface> | null = null;

function ensureRl(): ReturnType<typeof createInterface> {
  if (!activeRl) {
    activeRl = createInterface({ input: process.stdin, output: process.stdout });
  }
  return activeRl;
}

/** 收尾：关掉可能打开的 readline，否则进程会因 stdin 监听而挂住。 */
export function closeStdin(): void {
  if (activeRl) {
    activeRl.close();
    activeRl = null;
  }
}

/**
 * 把 Cloudflare / wrangler 的常见报错翻译成人话；认不出就原样返回。
 * 步骤里拿到 stderr 片段时先过这一遍，避免用户自己翻译英文 API 错误。
 */
export function humanizeCloudflareError(raw: string): string {
  const rules: [RegExp, string][] = [
    [
      /not authenticated|authentication error|unauthorized|token/i,
      "Cloudflare 授权失效或未登录——回到「Cloudflare 授权」步骤重新登录即可",
    ],
    [
      /email.{0,30}(not been )?verified|verify (your )?email/i,
      "Cloudflare 账号的邮箱还没验证——去注册邮箱里点验证邮件，完成后重试",
    ],
    [
      /quota|limit exceeded|exceeded/i,
      "超出免费额度限制——登录 dash.cloudflare.com 查看用量",
    ],
    [
      /ENOTFOUND|ETIMEDOUT|ECONNRESET|network|fetch failed/i,
      "网络异常——检查网络或代理后重试本步骤",
    ],
  ];
  for (const [re, message] of rules) {
    if (re.test(raw)) return message;
  }
  return raw;
}

export function makeContext(options: {
  root: string;
  state: SetupState;
  answers: Record<string, string>;
  logger: Logger;
  interactive: boolean;
}): SetupContext {
  const ctx: SetupContext = {
    root: options.root,
    state: options.state,
    answers: options.answers,
    interactive: options.interactive,
    logger: options.logger,
    emit: (name, payload) => options.logger.event(name, payload),
    saveState: () => saveState(options.root, options.state),

    ask: async (key, label, opts = {}) => {
      // 预填值允许是空串（可选字段用户明确留空），只有 undefined 才算没填；
      // 预填值同样要过 validate——WebUI/CLI 的 --answers 里乱填也得被拦下
      const preset = ctx.answers[key];
      if (preset !== undefined) {
        const verdict = opts.validate ? opts.validate(preset) : true;
        if (verdict === true) {
          ctx.logger.log(`${c.dim(label)}：${preset === "" ? "（留空）" : preset}`);
          return preset;
        }
        const message = `预填答案「${key}」不合法（当前值：${preset || "空"}）——${verdict}`;
        if (!ctx.interactive) throw new Error(message);
        ctx.logger.warn(message + "，请重新填写");
        // 交互模式：不返回，落到下面的正常提问流程
      }
      if (!ctx.interactive) {
        throw new Error(
          `非交互模式下缺少答案「${key}」，请用 --answers 预填后重试`,
        );
      }
      for (;;) {
        const suffix =
          opts.def !== undefined && opts.def !== ""
            ? c.dim(`（回车 = ${opts.def}）`)
            : "";
        const raw = (await ensureRl().question(`${label}${suffix}：`)).trim();
        const value = raw || opts.def || "";
        if (!value && opts.required) continue;
        if (value && opts.validate) {
          const verdict = opts.validate(value);
          if (verdict !== true) {
            ctx.logger.warn(verdict);
            continue;
          }
        }
        return value;
      }
    },

    confirm: async (key, label, def = true) => {
      const preset = ctx.answers[key];
      if (preset !== undefined) return !/^(n|no|false|0)$/i.test(preset.trim());
      if (!ctx.interactive) {
        throw new Error(
          `非交互模式下缺少确认「${key}」，请用 --answers 预填后重试`,
        );
      }
      const hint = c.dim(def ? "[Y/n]" : "[y/N]");
      const raw = (await ensureRl().question(`${label} ${hint}：`))
        .trim()
        .toLowerCase();
      if (!raw) return def;
      return !/^(n|no|false|0)$/.test(raw);
    },

    raw: async (label) => {
      if (!ctx.interactive) throw new Error("非交互模式不支持 raw 输入");
      return (await ensureRl().question(label)).trim();
    },

    run: (command, runOpts = {}) => {
      const res = spawnSync(command, {
        shell: true,
        cwd: ctx.root,
        encoding: "utf8",
        env: { ...process.env, ...runOpts.env },
        input: runOpts.input,
        stdio:
          runOpts.capture === false && runOpts.input === undefined
            ? "inherit"
            : "pipe",
      });
      return {
        code: res.status ?? 1,
        stdout: res.stdout ?? "",
        stderr: res.stderr ?? "",
      };
    },
  };
  return ctx;
}
