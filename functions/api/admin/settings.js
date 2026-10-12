/**
 * 站点开关的管理接口。
 *
 *   GET   /api/admin/settings   → { comments_locked, comments_moderation, pending_count }
 *   PATCH /api/admin/settings   { comments_locked?, comments_moderation? }  → { ok, ... }
 *
 * 单独开一个路由，不塞进 /api/admin/comments：那个文件管的是「一条条留言」，
 * 这里管的是「全站一个开关」，两者的鉴权语义、缓存策略都不一样，混在一起
 * 以后要加第三个开关时会更难读。
 *
 * 全程要求登录态，响应一律 no-store（adminJson 自带）——开关的状态被缓存住，
 * 就会出现「后台刚拨上、前台还是旧行为」。
 *
 * pending_count 一并在这里返回：后台首页的「待审核」入口要显示角标，
 * 单独开接口就是多一次请求，而这里本来就查库，顺手 COUNT 一次最省。
 */

import {
  adminJson,
  commentsLocked,
  commentsModeration,
  hasSession,
  readJson,
  setCommentsLocked,
  setCommentsModeration,
} from "../../_lib/api.js";

export async function onRequestGet({ request, env }) {
  if (!(await hasSession(request, env || {}))) {
    return adminJson({ error: "未登录" }, 401);
  }
  // 这里不兜 DB 缺失：后台要能看出「读不到」，而不是永远显示关闭
  if (!env.DB) return adminJson({ error: "缺少 D1 绑定 DB" }, 503);

  let pendingCount = 0;
  try {
    const row = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM comments WHERE approved = 0`)
      .first();
    pendingCount = row ? row.n : 0;
  } catch {
    // comments 表必有、approved 列可能缺（没跑 0004 迁移）。
    // 角标是附属信息，读不到就按 0，不该拖垮两个开关的读取。
    pendingCount = 0;
  }

  return adminJson({
    comments_locked: await commentsLocked(env.DB),
    comments_moderation: await commentsModeration(env.DB),
    pending_count: pendingCount,
  });
}

export async function onRequestPatch({ request, env }) {
  if (!(await hasSession(request, env || {}))) {
    return adminJson({ error: "未登录" }, 401);
  }
  if (!env.DB) return adminJson({ error: "缺少 D1 绑定 DB" }, 503);

  const body = await readJson(request);
  if (!body) return adminJson({ error: "请求格式不对" }, 400);

  // 两个开关都可选，传哪个写哪个，但至少传一个——全空的 PATCH 只可能是
  // 前端发错了，静默成功会掩盖问题。严格要布尔：0/1、"true" 都拒；
  // 写库前统一成布尔的字符串形式，省得两边各猜一次。
  const locked = body.comments_locked;
  const moderation = body.comments_moderation;
  const wantsLocked = locked !== undefined;
  const wantsModeration = moderation !== undefined;

  if (!wantsLocked && !wantsModeration) {
    return adminJson({ error: "没有要更新的开关" }, 400);
  }
  if (wantsLocked && typeof locked !== "boolean") {
    return adminJson({ error: "comments_locked 只能是 true 或 false" }, 400);
  }
  if (wantsModeration && typeof moderation !== "boolean") {
    return adminJson({ error: "comments_moderation 只能是 true 或 false" }, 400);
  }

  try {
    if (wantsLocked) await setCommentsLocked(env.DB, locked);
    if (wantsModeration) await setCommentsModeration(env.DB, moderation);
  } catch (error) {
    // 写失败必须报出来：静默返回 ok 会让人以为开关拨上了、实际没有，
    // 那比直接报错危险得多。最常见的原因是没跑 0003 迁移（表不存在）。
    return adminJson(
      {
        error: `写入失败（settings 表可能不存在，需要先跑 db/migrations/0003-add-settings.sql）：${String(error?.message ?? error)}`,
      },
      500,
    );
  }

  return adminJson({
    ok: true,
    ...(wantsLocked ? { comments_locked: locked } : {}),
    ...(wantsModeration ? { comments_moderation: moderation } : {}),
  });
}
