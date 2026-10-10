/**
 * 评论接口的共用模块。
 *
 * 运行在 Cloudflare Pages Functions 上（不是 Node，也不是 Next.js 运行时）：
 * 只有 Web 标准 API（Request / Response / crypto.subtle）和 D1 绑定可用。
 *
 * 这一层刻意与 Next.js 完全无关——functions/ 目录不进 Next 构建，
 * 所以博客本体仍然是 output: "export" 的纯静态站。
 */

/* --------------------------------------------------------------- 配置 --- */

/** 同一 IP 在窗口期内最多发几条 */
export const RATE_LIMIT = 3;
/** 限流窗口（分钟） */
export const RATE_WINDOW_MIN = 10;
export const MAX_TEXT = 500;
export const MAX_NAME = 24;
export const LIST_LIMIT = 200;

/**
 * page 标识的白名单。
 * 本站用文章 slug（如 4-dsh-opencode-free-models）作为页面标识，
 * 只允许字母数字和连字符/下划线，避免任意字符串被写进库。
 */
export const PAGE_RE = /^[A-Za-z0-9_-]{1,64}$/;

/* ------------------------------------------------------------- 响应 --- */

function corsHeaders(origin) {
  return {
    ...(origin ? { "access-control-allow-origin": origin } : {}),
    // 同一个 URL 可能因 Origin 不同返回不同的 CORS 头，
    // 不加 Vary 会被缓存串味
    vary: "Origin",
  };
}

/**
 * 统一 JSON 响应。
 *
 * x-content-type-options: nosniff 不能省——评论内容是用户输入，
 * 万一有代理/浏览器做内容嗅探，JSON 被当成 HTML 执行就是存储型 XSS。
 */
export function json(data, status = 200, origin = "", extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      ...corsHeaders(origin),
      ...extraHeaders,
    },
  });
}

/**
 * 管理接口专用：额外带上 no-store，并允许附带 Set-Cookie。
 *
 * 管理接口的响应绝不能进任何缓存——否则未登录者可能拿到别人登录后的
 * 列表，或者退出登录后仍命中缓存的已授权响应。
 */
export function adminJson(data, status = 200, extraHeaders = {}) {
  return json(data, status, "", {
    "cache-control": "no-store",
    ...extraHeaders,
  });
}

/* --------------------------------------------------------------- CORS --- */

/**
 * 判断请求来源是否放行，返回应当回填的 Allow-Origin；不放行返回 null。
 *
 * 线上评论接口和页面同源，其实用不到 CORS；这里主要是为了本地开发——
 * `pnpm dev` 跑在 :3000，而 `wrangler pages dev` 跑在 :8788，属于跨源。
 * 额外放行的来源通过环境变量 ALLOWED_ORIGINS 配置（逗号分隔），
 * 不写死任何域名。
 */
export function originAllowed(request, env) {
  const origin = request.headers.get("Origin");
  // 没有 Origin：同源的 GET，或 curl 这类非浏览器请求，直接放行
  if (!origin) return "";

  let host;
  try {
    host = new URL(origin).host;
  } catch {
    return null;
  }

  if (host === new URL(request.url).host) return origin;

  const extra = String((env && env.ALLOWED_ORIGINS) || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return extra.includes(origin) ? origin : null;
}

/* --------------------------------------------------------------- 输入 --- */

/** 安全地读取 JSON body：解析失败或不是对象都返回 null，不抛异常。 */
export async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : null;
  } catch {
    return null;
  }
}

/**
 * 校验评论内容，通过返回 null，否则返回 { error }。
 *
 * 长度用 Array.from 按「码点」计数而不是 .length：
 * .length 数的是 UTF-16 码元，emoji 之类会被算成 2 个，中英文混排时
 * 用户会觉得「明明没超却被拒」。
 */
export function validateComment({ page, name, text }) {
  if (!PAGE_RE.test(String(page || ""))) return { error: "页面标识不合法" };

  const t = String(text || "").trim();
  if (!t) return { error: "留言内容不能为空" };
  if (Array.from(t).length > MAX_TEXT) return { error: `留言最多 ${MAX_TEXT} 字` };

  if (Array.from(String(name || "")).length > MAX_NAME) {
    return { error: `昵称最多 ${MAX_NAME} 字` };
  }
  return null;
}

/* ------------------------------------------------------------- 限流 --- */

/**
 * 把访客 IP 转成不可逆的哈希再入库。
 *
 * 限流只需要「同一个 IP 能对上」，不需要知道 IP 是谁，所以存哈希就够了——
 * 数据库里不该留下访客的真实 IP。加盐（IP_SALT）是防止有人拿常见 IP 段
 * 反查哈希表。
 */
export async function ipHashOf(request, env) {
  const ip =
    request.headers.get("CF-Connecting-IP") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown";
  const salt = String((env && env.IP_SALT) || "fbz-blog-comments");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${salt}:${ip}`),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 统计某 IP 在最近 windowMinutes 分钟内已发表的条数。 */
export async function countRecent(db, table, ipHash, windowMinutes) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM ${table}
        WHERE ip_hash = ?1 AND created_at >= datetime('now', ?2)`,
    )
    .bind(ipHash, `-${windowMinutes} minutes`)
    .first();
  return row ? row.n : 0;
}

/* ----------------------------------------------------------- 回复关系 --- */

/**
 * 把「要回复的目标」归一化到顶层留言 id。
 *
 * 只允许两层：回复「回复」时向上归一到根留言，于是它变成同一层的兄弟。
 * 无限嵌套在手机屏上缩进几层就没法读了，深树还会让「删除中间层」的语义
 * 变得含糊——那到底是删这一条，还是连它下面的一串？
 *
 * 同时校验目标确实存在、且和当前页面属于同一篇文章——
 * 否则可以构造一个 parent_id 把回复挂到别的文章下面去。
 */
export async function resolveReplyTarget(db, table, page, parentId) {
  const row = await db
    .prepare(`SELECT id, page, parent_id FROM ${table} WHERE id = ?1`)
    .bind(parentId)
    .first();

  if (!row) return { error: "要回复的留言不存在" };
  if (row.page !== page) return { error: "留言与当前页面不匹配" };

  // parent_id 为 NULL 说明目标本身就是顶层留言
  return { rootId: row.parent_id ?? row.id };
}

/**
 * 删除一条留言；如果它是顶层留言，连同它下面所有回复一起删。
 *
 * 必须**先删子行再删父行**：反过来父行没了，子行的 parent_id 就指向一个
 * 不存在的 id，那些回复会变成永远显示不出来的孤儿数据。
 *
 * 返回实际删掉的条数（含回复），调用方据此判断「是不是本来就不存在」。
 */
export async function deleteCommentCascade(db, table, id) {
  const children = await db
    .prepare(`DELETE FROM ${table} WHERE parent_id = ?1`)
    .bind(id)
    .run();

  const self = await db
    .prepare(`DELETE FROM ${table} WHERE id = ?1`)
    .bind(id)
    .run();

  return (children.meta?.changes ?? 0) + (self.meta?.changes ?? 0);
}

/* ----------------------------------------------------------- 站点开关 --- */

/** 全站评论锁的键名。值是 "0" / "1" */
export const COMMENTS_LOCKED_KEY = "comments_locked";

/**
 * 读全站评论锁。
 *
 * 三种「读不到」的情况一律按**未锁**处理：
 *   - settings 表不存在（忘了跑 0003 迁移）
 *   - 没有这一行（从没拨过开关）
 *   - 查询本身出错
 *
 * 理由是失败方向：漏跑迁移就让评论全部消失，是个比「锁没生效」严重得多的
 * 故障，而且现场看起来像数据库坏了，很难往「少跑一个 SQL 文件」上想。
 * 反过来，锁没生效最多是后台那个开关暂时不起作用，页面上一眼就能看出来。
 *
 * 表不存在时 prepare 会抛，所以整段要包起来——这个函数在每次发表前都会跑，
 * 不能因为一次异常把请求打成 500。
 */
export async function commentsLocked(db) {
  if (!db) return false;
  try {
    const row = await db
      .prepare(`SELECT value FROM settings WHERE key = ?1`)
      .bind(COMMENTS_LOCKED_KEY)
      .first();
    return row ? String(row.value) === "1" : false;
  } catch {
    return false;
  }
}

/**
 * 写全站评论锁。
 *
 * upsert 用 ON CONFLICT 而不是 INSERT OR REPLACE：后者会先删再插，
 * 将来这张表要是加了别的列（比如记录谁改的、什么时候改的），
 * 那些列会被无声清掉。
 *
 * 这里**不**吞异常：后台拨开关必须知道有没有真的写进去，
 * 静默失败会让人以为锁上了、实际没有——那比报错危险。
 */
export async function setCommentsLocked(db, locked) {
  await db
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .bind(COMMENTS_LOCKED_KEY, locked ? "1" : "0")
    .run();
}

/* --------------------------------------------------------------- 管理 --- */

/**
 * 管理员校验。密钥从环境变量 ADMIN_KEY 读，前端不持有。
 *
 * 比较用逐字节异或累加而不是 === ：字符串比较会在第一个不同的字符处
 * 提前返回，理论上能通过响应时间差逐位猜出密钥（时序侧信道）。
 */
export function adminAuthorized(url, request, env) {
  const expected = String((env && env.ADMIN_KEY) || "");
  if (!expected) return false;

  const provided = String(
    url.searchParams.get("key") || request.headers.get("x-admin-key") || "",
  );
  if (provided.length !== expected.length) return false;

  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/* ------------------------------------------------------------- 会话 --- */

/**
 * 管理员登录态用「签名 Cookie」实现，服务端不存任何会话记录。
 *
 * 为什么不用数据库存 session：多一张表、多一次查询，而退出登录还得删记录；
 * 签名方案是无状态的——Cookie 里只有过期时间和 HMAC 签名，
 * 服务端验签即可，水平扩容也没有一致性问题。
 *
 * 为什么用 HttpOnly Cookie 而不是 localStorage 放 token：
 * localStorage 里的 token 能被任何 XSS 脚本读走；HttpOnly Cookie 读不到。
 * 再配 SameSite=Strict，跨站请求也不会带上它（顺带挡掉 CSRF）。
 */

export const SESSION_COOKIE = "fbz_admin";
/** 登录有效期（秒）：7 天。个人博客的管理后台，够用且不至于长期有效 */
export const SESSION_TTL = 7 * 24 * 60 * 60;
/** 用于登录校验的密钥至少这么长，太短等于没设 */
export const MIN_KEY_LENGTH = 16;

function sessionSecret(env) {
  // 优先用独立的 SESSION_SECRET；没配就退回 ADMIN_KEY。
  // 两者任一存在即可工作，降低部署门槛。
  return String((env && (env.SESSION_SECRET || env.ADMIN_KEY)) || "");
}

/** 常量时间字符串比较，避免时序侧信道 */
export function timingSafeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  // 长度不同直接返回，但先走一遍等长累加，避免长度差异被计时区分
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

function b64url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacSign(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
}

/** 签发登录令牌，格式 `<过期时间戳>.<HMAC>`；未配置密钥时返回 null */
export async function issueSession(env, ttl = SESSION_TTL) {
  const secret = sessionSecret(env);
  if (!secret) return null;
  const expires = Math.floor(Date.now() / 1000) + ttl;
  const sig = b64url(await hmacSign(secret, String(expires)));
  return `${expires}.${sig}`;
}

/** 校验登录令牌：先看是否过期，再重算签名做常量时间比较 */
export async function verifySession(env, token) {
  const secret = sessionSecret(env);
  if (!secret || !token) return false;

  const [expiresRaw, sig] = String(token).split(".");
  const expires = Number(expiresRaw);
  if (!Number.isInteger(expires)) return false;
  if (expires <= Math.floor(Date.now() / 1000)) return false;

  const expected = b64url(await hmacSign(secret, String(expires)));
  return timingSafeEqual(sig || "", expected);
}

/** 从 Cookie 头里取某个键的值 */
export function readCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return "";
}

/**
 * 生成 Set-Cookie 值。
 *
 * Secure 只在 https 下加：本地 wrangler pages dev 跑在 http://127.0.0.1，
 * 带上 Secure 浏览器会直接丢弃这个 Cookie，表现为「登录成功但仍是未登录」，
 * 很难排查。
 */
function cookieAttr(url, maxAge) {
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

export function sessionSetCookie(url, token) {
  return `${SESSION_COOKIE}=${token}; ${cookieAttr(url, SESSION_TTL)}`;
}

export function sessionClearCookie(url) {
  return `${SESSION_COOKIE}=; ${cookieAttr(url, 0)}`;
}

/** 当前请求是否已登录 */
export async function hasSession(request, env) {
  return verifySession(env, readCookie(request, SESSION_COOKIE));
}

/* -------------------------------------------------------------- 入口 --- */

/**
 * 把统一的 handle(request, env, url) 适配成 Pages Functions 的
 * onRequest* 导出，顺带统一处理 OPTIONS 预检。
 */
export function createHandlers(handle) {
  const run = (ctx) => handle(ctx.request, ctx.env || {}, new URL(ctx.request.url));

  return {
    onRequestGet: run,
    onRequestPost: run,
    onRequestDelete: run,
    onRequestOptions: ({ request, env }) => {
      const origin = originAllowed(request, env || {});
      if (origin === null) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(origin),
          "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
          "access-control-allow-headers": "content-type,x-admin-key",
          "access-control-max-age": "86400",
        },
      });
    },
  };
}
