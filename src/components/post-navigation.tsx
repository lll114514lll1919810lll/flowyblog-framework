import Link from "next/link";
import type { Post } from "@/lib/posts";

/**
 * 文章末尾的「上一篇 / 下一篇」。
 *
 * getAllPosts 已按日期倒序排列，所以当前文章的下标 +1 是更旧的（上一篇），
 * -1 是更新的（下一篇）。到头/到尾时对应一侧不渲染，避免出现空链接。
 */
export function PostNavigation({
  previous,
  next,
}: {
  previous?: Post;
  next?: Post;
}) {
  if (!previous && !next) return null;

  return (
    <nav
      aria-label="文章导航"
      className="grid gap-4 border-t border-border pt-8 sm:grid-cols-2"
    >
      {previous ? (
        <Link
          href={`/blog/${previous.slug}`}
          className="panel-raised panel group flex min-h-24 flex-col justify-between gap-2 rounded-[var(--radius-panel)] p-5 transition-colors hover:border-accent/40"
        >
          <span className="text-xs text-muted">← 上一篇</span>
          <span className="text-sm font-medium transition-colors group-hover:text-accent">
            {previous.title}
          </span>
        </Link>
      ) : (
        <span aria-hidden className="hidden sm:block" />
      )}

      {next && (
        <Link
          href={`/blog/${next.slug}`}
          className="panel-raised panel group flex min-h-24 flex-col justify-between gap-2 rounded-[var(--radius-panel)] p-5 text-right transition-colors hover:border-accent/40 sm:col-start-2"
        >
          <span className="text-xs text-muted">下一篇 →</span>
          <span className="text-sm font-medium transition-colors group-hover:text-accent">
            {next.title}
          </span>
        </Link>
      )}
    </nav>
  );
}