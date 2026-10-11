"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SearchDoc, SearchIndex, SearchSection } from "@/lib/search-index";

/**
 * 顶栏的内联搜索。
 *
 * 控件形态参考 XinBlog（https://xin--blog.pages.dev/ ，MIT 协议）的顶栏设计：
 * 不再是「一个图标按钮 + 弹窗」，而是顶栏里一枚常驻的药丸输入框，
 * 聚焦后正下方弹出结果浮层，边打字边出结果。
 *
 * 索引仍是构建期生成的静态 JSON（/search-index.json），只在第一次用到时
 * 拉一次，之后缓存在模块变量里——不走后端，也不进页面 JS 包。
 *
 * 匹配是纯客户端的子串匹配，没有引第三方搜索库：全站不到十篇文章，
 * 简单匹配足够，也省掉一个依赖。中文没有词边界，所以按子串匹配而不是分词；
 * 多个关键词用空格分隔，按 AND 处理（都要出现）。
 */

let cached: SearchIndex | null = null;
let inflight: Promise<SearchIndex> | null = null;
const searchIndexPath =
  process.env.NEXT_PUBLIC_BASE_PATH
    ? `${process.env.NEXT_PUBLIC_BASE_PATH}/search-index.json`
    : "/search-index.json";

function loadIndex(): Promise<SearchIndex> {
  if (cached) return Promise.resolve(cached);
  inflight ??= fetch(searchIndexPath)
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
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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

  /** 取索引：第一次用到时拉一次，之后走模块缓存 */
  const ensureIndex = useCallback(() => {
    if (cached) {
      setIndex(cached);
      return;
    }
    setStatus("loading");
    loadIndex()
      .then((data) => {
        setIndex(data);
        setStatus("idle");
      })
      .catch(() => setStatus("error"));
  }, []);

  const openPanel = useCallback(() => {
    setOpen(true);
    setActive(0);
    ensureIndex();
  }, [ensureIndex]);

  const closePanel = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
  }, []);

  /* 点浮层之外就收起。用 pointerdown：鼠标/触摸/手写笔一套逻辑，
     且比 click 早一步，避免「点别处先触发那边的行为、浮层才关」的错位 */
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  /* 「/」快速聚焦搜索框：输入框里打字时不抢键 */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      inputRef.current?.focus();
      openPanel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openPanel]);

  const go = useCallback(
    (hit: Hit) => {
      closePanel();
      inputRef.current?.blur();
      // 客户端导航；带锚点时浏览器会滚到对应小节
      router.push(
        `/blog/${hit.doc.slug}${
          hit.section.id ? `#${encodeURIComponent(hit.section.id)}` : ""
        }`,
      );
    },
    [closePanel, router],
  );

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePanel();
      inputRef.current?.blur();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((v) => Math.min(v + 1, Math.max(hits.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((v) => Math.max(v - 1, 0));
    } else if (event.key === "Enter" && hits[active]) {
      event.preventDefault();
      go(hits[active]);
    }
  };

  return (
    <div className="site-search" ref={rootRef}>
      <div className="site-search-pill">
        <svg
          className="site-search-icon"
          width="16"
          height="16"
          viewBox="0 0 18 18"
          fill="none"
          aria-hidden
        >
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
            setActive(0);
            if (!open) openPanel();
          }}
          onFocus={openPanel}
          onKeyDown={onInputKeyDown}
          placeholder="搜索文章…"
          aria-label="搜索文章"
          role="combobox"
          aria-expanded={open}
          aria-controls="site-search-results"
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
        />

        {query ? (
          <button
            type="button"
            className="site-search-clear"
            aria-label="清空搜索"
            onClick={() => {
              setQuery("");
              setActive(0);
              inputRef.current?.focus();
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <path
                d="M2.5 2.5l7 7M9.5 2.5l-7 7"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        ) : (
          <kbd className="site-search-kbd" aria-hidden>
            /
          </kbd>
        )}
      </div>

      {open && (
        <div
          className="site-search-dropdown"
          id="site-search-results"
          role="listbox"
          aria-label="搜索结果"
        >
          {status === "loading" && <p className="site-search-hint">正在读取索引…</p>}
          {status === "error" && (
            <p className="site-search-hint">索引加载失败，刷新页面再试。</p>
          )}

          {status === "idle" && !tokens.length && (
            <p className="site-search-hint">
              输入关键词搜索文章。多个关键词用空格分隔，全部命中才算匹配。
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
                      onClick={closePanel}
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
      )}
    </div>
  );
}
