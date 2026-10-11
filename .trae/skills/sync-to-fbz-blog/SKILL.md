---
name: sync-to-fbz-blog
description: 把 flowyblog-framework 的框架改动合入真实博客 fbz-personal-blog 并保留博客全部个人信息。当用户要求同步框架改动到博客、合入上游、更新博客的框架代码时使用。不用于写文章或修改博客外观本身。
---

# 同步框架改动到真实博客

同步方向永远是 **框架 → 博客**，两个仓库都在本机：

- 上游框架：`c:\Users\Lecoo\source\repos\flowyblog-framework`（本仓库）
- 真实博客：`C:\Users\Lecoo\source\repos\fbz-personal-blog`

动手前先读 [references/sync-map.md](references/sync-map.md)——那里的文件分类基于 2026-10-11 的全量哈希审计，「禁止覆盖」清单是硬约束。

## 流程

1. **确认基线**。`git -C <博客路径> status` 必须干净。对每个候选文件用 `git diff --no-index <框架文件> <博客文件>` 看实际差异，不要靠猜、不要按时间戳推断。
2. **分类**。按 sync-map.md 把有差异的文件归入三类：
   - **A 直接覆盖**——框架是超集（含 basePath 支持、通用修复）
   - **B 禁止覆盖**——个人信息，同步中一个字节都不许改
   - **C 手工合并**——两边各有道理，逐块合并且保留博客侧内容
3. **执行**。A 类逐个 `Copy-Item`（保持相对路径）；C 类先合并好再复制合并结果，绝不整文件覆盖。
4. **同步后必做**：
   - `package.json` 有变化 → `pnpm install` 并一并提交 `pnpm-lock.yaml`
   - `pnpm typegen` → `pnpm typecheck` → `pnpm test`
   - 导出构建（博客走 Cloudflare 自定义域，**不带** `GITHUB_PAGES` / `NEXT_PUBLIC_BASE_PATH`）：`$env:NEXT_OUTPUT="export"; pnpm build`
   - 过一遍下面的回归红线
5. **提交**。用中文提交信息，一条提交一个主题。

## 回归红线（出现任何一条立即回滚）

- 首页/文章页背景图丢失
- 顶栏 logo 变回「圆形底 + 站名首字」文字形态（博客用图片 logo）
- 页脚署名、文章封面角标（cover-label「风不止 / NOTES」）变回框架默认文案
- 列表/标签/归档/搜索/sitemap 出现框架示例文章（`2-markdown-elements` 等）
- sitemap 域名不是 `blog.mclll114.me`

## 惯例：新差异先合入框架

发现某个文件两边都改过时，先把博客的改动**提炼成通用能力**合入框架，再走本流程同步——参考 2026-10-11 的做法：博客硬编码的图片 logo 被吸收为 `siteConfig.logo` 配置项。个人信息类的差异例外，那类永远留在 B 类清单里，不做抽象。

## 同步记录

每次同步完成后，在 references/sync-map.md 末尾追加一行：日期 + 同步范围 + 红线检查结果。
