import type { Metadata } from "next";
import Link from "next/link";
import { getAllTags } from "@/lib/posts";

export const metadata: Metadata = {
  title: "标签",
  description: "按标签浏览文章。",
};

export default function TagsPage() {
  const tags = getAllTags();

  return (
    <div className="flex flex-col gap-10 sm:gap-12">
      <header className="page-hero panel panel-strong flex flex-col gap-4 px-7 py-8 sm:px-10 sm:py-9">
        <p className="eyebrow">TOPICS</p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">标签</h1>
            <p className="mt-3 max-w-xl text-base leading-relaxed text-secondary">
              用主题把零散的文章串起来，找到你此刻想读的内容。
            </p>
          </div>
          <span className="text-sm text-muted">{tags.length} 个主题</span>
        </div>
      </header>

      {tags.length > 0 ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tags.map(({ tag, count }) => (
              <Link
                key={tag}
                href={`/tags/${encodeURIComponent(tag)}`}
                className="panel panel-raised group flex items-center justify-between gap-3 px-5 py-4 transition-colors hover:border-accent/40 hover:bg-panel-strong"
              >
                <span className="font-medium transition-colors group-hover:text-accent">#{tag}</span>
                <span className="rounded-full border border-border px-2 py-1 text-xs tabular-nums text-muted transition-colors group-hover:border-accent/30 group-hover:text-accent">
                  {count}
                </span>
              </Link>
            ))}
          </div>

          <p className="text-[13px] text-muted">
            也可以在{" "}
            <Link href="/blog" className="text-accent hover:opacity-70">
              文章列表页
            </Link>{" "}
            顶部直接筛选。
          </p>
        </>
      ) : (
        <p className="text-sm text-muted">还没有任何标签。</p>
      )}
    </div>
  );
}