/**
 * 管理后台的数据接口。
 *
 *   GET    /api/admin/comments?limit=&offset=&q=&page=   列出留言（含总数）
 *   PATCH  /api/admin/comments   { id, admin_badge }     开关某条的管理员徽标
 *   DELETE /api/admin/comments?id=<id>                    删除单条（级联删回复）
 *
 * 与面向访客的 /api/comments 分开：
 * - 这里能列出**全部**文章的留言（评论管理需要跨文章视角）
 * - 返回 page 字段，后台才知道每条属于哪篇文章
 * - 全程要求登录态，且响应禁止缓存
 */

import {
  adminJson,
  deleteCommentCascade,
  hasSession,
  PAGE_RE,
  readJson,
} from "../../_lib/api.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** 统一鉴权：未登录一律 401，前端据此跳回登录页 */
async function requireSession(request, env) {
  return hasSession(request, env || {});
}

export async function onRequestGet({ request, env }) {
  if (!(await requireSession(request, env))) {
    return adminJson({ error: "未登录" }, 401);
  }
  if (!env.DB) return adminJson({ error: "缺少 D1 绑定 DB" }, 503);

  const url = new URL(request.url);
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit")) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
  const q = (url.searchParams.get("q") || "").trim();
  const page = (url.searchParams.get("page") || "").trim();

  // 动态拼 WHERE，但值一律走绑定参数
  const where = [];
  const binds = [];
  if (page) {
    if (!PAGE_RE.test(page)) return adminJson({ error: "page 不合法" }, 400);
    where.push(`page = ?${binds.length + 1}`);
    binds.push(page);
  }
  if (q) {
    // LIKE 的通配符要转义，否则用户搜 % 会匹配全部
    const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
    where.push(
      `(name LIKE ?${binds.length + 1} ESCAPE '\\' OR text LIKE ?${binds.length + 1} ESCAPE '\\' OR page LIKE ?${binds.length + 1} ESCAPE '\\')`,
    );
    binds.push(`%${escaped}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM comments ${whereSql}`,
  )
    .bind(...binds)
    .first();

  const rows = await env.DB.prepare(
    `SELECT id, page, parent_id, name, text, admin_badge,
            strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at
       FROM comments
       ${whereSql}
      ORDER BY id DESC
      LIMIT ?${binds.length + 1} OFFSET ?${binds.length + 2}`,
  )
    .bind(...binds, limit, offset)
    .all();

  return adminJson({
    total: totalRow ? totalRow.n : 0,
    limit,
    offset,
    items: rows.results || [],
  });
}

/**
 * 开关某条留言的管理员徽标。
 *
 *   PATCH /api/admin/comments   { id, admin_badge }   → { ok, id, admin_badge }
 *
 * 只接收这两个字段：徽标是「部分更新」语义，走 PATCH 而不是 POST
 * （POST 在访客接口那边是「发表」）。值严格校验成 0/1——布尔、字符串
 * 都拒，避免 SQLite 把 truthy 值悄悄存成 1 之外的东西。
 */
export async function onRequestPatch({ request, env }) {
  if (!(await requireSession(request, env))) {
    return adminJson({ error: "未登录" }, 401);
  }
  if (!env.DB) return adminJson({ error: "缺少 D1 绑定 DB" }, 503);

  const body = await readJson(request);
  if (!body) return adminJson({ error: "请求格式不对" }, 400);

  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return adminJson({ error: "id 不合法" }, 400);
  }
  if (body.admin_badge !== 0 && body.admin_badge !== 1) {
    return adminJson({ error: "admin_badge 只能是 0 或 1" }, 400);
  }

  // 先确认这条留言存在：D1 的 UPDATE 对不存在的 id 也返回成功（changes: 0），
  // 不查就会让前端以为开关生效了。
  const existing = await env.DB.prepare(
    `SELECT id FROM comments WHERE id = ?1`,
  )
    .bind(id)
    .first();
  if (!existing) return adminJson({ error: "留言不存在" }, 404);

  await env.DB.prepare(
    `UPDATE comments SET admin_badge = ?2 WHERE id = ?1`,
  )
    .bind(id, body.admin_badge)
    .run();

  return adminJson({ ok: true, id, admin_badge: body.admin_badge });
}

export async function onRequestDelete({ request, env }) {
  if (!(await requireSession(request, env))) {
    return adminJson({ error: "未登录" }, 401);
  }
  if (!env.DB) return adminJson({ error: "缺少 D1 绑定 DB" }, 503);

  const url = new URL(request.url);
  const id = Number(url.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return adminJson({ error: "id 不合法" }, 400);
  }

  // 级联：删顶层留言时连同它的回复一起删，
  // 否则那些回复的 parent_id 会指向一个不存在的 id，变成永远显示不出来的孤儿
  const removed = await deleteCommentCascade(env.DB, "comments", id);
  if (!removed) return adminJson({ error: "留言不存在" }, 404);

  return adminJson({ ok: true, removed });
}

export async function onRequestPost() {
  return adminJson({ error: "不支持的请求方法" }, 405);
}
