import type { Metadata } from "next";
import { AdminLogin } from "@/components/admin-login";

/**
 * 管理员登录页：/adminlogin
 *
 * 刻意不放入口链接——导航栏、页脚、sitemap 里都没有它，
 * 只能靠记住地址访问。
 *
 * noindex 是必须的：没有入口不等于搜索引擎找不到。
 * 只要有任何一处外链指向它，爬虫就会跟过来，把登录页收进索引。
 */
export const metadata: Metadata = {
  title: "管理员登录",
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminLoginPage() {
  return (
    <div className="flex flex-col gap-10">
      <header className="panel panel-strong flex flex-col gap-3 px-7 py-8 sm:px-10 sm:py-9">
        <p className="eyebrow">ADMIN</p>
        <h1 className="text-3xl font-bold tracking-tight">管理员登录</h1>
        <p className="text-sm leading-relaxed text-secondary">
          登录后可管理全站留言。
        </p>
      </header>

      <section className="panel flex flex-col gap-4 px-5 py-6 sm:px-6">
        <AdminLogin />
      </section>
    </div>
  );
}
