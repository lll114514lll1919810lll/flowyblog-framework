"use client";

import { useEffect, useRef, useState } from "react";
import {
  LiquidGlassRenderer,
  type GlassElementConfig,
} from "@/components/liquid-glass/renderer";
import { setLabRuntimeStatus } from "@/lib/lab-runtime-status";
import {
  cheapGlassMap,
  supportsCheapGlass,
} from "@/lib/liquid-glass-cheap";
import {
  currentGlassTheme,
  getGlassParams,
  subscribeGlassParams,
  type GlassParams,
} from "@/lib/liquid-glass-params";

/**
 * 液态玻璃面板材质（实验室实验）。
 *
 * 用 [liquid-glass-webgl](https://github.com/martin65536/liquid-glass-webgl)
 * 的 WebGL 渲染器（AGPL-3.0，见根目录 LICENSE 与 README）。
 *
 * ## 接线方式：只当「一层玻璃画布」，不接管页面
 *
 * 那个库自带的宿主 `LiquidGlassCanvas` 要求把**整个界面**描述成
 * `GlassElementConfig[]`——文字、按钮、滚动都在它的 canvas 里画。本站是
 * MDX + 真实 DOM 的站点，照那条路走就得把整站重写一遍，还会丢掉 SEO、
 * 可访问性、复制粘贴和浏览器查找。所以这里不用它的宿主，只拿渲染器本身：
 *
 *   canvas（position: fixed，铺在内容下面）
 *     └ 画「背景图 + 每块面板位置上的玻璃」
 *   DOM 层（正常文档流）
 *     └ 面板半透明，文字、图片、链接仍是活的 DOM，压在玻璃上
 *
 * 渲染器会把壁纸画进画布，所以开关打开时 body 的 CSS 背景图要收起来
 * （否则同一张图叠两层），见 globals.css 的实验室段。
 *
 * ## 顶栏和底栏不参与
 *
 * 它们保留原本的毛玻璃。原因写在 panelToElement 的注释里：一个图层没法同时
 * 做到「在正文之下」和「盖住正文」，而这两条窄边本来就有 blur(14px)。
 *
 * ## 坐标与滚动
 *
 * 元素用**文档坐标** + `scroll: true`——渲染器内部按 `y = rect.y - scrollY`
 * 换算成视口坐标。页面滚动仍由浏览器负责，我们只把 `window.scrollY` 同步过去。
 *
 * ## 兜底
 *
 * 拿不到 WebGL 上下文、或壁纸加载失败时什么都不做：面板保持原本的亚克力
 * 外观，也不会留下一块空白画布（CSS 背景图只在渲染成功后才收起来）。
 */

/**
 * 便宜版玻璃：一条 backdrop-filter 引用一个 SVG 滤镜就够了。
 *
 * 只有超长面板走这条路（WebGL 那套在它上面会退化），
 * 见 lib/liquid-glass-cheap.ts。过滤链里的模糊/对比度/亮度/饱和度直接用
 * 调参面板那几个值，好让两套玻璃的观感尽量一致。
 */
type CheapFilter = {
  id: string;
  url: string;
  scale: number;
  /**
   * 元素尺寸（CSS px）。
   *
   * 滤镜和 feImage 都用它——filterUnits 是 userSpaceOnUse，尺寸写错位移图
   * 就会被拉伸、整个效果跑偏。
   */
  width: number;
  height: number;
  blur: number;
  contrast: number;
  brightness: number;
  saturation: number;
};

/** 面板上的标记：CSS 靠它把面板底转透明 */
/** 会被当作玻璃候选的面板。三处（量元素、逐帧预检、嵌套判断）共用一份 */
const PANEL_SELECTOR = ".panel, .panel-strong, .panel-raised";

const PANEL_ATTR = "data-lab-glass-panel";

/**
 * 走便宜版的面板上的标记。
 *
 * 和 PANEL_ATTR 分开，是因为两套玻璃的**边缘高光来源不同**：画布那套会在
 * 边缘画一圈高光，便宜版只有 CSS 里手工描的上下两道线。样式表靠这个标记
 * 把便宜版那两道线拔亮一档，否则同样在深色底上，便宜版会明显发闷。
 */
const CHEAP_ATTR = "data-lab-glass-cheap";

/** 根元素上的标记：CSS 靠它把 body 的 CSS 背景图收起来（渲染器已经画了一份） */
const CANVAS_ATTR = "data-lab-glass-canvas";

/** 一页最多处理多少块面板 */
const MAX_PANELS = 24;

/**
 * 短边小于这个尺寸的面板不上玻璃。
 *
 * 门槛定得很低，只用来滤掉那些根本画不出内容的碎块（分隔条、装饰线之类）。
 *
 * 曾经为 44px 的回到顶部按钮把它提到 64，想让那个圆钮保留亚克力外观——
 * 那是误读了反馈（当时说的是「按钮在文章顶端不该出现」，属于出现时机，
 * 不是外观）。小控件还是走 WebGL 那套：它比一层纯模糊多出边缘压缩和倒角
 * 高光，圆钮上正好看得出来。
 */
const MIN_SIDE = 24;

/**
 * 圆角在遮罩纹理里至少要有这么多像素，否则这块面板改走便宜版。
 *
 * 渲染器给每块玻璃生成一张**方形**遮罩纹理（把整个元素归一化到一张
 * texSize × texSize 的图里，texSize 上限 1024，再乘 capsuleSdfQuality），
 * 圆角在这张图里能占到的像素数 = radius × (texSize / 元素最长边)。
 *
 * 实测（都在**生产构建**下、dpr 1.5）：
 *   - 832×31896：圆角占 0.2 像素，被量化成直角，方角玻璃盖住了面板的圆角；
 *   - 832×10080：占 0.71 像素，不只是圆角变方——玻璃整块画成了一个
 *     **三角形**，面板上横着一条对角边，静态下就很明显；
 *   - 832×6381：占 1.12 像素，正常。
 *
 * 门槛因此取 1：圆角连一个纹素都占不到时，这套 WebGL 几何就不该再用，
 * 交给便宜版（SVG 滤镜，没有这项限制）。原来写 0.5 是只按「圆角变方」
 * 定的，三角形那个更难看的表现落在了门槛之上。
 */
const MIN_RADIUS_TEXELS = 1;

/** 复刻渲染器选 texSize 的规则（continuous-mask.ts），只取判断需要的部分 */
function radiusTexels(width: number, height: number, radius: number, dpr: number): number {
  const maxDim = Math.max(width, height) * dpr;
  let base = 128;
  while (base < maxDim * 2 && base < 1024) base <<= 1;
  // renderer.capsuleSdfQuality 默认 0.5
  const texSize = Math.max(32, Math.ceil(base * 0.5));
  return (radius * dpr * texSize) / maxDim;
}

/** 密度基准：参考实现用 dp 描述尺寸，本站的 CSS 像素相当于它的 dp 1.0 */
const DP = 1;

/** 倒角高光的固定部分（其余几项可调，见 lib/liquid-glass-params.ts） */
const HIGHLIGHT_MODE = 0;
const HIGHLIGHT_COLOR: [number, number, number] = [1, 1, 1];
const HIGHLIGHT_FALLOFF = 1.0;

/** 外阴影的固定部分 */
const SHADOW_OFFSET_X = 0;
const SHADOW_COLOR: [number, number, number] = [0, 0, 0];

/** 从 CSS 变量里取当前主题的背景图地址（渲染器要自己把壁纸画进画布） */
function currentBackgroundUrl(): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--bg-image")
    .trim();
  const match = /url\((.*?)\)/.exec(raw);
  if (!match) return "";
  return match[1].trim().replace(/^["']|["']$/g, "");
}

/**
 * 取当前主题的背景薄纱颜色（`--bg-scrim`），取不到就返回 null。
 *
 * 站点在浅色主题下会往背景图上压一层 50% 白，让正文读得清；深色主题是 none。
 * 渲染器只会把原图当壁纸画，不会替我们压这一层，所以这里把颜色提出来烤进
 * 壁纸——否则一开玻璃，浅色主题的底会明显变花。
 *
 * 值形如 `linear-gradient(rgb(255 255 255 / 0.5), rgb(255 255 255 / 0.5))`，
 * 两端颜色相同，所以按纯色填一次就等价。
 */
function currentScrimColor(): string | null {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--bg-scrim")
    .trim();
  if (!raw || raw === "none") return null;
  const match = /rgba?\([^)]+\)|#[0-9a-f]{3,8}/i.exec(raw);
  return match ? match[0] : null;
}

/**
 * 载入壁纸并把薄纱压在上面，返回一张可直接交给渲染器的图。
 *
 * 走 data URL 而不是图片地址：渲染器内部用 Image + texImage2D，data URL 一样
 * 能解码，也就不必为「带薄纱的版本」多准备一份静态资源。
 */
async function loadScrimmedWallpaper(url: string): Promise<string> {
  const scrim = currentScrimColor();
  if (!scrim) return url;

  const image = new Image();
  image.src = url;
  await image.decode();

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) return url;
  context.drawImage(image, 0, 0);
  context.fillStyle = scrim;
  context.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

/**
 * 把一块面板翻译成渲染器的玻璃元素；不该上玻璃的返回 null。
 *
 * 圆角取面板自己的计算值：本站在「圆角」实验里能把 --radius-panel 改成
 * 0 或 26，玻璃必须跟着走，否则四角会露出来或盖住面板的边。半径为 0
 * 时仍然走矩形滤镜，保证「直角」实验下正文玻璃不退回亚克力。
 */
/**
 * 面板是否跟随文档流。buildElements 里量过就缓存下来，
 * 每帧的几何预检直接查缓存，不再重复读计算样式。
 */
const scrollFlags = new WeakMap<HTMLElement, boolean>();

/**
 * 面板是否真的钉在视口上。
 *
 * fixed 永远钉着；sticky 只有吸住之后才钉着——没吸住时它还在文档流里，
 * 跟着页面一起滚。这一点决定坐标体系（文档坐标 + scroll 偏移，还是视口
 * 坐标），判错的拖影很实在：关于页的鸣谢面板吸顶前有半屏多的自然位置，
 * 整段滚动里它的视口坐标每帧都在变，而重建限流 120ms 一次，玻璃就一直
 * 落在 DOM 后面。按「rect.top 是否已经压到 sticky top」区分之后，吸住
 * 前后各自坐标稳定，只在跨越阈值的那一帧重建一次。
 */
function elementAnchored(
  panel: HTMLElement,
  style: CSSStyleDeclaration,
  rect: DOMRect,
): boolean {
  const position = style.position;
  if (position !== "sticky" && position !== "fixed") return false;
  if (position === "fixed") return true;
  // 站点只用 top 方向的 sticky；top 不是数值时按旧语义当钉住处理
  const top = Number.parseFloat(style.top);
  return Number.isFinite(top) ? rect.top <= top + 0.5 : true;
}

function panelToElement(
  panel: HTMLElement,
  index: number,
  params: GlassParams,
): GlassElementConfig | null {
  const rect = panel.getBoundingClientRect();
  if (rect.width < MIN_SIDE || rect.height < MIN_SIDE) return null;

  const style = getComputedStyle(panel);

  /*
    隐藏中的面板不上玻璃。

    画布上的玻璃是**独立的一层**，不跟着 DOM 的 opacity 走——回到顶部按钮淡出
    之后，它那圈玻璃还留在画布上，看起来就是「按钮该消失了却还看得见一轮边框」。
    这正是当初误判成「边框没隐藏」的那件事：根因在画布，不在 border。

    门槛取 0.5，不是 1：canvas 设法让玻璃跟着淡入淡出，只能在淡到一半时切换。
    取 1 的话，按钮会先以一层几乎透明的空壳出现，再「啪」地套上玻璃，更难看。
    好在按钮显隐时同时带着 8px 位移，几何预检每帧量得到，所以切换不会漏。
  */
  if (Number.parseFloat(style.opacity) < 0.5) return null;

  const radius = Math.min(
    parseFloat(style.borderTopLeftRadius) || 0,
    Math.min(rect.width, rect.height) / 2,
  );

  /*
    顶栏和底栏不给玻璃，保留它们原本的毛玻璃。两层原因，任何一层单独都足够：

    1. 层级。全局画布铺在正文**下面**（z-index: -1），正文才能压在玻璃上；
       而吸顶顶栏要盖住滚上来的内容，它必须画在正文**之上**。一个图层同时
       满足这两件事是不可能的——试过给顶栏单独挂一块满视口画布 + 第二个
       渲染器，能跑，但要多开一个 WebGL 上下文，而且画布原点必须与视口
       左上角严格对齐才不跑偏，太脆。
    2. 值不值。顶栏只有 57px 高、底栏 76px，本来就带 blur(14px) 的毛玻璃，
       观感和液态玻璃差得不多；为这两条窄边再养一层渲染器不划算。

    判据是「在不在 <main> 里」，不是标签名。

    按标签名排除 HEADER/FOOTER 会误伤：页面上的 `page-hero` 也是 <header>
    （见 /blog、/lab 的页头），它们本该和别的面板一样有玻璃，结果一直没有。
    而顶栏底栏都渲染在 <main> 外面——`app/layout.tsx` 里它们在
    `PageTransition` 之外，`<main>` 由 `page-transition.tsx` 渲染——
    所以这个边界正好只把站点外框划出去。

    顺带一提，也不按定位方式一刀切：文章页的目录是 `nav.panel.sticky`，
    它待在自己的栏里、没有内容从它下面滚过去，用全局画布完全没问题。
  */
  if (!panel.closest("main")) return null;

  /*
    吸顶/固定的元素（目录那块）用**视口坐标**并且不参与滚动偏移。

    注意 sticky 有「还没吸住」的阶段：这时它跟着文档滚，得按文档坐标交给
    渲染器（scroll: true），否则视口坐标每帧都在变，玻璃只能靠限流重建
    跟跑，拖影明显。用 elementAnchored 按「是否真吸住」区分。

    渲染器对 scroll: true 的元素算 `y = rect.y - scrollY`，那是给跟随文档流的
    元素准备的。钉住的元素自己不动，再减一次 scrollY 就会一边滚动一边
    往上跑。这类元素的位置变化由 buildElements 重新量（见那里的 ResizeObserver）
    ——它只在「开始吸」的那几帧里变。
  */
  const anchored = elementAnchored(panel, style, rect);
  scrollFlags.set(panel, !anchored);

  // 圆角在遮罩纹理里已经退化成直角的面板（超长正文）不上玻璃
  const dpr = window.devicePixelRatio || 1;
  if (radius > 0 && radiusTexels(rect.width, rect.height, radius, dpr) < MIN_RADIUS_TEXELS) {
    return null;
  }

  return {
    id: `lab-glass-${index}`,
    kind: "glass-shape",
    rect: {
      x: rect.left,
      // 跟随文档流的用文档坐标（renderer 内部减 scrollY）；
      // 吸顶的用视口坐标，原样交给 renderer
      y: anchored ? rect.top : rect.top + window.scrollY,
      w: rect.width,
      h: rect.height,
    },
    cornerRadius: radius,
    refractionHeight: params.refractionHeight * DP,
    refractionAmount: params.refractionAmount * DP,
    depthEffect: params.depthEffect,
    chromaticAberration: params.chromaticAberration,
    blurRadius: params.blurRadius * DP,
    saturation: params.saturation,
    brightness: params.brightness,
    contrast: params.contrast,
    tintColor: [0, 0, 0, 0],
    surfaceColor: [0, 0, 0, 0],
    highlight: {
      mode: HIGHLIGHT_MODE,
      color: HIGHLIGHT_COLOR,
      angle: (params.highlightAngle * Math.PI) / 180,
      falloff: HIGHLIGHT_FALLOFF,
      alpha: params.highlightAlpha,
      widthDp: params.highlightWidth,
    },
    outerShadow: {
      radius: params.shadowRadius * DP,
      alpha: params.shadowAlpha,
      offsetX: SHADOW_OFFSET_X,
      offsetY: (params.shadowRadius / 6) * DP,
      color: SHADOW_COLOR,
    },
    innerShadow: null,
    label: "",
    labelColor: [0, 0, 0, 1],
    showChevron: false,
    isInteractive: false,
    scroll: !anchored,
    // 面板背后就是壁纸，直接采样干净的壁纸即可：省掉场景 FBO，
    // 静态页面上还能整帧命中缓存（对应参考实现的 LayerBackdrop）
    independentBackdrop: true,
  };
}

/**
 * 这块面板**只能**走便宜版，不能交给 WebGL。两种情况：
 *
 * 1. **正文页的正文面板**（`<article class="panel panel-strong">`）。它可能高到
 *    上万像素，WebGL 那套几何是按元素归一化算的，尺寸一大就退化（圆角变方、
 *    甚至整块画成三角形，见 MIN_RADIUS_TEXELS）。正文面板一律用便宜版，
 *    这一整类问题就不存在了。
 *
 * 2. **嵌在另一块玻璃面板里面的面板**：文章末尾的上一篇/下一篇、评论区的每条
 *    留言。全局画布在最底层（`position: fixed; z-index: -1`），DOM 里的一切都
 *    压在它上面——包括父面板自己那层薄纱。所以走 WebGL 的话，这些卡片的玻璃
 *    会被父面板压住：实测同一个位置，父面板薄纱在时卡片内部平均亮度 33.2，
 *    去掉后 44.1，被压掉约 25%。便宜版是一条 DOM 的 backdrop-filter，天然画在
 *    父面板之上，层级才对。代价是折射比 WebGL 糙，靠调高小尺寸面板的折射
 *    强度补（见 liquid-glass-cheap.ts 的 AMOUNT_RATIO_SMALL）。
 */
function mustUseCheap(panel: HTMLElement): boolean {
  /*
    正文那条判据要同时看标签和类名：评论区里每条留言也是 `<article>`，只是用
    的是 `panel-raised`，光看标签会把它们一起打进「正文」。
  */
  if (panel.tagName === "ARTICLE" && panel.classList.contains("panel-strong")) {
    return true;
  }
  return !!panel.parentElement?.closest(PANEL_SELECTOR);
}

/**
 * 这块面板要不要走便宜版。
 *
 * 只有两种情况需要：正文或嵌套面板必须避开 WebGL，或者圆角在 WebGL
 * 那套的遮罩纹理里会退化成直角——也就是超长正文面板（条件见
 * radiusTexels 的说明）。直角实验下正文仍然使用这条 SVG 滤镜路径，
 * 只是位移图本身按矩形生成。
 * 顶栏底栏、吸顶/固定、太小的面板都不在列。
 */
function cheapFallbackFor(
  panel: HTMLElement,
  index: number,
  params: GlassParams,
  /** 无视「圆角是否退化」，直接走便宜版（见 mustUseCheap） */
  force = false,
): CheapFilter | null {
  const rect = panel.getBoundingClientRect();
  if (rect.width < MIN_SIDE || rect.height < MIN_SIDE) return null;

  // 站点外框不给便宜版，理由同 panelToElement
  if (!panel.closest("main")) return null;

  const style = getComputedStyle(panel);

  const position = style.position;
  if (position === "sticky" || position === "fixed") return null;

  const radius = Math.min(
    parseFloat(style.borderTopLeftRadius) || 0,
    Math.min(rect.width, rect.height) / 2,
  );
  // 常规情况只有「可圆角但在遮罩里退化」的才走这条；强制时不再看这个
  if (!force) {
    const dpr = window.devicePixelRatio || 1;
    if (radiusTexels(rect.width, rect.height, radius, dpr) >= MIN_RADIUS_TEXELS) {
      return null;
    }
  }

  const map = cheapGlassMap(rect.width, rect.height, radius);
  if (!map.url) return null;

  return {
    id: `lab-glass-cheap-${index}`,
    url: map.url,
    scale: map.scale,
    width: rect.width,
    height: rect.height,
    blur: params.blurRadius,
    contrast: params.contrast,
    brightness: 1 + params.brightness,
    saturation: params.saturation,
  };
}

export function LiquidGlassPanels() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cheapFilters, setCheapFilters] = useState<CheapFilter[]>([]);

  /*
    这个 effect 只在实验被打开/关闭时跑一次，**不跟着路由重建**。

    换页时整段销毁重建的代价不只是慢：渲染器一 dispose，画布就没内容了，
    而 body 的 CSS 背景图又是在渲染成功后才收起来的——中间那几帧会出现
    「背景图回来了、玻璃还没画好」的闪烁；壁纸纹理也要重新解码一遍。

    换页只是面板换了一批，逐帧的几何预检会把新面板量出来并重建元素
    （token 里带着面板集合，数量变了就会触发），所以什么都不用重来。
  */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: LiquidGlassRenderer;
    try {
      renderer = new LiquidGlassRenderer(canvas);
    } catch {
      // 没有 WebGL：安静地退回亚克力外观
      setLabRuntimeStatus("liquidglass", "failed");
      return;
    }

    let disposed = false;
    let panels: HTMLElement[] = [];
    /** 这台浏览器支不支持便宜版（SVG 滤镜那条路）。整轮只算一次 */
    const cheapSupported = supportsCheapGlass();
    /**
     * 已经挂上便宜版滤镜的面板（含它们原本的 backdrop-filter），清理时还原。
     *
     * 直接在这儿应用、而不是另开一个 effect：面板元素本来就在手上，
     * 单独一个 effect 还得从 state 里反查面板，既绕又容易被「不许改依赖」的
     * lint 规则拦下。
     */
    let appliedCheap: { panel: HTMLElement; previous: string }[] = [];

    /**
     * 把便宜版滤镜写到面板自己身上。
     *
     * 为什么不另开一层窗口：`backdrop-filter` 挂在谁身上，滤镜区域就是谁的
     * 盒子。挂在一块一屏高的窗口上，窗口的边缘就是滤镜的边界——一条横穿
     * 文章的硬边；挂在面板上时边界正好是面板自己的边界，看不出来。
     */
    const applyCheapFilters = (
      list: { id: string; panel: HTMLElement }[],
      filters: CheapFilter[],
    ) => {
      for (const { panel, previous } of appliedCheap) {
        panel.style.backdropFilter = previous;
        panel.removeAttribute(CHEAP_ATTR);
      }
      appliedCheap = [];

      for (const { id, panel } of list) {
        const filter = filters.find((item) => item.id === id);
        if (!filter) continue;
        appliedCheap.push({ panel, previous: panel.style.backdropFilter });
        panel.setAttribute(CHEAP_ATTR, "on");
        panel.style.backdropFilter = [
          `url(#${filter.id})`,
          `blur(${filter.blur}px)`,
          `contrast(${filter.contrast})`,
          `brightness(${filter.brightness})`,
          `saturate(${filter.saturation})`,
        ].join(" ");
      }
    };

    // 调参面板改的是这个对象，每次重建元素时读最新值。
    // 深浅两套分开存，所以这里跟着当前主题走
    let params = getGlassParams(currentGlassTheme());
    const root = document.documentElement;

    setLabRuntimeStatus("liquidglass", "loading");

    /*
      每次重建都算一遍「所有玻璃的矩形 + 当前参数」的签名，没变就直接返回。

      两个原因：ResizeObserver 在开始观察时会先回调一次，滚动时吸顶元素的
      矩形也可能连着几帧在变；没有守卫的话 `setElements` 会被反复调用，
      而它会重置渲染器里这些元素的状态（正在进行的弹簧动画会被打断）。
    */
    let lastSignature = "";

    /** 按当前 DOM 量一批面板，交给渲染器 */
    const buildElements = () => {
      const found = [
        ...document.querySelectorAll<HTMLElement>(
          PANEL_SELECTOR,
        ),
      ];

      const elements: GlassElementConfig[] = [];
      const nextPanels: HTMLElement[] = [];
      const cheap: CheapFilter[] = [];
      /** 有面板本该走便宜版、而这个浏览器不支持（Firefox），于是少了一层玻璃 */
      let degraded = false;
      const cheapPanels: { id: string; panel: HTMLElement }[] = [];
      const signatureParts: string[] = [];
      for (const panel of found) {
        // 只能走便宜版的（正文、嵌套面板）不必再问 WebGL 那套
        const forceCheap = mustUseCheap(panel);
        const element = forceCheap
          ? null
          : panelToElement(panel, elements.length, params);
        if (element) {
          if (elements.length >= MAX_PANELS) break;
          elements.push(element);
          nextPanels.push(panel);
          signatureParts.push(
            `${element.id}:${Math.round(element.rect.x)},${Math.round(element.rect.y)},${Math.round(element.rect.w)},${Math.round(element.rect.h)}`,
          );
          continue;
        }

        /*
          便宜版靠 backdrop-filter 里的 SVG 滤镜，Firefox 不支持（见
          supportsCheapGlass）。这种情况下不给它上便宜版：面板会退回原本的
          亚克力外观，看起来还是一块正常的板子，总好过只剩一层两成透明的空壳。
          同时记一笔降级，实验室那边会把原因说给用户听。
        */
        if (!cheapSupported) {
          if (forceCheap) degraded = true;
          continue;
        }

        /*
          走便宜版：不用 WebGL，一条 backdrop-filter 交给合成器。
          三种来路：正文面板、嵌在玻璃里的面板（都是 mustUseCheap 判定的），
          以及圆角在遮罩纹理里退化到没法用的超长面板。
        */
        const fallback = cheapFallbackFor(
          panel,
          cheap.length,
          params,
          forceCheap,
        );
        if (!fallback) continue;
        cheap.push(fallback);
        cheapPanels.push({ id: fallback.id, panel });
        nextPanels.push(panel);
        signatureParts.push(
          `cheap-${fallback.id}:${Math.round(fallback.width)}x${Math.round(fallback.height)}`,
        );
      }
      const signature = `${signatureParts.join("|")}#${JSON.stringify(params)}`;
      if (signature === lastSignature) return;
      lastSignature = signature;

      /*
        上一轮上了玻璃、这一轮没上的面板，标记要摘掉。

        以前只加不摘：回到顶部按钮淡出后不再进列表，标记却留着，CSS 那边
        仍旧按「玻璃面板」处理（底转透明、边框清掉），看上去就是一层空壳；
        画布上也还留着上一帧的玻璃。
      */
      const nextPanelSet = new Set(nextPanels);
      for (const panel of panels) {
        if (!nextPanelSet.has(panel)) panel.removeAttribute(PANEL_ATTR);
      }

      panels = nextPanels;
      applyCheapFilters(cheapPanels, cheap);
      setCheapFilters(cheap);
      renderer.setElements(elements);
      syncContentHeight();
      renderer.requestRender();

      // 标记面板，让 CSS 把底转透明；空结果时不留标记，
      // 面板就保持原本的亚克力外观（画布上也只剩壁纸）
      const on = elements.length > 0 || cheap.length > 0;
      for (const panel of panels) panel.setAttribute(PANEL_ATTR, "on");
      /*
        降级是「这台浏览器的能力」问题，不是「当前页面」的问题：便宜版在
        Firefox 上根本不生效，而文章页一定会用到它。所以只要浏览器不支持，
        这个实验整体就是降级状态——否则用户在 /lab 上看不到任何说明
        （那一页没有正文面板，degraded 永远不会被置位），到了文章页才发现
        正文没了玻璃，却不知道原因。
      */
      setLabRuntimeStatus(
        "liquidglass",
        on ? (degraded || !cheapSupported ? "degraded" : "ready") : "failed",
      );
    };

    const syncSize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      renderer.resize(w, h);
    };

    /**
     * 把「内容有多高」告诉渲染器。
     *
     * 这条不能省：`setScrollY` 内部用 `contentHeight - 视口高` 做钳制，
     * contentHeight 没设过就是 0，于是每次同步过来的滚动量都被夹回 0——
     * 表现就是「玻璃不随文字滚动」，页面滚下去了玻璃还停在原位。
     */
    const syncContentHeight = () => {
      renderer.setContentHeight(
        Math.max(
          document.documentElement.scrollHeight,
          document.body.scrollHeight,
          window.innerHeight,
        ),
      );
    };

    /*
      滚动同步：常驻 rAF 里读 window.scrollY，变化了就当场渲染。

      两个细节都是为了压掉延迟，别改回「scroll 事件里 setScrollY」：

      1. 不用 scroll 事件。事件派发时机和渲染帧不一定对齐，中间再套一层
         requestAnimationFrame 就变成「事件 → 下一帧设偏移 → 再下一帧才画」，
         玻璃会比正文慢两帧，快速滚动时肉眼可见地拖在后面。常驻 rAF 每帧读
         一次当前值，只慢一帧。
      2. setScrollY 内部只是 requestRender()，真正的绘制排在**下一帧**；这里
         跟着同步调一次 render()，让画布和这一帧读到的滚动量对得上。那次被
         排队的渲染随后会因为 needsRedraw 已被清掉而直接早退，不会白画。

      剩下的延迟是结构性的：正文由合成器线程滚动，画布必须回主线程重画，
      主线程一忙就会落在后面。要再压只能减少每帧开销（降 dpr、降模糊）。
    */
    /**
     * 便宜的几何预检：只量矩形、不读计算样式。
     *
     * 每帧都跑一遍完整的 buildElements 会连着调 getComputedStyle（每块面板
     * 一次），那是这一层最贵的操作。这里先只量矩形，变了才走完整重建——
     * 静止时每帧的开销就只剩几次 getBoundingClientRect。
     *
     * 逐块返回而不是拼成一个长串：下面要靠「变化的是哪一块」决定要不要限流。
     * dims 与 parts 一一对应，是「能上 WebGL 玻璃的面板」的最长边，供小面板
     * 豁免限流用。走便宜版的面板（超长正文、嵌套卡片）记 0：它们不在渲染器
     * 的元素列表里，尺寸再大也不该拖累别的面板逐帧跟随。
     */
    const geometryParts = () => {
      const scrollY = window.scrollY;
      const parts: string[] = [];
      const dims: number[] = [];
      for (const panel of document.querySelectorAll<HTMLElement>(
        ".panel, .panel-strong, .panel-raised",
      )) {
        const r = panel.getBoundingClientRect();
        /*
          跟随文档流的面板用**文档坐标**，别用视口坐标。

          用视口坐标的话，滚动一下整串 token 就变了，于是每滚一帧都跑一遍
          完整重建（里面还有每块面板的 getComputedStyle）——纯浪费：那些
          面板的文档坐标根本没动，签名守卫随后也会判成「没变」。
          吸顶元素反过来，它钉在视口上，就得看视口坐标。
        */
        const y = (scrollFlags.get(panel) ?? true) ? r.top + scrollY : r.top;
        parts.push(
          `${Math.round(r.left)},${Math.round(y)},${Math.round(r.width)},${Math.round(r.height)}`,
        );
        dims.push(mustUseCheap(panel) ? 0 : Math.max(r.width, r.height));
      }
      return { parts, dims };
    };

    /*
      重绘期间降画质。

      玻璃每帧的开销正比于「画布像素数 × 模糊开销」，而滚动、换页动画这类
      连续重绘恰恰是最在意帧率、最不在意画质的时候。所以：连续变化持续一小段
      时间就切到低画质（dpr 1、模糊降采样 2×），停手后再切回高画质。

      判据是「**连续**变化持续了多久」，不是「距上次变化多久」。
      后者会让每一次滚动停下、哪怕只停两帧，都立刻切回高画质——滚一下切两回，
      而每次切换都要改 canvas 尺寸，画布一改尺寸就被清空，屏幕上就是黑闪。
      所以：持续变化超过 HOLD 才降，停手超过 IDLE 才升，一次滚动最多切两次。

      切换的实际动作也有两个讲究，都是为了不闪：

      1. 改完 dpr 立刻**同步**渲染一次。canvas.width 一赋值画布就被清空，
         等下一帧再画的话，中间那一帧就是黑的。
      2. 不要连着调两次 resizeFBOs：dpr 变了时 resize 内部已经按新尺寸重建过
         一遍（用的是当前的降采样值），再强制重建一次纯属白干。
    */
    const QUALITY_HOLD_MS = 80;
    const QUALITY_IDLE_MS = 320;
    /** 本轮连续变化的起点；0 表示当前不在「连续变化」里 */
    let burstStart = 0;
    let lastChangeAt = performance.now();
    let lowQuality = false;

    /** 高画质下的渲染倍率：跟设备走，但封顶 2（再高看不出差别，开销翻倍） */
    const highDpr = Math.min(window.devicePixelRatio || 1, 2);
    /*
      低画质按比例降，而不是写死 1。

      写死 1 在 dpr=1 的显示器上等于没降（实测：那条路径下高低两档的倍率
      完全一样，档位形同虚设）。取 0.65 倍是像素数降到约 42%，
      再叠上模糊降采样，重绘期间的开销大致减半，恢复后看不出痕迹。
    */
    const lowDpr = Math.max(0.5, highDpr * 0.65);

    const applyQuality = (low: boolean) => {
      if (low === lowQuality) return;
      lowQuality = low;
      renderer.dpr = low ? lowDpr : highDpr;
      renderer.blurDownsample = low ? 2 : 1;

      const canvas = renderer.canvas;
      const beforeW = canvas.width;
      const beforeH = canvas.height;
      renderer.resize(window.innerWidth, window.innerHeight);
      // 只改了降采样、画布尺寸没变时，resize 会提前返回，得强制重建一次
      if (canvas.width === beforeW && canvas.height === beforeH) {
        renderer.resizeFBOs(renderer.fboW, renderer.fboH, true);
      }
      // 同步画一帧：画布刚被清空过，别把黑的留给下一个合成帧
      renderer.render();
    };

    let rafId = 0;
    let lastScrollY = -1;
    let lastGeometryParts: string[] = [];
    let lastGeometryDims: number[] = [];

    /*
      变化期间的重建限流。

      「正文宽度」是有过渡动画的：面板宽度会在几百毫秒里连续变化，逐帧重建
      的话长面板每次都要重新生成一遍它的 SDF / 遮罩纹理，几十次下来就是明显
      的一卡一卡。这里压到 MIN_BUILD_INTERVAL_MS 一次，动画一停再补一次精确
      重建（tailPending），最终状态一定是对的。

      限流有豁免：变化只涉及小面板时逐帧重建。玻璃矩形跟随 DOM 全靠重建，
      目录展开/收起是 250ms 的高度过渡，限流 120ms 一次意味着 250ms 里玻璃
      只跳两三步，看起来就是面板拖着一层错位的玻璃。小面板重生成遮罩纹理
      很便宜（纹理上限 1024），逐帧跟不算负担。

      豁免按「尺寸变化」判定，不按矩形变化：目录收起时下方面板会整块上移
      （只有位置变），大小玻璃都不重生成遮罩——渲染器对纯位移走
      ex0/ey0Top 位置检查，玻璃体纹理照用。只有「大面板自己变了尺寸」才
      老实限流（超长正文那类走便宜版，dims 记 0，天然不参与）。
    */
    const MIN_BUILD_INTERVAL_MS = 120;
    /** 最长边超过这个值的玻璃面板发生尺寸变化时，回退到限流重建 */
    const SMOOTH_MAX_DIM = 1024;
    let lastBuildAt = 0;
    /** 限流期间被丢掉的那次重建，等几何停下来再补 */
    let tailPending = false;

    const tick = () => {
      const now = performance.now();
      const y = window.scrollY;
      let changed = false;
      if (y !== lastScrollY) {
        lastScrollY = y;
        renderer.setScrollY(y);
        renderer.render();
        changed = true;
      }

      /*
        每帧核对一次几何。

        为什么不能只靠 ResizeObserver：它只报**尺寸**变化，而玻璃要跟的东西
        远不止尺寸——换页过渡、展开收起、悬停缩放、吸顶元素从「没吸住」到
        「吸住」，这些改的是位置或合成变换，尺寸可以纹丝不动。少这一步的
        表现就是「动画过程中玻璃不动」。

        代价可以接受：预检只量矩形，是纯读操作（我们自己每帧不改布局，
        不会触发强制重排）；几何变了才走完整重建，而重建内部还有一层签名
        守卫兜底，不会白调 setElements、也不会打断渲染器里正在跑的弹簧动画。
      */
      const { parts, dims } = geometryParts();
      const geometryChanged =
        parts.length !== lastGeometryParts.length ||
        parts.some((part, i) => part !== lastGeometryParts[i]);
      if (geometryChanged) {
        /*
          找出变化的块，决定是否豁免限流：只有「大玻璃面板变了尺寸」才限流；
          小面板变尺寸、以及任何面板纯位移，都逐帧跟。这一步必须在覆盖
          lastGeometryParts 之前做，比较的才是上一帧。
        */
        let smallOnly = true;
        for (let i = 0; i < parts.length; i++) {
          const changed =
            i >= lastGeometryParts.length || parts[i] !== lastGeometryParts[i];
          if (!changed) continue;
          const sizeChanged =
            i >= lastGeometryDims.length || dims[i] !== lastGeometryDims[i];
          if (sizeChanged && dims[i] > SMOOTH_MAX_DIM) {
            smallOnly = false;
            break;
          }
        }
        lastGeometryParts = parts;
        lastGeometryDims = dims;
        changed = true;
        if (smallOnly || now - lastBuildAt >= MIN_BUILD_INTERVAL_MS) {
          lastBuildAt = now;
          tailPending = false;
          buildElements();
        } else {
          // 这次先跳过，等几何稳定后由 tailPending 补一次
          tailPending = true;
        }
      } else if (tailPending) {
        // 几何停了，补上最后一次（此时量到的就是最终值）
        tailPending = false;
        lastBuildAt = now;
        buildElements();
      }

      if (changed) {
        lastChangeAt = now;
        if (burstStart === 0) burstStart = now;
      } else if (now - lastChangeAt > QUALITY_IDLE_MS) {
        // 停手够久，本轮「连续变化」结束
        burstStart = 0;
      }
      const busyFor = burstStart === 0 ? 0 : now - burstStart;
      if (busyFor > QUALITY_HOLD_MS) applyQuality(true);
      else if (now - lastChangeAt > QUALITY_IDLE_MS) applyQuality(false);

      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      syncSize();
      syncContentHeight();
      // 尺寸变了要重新量面板（宽度档位变化会换行，高度也会变）
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(buildElements, 200);
    };

    const start = async () => {
      const wallpaper = currentBackgroundUrl();
      if (!wallpaper) {
        setLabRuntimeStatus("liquidglass", "failed");
        return;
      }

      syncSize();
      try {
        await renderer.loadWallpaper(await loadScrimmedWallpaper(wallpaper));
      } catch {
        setLabRuntimeStatus("liquidglass", "failed");
        return;
      }
      if (disposed) return;

      buildElements();
      lastScrollY = window.scrollY;
      renderer.setScrollY(lastScrollY);
      renderer.dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer.resize(window.innerWidth, window.innerHeight);
      renderer.requestRender();
      if (process.env.NODE_ENV !== "production") {
        // 开发期把渲染器挂出来，方便验证滚动同步（生产构建会被 tree-shake）
        (window as unknown as { __labGlass?: LiquidGlassRenderer }).__labGlass =
          renderer;
      }
      // 到这一步画布上已经有壁纸了，才把 body 的 CSS 背景图收起来。
      // 放在成功后：拿不到 WebGL 或壁纸解码失败时，页面还是原来的样子。
      root.setAttribute(CANVAS_ATTR, "on");
    };

    void start();

    // 面板那层薄纱的透明度是 CSS 变量，改一次就够
    const syncTint = () => {
      root.style.setProperty("--lab-glass-tint", String(params.tintAlpha));
      // 深色主题的背景更亮更花，同样比例下更"透"，按 1.6 倍补一点
      root.style.setProperty(
        "--lab-glass-tint-dark",
        String(Math.min(0.6, params.tintAlpha * 1.6)),
      );
    };

    const unsubscribe = subscribeGlassParams(() => {
      params = getGlassParams(currentGlassTheme());
      syncTint();
      // 参数只影响元素本身，重建一次即可（渲染器会重画）。
      // 拖滑杆也是连续重绘，同样按「忙碌」处理，让它走低画质
      lastChangeAt = performance.now();
      buildElements();
    });
    syncTint();

    // 内容长高（图片、字体晚到，或换页）也要重新报高度，否则滚到底部时
    // 玻璃会被钳在旧的高度上、和正文错位
    const contentObserver = new ResizeObserver(syncContentHeight);
    contentObserver.observe(document.body);

    /*
      切主题要同时换三样东西，缺一样都会看出破绽：

      1. 参数：深浅各一套（亮度差 0.02）；
      2. 薄纱变量：同一套参数里的一部分；
      3. **背景图**：两个主题的壁纸不是同一张，画布上还挂着旧的那张的话，
         整页底色会和主题对不上。这一步最容易漏。

      换壁纸本身是安全的：渲染器先把新图解码完、再替换纹理引用，
      中间不会出现空白帧。所以这里不需要遮罩、也不用等过渡结束。
    */
    const themeObserver = new MutationObserver(() => {
      void (async () => {
        params = getGlassParams(currentGlassTheme());
        syncTint();
        buildElements();

        const url = currentBackgroundUrl();
        if (!url) return;
        try {
          await renderer.loadWallpaper(await loadScrimmedWallpaper(url));
        } catch {
          // 换图失败就继续用旧壁纸，总比空着强
        }
      })();
    });
    themeObserver.observe(root, { attributes: true, attributeFilter: ["data-theme"] });

    window.addEventListener("resize", onResize);

    return () => {
      disposed = true;
      unsubscribe();
      themeObserver.disconnect();
      contentObserver.disconnect();
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      clearTimeout(resizeTimer);
      for (const { panel, previous } of appliedCheap) {
        panel.style.backdropFilter = previous;
        panel.removeAttribute(CHEAP_ATTR);
      }
      for (const panel of panels) panel.removeAttribute(PANEL_ATTR);
      root.removeAttribute(CANVAS_ATTR);
      renderer.dispose();
    };
    // 刻意只依赖空数组：见上面那段说明
  }, []);

  return (
    <>
      <div className="lab-lg-canvas" aria-hidden="true">
        <canvas ref={canvasRef} />
      </div>

      {/* 便宜版的滤镜定义。display:none 不行：按 id 引用的滤镜会被隐藏掉整棵
          子树弄失效，所以用 0 尺寸 + overflow:hidden 藏。 */}
      {cheapFilters.length > 0 ? (
        <svg className="lab-lg-defs" aria-hidden="true" focusable="false">
          <defs>
            {cheapFilters.map((filter) => (
              <filter
                id={filter.id}
                key={filter.id}
                filterUnits="userSpaceOnUse"
                x="0"
                y="0"
                width={filter.width}
                height={filter.height}
                colorInterpolationFilters="sRGB"
              >
                <feImage
                  href={filter.url}
                  x="0"
                  y="0"
                  width={filter.width}
                  height={filter.height}
                  preserveAspectRatio="none"
                  result="map"
                />
                <feDisplacementMap
                  in="SourceGraphic"
                  in2="map"
                  scale={filter.scale}
                  xChannelSelector="R"
                  yChannelSelector="G"
                />
              </filter>
            ))}
          </defs>
        </svg>
      ) : null}
    </>
  );
}
