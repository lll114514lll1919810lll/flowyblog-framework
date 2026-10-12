"use client";

import { useEffect } from "react";
import type { RefObject } from "react";

/**
 * 在 pointerdown 落点位于元素之外时触发回调。
 *
 * 用 pointerdown 而不是 click：鼠标/触摸/手写笔一套逻辑，
 * 且比 click 早一步，避免「点别处先触发那边的行为、浮层才关」的错位。
 * 导航菜单（mobile-nav）和顶栏搜索浮层（site-search）共用这一份样板。
 *
 * @param enabled 为 false 时不挂监听（比如浮层处于关闭状态）
 * @param onOutside 建议传稳定的引用（useCallback），否则每次渲染都会重挂监听
 */
export function useClickOutside(
  rootRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  onOutside: () => void,
) {
  useEffect(() => {
    if (!enabled) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onOutside();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [rootRef, enabled, onOutside]);
}
