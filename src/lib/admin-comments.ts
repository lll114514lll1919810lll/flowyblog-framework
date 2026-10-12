/**
 * 管理评论接口的共用请求封装。
 *
 * 评论区组件（comments.tsx）、后台面板（admin-dashboard.tsx）和待审核页
 * （admin-pending.tsx）都要调 PATCH 徽标 / PATCH 审核 / DELETE 留言这几个接口，
 * 请求与错误解析只写这一份；
 * 乐观更新、状态回滚、401 之后的界面处理（提示 vs 跳登录页）差异较大，
 * 归各组件自己处理。
 */

export type AdminCommentResult = {
  /** HTTP 状态码；0 表示请求根本没发出去（离线 / 网络异常） */
  status: number;
  ok: boolean;
  /** 后端返回的错误信息（仅失败时有） */
  error: string | null;
  /** 后端返回的 JSON 体（如删除接口的 removed 计数） */
  body: Record<string, unknown> | null;
};

async function adminRequest(
  url: string,
  init?: RequestInit,
): Promise<AdminCommentResult> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return { status: 0, ok: false, error: null, body: null };
  }
  const body = res.headers.get("content-type")?.includes("application/json")
    ? await res.json().catch(() => null)
    : null;
  return {
    status: res.status,
    ok: res.ok,
    error: res.ok ? null : (String(body?.error ?? "") || null),
    body: body && typeof body === "object" ? (body as Record<string, unknown>) : null,
  };
}

/** 开关某条留言的管理员徽标（PATCH /api/admin/comments） */
export function patchAdminBadge(id: number, adminBadge: 0 | 1) {
  return adminRequest("/api/admin/comments", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, admin_badge: adminBadge }),
  });
}

/** 审核某条留言：1 = 通过（对外可见），0 = 撤回待审（PATCH /api/admin/comments） */
export function patchAdminApproved(id: number, approved: 0 | 1) {
  return adminRequest("/api/admin/comments", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, approved }),
  });
}

/** 置顶某条顶层留言：0 普通、1 置顶、2 AI 总结置顶、3 AI 总结未置顶
 *（后两者仅限本来就是 AI 总结的评论；PATCH /api/admin/comments） */
export function patchAdminPinned(id: number, pinned: 0 | 1 | 2 | 3) {
  return adminRequest("/api/admin/comments", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, pinned }),
  });
}

/** 修改留言内容（PATCH /api/admin/comments）。
 * 后端走与访客发表同一套校验：trim 后非空、最多 500 字（按码点计数） */
export function patchAdminText(id: number, text: string) {
  return adminRequest("/api/admin/comments", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, text }),
  });
}

/** 删除单条留言（级联删回复；DELETE /api/admin/comments?id=） */
export function deleteAdminComment(id: number) {
  return adminRequest(`/api/admin/comments?id=${id}`, { method: "DELETE" });
}
