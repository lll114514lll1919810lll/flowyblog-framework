"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * 文章字号的档位设置。
 *
 * scale 是字号缩放系数：正文、目录、评论区的字号都乘以它
 * （CSS 侧是 --font-scale，由 PostBody 根节点的 data-font-size 触发，
 * 见 globals.css）。三档等比：0.9 / 1 / 1.125——标题、表格、代码等
 * 派生字号按同一系数缩放，层级关系不变。
 *
 * 「标准」的 scale 恒为 1 且与未引入该功能前的字号完全一致，
 * 默认落在这一档；CSS 里也不为它写规则，缺省回退 1，
 * 服务端渲染出的 HTML 天然就是标准档，水合前后无跳变。
 */
export const FONT_SIZES = [
  { id: "small", label: "小", scale: 0.9 },
  { id: "medium", label: "标准", scale: 1 },
  { id: "large", label: "大", scale: 1.125 },
] as const;

export type FontSizeId = (typeof FONT_SIZES)[number]["id"];

const STORAGE_KEY = "fbz-reading-font-size";
const DEFAULT_ID: FontSizeId = "medium";

function isFontSizeId(value: unknown): value is FontSizeId {
  return FONT_SIZES.some((f) => f.id === value);
}

/** localStorage 不可用时（隐私模式等）降级为默认值 */
function readStored(): FontSizeId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return isFontSizeId(saved) ? saved : DEFAULT_ID;
  } catch {
    return DEFAULT_ID;
  }
}

// localStorage 不是响应式的，用一个简单的订阅表让 hook 能感知变化
const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  // 同一页面可能有多处用到字号（正文与目录侧栏），跨标签页同步一下
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

/** 服务端渲染时没有 localStorage，返回默认值保证 HTML 一致 */
function getServerSnapshot(): FontSizeId {
  return DEFAULT_ID;
}

/**
 * 读取并保存用户选择的文章字号。
 *
 * 与 useReadingWidth 同一套写法（useSyncExternalStore）：
 * 挂载后不需要再同步读一次偏好，不多渲染一轮。
 */
export function useFontSize() {
  const sizeId = useSyncExternalStore(subscribe, readStored, getServerSnapshot);

  const setSize = useCallback((id: FontSizeId) => {
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // 存不了就算了，本次会话内仍然生效
    }
    // 手动通知订阅者，否则同页面的其他使用方不会更新
    for (const listener of listeners) listener();
  }, []);

  const scale = FONT_SIZES.find((f) => f.id === sizeId)?.scale ?? 1;

  return { sizeId, scale, setSize };
}
