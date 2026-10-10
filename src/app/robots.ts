import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site";

/*
 * 静态导出（output: "export"）下，sitemap.xml / robots.txt 这类元数据路由
 * 必须显式声明为静态，否则构建会直接失败：
 * "export const dynamic = 'force-static' not configured on route ..."。
 * 它们本身不读请求，靠的是这个标记告诉 Next 可以预渲染成文件。
 */
export const dynamic = "force-static";

/**
 * 构建期生成 robots.txt。
 *
 * 和 sitemap.ts 一样从 siteConfig.url 取域名，只有一个来源。
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteConfig.url;

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      /*
       * 管理后台与登录页禁止收录。
       *
       * 「没放入口链接」不等于搜索引擎找不到——只要任何一处外链指向它，
       * 爬虫就会跟过来。robots 是第一道，页面上的 noindex 是第二道
       * （robots 只约束守规矩的爬虫，noindex 才是真正的「别收录」信号）。
       */
      disallow: ["/admin", "/adminlogin"],
    },
    // 本地开发时 url 为空，就不写这一行，省得生成一个指向
    // localhost 的 sitemap 地址让爬虫去抓
    ...(base ? { sitemap: `${base}/sitemap.xml` } : {}),
  };
}