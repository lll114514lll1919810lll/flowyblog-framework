import Link from "next/link";
import { CONTENT_MAX_WIDTH, LICENSE, siteConfig } from "@/lib/site";
import { AdminEntry } from "@/components/admin-entry";
import { LinkPending } from "@/components/link-pending";
import { MobileNav } from "@/components/mobile-nav";
import { SiteLogo } from "@/components/site-logo";
import { SiteNav } from "@/components/site-nav";
import { SiteSearch } from "@/components/site-search";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * 顶栏底栏共用的样式：通栏、直角、保留毛玻璃。
 *
 * 用 .panel 拿到半透明底 + 背景模糊 + 内高光，再用工具类把圆角去掉、
 * 去掉左右和一侧的边框——.panel 在 @layer components 里，
 * 工具类在 @layer utilities 里排在后面，能正常覆盖。
 *
 * 圆角去掉是因为通栏条一旦有圆角，四角会露出背景、看着像没铺满；
 * 直角加一条下边框才是「贴到屏幕边缘」该有的样子。
 *
 * 通栏右缘到滚动条为止（html 用 overflow-y: scroll 保证滚动条永远在，
 * 槽位不会被留空成一条底色缝；见 globals.css 中该规则的注释）。
 */
const BAR = "panel rounded-none border-x-0";

/**
 * 顶栏。控件布局参考 XinBlog 的顶栏设计：
 *   左「站标 + 常驻的内联搜索框」，右「导航 + 主题开关」。
 *
 * 宽屏（≥ md）把导航排成一组带滑动高亮的胶囊（SiteNav）；放不下时
 * 收进汉堡菜单（MobileNav），保持顶栏不被挤溢出。搜索在窄屏会跟着收缩，
 * 但始终留在原地——它不是一个「先点图标再弹窗」的入口。
 */
export function SiteHeader() {
  return (
    // 直角通栏，贴住屏幕上沿
    <header className={`${BAR} sticky top-0 z-50 w-full border-t-0`}>
      {/* 顶栏高度用 --header-h 统一：搜索浮层、汉堡菜单面板都要靠它
          算「顶栏下沿」的位置，写死两处迟早对不上 */}
      <div
        className="mx-auto flex h-[var(--header-h)] items-center gap-2 px-4 sm:gap-3 sm:px-6"
        style={{ maxWidth: CONTENT_MAX_WIDTH }}
      >
        {/* 站点标识：占位圆形图标，见 site-logo.tsx */}
        <SiteLogo />

        {/* 常驻的内联搜索框，占据站标与右侧控件之间的弹性空间 */}
        <SiteSearch />

        {/* 右侧控件组。ml-auto 把整组推到最右，即使搜索框没占满也靠右 */}
        <div className="ml-auto flex items-center gap-1.5 sm:gap-4">
          {/* 导航：宽屏排成一组带滑动高亮的胶囊。外围包一层只负责显隐，
              组件本身是客户端组件（要高亮位置、当前页都得靠 JS） */}
          <div className="hidden md:flex">
            <SiteNav />
          </div>

          {/* 窄屏用汉堡菜单替代导航链接。外围包一层只负责显隐，
              组件本身是客户端组件（要管开合状态） */}
          <div className="md:hidden">
            <MobileNav />
          </div>

          {/* 主题开关保留原来的滑块形态（见 theme-toggle.tsx） */}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    /* 同样直角通栏，贴住屏幕下沿；只留上边框作为分隔。
       不在 footer 上加 pt——那是面板内部的padding，会把半透明底
       往上延伸；与正文之间的空隙由 main 的底部内边距提供。

       纵向内边距 py-4（原来是 py-6）：页脚只是版权和授权两行小字，
       24px 上下留白让它看起来像第二块内容面板，抢了正文的注意力。
       收到 16px 后整条更像一条收尾的分隔线。 */
    <footer className={`${BAR} mt-auto w-full border-b-0`}>
      <div
        className="mx-auto flex flex-col gap-3 px-4 py-4 text-[13px] text-muted sm:flex-row sm:items-end sm:justify-between sm:px-6"
        style={{ maxWidth: CONTENT_MAX_WIDTH }}
      >
        <div className="flex flex-col gap-1">
          {/* 静态导出下这是构建期求值：年份固化为最近一次部署的那年。
              跨年不重新部署就会显示旧年份——重新发布（push 即重建）即可更新，
              不值得为它引入一段客户端脚本。 */}
          <p>
            © {new Date().getFullYear()} {siteConfig.author}
          </p>
          <p>
            Powered by{" "}
            <a
              href="https://github.com/lll114514lll1919810lll/flowyblog-framework"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-foreground"
            >
              FlowyBlog Framework
            </a>
          </p>
        </div>

        {/* 授权声明放在页脚而不是关于页：转载的人通常只翻到这个站最底部，
            才会去找「能不能转」的答案。写在这里，被爬到的概率最高。

            「内容」条目仅在站主声明了内容授权（site.ts 里 LICENSE.content
            非空）时出现；留空表示暂不声明，页脚就不显示这一项。

            「源码」这条链的是仓库而不是协议正文：AGPL 第 13 条要求向网络
            使用者提供完整源码，指向仓库才算履行，只链一份协议全文不算。

            文字写「内容 / 源码」而不是「文章 / 代码」：
            页脚一行放不下长句子，短词在 320px 上也不会折行。 */}
        <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {LICENSE.content && (
            <span className="whitespace-nowrap">
              内容 ·{" "}
              <a
                href={LICENSE.contentUrl}
                target="_blank"
                rel="noreferrer license"
                className="transition-colors hover:text-foreground"
              >
                {LICENSE.content}
              </a>
            </span>
          )}
          <span className="whitespace-nowrap">
            源码 ·{" "}
            <a
              href={LICENSE.codeUrl}
              target="_blank"
              rel="noreferrer license"
              className="transition-colors hover:text-foreground"
            >
              {LICENSE.code}
            </a>
          </span>

          {/* 实验室入口放在授权这一行的最右端。
              它自己也占一个「组」而不是混进上面两组之一：
              justify-between 下底栏是「左版权、右元信息」两块，
              把它单独做成第三个子项会被顶到正中间，孤零零一个链接
              悬在两块内容之间。留在这行里就是右对齐的第三个短项。

              加一枚烧瓶图标是因为它和旁边两条性质不同：
              那两条是「内容/源码各自的协议」，这条是一个页面。
              图标承担「这里不是协议」的区分，同时不抢视线。
              也不进顶栏——实验室是给愿意折腾的人准备的暗门，
              顶栏四个入口对应的是站点的四类内容，不该和它并列。 */}
          <span className="whitespace-nowrap">
            <Link
              href="/lab"
              className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9.5 3h5M10.5 3v6.3L5.9 17.5A2 2 0 0 0 7.7 20.5h8.6a2 2 0 0 0 1.8-3L13.5 9.3V3" />
              </svg>
              <LinkPending>实验室</LinkPending>
            </Link>
          </span>

          {/* 后台入口紧跟在实验室后面，同样是一个「页面」性质的短项。
              只有已登录的管理员才渲染（组件内部探测），访客看到的是空白，
              所以它的有无不影响上面那几项的排布。

              放在这里而不是顶栏：顶栏那四个链接对应站点的四类内容，后台是
              站点管理，不属于其中任何一类；而底栏右端本来就是「元信息」区，
              内容/源码/实验室都在这儿。 */}
          <AdminEntry />
        </p>
      </div>
    </footer>
  );
}
