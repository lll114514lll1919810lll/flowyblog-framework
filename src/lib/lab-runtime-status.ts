"use client";

import { useSyncExternalStore } from "react";
import type { LabRuntimeId } from "@/lib/labs";

/**
 * 需要客户端的实验「跑到哪一步了」。
 *
 * 纯 CSS 的实验没有这个问题：属性写完，样式就在下一帧生效，
 * 页面只需要显示开/关。运行时型的实验不一样——它要下载代码、要初始化
 * WebGL、还可能失败，而开关本身（data-lab-* 属性）在这些过程里一直
 * 显示「已开启」。用户在实验室页面上看到开关是开的、外观却没变，
 * 会以为是坏的，所以需要一个地方说明进度。
 *
 * 这里用模块级的 Map 而不是 React context：状态的产生方
 * （lab-liquidglass.tsx 挂在 layout 里）和消费方（/lab 页面里的行）
 * 在组件树上是两棵互不相干的子树，用 context 得把它们套进同一个 provider，
 * 而它们本来没有共同的业务关系——共享的只是「某个运行时的状态」这件事。
 *
 * 快照是字符串，不是对象：useSyncExternalStore 用 Object.is 比较，
 * 每次返回新对象会让它认为变了，进而无限重渲染。
 */

export type LabRuntimeStatus =
  | "idle"
  | "loading"
  | "ready"
  /** 跑起来了，但降级了：某个浏览器不支持的分支被跳过（见 lab-liquidglass.tsx） */
  | "degraded"
  | "failed";

const statuses = new Map<LabRuntimeId, LabRuntimeStatus>();
const listeners = new Set<() => void>();

export function setLabRuntimeStatus(id: LabRuntimeId, status: LabRuntimeStatus) {
  if (statuses.get(id) === status) return;
  statuses.set(id, status);
  for (const listener of listeners) listener();
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/**
 * 某个运行时的状态。没有运行时（纯 CSS 实验）时永远返回 idle。
 *
 * 服务端快照固定是 idle：服务端没有 WebGL，也不该猜。
 */
export function useLabRuntimeStatus(id: LabRuntimeId | undefined): LabRuntimeStatus {
  return useSyncExternalStore(
    subscribe,
    () => (id ? (statuses.get(id) ?? "idle") : "idle"),
    () => "idle" as const,
  );
}
