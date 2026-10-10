"use client";

import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * 代码块的交互层：折叠按钮、复制按钮、语言标签、横向滚动渐变提示。
 *
 * 高亮本身是构建期完成的（rehype-pretty-code + Shiki），
 * 这个组件只负责交互，因此整个代码块不需要客户端重渲染正文——
 * 代码文本是服务端渲染好的 HTML。
 */
/** pre 上会多带一个 data-language（由 rehype-pretty-code 注入） */
type CodeBlockProps = React.HTMLAttributes<HTMLElement> & {
  /** 语言名，来自 pre 的 data-language，用于显示标签 */
  language?: string;
};

/**
 * 低于这个高度就不给折叠按钮。
 *
 * 十来行的代码块折起来没有意义，多一个按钮只会让工具条变吵；
 * 真正需要折叠的是那种几十行、占掉一整屏的配置和脚本。
 */
const FOLD_MIN_HEIGHT = 420;

/**
 * 数出代码有几行，用来渲染左侧行号槽位。
 *
 * 有语言标记的代码块由 rehype-pretty-code 拆成了 `[data-line]` 行节点，
 * 直接数这些节点即可；没写语言标记的纯文本代码块只有一段文本，
 * 这时退回按换行符数。
 */
function countCodeLines(node: ReactNode): number {
  let lines = 0;
  let text = "";
  const walk = (n: ReactNode) => {
    Children.forEach(n, (child) => {
      if (typeof child === "string" || typeof child === "number") {
        text += String(child);
        return;
      }
      if (!isValidElement(child)) return;
      const props = child.props as {
        "data-line"?: unknown;
        children?: ReactNode;
      };
      if (props["data-line"] !== undefined) {
        lines += 1;
        return;
      }
      walk(props.children);
    });
  };
  walk(node);
  if (lines > 0) return lines;
  const trimmed = text.replace(/\n$/, "");
  return trimmed.length > 0 ? trimmed.split("\n").length : 0;
}

export function CodeBlock({
  children,
  className,
  language,
  ...props
}: CodeBlockProps) {
  // data-language 已经转成 language 单独用了，从透传里剔除，
  // 避免同一个属性既写到外层容器又写到 pre 上。
  // style 也要单独拿出来：rehype-pretty-code 会往 pre 上写 Shiki 的
  // CSS 变量，直接 {...rest} 展开会把下面那条 maxHeight 整个盖掉。
  const {
    ["data-language"]: _discard,
    style: incomingStyle,
    ...rest
  } = props as Record<string, unknown>;
  void _discard;
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  /** 横向是否已经滚到最右。到了就撤掉右侧渐变，别压着最后几个字符 */
  const [atRightEnd, setAtRightEnd] = useState(true);
  /** 够不够高、值不值得给一个折叠按钮 */
  const [foldable, setFoldable] = useState(false);
  /** 内容总高。展开时写成内联 max-height，折叠动画才有过渡的目标值 */
  const [fullHeight, setFullHeight] = useState<number>();
  /** 默认展开；只有用户点了折叠才会变 true */
  const [collapsed, setCollapsed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyId = useId();
  const lineCount = countCodeLines(children);

  // 量两件事：是否横向溢出（决定右侧渐变），以及是否需要折叠按钮
  useEffect(() => {
    const el = preRef.current;
    if (!el) return;

    const check = () => {
      // 留 1px 容差，避免亚像素误差导致的误判
      const maxScroll = el.scrollWidth - el.clientWidth;
      setOverflowing(maxScroll > 1);
      // 已经滚到最右就撤掉渐变：它是盖在代码上的，留着会一直压住最后几个字符
      setAtRightEnd(el.scrollLeft >= maxScroll - 1);
      // scrollHeight 是内容总高，不受 max-height 限制。所以折叠状态下
      // 量到的仍是完整高度：按钮不会自己消失，展开动画的目标值也一直准
      const h = el.scrollHeight;
      setFullHeight(h);
      setFoldable(h > FOLD_MIN_HEIGHT);
    };

    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    el.addEventListener("scroll", check, { passive: true });

    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", check);
    };
  }, []);

  // 组件卸载时清掉定时器，避免内存泄漏
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const copy = useCallback(async () => {
    // 从 pre 里取纯文本：textContent 会带换行，但不含行号等装饰
    const text = preRef.current?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // 非安全上下文（http 局域网访问）下 clipboard 不可用，静默失败
      // 不做 alert 之类的打断，鼠标用户仍可手动选中复制
    }
  }, []);

  return (
    <div
      className={`code-block group relative${collapsed ? " is-collapsed" : ""}`}
      data-language={language}
      // 折叠后底部渐变要给横向滚动条让位，所以标记一下
      data-overflow-x={overflowing || undefined}
    >
      {/* 右上角操作区：语言标签 + 折叠 / 复制按钮 */}
      <div className="code-block-toolbar">
        {language && <span className="code-block-lang">{language}</span>}

        <div className="code-block-actions">
          {foldable && (
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              aria-expanded={!collapsed}
              aria-controls={bodyId}
              aria-label={collapsed ? "展开代码" : "折叠代码"}
              className="code-block-action code-block-fold"
            >
              <ChevronIcon up={!collapsed} />
              {collapsed ? "展开" : "折叠"}
            </button>
          )}

          <button
            type="button"
            onClick={copy}
            aria-label={copied ? "已复制代码" : "复制代码"}
            className="code-block-action code-block-copy"
            data-copied={copied || undefined}
          >
            {copied ? (
              <>
                <CheckIcon />
                已复制
              </>
            ) : (
              <>
                <CopyIcon />
                复制
              </>
            )}
          </button>
        </div>
      </div>

      <pre
        ref={preRef}
        id={bodyId}
        className={className}
        tabIndex={0}
        /*
          展开时把量到的内容总高写成内联 max-height，收起时交给
          .is-collapsed 里那条 18rem。两边都得是具体长度，CSS 才能从
          当前高度过渡过去，max-height: none 是没法参与过渡的。
          +2px 给子像素留余量，免得正好卡在边界上裁掉最后一行。
          不够高的代码块不加这条，保持原样。

          incomingStyle 是 Shiki 写在 pre 上的 CSS 变量，要合并进来，
          而且 maxHeight 必须排在它后面才不会被盖掉。
        */
        style={{
          ...(incomingStyle as React.CSSProperties | undefined),
          ...(foldable && fullHeight && !collapsed
            ? { maxHeight: fullHeight + 2 }
            : undefined),
        }}
        {...rest}
      >
        {children}
      </pre>

      {/* 行号槽位：钉在左侧，横向滚动时不动。
          pre 用透明左边框留出了这块空间，代码被裁在槽位右侧，
          所以行号不用底色去盖代码。 */}
      {lineCount > 0 && (
        <div
          className="code-block-gutter"
          aria-hidden
          /* 和 pre 用同一套折叠高度：展开时给具体值，收起时由 CSS 接管，
             两边才一起过渡 */
          style={
            foldable && fullHeight && !collapsed
              ? { maxHeight: fullHeight + 2 }
              : undefined
          }
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </div>
      )}

      {/* 右侧渐变：代码横向溢出、而且右边确实还有没看到的内容时才出现。
          滚到最右就收起来，不然最后几个字符永远压在半透明遮罩下面。 */}
      {overflowing && !atRightEnd && (
        <div className="code-block-fade" aria-hidden />
      )}

      {/* 底部渐变：折叠时提示下面还有内容。
          常挂在树上、用 data-hidden 控制透明度，展开时才能跟着淡出；
          按 collapsed 条件渲染的话它会比高度动画先一步消失。 */}
      {foldable && (
        <div
          className="code-block-collapse-fade"
          data-hidden={!collapsed || undefined}
          aria-hidden
        />
      )}
    </div>
  );
}

/** 折叠 / 展开的箭头：箭头方向跟着按钮文案走。
 *  展开态标着「折叠」，箭头朝上（收起 = 往上收）；
 *  折叠态标着「展开」，箭头朝下（展开 = 往下放）。 */
function ChevronIcon({ up }: { up: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
      className={`transition-transform duration-200 ${up ? "rotate-180" : ""}`}
    >
      <path
        d="M2.5 4.5L6 8l3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect
        x="4.5"
        y="4.5"
        width="8"
        height="8"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M9.5 2.5v-.5a1 1 0 0 0-1-1h-5a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M3 7.5L5.8 10.2L11 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
