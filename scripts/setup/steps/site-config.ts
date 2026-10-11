/**
 * 步骤 2：站点配置。问答收集站名/作者/域名等，模板化改写 src/lib/site.ts。
 * README 里承诺过「通常只需要改这一个文件」，向导替用户改。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_PROJECT_NAME,
  defaultSiteUrl,
  repoSlugFromUrl,
  slugifyId,
} from "../context";
import type { SetupStep } from "../types";

const SITE_FILE = join("src", "lib", "site.ts");
const TOML_FILE = "wrangler.toml";

/** site.ts 的可改字段。key 是 answers 的键名，prop 是 site.ts 里的属性名。 */
const FIELDS = [
  { key: "siteName", prop: "name", label: "站名", def: "我的博客", link: false, required: true },
  { key: "author", prop: "author", label: "作者名", def: "博主", link: false, required: true },
  { key: "description", prop: "description", label: "一句话简介", def: "记录技术、思考与生活。", link: false, required: false },
  { key: "siteUrl", prop: "url", label: "站点地址（站点元数据，用于 sitemap/页脚/评论白名单；部署地址由 Pages 项目名决定，不随这里变）", def: "", link: true, required: true },
  { key: "github", prop: "github", label: "GitHub 主页（回车跳过）", def: "", link: true, required: false },
  { key: "repo", prop: "repo", label: "源码仓库地址（fork 本项目后填你的仓库主页；AGPL 要求向访客提供源码，还没有就先去 github.com/fork）", def: "", link: true, required: true },
] as const;

/** 从 site.ts 源码里读某属性的当前值，当作问答默认值。 */
function readProp(source: string, prop: string): string {
  const re = new RegExp(`(?:^|[^\\w])${prop}:\\s*"([^"]*)"`, "m");
  return re.exec(source)?.[1] ?? "";
}

const checkHttp = (value: string): string | true =>
  /^https?:\/\//.test(value) ? true : "需要以 http(s):// 开头";

/** 非 link 字段也有自己的格式要求（预填路径同样会过这一关）。 */
const FIELD_VALIDATE: Partial<Record<(typeof FIELDS)[number]["key"], (v: string) => string | true>> = {
  siteName: (v) => (v.trim().length >= 2 ? true : "站名至少 2 个字符"),
  author: (v) => (v.trim().length >= 1 ? true : "作者名不能为空"),
};

/** Pages 项目名：决定部署地址 <项目名>.pages.dev，.pages.dev 子域全网唯一。 */
function validateProjectName(value: string): string | true {
  const slug = slugifyId(value);
  if (slug.length < 3 || slug.length > 30) {
    return "项目名需 3-30 位小写字母、数字或连字符";
  }
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) {
    return "只能用小写字母、数字和连字符，并以字母或数字开头结尾";
  }
  return true;
}

export const siteConfig: SetupStep = {
  id: "site-config",
  title: "站点配置",

  async probe(ctx) {
    const file = join(ctx.root, SITE_FILE);
    if (!existsSync(file)) {
      return { status: "pending", detail: "找不到 src/lib/site.ts" };
    }
    const name = ctx.state.answers.siteName;
    const siteMatches = Boolean(name) && readProp(readFileSync(file, "utf8"), "name") === name;
    // 项目名也核对：改了项目名重跑时不能误判已完成
    const tomlFile = join(ctx.root, TOML_FILE);
    const tomlName = existsSync(tomlFile)
      ? /^name\s*=\s*"([^"]+)"/m.exec(readFileSync(tomlFile, "utf8"))?.[1]
      : undefined;
    const projectMatches =
      !ctx.state.answers.projectName || tomlName === ctx.state.answers.projectName;
    if (siteMatches && projectMatches) {
      return { status: "done", detail: `站名「${name}」已配置` };
    }
    return { status: "pending", detail: "站点信息还是默认值" };
  },

  async run(ctx) {
    const file = join(ctx.root, SITE_FILE);
    if (!existsSync(file)) {
      throw new Error(`找不到 ${SITE_FILE}，请在仓库根目录运行 pnpm run setup`);
    }
    let source = readFileSync(file, "utf8");

    const answers: Record<string, string> = {};
    for (const field of FIELDS) {
      const current = readProp(source, field.prop);
      // 站点地址的特殊默认值：还没部署过时用户没有域名，直接给
      // https://<项目名>.pages.dev（部署后即可访问），用户回车确认即可
      const def =
        field.key === "siteUrl"
          ? ctx.state.answers.siteUrl ||
            (current && !current.includes("github.io") ? current : defaultSiteUrl(ctx.root))
          : ctx.state.answers[field.key] || current || field.def;
      answers[field.key] = await ctx.ask(field.key, field.label, {
        def,
        required: field.required,
        validate: field.link ? checkHttp : FIELD_VALIDATE[field.key],
      });
    }

    // Pages 项目名：出厂占位名全天下只有一个账号能用，必须按站点改掉。
    // 默认值优先级：上次的回答 > 用户自定义过的 toml 现值 > 按站点派生
    const tomlFile = join(ctx.root, TOML_FILE);
    const tomlName = existsSync(tomlFile)
      ? /^name\s*=\s*"([^"]+)"/m.exec(readFileSync(tomlFile, "utf8"))?.[1] ?? DEFAULT_PROJECT_NAME
      : DEFAULT_PROJECT_NAME;
    const derivedProject =
      repoSlugFromUrl(answers.repo) || slugifyId(answers.siteName) || "my-blog";
    const projectDef =
      ctx.state.answers.projectName ||
      (tomlName !== DEFAULT_PROJECT_NAME ? tomlName : derivedProject);
    answers.projectName = await ctx.ask(
      "projectName",
      "Pages 项目名（决定博客地址 <项目名>.pages.dev，全网唯一，撞名发布失败）",
      { def: projectDef, required: true, validate: validateProjectName },
    );

    // 归一化：全部去首尾空格；链接字段去掉尾部斜杠——ALLOWED_ORIGINS、
    // sitemap 等都按精确 origin 匹配，多一个 "/" 会让评论区静默失效
    for (const key of Object.keys(answers)) answers[key] = answers[key].trim();
    for (const key of ["siteUrl", "github", "repo"] as const) {
      answers[key] = answers[key].replace(/\/+$/, "");
    }
    answers.projectName = slugifyId(answers.projectName);
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(answers.projectName)) {
      throw new Error(
        "Pages 项目名派生后不合法，请手填一个（3-30 位小写字母、数字、连字符）",
      );
    }
    // 用户沿用了「按旧项目名预填」的默认站点地址时，跟着新项目名走
    if (answers.siteUrl === `https://${tomlName}.pages.dev` && answers.projectName !== tomlName) {
      answers.siteUrl = `https://${answers.projectName}.pages.dev`;
    }

    for (const field of FIELDS) {
      // 锚定「属性名: "..."」整体替换：$1 保留前缀与引号开头，$3 是收尾引号
      const re = new RegExp(`((?:^|[^\\w])${field.prop}:\\s*")([^"]*)(")`);
      if (!re.test(source)) {
        ctx.logger.warn(`site.ts 里找不到 ${field.prop} 字段，请手动填写后重跑本步骤`);
        continue;
      }
      // 替换值里的 $ 要转义成 $$，避免被当成捕获组引用
      const value = answers[field.key].replace(/\$/g, "$$$$");
      source = source.replace(re, `$1${value}$3`);
    }
    writeFileSync(file, source, "utf8");

    ctx.state.answers = { ...ctx.state.answers, ...answers };
    ctx.saveState();

    // Pages 项目名写入 wrangler.toml（决定部署地址，全网唯一）
    if (existsSync(tomlFile) && /^name\s*=\s*"[^"]*"/m.test(readFileSync(tomlFile, "utf8"))) {
      const toml = readFileSync(tomlFile, "utf8");
      writeFileSync(
        tomlFile,
        toml.replace(/^name\s*=\s*"[^"]*"/m, `name = "${answers.projectName}"`),
        "utf8",
      );
      ctx.logger.log(`Pages 项目名已写入 wrangler.toml：${answers.projectName}`);
    }
    return { detail: `site.ts 已更新：${answers.siteName}` };
  },
};
