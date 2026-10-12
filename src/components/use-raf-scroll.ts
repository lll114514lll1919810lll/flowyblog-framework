"use client";

import { useEffect, useRef } from "react";

/**
 * rAF 节流的 scroll/resize 监听：滚动事件触发极频繁，直接逐事件处理会掉帧；
 * 这里保证回调每帧最多跑一次。回到顶部按钮、阅读进度条等滚动跟随组件
 * 共用这一份样板，不再各写一遍「frame 守卫 + rAF + 清理」。
 *
 * 回调经 ref 转发：每帧调用的都是最新闭包，且它不进依赖数组，
 * 监听器不会因回调身份变化被反复拆装。
 *
 * @param options.resize 同时监听 resize（视口变化同样影响位置判断）
 * @param options.immediate 挂载时先同步执行一次——按「当前滚动位置」
 *   落状态的组件（回到顶部、进度条）首帧就需要正确值
 */
export function useRafScroll(
  callback: () => void,
  options: { resize?: boolean; immediate?: boolean } = {},
) {
  const cbRef = useRef(callback);
  useEffect(() => {
    cbRef.current = callback;
  });

  const { resize, immediate } = options;
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (frame === 0) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          cbRef.current();
        });
      }
    };
    if (immediate) cbRef.current();
    window.addEventListener("scroll", schedule, { passive: true });
    if (resize) window.addEventListener("resize", schedule, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      if (resize) window.removeEventListener("resize", schedule);
    };
  }, [resize, immediate]);
}
