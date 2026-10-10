import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PostCard } from "@/components/post-card";
import { TagFilterBar } from "@/components/tag-filter-bar";
import {
  formatMonthLabel,
  getAllPosts,
  getAllTags,
  groupPostsByMonth,
} from "@/lib/posts";

export function generateStaticParams() {
  return groupPostsByMonth(getAllPosts()).map(({ month }) => ({ month }));
}

export async function generateMetadata({
  params,
}: PageProps<"/blog/archive/[month]">): Promise<Metadata> {
  const { month } = await params;
  return {
    title: formatMonthLabel(month),
    description: `${formatMonthLabel(month)}发布的全部文章。`,
  };
}

export default async function MonthArchivePage({
  params,
}: PageProps<"/blog/archive/[month]">) {
  const { month } = await params;
  const groups = groupPostsByMonth(getAllPosts());
  const group = groups.find((item) => item.month === month);
  // 月份不存在就 404：这个路径没有入口会指过来，写错了该明确报错
  if (!group) notFound();

  return (
    <div className="flex flex-col gap-10 sm:gap-12">
      <header className="page-hero panel panel-strong flex flex-col gap-4 px-7 py-8 sm:px-10 sm:py-9">
        <p className="eyebrow">MONTHLY ARCHIVE</p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          {formatMonthLabel(group.month)}
        </h1>
        {/* 篇数写进说明句：它修饰的是这个月，单独飘在 hero 右端
            既找不到归属，也和列表页「月份标题 + 篇数」的表达不一致。 */}
        <p className="text-base leading-relaxed text-secondary">
          这个月写下的文章，共 {group.posts.length} 篇。
        </p>
      </header>

      <section className="panel flex flex-col gap-4 px-5 py-5 sm:px-6">
        <div>
          <p className="eyebrow">FILTER BY TOPIC</p>
          <p className="mt-2 text-sm text-secondary">按主题浏览文章</p>
        </div>
        <TagFilterBar tags={getAllTags()} />
      </section>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {group.posts.map((post) => (
          <PostCard key={post.slug} post={post} />
        ))}
      </div>

      {/* 月份之间横向跳转：一次一个月，比回列表再翻页直接 */}
      <MonthPager current={group.month} months={groups.map((g) => g.month)} />
    </div>
  );
}

/**
 * 上一个月 / 下一个月。
 *
 * months 是倒序（新在前），所以「上一个」在数组里是后一个元素。
 * 两端到头就不渲染那一侧——不摆一个点不动的按钮。
 */
function MonthPager({ current, months }: { current: string; months: string[] }) {
  const index = months.indexOf(current);
  const newer = months[index - 1];
  const older = months[index + 1];
  if (!newer && !older) return null;

  return (
    <nav
      aria-label="按月浏览"
      className="flex flex-wrap items-center justify-between gap-3"
    >
      {older ? (
        <Link href={`/blog/archive/${older}`} className="lab-page-link">
          ← {formatMonthLabel(older)}
        </Link>
      ) : (
        <span aria-hidden />
      )}
      {newer ? (
        <Link href={`/blog/archive/${newer}`} className="lab-page-link">
          {formatMonthLabel(newer)} →
        </Link>
      ) : (
        <span aria-hidden />
      )}
    </nav>
  );
}
