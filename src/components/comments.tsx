"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AdminBadge } from "@/components/admin-badge";
import { deleteAdminComment, patchAdminBadge, patchAdminPinned } from "@/lib/admin-comments";
import { refreshAdminSession, useIsAdmin } from "@/lib/admin-session";
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
  /**
   * 1 = 置顶，2 = AI 文章总结（比置顶更靠前），0 = 普通。
   * 后端恒返回 0/1/2，不是布尔；2 只有 AI 总结接口会写。
   */
  pinned: number;
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
  /**
   * 当前访客是否是管理员（决定要不要渲染管理按钮）。
   * 走全局登录态 store（lib/admin-session）：底栏入口每页都会探测一次，
   * 这里复用同一次请求和同一份状态，不再自己发第二条探测。
   */
  const isAdmin = useIsAdmin();

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

  /** 置顶开关正在提交的那条 id（同一时刻只允许一个在飞，避免连点乱序） */
  const [pinBusy, setPinBusy] = useState<number | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  const textRef = useRef<HTMLTextAreaElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  /*
   * 拉取评论 + 探测管理员登录态。
   *
   * 登录态走 refreshAdminSession()：它有模块级并发去重，和底栏的
   * AdminEntry 共用同一次请求；管理员身份对普通访客是一次多余的请求，
   * 但它只做一次签名校验、不查库，代价可以忽略；换来的是管理员登录后
   * 打开文章页就能直接管理，不需要任何额外操作或入口。
   *
   * 所有 setState 都写在 await 之后：effect 里同步 setState 会触发
   * react-hooks/set-state-in-effect（多一轮级联渲染）。
   */
  useEffect(() => {
    const controller = new AbortController();

    void refreshAdminSession();

    (async () => {
      try {
        const listRes = await fetch(`/api/comments?page=${encodeURIComponent(page)}`, {
          headers: { accept: "application/json" },
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

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
   * 后端返回的是扁平列表（id 倒序 = 新在前），这里分成四个部分：
   * 顶层 AI 总结池（pinned=2）、置顶池（pinned=1）、普通池、回复层。
   * 三个顶层池子各自保持后端给的 id 倒序（新在前），
   * 渲染顺序：AI 总结 → 置顶 → 普通。
   * 回复只做两层：后端已经把「回复的回复」归一到根留言，
   * 所以 replyMap 的键一定是顶层留言的 id。
   */
  const aiRoots: Comment[] = [];
  const pinnedRoots: Comment[] = [];
  const normalRoots: Comment[] = [];
  const replyMap = new Map<number, Comment[]>();
  for (const c of comments) {
    if (c.parent_id === null) {
      if (c.pinned === 2) aiRoots.push(c);
      else if (c.pinned === 1) pinnedRoots.push(c);
      else normalRoots.push(c);
    } else {
      const arr = replyMap.get(c.parent_id);
      if (arr) arr.push(c);
      else replyMap.set(c.parent_id, [c]);
    }
  }
  // 顶层是新在前（后端 id 倒序），但一层对话按时间正序读才自然
  for (const arr of replyMap.values()) arr.reverse();

  /* ------------------------------------------------------------ 动作 --- */

  /**
   * 发表（顶层或回复共用）。
   * error 非空表示失败；pending = 服务端开了审核模式、这条进了待审核队列
   * （管理员自己发的会被豁免，pending 为 false）。
   */
  async function post(payload: {
    name: string;
    text: string;
    parentId: number | null;
  }): Promise<{ error: string | null; pending: boolean }> {
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
    if (!res.ok)
      return {
        error: body?.error || "提交失败，请稍后再试",
        pending: false,
      };
    return { error: null, pending: Boolean(body?.pending) };
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
      const result = await post({ name, text: trimmed, parentId: null });
      if (result.error) {
        setNotice(result.error);
        return;
      }
      setText("");
      setNotice(
        result.pending ? "已提交，等待博主审核后才会显示" : "留言成功",
      );
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
      const result = await post({
        name: replyName,
        text: trimmed,
        parentId: replyTo,
      });
      if (result.error) {
        setNotice(result.error);
        return;
      }
      setReplyText("");
      setReplyName("");
      setReplyTo(null);
      setNotice(
        result.pending ? "已提交，等待博主审核后才会显示" : "回复成功",
      );
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
      const r = await deleteAdminComment(id);

      if (r.status === 401) {
        // 会话可能已过期，让全局登录态（含底栏入口）重新探测一次
        void refreshAdminSession();
        setNotice("登录已失效，请重新登录后再试");
        return;
      }
      if (r.status === 0) {
        setNotice("网络异常，删除失败");
        return;
      }
      if (!r.ok) {
        setNotice(r.error || "删除失败");
        return;
      }

      setPendingDelete(null);
      const removed = typeof r.body?.removed === "number" ? r.body.removed : 0;
      setNotice(removed > 1 ? `已删除（含 ${removed - 1} 条回复）` : "已删除");
      setReloadKey((k) => k + 1);
    } finally {
      setDeletingId(null);
    }
  }

  /**
   * 开关某条的管理员徽标。
   *
   * 请求部分与后台 admin-dashboard.tsx 共用（lib/admin-comments.ts），
   * 这里只保留自己的一套状态逻辑：乐观更新 + 失败回滚 + 401 提示
   * （后台那边 401 是跳登录页，两边界面语义不同）。
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
      const r = await patchAdminBadge(id, next);
      if (r.ok) return;

      setComments(prev);
      if (r.status === 401) {
        void refreshAdminSession();
        setNotice("登录已失效，请重新登录后再试");
      } else if (r.status === 0) {
        setNotice("网络异常，徽标设置失败");
      } else {
        setNotice(r.error || "徽标设置失败");
      }
    } finally {
      setBadgeBusy(null);
    }
  }

  /**
   * 置顶/取消置顶某条顶层留言。
   *
   * 请求部分与后台共用（lib/admin-comments.ts），这里保持自己的状态语义：
   * 乐观更新 + 失败回滚 + 401 提示（同 toggleBadge）。后端对回复置顶
   * 返回 400，正常流程到不了——按钮只渲染在顶层留言上。
   */
  async function togglePinned(id: number, next: 0 | 1) {
    if (pinBusy !== null) return;
    setPinBusy(id);
    setNotice("");

    const prev = comments;
    setComments((list) =>
      list.map((c) => (c.id === id ? { ...c, pinned: next } : c)),
    );

    try {
      const r = await patchAdminPinned(id, next);
      if (r.ok) return;

      setComments(prev);
      if (r.status === 401) {
        void refreshAdminSession();
        setNotice("登录已失效，请重新登录后再试");
      } else if (r.status === 0) {
        setNotice("网络异常，置顶设置失败");
      } else {
        setNotice(r.error || "置顶设置失败");
      }
    } finally {
      setPinBusy(null);
    }
  }

  /* ------------------------------------------------------------ 渲染 --- */

  /**
   * 单条留言的头部：昵称、时间、回复与管理操作。
   * isReply 用来区分顶层/回复：置顶标记和置顶按钮只出现在顶层留言上。
   */
  function renderMeta(c: Comment, isReply: boolean) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {/* 字号继承 .comment-item，随文章字号档位缩放 */}
        <span className="flex items-baseline gap-1.5 font-medium">
          {c.name}
          {/* 池子标记所有访客可见：AI 总结/置顶排在评论区最前，
              标记说明「它为什么在这里」。主题色 --accent，
              金色 --gold 已被管理员徽标占用，不混用。
              pinned=2 是 AI 总结，带专用 AI 标记而不是 TOP。 */}
          {c.pinned === 2 ? (
            <span
              title="AI 生成的文章总结"
              className="rounded-full border border-[var(--accent)]/40 px-2 text-xs leading-5 text-[var(--accent)]"
            >
              AI
            </span>
          ) : (
            c.pinned === 1 && (
              <span
                title="博主置顶的留言"
                className="rounded-full border border-[var(--accent)]/40 px-2 text-xs leading-5 text-[var(--accent)]"
              >
                TOP
              </span>
            )
          )}
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
              {/* 置顶开关只在顶层留言上出现（回复没法置顶）。
                  挨着「徽标」放：都是「管理员给这条留言做的标记」，
                  语义上是一组。开着的状态用主题色文字，和 TOP 标记同色。 */}
              {!isReply && (
                <button
                  type="button"
                  aria-pressed={Boolean(c.pinned)}
                  disabled={pinBusy === c.id}
                  onClick={() => togglePinned(c.id, c.pinned ? 0 : 1)}
                  className={`text-xs transition-colors ${
                    c.pinned
                      ? "text-[var(--accent)] hover:text-[var(--accent)]/80"
                      : "text-muted hover:text-[var(--accent)]"
                  }`}
                  title={
                    c.pinned
                      ? "点击取消置顶，这条会回到普通时间流"
                      : "点击置顶这条留言，它会排到评论区最前"
                  }
                >
                  {pinBusy === c.id
                    ? "设置中…"
                    : c.pinned
                      ? "取消置顶"
                      : "置顶"}
                </button>
              )}

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
          /* comment-item：globals.css 按它给昵称和正文提供随文章字号
             档位缩放的字号（时间、按钮等界面元素有自己的 text-xs，不缩放） */
          className={
            isReply
              ? "comment-item panel-raised panel rounded-[var(--radius-panel)] px-4 py-3"
              : "comment-item panel-raised panel rounded-[var(--radius-panel)] px-4 py-4"
          }
        >
          {renderMeta(c, isReply)}
          {/* whitespace-pre-wrap 保留用户输入的换行；
              break-words 防止超长无空格串（URL）撑破面板。
              字号继承 .comment-item，随文章字号档位缩放 */}
          <p className="mt-2 whitespace-pre-wrap break-words leading-relaxed text-secondary">
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

      {status === "ready" && aiRoots.length > 0 && (
        <ul className="mt-6 flex flex-col gap-4">
          {aiRoots.map((c) => (
            <li key={c.id}>{renderComment(c, false)}</li>
          ))}
        </ul>
      )}

      {status === "ready" && pinnedRoots.length > 0 && (
        <ul
          className={`flex flex-col gap-4 ${
            aiRoots.length > 0 ? "mt-4" : "mt-6"
          }`}
        >
          {pinnedRoots.map((c) => (
            <li key={c.id}>{renderComment(c, false)}</li>
          ))}
        </ul>
      )}

      {status === "ready" && normalRoots.length > 0 && (
        <ul
          className={`flex flex-col gap-4 ${
            aiRoots.length > 0 || pinnedRoots.length > 0 ? "mt-4" : "mt-6"
          }`}
        >
          {normalRoots.map((c) => (
            <li key={c.id}>{renderComment(c, false)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
