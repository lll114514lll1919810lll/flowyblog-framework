/**
 * Setup 流程的类型契约 —— v0 CLI 与 v1 Web 向导共用的接口层。
 *
 * v1 的接入方式（留给未来的图形向导）：
 * 1. 每个步骤都是独立模块，实现 SetupStep；Web 层照着接口调用 probe/run，
 *    不需要理解 wrangler 细节；
 * 2. 交互一律走 ctx.ask()/ctx.confirm()，Web 层把用户在表单里填的内容
 *    塞进 answers 预填进来，步骤代码零改动地变成「无交互执行」；
 * 3. 进度通过 Logger.event() 的机器可读事件上报（setup-start /
 *    step-start / step-end / step-error / setup-end），Web 层订阅即可
 *    渲染实时进度，等价于 CLI 的 --json 模式；
 * 4. 状态持久化在 .setup/state.json（已 gitignore），Web 层可以据此
 *    渲染「哪些步骤已完成」的断点续装界面。
 *
 * 两条硬约定：
 * - probe() 永远检查真实状态（磁盘文件 / wrangler 输出），不信任 state
 *   里的记录——用户可能手动改过配置，state 只用来当默认值；
 * - run() 必须可重入：重复执行不产生重复副作用（建库前先查、schema 全部
 *   IF NOT EXISTS、密钥沿用已生成的），这是整个向导幂等性的基础。
 */

export type StepStatus = "done" | "pending";

/** probe 的结果：某一步当前的真实状态，done 时可被编排器跳过。 */
export interface StepProbe {
  status: StepStatus;
  /** 人类可读的补充说明，CLI 直接展示，Web 层原样透传。 */
  detail?: string;
}

/** 步骤执行结果。 */
export interface StepResult {
  /** 结构化产物（如 databaseId、生成的密钥键名），存进 state 供后续步骤引用。 */
  data?: Record<string, unknown>;
  /** 执行完的补充说明。 */
  detail?: string;
}

/** .setup/state.json 的结构。version 变更时需要写迁移逻辑。 */
export interface SetupState {
  version: 1;
  /** 每步的落盘记录：status + data。probe 才是权威，这里只做断点参考。 */
  steps: Record<
    string,
    { status: "done" | "skipped"; at: string; data?: Record<string, unknown> }
  >;
  /** 用户交互给出的配置答案（站名、域名等），重跑时作为默认值。 */
  answers: Record<string, string>;
  /**
   * 生成的密钥（ADMIN_KEY 等）。注意：state 里含密钥明文，.setup/ 已加入
   * .gitignore，绝不能提交或外发；deploy 步骤靠它回填线上环境变量。
   */
  secrets?: Record<string, string>;
}

/** 日志接口：v0 是控制台输出，v1 换成事件流推送即可，步骤代码不用改。 */
export interface Logger {
  log(message: string): void;
  warn(message: string): void;
  /** 机器可读事件（--json 模式 / v1 Web 向导订阅）。 */
  event(name: string, payload?: Record<string, unknown>): void;
}

/** 一个安装步骤。步骤之间不互相 import，只通过 ctx.state 传递产物。 */
export interface SetupStep {
  id: string;
  title: string;
  probe(ctx: SetupContext): Promise<StepProbe>;
  run(ctx: SetupContext): Promise<StepResult>;
}

export interface SetupContext {
  /** 仓库根目录（绝对路径）。 */
  root: string;
  /** 已加载的 .setup/state.json；改动后调用 saveState() 落盘。 */
  state: SetupState;
  /** 预填的答案（--answers / v1 表单）；有值时 ask()/confirm() 不再交互。 */
  answers: Record<string, string>;
  /** 非交互模式下缺答案直接报错而不是挂起等待。 */
  interactive: boolean;
  logger: Logger;
  emit(name: string, payload?: Record<string, unknown>): void;
  saveState(): void;
  /**
   * 问一个文本问题。answers[key] 有值时直接返回预填值；
   * validate 返回 string 视为错误提示，返回 true 视为通过。
   */
  ask(
    key: string,
    label: string,
    options?: {
      def?: string;
      required?: boolean;
      validate?: (value: string) => string | true;
    },
  ): Promise<string>;
  /** 二选一确认；answers[key]（"y"/"n"）有值时直接返回预填结果。 */
  confirm(key: string, label: string, def?: boolean): Promise<boolean>;
  /** 裸读一行输入，不走 answers 预填（仅编排器的重试/跳过菜单用）。 */
  raw(label: string): Promise<string>;
  /**
   * 执行 shell 命令（Windows 下自动走 shell，npx / pnpm 都能直接用）。
   * capture 默认 true（捕获输出便于解析）；capture=false 时输出直通终端，
   * 适合构建、部署这类需要看实时进度的长命令。
   */
  run(
    command: string,
    options?: { env?: Record<string, string>; capture?: boolean; input?: string },
  ): { code: number; stdout: string; stderr: string };
}
