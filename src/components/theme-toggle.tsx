"use client";

import { useLayoutEffect } from "react";
import { reapplyTheme, useTheme } from "@/lib/use-theme";

/**
 * 顶栏的明暗切换开关。
 *
 * 外观完全由 CSS 根据 <html data-theme> 决定（见 globals.css 的
 * .theme-switch 系列），这里的 React 状态只用来：
 *   - aria-checked / title：给读屏和悬停提示用
 *   - 点击时切换
 * 这样服务端和水合后的首帧长得一样，不会出现滑块先停在左边再跳过去。
 */
export function ThemeToggle() {
  const { isDark, toggle } = useTheme();

  /**
   * 开发模式下 React Strict Mode 会重挂载一次，并把 <html> 上只有脚本写过、
   * JSX 里没有的属性（data-theme、内联的 color-scheme）清掉，
   * 页面就会变回浅色。这里按同一份数据源补回来。生产环境是空转。
   */
  useLayoutEffect(() => {
    reapplyTheme();
  }, []);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label="深色模式"
      title={isDark ? "切换到浅色模式" : "切换到深色模式"}
      onClick={(event) => {
        /*
          圆形扩散的圆心用点击位置；键盘触发时 clientX/Y 是 0，
          那就退回用按钮自己的中心，键盘用户也能看到从开关长出来的动画。
        */
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX || rect.left + rect.width / 2;
        const y = event.clientY || rect.top + rect.height / 2;
        toggle({ x, y });
      }}
      className="theme-switch"
    >
      <span className="theme-switch-track">
        <span className="theme-switch-icon theme-switch-sun" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-3 w-3">
            <circle cx="12" cy="12" r="4.6" fill="currentColor" />
            <g
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              fill="none"
            >
              <path d="M12 2.2v2.2M12 19.6v2.2M2.2 12h2.2M19.6 12h2.2M5.1 5.1l1.6 1.6M17.3 17.3l1.6 1.6M18.9 5.1l-1.6 1.6M6.7 17.3l-1.6 1.6" />
            </g>
          </svg>
        </span>

        <span className="theme-switch-icon theme-switch-moon" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-3 w-3">
            <path
              d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"
              fill="currentColor"
            />
          </svg>
        </span>

        <span className="theme-switch-knob" aria-hidden="true" />
      </span>
    </button>
  );
}
