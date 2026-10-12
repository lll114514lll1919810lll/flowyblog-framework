import fs from "node:fs";
import path from "node:path";
import GithubSlugger from "github-slugger";
import { withAssetVersion } from "@/lib/asset-version";

/**
 * 博客的内容层。
 *
 * 设计要点：
 * 1. 文章是 src/content/ 下的 .mdx 文件，不需要数据库或后台。
 * 2. 每篇文章用 `export const metadata = {...}` 声明元信息（等价于 YAML frontmatter，
 *    但 MDX 原生支持，无需 gray-matter 之类的依赖）。
 * 3. 本文件只运行在服务端（Node 环境），因为它用了 fs。
 */

const POSTS_DIR = path.join(process.cwd(), "src/content");

/** 构建期内全量文章只读一次磁盘：列表/标签/归档/sitemap 都会反复调用 getAllPosts */
let postsCache: Post[] | null = null;

export type PostMetadata = {
  title: string;
  date: string; // YYYY-MM-DD
  publishedAt?: string; // ISO 8601，精确到发布时间，用于同日排序
  description?: string;
  /** 封面图路径（public 下的绝对路径，如 "/images/cover.png"）。不写则用按 slug 生成的图形封面 */
  cover?: string;
  tags?: string[];
  draft?: boolean;
};

export type Post = PostMetadata & {
  slug: string; // 文件名（不含扩展名），也是 URL 的一部分
  readingTime?: number; // 估算阅读时长（分钟）
};

function isPostFile(fileName: string): boolean {
  return fileName.endsWith(".mdx") && !fileName.startsWith("_");
}

/** 取出目录下所有文章的元信息，按日期倒序（最新在前）。 */
export function getAllPosts(): Post[] {
  if (postsCache) return postsCache;
  if (!fs.existsSync(POSTS_DIR)) return [];

  const files = fs.readdirSync(POSTS_DIR).filter(isPostFile);

  const posts = files.map((fileName): Post => {
    const slug = fileName.replace(/\.mdx$/, "");
    const raw = fs.readFileSync(path.join(POSTS_DIR, fileName), "utf8");
    return {
      ...parseMetadata(raw),
      slug,
      readingTime: getReadingTime(raw),
    };
  });

  postsCache = posts
    .filter((post) => !post.draft)
    .sort((a, b) => {
      const byPublishedAt = (b.publishedAt ?? b.date).localeCompare(
        a.publishedAt ?? a.date,
      );
      return byPublishedAt || a.slug.localeCompare(b.slug);
    });
  return postsCache;
}

/** 根据 slug 取单篇文章的元信息；找不到返回 null。 */
export function getPostBySlug(slug: string): Post | null {
  const filePath = path.join(POSTS_DIR, `${slug}.mdx`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf8");
  return {
    ...parseMetadata(raw),
    slug,
    readingTime: getReadingTime(raw),
  };
}

/* ---------------------------------------------------------------- 目录 --- */

export type TocItem = {
  id: string; // 对应标题元素的 id，用于锚点跳转
  text: string;
  depth: 2 | 3; // 只收录 h2 / h3，h1 已被页头占用
};

/**
 * 去掉 LaTeX 公式源码（$...$ 行内、$$...$$ 块级）。
 *
 * 目录和搜索索引都从 MDX 源码提取标题，而标题会被 remark-math 渲染成公式：
 * 不去掉公式源码的话，两处算出的锚点都和渲染结果对不上，跳转会失效。
 * 两边必须共用同一份实现（见 getTableOfContents / buildSearchIndex）。
 *
 * 顺序有讲究，不能乱：
 * 1. 正文里的字面美元按书写规范写成 \$（见 10-latex.mdx 的说明），
 *    先换成占位符保护起来，否则第 3 步会把它当成公式定界符、
 *    把货币金额之类的文本一并吃掉；
 * 2. 成对的 $$...$$ 整块换掉（[\s\S] 让它可以跨行）；
 * 3. 未闭合的 $$ 删掉至文末（书写错误时的兜底）；
 * 4. 剩下的成对 $...$ 换掉；
 * 5. 占位符还原成 $。
 */
export function stripMath(text: string): string {
  // 不可能出现在正文里的标记串做占位符
  const PLACEHOLDER = "__FLOWYBLOG_DOLLAR__";
  return text
    .replace(/\\\$/g, PLACEHOLDER)
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/\$\$[\s\S]*$/, " ")
    .replace(/\$[^$\n]+?\$/g, " ")
    .replaceAll(PLACEHOLDER, "$");
}

/**
 * 从 MDX 源码里提取目录。
 *
 * 关键点：锚点 id 必须和 rehype-slug 实际渲染出来的 id 一致，否则点击跳转失效。
 * rehype-slug 内部用的就是 github-slugger，所以这里也用同一个库、
 * 同一个实例顺序（同一个 slugger 连续调用才能正确处理重复标题的 -1、-2 后缀）。
 * 标题清洗与公式块跳过规则和 search-index.ts 的锚点提取保持同一份（见 stripMath）。
 */
export function getTableOfContents(slug: string): TocItem[] {
  const filePath = path.join(POSTS_DIR, `${slug}.mdx`);
  if (!fs.existsSync(filePath)) return [];

  const source = fs.readFileSync(filePath, "utf8");
  const slugger = new GithubSlugger();
  const items: TocItem[] = [];

  // 逐行匹配 Markdown 标题，跳过代码块和公式块内部（``` 之间的 # 不是标题，
  // $$ 块里的内容也不会渲染成标题）
  let inCodeBlock = false;
  let inMathBlock = false;
  for (const line of source.split("\n")) {
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    if (/^\s*\$\$\s*$/.test(line)) {
      inMathBlock = !inMathBlock;
      continue;
    }
    if (inMathBlock) continue;

    const match = /^(#{2,3})\s+(.+?)\s*#*$/.exec(line);
    if (!match) continue;

    const depth = match[1].length as 2 | 3;
    const text = stripMath(
      match[2]
        // 去掉行内代码和链接语法，只留纯文本
        .replace(/`([^`]*)`/g, "$1")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[*_~]/g, ""),
    ).trim();

    if (text) items.push({ id: slugger.slug(text), text, depth });
  }

  return items;
}

/* ------------------------------------------------------------ 阅读时长 --- */

/**
 * 估算阅读时长。中文字数按 400 字/分钟算，比英文的 200 词/分钟更接近实际。
 * 只用作提示，不追求精确。
 */
export function getReadingTime(source: string): number {
  // 先去掉代码块和标记符号，避免把代码算进字数
  const text = source
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[#*_>\-\[\]()]/g, " ");

  const cjk = text.match(/[一-龥]/g)?.length ?? 0;
  const words = text.match(/[a-zA-Z0-9]+/g)?.length ?? 0;

  return Math.max(1, Math.round(cjk / 400 + words / 200));
}

/** 标签及其文章数，按文章数从多到少。 */
export type TagCount = { tag: string; count: number };

export function getAllTags(): TagCount[] {
  const counts = new Map<string, number>();

  for (const post of getAllPosts()) {
    for (const tag of post.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function getPostsByTag(tag: string): Post[] {
  return getAllPosts().filter((post) => post.tags?.includes(tag));
}

/* ------------------------------------------------------- 按月归档 / 分页 --- */

/**
 * 每页多少篇。
 *
 * 6 是照着桌面三列定的：正好两行，一屏看完不用滚。手机一列时六张会长一些，
 * 但列表页本来就是往下划的，可以接受。
 */
export const PAGE_SIZE = 6;

/** 单月的归档：YYYY-MM 与它下面的文章（沿用 getAllPosts 的倒序） */
export type MonthGroup = {
  month: string; // YYYY-MM
  posts: Post[];
};

/**
 * 按月份分组，月份也按倒序（新月份在前）。
 *
 * 用 date 的前七位，不走 Intl/Date 解析：date 是定长 "YYYY-MM-DD"，切一下
 * 最直接，也不会被时区影响（new Date("2026-10-05") 会按 UTC 解析，某些时区
 * 上会算出上一个月）。
 */
export function groupPostsByMonth(posts: Post[]): MonthGroup[] {
  const groups = new Map<string, Post[]>();
  for (const post of posts) {
    const month = post.date.slice(0, 7);
    const bucket = groups.get(month);
    if (bucket) bucket.push(post);
    else groups.set(month, [post]);
  }
  return [...groups.entries()]
    .map(([month, bucket]) => ({ month, posts: bucket }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

/** 分页后的结果。page 从 1 开始 */
export type PagedPosts = {
  posts: Post[];
  page: number;
  totalPages: number;
  totalPosts: number;
  /** 本页文章按月分组后的样子（可能横跨两个月） */
  months: MonthGroup[];
};

/**
 * 取某一页的文章。页码超出范围时夹回合法范围（永远返回某一页），不抛——
 * 超范围 URL 的 404 由分页路由自己把关。
 *
 * 页码从 1 开始而不是 0：它会出现在 URL 和「第 N 页」的文案里，
 * /blog/1 比 /blog/0 自然。
 */
export function getPagedPosts(page: number): PagedPosts {
  const all = getAllPosts();
  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  // 防御：NaN / 负数 / 超过总数都夹回合法范围，避免算出空页或负偏移
  const safePage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  const posts = all.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  return {
    posts,
    page: safePage,
    totalPages,
    totalPosts: all.length,
    months: groupPostsByMonth(posts),
  };
}

/** 一共有几页。构建期枚举分页路由用 */
export function getTotalPages(): number {
  return Math.max(1, Math.ceil(getAllPosts().length / PAGE_SIZE));
}

/**
 * 月份的中文标题，如 2026-10 → "2026 年 10 月"。
 *
 * 不走 toLocaleDateString：那个的输出随运行时 locale 变化（"October 2026"、
 * "2026年10月"），而静态产物要在不同机器上都一致。
 */
export function formatMonthLabel(month: string): string {
  const [year, m] = month.split("-");
  return `${year} 年 ${Number(m)} 月`;
}

/**
 * 从 MDX 源码里定位 `export const metadata = { ... }` 的对象体（含两端花括号）。
 * 没有 metadata 或括号未闭合时返回 null。
 *
 * 用括号配对而不是「匹配到行首的 }」：单行写法、值里带花括号、嵌套的
 * 数组/对象都能正确处理。字符串字面量（单引号/双引号/模板串）里的括号
 * 不参与配对。posts.ts（解析元信息）和 search-index.ts（跳过 metadata 块）
 * 共用这一份实现，避免各自的跳过规则漂移。
 */
export function extractMetadataBlock(source: string): string | null {
  const decl = /export\s+const\s+metadata\b/.exec(source);
  if (!decl) return null;
  const open = source.indexOf("{", decl.index + decl[0].length);
  if (open === -1) return null;

  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") i++; // 跳过转义字符
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}

/**
 * 从 MDX 源码里读取 `export const metadata = { ... }`。
 *
 * 这里做轻量解析而不是真的去执行/导入 MDX——因为列表页只需要元信息，
 * 不需要渲染正文。执行 MDX 会把整篇文章都编译进构建产物，代价高且没必要。
 * 只解析元信息 + 真正渲染正文时才 import，两者职责分开。
 */
function parseMetadata(source: string): PostMetadata {
  const block = extractMetadataBlock(source);

  if (!block) {
    // 兜底：即使作者忘了写 metadata，也不要让整个列表页崩掉
    return { title: "未命名文章", date: "1970-01-01" };
  }

  // 对象字面量本身就是合法的 JS 表达式：单引号、值里的撇号（"won't"）、
  // 尾逗号、嵌套结构都交给 JS 引擎处理。不要做字符串预清洗——早期版本
  // 的 .replace(/'/g, '"') 会把双引号值里的撇号替换坏，解析失败后整篇
  // 文章静默落到「未命名文章 / 1970-01-01」。
  try {
    const value = new Function(`return (${block})`)() as PostMetadata;
    return {
      title: value.title ?? "未命名文章",
      date: value.date ?? "1970-01-01",
      publishedAt: value.publishedAt,
      description: value.description,
      cover: value.cover ? withAssetVersion(value.cover) : undefined,
      tags: value.tags,
      draft: value.draft,
    };
  } catch {
    return { title: "未命名文章", date: "1970-01-01" };
  }
}