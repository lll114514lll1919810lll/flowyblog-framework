/**
 * 步骤 4：D1 数据库。创建数据库 → 把 database_name / database_id 回填
 * wrangler.toml → 执行 db/schema.sql 初始化表结构。
 *
 * 数据库名按站点派生：优先取源码仓库名（ASCII、天然唯一），站名兜底，
 * 避免所有站点都叫 fblog-comments 在同一 Cloudflare 账号下撞名。
 * 如果 wrangler.toml 里已有自定义名（≠ 出厂占位名），尊重不覆盖。
 *
 * 幂等性：schema.sql 全部 IF NOT EXISTS（见该文件头注释），重复执行安全；
 * 库已存在（wrangler 报 already exists）时改为让用户粘贴现有 database_id。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertShellSafeName,
  humanizeCloudflareError,
  repoSlugFromUrl,
  slugifyId,
} from "../context";
import type { SetupContext, SetupStep } from "../types";

const TOML_FILE = "wrangler.toml";
/** wrangler.toml 里出厂占位的 database_id，见到它就说明还没真正建库。 */
const PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";
/** 出厂占位的数据库名；见到它就按站点重新派生。 */
const DEFAULT_DB_NAME = "fblog-comments";
/** D1 库名上限 32 字符，给 "-comments" 后缀留出余量。 */
const DB_NAME_MAX = 32;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function readToml(ctx: SetupContext): string {
  const file = join(ctx.root, TOML_FILE);
  if (!existsSync(file)) throw new Error(`找不到 ${TOML_FILE}，请在仓库根目录运行 pnpm run setup`);
  return readFileSync(file, "utf8");
}

function readDbConfig(text: string): { name: string; id: string } {
  const block = /\[\[d1_databases\]\][\s\S]*/.exec(text)?.[0] ?? "";
  return {
    name: /database_name\s*=\s*"([^"]+)"/.exec(block)?.[1] ?? DEFAULT_DB_NAME,
    id: /database_id\s*=\s*"([^"]+)"/.exec(block)?.[1] ?? "",
  };
}

function writeTomlValue(
  ctx: SetupContext,
  text: string,
  field: "database_name" | "database_id",
  value: string,
): string {
  const re = new RegExp(`(${field}\\s*=\\s*")[^"]*(")`);
  if (!re.test(text)) {
    throw new Error(`wrangler.toml 里找不到 ${field} 字段，请手动填写后重跑本步骤`);
  }
  // 用替换函数而不是 "$1<value>$2"：值里若含 $ 字符（如 UUID 之外的
  // 自定义串），字符串形式的 replacement 会把 $1、$& 之类的序列当成
  // 捕获组引用，导致新旧值拼接。函数形式原样插入，无需转义。
  const updated = text.replace(re, (_match, head: string, tail: string) => `${head}${value}${tail}`);
  writeFileSync(join(ctx.root, TOML_FILE), updated, "utf8");
  ctx.logger.log(`${field} 已写入 wrangler.toml`);
  return updated;
}

/**
 * 按站点派生数据库名：<站点标识>-comments。
 * 站点标识优先用 Pages 项目名（站点配置步已按站点派生），其次源码仓库名，
 * 站名兜底。D1 库名上限 32 字符，超长截断并去掉尾部连字符。
 */
function deriveDbName(ctx: SetupContext): string {
  const project = slugifyId(ctx.state.answers.projectName ?? "").replace(/-comments$/, "");
  const repoSlug = repoSlugFromUrl(ctx.state.answers.repo ?? "");
  const siteSlug = slugifyId(ctx.state.answers.siteName ?? "");
  const base = project || repoSlug || siteSlug || "blog";
  const safe = /^[a-z]/.test(base) ? base : `blog-${base}`;
  return `${safe}-comments`.slice(0, DB_NAME_MAX).replace(/-+$/g, "");
}

export const d1Init: SetupStep = {
  id: "d1-init",
  title: "创建评论数据库（D1）",

  async probe(ctx) {
    const db = readDbConfig(readToml(ctx));
    if (db.id && db.id !== PLACEHOLDER_ID) {
      return { status: "done", detail: `D1「${db.name}」已创建` };
    }
    return { status: "pending", detail: "wrangler.toml 还是占位 database_id" };
  },

  async run(ctx) {
    let text = readToml(ctx);
    let name = readDbConfig(text).name;
    let id = readDbConfig(text).id;
    // 名字会被原样拼进 shell 命令（可能来自用户手改的 toml），先过白名单
    assertShellSafeName(name, "D1 数据库名");

    if (!id || id === PLACEHOLDER_ID) {
      // 占位名 → 按站点派生并回填；用户自定义过的名字不动。
      // 只在「即将新建」时改名：库已存在时名字必须和真实库保持一致。
      if (name === DEFAULT_DB_NAME) {
        const derived = deriveDbName(ctx);
        if (derived !== name) {
          text = writeTomlValue(ctx, text, "database_name", derived);
          name = derived;
        }
      }
      const go = await ctx.confirm(
        "d1Create",
        `将在 Cloudflare 创建 D1 数据库「${name}」（免费额度内），是否继续？`,
      );
      if (!go) {
        throw new Error(`已取消。也可以手动执行：npx wrangler d1 create ${name}`);
      }

      ctx.logger.log("创建数据库中…");
      const created = ctx.run(`npx wrangler d1 create ${name}`);
      if (created.code !== 0 && /already exists/i.test(created.stderr + created.stdout)) {
        // 库是用户手动建过的：不重复建，改为人工回填 ID
        id = await ctx.ask(
          "d1ExistingId",
          `数据库「${name}」已存在，请粘贴它的 database_id（dash.cloudflare.com → 存储和数据库 → D1）`,
          { required: true, validate: (v) => (UUID.test(v) ? true : "看起来不是合法的 UUID") },
        );
        text = writeTomlValue(ctx, text, "database_id", id);
      } else if (created.code !== 0) {
        const tail = (created.stderr || created.stdout).trim().split(/\r?\n/).slice(-3).join(" ");
        const reason = tail
          ? humanizeCloudflareError(tail)
          : "未知错误（检查是否完成 Cloudflare 授权）";
        throw new Error(`创建 D1 失败：${reason}`);
      } else {
        // wrangler 创建成功后会把可粘贴的配置块打在 stdout 里
        id =
          /database_id\s*=\s*"([^"]+)"/.exec(created.stdout)?.[1] ??
          UUID.exec(created.stdout)?.[0] ??
          "";
        if (!id) {
          throw new Error("无法从 wrangler 输出解析 database_id，请手动把 ID 填入 wrangler.toml 后重跑本步骤");
        }
        text = writeTomlValue(ctx, text, "database_id", id);
      }
    }

    ctx.logger.log("初始化表结构（IF NOT EXISTS，可重复执行）…");
    const schema = ctx.run(
      `npx wrangler d1 execute ${name} --remote --file=db/schema.sql`,
      { capture: false },
    );
    if (schema.code !== 0) {
      throw new Error("初始化 D1 表结构失败，请检查网络后重试本步骤。");
    }
    return { data: { databaseId: id, databaseName: name }, detail: `D1「${name}」就绪` };
  },
};
