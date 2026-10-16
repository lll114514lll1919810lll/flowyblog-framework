-- 0004：comments 表新增 approved 列，支持「审核模式」
-- （后台开启后，新评论须管理员审核通过才对外可见）。
--
-- 全新安装不需要跑这个——db/schema.sql 里已经包含 approved。
-- 本文件只用于升级**已有数据**的库。
--
-- 应用：
--   本地：npx wrangler d1 execute fblog-comments --local  --file=db/migrations/0004-add-approved.sql
--   线上：npx wrangler d1 execute fblog-comments --remote --file=db/migrations/0004-add-approved.sql

-- 默认值 1（= 通过）：迁移前发表的评论本来就是可见的，必须原样保留。
-- SQLite 允许 ADD COLUMN 带 NOT NULL DEFAULT（常量默认值会直接用于存量行）。
ALTER TABLE comments ADD COLUMN approved INTEGER NOT NULL DEFAULT 1;

-- 不加 approved 索引：待审核查询（WHERE approved = 0）只出现在管理后台，
-- 个人博客数据量小，全表扫描可接受，省一次迁移复杂度。
