/**
 * 当前登录态查询。
 *
 *   GET /api/admin/session   → { authenticated: boolean }
 *
 * 单独开一个轻接口，是为了让客户端用最便宜的方式判断「当前是不是管理员」，
 * 不必先拉一次完整数据列表。有两个地方用它：
 *
 *   - 后台页面加载时决定显示管理界面还是跳回登录页；
 *   - 底栏决定显不显示「后台」入口（见 src/lib/admin-session.ts）。
 *     页面是静态导出的，构建期不知道访客是谁，只能到浏览器里问这一句。
 *
 * 它不泄露任何信息——只回答「这个 Cookie 有效吗」，不查库、不返回数据。
 */

import { adminJson, hasSession, sessionClearCookie } from "../../_lib/api.js";

export async function onRequestGet({ request, env }) {
  const authenticated = await hasSession(request, env || {});
  return adminJson({ authenticated });
}

/** DELETE 走退出登录：清掉 Cookie 即失效（签名方案下服务端无需记账） */
export async function onRequestDelete({ request }) {
  return adminJson({ ok: true }, 200, {
    "set-cookie": sessionClearCookie(new URL(request.url)),
  });
}
