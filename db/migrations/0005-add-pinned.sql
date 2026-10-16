-- 0005：comments 表新增 pinned 列，支持「评论置顶」
-- （置顶池展示在评论区最前，带 TOP 标记；仅顶层留言可置顶）。
--
-- 全新安装不需要跑这个——db/schema.sql 里已经包含 pinned。
-- 本文件只用于升级**已有数据**的库。
--
-- 应用：
--   本地：npx wrangler d1 execute fblog-comments --local  --file=db/migrations/0005-add-pinned.sql
--   线上：npx wrangler d1 execute fblog-comments --remote --file=db/migrations/0005-add-pinned.sql

-- 默认值 0（= 非置顶）：迁移前的评论本来就都在普通时间流里。
ALTER TABLE comments ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;

-- 不加 pinned 索引：置顶池的筛选发生在前端分组（公开 GET 本来就按 page
-- 取整页评论），后端没有独立的「只查置顶」查询路径，无从受益。
