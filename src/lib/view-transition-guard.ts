/*
 * document.startViewTransition 的「文档隐藏」守卫。
 *
 * react-dom 会在每次提交时调用 document.startViewTransition（dev 的 HMR
 * 热更新也算提交）。如果此刻标签页在后台（文档隐藏），Chromium 会直接
 * 中止过渡并 reject，消息是「Transition was aborted because of invalid
 * state. Document hidden」。react-dom 内部有一份中止消息白名单，但名单里
 * 的措辞少了「. Document hidden」后缀，匹配不上，于是每次都漏成
 * uncaught error 刷控制台——本地开发时人通常在编辑器里，标签页正好是
 * 隐藏的，所以「总是这样报错」。
 *
 * 这是上游 react-dom 和新版 Chromium 的措辞脱节，react-dom 改不了；
 * 而文档隐藏时本来就不需要过渡动画（没人看），所以在源头拦截：
 * 隐藏时不再调用浏览器 API，直接执行更新回调，返回一个立即完成的假过渡。
 *
 * 注意：这是模块加载即生效的**全局**补丁——页面里所有
 * startViewTransition 的调用方（页面过渡 PageTransition、主题切换的
 * 圆形扩散等）都会经过这里。单独放一个 lib 模块，就是为了把这个
 * 影响面写在明处，而不是藏在某个组件文件里。
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
