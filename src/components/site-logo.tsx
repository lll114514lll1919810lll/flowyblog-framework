import Image from "next/image";
import Link from "next/link";
import { siteConfig } from "@/lib/site";

/**
 * 顶栏左上角的站点标识，两种形态由 siteConfig.logo 决定：
 *
 * - 留空（默认）：32px 圆形底 + 站名首字，纯 CSS 渲染，不依赖任何图片资源。
 * - 填 public 下的图片路径（如 "/site-logo.jpg"）：渲染成圆形裁切的图片。
 *   图片走 next/image，导出构建会关闭优化器（images.unoptimized）直接输出
 *   原图路径，静态托管下没有 404 问题；圆形裁切由 .site-logo-badge 的
 *   object-fit: cover 负责。
 *
 * 图片形态下链接里没有可读文字，所以 aria-label 是必须的（读屏会念
 * 「站名，链接」），title 负责鼠标悬停提示；圆点本身 aria-hidden，
 * 否则读屏会把首字/alt 也念一遍。
 */
export function SiteLogo() {
  return (
    <Link
      href="/"
      aria-label={siteConfig.name}
      title={siteConfig.name}
      /* h-11 w-11：44px 触控热区；rounded-full 让焦点框跟着圆点走，
         而不是画一个方形框。flex-none 保证窄屏上不会被挤扁。 */
      className="site-logo flex h-11 w-11 flex-none items-center justify-center rounded-full"
    >
      {siteConfig.logo ? (
        <Image
          src={siteConfig.logo}
          alt=""
          width={32}
          height={32}
          className="site-logo-badge"
          aria-hidden="true"
        />
      ) : (
        <span className="site-logo-badge" aria-hidden="true">
          {siteConfig.name.charAt(0)}
        </span>
      )}
    </Link>
  );
}
