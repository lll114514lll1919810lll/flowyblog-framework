import Link from "next/link";
import { PostCard } from "@/components/post-card";
import { Pagination } from "@/components/pagination";
import { TagFilterBar } from "@/components/tag-filter-bar";
import {
  formatMonthLabel,
  type MonthGroup,
  type PagedPosts,
  type TagCount,
} from "@/lib/posts";

/**
 * 文章归档的主体：标签筛选 + 按月分组的卡片 + 翻页。
 *
 * /blog 和 /blog/page/[n] 用的是同一块，所以抽出来——两边只差页码，
 * 布局、分组、空状态都该一模一样，抄两遍迟早会走样。
 */
export function PostArchive({
  paged,
  tags,
}: {
  paged: PagedPosts;
  tags: TagCount[];
}) {
  const { months, page, totalPages, totalPosts } = paged;

  return (
    <div className="flex flex-col gap-10 sm:gap-12">
      <section className="panel flex flex-col gap-4 px-5 py-5 sm:px-6">
        <div>
          <p className="eyebrow">FILTER BY TOPIC</p>
          <p className="mt-2 text-sm text-secondary">按主题浏览文章</p>
        </div>
        <TagFilterBar tags={tags} />
      </section>

      {months.length > 0 ? (
        <div className="flex flex-col gap-10 sm:gap-12">
          {months.map((group: MonthGroup) => (
            <MonthSection key={group.month} group={group} />
          ))}
        </div>
      ) : (
        <p className="py-8 text-sm text-muted">这一页没有文章。</p>
      )}

      {/*
        翻页放在列表下面。上面那块页头已经写了「共 N 篇」，
        这里不再重复计数，只给页码——重复的数字反而让人不知道该看哪个。
      */}
      <Pagination page={page} totalPages={totalPages} />

      {totalPages > 1 && (
        <p className="text-center text-xs text-muted">
          第 {page} / {totalPages} 页，共 {totalPosts} 篇
        </p>
      )}
    </div>
  );
}

/**
 * 一个月份的分组。
 *
 * 月份标题做成链接而不是纯文字：目前只有一个月，但月份多了之后，
 * 想直接看某个月是很自然的需求。
 */
function MonthSection({ group }: { group: MonthGroup }) {
  return (
    <section className="flex flex-col gap-4">
      {/* 篇数贴着标题排，不和标题分居两端：这个数字说明的是「这个月几篇」，
          推到容器右缘后两者隔着一整行，视线得跨过去才能对上号。
          基线对齐、弱化字号，读起来是标题的附属信息，和筛选栏的「技术 7」同一种表达。 */}
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 className="text-lg font-semibold">
          <Link
            href={`/blog/archive/${group.month}`}
            className="transition-colors hover:text-accent"
          >
            {formatMonthLabel(group.month)}
          </Link>
        </h2>
        <span className="text-xs tabular-nums text-muted">
          {group.posts.length} 篇
        </span>
      </div>

      {/* 卡片各自是独立面板，靠间距分隔。
          手机 1 列、平板 2 列、电脑 3 列：768px 下三列每张只剩 ~230px，
          封面和标题会挤成一团，所以三列从 lg(1024px) 才开始。 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {group.posts.map((post) => (
          <PostCard key={post.slug} post={post} />
        ))}
      </div>
    </section>
  );
}
