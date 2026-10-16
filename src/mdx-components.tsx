import type { MDXComponents } from "mdx/types";
import { CodeBlock, type PreElementProps } from "@/components/code-block";
import { InlineCode } from "@/components/inline-code";

/**
 * 全局 MDX 组件映射。
 *
 * MDX 把 Markdown 标题、段落、列表等编译成裸 HTML 元素。这里可以给它们套上样式，
 * 对所有 .mdx 文章同时生效——相当于「全站文章统一样式」的唯一入口。
 * 这是 App Router 使用 @next/mdx 的必需文件。
 */
const components: MDXComponents = {
  /**
   * 接管所有 <pre>，给它加上复制按钮、语言标签和横向滚动提示。
   *
   * rehype-pretty-code 会把语言名写在 pre 的 data-language 属性上，
   * 按类型拆出来传给 CodeBlock。MDX 的 pre 类型不认识 data-* 属性，
   * 所以边界上需要一次显式断言（PreElementProps 是两端共用的形状定义，
   * 见 code-block.tsx）——除此之外整条链路都是类型对齐的。
   */
  pre: ({ className, children, ...props }) => {
    const { "data-language": language, ...rest } = props as PreElementProps;
    return (
      <CodeBlock {...rest} className={className} language={language}>
        {children}
      </CodeBlock>
    );
  },

  /**
   * 行内代码：点击即复制（InlineCode，客户端组件）。
   *
   * MDX 里所有 code 元素都会经过这个映射，包括代码块内部的那个 code——
   * 区分依据是 rehype-pretty-code 的产物：块级 pre > code 一律带
   * data-language 属性，行内裸 code 没有任何属性。带标记的原样放行，
   * 交给 CodeBlock 的 pre 外壳；不带标记的才是行内代码，换成交互组件。
   */
  code: (props) => {
    if (props["data-language"] !== undefined) {
      return <code {...props} />;
    }
    return <InlineCode {...props} />;
  },

  /**
   * 表格外面套一层横向滚动容器。
   *
   * .prose table 的 width:100% 只是「期望宽度」，表格不会收缩到 min-content
   * 以下。某一列内容一长（比如接口路径 /v1/chat/completions 配上中文长句），
   * 表格就会撑破正文列，在窄屏上引发**整页横向溢出**。
   *
   * 后果不只是能左右滑：顶栏和阅读进度条是按视口宽度渲染的，
   * 一旦页面能横向滚动，它们在右侧就会「断开」——手机上双指缩小后
   * 顶栏缺一截，就是这么来的。
   *
   * 包一层 overflow-x:auto 后，超宽部分变成容器内部滚动，不再影响文档宽度；
   * 表格自身仍是 width:100%，宽屏下观感和以前完全一致。
   * 这与 pre 的处理思路一致（见上面的 CodeBlock）。
   */
  table: ({ children, ...props }) => (
    <div className="table-scroll">
      <table {...props}>{children}</table>
    </div>
  ),

  /**
   * 外链一律在新标签页打开。
   *
   * 技术博客的参考链接多是外部文档/GitHub 仓库，直接跳走会丢失阅读位置，
   * 而读者的意图通常是「看一眼就回来」。同时补 rel：
   * noopener 防止目标页通过 window.opener 反向操纵本页，
   * noreferrer 避免把访客来源泄漏给对方。
   */
  a: ({ href, children, ...props }) => {
    const isExternal = typeof href === "string" && /^https?:\/\//.test(href);
    return (
      <a
        {...props}
        href={href}
        target={isExternal ? "_blank" : undefined}
        rel={isExternal ? "noopener noreferrer" : undefined}
      >
        {children}
      </a>
    );
  },
};

export function useMDXComponents(): MDXComponents {
  return components;
}