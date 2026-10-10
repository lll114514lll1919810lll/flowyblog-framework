/**
 * 液态玻璃的可调参数。
 *
 * 存在的理由：这些值要在页面上反复试才能定下来，不适合每改一次就改代码、
 * 等热更新。实验室页面里有一组滑杆直接改这里的值，渲染器订阅它、即时重建
 * 玻璃元素。
 *
 * 深浅两套分开存：浅色主题的背景图亮度不同，需要单独压一点（实测浅色要
 * 多压 0.02 的亮度），两套的值除 brightness 外目前一致，但结构上允许分头调。
 *
 * 存 localStorage 是为了刷新之后还在——调参要跨很多次刷新。
 */

export type GlassTheme = "light" | "dark";

export type GlassParams = {
  /** 倒角高度：从边缘往内多深算「侧壁」，越大玻璃越"厚" */
  refractionHeight: number;
  /** 折射强度：负值把背景往内吸（边缘压缩），正值往外推 */
  refractionAmount: number;
  /** 背景模糊半径（px） */
  blurRadius: number;
  /** 背景饱和度 */
  saturation: number;
  /** 亮度偏移，-1 ~ 1 */
  brightness: number;
  /** 对比度，0 ~ 2 */
  contrast: number;
  /** 景深效果：倒角内外再叠一层位移 */
  depthEffect: boolean;
  /** 色差：边缘把 RGB 分开折射 */
  chromaticAberration: boolean;
  /** 高光强度 0 ~ 1 */
  highlightAlpha: number;
  /** 高光带宽（dp） */
  highlightWidth: number;
  /** 高光方向（度） */
  highlightAngle: number;
  /** 外阴影强度 0 ~ 0.5 */
  shadowAlpha: number;
  /** 外阴影扩散半径 */
  shadowRadius: number;
  /** 面板那层薄纱的不透明度（0 ~ 1），对应 globals.css 里的比例 */
  tintAlpha: number;
};

/** 2026-10-09 在实验室页面调出来后固化的默认值 */
export const DEFAULT_GLASS_PARAMS: Record<GlassTheme, GlassParams> = {
  light: {
    refractionHeight: 10,
    refractionAmount: -54,
    blurRadius: 2,
    saturation: 1.7,
    brightness: -0.04,
    contrast: 1,
    depthEffect: false,
    chromaticAberration: false,
    highlightAlpha: 0.5,
    highlightWidth: 0.5,
    highlightAngle: 100,
    shadowAlpha: 0.13,
    shadowRadius: 30,
    tintAlpha: 0.2,
  },
  dark: {
    refractionHeight: 10,
    refractionAmount: -54,
    blurRadius: 2,
    saturation: 1.7,
    brightness: -0.02,
    contrast: 1,
    depthEffect: false,
    chromaticAberration: false,
    highlightAlpha: 0.5,
    highlightWidth: 0.5,
    highlightAngle: 100,
    shadowAlpha: 0.13,
    shadowRadius: 30,
    tintAlpha: 0.2,
  },
};

/**
 * 存储键带版本号。
 *
 * v1 是「一套参数通吃两个主题」的扁平结构，和现在的 { light, dark } 不兼容。
 * 不复用旧键：老值读进来会是一堆 undefined，还不如让它落回默认值。
 */
const STORAGE_KEY = "fbz-glass-params-v2";

/** 每一项的滑杆范围，UI 和校验共用 */
export const GLASS_PARAM_RANGES: Record<
  keyof Pick<
    GlassParams,
    | "refractionHeight"
    | "refractionAmount"
    | "blurRadius"
    | "saturation"
    | "brightness"
    | "contrast"
    | "highlightAlpha"
    | "highlightWidth"
    | "highlightAngle"
    | "shadowAlpha"
    | "shadowRadius"
    | "tintAlpha"
  >,
  { min: number; max: number; step: number; label: string; hint?: string }
> = {
  refractionHeight: {
    min: 0,
    max: 40,
    step: 1,
    label: "倒角高度",
    hint: "侧壁从边缘往内铺多深",
  },
  refractionAmount: {
    min: -80,
    max: 40,
    step: 2,
    label: "折射强度",
    hint: "负值向内吸（边缘压缩感）",
  },
  blurRadius: { min: 0, max: 20, step: 0.5, label: "模糊半径" },
  saturation: { min: 0.5, max: 3, step: 0.1, label: "饱和度" },
  brightness: { min: -0.5, max: 0.5, step: 0.02, label: "亮度" },
  contrast: { min: 0.5, max: 1.5, step: 0.02, label: "对比度" },
  highlightAlpha: { min: 0, max: 1, step: 0.02, label: "高光强度" },
  highlightWidth: { min: 0, max: 4, step: 0.1, label: "高光带宽" },
  highlightAngle: { min: 0, max: 360, step: 5, label: "高光方向" },
  shadowAlpha: { min: 0, max: 0.5, step: 0.01, label: "外阴影强度" },
  shadowRadius: { min: 0, max: 60, step: 1, label: "外阴影半径" },
  tintAlpha: {
    min: 0,
    max: 0.6,
    step: 0.01,
    label: "面板薄纱",
    hint: "面板底色，太厚会盖住折射",
  },
};

/** 滑杆的顺序 */
export const GLASS_PARAM_KEYS = [
  "refractionHeight",
  "refractionAmount",
  "blurRadius",
  "saturation",
  "brightness",
  "contrast",
  "highlightAlpha",
  "highlightWidth",
  "highlightAngle",
  "shadowAlpha",
  "shadowRadius",
  "tintAlpha",
] as const satisfies readonly (keyof typeof GLASS_PARAM_RANGES)[];

type Store = Record<GlassTheme, GlassParams>;

let current: Store = {
  light: { ...DEFAULT_GLASS_PARAMS.light },
  dark: { ...DEFAULT_GLASS_PARAMS.dark },
};
let loaded = false;
const listeners = new Set<() => void>();

function isGlassTheme(value: string | undefined): value is GlassTheme {
  return value === "light" || value === "dark";
}

/** 当前站点主题。以 <html data-theme> 为准（theme.ts 写的那个属性） */
export function currentGlassTheme(): GlassTheme {
  if (typeof document === "undefined") return "light";
  const value = document.documentElement.dataset.theme;
  return isGlassTheme(value) ? value : "light";
}

function load(): void {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<Store>;
    for (const theme of ["light", "dark"] as const) {
      const stored = parsed[theme];
      if (!stored) continue;
      // 只认识得出的值才收，避免手改坏的 localStorage 把渲染器搞崩
      for (const key of Object.keys(DEFAULT_GLASS_PARAMS[theme]) as (keyof GlassParams)[]) {
        const value = stored[key];
        if (value !== undefined && typeof value === typeof DEFAULT_GLASS_PARAMS[theme][key]) {
          (current[theme][key] as unknown) = value;
        }
      }
    }
  } catch {
    // 解析失败就用默认值，不打扰用户
  }
}

/** 某个主题当前的参数 */
export function getGlassParams(theme: GlassTheme): GlassParams {
  load();
  return current[theme];
}

/** 改某个主题的一个值并通知订阅者 */
export function setGlassParams(theme: GlassTheme, patch: Partial<GlassParams>): void {
  load();
  current = { ...current, [theme]: { ...current[theme], ...patch } };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // 隐私模式下写不进去，本次会话内仍然有效
  }
  for (const listener of listeners) listener();
}

/** 把某个主题恢复默认 */
export function resetGlassParams(theme: GlassTheme): void {
  setGlassParams(theme, { ...DEFAULT_GLASS_PARAMS[theme] });
}

export function subscribeGlassParams(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 两套参数导出成 JSON，方便贴回代码固化 */
export function glassParamsJson(): string {
  load();
  return JSON.stringify(current, null, 2);
}

/**
 * 给 useSyncExternalStore 用的快照：返回序列化后的字符串。
 *
 * 直接返回对象的话每次调用都是新引用，useSyncExternalStore 会认为「一直在变」
 * 而无限重渲染——use-labs 里也是同一条理由。
 */
export function glassParamsSnapshot(): string {
  load();
  return JSON.stringify(current);
}
