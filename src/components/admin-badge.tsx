/**
 * 金色「管理员」徽标。
 *
 * 出现在被标记的那条留言的昵称旁边。全站只有这一个地方用金色——
 * 配色刻意保持近乎单色（见 README 的设计说明），所以这一抹金足够扎眼，
 * 不需要再加别的强调色。
 *
 * 做成独立组件是因为访客界面（comments.tsx）和后台列表
 * （admin-dashboard.tsx）都要渲染它，两处各写一遍样式迟早会长得不一样。
 */
export function AdminBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`admin-badge ${className}`}
      // 徽标本身是图形化的身份标记，读屏应该念出含义而不是「管理员」
      // 这两个字被当成昵称的一部分，所以给它自己的 role 和 label。
      role="img"
      aria-label="站方管理员"
    >
      {/* 盾牌：比星星更贴「站方身份」的语义，星星容易读成「精选/推荐」 */}
      <svg
        width="10"
        height="10"
        viewBox="0 0 12 12"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M6 1.2L10 2.6v3.2c0 2.5-1.7 4.3-4 5-2.3-.7-4-2.5-4-5V2.6L6 1.2z"
          fill="currentColor"
          fillOpacity="0.18"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
        <path
          d="M4.2 6.1l1.3 1.3 2.4-2.5"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      管理员
    </span>
  );
}
