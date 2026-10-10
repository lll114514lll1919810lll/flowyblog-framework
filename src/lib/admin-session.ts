"use client";

import { useSyncExternalStore } from "react";

/**
 * 管理员登录态的浏览器端视图。
 *
 * 为什么需要它：底栏要按「当前是不是管理员」决定显不显示后台入口，而本站是
 * 静态导出的——构建期不可能知道谁在登录。登录态只存在于访客浏览器里的
 * HttpOnly Cookie 中，前端读不到（这正是它设成 HttpOnly 的意义），所以只能
 * 到浏览器里问一次后端。GET /api/admin/session 只回答「这个 Cookie 有效吗」，
 * 不查库、不返回任何数据，是这一步最便宜的接口。
 *
 * 这里做一层模块级缓存，而不是每个组件各查一次：
 *   - 底栏在每次整页加载时只挂载一次，正常只需要探测一回；
 *   - 登录、退出之后要用同一份状态把界面同步过去，缓存得有个明确的落点。
 *
 * 三种状态：
 *   unknown  还没问过。服务端渲染时也固定返回它，保证水合前后输出一致
 *   admin    已登录
 *   guest    未登录，或者根本问不到（本地 pnpm dev 没有 Functions、纯静态
 *            托管、网络失败都归到这一类）
 *
 * 探测失败按 guest 处理，这是有意的：入口只是便利，多给访客显示一个「后台」
 * 只会让他点进一个空壳；少显示则最多是管理员少一个快捷方式，刷新一次就回来。
 */

export type AdminSession = "unknown" | "admin" | "guest";

let state: AdminSession = "unknown";

/** 正在飞的那次探测。并发调用共用它，不重复发请求 */
let inflight: Promise<void> | null = null;

const listeners = new Set<() => void>();

function setState(next: AdminSession) {
  if (state === next) return;
  state = next;
  // 快照是字符串，订阅者用 Object.is 比较，不会因为「新对象」而误判成变化
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 重新探测登录态。已有请求在飞时直接复用那一次。
 *
 * 缓存的是「结果」不是「请求」：探测完成后会重新发起，所以登录、退出这类
 * 状态可能已经变了的时刻调用它，拿到的必然是新的结果。
 */
export function refreshAdminSession(): Promise<void> {
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch("/api/admin/session", {
        headers: { accept: "application/json" },
        // 后端已经带了 no-store；这里再声明一次，免得任何中间层把结果缓存住，
        // 那会导致退出登录后底栏的入口还赖着不走
        cache: "no-store",
      });
      if (!res.ok) {
        setState("guest");
        return;
      }
      const body = await res.json().catch(() => null);
      setState(body?.authenticated === true ? "admin" : "guest");
    } catch {
      // 请求根本发不出去（离线、没有 Functions），按访客处理
      setState("guest");
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * 登录、退出之后调用。
 *
 * 这两个动作走的都是客户端路由，底栏在根布局里不会重新挂载，挂载时的 effect
 * 也不会再跑。不主动通知的话，入口会一直停在登录前的状态，直到用户手动刷新
 * 整页——而「刚登录完想找个入口进后台」恰好是最需要它出现的时刻。
 */
export function notifyAdminSessionChanged(): void {
  void refreshAdminSession();
}

/** 当前是不是管理员。服务端快照固定为 false（水合前一律按访客渲染） */
export function useIsAdmin(): boolean {
  const value = useSyncExternalStore(
    subscribe,
    () => state,
    () => "unknown" as const,
  );
  return value === "admin";
}
