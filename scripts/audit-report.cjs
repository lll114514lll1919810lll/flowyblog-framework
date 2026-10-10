/**
 * 把 audit-ui.cjs 的原始报告提炼成可读结论。
 * 只关注真正的问题，过滤掉噪音。
 */
const fs = require('fs');

const report = JSON.parse(
  fs.readFileSync(process.argv[2] || '.preview/audit-raw.json', 'utf8'),
);

const issues = [];
const notes = [];

const section = (t) => console.log(`\n${'='.repeat(64)}\n${t}\n${'='.repeat(64)}`);

/* ---------------------------------------------------------- 横向溢出 --- */
section('1. 横向溢出（造成横向滚动条）');
let overflowFound = false;
for (const [k, v] of Object.entries(report)) {
  if (k.startsWith('__') || !v.horizontalOverflow) continue;
  const o = v.horizontalOverflow;
  if (o.scrollWidth > o.vw + 1) {
    overflowFound = true;
    console.log(`✗ ${k}: 视口 ${o.vw}px，内容 ${o.scrollWidth}px（溢出 ${o.scrollWidth - o.vw}px）`);
    for (const b of o.bad) console.log(`    <${b.tag} class="${b.cls}"> right=${b.right} "${b.text}"`);
  }
}
if (!overflowFound) console.log('✓ 所有页面、所有视口均无横向溢出');

/* ------------------------------------------------------------ 遮挡 --- */
section('2. 吸顶导航遮挡');
let stickyFound = false;
for (const [k, v] of Object.entries(report)) {
  if (k.startsWith('__') || !v.stickyOverlap || v.stickyOverlap.skip) continue;
  const s = v.stickyOverlap;
  const bad = (s.covered || []).filter((c) => c.top < s.headerBottom - 1);
  if (bad.length) {
    stickyFound = true;
    console.log(`✗ ${k}: header 高 ${s.headerHeight}px`);
    for (const c of bad) console.log(`    标题 "${c.text}" top=${c.top} < headerBottom=${s.headerBottom}`);
  }
}
if (!stickyFound) console.log('✓ 没有标题被吸顶导航遮住');

section('2b. 锚点定位留白（scroll-margin-top vs header 高度）');
for (const [k, v] of Object.entries(report)) {
  if (k.startsWith('__') || !v.anchorClearance) continue;
  const list = Array.isArray(v) ? v : [];
  const insufficient = list.filter((h) => !h.enough);
  if (list.length === 0) continue;
  if (insufficient.length === 0) {
    console.log(`✓ ${k}: ${list.length} 个标题，留白均 >= header(${list[0].headerH}px)，最小 ${Math.min(...list.map(l => l.marginPx))}px`);
  } else {
    console.log(`✗ ${k}: ${insufficient.length}/${list.length} 个标题留白不足`);
    for (const h of insufficient.slice(0, 4)) {
      console.log(`    "${h.text}" scroll-margin=${h.marginPx}px < header ${h.headerH}px`);
    }
  }
}

/* -------------------------------------------------------- 尺寸关系 --- */
section('3. 标题层级字号关系');
const seenScale = new Set();
for (const [k, v] of Object.entries(report)) {
  if (k.startsWith('__') || !v.headingScale) continue;
  const h = v.headingScale;
  if (!h.pageH1) continue;
  const sig = `${h.pageH1.size}/${h.proseH2?.size}/${h.proseH3?.size}`;
  if (seenScale.has(sig)) continue;
  seenScale.add(sig);

  console.log(`${k}`);
  console.log(`   h1 = ${h.pageH1.size}px / weight ${h.pageH1.weight}  "${h.pageH1.text}"`);
  console.log(`   h2 = ${h.proseH2?.size ?? '-'}px / weight ${h.proseH2?.weight ?? '-'}`);
  console.log(`   h3 = ${h.proseH3?.size ?? '-'}px / weight ${h.proseH3?.weight ?? '-'}`);

  const probs = [];
  if (h.proseH2 && h.pageH1.size <= h.proseH2.size) probs.push('h1 不大于 h2（页面标题与正文标题视觉无层级差）');
  if (h.proseH2 && h.proseH3 && h.proseH2.size <= h.proseH3.size) probs.push('h2 不大于 h3');
  if (h.proseH2 && h.proseH3 && h.proseH2.size - h.proseH3.size < 2) probs.push('h2 与 h3 差距过小（<2px），层级难分辨');
  if (probs.length) for (const p of probs) console.log(`   ✗ ${p}`);
  else console.log('   ✓ 层级递减正常');
}

section('4. 正文行宽与行高');
const seenLL = new Set();
for (const [k, v] of Object.entries(report)) {
  if (k.startsWith('__') || !v.lineLength) continue;
  const l = v.lineLength;
  const sig = `${l.widthPx}/${l.fontSizePx}`;
  if (seenLL.has(sig)) continue;
  seenLL.add(sig);
  console.log(`${k}: 宽 ${l.widthPx}px, 字号 ${l.fontSizePx}px => 约 ${l.charsPerLine} 字/行, 行高比 ${l.lineHeightRatio}`);
  if (l.charsPerLine > 48) console.log(`   ✗ 每行超过 48 字，长文阅读易串行`);
  else if (l.charsPerLine < 20) console.log(`   ! 每行不足 20 字，行长过短`);
  else console.log('   ✓ 在舒适区间');
}

section('5. 文字对比度（WCAG AA 正文需 >= 4.5:1）');
const seenC = new Set();
for (const [k, v] of Object.entries(report)) {
  if (k.startsWith('__') || !v.contrast) continue;
  const sig = v.contrast.map((c) => `${c.name}:${c.ratio}:${c.color}`).join('|');
  if (seenC.has(sig)) continue;
  seenC.add(sig);
  console.log(`${k}`);
  for (const c of v.contrast) {
    const large = parseFloat(c.size) >= 18.66;
    const need = large ? 3 : 4.5;
    const ok = c.ratio >= need;
    console.log(`   ${ok ? '✓' : '✗'} ${c.name.padEnd(6)} ${String(c.ratio).padStart(6)}:1  (需 ${need})  ${c.size}  ${c.color}`);
  }
}

section('6. 触控目标（移动端应 >= 32px 高）');
let touchFound = false;
for (const [k, v] of Object.entries(report)) {
  if (k.startsWith('__') || !v.touchTargets || !v.touchTargets.isMobile) continue;
  if (v.touchTargets.small.length === 0) continue;
  touchFound = true;
  console.log(`✗ ${k}: ${v.touchTargets.small.length} 个过小`);
  for (const s of v.touchTargets.small) {
    console.log(`    <${s.tag}> ${s.w}x${s.h}px  "${s.text}"`);
  }
}
if (!touchFound) console.log('✓ 移动端所有可点元素 >= 32px 高');

section('7. 兄弟元素重叠');
let sibFound = false;
for (const [k, v] of Object.entries(report)) {
  if (k.startsWith('__') || !v.siblingOverlap) continue;
  if (v.siblingOverlap.length === 0) continue;
  sibFound = true;
  console.log(`✗ ${k}: ${v.siblingOverlap.length} 处重叠`);
  for (const s of v.siblingOverlap.slice(0, 5)) {
    console.log(`    "${s.a}" ↔ "${s.b}" 重叠 ${s.overlapY}px`);
  }
}
if (!sibFound) console.log('✓ 未发现非预期的元素重叠');

section('8. 焦点样式（用真实 Tab 键验证）');
/*
  这里刻意不看页面加载时的 focusRing 值：:focus-visible 只在键盘导航时命中，
  必须真按 Tab 才测得准。早先版本用 element.focus() 查，一直是假警报。
*/
const kb = report.__animations__?.focusRingByKeyboard;
if (kb) {
  for (const f of kb.trail) {
    const ok = f.focusVisible && parseFloat(f.outlineWidth) > 0 && f.outlineStyle !== 'none';
    console.log(
      `   ${kb.skipped ? '·' : ok ? '✓' : '✗'} <${f.tag}> "${f.text ?? ''}"  focus-visible=${f.focusVisible}  outline=${f.outlineWidth} ${f.outlineStyle} ${f.outlineColor}`,
    );
  }
  if (kb.skipped) {
    /* 键盘事件根本没送到页面（窗口不在前台等），这是环境问题不是代码问题 */
    console.log('   ! 未测到：键盘事件没送达页面，确认窗口在前台后重跑');
  } else {
    console.log(`   ${kb.ok ? '✓ 键盘导航有清晰焦点环' : '✗ 焦点环缺失'}`);
  }
} else {
  console.log('   (跳过)');
}

section('9. 层叠关系（进度条 vs 吸顶导航）');
const z = report['桌面/文章详情']?.zIndexStack;
if (z) {
  console.log(`   进度条 z=${z.bar?.z} ${z.bar?.position} 高度=${z.bar?.h}px`);
  console.log(`   header  z=${z.header?.z} ${z.header?.position}`);
  if (z.bar?.h > 3) console.log(`   ! 进度条高 ${z.bar.h}px，比预期的 1.5px 细线粗`);
  else console.log('   ✓ 进度条足够细');
  console.log(`   ${z.barAboveHeader ? '✓ 进度条在 header 之上' : '! 进度条在 header 之下（可能被遮）'}`);
}

/* -------------------------------------------------------------- 动画 --- */
section('10. 动画行为');
const a = report.__animations__ || {};
/* 窗口被遮住时浏览器几乎不出帧，这一节的「没变化」全是假的。
   此时把 ✗ 降级成 ·，避免和上面的提示自相矛盾。 */
const FRAMES_OK = !(typeof a.frameTicks === 'number' && a.frameTicks < 8);
const mark = (ok) => (ok ? '✓' : FRAMES_OK ? '✗' : '·');
if (!FRAMES_OK) {
  console.log(`   ! 只测到 ${a.frameTicks} 帧/300ms：窗口不在前台，本节结论不可信（✗ 已降级为 ·），请让浏览器窗口可见后重跑`);
}
const pb = a.progressBar;
if (pb) {
  console.log(`阅读进度条：顶部 ${pb.at0} → 50% ${pb.at50} → 底部 ${pb.at100}`);
  console.log(`   ${pb.monotonic ? '✓ 单调递增' : '✗ 非单调，滚动逻辑有问题'}`);
  console.log(`   ${pb.works ? '✓ 0% 时为 0，100% 时接近 1' : '✗ 端点不对'}`);
}

const th = a.tocHighlight;
if (th) {
  console.log(`目录高亮：顶部 "${th.atTop}" → 底部 "${th.atBottom}"`);
  console.log(`   ${th.changed && th.atBottom ? '✓ 随滚动正确切换' : '✗ 高亮未跟随滚动'}`);
}

const ch = a.cardHover;
if (ch) {
  console.log(`卡片悬停：背景 ${ch.before.bg} → ${ch.after.bg}`);
  console.log(`         标题色 ${ch.before.color} → ${ch.after.color}`);
  console.log(`   ${mark(ch.bgChanged)} 背景变化   ${mark(ch.colorChanged)} 标题变色`);
}

const tr = a.transitions;
if (tr) {
  console.log('过渡属性声明：');
  for (const [k, v] of Object.entries(tr)) {
    if (!v) { console.log(`   ${k}: 无`); continue; }
    console.log(`   ${k}: ${v.prop} / ${v.dur}`);
    if (v.dur === '0s') console.log(`      ! ${k} 没有过渡，会瞬间跳变`);
  }
}

const mt = a.mobileToc;
if (mt) {
  // 用面板渲染高度判断展开：收起是靠 grid-rows-0fr + overflow-hidden，
  // 链接的 getBoundingClientRect 不受裁切影响，数量不变。
  console.log(
    `移动端目录：点击前 expanded=${mt.beforeOpen.expanded} 面板高=${mt.beforeOpen.panelHeight}px`,
  );
  console.log(
    `           点击后 expanded=${mt.afterOpen.expanded} 面板高=${mt.afterOpen.panelHeight}px`,
  );
  console.log(`   ${mark(mt.expands)} 点击可展开`);
}

section('11. 控制台错误');
const errs = report.__consoleErrors__ || [];
if (errs.length === 0) console.log('✓ 无控制台错误');
else {
  console.log(`✗ ${errs.length} 条错误`);
  for (const e of [...new Set(errs)].slice(0, 6)) console.log(`   ${e}`);
}