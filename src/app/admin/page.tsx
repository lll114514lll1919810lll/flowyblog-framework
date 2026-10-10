import type { Metadata } from "next";
import { AdminDashboard } from "@/components/admin-dashboard";

/**
 * 评论管理后台：/admin
 *
 * 禁止收录。入口不给访客：登录之后底栏才会出现一个「后台」链接
 * （见 components/admin-entry.tsx），未登录时的地址只能靠记住。
 *
 * 注意：页面本身是静态导出的 HTML，任何人都能打开这个地址；
 * 真正的门在 /api/admin/* 上——未登录时接口一律 401，
 * 页面拿不到数据并跳回登录页。所以这里不需要（也无法）做服务端鉴权。
 */
export const metadata: Metadata = {
  title: "评论管理",
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminPage() {
  return <AdminDashboard />;
}
