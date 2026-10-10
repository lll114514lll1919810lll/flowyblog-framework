"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  LABS,
  LAB_STORAGE_KEY,
  applyLabs,
  parseStored,
  readFromDom,
  reapplyLabs,
  serializeState,
  stateKey,
  type LabId,
  type LabState,
} from "@/lib/labs";

/**
 * 实验室的运行时：读、写、切、订阅。
 * 常量、存储格式、合法性校验和内联脚本在 lib/labs.ts（那边不依赖 React）。
 *
 * 和 use-theme.ts 同样是「DOM 是唯一真相」：
 * React 状态只是把 <html data-lab-*> 读出来给控件显示用，
 * 样式永远由 CSS 按属性决定。这样首帧、刷新、跨标签页三处不会打架，
 * 存储读不出来（隐私模式）时也照样能在本次会话里用。
 */

/** 把状态写回存储。存不进去也不影响本次会话生效 */
function writeStored(state: LabState) {
  try {
    const raw = serializeState(state);
    // 全默认时删键而不是存 {}：下次读到的就是「没有偏好」，
    // 和从没打开过实验室的浏览器落进同一条分支
    if (raw) localStorage.setItem(LAB_STORAGE_KEY, raw);
    else localStorage.removeItem(LAB_STORAGE_KEY);
  } catch {
    // 忽略
  }
}

function readStored(): LabState {
  try {
    return parseStored(localStorage.getItem(LAB_STORAGE_KEY));
  } catch {
    return {};
  }
}

// localStorage 不是响应式的，用一张订阅表把变化推给 hook
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribeLabs(callback: () => void) {
  listeners.add(callback);

  // 另一个标签页改了开关，这个标签页也跟着变
  const onStorage = (event: StorageEvent) => {
    if (event.key !== LAB_STORAGE_KEY) return;
    applyLabs(readStored());
    emit();
  };

  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * 当前状态，从 DOM 上读。
 *
 * 返回字符串而不是对象：useSyncExternalStore 用 Object.is 比较快照，
 * 每次返回新对象会让它认为「变了」，进而无限重渲染。
 */
function getSnapshot(): string {
  return stateKey(readFromDom());
}

/**
 * 服务端没有 DOM，只能给一个固定值。
 *
 * 这里用空串（全默认）而不是「猜」用户选了什么：服务端渲染出来的控件
 * 必须是默认态，浏览器里水合后立刻按真实值重渲染。反过来的话，
 * 静态导出会把某一次构建机的偏好烧进 HTML，发给所有访客。
 */
function getServerSnapshot(): string {
  return "";
}

/**
 * 设置某个实验的值。空串 = 回到默认档（属性摘掉）。
 *
 * 互斥在这里统一处理：打开组内某个成员时，同组其它成员一律关掉。
 * 放在这儿而不是每个调用点，是为了让「加一个组员就自动获得互斥行为」，
 * 页面那边不需要知道谁是互斥的。
 */
export function setLab(id: LabId, value: string) {
  const next: LabState = { ...readFromDom() };
  const lab = LABS.find((item) => item.id === id);
  if (!lab) return;

  if (value) next[id] = value;
  else delete next[id];

  if (lab.group && value) {
    for (const other of LABS) {
      if (other.id !== id && other.group === lab.group) delete next[other.id];
    }
  }

  writeStored(next);
  applyLabs(next);
  emit();
}

/** 开关型实验的开/关。档位型请直接用 setLab */
export function toggleLab(id: LabId) {
  setLab(id, readFromDom()[id] ? "" : "on");
}

/** 全部回默认。实验室页给一个「一键恢复」，省得用户一个个点回去 */
export function clearLabs() {
  writeStored({});
  applyLabs({});
  emit();
}

/**
 * 按「当前偏好」重新应用一次。
 *
 * 给开发模式用，理由同 use-theme.ts 的 reapplyTheme：
 * React Strict Mode 重挂载会清掉 <html> 上只有脚本写过的属性。
 * 生产环境调用等于空转。
 */
export function useLabReapply() {
  // 只有存储里真的有东西才补一次，避免把「另一个脚本先写好的属性」覆盖掉
  return useCallback(() => {
    if (serializeState(readStored()) !== null) reapplyLabs();
  }, []);
}

export function useLabs() {
  const snapshot = useSyncExternalStore(
    subscribeLabs,
    getSnapshot,
    getServerSnapshot,
  );

  // 快照是「id=值」用空格连起来的字符串，这里换算成查表用的 Map。
  // 每个控件只关心自己那一个 id，不需要拿到整个对象。
  const values = new Map(
    snapshot
      .split(" ")
      .filter(Boolean)
      .map((pair) => {
        const at = pair.indexOf("=");
        return [pair.slice(0, at), pair.slice(at + 1)] as const;
      }),
  );

  return {
    /** 某个实验当前的值；空串表示默认档 */
    valueOf: (id: LabId) => values.get(id) ?? "",
    /** 有多少项离开了默认态，用来在页面上给一句总览 */
    activeCount: values.size,
    set: setLab,
    toggle: toggleLab,
    clear: clearLabs,
  };
}
