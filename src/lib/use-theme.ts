"use client";

import { useSyncExternalStore } from "react";
import {
  DARK_QUERY,
  THEME_STORAGE_KEY,
  type ThemeMode,
} from "@/lib/theme";

/**
 * 明暗主题的运行时：读、写、切、订阅。
 * 类型和引导脚本在 theme.ts（那边不能依赖 React，见文件里的说明）。
 *
 * 主题的唯一来源是 <html> 上的 data-theme 属性，而不是这里的变量：
 * 内联引导脚本在浏览器解析 HTML、首次绘制之前就把它写好了，CSS 直接依赖它。
 * React 只负责读出来给无障碍属性和点击用——如果反过来让 React 状态决定外观，
 * 服务端只能渲染一种主题，深色用户会先看到浅色再跳变。
 */

/** 读用户手动选过的主题；没选过（或读不到）返回 null，表示「跟随系统」 */
function readStored(): ThemeMode | null {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "dark" || saved === "light" ? saved : null;
  } catch {
    return null;
  }
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
}

/** 把主题写到 DOM 上。CSS 和浏览器控件都看这两个地方 */
export function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  // color-scheme 决定滚动条、表单控件、超范围画布的配色。
  // 内联样式优先级最高，能压过 globals.css 里的媒体查询。
  root.style.colorScheme = theme;
}

/**
 * 按「当前偏好」重新应用一次主题。
 *
 * 给开发模式用：React Strict Mode 会重挂载一次并重置 <html> 上的属性，
 * 把脚本写好的 data-theme 清掉。这个方法从同一份数据源重算，幂等，
 * 生产环境调用等于空转。
 */
export function reapplyTheme() {
  applyTheme(readStored() ?? (systemPrefersDark() ? "dark" : "light"));
}

// localStorage 和 matchMedia 都不是响应式的，用一张订阅表把变化推给 hook
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribeTheme(callback: () => void) {
  listeners.add(callback);

  const media = window.matchMedia(DARK_QUERY);

  // 没手动选过的时候，系统偏好在页面开着时变化要实时跟上；
  // 手动选过就说明用户已经表态，不再被系统带走
  const onSystemChange = () => {
    if (readStored() !== null) return;
    applyTheme(media.matches ? "dark" : "light");
    emit();
  };

  // 同一份偏好在另一个标签页被改了，这个标签页也跟着变
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    applyTheme(readStored() ?? (media.matches ? "dark" : "light"));
    emit();
  };

  media.addEventListener("change", onSystemChange);
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(callback);
    media.removeEventListener("change", onSystemChange);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * 当前生效的主题，直接从 DOM 上读。
 * 用 DOM 而不是 localStorage 作快照，是因为「跟随系统」时 localStorage 是空的，
 * 而 DOM 上永远是最终结果——开关要显示的就是这个。
 */
function getThemeSnapshot(): ThemeMode {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** 服务端没有 DOM，给一个固定值保证 HTML 一致；水合后会立刻按真实值重渲染 */
function getServerThemeSnapshot(): ThemeMode {
  return "light";
}

/** 浏览器是否支持 View Transitions（Safari 18 之前、老 Firefox 没有） */
type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> };
};

/**
 * 切换主题。把选择存起来之后就不再跟随系统了——
 * 开关是两态的，没有「回到自动」这一档；想恢复自动需要清掉 localStorage。
 *
 * origin 是点击位置（开关的中心）。给了就做「以开关为圆心扩散到整页」的
 * 圆形揭示动画，不给就即时切换。
 */
export function toggleTheme(origin?: { x: number; y: number }) {
  const next: ThemeMode = getThemeSnapshot() === "dark" ? "light" : "dark";

  const commit = () => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // 存不了也照样切，只是刷新后回到系统偏好
    }
    applyTheme(next);
    emit();
  };

  const doc = document as ViewTransitionDocument;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // 没给圆心 / 用户要求减少动效 / 浏览器不支持，就直接切
  if (!origin || reduceMotion || typeof doc.startViewTransition !== "function") {
    commit();
    return;
  }

  /*
    圆形扩散靠 View Transitions：浏览器先把旧主题冻结成一张快照，
    然后在新主题上按 clip-path 的圆把它一点点揭开。

    圆心和半径写到 html 的自定义属性上，动画在 globals.css 里
    （::view-transition-new(root) 的 theme-reveal）。
    半径取到最远的那个角，保证圆一定能盖满整屏。
  */
  const { x, y } = origin;
  const radius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );
  const root = document.documentElement;
  root.style.setProperty("--theme-x", `${x}px`);
  root.style.setProperty("--theme-y", `${y}px`);
  root.style.setProperty("--theme-r", `${radius}px`);

  /*
    防御性处理：React 的 <ViewTransition name="page"> 是在路由切换那一下
    才把 view-transition-name 挂到 <main> 上的（静态检查时整个 DOM 里
    只有 html 持有 root）。万一它当时正挂着，正文就会单独生成一个快照组
    盖在 root 之上，圆形遮罩盖不住它——表现是「背景在扩散、正文瞬间换色」。
    这里先摘掉，动画结束后原样挂回去。
  */
  const page = document.querySelector("main");
  const savedName = page?.style.viewTransitionName ?? "";
  if (page) page.style.viewTransitionName = "none";

  /*
    关键：startViewTransition 的回调是**异步**调的（浏览器要先拍一张旧快照），
    如果页面因为被遮挡等原因不出帧，回调就一直不执行——表现是「点了开关
    主题没反应」。实测在不出帧的环境里 27 项主题检查挂了 8 项。
    所以加一个定时兜底：120ms 内回调还没跑就自己提交。
    正常浏览器里回调在一帧内（约 16ms）就跑了，兜底是空转。
  */
  let committed = false;
  const once = () => {
    if (committed) return;
    committed = true;
    commit();
  };
  const transition = doc.startViewTransition(once);
  const fallback = setTimeout(once, 120);

  // 过渡途中文档被隐藏（点完立刻切走标签页）时浏览器会中止过渡，
  // finished 随之 reject——这不是错误，接住它，否则控制台会报 uncaught。
  // .catch 后再 .finally，清理逻辑两种结局都要跑。
  transition.finished
    .catch(() => {})
    .finally(() => {
      clearTimeout(fallback);
      once();

      root.style.removeProperty("--theme-x");
      root.style.removeProperty("--theme-y");
      root.style.removeProperty("--theme-r");
      if (page) page.style.viewTransitionName = savedName;
    });
}

export function useTheme() {
  const theme = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );

  return { theme, isDark: theme === "dark", toggle: toggleTheme };
}
