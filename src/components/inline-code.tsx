"use client";

import { useEffect, useRef, useState, type HTMLAttributes, type MouseEvent } from "react";

/**
 * 行内代码：点击即复制。
 *
 * 由 mdx-components 的 code 映射接入——MDX 里的 `code` 一律经过这里。
 * 块级代码不会进来：rehype-pretty-code 会给 pre > code 打上 data-language，
 * 映射里靠这个属性分 流，只有无属性的行内裸 code 走本组件。
 *
 * 交互刻意保持克制：
 * - 只做点击复制，不加键盘焦点。一篇文章里有上百个行内代码，
 *   全部塞进 Tab 序列会污染键盘导航；键盘用户仍可照常选中复制。
 * - 复制失败（非安全上下文的 http 访问没有 clipboard API）静默处理，
 *   和 CodeBlock 的复制按钮同一策略。
 * - stopPropagation：行内代码可能嵌在链接里，复制点击不能冒泡成跳转。
 */

/** 「已复制」气泡的显示时长 */
const FEEDBACK_MS = 1200;

export type InlineCodeProps = HTMLAttributes<HTMLElement> & {
  /** 块级代码的标记；本组件只会收到没有这个属性的行内代码，保留类型对齐 */
  "data-language"?: string;
};

export function InlineCode({ children, ...props }: InlineCodeProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLElement>(null);

  // 卸载时清掉定时器，避免对已卸载组件 setState
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const copy = (event: MouseEvent<HTMLElement>) => {
    // 行内代码可能嵌在链接里，先拦住，别让复制变成页面跳转
    event.stopPropagation();
    const text = ref.current?.textContent ?? "";
    if (!text) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), FEEDBACK_MS);
      })
      .catch(() => {
        // 非安全上下文（http 局域网访问）下 clipboard 不可用，静默失败
      });
  };

  return (
    <code
      {...props}
      ref={ref}
      onClick={copy}
      className={`inline-code-copy${props.className ? ` ${props.className}` : ""}`}
      title="点击复制"
      data-copied={copied || undefined}
    >
      {children}
    </code>
  );
}
