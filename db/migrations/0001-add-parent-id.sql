-- 0001：为评论增加回复关系。
--
-- 全新安装不需要跑这个——db/schema.sql 里已经包含 parent_id。
-- 本文件只用于升级**已有数据**的库（CREATE TABLE IF NOT EXISTS 不会给
-- 已存在的表加列，所以必须单独 ALTER）。
--
-- 应用：
--   本地：npx wrangler d1 execute fbz-blog-comments --local  --file=db/migrations/0001-add-parent-id.sql
--   线上：npx wrangler d1 execute fbz-blog-comments --remote --file=db/migrations/0001-add-parent-id.sql

-- parent_id 为 NULL 表示顶层留言；非空表示所回复的顶层留言 id。
-- 允许 NULL，所以已有数据不需要回填。
ALTER TABLE comments ADD COLUMN parent_id INTEGER;

-- 删除顶层留言时要级联删掉回复，按 parent_id 找子项需要索引。
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments (parent_id);
