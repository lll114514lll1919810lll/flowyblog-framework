"use client";

import { useState } from "react";
import { useRafScroll } from "@/components/use-raf-scroll";

/**
 * 阅读进度条：顶部一条 1.5px 的细线，宽度 = 已读百分比。
 *
 * rAF 节流在共享的 useRafScroll 里，页面只有一个进度条，开销可以忽略。
 */
export function ReadingProgress() {
  const [progress, setProgress] = useState(0);

  useRafScroll(
    () => {
      const scrollTop = window.scrollY;
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;

      setProgress(scrollable > 0 ? Math.min(1, Math.max(0, scrollTop / scrollable)) : 0);
    },
    { resize: true, immediate: true },
  );

  return (
    <div
      aria-hidden
      className="fixed inset-x-0 top-0 z-[60] h-[1.5px] bg-transparent"
    >
      <div
        className="h-full origin-left bg-accent transition-transform duration-75 ease-out"
        style={{ transform: `scaleX(${progress})` }}
      />
    </div>
  );
}