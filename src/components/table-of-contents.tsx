"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TocItem } from "@/lib/posts";
import {
  getScrollLock,
  scrollIntoViewIfNeeded,
  scrollToAnchor,
} from "@/lib/scroll";
import { useActiveHeading } from "./use-active-heading";

/**
 * 子项列表展开/收起的高度过渡时长，必须与 .toc-sublist 上的
 * duration-250 保持一致（见 globals.css）。
 */
const TOC_TOGGLE_MS = 250;

/**
 * 切换章节后，旧章节延迟多久才开始收起。
 *
 * 留出比展开动画稍长一点的时间，让新章节先长开、旧章节再收回，
 * 两段动画不重叠。同时做，侧栏内容会在同一时间既收缩又增长，
 * 后面的条目被推来推去，看起来在抖。
 */
const COLLAPSE_DELAY_MS = TOC_TOGGLE_MS + 40;

/**
 * 文章目录的两种形态：
 * - sidebar：桌面端，贴在正文右侧，滚动时高亮当前小节
 * - collapsible：移动端，收进一个可折叠按钮里，侧栏在窄屏没有空间
 *
 * 由调用方用断点决定渲染哪一种，各自只挂载一次观察器。
 */
export function TableOfContents({
  items,
  variant,
}: {
  items: TocItem[];
  variant: "sidebar" | "collapsible";
}) {
  // 少于两节的目录没有导航价值，直接不渲染
  if (items.length < 2) return null;

  return variant === "sidebar" ? (
    <Sidebar items={items} />
  ) : (
    <Collapsible items={items} />
  );
}

/**
 * 把扁平的目录条目组织成「二级标题 + 其下三级标题」的树。
 *
 * h3 归属于它前面最近的那个 h2；如果开头出现 h3（没有父级），
 * 归入一个匿名分组，避免层级丢失。
 */
type TocNode = {
  id: string;
  text: string;
  children: TocItem[];
};

function buildTree(items: TocItem[]): TocNode[] {
  const nodes: TocNode[] = [];
  let current: TocNode | null = null;

  for (const item of items) {
    if (item.depth === 2) {
      current = { id: item.id, text: item.text, children: [] };
      nodes.push(current);
    } else {
      if (!current) {
        current = { id: "", text: "", children: [] };
        nodes.push(current);
      }
      current.children.push(item);
    }
  }

  // 丢掉匿名空分组（既没有标题也没有子项）
  return nodes.filter((n) => n.id || n.children.length > 0);
}

/**
 * 桌面端侧栏：目录树，h3 默认折叠。
 *
 * 长文章常有几十个三级标题，全部铺开会把侧栏撑得很长、挤占正文视野，
 * 所以默认只显示二级标题，点某个二级标题才展开它的子项。
 */
function Sidebar({ items }: { items: TocItem[] }) {
  const activeId = useActiveHeading(items);
  const tree = useMemo(() => buildTree(items), [items]);

  /**
   * 手动展开的分组（只记一个）。
   *
   * 展开状态分两种来源：
   * 1. 当前正在读的章节 —— 强制展开，不受这个 state 控制
   * 2. 用户手动点开的非当前章节 —— 记在这里
   *
   * 只保留一个手动项，配合「切换章节时清空」的规则，
   * 同一时刻最多只有一个分组是展开的，目录始终紧凑。
   */
  const [manualId, setManualId] = useState<string | null>(null);

  // 滚动到某个三级标题时，自动展开它所属的分组，
  // 否则高亮的条目在折叠状态下看不见，读者会困惑「高亮去哪了」。
  const activeNode = tree.find(
    (n) => n.id === activeId || n.children.some((c) => c.id === activeId),
  );
  const activeGroupId = activeNode?.id ?? null;

  // 侧栏自身也可能超长（展开多个分组后），需要能被滚动到可视区
  const navRef = useRef<HTMLElement>(null);
  // WinUI3 式滑动指示条，整棵目录只有这一条
  const indicatorRef = useRef<HTMLSpanElement>(null);
  // 指示条追踪状态放在 ref 里：快速连点会让下面的 effect 频繁重启，
  // 状态跨重启保留，才不会每次都当成「首次定位」重新触发果冻拉伸
  const indicatorPosRef = useRef<{ top: number; height: number }>({
    top: Number.NaN,
    height: Number.NaN,
  });

  /**
   * 正在等待收起的旧章节。
   *
   * 切换章节时不能立刻把旧章节折起来：新的正在长开、旧的正在收回，
   * 两段动画同时跑，侧栏里后面的条目会被同时推上和拉下，看起来很抖。
   * 这里让旧章节多停留一会儿（closingId 期间仍算展开），
   * 等新章节的展开动画跑完再真正收起。
   */
  const [closingId, setClosingId] = useState<string | null>(null);

  /**
   * 切换章节时：清掉手动展开项，并把上一章标为「待收起」。
   *
   * 用渲染期比较而不是 useEffect：effect 里同步 setState 会多渲染一轮，
   * 也触发 react-hooks/set-state-in-effect。这也是 React 官方推荐的
   * 「props 变化时重置 state」写法。
   */
  const [prevActiveGroup, setPrevActiveGroup] = useState<string | null>(null);
  if (activeGroupId !== prevActiveGroup) {
    const previous = prevActiveGroup;

    setPrevActiveGroup(activeGroupId);
    // 「之前章节自动收起，无视用户是否手动展开过」
    setManualId(null);

    /**
     * 只有「点击目录跳转」引起的切换才延迟收起。
     *
     * 正常滚动页面时章节变化必须即时响应——高亮已经跟手移到新章节了，
     * 展开状态却慢半拍才跟上，会让人以为目录卡了。
     *
     * 跳转期间滚动锁是开着的（lib/scroll.ts），据此区分两种来源。
     */
    const fromJump = getScrollLock() !== null;

    if (
      fromJump &&
      previous !== null &&
      previous !== activeGroupId &&
      previous !== manualId
    ) {
      setClosingId(previous);
    } else if (!fromJump) {
      // 滚动引起的变化：立刻收起，不留待收起状态
      setClosingId(null);
    }
  }

  /**
   * 延迟收起旧章节。定时器回调里 setState 属于异步，不会触发
   * react-hooks/set-state-in-effect。
   */
  useEffect(() => {
    if (closingId === null) return;
    const timer = setTimeout(() => setClosingId(null), COLLAPSE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [closingId]);

  // 展开的分组也跟着高亮项走：展开后如果条目在侧栏可视区外，
  // 读者看不到自己刚展开了什么
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || !activeId) return;
    const activeEl = nav.querySelector<HTMLElement>(
      `a[aria-current="location"]`,
    );
    if (activeEl) scrollIntoViewIfNeeded(activeEl, nav);
  }, [activeId, manualId]);

  /**
   * 滑动指示条的位置追踪。
   *
   * 位置不能只在 activeId 变化时量一次：切换章节时分组会展开/收起，
   * 250ms 的高度过渡里后面的条目一直在挪。所以起一个 rAF 循环追着量，
   * 目标位置连续几帧不动了才收工——过渡期间指示条被平滑地拽到新位置。
   *
   * 快速连点的打断：CSS transition 本来就会从「当前渲染位置」重新出发，
   * 这里要配合的是别再添乱——上一目标位置存在 indicatorPosRef 里跨重启
   * 保留，果冻拉伸只在真正的章节跳跃（≥ JELLY_MIN_DELTA）时触发，
   * 布局微调带来的几像素漂移直接平移过去，不会一惊一乍地甩。
   */
  useEffect(() => {
    const nav = navRef.current;
    const indicator = indicatorRef.current;
    if (!nav || !indicator) return;

    const PILL_HEIGHT = 16; // 与旧版 h-4 一致：文字折行时条也不会跟着变长
    // 覆盖「待收起延迟 290ms + 收起过渡 250ms」的完整布局变化期
    const SETTLE_MS = 700;
    // 小于这个距离的移动视为布局微调，不触发果冻拉伸
    const JELLY_MIN_DELTA = 24;
    let raf = 0;
    let stableFrames = 0;
    const start = performance.now();

    /** 返回 true 表示位置已稳定，循环可以停了 */
    const measure = () => {
      const anchor = nav.querySelector<HTMLElement>(
        'a[aria-current="location"]',
      );
      if (!anchor) {
        indicator.style.opacity = "0";
        return true;
      }
      const navRect = nav.getBoundingClientRect();
      const rect = anchor.getBoundingClientRect();
      const height = Math.min(rect.height, PILL_HEIGHT);
      // 指示条绝对定位在 nav 的内容坐标系里，要补上滚动量，
      // 这样侧栏自身滚动时它跟着内容走
      const top =
        rect.top - navRect.top + nav.scrollTop + (rect.height - height) / 2;

      const prev = indicatorPosRef.current;
      if (top !== prev.top || height !== prev.height) {
        const delta = Number.isNaN(prev.top) ? 0 : top - prev.top;
        const stretch =
          Math.abs(delta) >= JELLY_MIN_DELTA
            ? Math.min(Math.abs(delta) * 0.35, 10)
            : 0;
        indicator.style.opacity = "1";
        indicator.style.top = `${top}px`;
        indicator.style.height = `${height + stretch}px`;
        indicatorPosRef.current = { top, height };
        stableFrames = 0;
        return false;
      }
      // 目标不再动了，把上一帧垫高的部分收回到标准高度
      if (stableFrames === 0 && indicator.style.height !== `${height}px`) {
        indicator.style.height = `${height}px`;
      }
      stableFrames += 1;
      return stableFrames >= 4;
    };

    const tick = () => {
      if (performance.now() - start > SETTLE_MS || measure()) return;
      raf = requestAnimationFrame(tick);
    };

    // 首帧先摆到位、再开过渡：不从 (0,0) 滑过来，也不跟首帧抢动画
    raf = requestAnimationFrame(() => {
      measure();
      indicator.setAttribute("data-ready", "");
      raf = requestAnimationFrame(tick);
    });

    // 窗口宽度变化会让文字重新折行，所有位置失效，重测一轮
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
  }, [activeId, manualId, closingId]);

  /**
   * 点击目录项：拦截原生锚点跳转，改用缓动滚动。
   *
   * 原生跳转是瞬间到位的长距离传送，眼睛跟不上；缓动滚动能让读者
   * 看清自己从哪跳到哪。用 replaceState 更新地址栏：
   * 既让地址栏保持可分享，又不让后退键多按一次。
   */
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    // 保留 Cmd/Ctrl+点击等原生行为（新标签页打开）
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;

    e.preventDefault();
    scrollToAnchor(id);
    window.history.replaceState(null, "", `#${encodeURIComponent(id)}`);
  };

  /**
   * 展开状态：当前章节强制展开，待收起的旧章节暂时保持展开，
   * 其余看手动项。
   */
  const isOpen = (node: TocNode) =>
    node.id === activeGroupId ||
    node.id === manualId ||
    node.id === closingId;

  /** 当前章节的按钮置灰不可点：收起它也只会被强制展开，徒增困惑 */
  const isLocked = (node: TocNode) => node.id === activeGroupId;

  const toggle = (id: string) => {
    // 用户主动操作这个分组时，取消它的待收起状态，
    // 否则定时器到点会把它收掉，和用户的意图相反
    if (closingId === id) setClosingId(null);
    setManualId((prev) => (prev === id ? null : id));
  };

  return (
    <nav
      ref={navRef}
      aria-label="本文目录"
      /*
        overflow-x-hidden 不能省：overflow-y 设成 auto 后，
        按 CSS 规范 overflow-x 会从 visible 被计算成 auto，
        于是任何一点点横向溢出（长英文单词、代码标识符）都会在底部
        冒出一条横向滚动条。显式关掉它。

        scrollbar-gutter:stable 也不能省：展开分组后内容变长才出现滚动条，
        滚动条会占掉约 10px 内容宽度，文字区跟着变窄——展开收起时
        整块文字左右跳动。stable 让这段空间始终预留，文字宽度不再变。
      */
      className="panel sticky top-20 max-h-[calc(100vh-7rem)] overflow-y-auto overflow-x-hidden rounded-[var(--radius-panel)] p-3 [scrollbar-gutter:stable]"
    >
      <p className="mb-3 pl-4 text-xs font-medium tracking-wide text-muted">
        本文目录
      </p>

      {/* 当前项的指示条：整棵目录只有这一条，高亮换人时从旧位置滑过去
          （WinUI3 导航栏的做法），不再是各自长出来又缩回去。 */}
      <span ref={indicatorRef} aria-hidden className="toc-indicator" />

      <ul className="space-y-0.5">
        {tree.map((node) => {
          const open = isOpen(node);
          const locked = isLocked(node);
          const hasChildren = node.children.length > 0;
          const active = activeId === node.id;

          return (
            <li key={node.id || node.text}>
              <div className="group flex items-start">
                <a
                  href={`#${node.id}`}
                  onClick={(e) => handleClick(e, node.id)}
                  aria-current={active ? "location" : undefined}
                  className={`toc-link relative min-w-0 flex-1 rounded py-1.5 pl-4 pr-1 text-[13px] leading-snug break-words ${
                    active
                      ? "font-medium text-accent"
                      : "text-secondary hover:text-foreground"
                  }`}
                >
                  {/* 悬停时的灰色小短条。当前项的蓝色指示条全目录只有一条
                      （见上面的 .toc-indicator），由滑动动画在条目间移动；
                      当前项自己不渲染灰条——悬停时蓝条正压在这个位置，
                      再叠一条灰的会把蓝条拦腰盖住。 */}
                  {!active && (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1/2 h-0 w-[2px] -translate-y-1/2 rounded-full bg-transparent transition-all duration-200 group-hover:h-2 group-hover:bg-border"
                    />
                  )}
                  {node.text}
                </a>

                {hasChildren && (
                  <button
                    type="button"
                    /*
                      当前章节的按钮置灰且不可点：它的展开是自动的，
                      点了收起也会被立刻强制展开，让人以为按钮坏了。
                      用 aria-disabled 而不是 disabled —— disabled 会让
                      按钮失去焦点，键盘用户会以为这里没有控件。
                    */
                    onClick={locked ? undefined : () => toggle(node.id)}
                    aria-expanded={open}
                    aria-disabled={locked || undefined}
                    aria-label={
                      locked
                        ? `${node.text}的子章节（当前章节，自动展开）`
                        : `${open ? "收起" : "展开"}${node.text}的子章节`
                    }
                    title={locked ? "当前所在章节，自动展开" : undefined}
                    className={`-ml-px flex shrink-0 items-center self-stretch border-l border-transparent py-1.5 pl-1.5 transition-opacity ${
                      locked
                        ? "cursor-default text-muted opacity-45"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 12 12"
                      fill="none"
                      aria-hidden
                      className={`transition-transform duration-200 ${open ? "rotate-90" : ""}`}
                    >
                      <path
                        d="M4.5 2.5L8 6l-3.5 3.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                )}
              </div>

              {/*
                子项列表始终挂载，用 grid-template-rows 的 0fr→1fr 过渡高度。
                如果用 {open && ...} 直接卸载 DOM，就没有高度动画可言。
              */}
              <div
                className={`toc-sublist grid transition-[grid-template-rows,opacity] duration-250 ease-out ${
                  open && hasChildren ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <ul className="overflow-hidden space-y-0.5">
                  {node.children.map((child) => (
                    <li
                      key={child.id}
                      className={`group relative transition-[opacity,transform] duration-200 ease-out ${
                        open && hasChildren
                          ? "translate-x-0 opacity-100"
                          : "-translate-x-1 opacity-0"
                      }`}
                      // 错峰入场：每个子项依次延迟 25ms，整组最多约 200ms 就展开完，
                      // 既有依次浮现的层次感，又不会拖沓
                      style={
                        open && hasChildren
                          ? {
                              transitionDelay: `${
                                60 + node.children.indexOf(child) * 25
                              }ms`,
                            }
                          : undefined
                      }
                    >
                      <a
                        href={`#${child.id}`}
                        onClick={(e) => handleClick(e, child.id)}
                        aria-current={
                          activeId === child.id ? "location" : undefined
                        }
                        className={`toc-link relative block rounded py-1.5 pl-7 pr-1 text-[13px] leading-snug break-words ${
                          activeId === child.id
                            ? "font-medium text-accent"
                            : "text-secondary hover:text-foreground"
                        }`}
                      >
                        {/* 子项的悬停灰条与父级对齐在同一条基线上（left-0），
                            靠 pl-7 的更大缩进体现层级；当前项不渲染，
                            避免灰条盖住蓝指示条 */}
                        {activeId !== child.id && (
                          <span
                            aria-hidden
                            className="absolute left-0 top-1/2 h-0 w-[2px] -translate-y-1/2 rounded-full bg-transparent transition-all duration-200 group-hover:h-2 group-hover:bg-border"
                          />
                        )}
                        {child.text}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * 移动端折叠版：整体收进一个按钮里，展开后同样是「二级标题 + 可展开子项」。
 *
 * 只有整体展开后才启用滚动高亮，收起时不浪费观察器。
 */
function Collapsible({ items }: { items: TocItem[] }) {
  const [open, setOpen] = useState(false);
  const activeId = useActiveHeading(open ? items : []);
  const tree = useMemo(() => buildTree(items), [items]);

  // 与桌面端同一套规则：当前章节强制展开，手动项只记一个，
  // 切换章节时清空（上一章自动收起）
  const [manualId, setManualId] = useState<string | null>(null);

  const activeNode = tree.find(
    (n) => n.id === activeId || n.children.some((c) => c.id === activeId),
  );
  const activeGroupId = activeNode?.id ?? null;

  // 与桌面端同一套规则：章节变了就清掉手动展开项；
  // 只有点击跳转引起的变化才延迟收起，正常滚动即时收起
  const [closingId, setClosingId] = useState<string | null>(null);
  const [prevActiveGroup, setPrevActiveGroup] = useState<string | null>(null);
  if (activeGroupId !== prevActiveGroup) {
    const previous = prevActiveGroup;
    setPrevActiveGroup(activeGroupId);
    setManualId(null);

    const fromJump = getScrollLock() !== null;

    if (
      fromJump &&
      previous !== null &&
      previous !== activeGroupId &&
      previous !== manualId
    ) {
      setClosingId(previous);
    } else if (!fromJump) {
      setClosingId(null);
    }
  }

  useEffect(() => {
    if (closingId === null) return;
    const timer = setTimeout(() => setClosingId(null), COLLAPSE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [closingId]);

  const toggleGroup = (id: string) => {
    if (closingId === id) setClosingId(null);
    setManualId((prev) => (prev === id ? null : id));
  };

  return (
    /* 标题行和展开内容装在同一个面板里，整块只有一圈圆角。
       原来是两个面板（标题一个 .panel、列表一个 .panel-raised .rounded-lg）
       上下紧贴，展开时接缝两侧会各露出一个内凹的弧度，
       看起来像两块圆角硬拼在一起，而不是一个可折叠的面板。 */
    <div className="panel">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm"
      >
        <span className="font-medium">本文目录</span>
        <span className="flex items-center gap-2 text-xs text-muted">
          {tree.length} 节
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden
            className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          >
            <path
              d="M2.5 4.5L6 8l3.5-3.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {/* 同样用 grid-rows 0fr→1fr 做高度过渡，保持挂载才有动画 */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-250 ease-out ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <ul className="overflow-hidden">
          {/* 分隔线不用跟着 open 切换：收起时整个区域 opacity-0，
              而且高度被裁成 0，画不出来 */}
          <li className="border-t border-panel-edge p-3">
            <ul className="space-y-0.5">
              {tree.map((node) => {
            const hasChildren = node.children.length > 0;
            const locked = node.id === activeGroupId;
            const groupOpen =
              node.id === activeGroupId ||
              node.id === manualId ||
              node.id === closingId;

            return (
              <li key={node.id || node.text}>
                <div className="flex items-start">
                  <a
                    href={`#${node.id}`}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                      e.preventDefault();
                      scrollToAnchor(node.id);
                      setOpen(false);
                      window.history.replaceState(
                        null,
                        "",
                        `#${encodeURIComponent(node.id)}`,
                      );
                    }}
                    className={`flex-1 py-1.5 text-sm transition-colors ${
                      activeId === node.id
                        ? "font-medium text-accent"
                        : "text-secondary hover:text-foreground"
                    }`}
                  >
                    {node.text}
                  </a>

                  {hasChildren && (
                    <button
                      type="button"
                      onClick={locked ? undefined : () => toggleGroup(node.id)}
                      aria-expanded={groupOpen}
                      aria-disabled={locked || undefined}
                      aria-label={
                        locked
                          ? `${node.text}的子章节（当前章节，自动展开）`
                          : `${groupOpen ? "收起" : "展开"}${node.text}的子章节`
                      }
                      title={locked ? "当前所在章节，自动展开" : undefined}
                      className={`flex shrink-0 items-center self-stretch py-1.5 pl-2 transition-opacity ${
                        locked
                          ? "cursor-default text-muted opacity-45"
                          : "text-muted hover:text-foreground"
                      }`}
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 12 12"
                        fill="none"
                        aria-hidden
                        className={`transition-transform duration-200 ${groupOpen ? "rotate-90" : ""}`}
                      >
                        <path
                          d="M4.5 2.5L8 6l-3.5 3.5"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  )}
                </div>

                {hasChildren && groupOpen && (
                  <ul className="space-y-0.5">
                    {node.children.map((child) => (
                      <li key={child.id}>
                        <a
                          href={`#${child.id}`}
                          onClick={(e) => {
                            if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                            e.preventDefault();
                            scrollToAnchor(child.id);
                            setOpen(false);
                            window.history.replaceState(
                              null,
                              "",
                              `#${encodeURIComponent(child.id)}`,
                            );
                          }}
                          className={`block py-1.5 pl-5 text-sm transition-colors ${
                            activeId === child.id
                              ? "font-medium text-accent"
                              : "text-secondary hover:text-foreground"
                          }`}
                        >
                          {child.text}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
            </ul>
          </li>
        </ul>
      </div>
    </div>
  );
}