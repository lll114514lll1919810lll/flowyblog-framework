"use client";

import { useLinkStatus } from "next/link";

/**
 * 点击链接后的即时反馈。
 *
 * 导航在本地几乎瞬间完成，但在真实网络（尤其首次访问未缓存的路由）下
 * 可能有一两百毫秒的空窗，这段时间里用户点完没有任何反馈，容易以为没点上。
 * 这里在等待期间把内容压暗，给一个即时的「收到了」信号。
 *
 * 两种用法：
 * 1. 包住文字：<Link><LinkPending>标题</LinkPending></Link>
 * 2. 不传 children，作为铺满层：热区链接本身是空的 <a>，
 *    没有文字可压暗，此时它会撑满父元素（热区链接是 absolute inset-0）。
 *
 * 注意 useLinkStatus 必须在 <Link> 的后代组件里调用，
 * 不能直接在 <Link> 上用——所以拆成这个子组件由各处按需引入。
 */
export function LinkPending({ children }: { children?: React.ReactNode }) {
  const { pending } = useLinkStatus();

  return (
    <span
      data-pending={pending || undefined}
      className="transition-opacity duration-150 empty:absolute empty:inset-0 empty:block"
    >
      {children}
    </span>
  );
}