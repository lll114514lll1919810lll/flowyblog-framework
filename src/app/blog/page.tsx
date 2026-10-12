import type { Metadata } from "next";
import { BlogListPage } from "@/components/blog-list-page";

export const metadata: Metadata = {
  title: "文章",
  description: "全部文章列表，按月归档，可按标签筛选。",
};

/** 第一页。分页后的页面在 /blog/page/[page]，与这里共用 BlogListPage */
export default function BlogPage() {
  return (
    <BlogListPage page={1} />
  );
}
