import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { ReadingProgress } from "@/components/reading-progress";
import { PageTransition } from "@/components/page-transition";
import { LabRuntimes } from "@/components/lab-runtimes";
import { LABS_INIT_SCRIPT } from "@/lib/labs";
import { siteConfig } from "@/lib/site";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`, // 子页面标题自动加上站点名
  },
  description: siteConfig.description,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // lang 告诉浏览器和搜索引擎这是简体中文站点
    //
    // suppressHydrationWarning：<head> 里的内联脚本会在浏览器解析 HTML 时
    // （早于水合、早于首次绘制）就往 <html> 写 data-theme 和 color-scheme，
    // 这两个属性 JSX 里没有，React 水合时会当成属性不一致。
    // 这里明确告诉 React：这个元素上的差异是预期内的，以 DOM 为准。
    <html lang="zh-CN" className="h-full antialiased" suppressHydrationWarning>
      <head>
        {/* 必须在 <head> 里同步执行：脚本跑完才开始渲染 body，
            深色用户不会先看到一帧白底。见 lib/theme.ts 的说明。 */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* 同理，实验室开关也要在首次绘制前写好 <html data-labs>，
            否则开了实验的人每次进站都会先闪一帧默认外观。
            它和主题脚本各管一个属性，互不读写，顺序无所谓。 */}
        <script dangerouslySetInnerHTML={{ __html: LABS_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        {/* 运行时型的实验室实验（WebGL 那类）自己铺一层 fixed 的背景，
            放在最前面只是为了 DOM 顺序好看——它是 z-index:-1，
            画在正文下面，和后面的兄弟节点不抢位置。 */}
        <LabRuntimes />
        <ReadingProgress />
        {/* 顶栏和底栏在 PageTransition 之外，切换页面时保持静止 */}
        <SiteHeader />
        <PageTransition>{children}</PageTransition>
        <SiteFooter />
      </body>
    </html>
  );
}