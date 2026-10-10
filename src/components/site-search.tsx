"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SearchDoc, SearchIndex, SearchSection } from "@/lib/search-index";

/**
 * 站内搜索。
 *
 * 索引是构建期生成的静态 JSON（/search-index.json），这里只在用户第一次
 * 打开搜索时 fetch 一次，之后缓存在模块变量里——不走后端，也不进页面 JS 包。
 *
 * 匹配是纯客户端的子串匹配，没有引第三方搜索库：全站不到十篇文章，
 * 简单匹配足够，也省掉一个依赖。中文没有词边界，所以按子串匹配而不是分词；
 * 多个关键词用空格分隔，按 AND 处理（都要出现）。
 */

let cached: SearchIndex | null = null;
let inflight: Promise<SearchIndex> | null = null;

function loadIndex(): Promise<SearchIndex> {
  if (cached) return Promise.resolve(cached);
  inflight ??= fetch("/search-index.json")
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error("索引加载失败"))))
    .then((data: SearchIndex) => {
      cached = data;
      return data;
    })
    .catch((error) => {
      inflight = null; // 失败别把坏 promise 留在缓存里
      throw error;
    });
  return inflight;
}

type Hit = {
  doc: SearchDoc;
  section: SearchSection;
  score: number;
  /** 命中位置在正文里的下标；-1 表示只命中标题/标签 */
  at: number;
  /** 该篇文章一共命中几个小节。结果按文章聚合，这个数只用来提示「还有别处」 */
  matches: number;
};

/** 打分：标题/标签 > 小节标题 > 正文；同分按日期新的在前 */
function search(index: SearchIndex, query: string, limit = 12): Hit[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];

  const hits: Omit<Hit, "matches">[] = [];
  for (const doc of index.docs) {
    const title = doc.title.toLowerCase();
    const tags = doc.tags.join(" ").toLowerCase();
    const desc = doc.description.toLowerCase();

    let docScore = 0;
    if (tokens.every((t) => title.includes(t))) docScore += 20;
    if (tokens.every((t) => tags.includes(t))) docScore += 12;
    if (tokens.every((t) => desc.includes(t))) docScore += 6;

    for (const section of doc.sections) {
      const text = section.text.toLowerCase();
      const heading = section.heading.toLowerCase();
      let score = docScore;
      let at = -1;
      let ok = true;

      for (const token of tokens) {
        const inText = text.indexOf(token);
        const inHeading = heading.indexOf(token);
        if (inText === -1 && inHeading === -1) {
          ok = false;
          break;
        }
        if (inHeading !== -1) score += 8;
        if (inText !== -1 && (at === -1 || inText < at)) at = inText;
      }
      if (!ok) continue;
      // 只命中标题、正文没有：仍然给出结果，但排在后面
      score += at === -1 ? 1 : 3;
      hits.push({ doc, section, score, at });
    }
  }

  /*
    按文章聚合：同一篇只出一条结果，取得分最高的那个小节作为落点。
    不聚合的话，一篇长文会在列表里刷出一大片（实测「代理池」一次出 6 条，
    全是同一篇的不同小节），既占地方又让别的文章没有露出机会。
    另外记下命中了几节，界面上提示「共 N 处」，不至于让人以为只有这一处。
  */
  const best = new Map<string, Hit>();
  for (const hit of hits) {
    const prev = best.get(hit.doc.slug);
    if (!prev) {
      best.set(hit.doc.slug, { ...hit, matches: 1 });
      continue;
    }
    // 计数加一；只有新小节分数更高时才换落点
    best.set(
      hit.doc.slug,
      hit.score > prev.score
        ? { ...hit, matches: prev.matches + 1 }
        : { ...prev, matches: prev.matches + 1 },
    );
  }

  return [...best.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.doc.publishedAt ?? b.doc.date).localeCompare(
          a.doc.publishedAt ?? a.doc.date,
        ) ||
        a.doc.slug.localeCompare(b.doc.slug),
    )
    .slice(0, limit);
}

/** 截取命中附近的片段，并把命中的词标出来 */
function snippet(text: string, tokens: string[], at: number) {
  const start = Math.max(0, at - 40);
  const raw = text.slice(start, start + 150);
  const head = start > 0 ? "…" : "";
  const tail = start + 150 < text.length ? "…" : "";

  const lower = raw.toLowerCase();
  const parts: { text: string; hit: boolean }[] = [];
  let cursor = 0;
  while (cursor < raw.length) {
    let nextAt = -1;
    let nextLen = 0;
    for (const token of tokens) {
      const idx = lower.indexOf(token, cursor);
      if (idx !== -1 && (nextAt === -1 || idx < nextAt)) {
        nextAt = idx;
        nextLen = token.length;
      }
    }
    if (nextAt === -1) {
      parts.push({ text: raw.slice(cursor), hit: false });
      break;
    }
    if (nextAt > cursor) parts.push({ text: raw.slice(cursor, nextAt), hit: false });
    parts.push({ text: raw.slice(nextAt, nextAt + nextLen), hit: true });
    cursor = nextAt + nextLen;
  }
  return { head, parts, tail };
}

export function SiteSearch() {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /* 按下时是否落在遮罩上。用来区分「点遮罩关闭」和「在框内选字、拖到框外松手」 */
  const pressedBackdrop = useRef(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<SearchIndex | null>(cached);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [active, setActive] = useState(0);

  const tokens = useMemo(
    () => query.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [query],
  );
  const hits = useMemo(
    () => (index && tokens.length ? search(index, query) : []),
    [index, query, tokens.length],
  );

  const openDialog = useCallback(() => {
    setOpen(true);
    setActive(0);
    dialogRef.current?.showModal();
    document.documentElement.style.overflow = "hidden";
    // 预热索引：打开的同时开始拉，用户开始打字时通常已经好了
    if (!cached) {
      setStatus("loading");
      loadIndex()
        .then((data) => {
          setIndex(data);
          setStatus("idle");
        })
        .catch(() => setStatus("error"));
    }
  }, []);

  /**
   * 收尾：解锁背景滚动、清状态。幂等，重复调用无害。
   *
   * 必须同时挂在 dialog 的原生 cancel / close 上，而不是用 React 的 onClose：
   * close 事件是**异步排队**触发的（规范如此），在不出帧的环境里它迟迟不跑，
   * 结果就是「按 Esc 关了、页面却还锁着滚动」。图片预览那里踩过同一个坑。
   * cancel 在按 Esc 时同步触发，用它兜底。
   */
  const finishClose = useCallback(() => {
    document.documentElement.style.overflow = "";
    setOpen(false);
  }, []);

  const closeDialog = useCallback(() => {
    dialogRef.current?.close();
    finishClose();
  }, [finishClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.addEventListener("cancel", finishClose);
    dialog.addEventListener("close", finishClose);
    return () => {
      dialog.removeEventListener("cancel", finishClose);
      dialog.removeEventListener("close", finishClose);
    };
  }, [finishClose]);

  /* 「/」快速打开：输入框里打字时不抢键 */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (dialogRef.current?.open) return;
      event.preventDefault();
      openDialog();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openDialog]);

  /* 打开后自动聚焦输入框 */
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((v) => Math.min(v + 1, Math.max(hits.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((v) => Math.max(v - 1, 0));
    } else if (event.key === "Enter" && hits[active]) {
      event.preventDefault();
      const hit = hits[active];
      closeDialog();
      // 客户端导航；带锚点时浏览器会滚到对应小节
      router.push(
        `/blog/${hit.doc.slug}${
          hit.section.id ? `#${encodeURIComponent(hit.section.id)}` : ""
        }`,
      );
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        aria-label="搜索文章"
        title="搜索文章（/）"
        className="site-search-trigger"
      >
        <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden>
          <circle cx="8" cy="8" r="5.2" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M12 12l3.4 3.4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <dialog
        ref={dialogRef}
        className="site-search"
        aria-label="站内搜索"
        /*
          关闭判定不能用 click：click 发生在 mousedown 和 mouseup 的**共同祖先**上，
          在输入框里按下、拖到框外松手，也会产生一个 target 是 dialog 的 click，
          于是「选个文字就把弹窗弄没了」。
          改成按下和松开都必须落在遮罩（dialog 自身）上才关闭。
          用 pointer 事件，鼠标/触摸/手写笔一套逻辑。
        */
        onPointerDown={(event) => {
          pressedBackdrop.current = event.target === dialogRef.current;
        }}
        onPointerUp={(event) => {
          if (pressedBackdrop.current && event.target === dialogRef.current) closeDialog();
          pressedBackdrop.current = false;
        }}
      >
        <div className="site-search-box">
          <div className="site-search-field">
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden>
              <circle cx="8" cy="8" r="5.2" stroke="currentColor" strokeWidth="1.6" />
              <path
                d="M12 12l3.4 3.4"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                // 换了关键词就把高亮行收回第一条
                setActive(0);
              }}
              onKeyDown={onInputKeyDown}
              placeholder="搜索文章标题、标签或正文…"
              aria-label="搜索关键词"
              autoComplete="off"
            />
            <kbd className="site-search-kbd">Esc</kbd>
          </div>

          <div className="site-search-results" role="listbox" aria-label="搜索结果">
            {status === "loading" && <p className="site-search-hint">正在读取索引…</p>}
            {status === "error" && (
              <p className="site-search-hint">索引加载失败，刷新页面再试。</p>
            )}

            {status === "idle" && !tokens.length && (
              <p className="site-search-hint">
                输入关键词开始搜索。多个关键词用空格分隔，全部命中才算匹配。
                <br />
                按 <kbd className="site-search-kbd">/</kbd> 可以随时打开这里。
              </p>
            )}

            {status === "idle" && tokens.length > 0 && hits.length === 0 && (
              <p className="site-search-hint">没有匹配的内容，换个词试试。</p>
            )}

            {hits.length > 0 && (
              <ul className="site-search-list">
                {hits.map((hit, i) => {
                  const { head, parts, tail } = snippet(hit.section.text, tokens, hit.at);
                  return (
                    <li key={`${hit.doc.slug}-${hit.section.id}`}>
                      <Link
                        href={`/blog/${hit.doc.slug}${
                          hit.section.id ? `#${encodeURIComponent(hit.section.id)}` : ""
                        }`}
                        className="site-search-item"
                        data-active={i === active ? "true" : undefined}
                        onMouseEnter={() => setActive(i)}
                        onClick={closeDialog}
                      >
                        <span className="site-search-title">{hit.doc.title}</span>
                        <span className="site-search-meta">
                          {hit.doc.date} · {hit.doc.readingTime} 分钟
                          {hit.section.heading ? ` · ${hit.section.heading}` : ""}
                          {hit.matches > 1 ? ` · 共 ${hit.matches} 处` : ""}
                        </span>
                        {hit.at >= 0 && (
                          <span className="site-search-snippet">
                            {head}
                            {parts.map((part, k) =>
                              part.hit ? <mark key={k}>{part.text}</mark> : <span key={k}>{part.text}</span>,
                            )}
                            {tail}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
