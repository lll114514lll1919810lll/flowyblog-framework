/**
 * 明暗主题里可以被服务端读的部分：类型、存储键、内联引导脚本。
 *
 * 为什么单独一个文件：layout.tsx 是服务端组件，要读 THEME_INIT_SCRIPT；
 * 而 hook 要用 useSyncExternalStore。Next 16 不允许服务端组件可达的模块里
 * 出现 useSyncExternalStore（会报 "importing a module that depends on
 * useSyncExternalStore into a React Server Component"），所以两者必须分开。
 * 运行时逻辑在 use-theme.ts。
 */

export type ThemeMode = "light" | "dark";

/** localStorage 键名。改名等于丢掉所有老用户的偏好，慎重 */
export const THEME_STORAGE_KEY = "fbz-theme";

export const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * 内联到 <head> 的引导脚本，必须在任何内容绘制之前同步执行。
 *
 * 优先级：存过的偏好 > 系统偏好。
 * 任何一步出错（隐私模式禁用 localStorage 等）都退化成「浅色」，
 * 而不是让脚本抛错中断——所以整个函数体包在 try 里。
 */
export const THEME_INIT_SCRIPT = `(function(){try{var e=document.documentElement,s=localStorage.getItem("${THEME_STORAGE_KEY}"),d=s==="dark"||(s!=="light"&&window.matchMedia("${DARK_QUERY}").matches);e.dataset.theme=d?"dark":"light";e.style.colorScheme=d?"dark":"light"}catch(_){}})();`;
