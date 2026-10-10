"use client";

import type { JSX } from "react";
import { LiquidGlassPanels } from "@/components/lab-liquidglass";
import { LABS, type LabRuntimeId } from "@/lib/labs";
import { useLabs } from "@/lib/use-labs";

/**
 * 需要客户端代码的实验，在这里挂载。
 *
 * 纯 CSS 的实验开关一写就生效，不需要这个组件；但 WebGL 这类效果，
 * 状态（data-lab-*）只是「用户想开」，真正兑现它得跑一段代码。
 * 这个组件负责把两者对上：开关打开就挂载对应运行时，关掉就卸载。
 *
 * 它挂在 layout 里而不是 /lab 页面上：实验是全局的，
 * 只在实验室页面生效的话，用户打开开关、回到首页却发现没效果。
 *
 * 加一个运行时实验 = LABS 里那一项写 runtime + 这里注册一个组件。
 */
const RUNTIMES: Record<LabRuntimeId, () => JSX.Element> = {
  liquidglass: LiquidGlassPanels,
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
