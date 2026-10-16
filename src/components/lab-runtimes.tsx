"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import { LABS, type LabRuntimeId } from "@/lib/labs";
import { useLabs } from "@/lib/use-labs";

/**
 * 需要客户端代码的实验，在这里挂载。
 *
 * 纯 CSS 的实验开关一写就生效，不需要这个组件；但 WebGL 这类效果，
 * 状态（data-lab-*）只是「用户想开」，真正兑现它得跑一段代码。
 * 这个组件负责把两者对上：开关打开就挂载对应运行时，关掉就卸载。
 *
 * 它挂在 layout 里而不是 /settings 页面上：实验是全局的，
 * 只在设置页面生效的话，用户打开开关、回到首页却发现没效果。
 *
 * 加一个运行时实验 = LABS 里那一项写 runtime + 这里注册一个组件。
 */
const RUNTIMES: Record<LabRuntimeId, ComponentType> = {
  /*
   * 必须用 next/dynamic 做动态导入，不能静态 import：
   * 渲染器（src/components/liquid-glass/）是 16k 行上下的 WebGL /
   * shader 代码，静态导入会被并进主 bundle——实测 287 KB（gzip 78.6 KB），
   * 占首页初始 JS 的三成，而且 layout 全局引用它，每个页面、每个访客
   * 都要下载。这个实验默认是关的，绝大多数人从不打开——
   * 动态导入后，只有开关打开时才请求并执行这个独立 chunk。
   *
   * ssr:false：组件没有服务端形态（静态导出下本来也不渲染它），
   * 加载期间什么都不显示就是正确行为——实验生效本来就晚几个瞬时，
   * 页面在加载完成前保持默认外观，符合「运行时失败就什么都没发生」的约定。
   */
  liquidglass: dynamic(
    () => import("@/components/lab-liquidglass").then((m) => m.LiquidGlassPanels),
    { ssr: false },
  ),
};

export function LabRuntimes() {
  const { valueOf } = useLabs();

  return (
    <>
      {LABS.map((lab) => {
        const runtime = lab.runtime;
        if (!runtime || !valueOf(lab.id)) return null;
        const Runtime = RUNTIMES[runtime];
        return <Runtime key={lab.id} />;
      })}
    </>
  );
}
