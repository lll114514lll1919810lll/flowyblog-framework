"use client";

import { useLayoutEffect } from "react";
import { LabGlassPlayground } from "@/components/lab-glass-playground";
import { LABS, LAB_GROUPS, LAB_SOLO, type Lab, type LabGroupId } from "@/lib/labs";
import {
  useLabRuntimeStatus,
  type LabRuntimeStatus,
} from "@/lib/lab-runtime-status";
import { useLabReapply, useLabs } from "@/lib/use-labs";

/**
 * 实验室开关面板。
 *
 * 页面按 LABS 的顺序渲染，同组的实验自动聚到一个小标题下——
 * 分组信息来自实验清单，不在这里手写，加一个组员不用改组件。
 *
 * 外观完全由 CSS 按 <html data-lab-*> 决定（见 globals.css 的实验室段），
 * React 只负责点击和把属性读出来显示，和主题开关同一套做法。
 */
export function LabPanel() {
  const { valueOf, activeCount, set, toggle, clear } = useLabs();

  /**
   * 开发模式下 Strict Mode 重挂载会清掉 <html> 上由内联脚本写好的属性，
   * 这里按同一份存储补回来。生产环境是空转。
   */
  const reapply = useLabReapply();
  useLayoutEffect(() => {
    reapply();
  }, [reapply]);

  return (
    <div className="flex flex-col gap-6">
      <div className="panel flex flex-col gap-5 px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-secondary">
            {activeCount > 0 ? `外观实验：正在测试 ${activeCount} 项外观` : "外观实验：当前都是默认外观"}
          </p>
          <button
            type="button"
            onClick={clear}
            disabled={activeCount === 0}
            className="btn-pill"
          >
            全部恢复默认
          </button>
        </div>

        {groupIntoSections(LABS).map((section) => {
          // 每一段都有标题：互斥组用组名，其余归到「独立实验」。
          // 只给互斥组加标题是不够的——它下面那几项样式一样、又没有分界，
          // 看上去就成了同一组的成员。
          const meta = section.group ? LAB_GROUPS[section.group] : LAB_SOLO;

          return (
            <section key={section.key} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h2 className="lab-group-title">{meta.label}</h2>
                <p className="text-xs leading-relaxed text-muted">{meta.hint}</p>
              </div>

              {/* 互斥组的成员再套一层内嵌面板：小标题说明「这是一组」，
                  框说明「框里的才是一组」。 */}
              <ul className={section.group ? "lab-list is-grouped" : "lab-list"}>
                {section.labs.map((lab) => (
                  <LabRow
                    key={lab.id}
                    lab={lab}
                    value={valueOf(lab.id)}
                    onSet={(value) => set(lab.id, value)}
                    onToggle={() => toggle(lab.id)}
                    /* 液态玻璃开了之后有一堆参数要调，面板就摆在开关下面：
                       放到页面底部的话，调完一次滑上去看效果就得来回滚 */
                    extra={
                      lab.id === "liquidglass" ? <LabGlassPlayground /> : undefined
                    }
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {/*
        说明单独一块面板，而不是裸着排在背景图上：
        这几行本来就是正文级的说明文字，直接压在背景图上又小又糊，
        而且没有边界时读起来像是页面的「杂讯」。

        风险说明放在控件下方而不是顶部横幅：读者先看到能做什么，再看到边界。
      */}
      <section className="panel flex flex-col gap-3 px-5 py-5 sm:px-6">
        <h2 className="text-sm font-medium">关于外观选项</h2>
        <ul className="flex flex-col gap-2 text-sm leading-relaxed text-secondary">
          {NOTES.map((note) => (
            <li key={note} className="flex gap-2">
              {/* 手写圆点而不是 list-disc：圆点要和文字基线对齐，
                  默认符号在小字号下会飘到行上方 */}
              <span aria-hidden="true" className="text-muted">
                ·
              </span>
              <span>{note}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** 面板底部的说明条目。短句、一句一件事，别写成一整段 */
const NOTES = [
  "选择只保存在你这台设备的浏览器里，不会同步给别人，也不影响文章内容。",
  "实验随时可能改效果或下线，遇到问题就恢复默认。",
  "恢复默认之后页面会立刻变回去，不需要刷新。",
];

/**
 * 按互斥组把实验清单切成若干段。
 *
 * 同一组的成员即使在中途被别的实验隔开，也会被并到同一段里——
 * 分组是实验自己的属性，不该取决于清单里的书写位置。
 */
function groupIntoSections(labs: readonly Lab[]) {
  const sections: { key: string; group?: LabGroupId; labs: Lab[] }[] = [];

  for (const lab of labs) {
    const key = lab.group ?? "__solo";
    let section = sections.find((item) => item.key === key);
    if (!section) {
      section = { key, group: lab.group, labs: [] };
      sections.push(section);
    }
    section.labs.push(lab);
  }

  return sections;
}

/**
 * 运行时状态对应的文案。idle（实验没开，或者本来就是纯 CSS 实验）不显示。
 *
 * 失败用金色而不是红色：站点的调色板里只有强调蓝和这枚金，
 * 为了一个实验提示引入第三种彩色不划算；金色本来就承担「注意看我」的角色。
 */
const RUNTIME_NOTES: Record<
  LabRuntimeStatus,
  { text: string; className: string } | null
> = {
  idle: null,
  loading: { text: "正在准备：下载渲染代码、初始化 WebGL…", className: "text-muted" },
  ready: { text: "已生效。", className: "text-secondary" },
  degraded: {
    text: "已生效，但有一处降级：这个浏览器不支持 SVG 滤镜版的玻璃（Firefox 不支持 backdrop-filter 里的 url()），超长正文与文章里的卡片已退回原本的亚克力外观，其余面板仍是 WebGL 玻璃。",
    className: "text-[var(--gold)]",
  },
  failed: {
    text: "初始化失败，外观没有改变：当前浏览器可能不支持 WebGL。",
    className: "text-[var(--gold)]",
  },
};

function LabRow({
  lab,
  value,
  onSet,
  onToggle,
  extra,
}: {
  lab: Lab;
  value: string;
  onSet: (value: string) => void;
  onToggle: () => void;
  /**
   * 跟在说明文字后面的附加内容，只在实验开着时渲染。
   *
   * 用在「开了之后还有一堆参数要调」的实验上（目前只有液态玻璃）：
   * 调参面板跟开关放在同一行里，读者不会在页面底部漏掉它。
   */
  extra?: React.ReactNode;
}) {
  // 说明文字和控件共用一组 id：点标题能聚焦控件，读屏也能把说明念出来
  const labelId = `lab-${lab.id}-label`;
  const descId = `lab-${lab.id}-desc`;

  /* 运行时型实验（WebGL 那类）要多报一句进度：它的开关是瞬时的，
     但真正生效要下载代码、初始化着色器，还可能失败。没有这行，
     用户看到开关开着、外观没变，只会以为坏了。
     钩子必须无条件调用（纯 CSS 实验传 undefined 拿 idle），
     所以它放在这个组件里而不是条件渲染的子树里。 */
  const runtime = useLabRuntimeStatus(lab.runtime);
  const runtimeNote = RUNTIME_NOTES[runtime];

  return (
    /* 行分隔线不写在工具类里：--border 太淡，见 globals.css 的 .lab-row */
    <li className="lab-row flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p id={labelId} className="text-sm font-medium">
            {lab.label}
          </p>
          {/* 用 aria-describedby 把说明挂到控件上：
              读屏聚焦时能听到它到底改了什么，不用回头找文字 */}
          <p id={descId} className="text-sm leading-relaxed text-secondary">
            {lab.description}
          </p>
          {lab.warning && (
            /* 金色加粗：站里唯一的暖色，和运行时失败提示同一枚令牌 */
            <p className="text-xs font-semibold leading-relaxed text-[var(--gold)]">
              {lab.warning}
            </p>
          )}
          {lab.caveat && (
            <p className="text-xs leading-relaxed text-muted">注意：{lab.caveat}</p>
          )}
          {runtimeNote && (
            <p className={`text-xs leading-relaxed ${runtimeNote.className}`}>
              {runtimeNote.text}
            </p>
          )}
      </div>

      {lab.kind === "switch" ? (
        <button
          type="button"
          role="switch"
          aria-checked={value === "on"}
          aria-labelledby={labelId}
          aria-describedby={descId}
          onClick={onToggle}
          className="lab-switch"
        >
          <span className="lab-switch-track">
            <span className="lab-switch-knob" />
          </span>
        </button>
      ) : (
        /* 档位型用原生 select，而不是自绘分段控件：
           标签、键盘操作、读屏、移动端的滚轮选择都是浏览器白送的，
           自绘一套要自己把这三件事补齐。外观用 .lab-select 对齐面板语言。 */
        <span className="lab-select-wrap">
          <select
            className="lab-select"
            value={value}
            aria-labelledby={labelId}
            aria-describedby={descId}
            onChange={(event) => onSet(event.target.value)}
          >
            {lab.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="lab-select-caret"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      )}
      </div>

      {value === "on" && extra ? extra : null}
    </li>
  );
}
