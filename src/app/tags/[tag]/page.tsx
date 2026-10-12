import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PostCard } from "@/components/post-card";
import { TagFilterBar } from "@/components/tag-filter-bar";
import { getAllTags, getPostsByTag } from "@/lib/posts";

export function generateStaticParams() {
  return getAllTags().map(({ tag }) => ({ tag }));
}

/**
 * App Router 传入的 params 已是解码后的值，这里再 decode 一次只是为了兼容
 * 双重编码的历史链接。含「%」的标签（如「100%」）解码会抛 URIError，
 * 失败时原样返回——标签本身是合法文本，不该让整页 500。
 */
function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function generateMetadata({
  params,
}: PageProps<"/tags/[tag]">): Promise<Metadata> {
  const { tag } = await params;
  const decoded = safeDecode(tag);
  return {
    title: `#${decoded}`,
    description: `标签 ${decoded} 下的全部文章。`,
  };
}

export default async function TagPage({ params }: PageProps<"/tags/[tag]">) {
  const { tag } = await params;
  const decoded = safeDecode(tag);

  // 先查标签存在性再取文章：不存在的标签直接 404，不必白算一次筛选。
  // getAllTags 与 getPostsByTag 出自同一批文章，通过检查后 posts 必然非空
  if (!getAllTags().some((t) => t.tag === decoded)) notFound();
  const posts = getPostsByTag(decoded);

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
          与文章列表页、首页「最近更新」保持同一套：1 / 2 / 3 列。
          上面的存在性检查保证了 posts 非空，不需要空状态分支。 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {posts.map((post) => (
          <PostCard key={post.slug} post={post} />
        ))}
      </div>
    </div>
  );
}