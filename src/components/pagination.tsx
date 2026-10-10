import Link from "next/link";

/**
 * 页码翻页：上一页 / 页码 / 下一页。
 *
 * 页码的取舍：
 * - 页少时全列出来。就那么几个数，藏起来反而让人不知道一共几页。
 * - 页多时收成「首 … 中间几页 … 尾」，中间窗口跟着当前页滑动。
 * - 省略号用 aria-hidden 的 span，不占 Tab 顺序——它不是能点的东西，
 *   键盘用户按顺序走页码就够，插两个不可点的元素进去只是噪音。
 * - 当前页用 `<span aria-current="page">` 而不是 button：它不可点，
 *   做成按钮会让人以为按了有用。
 *
 * 首页/末页和上下页两端常驻，方便在长列表里快速回到边界；
 * 到头时保留占位，避免整排按钮左右跳动。
 */

/** 当前页两边各留几个页码 */
const WINDOW = 1;

/**
 * 要显示哪些页码，null 表示这里是个省略号。
 */
function pageItems(current: number, total: number): (number | null)[] {
  // 窗口里最多这么多个：首页 + 尾页 + 当前页及其左右 + 两个省略号
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages = new Set<number>([1, total, current]);
  for (let i = current - WINDOW; i <= current + WINDOW; i += 1) {
    if (i > 1 && i < total) pages.add(i);
  }
  const sorted = [...pages].sort((a, b) => a - b);

  const items: (number | null)[] = [];
  let previous = 0;
  for (const page of sorted) {
    if (previous && page - previous > 1) items.push(null);
    items.push(page);
    previous = page;
  }
  return items;
}

/**
 * 页码/上下页共用的类名。
 *
 * 带 `panel` 是为了让液态玻璃实验接管它：玻璃系统只扫 `.panel` 系列的类，
 * 而 `panel` 自带的那条 `backdrop-filter: blur(14px)` 会在玻璃模式下被清成
 * none——那正是「这里该由画布接管」的信号。翻页按钮是 <main> 里的普通元素、
 * 44px 见方，不会被任何排除规则挡掉，所以加上它就能拿到 WebGL 那套玻璃。
 *
 * 不可点的两种（到头的上下页、当前页之外的间隔）不挂 panel：
 * 当前页挂了是给它玻璃，到头的挂了会凭空多一块不该存在的玻璃面。
 */

/** 某一页的链接。第一页是 /blog/，其余 /blog/page/N */
function hrefFor(page: number): string {
  return page <= 1 ? "/blog" : `/blog/page/${page}`;
}

export function Pagination({ page, totalPages }: { page: number; totalPages: number }) {
  // 只有一页时不渲染：摆一排「1」和点不动的上下页，看着像坏了
  if (totalPages <= 1) return null;

  const items = pageItems(page, totalPages);
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  return (
    <nav
      aria-label="文章分页"
      className="flex flex-wrap items-center justify-center gap-2"
    >
      {page > 1 ? (
        <Link href={hrefFor(1)} className="lab-page-link panel" aria-label="第一页">
          首页
        </Link>
      ) : (
        <span aria-hidden className="lab-page-link is-off">
          首页
        </span>
      )}

      {hasPrev ? (
        <Link href={hrefFor(page - 1)} className="lab-page-link panel" rel="prev">
          上一页
        </Link>
      ) : (
        <span aria-hidden className="lab-page-link is-off">
          上一页
        </span>
      )}

      {items.map((item, index) =>
        item === null ? (
          <span
            // 省略号没有语义，用下标当 key 就够了
            key={`gap-${index}`}
            aria-hidden
            className="px-1 text-sm text-muted"
          >
            …
          </span>
        ) : item === page ? (
          <span
            key={item}
            aria-current="page"
            className="lab-page-link panel is-current"
          >
            {item}
          </span>
        ) : (
          <Link
            key={item}
            href={hrefFor(item)}
            className="lab-page-link panel"
            aria-label={`第 ${item} 页`}
          >
            {item}
          </Link>
        ),
      )}

      {hasNext ? (
        <Link href={hrefFor(page + 1)} className="lab-page-link panel" rel="next">
          下一页
        </Link>
      ) : (
        <span aria-hidden className="lab-page-link is-off">
          下一页
        </span>
      )}

      {page < totalPages ? (
        <Link
          href={hrefFor(totalPages)}
          className="lab-page-link panel"
          aria-label="最后一页"
        >
          末页
        </Link>
      ) : (
        <span aria-hidden className="lab-page-link is-off">
          末页
        </span>
      )}
    </nav>
  );
}
