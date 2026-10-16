/**
 * 「便宜版」液态玻璃：给 WebGL 渲染器扛不住的超长面板用。
 *
 * 做法照着 [shuding/liquid-glass](https://github.com/shuding/liquid-glass)（MIT）。
 * 它的核心就三步，也是它便宜的原因：
 *
 *   1. **不用 WebGL**。滤镜整条交给 CSS 的 `backdrop-filter: url(#f)`，
 *      由合成器负责——滚动、换页、动画都不需要跑一行 JS，也没有 FBO、
 *      没有 GPU 上下文上限。
 *   2. **位移场是公式算的**，不是物理推的：一个圆角矩形的有向距离，线性映射
 *      到环带 [0,1]，套一个圆弧剖面（边缘处斜率最大），方向取 SDF 的中心差分
 *      梯度（表面法线）。没有 LUT、没有第二张高光图。
 *      剖面和方向这两处没有沿用原版：原版用 smoothstep 当剖面、沿径向往中心
 *      收。smoothstep 两端导数为零，边缘处斜率归零，做出来是「平切角」
 *      （chamfer）而不是「圆角」（fillet）；径向在长边中段会斜着指向中心，
 *      不是垂直于边。这两点是照
 *      [hotcocoacanary 的液态玻璃原理篇](https://hotcocoacanary.github.io/2026/08/21/projects/design/01-%E6%B6%B2%E6%80%81%E7%8E%BB%E7%92%83-%E5%8E%9F%E7%90%86%E7%AF%87/)
 *      的论证改的（它的上游参考是 ybouane/liquidglass）。
 *   3. **自归一化**：算完取最大位移当作 feDisplacementMap 的 scale，
 *      图里只编码相对值。位移量天然落在元素自身范围内，不会越界采样。
 *
 * 和原版的两处差异，都是因为我们的面板尺寸远超它的示例（最多三万多像素高）：
 *
 *   - 距离用**元素像素**算，不用归一化坐标。原版把 uv 归一到 [0,1] 再算 SDF，
 *     长宽比差一个数量级时圆角会被拉变形。
 *   - 位移幅度按**环带宽度**给（最多几十像素），不按「离中心多远」给。
 *     原版是 `采样点 = 中心 + 偏移 × scaled`，偏移随尺寸线性增长——放到一块
 *     800×32000 的面板上就是几千像素的位移，那是坏的而不是折射。
 */

/**
 * 这套便宜版在当前浏览器里能用吗。
 *
 * 它靠 `backdrop-filter: url(#…)` 里的 SVG 滤镜做位移，而**这是 Chromium 专有**：
 * Firefox 只支持 backdrop-filter 里那些标准滤镜函数（blur / saturate / …），
 * 遇到 url() 整条声明会失效——面板就只剩下一层两成透明的底，比不做还难看。
 * 所以先问一句再决定用不用；不支持就让面板保持原本的亚克力外观。
 *
 * 两道判断，都不多余：
 *
 * 1. `CSS.supports` 只看**语法**。Firefox 的 backdrop-filter 语法里恰好收 url()，
 *    却不执行 SVG 滤镜，所以它能返回 true 而实际不生效。
 * 2. 因此再补一道引擎判断。宁可少用（Gecko 上退回亚克力），也不要给用户一个
 *    空壳。这是少见的「按引擎判断」合理场合：差别就在实现有没有做。
 */
export function supportsCheapGlass(): boolean {
  if (typeof window === "undefined") return false;
  if (/firefox|fxios/i.test(window.navigator.userAgent)) return false;
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") return false;
  return (
    CSS.supports("backdrop-filter", "blur(1px)") &&
    CSS.supports("backdrop-filter", 'url("#lab-glass-probe")')
  );
}

/** 单张位图的像素预算（超长面板按比例缩图） */
const MAX_MAP_PIXELS = 240_000;

/** 位图长边上限 */
const MAX_MAP_SIDE = 2048;

/** 环带宽度：取短边的这个比例，并夹在区间里（元素像素） */
const BEZEL_RATIO = 0.06;
const BEZEL_MIN = 12;
const BEZEL_MAX = 90;

/**
 * 折射强度：最大位移相对环带宽度的比例，按面板大小分两档。
 *
 * 大面板（正文那种，动辄上千像素）用 0.35：再大边缘那道压缩会宽到像贴了层
 * 放大镜，而且那么长的边根本看不过来。
 *
 * 小面板（卡片、按钮那类）用 0.6：它整块就几百像素，同样的**绝对**位移在视觉
 * 上弱得多——0.35 配 12px 环带只有 4.2px 位移，几乎看不出边缘压缩，和 WebGL
 * 那套摆在一起会显平。调高这一档就是为了补上这个差距。
 */
const AMOUNT_RATIO_LARGE = 0.35;
const AMOUNT_RATIO_SMALL = 0.6;

/** 短边小于这个尺寸算「小面板」，用上面那个更高的折射强度 */
const SMALL_PANEL_SIDE = 240;

const cache = new Map<string, { url: string; scale: number }>();

/**
 * 倒角锐度 K ∈ [0, 1)：圆弧剖面 t(u) = u·√(1-K) / √(1-K·u²) 里的那个 K。
 *
 * 剖面已归一化成 t(0)=0、t(1)=1：0 是等斜率斜面（平切角），K 越接近 1
 * 边缘转折越急、越像真实圆弧倒角。0.6 是折中——位移在环带中段偏弱、
 * 集中到贴边那几十个像素里，正是真玻璃边缘的样子。
 */
const ARC_SHARPNESS = 0.6;

/** 圆角矩形的有向距离：内部为负、边界为 0、外部为正 */
function roundedRectSdf(
  x: number,
  y: number,
  halfWidth: number,
  halfHeight: number,
  radius: number,
): number {
  const qx = Math.abs(x) - halfWidth + radius;
  const qy = Math.abs(y) - halfHeight + radius;
  return (
    Math.min(Math.max(qx, qy), 0) +
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) -
    radius
  );
}

export type CheapGlassMap = {
  /** 位移图的 data URL */
  url: string;
  /** feDisplacementMap 的 scale（元素像素） */
  scale: number;
};

/**
 * 生成位移图。按元素尺寸缓存——尺寸不变就只算一次。
 *
 * 位图分辨率按预算往下压（超长面板会压得比较狠），所以环带宽度是按**元素
 * 像素**定义、再换算到图上的：只要环带在图里还占得住几个像素就没问题。
 */
export function cheapGlassMap(
  width: number,
  height: number,
  radius: number,
): CheapGlassMap {
  const key = `${Math.round(width)}x${Math.round(height)}x${Math.round(radius)}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const shortSide = Math.max(1, Math.min(width, height));
  const bezel = Math.max(BEZEL_MIN, Math.min(BEZEL_MAX, shortSide * BEZEL_RATIO));
  const amountRatio =
    shortSide < SMALL_PANEL_SIDE ? AMOUNT_RATIO_SMALL : AMOUNT_RATIO_LARGE;
  const amount = bezel * amountRatio;

  // 位图尺寸：按预算缩，再压长边上限
  let mapScale = Math.min(1, Math.sqrt(MAX_MAP_PIXELS / (width * height)));
  if (Math.max(width, height) * mapScale > MAX_MAP_SIDE) {
    mapScale = MAX_MAP_SIDE / Math.max(width, height);
  }
  const mapWidth = Math.max(8, Math.round(width * mapScale));
  const mapHeight = Math.max(8, Math.round(height * mapScale));

  const pixels = new Uint8ClampedArray(mapWidth * mapHeight * 4);
  const rawX = new Float32Array(mapWidth * mapHeight);
  const rawY = new Float32Array(mapWidth * mapHeight);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  // 梯度差分的步长：取「图上一个像素」对应的元素距离。
  // SDF 在每个圆角的角平分线上有真实的尖点（不可导），差分步长太小会把
  // 那道折痕带进方向场；取到一个图上像素宽，方向会平滑地转过去
  const epsilon = Math.max(width / mapWidth, height / mapHeight);
  // 圆弧剖面 t(1)=1 的归一化系数，提前算好
  const arcNorm = Math.sqrt(1 - ARC_SHARPNESS);
  let maxDisplacement = 0;

  for (let py = 0; py < mapHeight; py += 1) {
    // 图上的像素中心换算回元素像素、再平移到以中心为原点
    const ey = ((py + 0.5) / mapHeight) * height - halfHeight;
    for (let px = 0; px < mapWidth; px += 1) {
      const ex = ((px + 0.5) / mapWidth) * width - halfWidth;
      const index = py * mapWidth + px;

      // 轮廓之外不位移：那块在元素边界外，采样没有意义
      const distance = roundedRectSdf(ex, ey, halfWidth, halfHeight, radius);
      if (distance > 0) {
        rawX[index] = 0;
        rawY[index] = 0;
        continue;
      }

      // u：距离「线性」映射到环带，0 在环带内界、1 在边缘。
      // 不能再套 smoothstep——链式法则会把零斜率原样送回边缘，剖面就白换了
      const u = 1 + distance / bezel;
      if (u <= 0) continue; // 环带以内的玻璃中间：不偏移

      // 圆弧剖面：t(0)=0、t(1)=1，斜率随 u 单调增大、在边缘处最大。
      // smoothstep 那种两端导数为零的 S 形是「平切角」，这个才是「圆角」
      const t = (u * arcNorm) / Math.sqrt(1 - ARC_SHARPNESS * u * u);

      // 方向：SDF 的中心差分梯度 = 表面法线，恒指向「离边界更远」的外侧，
      // 取负号让位移朝内——边缘把内部的像素「拉」过来，形成压缩感。
      // 比径向朝中心收更物理：长边中段的法线垂直于边，径向会斜指向中心
      const gx =
        roundedRectSdf(ex + epsilon, ey, halfWidth, halfHeight, radius) -
        roundedRectSdf(ex - epsilon, ey, halfWidth, halfHeight, radius);
      const gy =
        roundedRectSdf(ex, ey + epsilon, halfWidth, halfHeight, radius) -
        roundedRectSdf(ex, ey - epsilon, halfWidth, halfHeight, radius);
      const len = Math.hypot(gx, gy);
      if (len < 1e-6) continue;

      const offsetX = -(gx / len) * amount * t;
      const offsetY = -(gy / len) * amount * t;
      rawX[index] = offsetX;
      rawY[index] = offsetY;
      maxDisplacement = Math.max(maxDisplacement, Math.abs(offsetX), Math.abs(offsetY));
    }
  }

  const safeMax = maxDisplacement || 1;
  for (let i = 0; i < mapWidth * mapHeight; i += 1) {
    pixels[i * 4] = Math.round(128 + (rawX[i] / safeMax) * 127);
    pixels[i * 4 + 1] = Math.round(128 + (rawY[i] / safeMax) * 127);
    pixels[i * 4 + 2] = 0;
    pixels[i * 4 + 3] = 255;
  }

  const canvas = document.createElement("canvas");
  canvas.width = mapWidth;
  canvas.height = mapHeight;
  const context = canvas.getContext("2d");
  if (!context) return { url: "", scale: 0 };
  context.putImageData(new ImageData(pixels, mapWidth, mapHeight), 0, 0);

  const result: CheapGlassMap = {
    url: canvas.toDataURL("image/png"),
    // 通道偏离 127 时对应 safeMax 像素的位移；换算成 feDisplacementMap 的 scale
    scale: (safeMax * 255) / 127,
  };
  cache.set(key, result);
  return result;
}
