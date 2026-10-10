"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AdminBadge } from "@/components/admin-badge";
import { absoluteTime, relativeTime } from "@/lib/time";

/**
 * 文章底部的评论区。
 *
 * 这是全站**唯一**需要服务端的地方：页面本身仍然是静态预渲染的 HTML，
 * 评论在浏览器里向 /api/comments 取。对应后端是 functions/api/comments.js
 * （Cloudflare Pages Functions + D1），不进 Next 构建，所以静态导出不受影响。
 *
 * 三件事在同一处完成：
 * 1. 读取与发表（访客）
 * 2. 回复——只做两层，回复「回复」时后端会归一到根留言，见下
 * 3. 管理——登录后每一条旁边直接出现删除按钮，不必跳去 /admin
 *
 * 三种拿不到数据的场景要分开对待，提示语完全不同：
 * - 本地 pnpm dev：没有 Functions，接口 404 → 给出启动命令
 * - 线上没配 D1 绑定：接口 503 → 直接用后端返回的说明
 * - 网络抖动：fetch 抛异常 → 提示重试
 * 全都归成一句「加载失败」的话，排查时会很痛苦。
 */

type Comment = {
  id: number;
  /** null = 顶层留言；非空 = 所回复的顶层留言 id */
  parent_id: number | null;
  name: string;
  text: string;
  /** 1 = 管理员在后台给这条开了金色徽标。后端恒返回 0/1，不是布尔 */
  admin_badge: number;
  created_at: string; // ISO 8601（后端已在 SQL 里转好）
};

type Status = "loading" | "ready" | "unavailable" | "error";

const MAX_TEXT = 500;
const MAX_NAME = 24;

export function Comments({ page }: { page: string }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  /**
   * 全站评论锁（后台 /admin 可拨）。
   *
   * 只用来决定界面显示什么：表单换成一句说明、回复按钮收起来。
   * 真正的强制在服务端（POST 一律 403），所以这里判断错了也不会漏评论。
   */
  const [locked, setLocked] = useState(false);
  const [notice, setNotice] = useState("");
  /** 是否跑在本机（决定显示开发者提示还是访客提示） */
  const [isLocal, setIsLocal] = useState(false);
  /** 当前访客是否是管理员（决定要不要渲染管理按钮） */
  const [isAdmin, setIsAdmin] = useState(false);

  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  /** 正在回复哪一条（null = 没打开回复框） */
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [replyName, setReplyName] = useState("");
  const [replyText, setReplyText] = useState("");
  const [replySubmitting, setReplySubmitting] = useState(false);

  /** 等待二次确认删除的 id */
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  /** 徽标开关正在提交的那条 id（同一时刻只允许一个在飞，避免连点乱序） */
  const [badgeBusy, setBadgeBusy] = useState<number | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  const textRef = useRef<HTMLTextAreaElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  /*
   * 拉取评论 + 判断是否管理员。
   *
   * 两个请求并行：管理员身份对普通访客是一次多余的请求，但它只做一次
   * 签名校验、不查库，代价可以忽略；换来的是管理员登录后打开文章页
   * 就能直接管理，不需要任何额外操作或入口。
   *
   * 所有 setState 都写在 await 之后：effect 里同步 setState 会触发
   * react-hooks/set-state-in-effect（多一轮级联渲染）。
   */
  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        const [listRes, sessionRes] = await Promise.all([
          fetch(`/api/comments?page=${encodeURIComponent(page)}`, {
            headers: { accept: "application/json" },
            signal: controller.signal,
          }),
          // 会话探测失败不该拖垮评论区，单独兜住
          fetch("/api/admin/session", {
            headers: { accept: "application/json" },
            signal: controller.signal,
          }).catch(() => null),
        ]);

        if (controller.signal.aborted) return;

        if (sessionRes?.ok) {
          const s = await sessionRes.json().catch(() => null);
          if (controller.signal.aborted) return;
          setIsAdmin(Boolean(s?.authenticated));
        }

        // 404：本地 pnpm dev 没有 Functions；503：线上没配 D1 绑定
        if (listRes.status === 404 || listRes.status === 503) {
          const body = await listRes.json().catch(() => null);
          if (controller.signal.aborted) return;
          setNotice(body?.error || "");
          // 线上页面只对访客说一句人话，具体原因留在 console 供站主排查
          console.warn(
            `[comments] 接口不可用（HTTP ${listRes.status}）：${body?.error || "无详细信息"}`,
          );
          setIsLocal(
            /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname),
          );
          setStatus("unavailable");
          return;
        }
        if (!listRes.ok) throw new Error(String(listRes.status));

        /*
          返回形状是 { items, locked }：列表和「全站评论锁」的状态一起给，
          前端不必多发一个请求去问现在能不能留言。

          后端出错时会返回错误对象而不是这个形状，这里挡一道，
          否则下面的分组会直接抛错、整块评论变成白屏。
        */
        const payload = await listRes.json();
        const list = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.items)
            ? payload.items
            : null;
        if (!list) throw new Error("bad payload");

        if (controller.signal.aborted) return;
        setComments(list);
        setLocked(Boolean(payload?.locked));
        setStatus("ready");
      } catch {
        if (controller.signal.aborted) return;
        setStatus("error");
      }
    })();

    return () => controller.abort();
  }, [page, reloadKey]);

  /* ------------------------------------------------------------ 分组 --- */

  /*
   * 后端返回的是扁平列表（id 倒序 = 新在前），这里分成顶层和回复两层。
   * 回复只做两层：后端已经把「回复的回复」归一到根留言，
   * 所以 replyMap 的键一定是顶层留言的 id。
   */
  const roots: Comment[] = [];
  const replyMap = new Map<number, Comment[]>();
  for (const c of comments) {
    if (c.parent_id === null) {
      roots.push(c);
    } else {
      const arr = replyMap.get(c.parent_id);
      if (arr) arr.push(c);
      else replyMap.set(c.parent_id, [c]);
    }
  }
  // 顶层是新在前（后端 id 倒序），但一层对话按时间正序读才自然
  for (const arr of replyMap.values()) arr.reverse();

  /* ------------------------------------------------------------ 动作 --- */

  /** 发表（顶层或回复共用）。返回错误信息，null 表示成功。 */
  async function post(payload: {
    name: string;
    text: string;
    parentId: number | null;
  }): Promise<string | null> {
    const res = await fetch("/api/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        page,
        name: payload.name,
        text: payload.text,
        ...(payload.parentId ? { parent_id: payload.parentId } : {}),
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return body?.error || "提交失败，请稍后再试";
    return null;
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    const trimmed = text.trim();
    if (!trimmed) {
      setNotice("留言内容不能为空");
      textRef.current?.focus();
      return;
    }

    setSubmitting(true);
    setNotice("");
    try {
      const err = await post({ name, text: trimmed, parentId: null });
      if (err) {
        setNotice(err);
        return;
      }
      setText("");
      setNotice("留言成功");
      setReloadKey((k) => k + 1);
    } catch {
      setNotice("提交失败，请检查网络后重试");
    } finally {
      setSubmitting(false);
    }
  }

  async function onReplySubmit(event: React.FormEvent) {
    event.preventDefault();
    if (replySubmitting || replyTo === null) return;

    const trimmed = replyText.trim();
    if (!trimmed) {
      setNotice("回复内容不能为空");
      replyRef.current?.focus();
      return;
    }

    setReplySubmitting(true);
    setNotice("");
    try {
      const err = await post({
        name: replyName,
        text: trimmed,
        parentId: replyTo,
      });
      if (err) {
        setNotice(err);
        return;
      }
      setReplyText("");
      setReplyName("");
      setReplyTo(null);
      setNotice("回复成功");
      setReloadKey((k) => k + 1);
    } catch {
      setNotice("提交失败，请检查网络后重试");
    } finally {
      setReplySubmitting(false);
    }
  }

  async function remove(id: number) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/comments?id=${id}`, {
        method: "DELETE",
      });

      if (res.status === 401) {
        setIsAdmin(false);
        setNotice("登录已失效，请重新登录后再试");
        return;
      }

      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setNotice(body?.error || "删除失败");
        return;
      }

      setPendingDelete(null);
      setNotice(
        body?.removed > 1 ? `已删除（含 ${body.removed - 1} 条回复）` : "已删除",
      );
      setReloadKey((k) => k + 1);
    } catch {
      setNotice("网络异常，删除失败");
    } finally {
      setDeletingId(null);
    }
  }

  /**
   * 开关某条的管理员徽标。
   *
   * 和后台 admin-dashboard.tsx 里的同名函数逻辑一致（乐观更新 + 失败回滚），
   * 没抽成共用 hook：两边改的是各自的 state（这里是 comments，后台是 items），
   * 类型和分页处理也不同，抽出来要为两个调用方做泛型适配，比复制十行更绕。
   */
  async function toggleBadge(id: number, next: 0 | 1) {
    if (badgeBusy !== null) return;
    setBadgeBusy(id);
    setNotice("");

    const prev = comments;
    setComments((list) =>
      list.map((c) => (c.id === id ? { ...c, admin_badge: next } : c)),
    );

    try {
      const res = await fetch("/api/admin/comments", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, admin_badge: next }),
      });

      if (res.status === 401) {
        setComments(prev);
        setIsAdmin(false);
        setNotice("登录已失效，请重新登录后再试");
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setComments(prev);
        setNotice(body?.error || "徽标设置失败");
      }
    } catch {
      setComments(prev);
      setNotice("网络异常，徽标设置失败");
    } finally {
      setBadgeBusy(null);
    }
  }

  /* ------------------------------------------------------------ 渲染 --- */

  /** 单条留言的头部：昵称、时间、回复与管理操作 */
  function renderMeta(c: Comment) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="flex items-baseline gap-1.5 text-sm font-medium">
          {c.name}
          {/* 徽标跟昵称在同一个 span 里：两者是「谁说的」这一个意思的两半，
              中间那个 gap-x-3（12px）会把它们拆成两组信息。 */}
          {Boolean(c.admin_badge) && <AdminBadge />}
        </span>
        <time
          dateTime={c.created_at}
          title={absoluteTime(c.created_at)}
          className="text-xs text-muted"
        >
          {relativeTime(c.created_at)}
        </time>
        <span className="ml-auto flex items-center gap-2">
          {/* 锁上时连「回复」按钮都不给：留一个点开必然失败的输入框，
              比直接没有更让人困惑 */}
          {!locked && (
            <button
              type="button"
              onClick={() => {
                setReplyTo(replyTo === c.id ? null : c.id);
                setNotice("");
              }}
              className="text-xs text-muted transition-colors hover:text-accent"
            >
              {replyTo === c.id ? "取消" : "回复"}
            </button>
          )}

          {isAdmin && (
            <>
              {/* 徽标开关挨着「删除」放：管理员在文章页写完自己的回复，
                  顺手标一下就行，不必跳去 /admin 再搜那条。
                  开着的状态用金色文字，和昵称旁的徽标同一颜色，
                  一眼能看出这条当前是开还是关。 */}
              <button
                type="button"
                aria-pressed={Boolean(c.admin_badge)}
                disabled={badgeBusy === c.id}
                onClick={() => toggleBadge(c.id, c.admin_badge ? 0 : 1)}
                className={`text-xs transition-colors ${
                  c.admin_badge
                    ? "text-[var(--gold)] hover:text-[var(--gold)]/80"
                    : "text-muted hover:text-[var(--gold)]"
                }`}
                title={
                  c.admin_badge
                    ? "点击取消这条的管理员徽标"
                    : "点击在这条昵称旁显示金色管理员徽标"
                }
              >
                {badgeBusy === c.id ? "设置中…" : c.admin_badge ? "取消徽标" : "加徽标"}
              </button>

              <button
                type="button"
                onClick={() => setPendingDelete(pendingDelete === c.id ? null : c.id)}
                className="text-xs text-muted transition-colors hover:text-red-600 dark:hover:text-red-400"
              >
                删除
              </button>
            </>
          )}
        </span>
      </div>
    );
  }

  /** 管理员的二次确认条；删顶层留言时会提示将连带删掉几条回复 */
  function renderDeleteConfirm(c: Comment, replyCount: number) {
    if (pendingDelete !== c.id) return null;
    return (
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2 rounded-[var(--radius-panel)] border border-red-500/25 bg-red-500/5 px-3 py-2">
        <span className="text-xs text-muted">
          {replyCount > 0
            ? `确定删除？该留言下的 ${replyCount} 条回复会一并删掉。`
            : "确定删除这条留言？"}
        </span>
        <button
          type="button"
          disabled={deletingId === c.id}
          onClick={() => remove(c.id)}
          className="btn-pill text-red-600 dark:text-red-400"
        >
          {deletingId === c.id ? "删除中…" : "确认删除"}
        </button>
        <button
          type="button"
          onClick={() => setPendingDelete(null)}
          className="btn-pill"
        >
          取消
        </button>
      </div>
    );
  }

  /** 回复表单。同一时刻只开一个，所以共用一份 state。 */
  function renderReplyForm(target: Comment) {
    if (replyTo !== target.id) return null;
    return (
      <form onSubmit={onReplySubmit} className="mt-3 flex flex-col gap-2">
        <label className="sr-only" htmlFor={`reply-name-${target.id}`}>
          昵称（可留空）
        </label>
        <input
          id={`reply-name-${target.id}`}
          type="text"
          value={replyName}
          maxLength={MAX_NAME}
          onChange={(e) => setReplyName(e.target.value)}
          placeholder={`回复 ${target.name}（昵称可留空）`}
          className="field-input"
        />

        <label className="sr-only" htmlFor={`reply-text-${target.id}`}>
          回复内容
        </label>
        <textarea
          id={`reply-text-${target.id}`}
          ref={replyRef}
          value={replyText}
          rows={3}
          maxLength={MAX_TEXT}
          onChange={(e) => setReplyText(e.target.value)}
          placeholder="写下你的回复…"
          className="field-input resize-y"
        />

        <div className="flex items-center justify-end gap-2">
          <span className="text-xs text-muted tabular-nums">
            {replyText.length}/{MAX_TEXT}
          </span>
          <button
            type="submit"
            disabled={replySubmitting}
            className="btn-pill"
          >
            {replySubmitting ? "发送中…" : "发送回复"}
          </button>
        </div>
      </form>
    );
  }

  /** 一条留言（含它的回复与管理控件）。isReply 只影响缩进层级。 */
  function renderComment(c: Comment, isReply: boolean) {
    const replies = replyMap.get(c.id) ?? [];
    const replyCount = replies.length;

    return (
      <div key={c.id}>
        <article
          className={
            isReply
              ? "panel-raised panel rounded-[var(--radius-panel)] px-4 py-3"
              : "panel-raised panel rounded-[var(--radius-panel)] px-4 py-4"
          }
        >
          {renderMeta(c)}
          {/* whitespace-pre-wrap 保留用户输入的换行；
              break-words 防止超长无空格串（URL）撑破面板 */}
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-secondary">
            {c.text}
          </p>
          {renderDeleteConfirm(c, replyCount)}
        </article>

        {renderReplyForm(c)}

        {!isReply && replyCount > 0 && (
          <ul className="mt-3 flex flex-col gap-3 border-l border-border pl-4">
            {replies.map((r) => (
              <li key={r.id}>{renderComment(r, true)}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const total = comments.length;

  return (
    <section
      aria-labelledby="comments-heading"
      className="mt-12 border-t border-border pt-8"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">DISCUSSION</p>
          <h2 id="comments-heading" className="mt-2 text-xl font-semibold">
            留言
            {status === "ready" && total > 0 && (
              <span className="ml-2 text-sm font-normal text-muted">{total}</span>
            )}
          </h2>
        </div>

        {isAdmin ? (
          // 管理员看到的是「身份 + 出口」，而不是「你也能留言」那句提示
          <p className="text-xs text-muted">
            <span className="text-accent">管理员</span> · 可直接删除下方留言 ·{" "}
            <Link href="/admin" className="underline underline-offset-2 hover:text-accent">
              全部留言
            </Link>
          </p>
        ) : (
          status === "ready" &&
          (locked ? (
            <p className="text-xs text-muted">博主已暂停接受新评论</p>
          ) : (
            <p className="text-xs text-muted">无需登录，昵称可留空</p>
          ))
        )}
      </div>

      {/*
        锁上时用一段说明替掉整个表单。

        不是 disabled：一个灰掉的输入框会让人以为是自己的问题（没填对、
        网络差），而事实是博主关了评论。说清楚比留个能点不能用的框好。
      */}
      {status === "ready" && locked && (
        <p className="mt-6 text-sm leading-relaxed text-muted">
          这篇文章的留言已暂停——博主关闭了新评论。已有留言仍然可以看。
        </p>
      )}

      {/* 表单：只有服务可用时才呈现，避免本地开发看到一个必然失败的输入框 */}
      {status === "ready" && !locked && (
        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
          <label className="sr-only" htmlFor="comment-name">
            昵称（可留空）
          </label>
          <input
            id="comment-name"
            type="text"
            value={name}
            maxLength={MAX_NAME}
            onChange={(e) => setName(e.target.value)}
            placeholder="昵称（可留空，默认「路人」）"
            autoComplete="nickname"
            className="field-input"
          />

          <label className="sr-only" htmlFor="comment-text">
            留言内容
          </label>
          <textarea
            id="comment-text"
            ref={textRef}
            value={text}
            rows={4}
            maxLength={MAX_TEXT}
            onChange={(e) => setText(e.target.value)}
            placeholder="说点什么…"
            className="field-input resize-y"
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* aria-live：提交结果要让读屏用户也听得到 */}
            <p aria-live="polite" className="min-h-5 text-xs text-muted">
              {notice}
            </p>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted tabular-nums">
                {text.length}/{MAX_TEXT}
              </span>
              <button type="submit" disabled={submitting} className="btn-pill">
                {submitting ? "发送中…" : "发表"}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* 状态提示 */}
      {status === "loading" && (
        <p className="mt-6 text-sm text-muted">正在加载留言…</p>
      )}

      {/*
        服务不可用时分两种口吻：
        - 本机开发：给出具体原因和启动命令，否则浪费时间猜
        - 线上：只对访客说一句人话。后端的报错（缺 D1 绑定之类）是给站主看的，
          直接晾在页面上访客只会困惑，所以写进 console 供排查。
      */}
      {status === "unavailable" &&
        (isLocal ? (
          <p className="mt-6 text-sm text-muted">
            {notice || "评论服务尚未配置。"}
            <span className="mt-1 block text-xs">
              本地预览请用{" "}
              <code className="rounded bg-surface px-1">
                npx wrangler pages dev out
              </code>
              ，直接 <code className="rounded bg-surface px-1">pnpm dev</code>{" "}
              不会启动接口。
            </span>
          </p>
        ) : (
          <p className="mt-6 text-sm text-muted">留言功能暂时不可用，稍后再来看看。</p>
        ))}

      {status === "error" && (
        <div className="mt-6">
          <p className="text-sm text-muted">留言加载失败。</p>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="btn-pill mt-3"
          >
            重试
          </button>
        </div>
      )}

      {/* 列表 */}
      {status === "ready" && total === 0 && (
        <p className="mt-6 text-sm text-muted">还没有留言，来做第一个。</p>
      )}

      {status === "ready" && roots.length > 0 && (
        <ul className="mt-6 flex flex-col gap-4">
          {roots.map((c) => (
            <li key={c.id}>{renderComment(c, false)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
