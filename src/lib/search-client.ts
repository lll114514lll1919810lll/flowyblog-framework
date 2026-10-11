import type { SearchDoc, SearchIndex, SearchSection } from "@/lib/search-index";

/**
 * 客户端共享的搜索逻辑：索引拉取与缓存、匹配打分、命中片段。
 *
 * 顶栏的快捷浮层（site-search.tsx）和独立搜索页（search-page.tsx）
 * 都从这儿取同一份实现，免得两处各写一份匹配代码、改了一处漏了另一处。
 *
 * 匹配是纯客户端的子串匹配，没有引第三方搜索库：全站文章量不大，
 * 简单匹配足够，也省掉一个依赖。中文没有词边界，所以按子串匹配而不是分词；
 * 多个关键词用空格分隔，按 AND 处理（都要出现）。
 */

let cached: SearchIndex | null = null;
let inflight: Promise<SearchIndex> | null = null;

const searchIndexPath = process.env.NEXT_PUBLIC_BASE_PATH
  ? `${process.env.NEXT_PUBLIC_BASE_PATH}/search-index.json`
  : "/search-index.json";

/** 模块级缓存的读取口：组件首帧用它初始化 state，避免二次挂载时闪「加载中」 */
export function getCachedIndex(): SearchIndex | null {
  return cached;
}

/** 取索引：第一次用到时拉一次，之后走模块缓存 */
export function loadIndex(): Promise<SearchIndex> {
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

/** 小节级命中：结果平铺到 (文章, 小节)，搜索页用它列出全部命中位置 */
export type SectionHit = {
  doc: SearchDoc;
  section: SearchSection;
  score: number;
  /** 命中位置在正文里的下标；-1 表示没有严格正文命中（只命中标题，或纯模糊命中） */
  at: number;
  /** 该小节是否真的含有查询词；false 表示文章命中、词都落在别处，小节只是落点 */
  hasToken: boolean;
  /** 该文章靠模糊（子序列）匹配才满足 */
  fuzzy: boolean;
};

/** 文章级聚合命中：顶栏浮层用——同一篇只出一条，取最佳小节作落点 */
export type Hit = {
  doc: SearchDoc;
  section: SearchSection;
  score: number;
  at: number;
  /** 该篇文章一共命中几个小节（按锚点 id 去重，长小节分块不会重复计数） */
  matches: number;
  fuzzy: boolean;
};

export type SearchOptions = {
  /** 文章级聚合后的条数上限，默认 12；小节级搜索不截断 */
  limit?: number;
  /** 模糊模式：严格子串没中时按子序列判定（容错个别错字），加分大幅降低 */
  fuzzy?: boolean;
  /** 只看该标签；与查询词取交集，查询词为空时列出该标签全部文章 */
  tag?: string;
};

/** 模糊匹配只处理这么长的词：更长的基本是复制粘贴，没必要容错 */
const FUZZY_MAX_TOKEN = 32;

/** 子序列判定：词的字符在目标里按顺序出现即可（允许跳过个别字符） */
export function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (haystack[j] === needle[i]) i++;
  }
  return i === needle.length;
}

/**
 * 小节级搜索：返回每个含查询词的 (文章, 小节) 组合，一行一条。
 *
 * 匹配语义（和旧版的关键区别）：
 * - AND 是「文章级」的——一个查询词落在标题/标签/简介/任意小节的任何一处
 *   就算被满足；所有词都满足，文章才入选。旧版要求所有词挤在同一个小节，
 *   词分散在几个小节的文章会被整体漏掉。
 * - 落点小节取「含查询词且得分最高」的那个；词全落在标题/标签、或分散在
 *   不同小节时，回退到文章开头小节（hasToken=false，界面不显示摘要）。
 */
export function searchSections(
  index: SearchIndex,
  query: string,
  opts: SearchOptions = {},
): SectionHit[] {
  const { fuzzy = false, tag } = opts;
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length && !tag) return [];

  const rows: SectionHit[] = [];

  for (const doc of index.docs) {
    if (tag && !doc.tags.includes(tag)) continue;

    if (!tokens.length) {
      // 纯标签筛选：列出文章本身，小节只是落点
      const section = doc.sections[0];
      if (section) {
        rows.push({ doc, section, score: 0, at: -1, hasToken: false, fuzzy: false });
      }
      continue;
    }

    const title = doc.title.toLowerCase();
    const tags = doc.tags.join(" ").toLowerCase();
    const desc = doc.description.toLowerCase();

    // 文章级 AND：每个词在字段或任意小节里出现（严格子串；模糊模式下再试子序列）
    const satisfied = tokens.every((token) => {
      if (title.includes(token) || tags.includes(token) || desc.includes(token)) {
        return true;
      }
      for (const s of doc.sections) {
        if (s.heading.toLowerCase().includes(token) || s.text.toLowerCase().includes(token)) {
          return true;
        }
      }
      if (fuzzy && token.length <= FUZZY_MAX_TOKEN) {
        if (
          isSubsequence(token, title) ||
          isSubsequence(token, tags) ||
          isSubsequence(token, desc)
        ) {
          return true;
        }
        for (const s of doc.sections) {
          if (
            isSubsequence(token, s.heading.toLowerCase()) ||
            isSubsequence(token, s.text.toLowerCase())
          ) {
            return true;
          }
        }
      }
      return false;
    });
    if (!satisfied) continue;

    // 字段加分只认严格命中：模糊入选的文章分数天然偏低，排序沉底
    const strictAll = (hay: string) => tokens.every((t) => hay.includes(t));
    const docScore =
      (strictAll(title) ? 20 : 0) + (strictAll(tags) ? 12 : 0) + (strictAll(desc) ? 6 : 0);

    let docRows = 0;

    for (const section of doc.sections) {
      const heading = section.heading.toLowerCase();
      const text = section.text.toLowerCase();
      let score = docScore;
      let at = -1;
      let hasToken = false;

      for (const token of tokens) {
        const inHeading = heading.includes(token);
        const inText = text.indexOf(token);
        if (inHeading) {
          score += 8;
          hasToken = true;
        }
        if (inText !== -1) {
          hasToken = true;
          if (at === -1 || inText < at) at = inText;
        }
        // 严格没中、开了模糊：子序列兜底，加分只有严格的大约三分之一
        if (!inHeading && inText === -1 && fuzzy && token.length <= FUZZY_MAX_TOKEN) {
          if (isSubsequence(token, heading)) {
            score += 3;
            hasToken = true;
          } else if (isSubsequence(token, text)) {
            score += 1;
            hasToken = true;
          }
        }
      }

      if (!hasToken) continue;
      // 只有正文严格命中才给足加分；只命中标题的给一点垫底分
      score += at !== -1 ? 3 : 1;

      rows.push({ doc, section, score, at, hasToken: true, fuzzy });
      docRows++;
    }

    if (docRows === 0) {
      // 词全落在标题/标签/简介上，正文各小节一个都没沾：仍给结果，落开头小节
      const section = doc.sections[0];
      if (section) {
        rows.push({ doc, section, score: docScore, at: -1, hasToken: false, fuzzy });
      }
    }
  }

  return rows.sort(
    (a, b) =>
      b.score - a.score ||
      (b.doc.publishedAt ?? b.doc.date).localeCompare(a.doc.publishedAt ?? a.doc.date) ||
      a.doc.slug.localeCompare(b.doc.slug),
  );
}

/**
 * 文章级搜索：同一篇只出一条，取得分最高的小节作落点。
 * 顶栏浮层用它；「共 N 处」按锚点 id 去重计数。
 */
export function search(
  index: SearchIndex,
  query: string,
  opts: SearchOptions = {},
): Hit[] {
  const { limit = 12, ...rest } = opts;
  const rows = searchSections(index, query, rest);

  const agg = new Map<string, { row: SectionHit; ids: Set<string> }>();
  for (const row of rows) {
    const cur = agg.get(row.doc.slug);
    if (!cur) {
      agg.set(row.doc.slug, {
        row,
        ids: row.hasToken ? new Set([row.section.id]) : new Set(),
      });
      continue;
    }
    if (row.hasToken) cur.ids.add(row.section.id);
    if (row.score > cur.row.score) cur.row = row;
  }

  return [...agg.values()]
    .map(({ row, ids }) => ({
      doc: row.doc,
      section: row.section,
      score: row.score,
      at: row.at,
      matches: ids.size,
      fuzzy: row.fuzzy,
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.doc.publishedAt ?? b.doc.date).localeCompare(a.doc.publishedAt ?? a.doc.date) ||
        a.doc.slug.localeCompare(b.doc.slug),
    )
    .slice(0, limit);
}

/** 严格零结果时再按模糊重跑一遍；fuzzy 标记告知调用方结果是容错过的 */
export function searchWithFallback(
  index: SearchIndex,
  query: string,
  opts: SearchOptions = {},
): { hits: Hit[]; fuzzy: boolean } {
  const hits = search(index, query, opts);
  if (hits.length) return { hits, fuzzy: false };
  const fuzzyHits = search(index, query, { ...opts, fuzzy: true });
  return { hits: fuzzyHits, fuzzy: fuzzyHits.length > 0 };
}

/** searchSections 的模糊回退版，语义同上 */
export function searchSectionsWithFallback(
  index: SearchIndex,
  query: string,
  opts: SearchOptions = {},
): { rows: SectionHit[]; fuzzy: boolean } {
  const rows = searchSections(index, query, opts);
  if (rows.length) return { rows, fuzzy: false };
  const fuzzyRows = searchSections(index, query, { ...opts, fuzzy: true });
  return { rows: fuzzyRows, fuzzy: fuzzyRows.length > 0 };
}

/**
 * 截取命中附近的片段，并把命中的词标出来。
 * 调用方负责只传「在正文里严格命中」的词——纯模糊命中的词没有连续下标可标。
 */
export function snippet(text: string, tokens: string[], at: number) {
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

/** 片段高亮用：只保留在正文里严格命中的词（lower 化后再比，和匹配口径一致） */
export function strictTokensFor(text: string, tokens: string[]): string[] {
  const lower = text.toLowerCase();
  return tokens.filter((t) => lower.includes(t));
}
