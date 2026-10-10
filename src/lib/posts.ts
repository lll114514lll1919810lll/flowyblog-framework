import fs from "node:fs";
import path from "node:path";
import GithubSlugger from "github-slugger";

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

export type PostMetadata = {
  title: string;
  date: string; // YYYY-MM-DD
  publishedAt?: string; // ISO 8601，精确到发布时间，用于同日排序
  description?: string;
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

  return posts
    .filter((post) => !post.draft)
    .sort((a, b) => {
      const byPublishedAt = (b.publishedAt ?? b.date).localeCompare(
        a.publishedAt ?? a.date,
      );
      return byPublishedAt || a.slug.localeCompare(b.slug);
    });
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
 * 从 MDX 源码里提取目录。
 *
 * 关键点：锚点 id 必须和 rehype-slug 实际渲染出来的 id 一致，否则点击跳转失效。
 * rehype-slug 内部用的就是 github-slugger，所以这里也用同一个库、
 * 同一个实例顺序（同一个 slugger 连续调用才能正确处理重复标题的 -1、-2 后缀）。
 */
export function getTableOfContents(slug: string): TocItem[] {
  const filePath = path.join(POSTS_DIR, `${slug}.mdx`);
  if (!fs.existsSync(filePath)) return [];

  const source = fs.readFileSync(filePath, "utf8");
  const slugger = new GithubSlugger();
  const items: TocItem[] = [];

  // 逐行匹配 Markdown 标题，跳过代码块内部（``` 之间的 # 不是标题）
  let inCodeBlock = false;
  for (const line of source.split("\n")) {
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = /^(#{2,3})\s+(.+?)\s*#*$/.exec(line);
    if (!match) continue;

    const depth = match[1].length as 2 | 3;
    const text = match[2]
      // 去掉行内代码和链接语法，只留纯文本
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_~]/g, "")
      .trim();

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

/** 所有标签及其文章数，按文章数从多到少。 */
/** 标签及其文章数 */
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
 * 取某一页的文章。页码超出范围时返回空列表，不抛——页面那边自己给空状态。
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
 * 从 MDX 源码里提取 `export const metadata = { ... }` 的内容。
 *
 * 这里用正则做一次轻量解析，而不是真的去执行/导入 MDX——因为列表页只需要元信息，
 * 不需要渲染正文。执行 MDX 会把整篇文章都编译进构建产物，代价高且没必要。
 * 只解析元信息 + 真正渲染正文时才 import，两者职责分开。
 */
function parseMetadata(source: string): PostMetadata {
  const match = source.match(
    /export\s+const\s+metadata\s*(?::[^=]+)?=\s*(\{[\s\S]*?\n\})\s*;?/,
  );

  if (!match) {
    // 兜底：即使作者忘了写 metadata，也不要让整个列表页崩掉
    return { title: "未命名文章", date: "1970-01-01" };
  }

  // 把对象字面量转成可执行代码来读取，只接受字符串/数字/数组/布尔
  const jsonLike = match[1]
    // 单引号 → 双引号
    .replace(/'/g, '"')
    // 去掉属性名和字符串值之外的尾逗号
    .replace(/,(\s*[}\]])/g, "$1");

  try {
    const value = new Function(`return ${jsonLike}`)() as PostMetadata;
    return {
      title: value.title ?? "未命名文章",
      date: value.date ?? "1970-01-01",
      publishedAt: value.publishedAt,
      description: value.description,
      tags: value.tags,
      draft: value.draft,
    };
  } catch {
    return { title: "未命名文章", date: "1970-01-01" };
  }
}