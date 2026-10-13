/**
 * 站点全局配置。
 * 想改站名、简介、社交链接，只改这一个文件就够了。
 */
export const siteConfig = {
  name: "我的博客",
  author: "博主",
  description: "记录技术、思考与生活。",
  // 顶栏 logo。留空用「圆形底 + 站名首字」的纯 CSS 形态；填 public 下的
  // 图片路径（如 "/site-logo.jpg"）则显示圆形裁切的图片，尺寸和裁切
  // 仍由 globals.css 的 .site-logo-badge 负责。
  logo: "",
  // 浏览器标签页图标，与上面的顶栏 logo 相互独立。填写 public 下的图片路径，
  // 例如 "/images/favicon.png"；留空则使用 public/favicon.ico。
  favicon: "/favicon.ico",
  // 正式域名。部署后改成自己的域名，sitemap 等会用到；
  // Cloudflare Pages 每次推送都会重新构建，改这里之后要 push 才生效。
  url: "https://lll114514lll1919810lll.github.io/flowyblog-framework",
  // GitHub 个人主页，「关于」页的入口。留空（默认）就不渲染那句链接——
  // 出厂默认不能带上框架作者的主页，运行 setup 向导的站点配置步时填写。
  github: "",
  // 博客源码仓库。页脚「源码」链接（AGPL 要求向使用者提供完整源码，
  // 指向仓库才算履行）和关于页都指向这里，所以单独存一份，不和 github
  // 混用——那个是作者主页，不是源码地址。部署时改成自己的仓库地址。
  repo: "https://github.com/lll114514lll1919810lll/flowyblog-framework",
} as const;

/**
 * 版权与授权。
 *
 * 这个框架只声明「源码」授权：框架、组件、样式等源码走 AGPL-3.0，
 * 见仓库根目录的 LICENSE。
 *
 * 文章内容的授权不随框架声明，由使用者自行决定（见下方 LICENSE.content
 * 的说明）。没有声明时，内容默认按著作权法保留所有权利；想允许转载，
 * 就自己选一个协议填上。
 *
 * 源码为什么是 AGPL 而不是 MIT：框架集成了
 * [liquid-glass-webgl](https://github.com/martin65536/liquid-glass-webgl)
 * 的液态玻璃渲染器，那个项目是 AGPL-3.0。AGPL 的要求是「通过网络提供服务
 * 时，必须向使用者提供完整源码」，所以整个站点的源码都得按 AGPL 走，
 * 不能只把那一个组件单独标成 AGPL。
 *
 * 注意 AGPL 限制的是「要不要公开源码」，不限制商用——想拿去改着用、甚至
 * 用在商业项目里都可以，条件是衍生作品同样开源，并且通过网络提供服务时
 * 也要把源码给出去。
 *
 * 这里只存「给人看的文案」和链接，具体的权利义务以根目录的 LICENSE 为准，
 * 避免同一套条款在两处各写一遍、日后改漏。
 */
export const LICENSE = {
  // 源码（AGPL-3.0）。codeUrl 直接指向仓库而不是协议正文：
  // AGPL 第 13 条要求向网络使用者「提供完整源码」，指向仓库才算履行，
  // 只链一份协议全文不算。
  code: "AGPL-3.0",
  codeUrl: "https://github.com/lll114514lll1919810lll/flowyblog-framework",
  // 文章内容的授权由站主自行决定，框架不替你选。留空（默认）表示
  // 暂不声明，页脚和关于页会隐藏内容授权条目；想声明时两行都填上，
  // 例如：
  //   content: "CC BY-NC-SA 4.0",
  //   contentUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
  content: "",
  contentUrl: "",
} as const;

export const navLinks = [
  { href: "/", label: "首页" },
  { href: "/blog", label: "文章" },
  { href: "/tags", label: "标签" },
  { href: "/about", label: "关于" },
  { href: "/settings", label: "设置" },
] as const;

/**
 * 顶栏、底栏、正文三者的内容宽度上限，保持左右对齐。
 *
 * 用 rem 而不是 Tailwind 的 max-w-* 类，因为正文宽度要能被用户调节
 * （见 lib/reading-width.ts），两者需要用同一套单位换算。
 * 数值偏大是有意的：内容更靠近屏幕两侧，超宽屏上不会挤成一小条。
 */
export const CONTENT_MAX_WIDTH = "112rem"; // 约 1792px