/**
 * AI 文章总结接口（只提供材料与落库，不连接 AI）。
 *
 *   GET  /api/admin/ai-summary?page=<slug>
 *     → { page, article: { slug, title, description, tags, text },
 *         existing_summary_id, contract }
 *        「总结任务包」：文章全文（截断到上下文上限）、以及 AI 输出要满足的
 *        约束（署名、pinned 值、字数上限）。调用方把材料交给 AI，
 *        拿回一段符合字数限制的总结文本。
 *
 *   POST /api/admin/ai-summary   { page, summary }
 *     → { ok, id }
 *        把 AI 生成的总结文本直接落成一条评论：署名「AI 总结助手」、
 *        pinned = 2（比置顶池 1 更靠前的一档，前台带专用 AI 标记）、
 *        approved = 1（管理员操作，不走审核）。
 *        该文章已存在总结评论时返回 409——一篇文章至多一条。
 *
 * 与 ai-review 的分工：那边给的是「审一条评论」的材料，这里是「总结一篇文章」
 * 的材料 + 发表通道。两步都刻意不绑定任何 AI 供应商——接入哪个模型、
 * 用什么提示词，是调用方的事；本接口只保证落库的那条评论形状正确。
 *
 * pinned 用 2 而不是再加一列：pinned 本就是「在第几层池子」的语义
 * （0 普通 / 1 置顶 / 2 AI 总结），INTEGER 列直接扩展，前台按值分层渲染。
 *
 * 全程要求登录态（/api/admin/* 同款签名 Cookie），响应 no-store。
 */

import {
  adminJson,
  hasSession,
  MAX_TEXT,
  PAGE_RE,
  readJson,
} from "../../_lib/api.js";
import { loadSearchDoc } from "../../_lib/articles.js";

/** AI 总结评论的固定署名 */
const AI_SUMMARY_AUTHOR = "AI 总结助手";
/** AI 总结的置顶层：2 = 比 pinned 1 的置顶池更靠前 */
const AI_SUMMARY_PINNED = 2;
/**
 * AI 评论没有访客 IP，但 ip_hash 列 NOT NULL，写一个自说明的常量占位。
 * 它不会参与限流统计（限流按访客自己的哈希计数），后台列表也从不展示它。
 */
const AI_IP_HASH = "ai";
/** 喂给 AI 的文章正文上限（字符）：太长总结质量反而下降，也浪费 token */
const SUMMARY_CONTEXT_MAX = 8000;

export async function onRequestGet({ request, env }) {
  if (!(await hasSession(request, env || {}))) {
    return adminJson({ error: "未登录" }, 401);
  }
  if (!env.DB) return adminJson({ error: "缺少 D1 绑定 DB" }, 503);

  const url = new URL(request.url);
  const page = url.searchParams.get("page") || "";
  if (!PAGE_RE.test(page)) {
    return adminJson({ error: "页面标识不合法" }, 400);
  }

  // 全文从搜索索引的 sections 顺序拼接，超出上下文上限就截断——
  // AI 总结不需要逐字全文，结尾丢一点不影响概括质量
  const doc = await loadSearchDoc(env, url, page);
  let article = null;
  if (doc) {
    const fullText = (Array.isArray(doc.sections) ? doc.sections : [])
      .map((s) => String(s?.text || ""))
      .join("\n")
      .trim();
    article = {
      slug: doc.slug,
      title: String(doc.title || ""),
      description: String(doc.description || ""),
      tags: Array.isArray(doc.tags) ? doc.tags : [],
      text: Array.from(fullText).slice(0, SUMMARY_CONTEXT_MAX).join(""),
    };
  }

  const existing = await env.DB.prepare(
    `SELECT id FROM comments WHERE page = ?1 AND pinned = ?2`,
  )
    .bind(page, AI_SUMMARY_PINNED)
    .first();

  return adminJson({
    page,
    article,
    existing_summary_id: existing ? existing.id : null,
    contract: {
      author_name: AI_SUMMARY_AUTHOR,
      pinned: AI_SUMMARY_PINNED,
      max_chars: MAX_TEXT,
    },
  });
}

export async function onRequestPost({ request, env }) {
  if (!(await hasSession(request, env || {}))) {
    return adminJson({ error: "未登录" }, 401);
  }
  if (!env.DB) return adminJson({ error: "缺少 D1 绑定 DB" }, 503);

  const body = await readJson(request);
  if (!body) return adminJson({ error: "请求格式不对" }, 400);

  const page = String(body.page || "");
  if (!PAGE_RE.test(page)) {
    return adminJson({ error: "页面标识不合法" }, 400);
  }

  // 字数用 Array.from 按码点计数（与访客发表接口的 validateComment 同一规则）：
  // emoji 之类在 .length 下会算成 2，中英文混排时「明明没超却被拒」很难排查
  const summary = String(body.summary || "").trim();
  if (!summary) return adminJson({ error: "总结内容不能为空" }, 400);
  if (Array.from(summary).length > MAX_TEXT) {
    return adminJson({ error: `总结最多 ${MAX_TEXT} 字` }, 400);
  }

  // 一篇文章至多一条总结：pinned = 2 就是它的身份标识，
  // 查重和落库是两次独立查询（无事务），极端并发下最多多插一条，
  // 后台删除即可——为这个概率给 SQLite 上锁不值得。
  const existing = await env.DB.prepare(
    `SELECT id FROM comments WHERE page = ?1 AND pinned = ?2`,
  )
    .bind(page, AI_SUMMARY_PINNED)
    .first();
  if (existing) {
    return adminJson({ error: "该文章已有 AI 总结评论" }, 409);
  }

  const result = await env.DB.prepare(
    `INSERT INTO comments (page, name, text, ip_hash, approved, pinned)
     VALUES (?1, ?2, ?3, ?4, 1, ?5)`,
  )
    .bind(page, AI_SUMMARY_AUTHOR, summary, AI_IP_HASH, AI_SUMMARY_PINNED)
    .run();

  return adminJson({ ok: true, id: result.meta?.last_row_id ?? null });
}
