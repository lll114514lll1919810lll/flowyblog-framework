import { PostArchive } from "@/components/post-archive";
import { getAllTags, getPagedPosts } from "@/lib/posts";

/**
 * 文章列表页本体：页头 + 归档区。
 *
 * /blog（列表页）和 /blog/page/[page]（分页页）共用这一份——
 * 两者的差别只在页码和 metadata，渲染内容完全相同。
 * 放在 components 而不是某个 page 文件里：App Router 的 page 文件
 * 不允许导出默认页面之外的组件，两边也没法互相 import。
 */
export function BlogListPage({ page }: { page: number }) {
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
