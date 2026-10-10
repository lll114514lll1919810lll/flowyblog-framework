/**
 * 平滑滚动到锚点。
 *
 * 不用浏览器原生的锚点跳转：它是瞬间到位的长距离「传送」，
 * 读者会丢失位置感。缓动滚动能让眼睛跟得上。
 *
 * 两条额外处理：
 * 1. 目标标题不能被吸顶导航挡住。把目标位置对齐到视口 1/3 处，
 *    自然就避开了顶栏，也和目录高亮的判定标准保持一致。
 * 2. 尊重系统的「减少动态效果」：开启时直接跳，不做缓动。
 */

/** 三次缓出：起步快、收尾稳，长距离也不拖沓。 */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* ------------------------------------------------------------ 滚动锁 --- */

/**
 * 程序化缓动滚动期间的「目标锚点」。
 *
 * 为什么需要它：缓动滚动会让页面依次经过起点到终点之间的每一个章节，
 * 如果高亮照常跟随，侧栏的高亮就会从上到下一项项刷过去，
 * 中间的自动展开也跟着触发一遍——动静极大，正是用户反馈的问题。
 *
 * 锁住之后高亮直接跳到目标项，中间章节不再参与。
 */
let lockedId: string | null = null;
/**
 * 是否暂停高亮跟随。
 *
 * 和 lockedId 分开：跳转到某个锚点时两者都有值；「回到顶部」没有对应的
 * 锚点可锁，只是把高亮冻结在原地，所以需要一个独立的开关。
 */
let suppressed = false;
const lockListeners = new Set<() => void>();

function notifyLock() {
  for (const listener of lockListeners) listener();
}

/** 供 useSyncExternalStore 订阅 */
export function subscribeScrollLock(callback: () => void) {
  lockListeners.add(callback);
  return () => lockListeners.delete(callback);
}

/** 高亮应当停留的锚点；为 null 表示冻结在当前位置 */
export function getScrollLock(): string | null {
  return lockedId;
}

/** 服务端渲染时没有滚动状态 */
export function getScrollLockServer(): string | null {
  return null;
}

/** 高亮是否应暂停跟随 */
export function isScrollLocked(): boolean {
  return suppressed;
}

function lockTo(id: string | null) {
  lockedId = id;
  suppressed = true;
  notifyLock();
  armUserScrollUnlock();
}

function unlock() {
  lockedId = null;
  suppressed = false;
  notifyLock();
}

/** 是否正在执行程序化滚动（此时忽略 scroll 事件） */
let programmatic = false;

/** 当前缓动动画的代次与 rAF 句柄：新滚动开始时自增并取消旧帧 */
let scrollGeneration = 0;
let scrollRaf = 0;

/**
 * 用户在锁定期间自己滚动了，就解锁，让高亮恢复跟随。
 *
 * 用 scroll 事件而不是 wheel/touch：拖滚动条、按空格、点滚动条轨道
 * 都不会触发 wheel，但都会触发 scroll。程序化滚动期间用 programmatic
 * 标志忽略掉自己产生的事件。
 */
let userScrollArmed = false;
function armUserScrollUnlock() {
  if (userScrollArmed) return;
  userScrollArmed = true;
  window.addEventListener(
    "scroll",
    () => {
      if (!programmatic && suppressed) unlock();
    },
    { passive: true },
  );
}

/**
 * 缓动滚动到指定位置，期间暂停高亮跟随。
 *
 * @param targetTop 目标 scrollY
 * @param lockId    高亮应停留的锚点；null 表示冻结在当前位置
 */
function easeScrollTo(targetTop: number, lockId: string | null): void {
  const start = window.scrollY;
  const distance = targetTop - start;

  // 已经到位或距离极短时直接跳，省掉一次动画。
  // 减少动态效果时同样直接跳，不做缓动。
  if (prefersReducedMotion() || Math.abs(distance) < 8) {
    window.scrollTo(0, targetTop);
    lockTo(lockId);
    return;
  }

  // 立刻锁定：高亮一步到位，不经过中间章节
  lockTo(lockId);

  const duration = Math.min(760, Math.max(320, Math.abs(distance) * 0.45));

  let startTime: number | null = null;

  /*
   * 先打断上一次还在飞的缓动。
   *
   * 不打断的话两个动画循环会同时写 scrollY：这一帧谁后注册谁赢，
   * 看起来像新的接管了旧的——但时长按距离算，第二次点击如果更近，
   * 新动画先跑完收工，旧循环还没结束，就会继续把页面往旧目标拉，
   * 表现为「往第一次点击的小节回弹一小段」。
   * 代次号让旧动画帧一睁眼就知道自己已被接替，直接退出。
   */
  cancelAnimationFrame(scrollRaf);
  const generation = ++scrollGeneration;

  const step = (timestamp: number) => {
    if (generation !== scrollGeneration) return;

    if (startTime === null) startTime = timestamp;
    const elapsed = timestamp - startTime;
    const progress = Math.min(1, elapsed / duration);

    window.scrollTo(0, start + distance * easeOutCubic(progress));

    if (progress < 1) {
      scrollRaf = requestAnimationFrame(step);
    } else {
      /*
       * 动画结束后**不**解锁。
       *
       * 解锁会让高亮立刻交还给正常跟踪逻辑，而正常逻辑按「阅读线」
       * 判定：跳到最后那一节时（页面滚不动了）它会选中上面一节，
       * 于是刚跳过去的高亮又回落一次，看起来像闪动。
       * 保持锁定，等用户真正滚动再解锁。
       */
      programmatic = false;
    }
  };

  programmatic = true;
  scrollRaf = requestAnimationFrame(step);
}

export function scrollToAnchor(anchorId: string): void {
  const target = document.getElementById(anchorId);
  if (!target) return;

  // 阅读线放在视口 1/3 处，和目录高亮的判定保持一致：
  // 滚过去后标题正好落在视线中心，不会让人觉得"滚过头了"
  const readingLine = window.innerHeight / 3;
  const targetTop =
    window.scrollY + target.getBoundingClientRect().top - readingLine;

  easeScrollTo(targetTop, anchorId);
}

/**
 * 回到页面顶部。
 *
 * 高亮锁到「第一个小节标题」：滚到顶时读者看到的就是第一节，
 * 这样动画结束时高亮正好落在该在的位置，不会先冻结再突然跳一下。
 */
export function scrollToTop(): void {
  const firstHeading = document.querySelector<HTMLElement>(
    ".prose h2[id], .prose h3[id]",
  );
  easeScrollTo(0, firstHeading?.id ?? null);
}

/**
 * 把某个元素滚动到可视区域内。
 *
 * 用于目录侧栏自身：点击父级标题展开子项后，如果侧栏里的条目
 * 在可视区外，读者会看不到自己刚展开了什么。
 */
export function scrollIntoViewIfNeeded(
  element: HTMLElement,
  container: HTMLElement,
): void {
  const itemRect = element.getBoundingClientRect();
  const boxRect = container.getBoundingClientRect();

  // 已经在可视范围内就不动，避免不必要的跳动
  if (
    itemRect.top >= boxRect.top &&
    itemRect.bottom <= boxRect.bottom
  ) {
    return;
  }

  const offset =
    itemRect.top - boxRect.top - (boxRect.height - itemRect.height) / 2;
  container.scrollTop += offset;
}