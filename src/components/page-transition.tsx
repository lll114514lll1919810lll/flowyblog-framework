"use client";

import { ViewTransition } from "react";
import { usePathname } from "next/navigation";
import { CONTENT_MAX_WIDTH } from "@/lib/site";

/*
  文档隐藏时的过渡守卫。

  react-dom 会在每次提交时调用 document.startViewTransition（dev 的 HMR
  热更新也算提交）。如果此刻标签页在后台（文档隐藏），Chromium 会直接
  中止过渡并 reject，消息是「Transition was aborted because of invalid
  state. Document hidden」。react-dom 内部有一份中止消息白名单，但名单里
  的措辞少了「. Document hidden」后缀，匹配不上，于是每次都漏成
  uncaught error 刷控制台——本地开发时人通常在编辑器里，标签页正好是
  隐藏的，所以「总是这样报错」。

  这是上游 react-dom 和新版 Chromium 的措辞脱节，react-dom 改不了；
  而文档隐藏时本来就不需要过渡动画（没人看），所以在源头拦截：
  隐藏时不再调用浏览器 API，直接执行更新回调，返回一个立即完成的假过渡。
*/
type StartViewTransition = NonNullable<Document["startViewTransition"]>;

if (typeof document !== "undefined") {
  const nativeStartViewTransition = document.startViewTransition?.bind(document);
  if (nativeStartViewTransition) {
    document.startViewTransition = ((options) => {
      if (!document.hidden) return nativeStartViewTransition(options);

      const update = typeof options === "function" ? options : options?.update;
      let settled: Promise<void>;
      try {
        update?.();
        settled = Promise.resolve();
      } catch (error) {
        settled = Promise.reject(error);
      }

      const transition = {
        ready: settled,
        updateCallbackDone: settled,
        finished: settled,
        skipTransition: () => {},
      };
      return transition as ReturnType<StartViewTransition>;
    }) as StartViewTransition;
  }
}

/**
 * 页面切换过渡。
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
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  // pathname 只用来当 key，不需要 useMemo——它就是导航的唯一标识
  const pathname = usePathname();

  return (
    <ViewTransition key={pathname} name="page" default="page-fade">
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