import type { Metadata } from "next";
import { PostArchive } from "@/components/post-archive";
import { getAllTags, getPagedPosts } from "@/lib/posts";

export const metadata: Metadata = {
  title: "文章",
  description: "全部文章列表，按月归档，可按标签筛选。",
};

/** 第一页。分页后的页面在 /blog/page/[page] */
export default function BlogPage() {
  return (
    <BlogListPage page={1} />
  );
}

/*
  列表页和分页页共用这一段，只是页码不同。

  放在同一个文件里而不是另开组件：两者共用的只是「取数据 + 页头 + 归档区」，
  而页头本身就是这一页的一部分，拆出去反而要把标题、描述传来传去。
*/
function BlogListPage({ page }: { page: number }) {
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
