"use client";

import Link from "next/link";
import { useEffect } from "react";
import { LinkPending } from "@/components/link-pending";
import { refreshAdminSession, useIsAdmin } from "@/lib/admin-session";

/**
 * 底栏的「后台」入口：只有已登录的管理员才看得到。
 *
 * 站点是静态导出的，构建期不知道访客是谁，所以登录态只能到浏览器里问一次
 * （见 lib/admin-session.ts）。这里的渲染分两步：
 *
 *   1. 服务端和首次水合都按「不是管理员」渲染，输出一个空节点——两边一致，
 *      不会水合报错，也不会给访客闪一下入口再收回去；
 *   2. 探测回来确认已登录，再挂上链接。
 *
 * 探测本身对每个访客都是一次请求，即使他从没登录过。这个代价是清楚的：
 * /api/admin/session 只做一次 HMAC 签名校验、不查库、不返回数据，比页面里
 * 那张背景图便宜得多；而底栏挂在根布局上，一次整页加载只会探测一回。
 *
 * 安全上不用指望这个链接做任何事。它只是给管理员省一步输入地址；真正的门
 * 始终在 /api/admin/* 上，未登录一律 401。就算有人手动改出这个链接，打开
 * 的也只是一个拿不到数据的空壳。
 */
export function AdminEntry() {
  const isAdmin = useIsAdmin();

  useEffect(() => {
    void refreshAdminSession();
  }, []);

  if (!isAdmin) return null;

  return (
    <span className="whitespace-nowrap">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
      >
        {/* 齿轮：和旁边实验室那个烧瓶图标同样是「这里是一个页面」的标记，
            用来和左侧两条协议链接区分开 */}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        <LinkPending>后台</LinkPending>
      </Link>
    </span>
  );
}
