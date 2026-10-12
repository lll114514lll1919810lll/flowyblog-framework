"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SearchIcon } from "@/components/search-icon";
import { useClickOutside } from "@/components/use-click-outside";
import type { SearchIndex } from "@/lib/search-index";
import {
  getCachedIndex,
  loadIndex,
  searchWithFallback,
  snippet,
  strictTokensFor,
} from "@/lib/search-client";

/**
 * 顶栏的内联搜索（快捷搜索）。
 *
 * 控件形态参考 XinBlog（https://xin--blog.pages.dev/ ，MIT 协议）的顶栏设计：
 * 不再是「一个图标按钮 + 弹窗」，而是顶栏里一枚常驻的药丸输入框，
 * 聚焦后正下方弹出结果浮层，边打字边出结果。
 *
 * 匹配逻辑在 lib/search-client.ts，和 /search 独立搜索页共用同一份实现。
 * 这里是「快捷」入口：按文章聚合、最多 12 条；想要完整结果、
 * 标签筛选、可分享的搜索链接，用浮层底部的「查看全部结果」去 /search 页。
 */

export function SiteSearch() {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [index, setIndex] = useState<SearchIndex | null>(getCachedIndex);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [active, setActive] = useState(0);

  const tokens = useMemo(
    () => query.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [query],
  );
  /* 用 deferredQuery 算结果：击键时不必每一下都全量重搜，
     输入本身永远即时（React 推迟的是结果列的更新） */
  const hits = useMemo(
    () =>
      index && deferredQuery.trim()
        ? searchWithFallback(index, deferredQuery).hits
        : [],
    [index, deferredQuery],
  );

  /** 取索引：第一次用到时拉一次，之后走模块缓存 */
  const ensureIndex = useCallback(() => {
    if (getCachedIndex()) {
      setIndex(getCachedIndex());
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

  /* 点浮层之外就收起（共享 hook，见 use-click-outside.ts） */
  useClickOutside(rootRef, open, closePanel);

  /* 快捷键聚焦搜索框：「/」或 Ctrl/Cmd + K。输入框里打字时不抢键 */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const el = document.activeElement;
      // 输入类控件（含可编辑元素、下拉框）聚焦时不抢键
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) {
        return;
      }
      if (event.defaultPrevented) return;

      if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        inputRef.current?.focus();
        openPanel();
        return;
      }
      if ((event.key === "k" || event.key === "K") && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        inputRef.current?.focus();
        openPanel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openPanel]);

  const go = useCallback(
    (hit: (typeof hits)[number]) => {
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

  /** 浮层里没命中时，Enter 转去 /search 页继续搜（那儿有模糊回退和完整结果） */
  const goSearchPage = useCallback(() => {
    const q = query.trim();
    if (!q) return;
    closePanel();
    inputRef.current?.blur();
    router.push(`/search?q=${encodeURIComponent(q)}`);
  }, [closePanel, query, router]);

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
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (hits[active]) go(hits[active]);
      else goSearchPage();
    }
  };

  return (
    <div className="site-search" ref={rootRef}>
      <div className="site-search-pill">
        <SearchIcon className="site-search-icon" />

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
              按 <kbd className="kbd-inline">/</kbd> 或{" "}
              <kbd className="kbd-inline">Ctrl</kbd>
              <kbd className="kbd-inline">K</kbd> 快速聚焦搜索框<br />
              <Link href="/search" className="site-search-hint-link" onClick={closePanel}>
                直接进入搜索页 →
              </Link>
            </p>
          )}

          {status === "idle" && tokens.length > 0 && hits.length === 0 && (
            <p className="site-search-hint">
              没有匹配的内容，
              <Link
                href={`/search?q=${encodeURIComponent(query)}`}
                className="site-search-hint-link"
                onClick={closePanel}
              >
                在搜索页中继续查找 →
              </Link>
            </p>
          )}

          {hits.length > 0 && (
            <>
              <ul className="site-search-list">
                {hits.map((hit, i) => {
                  const { head, parts, tail } = snippet(
                    hit.section.text,
                    strictTokensFor(hit.section.text, tokens),
                    hit.at,
                  );
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
              <Link
                href={`/search?q=${encodeURIComponent(query)}`}
                className="site-search-more"
                onClick={closePanel}
              >
                查看全部结果 →
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
