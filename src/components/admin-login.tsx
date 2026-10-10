"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { notifyAdminSessionChanged } from "@/lib/admin-session";

/**
 * 管理员登录表单。
 *
 * 登录态由后端下发 HttpOnly + SameSite=Strict 的签名 Cookie，
 * 前端**不接触也不存储任何令牌**——这是不用 localStorage 的原因：
 * localStorage 里的东西任何 XSS 都能读走，HttpOnly Cookie 读不到。
 *
 * 这个页面自己没有任何入口链接（导航栏、页脚都不放），只能靠记住地址访问；
 * 登录成功之后，底栏才会多出一个通往 /admin 的「后台」入口。
 */
export function AdminLogin() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    if (!key.trim()) {
      setError("请输入密钥");
      inputRef.current?.focus();
      return;
    }

    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        setError(body?.error || "登录失败");
        // 失败后清空输入框：避免密钥留在屏幕上被人看到
        setKey("");
        inputRef.current?.focus();
        return;
      }

      setKey("");
      // Cookie 刚写入，让底栏的后台入口立刻出现（底栏在根布局里不会重新挂载）
      notifyAdminSessionChanged();
      router.push("/admin");
      // 刷新一次让服务端组件也拿到最新登录态（Cookie 刚写入）
      router.refresh();
    } catch {
      setError("网络异常，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="admin-key" className="text-sm text-secondary">
          管理员密钥
        </label>
        <input
          id="admin-key"
          ref={inputRef}
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="ADMIN_KEY"
          autoComplete="current-password"
          // 管理后台不该被搜索引擎或密码管理器之外的任何东西索引
          name="admin-key"
          className="field-input"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p aria-live="polite" className="min-h-5 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
        <button type="submit" disabled={busy} className="btn-pill">
          {busy ? "登录中…" : "登录"}
        </button>
      </div>
    </form>
  );
}
