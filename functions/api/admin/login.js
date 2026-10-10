/**
 * 管理员登录。
 *
 *   POST /api/admin/login   { key }  校验密钥并下发签名 Cookie
 *   DELETE /api/admin/login          退出登录（清除 Cookie）
 *
 * 安全上的几个考虑：
 * - 密钥比较用常量时间，避免时序侧信道
 * - 失败时人为延迟一小段：无状态方案没法记录「尝试次数」，
 *   用固定延迟抬高暴力破解的代价，成本几乎为零
 * - 配置的密钥太短直接拒绝登录，并提示换长的——短密钥才是真正的风险
 * - 登录态放 HttpOnly + SameSite=Strict Cookie，而不是返回给前端存 localStorage
 */

import {
  adminJson,
  MIN_KEY_LENGTH,
  issueSession,
  json,
  originAllowed,
  readJson,
  sessionClearCookie,
  sessionSetCookie,
  timingSafeEqual,
} from "../../_lib/api.js";

/** 登录失败后的固定延迟（毫秒） */
const FAIL_DELAY_MS = 400;

export async function onRequestPost({ request, env }) {
  const origin = originAllowed(request, env || {});
  if (origin === null) return json({ error: "来源不允许" }, 403);

  const url = new URL(request.url);
  const expected = String(env?.ADMIN_KEY || "");

  // 没配密钥时不允许登录，否则等于后台裸奔
  if (!expected) {
    return adminJson({ error: "服务端未配置 ADMIN_KEY，无法登录" }, 503);
  }

  // 密钥过短直接拒绝：引导站主设一个真正安全的密钥，
  // 而不是让一个 6 位密码守着整个后台
  if (expected.length < MIN_KEY_LENGTH) {
    return adminJson(
      {
        error: `ADMIN_KEY 太短（当前 ${expected.length} 位），请设置为至少 ${MIN_KEY_LENGTH} 位`,
      },
      503,
    );
  }

  const body = await readJson(request);
  const provided = String(body?.key || "");

  if (!timingSafeEqual(provided, expected)) {
    await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
    return adminJson({ error: "密钥不正确" }, 401);
  }

  const token = await issueSession(env);
  if (!token) return adminJson({ error: "无法签发会话" }, 500);

  return adminJson({ ok: true }, 200, {
    "set-cookie": sessionSetCookie(url, token),
  });
}

export async function onRequestDelete({ request }) {
  const url = new URL(request.url);
  return adminJson({ ok: true }, 200, {
    "set-cookie": sessionClearCookie(url),
  });
}
