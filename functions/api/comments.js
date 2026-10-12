/**
 * 评论接口（Cloudflare Pages Functions + D1）
 *
 *   GET    /api/comments?page=<slug>                         列出某篇文章的评论
 *   POST   /api/comments   { page, name, text, parent_id? }  发表评论或回复
 *
 * 全站评论锁（后台 /admin 可拨）打开时，GET 照常返回列表、只多带一个
 * locked 标记，POST 一律 403。已有留言仍然可读——锁的是「不接受新评论」，
 * 不是把评论区整块藏起来。
 *
 * 审核模式（后台 /admin 可拨）打开时，访客新评论以 approved = 0 入库，
 * GET 只返回 approved = 1 的评论；管理员在后台「待审核」页通过后才可见。
 * 带管理员登录态的 POST 豁免审核——博主不用审核自己发的回复。
 *
 * 管理员删除留言走 /api/admin/comments（登录态鉴权），本接口不暴露
 * 任何管理通道——管理密钥出现在 URL 里有日志泄漏风险。
 *
 * 设计取舍：
 * - 不做登录。个人博客的评论用「匿名 + 昵称 + 限流」就够了，
 *   引入账号体系会让九成想留言的人直接放弃。
 * - 昵称可选，留空记作「路人」。
 * - 只存 IP 的哈希，不存原始 IP（见 _lib/api.js 的 ipHashOf）。
 * - 回复只做两层，见 _lib/api.js 的 resolveReplyTarget。
 */

import {
  commentsLocked,
  commentsModeration,
  countRecent,
  createHandlers,
  hasSession,
  ipHashOf,
  json,
  LIST_LIMIT,
  originAllowed,
  PAGE_RE,
  RATE_LIMIT,
  RATE_WINDOW_MIN,
  readJson,
  resolveReplyTarget,
  validateComment,
} from "../_lib/api.js";

const TABLE = "comments";

async function handle(request, env, url) {
  const origin = originAllowed(request, env);
  if (origin === null) return json({ error: "来源不允许" }, 403);

  // D1 绑定缺失时给出明确提示，而不是让 prepare 抛一个看不懂的错误。
  // 最常见的原因是忘了在 Pages 项目里配 D1 绑定。
  if (!env.DB) {
    return json({ error: "评论服务未配置数据库（缺少 D1 绑定 DB）" }, 503, origin);
  }

  /* ------------------------------------------------------------ 列表 --- */
  if (request.method === "GET") {
    const page = url.searchParams.get("page") || "";
    if (!PAGE_RE.test(page)) return json({ error: "页面标识不合法" }, 400, origin);

    // created_at 统一在 SQL 里转成 ISO 8601（带 T 和 Z），
    // 免得前端还要猜 SQLite datetime() 的 "YYYY-MM-DD HH:MM:SS" 是哪个时区。
    //
    // admin_badge 对外可读、不可写：访客界面靠它渲染金色徽标，
    // 而写入只走管理接口（PATCH /api/admin/comments）。
    // 下面的 INSERT 刻意不列这一列——新留言永远是 0，请求体伪造不了。
    //
    // approved = 1：审核模式下待审的评论（approved = 0）对外不可见，
    // 只在后台待审核页（/api/admin/comments?status=pending）里出现。
    const res = await env.DB.prepare(
      `SELECT id, parent_id, name, text, admin_badge,
              strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at
         FROM ${TABLE}
        WHERE page = ?1 AND approved = 1
        ORDER BY id DESC
        LIMIT ${LIST_LIMIT}`,
    )
      .bind(page)
      .all();

    /*
      列表和锁状态一起返回，前端不用多发一个请求去问「现在能留言吗」。

      形状从「裸数组」变成 { items, locked }，所以前端那边要同步改；
      它已经有「返回的不是数组就报错」的兜底，不会因为结构变了白屏。

      no-store：这个响应现在带运行时状态（锁），不能让任何一层缓存把它
      定住——否则后台刚锁上，访客看到的还是「可以留言」。
    */
    const locked = await commentsLocked(env.DB);
    return json(
      { items: res.results || [], locked },
      200,
      origin,
      { "cache-control": "no-store" },
    );
  }

  /* ------------------------------------------------------------ 发表 --- */
  if (request.method === "POST") {
    /*
      锁的检查放在最前面，先于一切校验和写库。

      这是**唯一的强制点**——前端隐藏表单只是体验，绕过界面直接 POST 才是
      真实威胁，所以必须在服务端挡。
    */
    if (await commentsLocked(env.DB)) {
      return json({ error: "博主已暂停接受新评论", locked: true }, 403, origin);
    }

    const body = await readJson(request);
    if (!body) return json({ error: "请求格式不对" }, 400, origin);

    const page = String(body.page || "");
    const name = String(body.name || "").trim() || "路人";
    const text = String(body.text || "").trim();

    const bad = validateComment({ page, name, text });
    if (bad) return json(bad, 400, origin);

    // parent_id 可选：不传就是顶层留言
    let parentId = null;
    if (body.parent_id !== undefined && body.parent_id !== null) {
      const raw = Number(body.parent_id);
      if (!Number.isInteger(raw) || raw <= 0) {
        return json({ error: "回复目标不合法" }, 400, origin);
      }
      const target = await resolveReplyTarget(env.DB, TABLE, page, raw);
      if (target.error) return json({ error: target.error }, 400, origin);
      parentId = target.rootId;
    }

    const ipHash = await ipHashOf(request, env);
    if (!ipHash) {
      // 没盐就没法算不可逆哈希，宁可拒绝发表也不退回公开默认盐
      return json({ error: "服务端未配置 IP_SALT，暂时无法发表评论" }, 503, origin);
    }

    const recent = await countRecent(env.DB, TABLE, ipHash, RATE_WINDOW_MIN);
    if (recent >= RATE_LIMIT) {
      return json(
        { error: `${RATE_WINDOW_MIN} 分钟内最多发 ${RATE_LIMIT} 条，歇一会儿再来` },
        429,
        origin,
      );
    }

    /*
      审核模式：开启后访客的新评论以 approved = 0 入库，
      在后台「待审核」页通过之前对外不可见。

      管理员登录态豁免：博主在文章页回复自己的评论不该被自己审核，
      所以带有效会话的请求直接 approved = 1。hasSession 是纯 HMAC 验签、
      不查库，代价可忽略；验不过就按访客处理，不影响任何现有行为。
    */
    const isAdmin = await hasSession(request, env);
    const moderated = !isAdmin && (await commentsModeration(env.DB));

    await env.DB.prepare(
      `INSERT INTO ${TABLE} (page, parent_id, name, text, ip_hash, approved)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
      .bind(page, parentId, name, text, ipHash, moderated ? 0 : 1)
      .run();

    // pending 回给前端：审核模式下提示「已提交，等待审核」，
    // 而不是「留言成功」——否则访客会疑惑「发成功了怎么看不到」。
    return json({ ok: true, pending: moderated }, 200, origin);
  }

  return json({ error: "不支持的请求方法" }, 405, origin);
}

export const { onRequestGet, onRequestPost, onRequestOptions } =
  createHandlers(handle);
