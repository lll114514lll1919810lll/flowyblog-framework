"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { deleteAdminComment, patchAdminApproved } from "@/lib/admin-comments";
import { absoluteTime, relativeTime } from "@/lib/time";

/**
 * 待审核页。
 *
 * 审核模式开启后，访客新评论以 approved = 0 入库、对外不可见；
 * 这里是它们唯一能被处理的入口：通过（approved = 1）或删除。
 *
 * 数据来自 /api/admin/comments?status=pending，鉴权完全在后端：
 * 未登录时接口 401，页面据此跳回登录页。
 *
 * 待审核通常只有零星几条（审核开着的日子里每天新增的量），
 * 一次拉全（limit=200，与访客列表同一个上限常量）、不做分页——
 * 为个位数的列表造一套分页 UI 得不偿失。
 */

type PendingComment = {
  id: number;
  page: string;
  name: string;
  text: string;
  created_at: string;
};

type Status = "loading" | "ready" | "error";

const LIST_LIMIT = 200;

export function AdminPending() {
  const router = useRouter();

  const [items, setItems] = useState<PendingComment[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");

  /** 正在等待二次确认删除的那条 id（与后台列表同一套交互，避免阻塞弹窗） */
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** 正在提交「通过」的那条 id（同一时刻只允许一个在飞，避免连点乱序） */
  const [approvingId, setApprovingId] = useState<number | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        const params = new URLSearchParams({
          status: "pending",
          limit: String(LIST_LIMIT),
        });
        const res = await fetch(`/api/admin/comments?${params}`, {
          headers: { accept: "application/json" },
          signal: controller.signal,
        });

        // 未登录（或会话过期）→ 回登录页，和 /admin 同一套处理
        if (res.status === 401) {
          router.replace("/adminlogin");
          return;
        }

        const body = await res.json().catch(() => null);
        if (controller.signal.aborted) return;

        if (!res.ok) {
          setError(body?.error || "加载失败");
          setStatus("ready");
          return;
        }

        // 运行时收窄而不是盲信断言：后端形状意外时显示空列表
        const list = Array.isArray(body?.items) ? body.items : [];
        setItems(list);
        setError("");
        setStatus("ready");
      } catch {
        if (controller.signal.aborted) return;
        setStatus("error");
      }
    })();

    return () => controller.abort();
  }, [reloadKey, router]);

  /** 通过一条：approved 置 1，成功后从列表移除（它已经不需要出现在这里了） */
  async function approve(id: number) {
    if (approvingId !== null) return;
    setApprovingId(id);
    setError("");

    try {
      const r = await patchAdminApproved(id, 1);
      if (r.status === 401) {
        router.replace("/adminlogin");
        return;
      }
      if (r.status === 0) {
        setError("网络异常，操作失败");
        return;
      }
      if (!r.ok) {
        setError(r.error || "操作失败");
        return;
      }
      setItems((list) => list.filter((c) => c.id !== id));
    } finally {
      setApprovingId(null);
    }
  }

  async function remove(id: number) {
    setDeleting(true);
    try {
      const r = await deleteAdminComment(id);
      if (r.status === 401) {
        router.replace("/adminlogin");
        return;
      }
      if (r.status === 0) {
        setError("网络异常，删除失败");
        return;
      }
      if (!r.ok) {
        setError(r.error || "删除失败");
        return;
      }
      setPendingDelete(null);
      setItems((list) => list.filter((c) => c.id !== id));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="panel panel-strong flex flex-col gap-4 px-7 py-8 sm:px-10 sm:py-9">
        <p className="eyebrow">ADMIN</p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              待审核
            </h1>
            <p className="mt-2 text-sm text-secondary">
              {status === "loading"
                ? "加载中…"
                : status === "ready" && items.length > 0
                  ? `${items.length} 条等待处理`
                  : "这些留言通过后才会对访客显示"}
            </p>
          </div>
          <Link href="/admin" className="btn-pill">
            ← 返回评论管理
          </Link>
        </div>
      </header>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      {status === "loading" && <p className="text-sm text-muted">加载中…</p>}

      {status === "error" && (
        <div>
          <p className="text-sm text-muted">加载失败。</p>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="btn-pill mt-3"
          >
            重试
          </button>
        </div>
      )}

      {status === "ready" && items.length === 0 && !error && (
        <p className="text-sm text-muted">没有待审核的留言。</p>
      )}

      {items.length > 0 && (
        <ul className="flex flex-col gap-3">
          {items.map((c) => (
            <li
              key={c.id}
              className="panel rounded-[var(--radius-panel)] px-5 py-4"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-sm font-medium">{c.name}</span>
                <time
                  dateTime={c.created_at}
                  title={absoluteTime(c.created_at)}
                  className="text-xs text-muted"
                >
                  {relativeTime(c.created_at)}
                </time>
                {/* 待审核也要有跨文章视角：通过前先知道它发在哪篇文章下 */}
                <Link
                  href={`/blog/${c.page}`}
                  className="text-xs text-muted underline-offset-2 hover:text-accent hover:underline"
                >
                  /blog/{c.page}
                </Link>
                <span className="ml-auto text-xs text-muted tabular-nums">
                  #{c.id}
                </span>
              </div>

              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-secondary">
                {c.text}
              </p>

              <div className="mt-3 flex items-center justify-end gap-2">
                {pendingDelete === c.id ? (
                  <>
                    <span className="text-xs text-muted">确定删除？</span>
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() => remove(c.id)}
                      className="btn-pill text-red-600 dark:text-red-400"
                    >
                      {deleting ? "删除中…" : "确认删除"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(null)}
                      className="btn-pill"
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    {/* 「通过」是这里的主操作，放最左；删除是重后果操作，
                        需要二次确认，两者分开避免误点 */}
                    <button
                      type="button"
                      disabled={approvingId === c.id}
                      onClick={() => approve(c.id)}
                      className="btn-pill mr-auto"
                    >
                      {approvingId === c.id ? "通过中…" : "通过"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(c.id)}
                      className="btn-pill"
                    >
                      删除
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
