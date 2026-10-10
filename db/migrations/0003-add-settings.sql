-- 0003：新增 settings 表，存放「后台可改、需要跨部署保留」的站点开关。
--
-- 全新安装不需要跑这个——db/schema.sql 里已经包含 settings。
-- 本文件只用于升级**已有数据**的库。
--
-- 应用：
--   本地：npx wrangler d1 execute fbz-blog-comments --local  --file=db/migrations/0003-add-settings.sql
--   线上：npx wrangler d1 execute fbz-blog-comments --remote --file=db/migrations/0003-add-settings.sql

-- 为什么用表而不是环境变量：
-- 环境变量（Pages 的 Settings → Environment variables）改了要重新部署才生效，
-- 而且 functions 里没有写入口——后台点一下开关必须当场落库。
--
-- 为什么是 key-value 而不是给每个开关加一列：
-- 加列每来一个开关都要改表、写迁移；key-value 只要新增一个键。
-- 站点级开关本来就少（目前只有一个），一行一条记录，读起来也不绕。
--
-- 刻意**不预插** comments_locked 记录：
-- 缺行按「未锁」处理（见 functions/_lib/api.js 的 commentsLocked），
-- 所以新库开箱即用、不用跑初始化脚本；开关只在被拨动时才落一条。
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  -- 一律存文本：SQLite 是动态类型，写死 INTEGER 反而限制以后的键
  -- （比如某天真要存一段字符串）。布尔用 "0"/"1"，读的人一眼能懂。
  value TEXT NOT NULL
);
