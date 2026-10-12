"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { pageItems } from "@/components/pagination";
import { SearchIcon } from "@/components/search-icon";
import type { SearchIndex } from "@/lib/search-index";
import {
  getCachedIndex,
  loadIndex,
  searchSectionsWithFallback,
  snippet,
  strictTokensFor,
  type SectionHit,
} from "@/lib/search-client";

/**
 * 独立搜索页（高级搜索）。
 *
 * 和顶栏的快捷浮层共用 lib/search-client.ts 的同一份匹配逻辑，
 * 区别在于这里：
 * - 查询词、标签、页码都同步到 URL（?q=&tag=&page=），可以分享、收藏、前进后退；
 * - 结果分页展示（每页 20 条命中，控制单页 DOM 量给液态玻璃留性能）；
 * - 带标签筛选；严格零结果时自动落到模糊（子序列）匹配并给出提示。
 */

export function SearchPage() {
  const router = useRouter();
  const params = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState(params.get("q") ?? "");
  const [tag, setTag] = useState(params.get("tag") ?? "");
  const deferredQuery = useDeferredValue(query);
  const [index, setIndex] = useState<SearchIndex | null>(getCachedIndex);
  const [error, setError] = useState(false);

  /* 取索引 + 输入框聚焦：进页面就能直接打字。
     挂载时缓存里没有才发请求；setState 都发生在 fetch 回调里，
     不在 effect 体内同步调用 */
  useEffect(() => {
    inputRef.current?.focus();
    if (getCachedIndex()) return;
    let alive = true;
    loadIndex()
      .then((data) => {
        if (alive) setIndex(data);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  /* 浏览器前进/后退：URL params 变了，渲染期把表单状态追平（React 官方推荐的
     「用前一次的 props 调 render 期 setState」派生状态模式，不用 effect）。
     反过来输入变化时 syncUrl 用原生 history.replaceState 写回 URL——
     replace 不堆历史记录，且写入前比较当前值，params→state→replace 不会成环 */
  const urlQ = params.get("q") ?? "";
  const urlTag = params.get("tag") ?? "";
  const [prevUrl, setPrevUrl] = useState({ q: urlQ, tag: urlTag });
  if (prevUrl.q !== urlQ || prevUrl.tag !== urlTag) {
    setPrevUrl({ q: urlQ, tag: urlTag });
    setQuery(urlQ);
    setTag(urlTag);
  }

  const tokens = useMemo(
    () => query.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [query],
  );

  // 输入路径的 URL 写入做 300ms 防抖（结果筛选本身不走 URL，是即时的）：
  // 快速打字时每次击键都 router.replace 会让 history/路由状态高频抖动
  const urlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (urlTimer.current) clearTimeout(urlTimer.current);
    },
    [],
  );

  const syncUrl = (q: string, t: string) => {
    // 取消尚未触发的防抖写入：点「清空」或切标签后，先前那次击键的
    // 旧查询词不能再迟到地覆盖回 URL
    if (urlTimer.current) {
      clearTimeout(urlTimer.current);
      urlTimer.current = null;
    }
    const usp = new URLSearchParams();
    if (q) usp.set("q", q);
    if (t) usp.set("tag", t);
    // 不带 page：查询词或标签变了，命中的集合就变了，回到第 1 页才合理
    // 用原生 history.replaceState 而不是 router.replace：搜索页每敲一个字
    // 都要同步一次 URL，走 router.replace 是一次真实的路由导航——手机浏览器
    // 上能看到刷新条跑一遍，还会触发 <ViewTransition> 的过渡。replaceState
    // 是纯本地操作：不发请求、不进历史栈、不触发动画；Next 会把
    // useSearchParams 与原生 history 保持同步，前进/后退照常可用。
    // pathname 直接取当前值，天然带上子路径部署的 basePath。
    const qs = usp.toString();
    const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, "", next);
    }
  };

  const syncUrlSoon = (q: string, t: string) => {
    if (urlTimer.current) clearTimeout(urlTimer.current);
    urlTimer.current = setTimeout(() => syncUrl(q, t), 300);
  };

  const { rows, fuzzy } = useMemo(
    () => (index ? searchSectionsWithFallback(index, deferredQuery, { tag }) : { rows: [], fuzzy: false }),
    [index, deferredQuery, tag],
  );

  /*
    分页：page 直接由 URL 驱动（?page=2），不在本地存 state——
    翻页就是一次路由跳转，前进/后退键天然可用。
    页码越界（缩小标签后总页数变少）时钳到有效范围。
    每页条数取 20 是给液态玻璃留的性能余量：结果行挂在 backdrop-filter
    的面板上，一次渲染几百行会让合成器明显掉帧。
  */
  const PAGE_SIZE = 20;
  const urlPage = Number.parseInt(params.get("page") ?? "1", 10) || 1;
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, urlPage), totalPages);
  const pagedRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  /* 翻页用 push 而不是 replace：页与页之间的来回应留在历史里，后退能回去 */
  const navigatePage = (next: number) => {
    if (next === page) return;
    const usp = new URLSearchParams();
    if (urlQ) usp.set("q", urlQ);
    if (urlTag) usp.set("tag", urlTag);
    if (next > 1) usp.set("page", String(next));
    router.push(usp.size ? `/search?${usp}` : "/search");
  };

  /* 按文章分组，保持出现顺序（rows 已按得分/日期排过序）。
     分组在分页切片之后做：跨页的文章两页各显示自己的那部分命中 */
  const groups = useMemo(() => {
    const map = new Map<string, { doc: SectionHit["doc"]; rows: SectionHit[] }>();
    for (const row of pagedRows) {
      const group = map.get(row.doc.slug);
      if (group) group.rows.push(row);
      else map.set(row.doc.slug, { doc: row.doc, rows: [row] });
    }
    return [...map.values()];
  }, [pagedRows]);

  /* 页码按钮序列：窗口算法与文章分页共用一份（pagination.tsx 的 pageItems），
     null 渲染成「…」，两处省略号的出现时机保持一致 */
  const pageButtons = useMemo(
    () => pageItems(page, totalPages).map((n) => n ?? ("…" as const)),
    [page, totalPages],
  );

  /* 标签筛选 chips：索引里出现过的标签，按文章数降序 */
  const tagCounts = useMemo(() => {
    if (!index) return [];
    const counts = new Map<string, number>();
    for (const doc of index.docs) {
      for (const t of doc.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [index]);

  const hasFilter = tokens.length > 0 || tag !== "";

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <header className="page-hero panel panel-strong flex flex-col gap-4 px-7 py-8 sm:px-10 sm:py-9">
        <p className="eyebrow">SEARCH</p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">搜索</h1>
        <div className="search-page-bar">
          <SearchIcon className="search-page-bar-icon" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              // 传原始值不 trim：URL 写回后 useSearchParams 会同步，
              // 派生状态再回写时才能与输入框逐字符一致，不会吃掉
              // 刚打出来的尾部空格（tokens 计算时自己会 trim）
              syncUrlSoon(event.target.value, tag);
            }}
            placeholder="输入关键词搜索文章…"
            aria-label="搜索文章"
            autoComplete="off"
            spellCheck={false}
          />
          {query ? (
            <button
              type="button"
              className="search-page-bar-clear"
              aria-label="清空搜索"
              onClick={() => {
                setQuery("");
                syncUrl("", tag);
                inputRef.current?.focus();
              }}
            >
              ×
            </button>
          ) : (
            <kbd className="search-page-bar-kbd" aria-hidden>
              /
            </kbd>
          )}
        </div>
        <p className="text-sm text-muted">
          多个关键词用空格分隔，全部命中才算匹配。顶栏搜索框也可以随时用（按{" "}
          <kbd className="kbd-inline">/</kbd> 或 <kbd className="kbd-inline">Ctrl</kbd>
          <kbd className="kbd-inline">K</kbd> 聚焦）。
        </p>
      </header>

      {tagCounts.length > 0 && (
        <div className="search-page-tags" role="group" aria-label="按标签筛选">
          {tagCounts.map(([t, count]) => (
            <button
              key={t}
              type="button"
              className="search-page-chip"
              data-active={tag === t ? "true" : undefined}
              onClick={() => {
                const next = tag === t ? "" : t;
                setTag(next);
                syncUrl(query, next);
              }}
            >
              #{t}
              <span className="search-page-chip-count">{count}</span>
            </button>
          ))}
        </div>
      )}

      {!index && !error && <p className="text-sm text-muted">正在读取索引…</p>}
      {error && <p className="text-sm text-muted">索引加载失败，刷新页面再试。</p>}

      {index && !hasFilter && (
        <p className="text-sm text-muted">输入关键词，或点上面的标签开始筛选。</p>
      )}

      {index && hasFilter && rows.length === 0 && (
        <p className="text-sm text-muted">没有匹配的内容，换个词试试。</p>
      )}

      {fuzzy && rows.length > 0 && (
        <p className="search-page-fuzzy-hint">
          没有严格匹配的内容，以下是容错（模糊）匹配的结果。
        </p>
      )}

      {groups.map((group) => {
        const matchedIds = new Set(
          group.rows.filter((row) => row.hasToken).map((row) => row.section.id),
        );
        return (
          <section key={group.doc.slug} className="search-page-group panel">
            <header className="search-page-group-head">
              <Link href={`/blog/${group.doc.slug}`} className="search-page-group-title">
                {group.doc.title}
              </Link>
              <span className="search-page-group-meta">
                {group.doc.date} · {group.doc.readingTime} 分钟
                {matchedIds.size > 1 ? ` · 共 ${matchedIds.size} 处` : ""}
              </span>
            </header>
            <ul className="search-page-hits">
              {group.rows.map((row, i) => {
                const strictTokens = strictTokensFor(row.section.text, tokens);
                const snip = row.at >= 0 ? snippet(row.section.text, strictTokens, row.at) : null;
                return (
                  /* 同一锚点可能被分块成多条，i 保证 key 唯一 */
                  <li key={`${row.section.id}-${i}`}>
                    <Link
                      href={`/blog/${row.doc.slug}${
                        row.section.id ? `#${encodeURIComponent(row.section.id)}` : ""
                      }`}
                      className="search-page-hit"
                    >
                      <span className="search-page-hit-heading">
                        {row.section.heading || "文章开头"}
                      </span>
                      {snip && (
                        <span className="search-page-hit-snippet">
                          {snip.head}
                          {snip.parts.map((part, k) =>
                            part.hit ? <mark key={k}>{part.text}</mark> : <span key={k}>{part.text}</span>,
                          )}
                          {snip.tail}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {totalPages > 1 && (
        <nav className="search-page-pagination" aria-label="搜索结果分页">
          <button
            type="button"
            className="search-page-pagebtn"
            disabled={page <= 1}
            onClick={() => navigatePage(page - 1)}
            aria-label="上一页"
          >
            ← 上一页
          </button>
          {pageButtons.map((num, i) =>
            num === "…" ? (
              <span key={`gap-${i}`} className="search-page-gap" aria-hidden>
                …
              </span>
            ) : (
              <button
                key={num}
                type="button"
                className="search-page-pagebtn"
                data-active={num === page ? "true" : undefined}
                aria-current={num === page ? "page" : undefined}
                onClick={() => navigatePage(num)}
              >
                {num}
              </button>
            ),
          )}
          <button
            type="button"
            className="search-page-pagebtn"
            disabled={page >= totalPages}
            onClick={() => navigatePage(page + 1)}
            aria-label="下一页"
          >
            下一页 →
          </button>
        </nav>
      )}
    </div>
  );
}
