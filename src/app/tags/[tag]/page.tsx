import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PostCard } from "@/components/post-card";
import { TagFilterBar } from "@/components/tag-filter-bar";
import { getAllTags, getPostsByTag } from "@/lib/posts";

export function generateStaticParams() {
  return getAllTags().map(({ tag }) => ({ tag }));
}

export async function generateMetadata({
  params,
}: PageProps<"/tags/[tag]">): Promise<Metadata> {
  const { tag } = await params;
  const decoded = decodeURIComponent(tag);
  return {
    title: `#${decoded}`,
    description: `标签 ${decoded} 下的全部文章。`,
  };
}

export default async function TagPage({ params }: PageProps<"/tags/[tag]">) {
  const { tag } = await params;
  const decoded = decodeURIComponent(tag);
  const posts = getPostsByTag(decoded);

  // 标签存在但没有文章时不 404，只给空状态提示：
  // 一个标签在 /tags 页面上有入口，点进来就该看到明确反馈而不是 404
  if (!getAllTags().some((t) => t.tag === decoded)) notFound();

  return (
    <div className="flex flex-col gap-10 sm:gap-12">
      <header className="page-hero panel panel-strong flex flex-col gap-4 px-7 py-8 sm:px-10 sm:py-9">
        <p className="eyebrow">TOPIC ARCHIVE</p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              <span className="text-accent">#</span>
              {decoded}
            </h1>
            <p className="mt-3 text-base leading-relaxed text-secondary">
              这个主题下的文章与记录。
            </p>
          </div>
          <span className="text-sm text-muted">{posts.length} 篇文章</span>
        </div>
      </header>

      <section className="panel flex flex-col gap-4 px-5 py-5 sm:px-6">
        <div>
          <p className="eyebrow">EXPLORE TOPICS</p>
          <p className="mt-2 text-sm text-secondary">切换到其他主题</p>
        </div>
        <TagFilterBar tags={getAllTags()} activeTag={decoded} />
      </section>

      {/* 卡片各自是独立面板，靠间距分隔（不再用分隔线）。
          与文章列表页、首页「最近更新」保持同一套：1 / 2 / 3 列 */}
      {posts.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <PostCard key={post.slug} post={post} />
          ))}
        </div>
      ) : (
        <p className="py-8 text-sm text-muted">
          这个标签下还没有文章。{" "}
          <Link href="/blog" className="text-accent hover:opacity-70">
            看看全部文章 →
          </Link>
        </p>
      )}
    </div>
  );
}