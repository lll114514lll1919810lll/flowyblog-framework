import { buildSearchIndex } from "@/lib/search-index";

/**
 * 站内搜索索引：构建期渲染成静态 JSON。
 *
 * force-static 让 Next 在 build 时执行这个 GET、把结果落成静态文件
 * （产物里就是一个普通的 /search-index.json），运行时不经过任何服务端逻辑。
 * 客户端只在用户第一次打开搜索时去 fetch 一次。
 */
export const dynamic = "force-static";

export function GET() {
  const index = buildSearchIndex();

  return new Response(JSON.stringify(index), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      // 内容只在重新构建时变化，交给 CDN/浏览器缓存
      "cache-control": "public, max-age=0, s-maxage=31536000, must-revalidate",
    },
  });
}
