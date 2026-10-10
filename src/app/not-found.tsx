import Link from "next/link";

/**
 * 全站 404 页。
 *
 * Next 的默认 404 只有一行英文「This page could not be found.」，
 * 和中文站的调性完全不搭，也没有任何出路——访客只能自己按后退。
 * 这里给出原因猜测和三个出口，让它变成一个正常的落地页。
 *
 * 静态导出下这个文件会生成 out/404.html，Cloudflare Pages 在找不到
 * 对应资源时自动回落到它。
 */
export default function NotFound() {
  return (
    <div className="flex flex-col gap-8">
      <section className="panel panel-strong flex flex-col gap-6 px-7 py-10 sm:px-10 sm:py-12">
        <p className="eyebrow">ERROR 404</p>

        <div>
          {/* 大号数字只作装饰：读屏念「四〇四」没有意义，
              真正的信息在下面的标题里 */}
          <p
            aria-hidden
            className="text-6xl font-bold leading-none tracking-tight text-muted/35 sm:text-7xl"
          >
            404
          </p>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
            这个页面不存在
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-secondary">
            地址可能打错了，或者这篇文章已经改名、删除了。
          </p>
        </div>

        <nav aria-label="出口" className="flex flex-wrap gap-3">
          <Link href="/" className="btn-pill">
            ← 回首页
          </Link>
          <Link href="/blog" className="btn-pill">
            看看全部文章
          </Link>
          <Link href="/tags" className="btn-pill">
            按标签浏览
          </Link>
        </nav>
      </section>

      <section className="panel flex flex-col gap-2 px-5 py-5 sm:px-6">
        <p className="eyebrow">TIP</p>
        <p className="text-sm leading-relaxed text-secondary">
          想找某篇文章，按{" "}
          <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 text-xs">
            /
          </kbd>{" "}
          打开站内搜索，标题和正文里的词都能搜到。
        </p>
      </section>
    </div>
  );
}
