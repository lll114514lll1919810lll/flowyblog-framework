/**
 * 文章数据的读取辅助（供 /api/admin/* 的 AI 相关接口共用）。
 *
 * Functions 运行在 Cloudflare Pages 上，没有文件系统，文章内容统一来自
 * 构建期生成的静态产物 /search-index.json（见 src/lib/search-index.ts），
 * 通过 Pages 的 ASSETS 绑定读取——线上和 wrangler pages dev 都有这个绑定。
 *
 * 读不到的失败方向统一为返回 null：文章信息是 AI 接口的「材料」之一，
 * 缺了不该把整个请求打成 500，调用方按各自需要降级。
 */

/**
 * 从搜索索引里取一篇文章的索引文档。
 * 返回 { slug, title, description, tags, sections, ... }（形状见 SearchDoc），
 * 找不到（无绑定 / 索引缺失 / 无此文）返回 null。
 */
export async function loadSearchDoc(env, url, slug) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") return null;
  try {
    const res = await env.ASSETS.fetch(new URL("/search-index.json", url));
    if (!res.ok) return null;
    const index = await res.json();
    const docs = Array.isArray(index?.docs) ? index.docs : [];
    return docs.find((d) => d && d.slug === slug) || null;
  } catch {
    return null;
  }
}
