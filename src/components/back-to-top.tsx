"use client";

import { useRef, useState } from "react";
import { scrollToTop } from "@/lib/scroll";
import { useRafScroll } from "@/components/use-raf-scroll";

/**
 * 回到顶部按钮。
 *
 * 只在文章页渲染（长文才需要），固定在右下角。
 *
 * 几个细节：
 * - 文章顶端滚出视口才出现。刚进文章就冒出一个「回到顶部」是多余的。
 * - 隐藏时不能用 opacity: 0 了事——那样的按钮仍可被 Tab 聚焦，
 *   键盘用户会 tab 到一个看不见的东西。所以同时设 tabIndex=-1 和
 *   aria-hidden，把它真正移出可访问树。
 * - 44px 见方，满足触控热区标准。
 * - 用 .panel 拿毛玻璃底，rounded-full 覆盖掉面板的 14px 圆角变成圆形。
 * - 页脚进入视口时整体上移，别压住版权和落款。
 *   固定定位的按钮不会自己避让页脚——滚到底时页脚正好滑到右下角，
 *   按钮就盖在页脚上面。这里按页脚顶边到视口底边的距离
 *   实时抬高，页脚往上顶多少、按钮就抬多少，看起来像被页脚顶上去的。
 */
export function BackToTop() {
  const [visible, setVisible] = useState(false);
  const [lift, setLift] = useState(0);
  // 查到的元素缓存在 ref 里：回调每次渲染都会重建，
  // 原来靠 effect 闭包保留的缓存得换成 ref 才能跨回调存活
  const postRef = useRef<HTMLElement | null>(null);
  const footerRef = useRef<HTMLElement | null>(null);

  // 滚动跟随（rAF 节流）走共享 hook；挂载时先算一次，
  // 避免刷新落到页面中部时按钮状态错一拍
  useRafScroll(
    () => {
      /*
        出现时机按**文章的顶边**算，不用滚动了多少像素。

        原来是一刀切「滚过约 0.8 屏」：文章页开头有大块 hero 和标题，滚过
        0.8 屏时文章才刚露头，按钮就已经压在正文上了——看起来像刚进页面
        就冒出来。按文章的顶边走，语义才是「你已经在正文里了」。
      */
      postRef.current ??= document.querySelector("article");
      const post = postRef.current;
      setVisible(
        post
          ? post.getBoundingClientRect().top <= 0
          : // 拿不到文章元素就退回原来的像素阈值（其它页面复用这个组件时）
            window.scrollY > window.innerHeight * 0.8,
      );

      footerRef.current ??= document.querySelector("footer");
      const footer = footerRef.current;
      if (!footer) return;
      // 页脚顶边一旦进入视口，就开始把按钮往上顶
      const overlap = window.innerHeight - footer.getBoundingClientRect().top;
      // 上限是别把自己顶出屏幕顶部
      setLift(Math.max(0, Math.min(overlap, window.innerHeight - 160)));
    },
    { resize: true, immediate: true },
  );

  return (
    <button
      type="button"
      onClick={scrollToTop}
      aria-label="回到顶部"
      title="回到顶部"
      // 隐藏时移出 Tab 顺序与可访问树，避免聚焦到不可见元素
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
      // bottom 用行内样式，因为它随滚动逐帧变化，不适合写成工具类
      style={{ bottom: `calc(1.5rem + ${lift}px)` }}
      className={`panel fixed right-6 z-40 flex h-11 w-11 items-center justify-center rounded-full text-secondary transition-[opacity,transform] duration-200 hover:text-accent ${
        visible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-2 opacity-0"
      }`}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 18 18"
        fill="none"
        aria-hidden
      >
        <path
          d="M9 14.5V4M4.5 8.5L9 4l4.5 4.5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
