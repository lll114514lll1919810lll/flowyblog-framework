"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { navLinks } from "@/lib/site";
import { LinkPending } from "@/components/link-pending";

/**
 * 窄屏的导航菜单。
 *
 * 控件形态参考 XinBlog（https://xin--blog.pages.dev/ ，MIT 协议）的顶栏设计：
 * 宽屏时顶栏直接排下四个导航链接，不需要这个按钮；只有放不下时
 * （< md）才收进汉堡菜单，点开是一个贴顶栏下沿的通栏面板。
 *
 * 面板用 position: fixed + --header-h 定位：顶栏是通栏且 sticky 在
 * top:0，所以「固定在下沿」和「绝对定位在顶栏下面」结果一致，
 * 又不用担心被顶栏容器裁掉。
 *
 * 面板本体是一块亚克力（复用 .panel.panel-strong），从顶栏下沿长出来，
 * 只留底边圆角；开合时按高度收起/展开，不是直接显示或消失。
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  /* 点面板和按钮之外关闭 */
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  /* Esc 关闭 */
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="mobile-nav" ref={rootRef}>
      <button
        type="button"
        className="mobile-nav-toggle"
        aria-label={open ? "关闭导航菜单" : "打开导航菜单"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {/* 汉堡 ↔ ✕ 的动画：三根绝对定位的横条，展开时上下两根旋转 45°
            并平移到中间交叉，中间那根淡出。数值/缓动照搬参考站
            （见 globals.css 的 .mobile-nav-bar）。 */}
        <span className="mobile-nav-icon" data-open={open ? "true" : undefined} aria-hidden>
          <span className="mobile-nav-bar" />
          <span className="mobile-nav-bar" />
          <span className="mobile-nav-bar" />
        </span>
      </button>

      {/* 面板常驻在 DOM 里，开合只切 data-open——收起动画需要元素在关闭
          过程中仍然存在，用条件渲染会在按下的瞬间把它整个摘掉。
          高度收缩 + 淡出、并把它移出焦点顺序，全部交给 CSS
          （见 globals.css 的 .mobile-nav-panel）。 */}
      <div
        className="mobile-nav-panel"
        data-open={open ? "true" : undefined}
        inert={!open}
      >
        {/* 内层承载亚克力面板本体：底、模糊、高光和阴影都复用 .panel */}
        <div className="mobile-nav-panel-inner panel panel-strong">
          <nav aria-label="站点导航">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="mobile-nav-link"
                onClick={() => setOpen(false)}
              >
                <LinkPending>{link.label}</LinkPending>
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}
