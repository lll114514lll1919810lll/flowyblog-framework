"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { navLinks } from "@/lib/site";
import { LinkPending } from "@/components/link-pending";

/**
 * 顶栏导航（宽屏）。
 *
 * 形态参考 XinBlog（https://xin--blog.pages.dev/ ，MIT 协议）：整组链接收在
 * 一个胶囊容器里，当前页背后有一枚高亮胶囊，切换页面时滑到新的当前位置。
 *
 * 高亮只反映「当前页」，不跟鼠标走：划过别的项就立刻把胶囊吸过去太跳，
 * 反而干扰阅读。这里只在路由变化时移动。
 *
 * 位置不能靠 CSS 猜：哪一项是当前页只有 JS 知道，项宽也随文案、字号、语言
 * 变化，所以用 ref 量出目标项的矩形，再据此设置 translateX + width，
 * 位移的补间交给 CSS transition。
 */

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** 去掉 usePathname 结果里的 basePath 前缀，才能和 navLinks 的 href 直接比较 */
function stripBasePath(pathname: string): string {
  if (basePath && pathname.startsWith(basePath)) {
    return pathname.slice(basePath.length) || "/";
  }
  return pathname;
}

/** 是否为当前页：首页要精确匹配，其余允许子路径（/blog/xxx 也算「文章」） */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteNav() {
  const pathname = stripBasePath(usePathname());
  const navRef = useRef<HTMLElement>(null);
  const linkRefs = useRef(new Map<string, HTMLAnchorElement>());
  const [indicator, setIndicator] = useState<{ x: number; width: number } | null>(
    null,
  );

  const activeHref =
    navLinks.find((link) => isActive(pathname, link.href))?.href ?? null;

  /* 量尺寸必须在绘制前完成，否则会先看到胶囊停在旧位置再跳一下。
     只观察 nav 自己就够了：胶囊是 nav 的子元素，nav 移动时它跟着走，
     真正需要重新量的只有「文案/字号变化导致项宽变了」这种情况。 */
  useLayoutEffect(() => {
    const nav = navRef.current;
    const el = activeHref ? linkRefs.current.get(activeHref) : null;

    const update = () => {
      if (!nav || !el) {
        setIndicator(null);
        return;
      }
      const navRect = nav.getBoundingClientRect();
      const linkRect = el.getBoundingClientRect();
      // 绝对定位的包含块是 nav 的 padding box，减掉左边框宽度才和测量原点一致
      setIndicator({
        x: linkRect.left - navRect.left - nav.clientLeft,
        width: linkRect.width,
      });
    };

    update();
    if (!nav) return;
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [activeHref]);

  return (
    <nav ref={navRef} className="site-nav" aria-label="站点导航">
      <span
        className="site-nav-indicator"
        style={
          indicator
            ? {
                transform: `translateX(${indicator.x}px)`,
                width: indicator.width,
              }
            : undefined
        }
        data-visible={indicator ? "true" : undefined}
        aria-hidden="true"
      />

      {navLinks.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          ref={(el) => {
            if (el) linkRefs.current.set(link.href, el);
            else linkRefs.current.delete(link.href);
          }}
          className="site-nav-link"
          data-active={link.href === activeHref ? "true" : undefined}
          aria-current={link.href === activeHref ? "page" : undefined}
        >
          <LinkPending>{link.label}</LinkPending>
        </Link>
      ))}
    </nav>
  );
}
