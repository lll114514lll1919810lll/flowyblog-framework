/**
 * 显示问题自动审计
 *
 * 靠脚本精确测量三类问题，而不是肉眼看截图：
 * 1. 遮挡：吸顶导航遮住锚点目标、横向溢出、元素重叠
 * 2. 尺寸关系：标题层级字号是否单调递减、正文行宽、触控目标大小
 * 3. 动画：进度条是否随滚动变化、悬停过渡是否生效、目录高亮是否跟随
 *
 * 用法：node scripts/audit-ui.cjs [端口] [基址]
 */

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.argv[2] || 9333;
const BASE = process.argv[3] || 'http://localhost:3000';

/* ------------------------------------------------------------- CDP 连接 --- */

async function connect() {
  const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = tabs.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, {
    perMessageDeflate: false,
    maxPayload: 256 * 1024 * 1024,
  });
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    }
  });
  await new Promise((r) => ws.on('open', r));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  return { send, ws };
}

/** 在页面里执行表达式并取回 JSON 结果 */
async function evaluate(send, expression) {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression: `(() => { ${expression} })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) {
    throw new Error(exceptionDetails.exception?.description || 'eval failed');
  }
  return result.value;
}

async function goto(send, url, width, height) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: width < 768,
  });
  await send('Page.navigate', { url });
  /*
     必须把窗口置前。窗口被遮住时浏览器不出帧：滚动驱动的效果
     （进度条、目录高亮）、悬停、键盘事件全部停在原地，
    审计会量到一连串「没变化」的假失败（进度条端点为 0、高亮不动、
     悬停不变色、移动端目录点不开）。每次导航后都置前一次，成本为零。
   */
  await send('Page.bringToFront');
  await new Promise((r) => setTimeout(r, 2600));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------- 检查项 --- */

// 页面上会被执行的检测脚本。返回结构化 findings。
const CHECKS = {
  // 1. 横向溢出：任何元素超出视口宽度都会造成横向滚动条
  horizontalOverflow: `
    const vw = document.documentElement.clientWidth;
    const bad = [];
    if (document.documentElement.scrollWidth > vw + 1) {
      for (const el of document.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.right > vw + 1 || r.left < -1) {
          // 只报告最外层的溢出元素，避免报告所有子元素
          const parent = el.parentElement;
          const pr = parent ? parent.getBoundingClientRect() : null;
          if (!pr || pr.right <= vw + 1) {
            bad.push({
              tag: el.tagName.toLowerCase(),
              cls: (el.className || '').toString().slice(0, 60),
              left: Math.round(r.left), right: Math.round(r.right),
              text: (el.textContent || '').trim().slice(0, 30),
            });
          }
        }
      }
    }
    return { vw, scrollWidth: document.documentElement.scrollWidth, bad: bad.slice(0, 8) };
  `,

  // 2. 吸顶导航遮挡：滚动到某个锚点后，标题是否被 header 盖住
  stickyOverlap: `
    const header = document.querySelector('header');
    if (!header) return { skip: 'no header' };
    const headerRect = header.getBoundingClientRect();
    const headerBottom = headerRect.bottom;

    // 取文章里所有 h2/h3，检查滚动定位后是否落在 header 下方
    const headings = [...document.querySelectorAll('.prose h2, .prose h3')];
    const covered = [];
    for (const h of headings) {
      const r = h.getBoundingClientRect();
      // 标题顶部在 header 底界之内 => 被遮挡
      if (r.top < headerBottom && r.bottom > headerBottom) {
        covered.push({ text: h.textContent.trim().slice(0, 30), top: Math.round(r.top), headerBottom: Math.round(headerBottom) });
      }
    }
    return { headerBottom: Math.round(headerBottom), headerHeight: Math.round(headerRect.height), headingCount: headings.length, covered };
  `,

  // 3. 锚点定位留白：scroll-margin-top 是否足够把标题推到 header 下方
  anchorClearance: `
    const header = document.querySelector('header');
    const headerH = header ? header.getBoundingClientRect().height : 0;
    const out = [];
    for (const h of document.querySelectorAll('.prose h2[id], .prose h3[id]')) {
      const cs = getComputedStyle(h);
      const margin = parseFloat(cs.scrollMarginTop) || 0;
      out.push({ text: h.textContent.trim().slice(0, 24), scrollMarginTop: cs.scrollMarginTop, marginPx: margin, headerH: Math.round(headerH), enough: margin >= headerH });
    }
    return out;
  `,

  // 4. 标题层级字号单调性：h1 应大于 h2，h2 应大于 h3
  headingScale: `
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { size: parseFloat(cs.fontSize), weight: cs.fontWeight, text: el.textContent.trim().slice(0, 24) };
    };
    return {
      pageH1: pick('main h1'),
      proseH2: pick('.prose h2'),
      proseH3: pick('.prose h3'),
      cardH2: pick('article h2'),
    };
  `,

  // 5. 正文行宽：中文一行 30-45 字较舒适，过宽难读
  lineLength: `
    const prose = document.querySelector('.prose');
    if (!prose) return null;
    const cs = getComputedStyle(prose);
    const width = prose.getBoundingClientRect().width;
    const fontSize = parseFloat(cs.fontSize);
    const lineHeight = parseFloat(cs.lineHeight);
    return {
      widthPx: Math.round(width),
      fontSizePx: fontSize,
      lineHeightPx: lineHeight,
      charsPerLine: Math.round(width / fontSize),
      lineHeightRatio: +(lineHeight / fontSize).toFixed(2),
    };
  `,

  // 6. 触控目标：可点击元素的实际可点区域（移动端应 >= 40px）
  touchTargets: `
    const vw = document.documentElement.clientWidth;
    const small = [];
    const sel = 'a, button, [role="button"], input, select, textarea';
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // 过滤被父级覆盖的重复链接（如卡片里的整行热区链接）
      const style = getComputedStyle(el);
      if (style.position === 'absolute' && r.width > vw * 0.8) continue;

      /*
         WCAG 2.5.8 的「行内」豁免：夹在句子中间的文字链接，
         尺寸受行高约束、撑不大，规范明确不要求它达标。
         给这种链接加内边距反而会破坏行距、让段落变丑。
       */
      const parent = el.parentElement;
      const isInlineInSentence =
        el.tagName === 'A' &&
        parent &&
        /^(P|LI|SPAN|EM|STRONG|BLOCKQUOTE|TD)$/.test(parent.tagName) &&
        (parent.textContent || '').trim().length > (el.textContent || '').trim().length + 4;
      if (isInlineInSentence) continue;

      if (r.height < 32 || r.width < 24) {
        small.push({
          tag: el.tagName.toLowerCase(),
          w: Math.round(r.width), h: Math.round(r.height),
          text: (el.textContent || '').trim().slice(0, 24),
        });
      }
    }
    return { isMobile: vw < 768, small: small.slice(0, 10) };
  `,

  // 7. 元素重叠：相邻的块级兄弟元素不应有非预期的重叠
  siblingOverlap: `
    const issues = [];
    const groups = ['main > div > *', '.prose > *'];
    /*
       跳过脱离文档流的元素（fixed / absolute）。
       它们本来就要浮在内容之上——比如右下角的「回到顶部」按钮，
       与正文重叠正是它的用途，报成问题只会掩盖真正的布局错误。
     */
    const inFlow = (el) => {
      const pos = getComputedStyle(el).position;
      return pos !== 'fixed' && pos !== 'absolute';
    };
    for (const g of groups) {
      const els = [...document.querySelectorAll(g)].filter(inFlow);
      for (let i = 0; i < els.length - 1; i++) {
        const a = els[i].getBoundingClientRect();
        const b = els[i + 1].getBoundingClientRect();
        if (a.height === 0 || b.height === 0) continue;
        // 垂直方向重叠超过 4px 视为异常（负 margin 造成的设计性重叠除外）
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (overlapY > 4) {
          issues.push({
            container: g,
            a: (els[i].textContent || '').trim().slice(0, 20),
            b: (els[i + 1].textContent || '').trim().slice(0, 20),
            overlapY: Math.round(overlapY),
          });
        }
      }
    }
    return issues.slice(0, 10);
  `,

  // 8. 焦点可见性：键盘导航时是否有清晰的焦点环
  //
  // 注意：这里只读当前焦点元素的样式，真正的 Tab 按键由 auditAnimations
  // 里的键盘事件驱动（见下方 focusRingByKeyboard）。用 element.focus()
  // 不会触发 :focus-visible，直接查会得到「无焦点环」的假警报。
  focusRing: `
    const el = document.activeElement;
    if (!el || el === document.body) return { skip: '没有元素处于焦点' };
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').trim().slice(0, 20),
      matchesFocusVisible: el.matches(':focus-visible'),
      outlineWidth: cs.outlineWidth,
      outlineStyle: cs.outlineStyle,
      outlineColor: cs.outlineColor,
    };
  `,

  // 9. 文字对比度：正文与背景的对比度是否达到 WCAG AA (4.5:1)
  contrast: `
    function lum(c) {
      const m = c.match(/[\\d.]+/g).map(Number);
      const [r, g, b] = m;
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    }
    function ratio(fg, bg) {
      const l1 = lum(fg), l2 = lum(bg);
      const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1];
      return +((a + 0.05) / (b + 0.05)).toFixed(2);
    }
    const bgOf = (el) => {
      let n = el;
      while (n && n !== document.documentElement) {
        const c = getComputedStyle(n).backgroundColor;
        if (c && !c.includes('rgba(0, 0, 0, 0)') && c !== 'transparent') return c;
        n = n.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    const targets = [
      ['正文', '.prose p'],
      ['标题', '.prose h2'],
      ['元信息', 'main time'],
      ['次级文字', '.text-secondary'],
      ['三级文字', '.text-muted'],
      ['强调色链接', '.prose a'],
    ];
    const out = [];
    for (const [name, sel] of targets) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const cs = getComputedStyle(el);
      out.push({ name, ratio: ratio(cs.color, bgOf(el)), size: cs.fontSize, color: cs.color });
    }
    return out;
  `,

  // 10. 进度条与 header 的层叠关系
  zIndexStack: `
    const bar = document.querySelector('[aria-hidden].fixed');
    const header = document.querySelector('header');
    const res = { bar: null, header: null };
    if (bar) { const cs = getComputedStyle(bar); res.bar = { z: cs.zIndex, position: cs.position, h: bar.getBoundingClientRect().height }; }
    if (header) { const cs = getComputedStyle(header); res.header = { z: cs.zIndex, position: cs.position }; }
    if (bar && header) {
      const bs = getComputedStyle(bar), hs = getComputedStyle(header);
      res.barAboveHeader = parseInt(bs.zIndex) > parseInt(hs.zIndex);
    }
    return res;
  `,
};

/* ------------------------------------------------------- 动画行为验证 --- */

async function auditAnimations(send) {
  const out = {};

  /*
     出帧心跳：窗口被遮住时浏览器基本不出帧，于是滚动驱动的效果
     （进度条、目录高亮）、悬停、点击展开全部量不到变化，
     会得到一连串假失败。这里先量 300ms 内有多少帧，
     低于阈值就让报告把这节标成「数据不可信」，而不是当成代码问题。
   */
  await goto(send, `${BASE}/blog/1-hello-world`, 1280, 900);
  out.frameTicks = await evaluate(
    send,
    `
    return new Promise((resolve) => {
      let n = 0;
      const t0 = performance.now();
      const tick = () => {
        n++;
        if (performance.now() - t0 < 300) requestAnimationFrame(tick);
        else resolve(n);
      };
      requestAnimationFrame(tick);
    });
  `,
  );

  // 1. 阅读进度条：滚动到不同位置，scaleX 应单调变化
  const progressAt = async (ratio) => {
    await evaluate(send, `
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, max * ${ratio});
      return true;
    `);
    await sleep(450);
    return evaluate(send, `
      const inner = document.querySelector('[aria-hidden].fixed > div');
      if (!inner) return null;
      const m = new DOMMatrixReadOnly(getComputedStyle(inner).transform);
      return +m.a.toFixed(3);
    `);
  };
  const p0 = await progressAt(0);
  const p50 = await progressAt(0.5);
  const p100 = await progressAt(1);
  out.progressBar = { at0: p0, at50: p50, at100: p100, monotonic: p0 <= p50 && p50 <= p100, works: p0 === 0 && p100 > 0.9 };

  // 2. 目录滚动高亮：滚到不同章节，aria-current 应随之变化
  await evaluate(send, `window.scrollTo(0, 0); return true;`);
  await sleep(400);
  const activeAtTop = await evaluate(send, `
    const a = document.querySelector('nav[aria-label="本文目录"] a[aria-current="location"]');
    return a ? a.textContent.trim().slice(0, 24) : null;
  `);
  // 滚到接近底部
  await evaluate(send, `
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, max);
    return true;
  `);
  await sleep(700);
  const activeAtBottom = await evaluate(send, `
    const a = document.querySelector('nav[aria-label="本文目录"] a[aria-current="location"]');
    return a ? a.textContent.trim().slice(0, 24) : null;
  `);
  out.tocHighlight = { atTop: activeAtTop, atBottom: activeAtBottom, changed: activeAtTop !== activeAtBottom };

  // 3. 悬停过渡：卡片 hover 后 background-color 与标题颜色是否改变
  await goto(send, `${BASE}/blog`, 1280, 900);
  const before = await evaluate(send, `
    const card = document.querySelector('article');
    const inner = card.querySelector('div');
    const title = card.querySelector('h2 span:last-child');
    return { bg: getComputedStyle(inner).backgroundColor, color: getComputedStyle(title).color };
  `);
  const { result: pos } = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => { const r = document.querySelector('article').getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + Math.min(r.height/2, 30) }; })()`,
  });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.value.x, y: pos.value.y });
  await sleep(500);
  const after = await evaluate(send, `
    const card = document.querySelector('article');
    const inner = card.querySelector('div');
    const title = card.querySelector('h2 span:last-child');
    return { bg: getComputedStyle(inner).backgroundColor, color: getComputedStyle(title).color };
  `);
  out.cardHover = { before, after, bgChanged: before.bg !== after.bg, colorChanged: before.color !== after.color };

  // 4. 过渡属性是否真的被声明（而不是瞬间跳变）
  out.transitions = await evaluate(send, `
    const el = document.querySelector('article div');
    const title = document.querySelector('article h2 span');
    const bar = document.querySelector('[aria-hidden].fixed > div');
    const pick = (n) => n ? { prop: getComputedStyle(n).transitionProperty, dur: getComputedStyle(n).transitionDuration } : null;
    return { card: pick(el), title: pick(title), progressBar: pick(bar) };
  `);

  /*
     4b. 焦点环：必须用真实键盘事件驱动。
     :focus-visible 只在「用户用键盘导航」时命中，程序化调用 focus()
     不算——这也是为什么单独查 getComputedStyle 会得到假警报。

     键盘事件只有在窗口位于前台时才送达：窗口被遮住时
     Input.dispatchKeyEvent 没有效果，Tab 之后 document.activeElement
     还是 <body>，于是报出「焦点环缺失」的假失败（踩过一次）。
     先 bringToFront 即可，鼠标事件不受影响。
   */
  await goto(send, `${BASE}/blog`, 1280, 900);
  await send('Page.bringToFront');
  await sleep(300);

  /* 窗口刚被激活时，前两次 Tab 常被吞掉（document.activeElement 仍是 <body>）。
     先空按两次预热，不计入结果。 */
  const pressTab = async () => {
    for (const type of ['keyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', {
        type,
        key: 'Tab',
        code: 'Tab',
        windowsVirtualKeyCode: 9,
        nativeVirtualKeyCode: 9,
      });
    }
    await sleep(150);
  };
  for (let i = 0; i < 2; i++) await pressTab();

  const focusTrail = [];
  for (let i = 0; i < 3; i++) {
    await pressTab();
    focusTrail.push(
      await evaluate(
        send,
        `
      const el = document.activeElement;
      if (!el || el === document.body) return { tag: 'BODY' };
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().slice(0, 18),
        focusVisible: el.matches(':focus-visible'),
        outlineWidth: cs.outlineWidth,
        outlineStyle: cs.outlineStyle,
        outlineColor: cs.outlineColor,
      };
    `,
      ),
    );
  }
  const reachable = focusTrail.filter((f) => f.tag !== 'BODY');
  const ringed = focusTrail.filter(
    (f) => f.focusVisible && parseFloat(f.outlineWidth) > 0 && f.outlineStyle !== 'none',
  );
  out.focusRingByKeyboard = {
    trail: focusTrail,
    /* 一次都没走到元素，说明是环境没把键盘事件送进来（窗口不在前台等），
       不能算代码问题，标记为「未测到」而不是失败 */
    skipped: reachable.length === 0,
    ok: reachable.length > 0 && ringed.length === reachable.length,
  };

  // 5. 移动端折叠目录：点击后是否展开
  await goto(send, `${BASE}/blog/1-hello-world`, 390, 844);

  /*
     不能用「可见链接数量」判断展开：面板收起靠的是 grid-template-rows: 0fr
     加 overflow: hidden，子元素被裁切但 getBoundingClientRect() 仍返回原始高度。
     量容器自身的渲染高度才是可靠的展开信号。
   */
  const TOC_PANEL_HEIGHT = `
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('本文目录'));
    if (!btn) return { found: false };
    const panel = btn.nextElementSibling;
    return {
      found: true,
      expanded: btn.getAttribute('aria-expanded'),
      panelHeight: panel ? Math.round(panel.getBoundingClientRect().height) : null,
    };
  `;

  const beforeOpen = await evaluate(send, TOC_PANEL_HEIGHT);
  const { result: cbtn } = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('本文目录'));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width/2, y: r.top + r.height/2 };
    })()`,
  });
  if (cbtn.value) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cbtn.value.x, y: cbtn.value.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cbtn.value.x, y: cbtn.value.y, button: 'left', clickCount: 1 });
    await sleep(700);
  }
  const afterOpen = await evaluate(send, TOC_PANEL_HEIGHT);
  out.mobileToc = {
    beforeOpen,
    afterOpen,
    expands:
      beforeOpen.found &&
      afterOpen.expanded === 'true' &&
      (afterOpen.panelHeight ?? 0) > (beforeOpen.panelHeight ?? 0) + 20,
  };

  return out;
}

/* ---------------------------------------------------------------- 主流程 --- */

/*
  硬编码的示例文章 slug。这里的取舍：audit 考察的是「页面在三种视口下的
  布局/交互」，指向固定文章比动态挑最新一篇结果更可比（布局不受内容变化
  干扰）；但文章改名/删除后要同步更新这里的路径，否则会静默审计 404 页。
  「短文章」必须是内容最短的那篇，用来考察长面板不撑爆小视口的情形。
*/
const PAGES = [
  { name: '首页', path: '/' },
  { name: '文章列表', path: '/blog' },
  { name: '文章详情', path: '/blog/1-hello-world' },
  { name: '短文章', path: '/blog/2-same-day-order-earlier' },
  { name: '标签', path: '/tags' },
  { name: '关于', path: '/about' },
];

const VIEWPORTS = [
  { name: '桌面', w: 1440, h: 900 },
  { name: '平板', w: 768, h: 1024 },
  { name: '移动', w: 390, h: 844 },
];

async function main() {
  const { send, ws } = await connect();
  const report = {};
  const consoleErrors = [];

  // 收集控制台错误
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      consoleErrors.push(m.params.entry.text.slice(0, 160));
    }
  });

  for (const vp of VIEWPORTS) {
    for (const page of PAGES) {
      await goto(send, `${BASE}${page.path}`, vp.w, vp.h);
      const key = `${vp.name}/${page.name}`;
      report[key] = {};
      for (const [checkName, script] of Object.entries(CHECKS)) {
        try {
          report[key][checkName] = await evaluate(send, script);
        } catch (e) {
          report[key][checkName] = { error: e.message };
        }
      }
    }
  }

  report['__animations__'] = await auditAnimations(send);
  report['__consoleErrors__'] = consoleErrors;

  const outPath = process.argv[4] || '.preview/audit-raw.json';
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`报告已写入 ${outPath}`);
  ws.close();
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});