import Link from "next/link";
import { siteConfig } from "@/lib/site";

/**
 * 顶栏左上角的站点标识：32px 圆形底 + 站名首字，纯 CSS 渲染。
 *
 * 不引用任何图片资源——静态导出环境下 next/image 会依赖 /_next/image
 * 路由，线上不存在会直接 404；纯 CSS 方案没有这个问题。想换成正式 logo
 * 时，把 <span> 换回图片即可，圆形裁切由 .site-logo-badge 负责。
 *
 * 链接里没有可读文字（首字是 aria-hidden 的装饰），所以 aria-label 是
 * 必须的（读屏会念「我的博客，链接」），title 负责鼠标悬停提示。
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
      <span className="site-logo-badge" aria-hidden="true">
        {siteConfig.name.charAt(0)}
      </span>
    </Link>
  );
}