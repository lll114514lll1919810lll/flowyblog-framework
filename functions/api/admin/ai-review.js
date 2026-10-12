/**
 * AI 审核上下文接口（只提供材料，不连接 AI）。
 *
 *   GET /api/admin/ai-review?id=<评论id>
 *     → {
 *         comment,           // 待审评论本体（含 approved 状态）
 *         parent,            // 它回复的那条评论；顶层留言为 null
 *         article,           // 文章摘要（标题/简介/标签/正文节选）；索引里找不到为 null
 *         approved_comments  // 同篇文章其他已通过评论（最近的在前，最多 20 条）
 *       }
 *
 * 定位：把「AI 参与评论审核」需要的判断材料一次性组装好，调用方（将来的
 * 后台按钮、脚本或 worker）拿这份上下文去问 AI，AI 按约定返回：
 *
 *     { "approved": 0 | 1, "reason": "一句话理由" }
 *
 * 调用方拿到 approved 后走既有的 PATCH /api/admin/comments { id, approved }
 * 落库——审核结果仍然是普通数据变更，这个接口本身不做任何写操作，
 * 也不调用任何外部服务；接入哪个 AI 供应商是调用方的事。
 *
 * 文章摘要来自 /search-index.json：它是构建期生成的静态产物
 * （见 src/lib/search-index.ts），description 字段就是文章元数据里的
 * 简介，缺简介时退回正文开头节选。Functions 没有文件系统，
 * 用 Pages 的 ASSETS 绑定读静态资源（线上和 wrangler pages dev 都有）。
 *
 * 全程要求登录态（/api/admin/* 同款签名 Cookie），响应 no-store。
 */

import { adminJson, hasSession } from "../../_lib/api.js";
import { loadSearchDoc } from "../../_lib/articles.js";

/** 上下文里最多带几条已通过评论：再多 AI 也读不完，白占 token */
const CONTEXT_COMMENTS_LIMIT = 20;
/** 文章正文节选上限（字符）：description 缺失时的兜底材料 */
const EXCERPT_MAX = 400;

/** 从搜索索引组装一篇文章的摘要信息；拿不到（无绑定/无此文）就返回 null */
function buildArticleInfo(doc) {
  if (!doc) return null;

  // description 就是作者在 metadata 里写的简介，最理想的摘要；
  // 没写简介就从正文（sections 顺序拼接）截一段开头当节选
  let excerpt = String(doc.description || "");
  if (!excerpt.trim()) {
    const text = (Array.isArray(doc.sections) ? doc.sections : [])
      .map((s) => String(s?.text || ""))
      .join("\n")
      .trim();
    excerpt = Array.from(text).slice(0, EXCERPT_MAX).join("");
  }

  return {
    slug: doc.slug,
    title: String(doc.title || ""),
    description: String(doc.description || ""),
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    excerpt,
  };
}

export async function onRequestGet({ request, env }) {
  if (!(await hasSession(request, env || {}))) {
    return adminJson({ error: "未登录" }, 401);
  }
  if (!env.DB) return adminJson({ error: "缺少 D1 绑定 DB" }, 503);

  const url = new URL(request.url);
  const id = Number(url.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return adminJson({ error: "id 不合法" }, 400);
  }

  const comment = await env.DB.prepare(
    `SELECT id, page, parent_id, name, text, approved,
            strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at
       FROM comments
      WHERE id = ?1`,
  )
    .bind(id)
    .first();
  if (!comment) return adminJson({ error: "留言不存在" }, 404);

  // 回复的判断离不开它所回复的内容（「楼上的说法有误」脱离上文没法审），
  // 所以父评论单独带一份。只有一层：parent_id 恒指向顶层留言。
  let parent = null;
  if (comment.parent_id) {
    parent = await env.DB.prepare(
      `SELECT id, name, text,
              strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at
         FROM comments
        WHERE id = ?1`,
    )
      .bind(comment.parent_id)
      .first();
  }

  // 同篇文章的已通过评论做「评论区氛围」参照。取最近 N 条后翻回
  // 时间正序：对话按发生的顺序读，AI（和人）更容易对上谁在回应谁。
  // 不含待审评论本身（它还没通过，不该给 AI 当既有氛围）。
  const recent = await env.DB.prepare(
    `SELECT id, name, text,
            strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at
       FROM comments
      WHERE page = ?1 AND approved = 1 AND id != ?2
      ORDER BY id DESC
      LIMIT ${CONTEXT_COMMENTS_LIMIT}`,
  )
    .bind(comment.page, id)
    .all();
  const approvedComments = (recent.results || []).slice().reverse();

  const article = buildArticleInfo(await loadSearchDoc(env, url, comment.page));

  return adminJson({
    comment,
    parent,
    article,
    approved_comments: approvedComments,
  });
}

export async function onRequestPost() {
  return adminJson({ error: "不支持的请求方法" }, 405);
}
