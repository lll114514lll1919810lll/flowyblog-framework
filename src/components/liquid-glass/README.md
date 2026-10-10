# 第三方代码

本站的液态玻璃用到两个第三方实现，都在这个目录或它旁边，来源与协议分开记：

| 来源 | 协议 | 用在哪 |
| --- | --- | --- |
| [martin65536/liquid-glass-webgl](https://github.com/martin65536/liquid-glass-webgl) | AGPL-3.0 | 本目录（渲染器 + shader），负责常规面板 |
| [shuding/liquid-glass](https://github.com/shuding/liquid-glass) | MIT | `src/lib/liquid-glass-cheap.ts`，负责超长文章面板 |

便宜那条路线的实现是照它的思路重写的（圆角 SDF + 缓动 + 自归一化位移图），
没有直接搬运代码，但署名照 MIT 的要求保留在文件头。

---

# liquid-glass-webgl 渲染器

这里不是本站自己写的代码，是**原样搬运**的第三方实现，来源：

- 上游：<https://github.com/martin65536/liquid-glass-webgl>
- 协议：**AGPL-3.0**（本站因此整体按 AGPL-3.0 发布，见根目录 `LICENSE`）
- 搬运内容：上游 `src/components/liquid-glass/renderer/`、`shaders/` 两个目录
- 搬运日期：2026-10-09

上游是对 [Kyant0/AndroidLiquidGlass](https://github.com/Kyant0/AndroidLiquidGlass)
的 Web 移植，核心是 G2 连续曲率圆角、可分离高斯 / Kawase 模糊、
色差折射透镜、scissor 局部 blit 那一套。

## 为什么放在独立目录

渲染器和本站其余部分的风格、命名、注释语言都不一样。改动它会让日后跟上游
对比、升级都做不了，所以按「不改动、只标注」处理：

- **ESLint 不检查这里**（`eslint.config.mjs` 里排除），因为它过不了本站的规则；
- **类型检查仍然覆盖这里**（`pnpm typecheck`），所以下面那些修补必须保留。

## 我们对上游做过的改动

上游发布时 `next.config.ts` 里写着 `typescript: { ignoreBuildErrors: true }`，
带着 56 个类型错误。本仓库不打算关掉自己的类型检查，所以逐条修掉了。
记录在这里，方便日后同步上游时对照：

| 文件 | 问题 | 处理 |
| --- | --- | --- |
| `renderer/methods-render-glass-state.ts` | `renderGlassElement` 的接口声明少一个参数 `r`，实现里有 | 接口补上第 7 个参数 |
| `renderer/methods-toggle.ts` | `ensureToggleState` 的接口声明少了 `valueRangeSpan`，实现里有 | 接口补上第 4 个参数 |
| `renderer/perf-monitor.ts` | 赋了 `lastSkipPingPongCount` 但没声明字段 | 补字段声明 |
| `renderer/methods-fbo.ts` | 两处 `lastBlurStats` 字面量缺 `w/h/progMs/stateMs/drawMs` | 用作用域里的 `dw/dh` 补全 |
| `renderer/methods-render-nonglass-plain-rect.ts` | `el.plainRect` 可能为 undefined | 该路径由调用方保证存在，加非空断言 |
| `renderer/methods-render-nonglass-progressive-blur.ts` | `el.progressiveBlur` 同上 | 同上 |

另外**没有搬运**上游的 `shapes/` 目录：那 4 个文件在上游内部没有被任何地方
import（`grep` 全仓库无引用），属于死代码。

## 本站怎么用它

见 [`src/components/lab-liquidglass.tsx`](../../lab-liquidglass.tsx)：
不用上游自带的宿主组件 `LiquidGlassCanvas`（它要求把整个界面描述成
`GlassElementConfig[]`，文字和滚动都在 canvas 里），只实例化
`LiquidGlassRenderer`，把它当成「一层玻璃画布」铺在正文下面，
DOM 依旧是真实的 DOM。
