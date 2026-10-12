/**
 * pnpm run setup:ui —— 安装向导的 Web 图形界面（v1）。
 *
 * 设计：完全复用 v0 的步骤契约（scripts/setup/types.ts 的 SetupStep），
 * 这个文件只做三件事：
 * 1. 本地 HTTP 服务（仅绑定 127.0.0.1）托管单页向导；
 * 2. GET /api/events 用 SSE 把步骤事件流推给浏览器（等价于 CLI 的 --json）；
 * 3. POST /api/run 接收表单答案，塞进 answers 预填后按序执行步骤。
 *
 * 页面交互是逐步引导式：一次只显示一个步骤，完成才能进入下一步；
 * 步骤说明写给人看，执行仍走同一套 SetupStep。
 *
 * 步骤代码零改动——这正是 types.ts 里预留的 v1 接入方式：
 * 表单答案 → answers 预填 → interactive=false → 无交互执行。
 *
 * 安全边界：只监听回环地址、无任何对外接口；页面 JS 只和本机服务通信。
 * wrangler login 的浏览器 OAuth 仍由 wrangler 自己完成，凭据不经过本服务。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PROJECT_NAME,
  DIRTY_FILES_MESSAGE,
  dirtyOverlayFiles,
  loadState,
  makeContext,
  projectName,
  repoSlugFromUrl,
  saveState,
  slugifyId,
} from "./context";
import { cfAuth } from "./steps/cf-auth";
import { d1Init } from "./steps/d1-init";
import { deploy } from "./steps/deploy";
import { envCheck } from "./steps/env-check";
import { secrets } from "./steps/secrets";
import { siteConfig } from "./steps/site-config";
import type { Logger, SetupState, SetupStep } from "./types";

const STEPS: SetupStep[] = [envCheck, siteConfig, cfAuth, d1Init, secrets, deploy];

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
let state: SetupState = loadState(root);
let running = false;

// ---------------------------------------------------------------------------
// SSE 事件广播
// ---------------------------------------------------------------------------

const clients = new Set<ServerResponse>();

function emit(name: string, payload?: Record<string, unknown>): void {
  const line =
    "data: " +
    JSON.stringify({ event: name, ts: new Date().toISOString(), ...payload }) +
    "\n\n";
  for (const res of [...clients]) res.write(line);
}

// ---------------------------------------------------------------------------
// 步骤执行（与 CLI 编排器同构，只是把输出换成了 SSE）
// ---------------------------------------------------------------------------

async function probeAll(): Promise<Record<string, { status: string; detail?: string }>> {
  // probe 只读真实状态，不需要答案；静默 logger 避免 probe 内 log 干扰页面
  const probeCtx = makeContext({
    root,
    state,
    answers: {},
    logger: { log: () => {}, warn: () => {}, event: () => {} },
    interactive: false,
  });
  const probes: Record<string, { status: string; detail?: string }> = {};
  for (const step of STEPS) {
    try {
      probes[step.id] = await step.probe(probeCtx);
    } catch (error) {
      probes[step.id] = { status: "pending", detail: String(error) };
    }
  }
  return probes;
}

async function runFlow(options: { answers: Record<string, string>; only?: string }): Promise<void> {
  // running 已由 /api/run 在检查后同步置位（见路由处注释），这里只负责收尾
  try {
    await doRunFlow(options);
  } finally {
    running = false;
  }
}

async function doRunFlow(options: { answers: Record<string, string>; only?: string }): Promise<void> {
  state = loadState(root);
  // 表单答案合并进持久状态：既是本次运行的预填值，也是下次的默认值
  state.answers = { ...state.answers, ...options.answers };
  saveState(root, state);

  const logger: Logger = {
    log: (message) => emit("log", { message }),
    warn: (message) => emit("warn", { message }),
    event: (name, payload) => emit(name, payload),
  };
  const ctx = makeContext({
    root,
    state,
    answers: options.answers,
    logger,
    interactive: false,
  });

  const queue = options.only ? STEPS.filter((s) => s.id === options.only) : STEPS;
  // 全量运行时强制重跑「站点配置」（表单为准）和「部署」（一键的落点）；
  // 其余步骤 probe 已 done 就跳过。单步运行永远强制。
  const force = options.only ? [options.only] : ["site-config", "deploy"];

  emit("setup-start", { steps: STEPS.map((s) => s.id), only: options.only ?? null });

  // 预检：向导会覆盖的两个跟踪文件若已有未提交改动，先明示出来
  const dirty = dirtyOverlayFiles(ctx);
  if (dirty.length > 0) {
    emit("warn-dirty", { files: dirty });
    emit("warn", { message: DIRTY_FILES_MESSAGE });
  }

  let ok = true;
  for (const step of queue) {
    const probe = await step.probe(ctx);
    if (probe.status === "done" && !force.includes(step.id)) {
      emit("step-skip", { id: step.id, detail: probe.detail });
      continue;
    }
    emit("step-start", { id: step.id, detail: probe.detail });
    try {
      const result = await step.run(ctx);
      state.steps[step.id] = {
        status: "done",
        at: new Date().toISOString(),
        data: result.data,
      };
      saveState(root, state);
      emit("step-end", { id: step.id, detail: result.detail, data: result.data });
    } catch (error) {
      ok = false;
      const message = error instanceof Error ? error.message : String(error);
      emit("warn", { message });
      emit("step-error", { id: step.id, message });
      break;
    }
  }
  emit("setup-end", { ok });
}

// ---------------------------------------------------------------------------
// HTTP 路由
// ---------------------------------------------------------------------------

function json(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => (data += chunk.toString()));
    req.on("end", () => resolveBody(data));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(PAGE);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/state") {
      // 默认站点地址跟随项目名（有答案用答案，否则用 toml 现名）
      const projectSlug =
        slugifyId(state.answers.projectName ?? "") ||
        slugifyId(projectName(root));
      json(res, {
        answers: state.answers,
        hasSecrets: Boolean(state.secrets),
        defaultSiteUrl: `https://${projectSlug}.pages.dev`,
        // 项目名预填默认值：上次答案 > 自定义过的 toml 现名 > 按站点派生
        defaultProjectName:
          state.answers.projectName ||
          (projectName(root) !== DEFAULT_PROJECT_NAME
            ? projectName(root)
            : repoSlugFromUrl(state.answers.repo ?? "") || "my-blog"),
        // 页面刷新时若仍有步骤在跑，UI 据此进入「跟随运行」状态
        running,
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/probe") {
      json(res, { probes: await probeAll() });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(": connected\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/run") {
      // 检查与置位之间绝不能有 await：置位若推迟到 runFlow 内部，
      // 两个并发请求都会通过检查、各自启动一条完整安装流，
      // 并发改写 site.ts / wrangler.toml / state.json。
      if (running) {
        res.writeHead(409);
        res.end("已有任务在运行");
        return;
      }
      running = true;
      let body: { answers?: Record<string, string>; only?: string };
      try {
        body = JSON.parse((await readBody(req)) || "{}") as {
          answers?: Record<string, string>;
          only?: string;
        };
      } catch (error) {
        running = false; // 请求体解析失败也要释放，否则向导永久卡在「运行中」
        throw error;
      }
      void runFlow({ answers: body.answers ?? {}, only: body.only });
      res.writeHead(202, { "content-type": "application/json; charset=utf-8" });
      res.end('{"accepted":true}');
      return;
    }
    res.writeHead(404);
    res.end("not found");
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(error instanceof Error ? error.message : String(error));
  }
});

const args = process.argv.slice(2);
const portFlag = args.indexOf("--port");
const port = portFlag >= 0 ? Number(args[portFlag + 1]) : 4599;

// 只监听回环地址：这是本地工具，不是服务
server.listen(port, "127.0.0.1", () => {
  console.log(`FlowyBlog 安装向导（Web）已启动：http://127.0.0.1:${port}`);
  console.log("按 Ctrl+C 停止。");
});

// ---------------------------------------------------------------------------
// 单页向导（逐步引导式）。函数声明有提升，PAGE 在路由里使用没有时序问题。
// ---------------------------------------------------------------------------

const PAGE = renderPage();

/** 每一步面板的说明文案与操作按钮（写给人看的部分，与步骤实现解耦）。 */
function stepPanels(): string {
  return [
    {
      id: "env-check",
      desc:
        "<p>先确认这台电脑具备运行条件：Node.js 20+、pnpm，Git 建议有（直传部署用不到，" +
        "以后想「push 自动重新部署」需要它）。缺什么会直接告诉你怎么装。</p>",
      button: "开始检测",
    },
    {
      id: "site-config",
      desc:
        "<p>填写你的站点信息，向导会替你改写 <code>src/lib/site.ts</code>——" +
        "向导会动的仓库文件只有它和 <code>wrangler.toml</code>（数据库 ID），" +
        "fork 后提交这两个文件，仓库就变成你自己的站；" +
        "其余产物（<code>.dev.vars</code>、<code>.setup/</code>、<code>out/</code>）都在 .gitignore 里。</p>" +
        "<p><b>Pages 项目名</b>决定博客地址 <code>https://&lt;项目名&gt;.pages.dev</code>，" +
        "全网唯一（撞名发布失败），已按你的站点预填；<b>站点地址</b>是站点元数据" +
        "（sitemap、页脚、评论白名单），<b>不是部署目标</b>。" +
        "想用自有域名：先在 Cloudflare Pages 后台给项目绑定域名，再回来改站点地址。</p>",
      button: "保存并写入 site.ts",
    },
    {
      id: "cf-auth",
      desc:
        "<p>向导不碰你的密码：它调用 wrangler 打开浏览器，由你在 Cloudflare 官方页面完成登录。" +
        "没有账号？<a href='https://dash.cloudflare.com/sign-up' target='_blank' rel='noreferrer'>免费注册一个</a>" +
        "（需要邮箱验证）。登录态保存在本机，登录一次以后都会自动跳过这步。</p>" +
        "<p>如果浏览器没弹出来，去任务栏找一下，或复制控制台里的地址手动打开。</p>",
      button: "打开浏览器登录",
    },
    {
      id: "d1-init",
      desc:
        "<p>评论区数据存在 Cloudflare D1（免费额度内）。这一步会：创建数据库 → 把 ID 回填 " +
        "<code>wrangler.toml</code> → 建好表结构。全部操作可重复执行，中途失败重跑即可。</p>",
      button: "创建评论数据库",
    },
    {
      id: "secrets",
      desc:
        "<p>自动生成三把随机密钥（管理员口令、会话签名、IP 盐）写入 <code>.dev.vars</code>，" +
        "发布时会自动同步到线上。密钥明文不会显示在页面上——" +
        "<code>ADMIN_KEY</code> 是评论后台（/admin）的登录口令，记得自己去看这个文件。</p>",
      button: "生成密钥",
    },
    {
      id: "deploy",
      desc:
        "<p>最后一步：静态导出构建（一两分钟）→ 写入线上环境变量 → 上传到 Cloudflare Pages。" +
        "环境变量先于上传写入——Pages 按部署快照注入变量，顺序反了首个部署就拿不到密钥。" +
        "完成后博客地址形如 <code>https://&lt;项目名&gt;.pages.dev</code>。" +
        "以后写了新文章，回到这一步重新运行即可重新发布。</p>" +
        "<p>如果这个文件夹不是 git 仓库（比如直接下载的源码包），部署照样能用，" +
        "但 AGPL 要求向访客提供源码，而且以后无法获取框架更新——建议尽快 fork 并推送代码。</p>",
      button: "构建并发布",
    },
  ]
    .map(
      (p) =>
        '<section class="panel" id="panel-' +
        p.id +
        '">' +
        "<h2>" +
        STEPS.find((s) => s.id === p.id)!.title +
        "</h2>" +
        '<div class="desc">' +
        p.desc +
        "</div>" +
        (p.id === "site-config" ? siteFormHtml() : "") +
        '<div class="panel-nav">' +
        '<button class="btn ghost prev">← 上一步</button>' +
        '<span class="nav-right"><button class="btn action" data-step="' +
        p.id +
        '">' +
        p.button +
        '</button><button class="btn primary next" disabled>下一步 →</button>' +
        '<span class="next-hint" hidden>「下一步」在执行完本步骤后解锁；也可以点左侧步骤名自由查看</span></span>' +
        "</div>" +
        '<div class="stepmsg" id="msg-' +
        p.id +
        '"></div>' +
        "</section>",
    )
    .join("");
}

function siteFormHtml(): string {
  const fields = [
    { id: "siteName", label: "站名", ph: "例如：阿明的博客", required: true },
    { id: "author", label: "作者名", ph: "例如：阿明", required: true },
    { id: "description", label: "一句话简介", ph: "例如：记录技术、思考与生活", required: false },
    { id: "projectName", label: "Pages 项目名（决定博客地址，全网唯一；小写字母/数字/连字符）", ph: "例如：a-ming-blog", required: true },
    { id: "siteUrl", label: "站点地址（站点元数据：sitemap / 页脚 / 评论白名单用）", ph: "https://你的项目名.pages.dev", required: true },
    { id: "github", label: "GitHub 主页（可留空）", ph: "https://github.com/你的用户名", required: false },
    { id: "repo", label: "源码仓库地址（你 fork 后的仓库主页，页脚「源码」链接指向它）", ph: "https://github.com/你的用户名/你的仓库名（还没有就去 fork 本项目）", required: true },
  ];
  return (
    fields
      .map(
        (f) =>
          '<div class="field"><label>' +
          f.label +
          (f.required ? ' <em>*</em>' : "") +
          '</label><input id="' +
          f.id +
          '" placeholder="' +
          f.ph +
          '"' +
          (f.required ? " data-required" : "") +
          "></div>",
      )
      .join("") +
    '<label class="check"><input type="checkbox" id="cfLogin" checked> 允许打开浏览器完成 Cloudflare 登录</label>' +
    '<label class="check"><input type="checkbox" id="d1Create" checked> 允许在 Cloudflare 创建 D1 数据库（免费额度）</label>'
  );
}

function renderPage(): string {
  const railHtml = STEPS.map(
    (s, i) =>
      '<li class="step" id="step-' +
      s.id +
      '" data-index="' +
      i +
      '"><span class="dot"></span><span class="name">' +
      s.title +
      '</span><button class="rerun" data-step="' +
      s.id +
      '" title="重新执行这一步">↻</button></li>',
  ).join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FlowyBlog 安装向导</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #f7f7f8; --card: #ffffff; --muted: #6b7280; --text: #171717;
  --border: rgba(23,23,23,.12); --brand: #0f9d58; --brand-soft: #e5fff2;
  --brand-text: #065f34; --danger: #e8463a; --console: #101418;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #101014; --card: #1a1a20; --muted: #9ca3af; --text: #e5e7eb;
    --border: rgba(229,231,235,.14); --brand: #32f08c; --brand-soft: #0b3a24;
    --brand-text: #8ff5c0; --console: #0a0d10;
  }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 24px; background: var(--bg); color: var(--text);
  font: 14px/1.6 "SF Pro Text", "PingFang SC", system-ui, "Segoe UI", sans-serif; }
.wrap { max-width: 900px; margin: 0 auto; display: grid; gap: 16px; }
header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
h1 { font-size: 18px; margin: 0; }
h2 { font-size: 16px; margin: 0 0 10px; }
.sub { color: var(--muted); font-size: 12px; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
.layout { display: grid; grid-template-columns: 240px 1fr; gap: 16px; align-items: start; }
@media (max-width: 760px) { .layout { grid-template-columns: 1fr; } }
ul.rail { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
li.step { display: flex; align-items: center; gap: 8px; padding: 9px 10px;
  border: 1px solid var(--border); border-radius: 8px; cursor: pointer; }
li.step:hover { border-color: var(--brand); }
li.step.active { border-color: var(--brand); background: var(--brand-soft); }
.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--border); flex: none; }
li.done .dot { background: var(--brand); }
li.running .dot { background: var(--brand); animation: pulse 1s infinite alternate; }
li.failed .dot { background: var(--danger); }
li.skipped .dot { background: var(--muted); }
li.running { border-color: var(--brand); }
@keyframes pulse { from { opacity: .35; } to { opacity: 1; } }
.name { flex: 1; min-width: 0; }
.rerun { border: 1px solid var(--border); background: transparent; color: var(--muted);
  border-radius: 6px; width: 24px; height: 22px; cursor: pointer; font-size: 11px; }
.rerun:hover { color: var(--brand-text); border-color: var(--brand); }
.desc { color: var(--muted); font-size: 13px; }
.desc p { margin: 0 0 10px; }
.desc code { font: 12px ui-monospace, Consolas, monospace; background: var(--bg);
  border: 1px solid var(--border); border-radius: 4px; padding: 0 4px; }
.desc a { color: var(--brand-text); }
.panel { display: none; }
.panel.active { display: block; }
.field { display: grid; gap: 4px; margin-bottom: 12px; }
.field label { font-size: 12px; color: var(--muted); }
.field label em { color: var(--danger); font-style: normal; }
.field input { padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px;
  background: transparent; color: var(--text); font: inherit; width: 100%; }
.field input:focus { outline: none; border-color: var(--brand); }
.check { display: flex; align-items: center; gap: 8px; margin: 8px 0; font-size: 13px; }
.panel-nav { display: flex; justify-content: space-between; gap: 10px; margin-top: 16px; }
.nav-right { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.next-hint { color: var(--muted); font-size: 12px; }
.btn { border: 1px solid var(--border); background: transparent; color: var(--text);
  border-radius: 8px; padding: 9px 18px; font-size: 14px; cursor: pointer; }
.btn:hover { border-color: var(--brand); }
.btn.primary { background: var(--brand); border-color: var(--brand); color: #06240f; font-weight: 600; }
.btn:disabled { opacity: .45; cursor: default; }
.btn:disabled:hover { border-color: var(--border); }
.btn.primary:disabled:hover { border-color: var(--brand); }
.stepmsg { margin-top: 12px; font-size: 13px; display: none; }
.stepmsg.run { display: block; color: var(--muted); }
.stepmsg.ok { display: block; color: var(--brand-text); }
.stepmsg.err { display: block; color: var(--danger); }
.rerun:disabled { opacity: .35; cursor: default; }
.rerun:disabled:hover { color: var(--muted); border-color: var(--border); }
.console { background: var(--console); color: #c8d2da; border-radius: 12px; padding: 12px 16px;
  font: 12px/1.7 ui-monospace, Consolas, monospace; height: 170px; overflow-y: auto; white-space: pre-wrap; }
.console .w { color: #fbbf24; } .console .e { color: #f87171; } .console .ok { color: #34d399; }
.console .dim { color: #64748b; }
.banner { display: none; background: var(--brand-soft); color: var(--brand-text);
  border: 1px solid var(--brand); border-radius: 12px; padding: 14px 16px; }
.banner a { color: inherit; font-weight: 600; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>FlowyBlog 安装向导</h1>
    <span class="sub" id="status">正在读取状态…</span>
  </header>
  <div class="banner" id="banner"></div>
  <div class="layout">
    <div class="card">
      <ul class="rail" id="rail">${railHtml}</ul>
      <p class="sub" style="margin:12px 0 0">↻ 可随时重新执行某一步；点击步骤名可来回查看。<br>
        任何时候关掉页面或退出都不怕——重开后从已完成的地方继续，已完成的步骤自动跳过。</p>
    </div>
    <div class="card" id="panels">${stepPanels()}</div>
  </div>
  <div class="console" id="console"><span class="dim">— 事件日志（历史不保留，重跑步骤可重现）—</span>
</div>
</div>
<script>
(function () {
  var STEPS = ${JSON.stringify(STEPS.map((s) => ({ id: s.id, title: s.title })))};
  var statuses = {};   // id -> { status, detail }
  var current = 0;
  var es = null;
  var uiRunning = false;
  var defaultSiteUrl = "";
  var statusEl = document.getElementById("status");
  var consoleEl = document.getElementById("console");

  function logLine(cls, text) {
    var span = document.createElement("span");
    span.className = cls || "";
    span.textContent = text + "\\n";
    consoleEl.appendChild(span);
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  function stepTitle(id) {
    for (var i = 0; i < STEPS.length; i++) if (STEPS[i].id === id) return STEPS[i].title;
    return id;
  }

  function setStatus(id, status, detail) {
    statuses[id] = { status: status, detail: detail || statuses[id] && statuses[id].detail };
    var li = document.getElementById("step-" + id);
    if (li) li.className = "step " + (li.getAttribute("data-index") == current ? "active " : "") + status;
    if (detail) li.title = detail;
    var panel = document.getElementById("panel-" + id);
    var next = panel ? panel.querySelector(".next") : null;
    if (next) next.disabled = !(status === "done" || status === "skipped");
    // 未完成时亮出解锁规则，完成即隐藏，避免按钮像坏了
    var hint = panel ? panel.querySelector(".next-hint") : null;
    if (hint) hint.hidden = next ? !next.disabled : true;
    var msg = document.getElementById("msg-" + id);
    if (msg && status === "running") {
      msg.className = "stepmsg run";
      msg.textContent = "正在执行，请稍候…（详细输出见下方日志）";
    }
    if (msg && status === "failed") {
      msg.className = "stepmsg err";
      msg.textContent = "✗ " + (detail || "执行失败，修复后可重跑本步骤");
    }
    if (msg && status === "done") {
      msg.className = "stepmsg ok";
      msg.textContent = "✓ 本步完成" + (detail ? "：" + detail : "");
    }
  }

  function showPanel(i) {
    current = Math.max(0, Math.min(STEPS.length - 1, i));
    Array.prototype.forEach.call(document.querySelectorAll(".panel"), function (p, idx) {
      p.classList.toggle("active", idx === current);
    });
    Array.prototype.forEach.call(document.querySelectorAll("#rail .step"), function (li, idx) {
      var id = STEPS[idx].id;
      var st = (statuses[id] && statuses[id].status) || "pending";
      li.className = "step " + (idx === current ? "active " : "") + st;
    });
  }

  function refreshProbes() {
    return fetch("/api/probe").then(function (r) { return r.json(); }).then(function (d) {
      Object.keys(d.probes).forEach(function (id) {
        var p = d.probes[id];
        if (statuses[id] && statuses[id].status === "running") return; // 运行中的以事件为准
        setStatus(id, p.status === "done" ? "done" : "pending", p.detail);
      });
      return d;
    });
  }

  // 运行态：禁掉所有可触发执行的按钮，防止重复点击 / 并发运行
  function setUiRunning(on) {
    uiRunning = on;
    Array.prototype.forEach.call(document.querySelectorAll(".action, .rerun"), function (b) {
      b.disabled = on;
    });
  }

  function restoreButtons() {
    Array.prototype.forEach.call(document.querySelectorAll(".action"), function (b) {
      var orig = b.getAttribute("data-orig");
      if (orig) { b.textContent = orig; b.removeAttribute("data-orig"); }
    });
    setUiRunning(false);
  }

  function ensureSSE() {
    if (es) return;
    es = new EventSource("/api/events");
    es.onerror = function () {
      logLine("w", "与本地服务的连接断开，正在重连…（若向导进程已关闭，重新运行 pnpm run setup:ui 后刷新本页）");
    };
    es.onmessage = function (ev) {
      var data;
      try { data = JSON.parse(ev.data); } catch (e) { return; }
      switch (data.event) {
        case "setup-start":
          setUiRunning(true);
          statusEl.textContent = "运行中…";
          break;
        case "step-start":
          setStatus(data.id, "running");
          logLine("", "▸ " + stepTitle(data.id) + (data.detail ? "（" + data.detail + "）" : ""));
          break;
        case "step-end":
          setStatus(data.id, "done", data.detail);
          logLine("ok", "✓ " + stepTitle(data.id) + (data.detail ? " —— " + data.detail : ""));
          if (data.data && data.data.url) showBanner(data.data.url);
          restoreButtons();
          // 自动顺延到下一步；用户若已点到别的面板（current 变了）则不打扰
          if (data.id === STEPS[current].id && data.id !== "deploy") {
            setTimeout(function () {
              if ((statuses[STEPS[current].id] || {}).status === "done") showPanel(current + 1);
            }, 900);
          }
          break;
        case "step-skip":
          setStatus(data.id, "skipped", data.detail);
          logLine("dim", "· 跳过 " + stepTitle(data.id) + (data.detail ? "（" + data.detail + "）" : ""));
          break;
        case "step-error":
          setStatus(data.id, "failed", data.message);
          logLine("e", "✗ " + stepTitle(data.id) + "：" + data.message);
          restoreButtons();
          break;
        case "log":
          logLine("", data.message);
          break;
        case "warn":
          logLine("w", "! " + data.message);
          break;
        case "setup-end":
          restoreButtons();
          statusEl.textContent = data.ok ? "运行完成" : "已中止（修复后重跑即可）";
          logLine(data.ok ? "ok" : "e", data.ok ? "—— 完成 ——" : "—— 中止 ——");
          refreshProbes();
          break;
      }
    };
  }

  function showBanner(url) {
    var b = document.getElementById("banner");
    b.style.display = "block";
    b.innerHTML = "博客已上线：<a href='" + url + "' target='_blank' rel='noreferrer'>" + url + "</a>" +
      "（评论环境变量已随本次部署一起生效；评论区没出现的话等几十秒刷新）";
  }

  function collectAnswers() {
    var ids = ["siteName", "author", "description", "projectName", "siteUrl", "github", "repo"];
    var answers = {};
    ids.forEach(function (id) { answers[id] = document.getElementById(id).value.trim(); });
    answers.cfLogin = document.getElementById("cfLogin").checked ? "y" : "n";
    answers.d1Create = document.getElementById("d1Create").checked ? "y" : "n";
    return answers;
  }

  function startRun(stepId) {
    if (uiRunning) return;
    var msg = document.getElementById("msg-" + stepId);
    function fail(text) {
      if (msg) { msg.className = "stepmsg err"; msg.textContent = text; }
    }
    if (msg) { msg.className = "stepmsg"; msg.textContent = ""; }
    // 乱填兜底：提交前把明显不合法的输入拦在页面内，给一句能听懂的提示
    var answers = collectAnswers();
    if (stepId === "site-config") {
      var urlRe = /^https?:\\/\\/\\S+$/i;
      var pn = (answers.projectName || "").toLowerCase()
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      if (answers.siteName.length < 2) return fail("站名至少 2 个字符——起个像样的名字吧。");
      if (!answers.author) return fail("请填写作者名（会出现在页脚和关于页）。");
      if (pn.length < 3 || pn.length > 30 || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(pn)) {
        return fail("Pages 项目名需 3-30 位小写字母、数字、连字符——它决定你的博客地址，全网唯一。");
      }
      if (!urlRe.test(answers.siteUrl)) return fail("站点地址要以 http(s):// 开头，例如 https://" + pn + ".pages.dev");
      if (answers.github && !urlRe.test(answers.github)) return fail("GitHub 主页要以 http(s):// 开头，没有就留空。");
      if (!urlRe.test(answers.repo)) return fail("源码仓库地址要以 http(s):// 开头，例如 https://github.com/你的用户名/你的仓库名。");
    }
    consoleEl.innerHTML = "";
    logLine("dim", "—— 开始：" + stepTitle(stepId) + " ——");
    ensureSSE();
    setUiRunning(true);
    statusEl.textContent = "运行中…";
    var btn = document.querySelector('.action[data-step="' + stepId + '"]');
    if (btn) { btn.setAttribute("data-orig", btn.textContent); btn.textContent = "执行中…"; }
    fetch("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: answers, only: stepId })
    }).then(function (r) {
      if (r.status === 409) {
        restoreButtons();
        fail("已有任务正在运行，请等它结束再点。");
        statusEl.textContent = "就绪";
      }
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll(".action"), function (btn) {
    btn.addEventListener("click", function () { startRun(btn.getAttribute("data-step")); });
  });
  Array.prototype.forEach.call(document.querySelectorAll(".rerun"), function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var id = btn.getAttribute("data-step");
      for (var i = 0; i < STEPS.length; i++) if (STEPS[i].id === id) showPanel(i);
      startRun(id);
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll(".panel"), function (panel, idx) {
    panel.querySelector(".prev").addEventListener("click", function () { showPanel(idx - 1); });
    panel.querySelector(".next").addEventListener("click", function () { showPanel(idx + 1); });
  });
  Array.prototype.forEach.call(document.querySelectorAll("#rail .step"), function (li, idx) {
    li.addEventListener("click", function () { showPanel(idx); });
  });

  // 页面加载即接上事件流：刷新页面后正在跑的任务日志能自动恢复
  ensureSSE();
  fetch("/api/state").then(function (r) { return r.json(); }).then(function (d) {
    defaultSiteUrl = d.defaultSiteUrl || "";
    Object.keys(d.answers).forEach(function (key) {
      var input = document.getElementById(key);
      if (input && input.type === "checkbox") input.checked = !/^(n|no|false|0)$/i.test(d.answers[key]);
      else if (input) input.value = d.answers[key];
    });
    // 没填过的项目名和站点地址都按站点预填默认值
    var pn = document.getElementById("projectName");
    if (pn && !pn.value && d.defaultProjectName) pn.value = d.defaultProjectName;
    var su = document.getElementById("siteUrl");
    if (su && !su.value && defaultSiteUrl) su.value = defaultSiteUrl;
    if (d.running) {
      setUiRunning(true);
      statusEl.textContent = "上一次执行仍在进行中，请稍候（日志会自动接上）…";
      logLine("w", "页面刷新时仍有任务在运行，事件流已重新接上。");
    }
    return refreshProbes();
  }).then(function () {
    // 引导起点：第一个未完成的步骤；全完成则停在最后一步
    var first = STEPS.length - 1;
    for (var i = 0; i < STEPS.length; i++) {
      var st = (statuses[STEPS[i].id] || {}).status;
      if (st !== "done" && st !== "skipped") { first = i; break; }
    }
    showPanel(first);
    if (!uiRunning) statusEl.textContent = "就绪";
  });
})();
</script>
</body>
</html>`;
}
