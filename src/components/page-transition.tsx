"use client";

import { ViewTransition } from "react";
import { usePathname } from "next/navigation";
import "@/lib/view-transition-guard";
import { CONTENT_MAX_WIDTH } from "@/lib/site";

/**
 * 页面切换过渡。
 *
 * 文档隐藏时 startViewTransition 的假过渡守卫是全局补丁，
 * 挂在 lib/view-transition-guard.ts（import 即生效），不在这里展开。
 *
 * App Router 内置 React canary，路由切换本身就是一次 transition。
 * 但要注意 <ViewTransition> 的一个容易忽略的前提：
 *
 * **必须给 key，React 才会把新旧内容当成「退出 / 进入」这一对来处理。**
 * 没有 key 时 React 认为只是原地更新，不会产生过渡动画——
 * 表现就是 startViewTransition 被调用了，但没有任何动画发生。
 * 这里用 pathname 当 key，路由一变 key 就变。
 *
 * 另一个设计取舍：顶栏、底栏、阅读进度条都放在这个组件「外面」，
 * 它们在切换时保持静止——导航不该闪烁，读者的视线重心要稳定。
 * 只有中间的正文内容参与淡入淡出。
 *
 * 无障碍：globals.css 里为 prefers-reduced-motion 做了降级，
 * 系统开启「减少动态效果」时动画时长归零，内容直接切换。
 *
 * update="none"：React 对「原地更新」（key 不变、内容在 Transition 里刷新）
 * 默认也播 default 动画。搜索页同步 URL、同页状态切换都属于这种更新，
 * 如果跟着播 page-fade，整页每敲一个字就淡入淡出一次，看起来像在刷新。
 * 过渡动画只属于「换页」——key 变化触发的 enter/exit；原地更新一律直切。
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  // pathname 只用来当 key，不需要 useMemo——它就是导航的唯一标识
  const pathname = usePathname();

  return (
    <ViewTransition key={pathname} name="page" default="page-fade" update="none">
      {/* 与顶栏/底栏共用同一个宽度常量，三者左右严格对齐。
          文章页内部还会按用户选择进一步约束正文宽度。 */}
      <main
        className="mx-auto w-full flex-1 px-6 py-10 sm:py-14"
        style={{ maxWidth: CONTENT_MAX_WIDTH }}
      >
        {children}
      </main>
    </ViewTransition>
  );
}