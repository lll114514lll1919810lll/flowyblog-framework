import fs from "node:fs";
import path from "node:path";
import GithubSlugger from "github-slugger";
import { getAllPosts } from "@/lib/posts";

/**
 * 构建期生成站内搜索索引。
 *
 * 只跑在服务端（用 fs 读 src/content/ 下的 mdx），产物是一个静态 JSON：
 * 见 app/search-index.json/route.ts —— 那个路由带 force-static，
 * build 时就被渲染成静态文件，部署时和 HTML 一样只是静态资源，
 * 所以「搜索」不需要任何后端、数据库或函数计算。
 *
 * 索引按「小节」切分，而不是整篇一团：结果能直接跳到对应锚点
 * （锚点用 github-slugger 生成，和 rehype-slug 是同一套，见下面说明）。
 */

export type SearchSection = {
  id: string; // 锚点 id，空串表示文章开头
  heading: string; // 小节标题，空串表示开头那一段
  text: string; // 纯文本正文
};

export type SearchDoc = {
  slug: string;
  title: string;
  date: string;
  publishedAt?: string;
  description: string;
  tags: string[];
  readingTime: number;
  sections: SearchSection[];
};

export type SearchIndex = {
  version: number;
  docs: SearchDoc[];
};

/** 每个小节最多索引多少个字符：够搜到，也不至于把索引撑大 */
const MAX_SECTION_CHARS = 2000;

/**
 * 把 MDX 抹成纯文本。
 *
 * 顺序有讲究：先删掉 metadata/import/代码块，再处理行内标记——
 * 反过来的话，代码块里的 # 会被当成标题、里面的尖括号会被当成 JSX。
 */
function toPlainText(source: string): string {
  let text = source;

  // 1. metadata 导出块（多行，到顶格的 "};" 结束）
  text = text.replace(/^export const metadata[\s\S]*?^\};$/m, "");

  // 2. import / export 语句
  text = text.replace(/^\s*(import|export)\s.*$/gm, "");

  // 3. 代码围栏连同内容一起丢掉：代码不是用来搜的，
  //    留着会让「foo」「const」这类查询命中一大堆
  text = text.replace(/^```[\s\S]*?^```\s*$/gm, "");
  // 万一有没闭合的围栏，把剩下的也丢掉
  text = text.replace(/^```[\s\S]*$/m, "");

  // 4. JSX/HTML 标签（截图用的 <figure><img> 等）
  text = text.replace(/<[^>]+>/g, " ");

  // 5. 行内标记
  text = text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // 图片 → alt
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // 链接 → 文字
    .replace(/`([^`]*)`/g, "$1") // 行内代码 → 去掉反引号
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/[*_~]/g, "")
    .replace(/^\s*\|.*\|\s*$/gm, (row) =>
      // 表格行：去掉竖线和分隔线，只留单元格文字
      row
        .replace(/^\s*\|/, "")
        .replace(/\|\s*$/, "")
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c && !/^-+$/.test(c))
        .join(" "),
    )
    .replace(/^\s*>\s?/gm, "") // 引用
    .replace(/^\s*[-*+]\s+/gm, "") // 列表符号
    .replace(/^\s*\d+\.\s+/gm, "");

  return text.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
}

/** 生成索引。getAllPosts 已经排除了 draft。 */
export function buildSearchIndex(): SearchIndex {
  const posts = getAllPosts();
  const docs: SearchDoc[] = posts.map((post) => {
    const filePath = path.join(process.cwd(), "src/content", `${post.slug}.mdx`);
    const source = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";

    /*
      锚点必须和 rehype-slug 生成的完全一致：它内部用的就是 github-slugger，
      而且是「同一篇里连续调用」才能正确处理重复标题的 -1、-2 后缀。
      所以这里也用一个全新的 slugger，按标题出现顺序一次走完。
    */
    const slugger = new GithubSlugger();
    const sections: SearchSection[] = [];
    let current: SearchSection = { id: "", heading: "", text: "" };

    let inCodeBlock = false;
    let inMetadata = false;
    for (const rawLine of source.split("\n")) {
      // metadata 是多行对象字面量，必须连对象体一起跳过；
      // 只跳 export 那一行的话，title/date/tags 会当成开头小节的正文进索引
      if (/^export const metadata/.test(rawLine)) {
        inMetadata = true;
        continue;
      }
      if (inMetadata) {
        if (/^\};?\s*$/.test(rawLine)) inMetadata = false;
        continue;
      }
      if (/^\s*```/.test(rawLine)) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock) continue;
      if (/^\s*(import|export)\s/.test(rawLine)) continue;

      const heading = /^(#{2,3})\s+(.+?)\s*#*$/.exec(rawLine);
      if (heading) {
        if (current.text.trim()) sections.push(current);
        const title = heading[2]
          .replace(/`([^`]*)`/g, "$1")
          .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
          .replace(/[*_~]/g, "")
          .trim();
        current = { id: slugger.slug(title), heading: title, text: "" };
        continue;
      }

      current.text += rawLine + "\n";
    }
    if (current.text.trim()) sections.push(current);

    return {
      slug: post.slug,
      title: post.title,
      date: post.date,
      publishedAt: post.publishedAt,
      description: post.description ?? "",
      tags: post.tags ?? [],
      readingTime: post.readingTime ?? 0,
      sections: sections.map((section) => ({
        id: section.id,
        heading: section.heading,
        text: toPlainText(section.text).slice(0, MAX_SECTION_CHARS),
      })),
    };
  });

  return { version: 1, docs };
}
