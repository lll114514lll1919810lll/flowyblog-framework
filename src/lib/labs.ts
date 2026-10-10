/**
 * 实验室：一组可以单独开关、或者从几个档位里选一个的外观实验。
 *
 * 和明暗主题（lib/theme.ts）刻意同构，但分工不同：
 *
 *   主题是「二选一的常态」，写死在 CSS 的两套令牌里，全站任何时刻都生效；
 *   实验是「临时的」，默认全关，只在用户自己打开后才生效，而且随时可能
 *   改效果、改名或整个下线——所以这里的每个实验都不允许被业务样式依赖
 *   （组件里不应该出现「如果开了某某实验就……」的判断）。
 *
 * 状态的唯一落点是 <html> 上的属性，每个实验一个：
 *
 *   data-lab-flat="on"      开关型：开 = "on"
 *   data-lab-corners="round"  档位型：值就是选项的 value
 *
 * 默认档不写属性（属性不存在 = 默认），CSS 只需要为「非默认」写规则。
 * localStorage 只是「下次进站还记得」，不是渲染依据——所以开关状态必须由
 * 内联脚本在首次绘制前写好，否则用户开了实验之后每次刷新都会先闪一帧默认外观。
 *
 * 实验是纯装饰的：不写进 URL、不进导航、不影响内容，
 * 全部关掉之后站点必须回到和没装过实验室时一模一样的样子。
 */

export type LabId =
  | "flat"
  | "outline"
  | "typewriter"
  | "book"
  | "cyberpunk"
  | "liquidglass"
  | "corners";

/**
 * 互斥组的 id。
 *
 * 一组实验只能开一个，原因很实际：同组的实验写的是同一批令牌
 * （比如「实底」和「描边」都要决定面板底色长什么样），同时开着
 * 只能靠 CSS 的先后顺序分胜负，结果既不可预期也说不清。
 * 所以互斥不是交互上的约束，而是「这组实验本来就回答同一个问题」。
 *
 * 两组回答的是不同的问题，因此跨组可以自由组合：
 *   material —— 外观材质：底色、强调色、字体这类「整体长相」（实底、
 *               描边、书本、赛博朋克）；
 *   surface  —— 面板材质：面板表面是什么（亚克力 / 玻璃），只看
 *               背景图和令牌结构，跟整体长相是两件事。
 */
export type LabGroupId = "material" | "surface";

export const LAB_GROUPS: Record<LabGroupId, { label: string; hint: string }> = {
  material: {
    label: "外观材质",
    hint: "同一组里只能开一个：再开另一个，前一个会自动关掉。",
  },
  surface: {
    label: "面板材质",
    hint: "与上面的外观材质互不相干，可以自由组合。随便自由组合可能导致糟糕的后果，比如 ⌈液态玻璃⌋ + ⌈书本⌋ + 浅色模式 。不信可以试试。",
  },
};

/**
 * 不属于任何互斥组的那一段。
 *
 * 它不是「一组」，放在这里只是为了让页面上每一段都有标题：
 * 没有标题时，这些行紧跟在互斥组下面、样式又完全一样，
 * 读起来像是上一组的成员（用户就是这么误读的）。
 */
export const LAB_SOLO = {
  label: "独立实验",
  hint: "不和任何实验互斥，可以和上面任意一项同时开。",
} as const;

/**
 * 需要跑一段客户端代码才生效的实验。
 *
 * 前面那些实验都是纯 CSS：属性一写，样式立刻跟上，连内联脚本都省了。
 * 但有些效果没法用 CSS 表达——WebGL 着色器、canvas、第三方库都属于这一类。
 * 它们的状态仍然是普通开关（一样存 localStorage、一样写 data-lab-*），
 * 区别只在于「谁来兑现这个状态」：CSS 兑现不了的，就由
 * components/lab-runtimes.tsx 按这个字段挂载对应的运行时。
 *
 * 这类实验有两个天然代价，写实验时必须交代清楚：
 *   1. 生效不是即时的，要从网络/主线程里把代码跑起来（几秒）。
 *   2. 可能失败（没有 WebGL、库抛错），此时的降级就是「什么都没发生」，
 *      页面必须仍然可用——所以运行时代码一律不能改坏默认外观。
 */
export type LabRuntimeId = "liquidglass";

export type LabOption = {
  /** 写进属性、存进 localStorage 的值。空串表示「默认档」，即不写属性 */
  value: string;
  label: string;
};

type LabBase = {
  id: LabId;
  /** 控件旁边显示的名字，两到四个字，说清它改的是哪一类东西 */
  label: string;
  /** 一句话说明改了什么。写「变成什么样」，不写「优化了体验」 */
  description: string;
  /** 已知代价或适用边界。没有就留空，不要编 */
  caveat?: string;
  /**
   * 一句话的劝退提示：这条实验值不值得开。
   *
   * 渲染成加粗的金色，是这一行里最抢眼的东西，所以只留给「真别抱期待」的
   * 那种实验——普通的边界说明写 caveat 就够了，滥用会让整页都在喊狼来了。
   * 金色是站点里唯一的暖色（也是管理员徽标用的那枚），拿它当警告色不用新开颜色。
   */
  warning?: string;
  /** 归入某个互斥组。不填 = 独立实验，可以和在场的任何实验共存 */
  group?: LabGroupId;
  /** 需要客户端运行时才能生效的实验，见 LabRuntimeId */
  runtime?: LabRuntimeId;
};

/** 开关型：只有开和关两态 */
export type LabSwitch = LabBase & { kind: "switch" };

/**
 * 档位型：从固定几档里选一个，不是布尔量。
 *
 * 为什么档位只支持「枚举」而不支持滑块那种连续值：外观是靠 CSS 的
 * 属性选择器（[data-lab-x="值"]）驱动的，每个可能的值都得在样式表里
 * 写成一条规则。连续值没法穷举，要么退化成 JS 直接改内联样式、
 * 要么就得把 CSS 变量写进 style 属性——两条路都会让「样式由属性决定」
 * 这条规矩破一个口子。真要连续量，先在这里加一种新的 kind 再谈。
 */
export type LabChoice = LabBase & {
  kind: "choice";
  options: readonly LabOption[];
};

export type Lab = LabSwitch | LabChoice;

/**
 * 实验清单。加一个实验 = 这里加一项 + globals.css 里加一段
 * :root[data-lab-<id>="<值>"] 的覆盖规则。其它地方都不用动。
 *
 * 顺序就是页面上的顺序；同一组的成员会被页面自动聚到一个小标题下。
 */
export const LABS: readonly Lab[] = [
  {
    kind: "switch",
    id: "flat",
    group: "material",
    label: "实底",
    description: "面板换成不透明实底，去掉毛玻璃、顶部高光和投影。",
    caveat: "背景图会被面板完全盖住。",
  },
  {
    kind: "switch",
    id: "outline",
    group: "material",
    label: "描边",
    description: "面板几乎透明，只留一圈描边把边界画出来。",
    caveat: "文字直接压在背景图上，遇到花的背景可能不好读。",
  },
  {
    kind: "switch",
    id: "book",
    group: "material",
    label: "书本",
    description:
      "去掉背景图：浅色换成米黄纸面、深色换成深灰纸面，全站改用宋体和 Times New Roman，代码块保持等宽。",
    caveat:
      "中文宋体用的是系统自带字体（Windows 是中易宋体、macOS 是宋体-简），小字号会显得偏细；与「液态玻璃」同开时，玻璃没有背景图可折射，不会生效。",
  },
  {
    kind: "switch",
    id: "cyberpunk",
    group: "material",
    label: "赛博朋克",
    description:
      "深蓝黑底、霓虹青强调色、选中文字浮夸品红，面板描边带一点青光。锁定夜间模式：主题开关在这条实验开着时不生效。",
  },
  {
    kind: "switch",
    id: "liquidglass",
    group: "surface",
    runtime: "liquidglass",
    label: "液态玻璃",
    description:
      "面板换成一块真“玻璃”，iOS风格：实时折射背后的背景，边缘压缩、倒角高光，G2 连续曲率圆角。依赖 WebGL 。",
    warning:
      "实验性效果：玻璃可能跟不上滚动和动画（会滞后一两帧）、超长正文面板效果较差、文字与背景的对比度可能会降低、在老设备上会掉帧。不合适就关掉。",
    caveat:
      "超长文章的面板另走一条便宜的 SVG 滤镜路线。开启后整页背景交给画布绘制；顶栏底栏、以及超过 24 块的其余面板保持原本的亚克力外观。该路线依赖 backdrop-filter 里的 SVG 滤镜，Firefox 下正文与文章里的卡片会退回亚克力外观。",
  },
  {
    kind: "switch",
    id: "typewriter",
    label: "打字机",
    description: "全站换成等宽字体，正文行距收紧一点。",
    caveat: "中文会回退到系统中文字体，主要变化在数字和拉丁字母上。",
  },
  {
    kind: "choice",
    id: "corners",
    label: "圆角",
    description: "面板和控件的圆角，分三档。不保证覆盖所有控件；“液态玻璃”实验下切换圆角需要刷新页面生效。",
    options: [
      { value: "", label: "默认" },
      { value: "square", label: "直角" },
      { value: "round", label: "圆润" },
    ],
  },
];

/** localStorage 键名。和主题分开存，清掉一个不影响另一个 */
export const LAB_STORAGE_KEY = "fbz-labs";

/** 属性名前缀：data-lab-<id>。和实验的 id 一一对应，不共享一个属性 */
export const labAttr = (id: LabId) => `data-lab-${id}`;

/** 某个实验能取的非默认值。空串（默认档）不在表里——它等于不写属性 */
export function valuesOf(lab: Lab): string[] {
  if (lab.kind === "switch") return ["on"];
  return lab.options.map((option) => option.value).filter(Boolean);
}

/** 所有非默认取值的落点，脚本和运行时共用同一份 */
export type LabState = Partial<Record<LabId, string>>;

/**
 * 把一份原始数据整理成合法状态：丢掉不认识的 id 和值，并让互斥组最多留一个。
 *
 * 过滤掉不认识的 id 是有意的：实验会下线，老用户浏览器里可能还存着
 * 已经不存在的名字，直接拿来拼属性会让那段 CSS 永远不生效（无害但脏），
 * 更重要的是不要让旧数据有机会影响渲染。
 *
 * 互斥组按 LABS 的顺序取第一个命中的成员，后面的丢掉。顺序写死在清单里，
 * 所以同一份存储在任何时候整理出来的结果都一样，不会出现「刷新一次换一个」。
 */
export function normalizeState(raw: Record<string, unknown>): LabState {
  const state: LabState = {};
  const takenGroups = new Set<LabGroupId>();

  for (const lab of LABS) {
    const value = raw[lab.id];
    if (typeof value !== "string" || !valuesOf(lab).includes(value)) continue;

    if (lab.group) {
      if (takenGroups.has(lab.group)) continue;
      takenGroups.add(lab.group);
    }
    state[lab.id] = value;
  }

  return state;
}

/** 解析存储里的 JSON。解析不了或结构不对就当全默认 */
export function parseStored(raw: string | null | undefined): LabState {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return normalizeState(parsed as Record<string, unknown>);
  } catch {
    return {};
  }
}

/** 序列化成存储用的 JSON。只剩默认值时返回 null，让调用方直接删键 */
export function serializeState(state: LabState): string | null {
  const entries = LABS.filter((lab) => state[lab.id]).map((lab) => [
    lab.id,
    state[lab.id] as string,
  ]);
  return entries.length > 0 ? JSON.stringify(Object.fromEntries(entries)) : null;
}

/**
 * 把状态写到 DOM 上。CSS 只看这些属性。
 *
 * 每个实验一个属性，而不是全部塞进一个空格分隔的列表：
 * 列表只能表达「在不在里面」，而档位型的值是 round / square 这种字符串，
 * 得靠 [data-lab-corners="round"] 才选得中。用同一种写法覆盖两种形态，
 * 新增实验时不用先想「它该用哪种属性」。
 */
export function applyLabs(state: LabState) {
  const root = document.documentElement;
  for (const lab of LABS) {
    const value = state[lab.id];
    // 默认档直接把属性摘掉：留着空字符串会让 [data-lab-x=""] 这类
    // 意外匹配有机会生效，调试时也分不清「没开」和「值写坏了」
    if (value) root.setAttribute(labAttr(lab.id), value);
    else root.removeAttribute(labAttr(lab.id));
  }
}

/** 从 DOM 上读回当前状态。运行时以 DOM 为准，存储只负责「记得」 */
export function readFromDom(): LabState {
  const raw: Record<string, string> = {};
  for (const lab of LABS) {
    const value = document.documentElement.getAttribute(labAttr(lab.id));
    if (value) raw[lab.id] = value;
  }
  return normalizeState(raw);
}

/**
 * 状态的字符串快照。
 *
 * 顺序固定按 LABS，和属性的书写顺序无关——useSyncExternalStore 用这个
 * 字符串判断「变没变」，一旦受属性顺序影响就会来回重渲染。
 */
export function stateKey(state: LabState): string {
  return LABS.filter((lab) => state[lab.id])
    .map((lab) => `${lab.id}=${state[lab.id]}`)
    .join(" ");
}

/** 按存储里的偏好重新应用一次，和 applyLabs 同样幂等 */
export function reapplyLabs() {
  try {
    applyLabs(parseStored(localStorage.getItem(LAB_STORAGE_KEY)));
  } catch {
    applyLabs({});
  }
}

/**
 * 内联到 <head> 的引导脚本，必须在首次绘制前同步执行。
 *
 * 只做一件事：把存过的实验写进 <html data-lab-*>。
 * 读不到（隐私模式禁用 localStorage）就当全默认，不抛错中断。
 *
 * 校验表、互斥表和顺序都是从 LABS 生成的常量嵌进去的——脚本在 React
 * 之前跑，拿不到模块里的数组，只能把它们序列化进字符串。
 */
const VALUE_TABLE = Object.fromEntries(LABS.map((lab) => [lab.id, valuesOf(lab)]));
const GROUP_TABLE = Object.fromEntries(
  LABS.filter((lab) => lab.group).map((lab) => [lab.id, lab.group]),
);
const LAB_ORDER = LABS.map((lab) => lab.id);

export const LABS_INIT_SCRIPT = `(function(){try{var r=document.documentElement,s=JSON.parse(localStorage.getItem("${LAB_STORAGE_KEY}")||"null");if(!s||typeof s!=="object")return;var t=${JSON.stringify(VALUE_TABLE)},g=${JSON.stringify(GROUP_TABLE)},o={},k={};${JSON.stringify(LAB_ORDER)}.forEach(function(i){var v=s[i];if(typeof v!=="string"||t[i].indexOf(v)<0)return;var G=g[i];if(G){if(k[G])return;k[G]=1}o[i]=v});for(var i in o)r.setAttribute("data-lab-"+i,o[i])}catch(_){}})();`;
