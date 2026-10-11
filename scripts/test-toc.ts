import fs from "node:fs";
import path from "node:path";
import { getTableOfContents, getReadingTime, getAllPosts } from "@/lib/posts";

/**
 * 目录锚点必须和 rehype-slug 渲染出来的 id 完全一致，
 * 否则文章目录点击跳转会失效。这个一致性靠两边使用同一个
 * github-slugger 保证，这里用真实渲染的 HTML 做回归验证。
 */

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
}

async function main() {
  // 拿到 dev server 渲染出的真实 id
  const base = process.env.BASE_URL ?? "http://localhost:3000";
  // 取最新一篇文章做锚点一致性检查的样本：换文件名、换文章都不用改这里
  const slug = getAllPosts()[0]?.slug ?? "";
  let html: string | null = null;
  try {
    const res = await fetch(`${base}/blog/${slug}`, { cache: "no-store" });
    // 必须是 200：端口上跑的可能是别的站点（比如另一个项目的 dev server），
    // 它会返回自己的 404 页面，拿那个对比只会得到假失败
    if (res.ok) html = await res.text();
  } catch {
    // 服务器不可用，跳过
  }

  const tocIds = getTableOfContents(slug).map((i) => i.id);

  if (html !== null) {
    console.log("目录锚点一致性（对比真实渲染的 HTML）");

    /*
      页面上带 id 的 h2/h3 不止正文标题：文章末尾还有评论区的
      `<h2 id="comments-heading">留言</h2>`。所以**不能比总数**，
      要比「正文那一段」——正文标题在文档流里排在前面，取同样数量的前缀
      逐个对照即可；这样多出多少个别的区块都不影响。
    */
    const renderedIds = [...html.matchAll(/<h[23][^>]*\sid="([^"]+)"/g)].map(
      (m) => m[1],
    );

    check(
      "正文标题与目录一一对应（顺序也一致）",
      renderedIds.length >= tocIds.length &&
        tocIds.every((id, index) => renderedIds[index] === id),
      `页面前 ${tocIds.length} 个: ${renderedIds.slice(0, tocIds.length).join(", ")}`,
    );

    for (const id of tocIds) {
      check(`目录锚点存在于页面: ${id}`, renderedIds.includes(id));
    }
  } else {
    console.log("跳过锚点一致性检查（dev server 未运行）");
  }

  console.log("\n目录解析");
  const toc = getTableOfContents(slug);
  check("能提取到目录", toc.length > 0);
  check("不包含 h1（标题由页头渲染）", toc.every((i) => i.depth >= 2));

  // 中文标题 id 保留中文：github-slugger 对纯 CJK 文本保留原文。
  // 动态找一段纯中文标题来验证，不写死具体文字——换文章也能跑。
  const cjkHeading = toc.find((i) => /^[\u4e00-\u9fa5]+$/.test(i.text));
  check(
    "中文标题 id 保留中文",
    cjkHeading !== undefined && cjkHeading.id === cjkHeading.text,
    cjkHeading ? `${cjkHeading.text} → ${cjkHeading.id}` : `实际目录: ${toc.map((i) => i.text).join(" / ")}`,
  );

  // 含行内代码的标题：两边都要基于剥离后的纯文本算 slug。
  // toc.text 里反引号已被剥掉，所以从原始源码里找含反引号的标题，
  // 取出代码片段，再到 toc 里核对对应的 id 是否含该片段且不含反引号。
  const raw = getAllPosts().find((p) => p.slug === slug)
    ? fs.readFileSync(path.join(process.cwd(), "src/content", `${slug}.mdx`), "utf8")
    : "";
  const codeHeadingMatch = raw.match(/^#{2,3}\s+.*?`([^`]+)`.*$/m);
  if (codeHeadingMatch) {
    const codePart = codeHeadingMatch[1];
    const inlineCodeHeading = toc.find((i) => i.text.includes(codePart));
    check(
      "含行内代码的标题 slug 基于剥离后的纯文本",
      inlineCodeHeading !== undefined &&
        inlineCodeHeading.id.includes(codePart) &&
        !inlineCodeHeading.id.includes("`"),
      inlineCodeHeading
        ? `${inlineCodeHeading.text} → ${inlineCodeHeading.id}`
        : `代码片段「${codePart}」在 toc 中未找到`,
    );
  } else {
    console.log("  SKIP  含行内代码的标题（最新文章无此类标题）");
  }

  console.log("\n代码块内的 # 不会被误判为标题");
  // 代码块里的 # 是注释，不该进目录。只要目录里没有以 # 开头的文本就行
  // （代码块内的 # 行如果被误判，text 会是 "# ..."）
  check(
    "跳过了代码块内的井号注释",
    !toc.some((i) => /^#/.test(i.text)),
    `实际目录: ${toc.map((i) => i.text).join(" / ")}`,
  );

  console.log("\n阅读时长");
  check("短文本至少 1 分钟", getReadingTime("短") === 1);
  check(
    "长中文文本时长合理",
    getReadingTime("字".repeat(400)) === 1 && getReadingTime("字".repeat(800)) === 2,
  );

  console.log("\n草稿过滤");
  check("文章列表非空", getAllPosts().length > 0);
  check("不含 draft 文章", getAllPosts().every((p) => !p.draft));

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  // 不用 process.exit 强退：上面 fetch 成功时 undici 的 keep-alive 连接还开着，
  // Windows 上强退会触发 libuv 的 UV_HANDLE_CLOSING 断言崩溃（退出码非 0，
  // 看起来像测试失败）。设置 exitCode 后让空闲连接自然关闭、事件循环排空。
  process.exitCode = failed > 0 ? 1 : 0;
}

main();