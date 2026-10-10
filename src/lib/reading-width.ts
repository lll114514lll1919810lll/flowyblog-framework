"use client";

import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";

/**
 * 正文宽度的档位设置。
 *
 * 每档给出正文内容区的 max-width，用 rem 而不是 px：
 * 中文字宽是全角，px 宽度在不同字号下对应的字数会飘，
 * 而 rem 会跟着根字号一起缩放。
 *
 * 三档等距：36 / 52 / 68，每档相差16rem。跨度必须一致，
 * 否则从「标准」切到「宽」会感觉跳了一大步，回切又觉得没变化。
 *
 * 最宽档的 68rem 是算出来的：桌面端正文 + 目录侧栏(16rem) + 间距(3rem)
 * 整块约占顶栏内容区(CONTENT_MAX_WIDTH 减内边距)的 80%，
 * 即 68 + 16 + 3 = 87rem ≈ 1392px / 1744px ≈ 79.8%。
 * 想继续加宽就调这里，注意侧栏宽度在 table-of-contents.tsx 里是 w-64。
 */
export const READING_WIDTHS = [
  { id: "narrow", label: "窄", maxWidth: "36rem" },
  { id: "medium", label: "标准", maxWidth: "52rem" },
  { id: "wide", label: "宽", maxWidth: "68rem" },
] as const;

export type WidthId = (typeof READING_WIDTHS)[number]["id"];

const STORAGE_KEY = "fbz-reading-width";
const DEFAULT_ID: WidthId = "medium";

function isWidthId(value: unknown): value is WidthId {
  return READING_WIDTHS.some((w) => w.id === value);
}

/** localStorage 不可用时（隐私模式等）降级为默认值 */
function readStored(): WidthId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return isWidthId(saved) ? saved : DEFAULT_ID;
  } catch {
    return DEFAULT_ID;
  }
}

// localStorage 不是响应式的，用一个简单的订阅表让 hook 能感知变化
const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  // 同一页面可能有多处用到宽度（比如标题栏和控制条），跨标签页同步一下
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

/** 服务端渲染时没有 localStorage，返回默认值保证 HTML 一致 */
function getServerSnapshot(): WidthId {
  return DEFAULT_ID;
}

/**
 * 读取并保存用户选择的正文宽度。
 *
 * 用 useSyncExternalStore 而不是 useState + useEffect：
 * 后者需要在挂载后同步 setState 读一次偏好，会多渲染一轮、
 * 并触发 react-hooks/set-state-in-effect 警告；
 * 前者由 React 专门处理「外部数据 + SSR 水合」，行为更干净。
 */
export function useReadingWidth() {
  const widthId = useSyncExternalStore(subscribe, readStored, getServerSnapshot);

  const setWidth = useCallback((id: WidthId) => {
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // 存不了就算了，本次会话内仍然生效
    }
    // 手动通知订阅者，否则同页面的其他使用方不会更新
    for (const listener of listeners) listener();
  }, []);

  return { widthId, setWidth };
}

/**
 * 量出正文列一行能放多少个全角字。
 *
 * 档位里原来写死了「每行约 34 / 49 / 64 字」，那是拿 max-width 直接除以
 * 字号算出来的。窄屏上正文根本达不到 max-width，数字就成了空话——
 * 手机上照样显示「每行约 64 字」，实际连一半都放不下。
 *
 * 现在改成量真实渲染宽度：用元素当前字体在 canvas 上量一个全角字的宽度，
 * 再除以正文列宽。换档位、转屏、拉窗口都会重新量。
 *
 * 只在 ResizeObserver 的回调里写 state，不在 effect 里同步 setState：
 * 开始观测时浏览器会立刻回调一次，首次测量由它完成，也就不必额外触发
 * 一轮渲染（react-hooks/set-state-in-effect 也不答应）。
 */
export function useCharsPerLine(ref: RefObject<HTMLElement | null>) {
  const [chars, setChars] = useState<number>();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const ctx = document.createElement("canvas").getContext("2d");
      if (!ctx) return;

      const style = getComputedStyle(el);
      ctx.font = `${style.fontSize} ${style.fontFamily}`;
      // 量 10 个字取平均，抵消单个字形的取整误差
      const perChar = ctx.measureText("字".repeat(10)).width / 10;
      if (perChar > 0) setChars(Math.round(el.clientWidth / perChar));
    };

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return chars;
}