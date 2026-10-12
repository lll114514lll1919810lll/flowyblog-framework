import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * 给 public 下的静态资源路径拼一个版本号（文件内容哈希），用于缓存失效。
 *
 * 覆盖同名文件时 URL 不变，各层缓存会继续给旧图：本地图片走 next/image
 * 优化器（实测缓存 4 小时，还落盘在 .next/cache/images），线上静态导出是
 * 原图直出，浏览器和 CDN 也按 URL 缓存。把内容哈希拼成查询串后，文件一改
 * URL 就变，缓存自然失效——不用每次换图都改文件名。
 *
 * 为什么用内容哈希而不是 mtime：CI（GitHub Actions / Cloudflare Pages）
 * 每次都是全新 checkout，所有文件的 mtime 是检出那一刻、且逐次构建都不同
 * ——mtime 版本号会让每次部署的全部资源 URL 都变，缓存全量作废，与
 * 「改了哪个文件哪个 URL 变」的目的正相反。内容哈希只在文件内容变化时
 * 改变，跨机器构建也稳定。
 *
 * 传进来的必须是「相对 public 的路径」，不要带 basePath：
 * 文件系统的位置是 public/<路径>，basePath 只在浏览器那一侧有意义，
 * 由调用方自己加在前面（用下面的 withBasePath）。
 *
 * 外链（不以 / 开头）原样返回；public 下不存在的路径也保持原样，
 * 不硬造一个查不到的版本号（那样反而会让 next/image 报错）。
 *
 * 注意：这个模块用了 node:fs，只能被服务端代码引用。
 */
const PUBLIC_DIR = path.join(process.cwd(), "public");

/** 同一构建内同一文件只哈希一次：getAllPosts 每个页面都会重复解析封面路径 */
const versionCache = new Map<string, string>();

export function withAssetVersion(urlPath: string): string {
  if (!urlPath.startsWith("/")) return urlPath;
  const cached = versionCache.get(urlPath);
  if (cached) return `${urlPath}?v=${cached}`;
  try {
    const hash = createHash("sha1")
      .update(fs.readFileSync(path.join(PUBLIC_DIR, urlPath)))
      .digest("hex")
      .slice(0, 10);
    versionCache.set(urlPath, hash);
    return `${urlPath}?v=${hash}`;
  } catch {
    return urlPath;
  }
}

/**
 * 给「相对 public 的路径」拼上子路径部署的 basePath。
 *
 * 为什么要手动拼：next/image 在默认（优化）模式下会自动给本地图加
 * basePath，但静态导出开了 images.unoptimized 之后 src 原样直出，
 * 那层自动拼接就没了——GitHub Pages 这类子路径部署下，
 * /images/xxx.png 会指到域名根上去，全部 404。
 * 背景图（layout.tsx 的 url()）走的是 CSS 变量，从一开始就手动拼，
 * 这里把同样的规则抽出来给 <Image> 的调用方用。
 *
 * basePath 唯一来源是 NEXT_PUBLIC_BASE_PATH（见 next.config.ts）；
 * 不设置就是根路径部署，原样返回。
 */
export function withBasePath(urlPath: string): string {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${urlPath}`;
}
