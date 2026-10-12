/**
 * 放大镜图标。顶栏快捷搜索（site-search）与独立搜索页（search-page）
 * 共用这一份，原来两处各贴了一遍一模一样的 SVG。
 * 颜色、尺寸等样式由调用方通过 className 控制（CSS 里的类各自定义）。
 */
export function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden
    >
      <circle cx="8" cy="8" r="5.2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 12l3.4 3.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
