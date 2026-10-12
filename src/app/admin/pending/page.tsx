import type { Metadata } from "next";
import { AdminPending } from "@/components/admin-pending";

/**
 * 待审核页：/admin/pending
 *
 * 审核模式下新访客评论（approved = 0）集中在这里处理：
 * 通过后前台可见，或直接删除（级联删回复）。
 *
 * 与 /admin 相同：页面本身是静态导出的 HTML，任何人都能打开这个地址；
 * 真正的门在 /api/admin/* 上——未登录时接口一律 401，
 * 页面拿不到数据并跳回登录页。所以这里不需要（也无法）做服务端鉴权。
 */
export const metadata: Metadata = {
  title: "待审核",
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminPendingPage() {
  return <AdminPending />;
}
