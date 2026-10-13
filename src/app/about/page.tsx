import type { Metadata } from "next";
import { LICENSE, siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "关于",
  description: `关于 ${siteConfig.author} 和这个博客。`,
};

export default function AboutPage() {
  return (
    <div className="flex flex-col gap-10 sm:gap-12">
      <header className="page-hero panel panel-strong grid gap-8 px-7 py-8 sm:px-10 sm:py-9 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
        <div className="flex flex-col gap-4">
          <p className="eyebrow">ABOUT THIS SPACE</p>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">关于</h1>
          <p className="max-w-xl text-base leading-relaxed text-secondary">
            {siteConfig.author} 的个人博客，记录学习、实践，也记录偶尔停下来观察生活的时刻。
          </p>
        </div>
        <div className="about-mark" aria-hidden="true">
          <svg
            className="about-atom"
            viewBox="0 0 160 160"
            fill="none"
            role="presentation"
          >
            <ellipse cx="80" cy="80" rx="62" ry="24" stroke="currentColor" strokeWidth="4" />
            <ellipse
              cx="80"
              cy="80"
              rx="62"
              ry="24"
              transform="rotate(60 80 80)"
              stroke="currentColor"
              strokeWidth="4"
            />
            <ellipse
              cx="80"
              cy="80"
              rx="62"
              ry="24"
              transform="rotate(120 80 80)"
              stroke="currentColor"
              strokeWidth="4"
            />
            <circle cx="80" cy="80" r="14" fill="currentColor" />
            <circle cx="75" cy="75" r="3" fill="var(--background)" />
            <circle cx="86" cy="84" r="3" fill="var(--background)" />
          </svg>
        </div>
      </header>

      {/* 「品」字布局：介绍面板在左，鸣谢面板在右，两块同款等宽；窄屏时鸣谢
          回落到下方。滚动时鸣谢面板吸在顶栏下面。 */}
      <div className="grid gap-10 sm:gap-12 lg:grid-cols-2 lg:items-start">
        {/* max-w-[42rem] 把正文约束在约 40 字/行：中文长文超过 45 字就容易串行。
              max-w-none 会让 prose 铺满整个容器，宽屏下行长失控。 */}
        <div className="panel panel-strong prose max-w-3xl px-6 py-7 sm:px-10 sm:py-9">
          <p>
            你好，我是 <strong>{siteConfig.author}</strong>。这里是{siteConfig.name}
            ，用来存放我的技术笔记、思考和随手记录。
          </p>

          <h2>这个博客怎么写的</h2>
          <ul>
            <li>
              <strong>技术栈</strong>：Next.js 16（App Router）+ TypeScript +
              Tailwind CSS v4
            </li>
            <li>
              <strong>内容格式</strong>：MDX。写文章就是新建{" "}
              <code>src/content/</code> 下的{" "}
              <code>.mdx</code> 文件，不需要数据库
            </li>
            <li>
              <strong>构建方式</strong>：构建时预渲染成静态 HTML，访问速度快，对搜索引擎友好
            </li>
            <li>
              <strong>阅读体验</strong>：文章带目录、阅读进度条和上下篇导航，明暗配色跟随系统
            </li>
          </ul>

          <h2>转载与引用</h2>
          <p>
            这个站的<strong>主题代码</strong>用{" "}
            <a href={LICENSE.codeUrl} target="_blank" rel="noreferrer">
              AGPL-3.0
            </a>
            {LICENSE.content ? (
              <>
                ；<strong>文章正文</strong>用{" "}
                <a href={LICENSE.contentUrl} target="_blank" rel="noreferrer">
                  {LICENSE.content}
                </a>
                ；文中原创的代码块按 MIT 处理。
              </>
            ) : (
              <>。文章内容的授权由站长自行决定，本站暂未声明。</>
            )}
            {" "}详情见下：
          </p>
          <p>
            代码用 AGPL 是被一个依赖带过来的：本站的液态玻璃用了{" "}
            <a
              href="https://github.com/martin65536/liquid-glass-webgl"
              target="_blank"
              rel="noreferrer"
            >
              liquid-glass-webgl
            </a>
            （AGPL-3.0），它要求整个服务向使用者提供源码，所以整站源码一并走
            AGPL 。完整的源码在{" "}
            <a href={siteConfig.repo} target="_blank" rel="noreferrer">
              仓库
            </a>
            。
          </p>

          <h2>关于我</h2>
          <p>
            一个热爱技术与 AI 、喜欢分享的普通人。
            {/* GitHub 主页是可选配置（site.ts 留空 = 站长没填），
                留空时整句不渲染，否则会出现空链接或指向默认值的链接 */}
            {siteConfig.github && (
              <>
                {" "}你可以在{" "}
                <a href={siteConfig.github} target="_blank" rel="noreferrer">
                  GitHub
                </a>{" "}
                找到我。
              </>
            )}
          </p>

        </div>

        {/* 鸣谢面板：与左侧介绍面板同一套面板和排版类，等宽等样式。 */}
        <aside className="panel panel-strong prose max-w-3xl px-6 py-7 sm:px-10 sm:py-9 lg:sticky lg:top-20">
          <h2>鸣谢</h2>
          <p>
            这个站可以说是站在许多开源项目的肩膀上，谢谢它们。
          </p>
          <ul>
              <li>
                <strong>框架</strong>：
                <a href="https://nextjs.org" target="_blank" rel="noreferrer">Next.js</a>、
                <a href="https://react.dev" target="_blank" rel="noreferrer">React</a>、
                <a href="https://tailwindcss.com" target="_blank" rel="noreferrer">Tailwind CSS</a>
              </li>
              <li>
                <strong>内容管线</strong>：
                <a href="https://mdxjs.com" target="_blank" rel="noreferrer">MDX</a>、
                <a href="https://github.com/remarkjs/remark-gfm" target="_blank" rel="noreferrer">remark-gfm</a>、
                <a href="https://github.com/rehypejs/rehype-slug" target="_blank" rel="noreferrer">rehype-slug</a>、
                <a href="https://rehype-pretty.pages.dev" target="_blank" rel="noreferrer">rehype-pretty-code</a>
                （代码高亮，底层是{" "}
                <a href="https://shiki.style" target="_blank" rel="noreferrer">Shiki</a>
                ）、
                <a href="https://github.com/Flet/github-slugger" target="_blank" rel="noreferrer">github-slugger</a>、
                <a href="https://github.com/remarkjs/remark-math" target="_blank" rel="noreferrer">remark-math</a>、
                <a href="https://github.com/remarkjs/remark-math/tree/main/packages/rehype-katex" target="_blank" rel="noreferrer">rehype-katex</a>、
                <a href="https://katex.org" target="_blank" rel="noreferrer">KaTeX</a>
                （LaTeX 公式渲染）
              </li>
              <li>
                <strong>液态玻璃</strong>：渲染器和 shader 原样取自{" "}
                <a
                  href="https://github.com/martin65536/liquid-glass-webgl"
                  target="_blank"
                  rel="noreferrer"
                >
                  liquid-glass-webgl
                </a>
                （AGPL-3.0，上游灵感来自{" "}
                <a
                  href="https://github.com/Kyant0/AndroidLiquidGlass"
                  target="_blank"
                  rel="noreferrer"
                >
                  Kyant0/AndroidLiquidGlass
                </a>
                ）；超长文章面板的 SVG 滤镜路线照{" "}
                <a
                  href="https://github.com/shuding/liquid-glass"
                  target="_blank"
                  rel="noreferrer"
                >
                  shuding/liquid-glass
                </a>
                （MIT）的思路重写。
              </li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
