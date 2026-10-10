import Link from "next/link";

/**
 * 标签筛选栏。
 *
 * 出现在 /blog（未选中任何标签）和 /tags/<标签>（已选中）两处，
 * 让「看全部」和「按标签筛」之间的切换路径始终一致。
 *
 * 用链接跳转而不是客户端过滤：地址可分享、刷新不丢、后退有效。
 */
export function TagFilterBar({
  tags,
  activeTag,
}: {
  /** 全部标签及文章数，按数量倒序 */
  tags: { tag: string; count: number }[];
  /** 当前选中的标签；传undefined 表示看全部 */
  activeTag?: string;
}) {
  if (tags.length === 0) return null;

  return (
    <nav
      aria-label="按标签筛选文章"
      className="flex flex-wrap items-center gap-2"
    >
      {/* 「全部」永远排第一个，是清除筛选的出口 */}
      <FilterChip href="/blog" active={!activeTag}>
        全部
      </FilterChip>

      {tags.map(({ tag, count }) => (
        <FilterChip
          key={tag}
          href={`/tags/${encodeURIComponent(tag)}`}
          active={activeTag === tag}
        >
          {tag}
          <span
            className={`ml-1 text-xs tabular-nums ${
              activeTag === tag ? "text-accent/70" : "text-muted"
            }`}
          >
            {count}
          </span>
        </FilterChip>
      ))}
    </nav>
  );
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center rounded-full border px-3 py-1.5 text-sm backdrop-blur-sm transition-colors ${
        active
          ? "border-accent/40 bg-accent-soft text-accent"
          : "border-panel-edge bg-panel-raised text-secondary hover:border-accent hover:text-accent"
      }`}
    >
      {children}
    </Link>
  );
}