import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PostArchive } from "@/components/post-archive";
import { getAllTags, getPagedPosts, getTotalPages } from "@/lib/posts";

/*
  静态导出下，分页路由必须在构建期枚举出来——没有 Node 服务器可以按请求
  生成页面。所以这里用 generateStaticParams 把 2..N 页都列出来。

  第 1 页不在这里：它走 /blog（列表页本身），/blog/page/1 只是它的一个
  别名，两个 URL 指向同一份内容对 SEO 是负担。
*/
export function generateStaticParams() {
  /*
    第 1 页也列进来（内容是 /blog 的同一份），不为 SEO——只是为了让这个数组
    永远非空。

    静态导出下 generateStaticParams() 返回空数组会直接构建失败（"at least
    one route must be generated"）。而文章少于 PAGE_SIZE 时本来就只有一页，
    只列 2..N 就会是空的，删几篇文章就会构建挂掉。多生成一个 /blog/page/1
    的代价远小于这个隐患。

    /blog 仍是列表的主入口：它不带 /page/1 这个多余的层级，首页和导航都链
    到它；这里只是多了一份可达的副本，并给它 canonical 指回 /blog。
  */
  const total = getTotalPages();
  return Array.from({ length: Math.max(1, total) }, (_, i) => ({
    page: String(i + 1),
  }));
}

export async function generateMetadata({
  params,
}: PageProps<"/blog/page/[page]">): Promise<Metadata> {
  const { page } = await params;
  const n = Number(page);
  const title = n <= 1 ? "文章" : `文章 · 第 ${n} 页`;
  return {
    title,
    description: n <= 1 ? "全部文章列表。" : `文章列表第 ${n} 页。`,
    // /blog/page/1 是 /blog 的副本，告诉搜索引擎以 /blog 为准
    alternates: n <= 1 ? { canonical: "/blog" } : undefined,
  };
}

export default async function BlogPagedPage({
  params,
}: PageProps<"/blog/page/[page]">) {
  const { page: raw } = await params;
  const page = Number(raw);
  // 页码不是正整数、或者超出范围，直接 404：
  // 这些 URL 没人会链过来，静默显示空列表会让人以为站点坏了
  if (!Number.isInteger(page) || page < 1 || page > getTotalPages()) notFound();

  const paged = getPagedPosts(page);
  const tags = getAllTags();

  return (
    <div className="flex flex-col gap-10 sm:gap-12">
      <header className="page-hero panel panel-strong flex flex-col gap-4 px-7 py-8 sm:px-10 sm:py-9">
        <p className="eyebrow">ALL WRITINGS</p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">文章</h1>
            <p className="mt-3 max-w-xl text-base leading-relaxed text-secondary">
              从实践出发，记录技术、产品和那些值得慢慢想清楚的事情。按月归档。
            </p>
          </div>
          <span className="text-sm text-muted">{paged.totalPosts} 篇文章</span>
        </div>
      </header>

      <PostArchive paged={paged} tags={tags} />
    </div>
  );
}
