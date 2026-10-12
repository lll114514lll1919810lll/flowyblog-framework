"use client";

import { useRef } from "react";
import { useRafScroll } from "@/components/use-raf-scroll";

/**
 * 阅读进度条：顶部一条 1.5px 的细线，宽度 = 已读百分比。
 *
 * rAF 节流在共享的 useRafScroll 里；进度值经 ref 直写 style.transform，
 * 不走 React 渲染路径——整个页面的面板都挂在 backdrop-filter 上，
 * 滚动帧的渲染预算很宝贵，一个纯变换的值不值得换一次整组件重渲染。
 */
export function ReadingProgress() {
  const barRef = useRef<HTMLDivElement>(null);

  useRafScroll(
    () => {
      const scrollTop = window.scrollY;
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const progress =
        scrollable > 0 ? Math.min(1, Math.max(0, scrollTop / scrollable)) : 0;
      if (barRef.current) {
        barRef.current.style.transform = `scaleX(${progress})`;
      }
    },
    { resize: true, immediate: true },
  );

  return (
    <div
      aria-hidden
      className="fixed inset-x-0 top-0 z-[60] h-[1.5px] bg-transparent"
    >
      <div
        ref={barRef}
        className="h-full origin-left bg-accent transition-transform duration-75 ease-out"
        style={{ transform: "scaleX(0)" }}
      />
    </div>
  );
}