import Link from "next/link";
import Image from "next/image";
import type { CSSProperties } from "react";
import type { Post } from "@/lib/posts";
import { formatDate } from "@/lib/date";
import { withBasePath } from "@/lib/asset-version";
import { LinkPending } from "@/components/link-pending";

function getPostNumber(slug: string): string {
  const match = /^(\d+)(?:-|$)/.exec(slug);
  return match ? match[1].padStart(2, "0") : "00";
}

/** FNV-1a：把 slug 压成一个稳定的 32 位种子 */
function hashSlug(slug: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    hash ^= slug.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32：拿种子造一个可复现的伪随机序列，服务端/客户端各算各的也对得上 */
function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 从 slug 派生整张封面的随机参数。
 *
 * 旧的 4 套预设类名只够换底色，这里改成连续值：
 * 渐变用 oklch 生成——色相走「相邻色」（间隔 ≤ 50°）保证不花，
 * 饱和度压在低位（chroma 0.05–0.10，莫兰迪灰调），明度锁在中段
 * （0.38–0.74），太深发闷、太浅压不住白色文字；
 * 三条轨道线和网格的几何（尺寸/位置/角度/密度）也一起参与随机，
 * 第三条随机虚线/实线增加线条形状的变化。
 * 同一篇文章永远同一张封面，不同文章肉眼上各有各的长相。
 */
function coverFromSlug(slug: string): {
  background: CSSProperties;
  grid: CSSProperties;
  orbitOne: CSSProperties;
  orbitTwo: CSSProperties;
  orbitThree: CSSProperties;
} {
  const rand = mulberry32(hashSlug(slug));
  const between = (min: number, max: number) => min + rand() * (max - min);
  const pick = (min: number, max: number, digits = 0) =>
    between(min, max).toFixed(digits);

  const hue = between(0, 360);
  const hue2 = hue + between(15, 50);
  const hue3 = hue2 + between(15, 50);
  const chroma = between(0.05, 0.1);
  const tone = (lightness: number, h: number) =>
    `oklch(${lightness.toFixed(3)} ${chroma.toFixed(3)} ${h.toFixed(1)})`;

  return {
    background: {
      backgroundImage: `linear-gradient(${pick(120, 150, 1)}deg, ${tone(between(0.38, 0.46), hue)}, ${tone(between(0.5, 0.6), hue2)} 55%, ${tone(between(0.64, 0.74), hue3)})`,
    },
    grid: {
      backgroundSize: `${pick(22, 34)}px ${pick(22, 34)}px`,
      maskImage: `linear-gradient(${pick(100, 160)}deg, black, transparent 70%)`,
    },
    orbitOne: {
      width: `${pick(52, 75)}%`,
      height: `${pick(130, 170)}%`,
      left: `${pick(15, 32)}%`,
      top: `${pick(-35, -15)}%`,
      transform: `rotate(${pick(-40, 40, 1)}deg)`,
      opacity: pick(0.7, 0.95, 2),
    },
    orbitTwo: {
      width: `${pick(34, 52)}%`,
      height: `${pick(105, 135)}%`,
      left: `${pick(35, 52)}%`,
      top: `${pick(-20, 0)}%`,
      transform: `rotate(${pick(-45, 45, 1)}deg)`,
      opacity: pick(0.4, 0.6, 2),
    },
    // 第三条压轴的大弧：更接近圆形、允许探出画面被裁掉，
    // 再随机虚/实线，和前两条细长椭圆拉开形状差距
    orbitThree: {
      width: `${pick(80, 115)}%`,
      height: `${pick(55, 90)}%`,
      left: `${pick(-15, 20)}%`,
      top: `${pick(-30, -5)}%`,
      transform: `rotate(${pick(-30, 30, 1)}deg)`,
      opacity: pick(0.3, 0.45, 2),
      borderStyle: rand() > 0.5 ? "dashed" : "solid",
    },
  };
}

/**
 * 文章列表里的一项。
 *
 * 一张卡片就是一个独立圆角亚克力面板，浮在背景图之上。
 * 卡片之间靠间距分隔（父容器 gap-3），不再用分隔线——
 * 面板本身有边框和阴影，再加横线会显得脏。
 *
 * 微交互思路（极简风格）：
 * - 平时只有标题和时间，摘要淡到几乎看不见，保持列表的克制
 * - 悬停时面板底色变实一点，摘要和标签淡入，露出更多信息
 * - 标题左侧有一条短横线，悬停时横向延展，作为「这里可点」的暗示
 */
export function PostCard({
  post,
  featured = false,
}: {
  post: Post;
  featured?: boolean;
}) {
  const cover = coverFromSlug(post.slug);

  return (
    <article className={`group relative ${featured ? "h-full" : ""}`}>
      {/* 用绝对定位的链接铺满整行作为悬停热区，比只让文字可点更好点。
          tabIndex={-1} 让它不进入 Tab 顺序，键盘用户走下方标题上的真实链接。

          热区本身是空的可点击区域，没有文字可显示「点击中」状态，
          所以在里面铺一层 LinkPending：导航等待期间整行轻微压暗，
          用户能立刻确认点击生效（本地几乎无感，真实网络下很有用）。 */}
      <Link
        href={`/blog/${post.slug}`}
        className="absolute inset-0 z-0 rounded-[var(--radius-panel)]"
        aria-label={post.title}
        tabIndex={-1}
      >
        <LinkPending />
      </Link>

{/* pointer-events-none 必须保留：内容层盖在热区链接之上，
            去掉它点击标题就不会导航了（事件被这一层吃掉）。
            悬停效果靠 group-hover 从 article 上继承，不影响。 */}
      <div
        className={`panel pointer-events-none relative z-10 h-full overflow-hidden transition-colors duration-200 group-hover:border-accent/30 group-hover:bg-panel-strong ${
          featured ? "flex flex-col md:grid md:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]" : ""
        }`}
      >
        <div
          className={`cover-art ${featured ? "min-h-56 md:min-h-full" : "aspect-[2.2/1]"}`}
          style={post.cover ? undefined : cover.background}
        >
          {/* 有真实封面就显示图片（object-cover 裁切填满），不再叠装饰图形；
              没有就回退到按 slug 生成的图形封面。 */}
          {post.cover ? (
            <Image
              /* withBasePath：静态导出不加 basePath（见 lib/asset-version.ts），
                  子路径部署（GitHub Pages）下不加这里就是 404 */
              src={withBasePath(post.cover)}
              alt=""
              fill
              sizes={
                featured
                  ? "(max-width: 768px) 100vw, 55vw"
                  : "(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
              }
              className="object-cover"
            />
          ) : (
            <>
              <span className="cover-grid" style={cover.grid} aria-hidden="true" />
              <span className="cover-orbit" style={cover.orbitOne} aria-hidden="true" />
              <span className="cover-orbit" style={cover.orbitTwo} aria-hidden="true" />
              <span className="cover-orbit" style={cover.orbitThree} aria-hidden="true" />
              <span className="cover-label">NOTES</span>
              <span className="cover-index">{getPostNumber(post.slug)}</span>
            </>
          )}
        </div>

        <div className={`flex flex-col gap-3 px-5 py-5 ${featured ? "md:justify-center md:px-8 md:py-8" : ""}`}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px]">
          <time
            dateTime={post.date}
            className="shrink-0 tabular-nums text-muted transition-colors group-hover:text-secondary"
          >
            {formatDate(post.date)}
          </time>

          {post.readingTime !== undefined && (
            <span className="text-muted transition-colors group-hover:text-secondary">
              {post.readingTime} 分钟
            </span>
          )}

          {post.tags && post.tags.length > 0 && (
            <span className="ml-auto flex shrink-0 gap-1.5">
              {post.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-full border border-border px-2 py-1 text-[11px] leading-none text-muted transition-colors group-hover:border-accent/30 group-hover:text-accent"
                >
                  {tag}
                </span>
              ))}
            </span>
          )}
        </div>

        <h2 className={`text-lg font-semibold leading-snug tracking-tight ${featured ? "text-2xl sm:text-3xl" : ""}`}>
          {/* 标题是真链接：键盘用户 Tab 到这里回车即可打开文章。
              内容层 pointer-events-none，鼠标点击会穿透到上面的整行热区，
              所以鼠标路径的行为不变；键盘激活走这条链接，同样带 LinkPending。 */}
          <Link
            href={`/blog/${post.slug}`}
            className="transition-colors group-hover:text-accent"
          >
            <LinkPending>{post.title}</LinkPending>
          </Link>
        </h2>

        {post.description && (
          <p className={`text-sm leading-relaxed text-secondary transition-opacity duration-200 ${featured ? "max-w-xl" : "line-clamp-2 opacity-80 group-hover:opacity-100"}`}>
            {post.description}
          </p>
        )}
        </div>
      </div>
    </article>
  );
}