-- 0002：给评论加「管理员徽标」开关。
--
-- 全新安装不需要跑这个——db/schema.sql 里已经包含 admin_badge。
-- 本文件只用于升级**已有数据**的库（CREATE TABLE IF NOT EXISTS 不会给
-- 已存在的表加列，所以必须单独 ALTER）。
--
-- 应用：
--   本地：npx wrangler d1 execute fbz-blog-comments --local  --file=db/migrations/0002-add-admin-badge.sql
--   线上：npx wrangler d1 execute fbz-blog-comments --remote --file=db/migrations/0002-add-admin-badge.sql

-- 1 = 在该条昵称旁显示金色「管理员」徽标，0 = 不显示。
--
-- 用 INTEGER 而不是 BOOLEAN：SQLite 没有布尔类型，存 0/1 是惯例做法，
-- 读出来直接是数字，前端不需要再解析 'true'/'false' 字符串。
--
-- DEFAULT 0 让已有数据自动落到「不显示」，不需要回填。
-- NOT NULL 是防呆：万一某条 INSERT 漏写这一列，宁可拿默认值，
-- 也不要出现 NULL —— 那样 `badge ? 显示 : 不显示` 的判断会依赖
-- NULL 的假值语义，读代码时容易看漏。
ALTER TABLE comments ADD COLUMN admin_badge INTEGER NOT NULL DEFAULT 0;
