"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 文章配图的点击放大预览。
 *
 * 正文是 MDX 编译出来的裸 HTML（`<figure class="post-figure"><img>`），
 * 没法直接在 JSX 里给每张图套事件，所以这里用「挂载后增强 DOM」的做法：
 * 找到正文容器里的所有 img，给它们加上可聚焦、可点击的语义和事件。
 *
 * 为什么用原生 <dialog> + showModal() 而不是自己写 fixed 遮罩：
 * 正文面板用了 backdrop-filter，而 backdrop-filter / filter / transform
 * 会给 position:fixed 的后代创造包含块——自己写的 fixed 遮罩会被关在
 * 面板里，盖不住整屏。原生 dialog 打开后进的是浏览器 top layer，
 * 不受任何包含块影响，顺带白拿 Esc 关闭、焦点陷阱和背景 inert。
 *
 * 其他细节：
 * - 预览图同样不放大：width:auto + max-width，小于屏幕的截图就按原始尺寸显示
 * - 打开时锁背景滚动；因为 html 上有 scrollbar-gutter:stable，锁了也不会跳动
 * - 关闭后把焦点还给刚才点的那张图，键盘用户不会掉到页面顶部
 */
export function ArticleImages() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  /* 按下时是否落在遮罩上：区分「点遮罩关闭」与「选中图注、拖到框外松手」 */
  const pressedBackdrop = useRef(false);
  const [current, setCurrent] = useState<{
    src: string;
    alt: string;
    caption: string;
  } | null>(null);

  const open = useCallback((img: HTMLImageElement) => {
    openerRef.current = img;
    setCurrent({
      src: img.currentSrc || img.src,
      alt: img.alt,
      caption:
        img.closest("figure")?.querySelector("figcaption")?.textContent?.trim() ??
        "",
    });
  }, []);

  /** 关闭收尾：解锁滚动、清空状态、把焦点还给触发的那张图。幂等，重复调用无害 */
  const finishClose = useCallback(() => {
    document.documentElement.style.overflow = "";
    setCurrent(null);
    const opener = openerRef.current;
    openerRef.current = null;
    /* 同步归还焦点，不用 requestAnimationFrame：
       浏览器后台/不出帧时 rAF 不跑，焦点就留在页面顶部了。
       preventScroll 是因为图片本来就在视野里，没必要再滚一下。 */
    opener?.focus({ preventScroll: true });
  }, []);

  /**
   * 关闭预览。
   *
   * 这里除了 dialog.close() 还要当场 finishClose()：close 事件是**异步排队**
   * 触发的（规范如此），不能指望它在下一帧就跑到——实测在不出帧的环境里
   * 它一直不被调度，滚动锁就留在页面上了。显式关闭的路径当场收尾；
   * Esc 走原生路径，靠下面的 cancel / close 监听兜底。
   */
  const close = useCallback(() => {
    dialogRef.current?.close();
    finishClose();
  }, [finishClose]);

  /* 增强正文里的图片：可聚焦、可点击、可回车打开 */
  useEffect(() => {
    const root = document.querySelector("[data-article-prose]");
    if (!root) return () => {};
    const images = [...root.querySelectorAll("img")];

    const cleanups = images.map((node) => {
      const img = node as HTMLImageElement;
      /*
        注意不能在这里「已经增强过就跳过」：开发模式 Strict Mode 会
        挂载→清理→再挂载，第一次的清理已经把监听器摘掉了，
        第二次如果因为 data-zoomable 存在而提前返回，监听器就永远不在了
        （表现为图片能聚焦、有 cursor，但点了没反应——踩过一次）。
        属性是幂等的，重复设置无所谓；监听器每次都老老实实挂。
      */
      img.dataset.zoomable = "on";
      img.tabIndex = 0;
      img.setAttribute("role", "button");
      img.setAttribute("aria-label", `放大查看：${img.alt || "文章配图"}`);

      const onClick = () => open(img);
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        open(img);
      };
      img.addEventListener("click", onClick);
      img.addEventListener("keydown", onKeyDown);
      return () => {
        img.removeEventListener("click", onClick);
        img.removeEventListener("keydown", onKeyDown);
      };
    });

    return () => cleanups.forEach((fn) => fn());
  }, [open]);

  /* 关闭收尾：用原生 close 事件而不是 React 的 onClose。
     Esc 关闭由浏览器触发 close 事件，必须保证这条路径也能解锁滚动、归还焦点；
     实测 React 的 onClose 在这里没被触发，滚动锁就留在了页面上。 */
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    // cancel 在按 Esc 时**同步**触发，close 则要等排队的任务，两条都挂上
    dialog.addEventListener("cancel", finishClose);
    dialog.addEventListener("close", finishClose);
    return () => {
      dialog.removeEventListener("cancel", finishClose);
      dialog.removeEventListener("close", finishClose);
    };
  }, [finishClose]);

  /* 状态变化时打开 dialog，并锁住背景滚动 */
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (current && !dialog.open) {
      dialog.showModal();
      document.documentElement.style.overflow = "hidden";
    }
  }, [current]);

  return (
    <dialog
      ref={dialogRef}
      className="image-lightbox"
      aria-label="图片预览"
      /*
        关闭判定不能用 click：click 发生在 mousedown 和 mouseup 的共同祖先上，
        在弹层里按下、拖到外面松手也会产生一个 target 是 dialog 的 click。
        要求按下和松开都落在遮罩上才关闭。
      */
      onPointerDown={(event) => {
        pressedBackdrop.current = event.target === dialogRef.current;
      }}
      onPointerUp={(event) => {
        if (pressedBackdrop.current && event.target === dialogRef.current) close();
        pressedBackdrop.current = false;
      }}
    >
      {current && (
        <figure className="image-lightbox-figure">
          {/* eslint-disable-next-line @next/next/no-img-element --
              这里就是要原始尺寸的原图：走 next/image 会被按容器重新缩放/编码，
              而放大预览的意义正是看未经处理的那张 */}
          <img src={current.src} alt={current.alt} />
          {current.caption && (
            <figcaption className="image-lightbox-caption">
              {current.caption}
            </figcaption>
          )}
        </figure>
      )}
      <button
        type="button"
        className="image-lightbox-close"
        onClick={close}
        aria-label="关闭预览"
        title="关闭预览（Esc）"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M3.5 3.5l9 9M12.5 3.5l-9 9"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </dialog>
  );
}
