import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchPage } from "@/components/search-page";

export const metadata: Metadata = {
  title: "搜索",
  description: "全文搜索站内的文章。",
};

export default function Page() {
  /*
    静态导出（output: export）在构建时会预渲染这个页面，而 useSearchParams
    依赖运行时的 URL——不包 Suspense 的话预渲染阶段直接报错。
    这里只包一层最薄的兜底：搜索页本体 hydrate 很快，兜底几乎不会露面。
  */
  return (
    <Suspense fallback={<p className="text-sm text-muted">正在加载搜索页…</p>}>
      <SearchPage />
    </Suspense>
  );
}
