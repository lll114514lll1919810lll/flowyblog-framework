"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminBadge } from "@/components/admin-badge";
import { notifyAdminSessionChanged } from "@/lib/admin-session";
import { absoluteTime, relativeTime } from "@/lib/time";

/**
 * 评论管理后台。
 *
 * 鉴权完全在后端：这里能拿到的数据都来自 /api/admin/*，
 * 未登录时接口返回 401，页面据此跳回登录页。也就是说即使有人
 * 直接打开 /admin，看到的也只是一个空壳——真正的门在接口上。
 */

type AdminComment = {
  id: number;
  page: string;
  name: string;
  text: string;
  /** 1 = 这条昵称旁显示金色管理员徽标。后端恒返回 0/1，不是布尔 */
  admin_badge: number;
  created_at: string;
};

type Payload = {
  total: number;
  limit: number;
  offset: number;
  items: AdminComment[];
};

/**
 * 每页条数。后台每条留言都完整展示（不截断），一页 20 条在屏幕上就是
 * 一堵墙；10 条翻页成本低，找起留言来也更接近「一屏看完」。
 */
const PAGE_SIZE = 10;

export function AdminDashboard() {
  const router = useRouter();

  const [items, setItems] = useState<AdminComment[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  /** 正在等待二次确认删除的那条 id（避免用 window.confirm 的阻塞弹窗） */
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  /** 徽标开关正在提交的那条 id（同一时刻只允许一个在飞，避免连点乱序） */
  const [badgeBusy, setBadgeBusy] = useState<number | null>(null);

  /** 全站评论锁。null = 还没读到（后端没有 settings 表时也是这个） */
  const [commentsLocked, setCommentsLocked] = useState<boolean | null>(null);
  /** 锁的写入正在进行，用来挡住连点 */
  const [lockBusy, setLockBusy] = useState(false);

  // 搜索防抖：每敲一个字就请求一次太浪费，等停手 300ms 再查
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(searchInput.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(offset),
        });
        if (query) params.set("q", query);

        const res = await fetch(`/api/admin/comments?${params}`, {
          headers: { accept: "application/json" },
          signal: controller.signal,
        });

        // 未登录（或会话过期）→ 回登录页。
        // replace 而不是 push：别让「后退」回到一个必然跳转的页面。
        if (res.status === 401) {
          router.replace("/adminlogin");
          return;
        }

        const body = await res.json().catch(() => null);
        if (controller.signal.aborted) return;

        if (!res.ok) {
          setError(body?.error || "加载失败");
          setLoading(false);
          return;
        }

        const payload = body as Payload;
        setItems(Array.isArray(payload?.items) ? payload.items : []);
        setTotal(payload?.total ?? 0);
        setError("");
        setLoading(false);
      } catch {
        if (controller.signal.aborted) return;
        setError("网络异常，请重试");
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [offset, query, reloadKey, router]);

  /*
    全站评论锁单独一个 effect。

    它是站点级的状态，不随分页、搜索、翻页变化，塞进上面那个列表请求里
    只会在每次换页时多发一次。reloadKey 带上是为了「重试」按钮能一并刷新它。

    读失败不报错、只把开关显示成「未知」：这个接口是后加的，老库没有
    settings 表时会返回 500，此时留言列表功能照常，不该被一个附属开关拖累。
  */
  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch("/api/admin/settings", {
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        if (!res.ok) {
          setCommentsLocked(null);
          return;
        }
        const body = await res.json().catch(() => null);
        if (controller.signal.aborted) return;
        setCommentsLocked(Boolean(body?.comments_locked));
      } catch {
        if (controller.signal.aborted) return;
        setCommentsLocked(null);
      }
    })();

    return () => controller.abort();
  }, [reloadKey]);

  /**
   * 拨全站评论锁。
   *
   * 乐观更新 + 失败回滚，和徽标开关同一套做法：这是个开关，点了就该立刻
   * 看到状态变了。回滚是必须的——锁的状态显示错了，管理员会以为评论已经
   * 关掉（或者已经打开），而实际行为和屏幕上的相反。
   */
  async function toggleCommentsLock() {
    if (lockBusy || commentsLocked === null) return;
    const next = !commentsLocked;
    setLockBusy(true);
    setCommentsLocked(next);
    setError("");

    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ comments_locked: next }),
      });
      if (res.status === 401) {
        router.replace("/adminlogin");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setCommentsLocked(!next); // 回滚
        setError(body?.error || "开关没保存上，已还原");
        return;
      }
      const body = await res.json().catch(() => null);
      // 以服务端为准再对一次：万一并发被别处改过，界面不该停在本地值
      if (typeof body?.comments_locked === "boolean") {
        setCommentsLocked(body.comments_locked);
      }
    } catch {
      setCommentsLocked(!next);
      setError("网络异常，开关没保存上，已还原");
    } finally {
      setLockBusy(false);
    }
  }

  async function remove(id: number) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/comments?id=${id}`, {
        method: "DELETE",
      });
      if (res.status === 401) {
        router.replace("/adminlogin");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error || "删除失败");
        return;
      }

      setPendingDelete(null);
      // 删掉当前页最后一条时往前退一页，否则会停在一个空白页
      if (items.length === 1 && offset > 0) setOffset((o) => Math.max(0, o - PAGE_SIZE));
      else setReloadKey((k) => k + 1);
    } catch {
      setError("网络异常，删除失败");
    } finally {
      setDeleting(false);
    }
  }

  /**
   * 开关某条的管理员徽标。
   *
   * 先改本地 state 再发请求（乐观更新）：这是个开关，点了就该立刻看到
   * 状态变了；等接口回来再改的话，网络稍慢就有明显的「按下去没反应」。
   * 失败时回滚到原值并把错误显示出来——回滚比「让它看起来还是开着的」
   * 诚实，否则管理员会以为徽标已经挂上，实际线上没有。
   */
  async function toggleBadge(id: number, next: 0 | 1) {
    if (badgeBusy !== null) return;
    setBadgeBusy(id);
    setError("");

    const prev = items;
    setItems((list) =>
      list.map((c) => (c.id === id ? { ...c, admin_badge: next } : c)),
    );

    try {
      const res = await fetch("/api/admin/comments", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, admin_badge: next }),
      });

      if (res.status === 401) {
        setItems(prev);
        router.replace("/adminlogin");
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setItems(prev);
        setError(body?.error || "徽标设置失败");
      }
    } catch {
      setItems(prev);
      setError("网络异常，徽标设置失败");
    } finally {
      setBadgeBusy(null);
    }
  }

  async function logout() {
    await fetch("/api/admin/session", { method: "DELETE" }).catch(() => {});
    // Cookie 已清掉，让底栏的后台入口跟着消失（底栏在根布局里不会重新挂载）
    notifyAdminSessionChanged();
    router.replace("/adminlogin");
  }

  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-8">
      <header className="panel panel-strong flex flex-col gap-4 px-7 py-8 sm:px-10 sm:py-9">
        <p className="eyebrow">ADMIN</p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              评论管理
            </h1>
            <p className="mt-2 text-sm text-secondary">
              {loading ? "加载中…" : `共 ${total} 条${query ? "（已筛选）" : ""}`}
            </p>
          </div>
          <button type="button" onClick={logout} className="btn-pill">
            退出登录
          </button>
        </div>
      </header>

      <section className="panel flex flex-col gap-4 px-5 py-5 sm:px-6">
        <label className="sr-only" htmlFor="admin-search">
          搜索留言
        </label>
        <input
          id="admin-search"
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="搜索昵称、内容或文章标识…"
          className="field-input"
        />

        {/*
          全站评论锁。放在这里而不是单独一块面板：它是「评论管理」的一个
          属性，和搜索、列表是同一件事的三面，拆开反而看不出它管的是什么。
        */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--lab-divider)] pt-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">接受新评论</span>
            <span className="text-xs leading-relaxed text-muted">
              {commentsLocked === null
                ? "状态未知：后端没有 settings 表（需要跑 db/migrations/0003-add-settings.sql）。"
                : commentsLocked
                  ? "已暂停——所有文章都不接受新评论，已有留言仍可读。"
                  : "正常接受新评论。"}
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={commentsLocked === false}
            aria-label="接受新评论"
            disabled={commentsLocked === null || lockBusy}
            onClick={toggleCommentsLock}
            className="lab-switch"
          >
            <span className="lab-switch-track">
              <span className="lab-switch-knob" />
            </span>
          </button>
        </div>
      </section>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      {!loading && items.length === 0 && !error && (
        <p className="text-sm text-muted">
          {query ? "没有匹配的留言。" : "还没有任何留言。"}
        </p>
      )}

      {items.length > 0 && (
        <ul className="flex flex-col gap-3">
          {items.map((c) => (
            <li
              key={c.id}
              className="panel rounded-[var(--radius-panel)] px-5 py-4"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="flex items-baseline gap-1.5 text-sm font-medium">
                  {c.name}
                  {/* 后台同步显示徽标：管理员要能确认「这条真的挂上了」，
                      而不是只在访客视角里才看得见 */}
                  {Boolean(c.admin_badge) && <AdminBadge />}
                </span>
                <time
                  dateTime={c.created_at}
                  title={absoluteTime(c.created_at)}
                  className="text-xs text-muted"
                >
                  {relativeTime(c.created_at)}
                </time>
                {/* 后台需要跨文章视角，所以要显示每条属于哪篇文章 */}
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
                {/* 徽标开关放左边、和删除分开一组：两者后果轻重完全不同
                    （一个可逆、一个连带删回复），挤在一起容易误点删除。
                    aria-pressed 而不是 checkbox：它视觉上是个按钮，
                    语义是「这个标记开没开」，读屏念「已按下」最贴切。 */}
                <button
                  type="button"
                  aria-pressed={Boolean(c.admin_badge)}
                  disabled={badgeBusy === c.id}
                  onClick={() =>
                    toggleBadge(c.id, c.admin_badge ? 0 : 1)
                  }
                  className={`btn-pill mr-auto ${
                    c.admin_badge ? "text-[var(--gold)]" : ""
                  }`}
                  title={
                    c.admin_badge
                      ? "点击取消这条的管理员徽标"
                      : "点击在这条昵称旁显示金色管理员徽标"
                  }
                >
                  {badgeBusy === c.id
                    ? "设置中…"
                    : c.admin_badge
                      ? "取消徽标"
                      : "加徽标"}
                </button>

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
                  <button
                    type="button"
                    onClick={() => setPendingDelete(c.id)}
                    className="btn-pill"
                  >
                    删除
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {(hasPrev || hasNext) && (
        <nav
          aria-label="分页"
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <button
            type="button"
            disabled={!hasPrev}
            onClick={() => setOffset(0)}
            className="btn-pill"
          >
            首页
          </button>
          <button
            type="button"
            disabled={!hasPrev}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            className="btn-pill"
          >
            ← 上一页
          </button>
          <span className="text-xs text-muted tabular-nums">
            第 {page} / {pageCount} 页 · {offset + 1}–
            {Math.min(offset + PAGE_SIZE, total)} 条
          </span>
          <button
            type="button"
            disabled={!hasNext}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
            className="btn-pill"
          >
            下一页 →
          </button>
          <button
            type="button"
            disabled={!hasNext}
            onClick={() => setOffset((pageCount - 1) * PAGE_SIZE)}
            className="btn-pill"
          >
            末页
          </button>
        </nav>
      )}
    </div>
  );
}
