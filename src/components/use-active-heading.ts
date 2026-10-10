"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { TocItem } from "@/lib/posts";
import {
  getScrollLock,
  getScrollLockServer,
  isScrollLocked,
  subscribeScrollLock,
} from "@/lib/scroll";

/**
 * 追踪当前正在阅读的小节。
 *
 * 用 IntersectionObserver 观察标题元素，而不是监听 scroll 手动计算位置——
 * 前者由浏览器在合成线程上处理，长文滚动更顺滑，代码也更短。
 */
export function useActiveHeading(items: TocItem[]): string {
  const [activeId, setActiveId] = useState("");

  /**
   * 程序化滚动的锁定目标。
   *
   * 点击目录跳转时，页面会依次经过起点到终点之间的每一个章节。
   * 如果高亮照常跟随，侧栏就会从上到下一项项刷过去，动静太大。
   * 锁定期间高亮直接停在目标项上，不参与中间过程。
   */
  const lockedId = useSyncExternalStore(
    subscribeScrollLock,
    getScrollLock,
    getScrollLockServer,
  );

  // items 每次渲染都是新数组，直接放进依赖会导致观察器反复重挂。
  // 用内容拼成的字符串做依赖，只有目录真正变化时才重建。
  const key = items.map((item) => item.id).join("|");

  useEffect(() => {
    if (key === "") return;

    const headings = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null);

    if (headings.length === 0) return;

    /**
     * 判断当前应该高亮哪一个小节。
     *
     * 不用「取第一个相交的元素」——那会在标题间距很大时失灵：
     * 观察区里可能一个标题都没有，此时高亮会永远卡在上一项。
     *
     * 做法是取「最后一个已经越过阅读线的小节标题」。阅读线取视口高度的 1/3，
     * 而不是固定像素：读者的视线中心大致在视口上三分之一处，
     * 用固定偏移会让高亮比视线慢一拍。
     */
    const pickActive = () => {
      // 程序化滚动期间不更新：直接跳过，让高亮停在锁定的目标项上
      if (isScrollLocked()) return;

      const readingLine = window.innerHeight / 3;

      let candidate: HTMLElement | null = null;
      for (const h of headings) {
        if (h.getBoundingClientRect().top <= readingLine) candidate = h;
        else break; // 标题按文档顺序排列，一旦越界后面都不会是
      }

      // 一个都没越过阅读线时（页面最顶端），高亮第一个
      setActiveId((candidate ?? headings[0]).id);
    };

    // 初始定位一次
    pickActive();

    /**
     * 滚动兜底：IntersectionObserver 只在元素进出观察区时回调，
     * 如果两个标题之间没有任何回调触发，高亮就会停滞。
     * 这里用 rAF 节流地重新计算，保证高亮始终跟手。
     */
    let frame = 0;
    const onScroll = () => {
      if (frame === 0) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          pickActive();
        });
      }
    };

    const observer = new IntersectionObserver(pickActive, {
      // 观察区上边界下移 1/3 视口，与 pickActive 的阅读线保持一致；
      // 下边界收到视口 90% 处，让接近滚到底部的标题也能触发回调
      rootMargin: "-33% 0px -90% 0px",
      threshold: [0, 1],
    });
    for (const heading of headings) observer.observe(heading);

    window.addEventListener("scroll", onScroll, { passive: true });
    // 视口高度变化（移动端地址栏收起/展开）也会影响位置判断
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // 锁定期间直接返回目标项：高亮一步到位，不经过中间章节
  return lockedId ?? activeId;
}