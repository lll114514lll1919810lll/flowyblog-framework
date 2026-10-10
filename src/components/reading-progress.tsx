"use client";

import { useEffect, useState } from "react";

/**
 * 阅读进度条：顶部一条 1.5px 的细线，宽度 = 已读百分比。
 *
 * 用 rAF 节流，避免滚动事件高频触发造成掉帧；
 * 页面只有一个进度条，开销可以忽略。
 */
export function ReadingProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frame = 0;

    const update = () => {
      frame = 0;
      const scrollTop = window.scrollY;
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;

      setProgress(scrollable > 0 ? Math.min(1, Math.max(0, scrollTop / scrollable)) : 0);
    };

    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

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