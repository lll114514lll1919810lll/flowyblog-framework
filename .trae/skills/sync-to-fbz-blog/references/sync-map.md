# 框架 → 博客 同步映射

基于 2026-10-11 的全量文件哈希审计。

分叉结论：框架在分叉后的增量是「GitHub Pages 支持（`NEXT_PUBLIC_BASE_PATH` basePath 机制）+ 通用修复（test-toc 动态取样、process.exitCode 修复、背景图变量间接层）」；博客的增量全部是个人信息，或已被框架吸收的能力（图片 logo → `siteConfig.logo`）。框架当前是博客的**外观超集**。

## A 类：直接覆盖（框架 → 博客）

| 路径 | 说明 |
| --- | --- |
| `src/app/**`（除 `about/page.tsx`） | 框架含 basePath 支持与背景图变量间接层 |
| `src/app/globals.css` | 含 logo 图片形态样式（`.site-logo-badge` 的 `object-fit: cover`） |
| `src/components/**`（除 `post-card.tsx`） | 框架是超集；`site-logo.tsx` 吸收 logo 能力后也是 |
| `src/lib/**`（除 `site.ts`） | 内容层、主题、实验室、搜索索引等 |
| `src/mdx-components.tsx` | MDX 元素映射 |
| `functions/**`、`db/**` | 评论后端与 D1 迁移 |
| `scripts/test-toc.ts` | 博客版有硬编码 slug 和 `process.exit` 在 Windows 上的崩溃 bug，必须用框架版 |
| `scripts/check-theme.cjs`、`scripts/audit-ui.cjs` | audit-ui 的 PAGES 列表用框架动态示例文章路径即可 |
| `next.config.ts`、`postcss.config.mjs`、`tsconfig.json`、eslint 配置、`.dev.vars.example` | 对 Cloudflare 部署无副作用（GH Pages 分支只在对应环境变量下生效） |

**注意**：`src/components/site-logo.tsx` 覆盖到博客后，必须确认博客 `site.ts` 里有 `logo: "/site-logo.jpg"`，没有就补上（见 B 类的 site.ts 手工合并）。

## B 类：禁止覆盖（个人信息）

| 路径 | 内容 |
| --- | --- |
| `src/lib/site.ts` | 站名「风不止的个人博客」、作者、域名 `blog.mclll114.me`、仓库地址、CC BY-NC-SA 4.0 内容授权。框架新增配置字段（如 `logo`）时**手动合并**进去并填博客自己的值 |
| `src/content/**` | 博客的 8 篇真实文章；框架示例文章绝不带入博客 |
| `src/app/about/page.tsx` | 个人关于页 |
| `public/site-logo.jpg`、`public/images/**` | 个人图片资产 |
| `src/components/post-card.tsx` | cover-label 是个性化文案「风不止 / NOTES」（仅此一处差异，合并时保留） |
| `.dev.vars` | 密钥，永不进同步范围 |
| `README.md`、`AGENTS.md`、`CLAUDE.md`、`CONTENT-LICENSE.md`、`.trae/**`、`.preview/**`、`.wrangler/**` | 博客自有文档、规则与本地产物 |

## C 类：手工合并

| 路径 | 规则 |
| --- | --- |
| `wrangler.toml` | `database_id` 永远用博客自己的真实值；只把框架新增的键合并进去 |
| `package.json` | 保留博客的 `name`（fbz-personal-blog）；其余依赖变化正常合并，完成后 `pnpm install` |
| `.github/workflows/ci.yml` | 不整文件覆盖。框架 ci.yml 的构建参数带 `GITHUB_PAGES=true` 和 `NEXT_PUBLIC_BASE_PATH`，不适用于博客（Cloudflare 部署） |
| `.github/workflows/pages.yml` | **不要复制到博客**——博客不发布 GitHub Pages |
| `.gitignore` | 只补缺失条目 |

## 同步记录

- 2026-10-11 创建本技能；图片 logo 能力（`siteConfig.logo`）已吸收进框架。
- 2026-10-11 首次同步：10 个文件覆盖到博客，site.ts 手工加 `logo: "/site-logo.jpg"`；test-toc.ts 同步前发现断言与示例文章耦合，先在框架侧改为文章无关再同步。5 条红线全过（背景图、图片 logo、页脚/关于页署名、无框架示例文章、sitemap 域名 blog.mclll114.me）。博客提交 af75581。
