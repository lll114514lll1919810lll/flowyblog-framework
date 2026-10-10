/**
 * 站点开关的管理接口。
 *
 *   GET   /api/admin/settings   → { comments_locked: boolean }
 *   PATCH /api/admin/settings   { comments_locked: boolean }  → { ok, comments_locked }
 *
 * 单独开一个路由，不塞进 /api/admin/comments：那个文件管的是「一条条留言」，
 * 这里管的是「全站一个开关」，两者的鉴权语义、缓存策略都不一样，混在一起
 * 以后要加第二个开关时会更难读。
 *
 * 全程要求登录态，响应一律 no-store（adminJson 自带）——锁的状态被缓存住，
 * 就会出现「后台刚锁上、前台还显示能留言」。
 */

import {
  adminJson,
  commentsLocked,
  hasSession,
  readJson,
  setCommentsLocked,
} from "../../_lib/api.js";

export async function onRequestGet({ request, env }) {
  if (!(await hasSession(request, env || {}))) {
    return adminJson({ error: "未登录" }, 401);
  }
  // 这里不兜 DB 缺失：后台要能看出「读不到」，而不是永远显示未锁
  if (!env.DB) return adminJson({ error: "缺少 D1 绑定 DB" }, 503);

  return adminJson({ comments_locked: await commentsLocked(env.DB) });
}

export async function onRequestPatch({ request, env }) {
  if (!(await hasSession(request, env || {}))) {
    return adminJson({ error: "未登录" }, 401);
  }
  if (!env.DB) return adminJson({ error: "缺少 D1 绑定 DB" }, 503);

  const body = await readJson(request);
  if (!body) return adminJson({ error: "请求格式不对" }, 400);

  // 严格要布尔：0/1、"true" 都拒。写库的是布尔的字符串形式，
  // 进来时先统一成布尔，省得两边各猜一次
  if (typeof body.comments_locked !== "boolean") {
    return adminJson({ error: "comments_locked 只能是 true 或 false" }, 400);
  }

  try {
    await setCommentsLocked(env.DB, body.comments_locked);
  } catch (error) {
    // 写失败必须报出来：静默返回 ok 会让人以为锁上了、实际没有，
    // 那比直接报错危险得多。最常见的原因是没跑 0003 迁移（表不存在）。
    return adminJson(
      {
        error: `写入失败（settings 表可能不存在，需要先跑 db/migrations/0003-add-settings.sql）：${String(error?.message ?? error)}`,
      },
      500,
    );
  }

  return adminJson({ ok: true, comments_locked: body.comments_locked });
}
