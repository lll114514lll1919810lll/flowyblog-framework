"use client";

import { useRef, type ReactNode } from "react";
import { ArticleImages } from "@/components/article-images";
import { BackToTop } from "@/components/back-to-top";
import { TableOfContents } from "@/components/table-of-contents";
import {
  READING_WIDTHS,
  useCharsPerLine,
  useReadingWidth,
} from "@/lib/reading-width";
import type { TocItem } from "@/lib/posts";

/**
 * 文章主体区域。
 *
 * 正文宽度由用户在浏览器里调节，所以这部分必须是客户端组件；
 * MDX 的渲染结果作为 children 传进来，仍然是服务端渲染的。
 *
 * 宽度状态只能在这一个组件里维护：如果「切换按钮」和「正文容器」
 * 各自调用 useReadingWidth，那是两个互不相干的 state，
 * 点按钮不会让正文变宽。
 */
export function PostBody({
  toc,
  header,
  footer,
  children,
}: {
  toc: TocItem[];
  /** 文章头部（标题、摘要、元信息），由 server 组件渲染 */
  header: ReactNode;
  /** 文章末尾（上一篇/下一篇），由 server 组件渲染 */
  footer: ReactNode;
  children: ReactNode;
}) {
  const { widthId, setWidth } = useReadingWidth();
  // 「每行多少字」得按正文列的真实宽度算，所以 ref 挂在下面的 .prose 上
  const proseRef = useRef<HTMLDivElement>(null);
  const charsPerLine = useCharsPerLine(proseRef);
  const width =
    READING_WIDTHS.find((w) => w.id === widthId) ?? READING_WIDTHS[1];
  const currentIndex = READING_WIDTHS.findIndex((w) => w.id === widthId);
  const next = READING_WIDTHS[(currentIndex + 1) % READING_WIDTHS.length];

  return (
    /* data-reading-width 是给 CSS 用的：目录放右侧还是挤回顶部，
       取决于「当前档位的正文宽度 + 侧栏 + 间距」在视口里放不放得下。
       媒体查询读不了 CSS 变量，所以由这个属性在 CSS 里分档写死门槛。 */
    <div
      className="flex flex-col gap-10 sm:gap-12"
      data-reading-width={widthId}
    >
      {/* 放不下时目录挤在顶部，收进一个折叠按钮 */}
      <div className="toc-top-slot">
        <TableOfContents variant="collapsible" items={toc} />
      </div>

      {/* 放得下时正文 + 目录并排，整块居中。
          方向、间距、显隐全部由 .article-row / .toc-sidebar-slot 在
          globals.css 里按档位给——这里不挂 Tailwind 的 flex-col / hidden，
          那些在 utilities 层，会盖掉 components 层里的媒体查询规则。 */}
      <div className="article-row">
        {/* w-full 而不是 flex-1：让 maxWidth 真正生效。
            flex-1 会把元素撑满可用空间，maxWidth 就形同虚设。

            panel-strong：整篇文章是一块阅读面板，用更实的底
            （0.86 而不是 0.72），长文叠在背景图上才不费眼。 */}
        <article
          className="panel panel-strong w-full min-w-0 px-5 py-7 transition-[max-width] duration-300 ease-out sm:px-9 sm:py-9"
          style={{ maxWidth: width.maxWidth }}
        >
          {header}

          {/* 窄屏不显示这条：手机上正文本来就只有一列宽，可调的余地很小，
              而这条控制线要占掉整整两行高度，压在正文前面不划算。 */}
          <div className="hidden pb-4 sm:block">
            <WidthControl
              label={width.label}
              charsPerLine={charsPerLine}
              currentIndex={currentIndex}
              onSelect={(id) => setWidth(id)}
              onAdvance={() => setWidth(next.id)}
              nextLabel={next.label}
            />
          </div>

          {/* data-article-prose 是配图放大组件的挂载点：
              正文是 MDX 出来的裸 HTML，只能挂载后再去增强其中的 <img> */}
          <div
            ref={proseRef}
            className="prose border-t border-border pt-9"
            data-article-prose
          >
            {children}
          </div>

          <ArticleImages />

          <div className="mt-12">{footer}</div>
        </article>

        {/*
          桌面端目录侧栏。
          self-stretch 必须显式写出来：上一行的 items-start 会让这一格
          高度只等于目录自身（约 360px），而 position:sticky 只能在
          它的包裹层范围内生效——滚过那段高度目录就跟着消失了。
          拉伸到整行高度后，sticky 才有足够的行程。
        */}
        <div className="toc-sidebar-slot">
          <TableOfContents variant="sidebar" items={toc} />
        </div>
      </div>

      {/* 长文才需要回到顶部，所以只在文章页渲染 */}
      <BackToTop />
    </div>
  );
}

/** 宽度调节条：把当前说明、档位轨道和切换入口合并成一条控制线。 */
function WidthControl({
  label,
  charsPerLine,
  currentIndex,
  onSelect,
  onAdvance,
  nextLabel,
}: {
  label: string;
  /** 每行能放多少个全角字。浏览器量出来之前是 undefined，这时先不显示数字 */
  charsPerLine?: number;
  currentIndex: number;
  onSelect: (id: (typeof READING_WIDTHS)[number]["id"]) => void;
  onAdvance: () => void;
  nextLabel: string;
}) {
  const size = charsPerLine ? `每行约 ${charsPerLine} 字` : "";

  return (
    <div className="reading-width-control" aria-label="正文宽度调节">
      <p className="reading-width-copy">
        <span>正文宽度</span>
        {size && <strong>{size}</strong>}
      </p>

      <div className="reading-width-track" role="radiogroup" aria-label="选择正文宽度">
        <span
          className="reading-width-progress"
          style={{
            transform: `translateY(-50%) scaleX(${currentIndex / (READING_WIDTHS.length - 1)})`,
          }}
          aria-hidden="true"
        />
        {READING_WIDTHS.map((w, i) => (
          <button
            key={w.id}
            type="button"
            role="radio"
            aria-checked={i === currentIndex}
            aria-label={w.label}
            title={`切换为「${w.label}」`}
            onClick={() => onSelect(w.id)}
            className={`reading-width-stop ${i === currentIndex ? "is-active" : ""}`}
          >
            <span aria-hidden="true" />
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onAdvance}
        title={`当前「${label}」${size ? `，${size}` : ""}。点击切换为「${nextLabel}」`}
        className="reading-width-current"
      >
        <span>{label}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden
          className="transition-transform duration-300 group-hover:translate-x-0.5"
        >
          <path
            d="M3 1.5L6 5L3 8.5"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <span className="sr-only">
        正文宽度：{label}
        {size ? `，${size}` : ""}
        。当前选项。点击轨道档位可直接调整，点击右侧按钮切换为{nextLabel}。
      </span>
    </div>
  );
}