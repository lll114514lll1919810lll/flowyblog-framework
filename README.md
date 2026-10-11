# FlowyBlog Framework

FlowyBlog Framework 是一个使用 Next.js、TypeScript、Tailwind CSS 和 MDX 搭建的中文博客框架。页面静态导出后部署在 Cloudflare Pages，评论系统使用 Pages Functions + D1，内置明暗主题、阅读体验调节、全站搜索和一个可开关的「实验室」外观实验系统（含液态玻璃、书本模式、赛博朋克等）。

## 在线预览

本项目当前部署为无后端的静态 GitHub Pages：

<https://lll114514lll1919810lll.github.io/flowyblog-framework/>

GitHub Pages 构建会关闭依赖 Cloudflare Functions 的评论区。文章、搜索、主题和实验室等静态功能仍然可用。

## 功能一览

- **内容**：MDX 文章，自动生成列表、标签、按月归档、分页、RSS 式 sitemap
- **阅读体验**：目录侧栏（锚点高亮）、阅读进度条、上下篇导航、阅读时长估算、正文宽度可调、代码块复制按钮、表格横向滚动
- **外观**：明暗双主题（跟随系统 + 手动切换）、亚克力面板质感、程序化文章封面（基于 slug 确定性生成）
- **实验室**：`/lab` 页面提供一组外观实验开关（纯 CSS 令牌覆盖，不侵入组件代码），包括书本模式、赛博朋克、液态玻璃渲染器等
- **评论**：访客留言 + 管理员后台（管理留言、管理员徽章、全站评论锁），数据存在 Cloudflare D1
- **搜索**：构建期生成搜索索引（`/search-index.json`），顶栏快捷检索（`/` 或 `Ctrl K` 聚焦），独立 `/search` 页支持完整结果、标签筛选、URL 可分享与模糊回退

## 100% 免费

本博客的完整功能可以完全免费的部署在 Cloudflare 上，使用页面构建/数据库的免费额度。

## 建站正确流程（推荐）

推荐路径：**fork 仓库 → clone 到本地 → 跑 WebUI 向导 → 用 AI agent 日常维护**。不要直接下载源码压缩包开跑——fork 之后提交两个配置文件，仓库就变成你自己的站，同时满足 AGPL「向访客提供源码」的义务，还能随时 `git pull` 获取框架更新、走推送自动部署。

1. **Fork 本仓库**到你的 GitHub 账号（仓库页右上角 Fork）。
2. **Clone 到本地**：

   ```bash
   git clone https://github.com/你的用户名/你的仓库名
   cd 你的仓库名
   ```

3. **准备环境**：安装 [Node.js](https://nodejs.org) 20+，然后 `corepack enable` 启用 pnpm（或 `npm i -g pnpm`），再执行 `pnpm install`。
4. **跑 WebUI 向导**完成基础流程：

   ```bash
   pnpm run setup:ui
   ```

   按引导走完：站点配置（含 Pages 项目名）→ Cloudflare 授权 → 创建评论数据库 → 生成密钥 → 构建并发布。做完博客就上线了，地址是 `https://<项目名>.pages.dev`。全程幂等，中断重跑会跳过已完成的部分。
5. **写文章**：在 `src/content/` 新建 `序号-标题.mdx`（写法见下文「写文章」），写完回到向导重跑「构建并发布」即可上线。以后更新有两条路：重跑发布步骤（本地构建直传），或在 Cloudflare Pages 后台把项目连接到你的 Git 仓库，之后 push 即自动部署。
6. **强烈推荐在仓库目录跑一个 AI agent**（Trae、DSH、Claude Code 等均可）辅助写作和维护：让它先读 `README.md`、`src/lib/site.ts` 和 `src/content/` 里现有文章的写法，再替你写文章、改配置、确定个人文章协议等，改完提交推送（或重跑发布）。注意 `.setup/`（含密钥明文）和 `.dev.vars` 绝不能提交或外发。

## 快速开始

需要 Node.js 和 pnpm：

```bash
pnpm install
pnpm typegen   # 生成 Next.js 路由类型（PageProps / LayoutProps）
pnpm dev
```

打开 <http://localhost:3000> 查看站点。常用命令：

| 命令 | 用途 |
| --- | --- |
| `pnpm run setup` | 一键安装向导（配置站点 → Cloudflare 授权 → 建库 → 部署） |
| `pnpm run setup:ui` | 图形界面向导（本地 Web 页面，功能与 `setup` 相同） |
| `pnpm dev` | 启动开发服务器 |
| `pnpm build` | 执行生产构建 |
| `pnpm typegen` | 生成 Next.js 路由类型（`PageProps` / `LayoutProps`） |
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm lint` | ESLint 检查 |
| `pnpm test` | 检查文章目录锚点解析 |
| `pnpm test:theme` | 检查主题相关 CSS |
| `pnpm test:server` | 在 Windows 上启动测试服务器（可加端口参数，如 `pnpm test:server -- 3001`） |
| `pnpm preview:cf` | 用 wrangler 本地预览静态产物 + 评论接口 |

全新克隆后先跑 `pnpm typegen` 再 `pnpm typecheck`，否则路由类型还没生成，typecheck 会报 `Cannot find name 'PageProps'`。

## 改成自己的站

站名、作者、简介、域名、GitHub、导航和仓库地址全部集中在 `src/lib/site.ts`，通常只需要改这一个文件：

```ts
export const siteConfig = {
  name: "我的博客",        // 站点名，出现在顶栏、标题模板、读屏标签里
  author: "博主",          // 页脚版权、关于页
  description: "记录技术、思考与生活。",  // 页脚签名与站点描述
  url: "https://example.com",            // 正式域名，sitemap 用
  github: "https://github.com/your-name",
  repo: "https://github.com/your-name/your-blog",  // 源码仓库
} as const;
```

`LICENSE.codeUrl` 也在这个文件里，指向源码仓库。AGPL 第 13 条要求向网络使用者提供完整源码，页脚的「源码」链接指向仓库才算履行，部署后记得改成自己的仓库地址。

### 文章内容授权

框架不替你决定文章内容的授权。`src/lib/site.ts` 里 `LICENSE.content` 默认留空：页脚和关于页不会出现内容授权条目，法律上等于保留所有权利。想允许转载，填入协议名和链接即可（页脚、关于页会自动显示这一条），选 CC BY-NC-SA 4.0, CC BY 4.0 或其他你偏好的条款都行。

### 顶部站点标识

顶栏左上角默认是纯 CSS 渲染的「圆形底 + 站名首字」，自动取 `siteConfig.name` 的第一个字符，不依赖任何图片。想换成图片 logo，在 `src/lib/site.ts` 的 `siteConfig.logo` 填 public 下的图片路径（如 `"/site-logo.jpg"`）即可，圆形裁切由 `globals.css` 里的 `.site-logo-badge` 负责。

图片 logo 走 `next/image` 是安全的：导出构建会关闭优化器（`images.unoptimized`），图片直接输出原图路径。会静默 404 的是依赖 `/_next/image` 优化接口的写法——静态产物里不存在那个路由。改图片相关代码后务必跑一次导出构建验证。

## 写文章

在 `src/content/` 新建 `序号-标题.mdx` 文件。文件名就是文章 URL 的 slug，例如 `1-my-first-post.mdx` 对应 `/blog/1-my-first-post`。文章排序由 metadata 里的 `date`（可选 `publishedAt`）倒序决定，文件名的序号只影响 slug、不影响排序。

```mdx
export const metadata = {
  title: "文章标题",
  date: "2026-10-11",
  publishedAt: "2026-10-11T20:30",
  description: "一句话摘要",
  tags: ["示例"],
  draft: false,
}

正文从这里开始。文章页会自动渲染标题、日期、阅读时长、标签和目录。
```

注意：

- `date` 必填，格式 `YYYY-MM-DD`；同一天多篇可用 `publishedAt` 精确排序。
- `draft: true` 的文章不出现在列表和静态构建结果中。
- 元信息用 MDX 的 `export const metadata`，不是 YAML frontmatter。
- 不要在正文开头再写一级标题（`#`），文章页已经用 `metadata.title` 渲染了；目录只收录 `##` 和 `###`。
- 支持 GFM 表格、任务列表、代码块和 JSX；表格自动包裹横向滚动容器。
- 标题里的行内代码会正确生成锚点（反引号会被剥掉再算 slug）。
- 图片放 `public/images/`，正文用绝对路径引用，`alt` 必须写。
- `src/content/` 随附一组示例文章（`1-` 到 `10-`），覆盖常用排版元素、metadata 字段、MDX 高级用法、部署、主题与同日排序，`1-draft-example` 演示草稿（不会出现在站点上）。跑通后可整批删除。

## 目录结构

```text
src/
├── app/          页面和路由（首页、文章、标签、归档、lab、about、admin）
├── components/   站点外壳、文章、目录、搜索、评论、液态玻璃渲染器等组件
├── content/      MDX 文章
├── lib/          文章读取、站点配置、主题、实验室开关、阅读宽度等工具
└── app/globals.css  全局样式令牌、主题变量、实验室样式、文章排版
functions/        Cloudflare Pages Functions（评论和管理接口）
db/               D1 数据库结构与迁移
scripts/          测试与审计脚本
public/           背景图和其他静态资源
.github/          CI（全新安装 + 静态导出 + 产物断言）
```

## 主题与实验室

明暗主题通过 `<html data-theme>` 驱动，`src/lib/theme.ts` 的内联脚本在首次绘制前写好属性。

实验室开关通过 `<html data-labs>` 传递，配置在 `src/lib/labs.ts`，样式全部以 CSS 变量/选择器的形式集中在 `globals.css`，不修改组件代码。新增实验的路径：在 `labs.ts` 注册开关 → 在 `globals.css` 加对应令牌覆盖。个别实验有已知的兼容限制（如书本模式与液态玻璃同时开启时液态玻璃不生效；赛博朋克锁定夜间模式），说明写在 `/lab` 页面上。

## 部署

### 一键向导（推荐）

不想手动执行下面的步骤时，直接运行（必须带 `run`——裸 `pnpm setup` 是 pnpm 的内建命令，会被它拦截）：

```bash
pnpm run setup
```

向导会依次完成：站点信息配置（自动改写 `src/lib/site.ts`）→ 环境检测 → Cloudflare 登录 → 创建并初始化 D1 → 生成密钥写入 `.dev.vars` → 静态导出并发布到 Cloudflare Pages（含评论区）。全程幂等，中断后重跑会自动跳过已完成的步骤。

也支持非交互参数（自动化与图形界面复用同一套步骤）：

```bash
pnpm run setup --answers answers.json   # 预填答案，跳过提问
pnpm run setup --step deploy            # 只跑某一步（--list 查看全部步骤）
pnpm run setup --json                   # JSON 事件流输出，供上层界面订阅
```

### 手动部署

页面构建为纯静态文件后交给 Cloudflare Pages（构建输出目录设为 `out`）：

```bash
# PowerShell
$env:NEXT_OUTPUT="export"; pnpm build

# Bash
NEXT_OUTPUT=export pnpm build
```

本地 `pnpm dev` 不加这个变量，行为和普通 Next.js 开发一致；导出模式下 `next/image` 优化器会被关闭，改图片相关代码后务必跑一次导出构建验证。仓库中的 CI 会依次执行依赖安装、类型生成、类型检查、lint、静态导出和产物断言，本地拿不准时以 CI 为准。

### GitHub Pages

仓库已配置 `.github/workflows/pages.yml`，推送到 `main` 后会自动构建并发布到 GitHub Pages。项目站点的 basePath 由工作流按仓库名自动派生（`NEXT_PUBLIC_BASE_PATH=/${{ github.event.repository.name }}`，CI 与生产构建同源），fork 或仓库改名后不需要改任何文件；部署到自己的项目仓库时，只需更新 `src/lib/site.ts` 中的站点地址。

### 评论与后台

评论数据存 Cloudflare D1，绑定名必须是 `DB`（`functions/` 里用的就是 `env.DB`，见 `wrangler.toml`）。全新部署：

```bash
# 1. 创建数据库并初始化表结构（数据库 ID 填回 wrangler.toml）
npx wrangler d1 create fblog-comments
npx wrangler d1 execute fblog-comments --remote --file=db/schema.sql

# 2. 在 Cloudflare Pages 项目里配置环境变量（见下表）

# 3. 推送触发构建
```

环境变量（键名必须与 `functions/` 里的引用一致，本地开发写在
`.dev.vars`，从 `.dev.vars.example` 复制，不要提交到仓库）：

| 键 | 用途 |
| --- | --- |
| `ADMIN_KEY` | 管理后台登录密钥 |
| `SESSION_SECRET` | 管理会话签名密钥 |
| `IP_SALT` | 评论者 IP 哈希的盐 |
| `ALLOWED_ORIGINS` | 允许调用评论接口的来源（逗号分隔） |

本地预览评论接口：

```bash
npx wrangler d1 execute fblog-comments --local --file=db/schema.sql
pnpm preview:cf
```

- 管理员登录 `/admin` 后可管理留言、给留言挂「管理员」徽标、用「接受新评论」开关锁全站评论。锁的状态存在 D1 的 `settings` 表里。
- 后台入口在页脚，只有已登录的管理员能看到；登录页是 `/adminlogin`。
- 已有旧版本数据库需要按顺序补跑 `db/migrations/` 下的迁移（本地加 `--local`，线上加 `--remote`），漏跑 `0003-add-settings.sql` 会让评论锁显示「状态未知」。

## 第三方组件

液态玻璃渲染器的来源、协议和对上游的改动记录在 [src/components/liquid-glass/README.md](./src/components/liquid-glass/README.md)。其余依赖见 `package.json`，全部为 AGPL 兼容协议（MIT/BSD/Apache-2.0）。

## 授权

| 范围 | 协议 |
| --- | --- |
| 主题、组件、配置和脚本等源码 | [AGPL-3.0](./LICENSE) |
| `src/content/` 中的文章正文 | 框架不声明，由使用者自定（`src/lib/site.ts` 的 `LICENSE.content`，留空即不显示） |
| `src/components/liquid-glass/`（第三方） | [AGPL-3.0](https://github.com/martin65536/liquid-glass-webgl) |

源码可以修改和商用，但衍生作品要同样开源，并且通过网络提供服务时要把源码提供给使用者。代码是 AGPL 的原因：框架集成了 [liquid-glass-webgl](https://github.com/martin65536/liquid-glass-webgl)（AGPL-3.0）的液态玻璃渲染器，AGPL 的源码公开义务覆盖整个服务，不能只把那一个组件单独标注，因此全站源码按 AGPL-3.0 发布。