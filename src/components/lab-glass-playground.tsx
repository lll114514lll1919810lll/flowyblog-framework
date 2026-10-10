"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import {
  GLASS_PARAM_KEYS,
  GLASS_PARAM_RANGES,
  currentGlassTheme,
  getGlassParams,
  glassParamsJson,
  glassParamsSnapshot,
  resetGlassParams,
  setGlassParams,
  subscribeGlassParams,
  type GlassParams,
} from "@/lib/liquid-glass-params";
import { useTheme } from "@/lib/use-theme";
import { useLabs } from "@/lib/use-labs";

/**
 * 液态玻璃的调参面板。
 *
 * 只在「液态玻璃」这个实验打开时出现——关着的时候列一堆滑杆没有意义。
 *
 * 参数是**按主题分开存**的（浅色的背景更亮，得单独压一点），所以面板编辑的是
 * 「当前主题」那一套：切到深色/浅色，滑杆显示的就是那一套的值。这也正好是
 * 调参的自然方式——想看深色下的效果就切深色，直接调。
 *
 * 值走 lib/liquid-glass-params.ts 那个小 store：面板改、渲染器订阅、即时重建。
 * 调好之后点「复制参数」，把两套值一起复制回代码里固化。
 */
export function LabGlassPlayground() {
  const { valueOf } = useLabs();
  const { theme } = useTheme();
  const snapshot = useSyncExternalStore(
    subscribeGlassParams,
    glassParamsSnapshot,
    glassParamsSnapshot,
  );
  const [copied, setCopied] = useState(false);

  // 快照是全量的 JSON；这里取出当前主题那一套
  const params = useMemo((): GlassParams => {
    void snapshot;
    return currentGlassTheme() === "dark" ? getGlassParams("dark") : getGlassParams("light");
  }, [snapshot]);

  // 实验没开就不渲染
  if (valueOf("liquidglass") !== "on") return null;

  const update = (key: keyof GlassParams, value: number | boolean) => {
    setGlassParams(theme, { [key]: value } as Partial<GlassParams>);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(glassParamsJson());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用（非安全上下文）时把 JSON 挂在 title 上，至少能手动选
      setCopied(false);
    }
  };

  return (
    /* 挂在「液态玻璃」那一行里面（见 lab-panel.tsx 的 extra），
       所以用内嵌小面板的样式，不再自带一层大面板 */
    <section className="lab-subpanel flex flex-col gap-4 px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">参数</h3>
          <p className="text-xs leading-relaxed text-secondary">
            正在调<strong>{theme === "dark" ? "深色" : "浅色"}</strong>主题这一套；
            切主题就换一套值。拖动即时生效，存在本机。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => resetGlassParams(theme)}
            className="rounded-full border border-[var(--panel-border)] px-3 py-1.5 text-xs text-secondary transition-colors hover:text-foreground"
          >
            恢复默认
          </button>
          <button
            type="button"
            onClick={copy}
            title={glassParamsJson()}
            className="rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            {copied ? "已复制" : "复制两套参数"}
          </button>
        </div>
      </div>

      <div className="lab-list">
        {GLASS_PARAM_KEYS.map((key) => {
          const range = GLASS_PARAM_RANGES[key];
          return (
            <div className="lab-row flex flex-col gap-2" key={key}>
              <div className="flex items-baseline justify-between gap-4">
                <label className="text-sm" htmlFor={`glass-${key}`}>
                  {range.label}
                  {range.hint ? (
                    <span className="ml-2 text-xs text-secondary">{range.hint}</span>
                  ) : null}
                </label>
                <span className="font-mono text-xs tabular-nums text-secondary">
                  {params[key]}
                </span>
              </div>
              <input
                id={`glass-${key}`}
                type="range"
                className="lab-range"
                min={range.min}
                max={range.max}
                step={range.step}
                value={params[key] as number}
                onChange={(event) => update(key, Number(event.target.value))}
              />
            </div>
          );
        })}

        {/* 两个开关项单独排：滑杆的语义套不上 */}
        <div className="lab-row flex flex-col gap-3">
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>
              景深效果
              <span className="ml-2 text-xs text-secondary">倒角内外再叠一层位移</span>
            </span>
            <input
              type="checkbox"
              className="lab-check"
              checked={params.depthEffect}
              onChange={(event) => update("depthEffect", event.target.checked)}
            />
          </label>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>
              色差
              <span className="ml-2 text-xs text-secondary">边缘把 RGB 分开折射</span>
            </span>
            <input
              type="checkbox"
              className="lab-check"
              checked={params.chromaticAberration}
              onChange={(event) => update("chromaticAberration", event.target.checked)}
            />
          </label>
        </div>
      </div>
    </section>
  );
}
