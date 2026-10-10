/**
 * 明暗主题开关的自动检查
 *
 * 全部结论都来自浏览器里的真实数值：计算样式、真实鼠标/键盘事件、
 * 首帧绘制时间，而不是看截图。
 *
 * 用法：先起 dev server，再用带 CDP 的 Edge/Chrome 打开过站点，然后
 *   pnpm test:theme        （或 node scripts/check-theme.cjs [端口] [基址]）
 *
 * 覆盖：两套主题来源（系统偏好 / 手动选择）的优先级、点击切换、刷新后的
 * 持久化与首帧前生效、没有 data-theme 时的纯 CSS 回退、开关内部几何、
 * 键盘焦点环、图形对比度、水合报错。
 */

const WebSocket = require('ws');

const PORT = Number(process.argv[2]) || 9333;
const BASE = process.argv[3] || 'http://localhost:3000';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

async function connect() {
  const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = tabs.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, {
    perMessageDeflate: false,
    maxPayload: 256 * 1024 * 1024,
  });
  let id = 0;
  const pending = new Map();
  const consoleMsgs = [];
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
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      consoleMsgs.push(
        m.params.args.map((a) => a.value ?? a.description ?? '').join(' '),
      );
    }
    if (m.method === 'Log.entryAdded') {
      consoleMsgs.push(`[${m.params.entry.level}] ${m.params.entry.text}`);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      consoleMsgs.push(
        `[exception] ${m.params.exceptionDetails.exception?.description ?? ''}`,
      );
    }
  });
  await new Promise((r) => ws.on('open', r));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  return { send, ws, consoleMsgs };
}

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

/** 系统偏好：'dark' | 'light' */
const setSystem = (send, value) =>
  send('Emulation.setEmulatedMedia', {
    media: 'screen',
    features: [{ name: 'prefers-color-scheme', value }],
  });

async function load(send, { wait = 1400 } = {}) {
  await send('Page.navigate', { url: BASE + '/' });
  await sleep(wait);
}

/** 一次读取页面上所有关键状态 */
const READ_STATE = `
  const root = document.documentElement;
  const btn = document.querySelector('.theme-switch');
  const knob = document.querySelector('.theme-switch-knob');
  const sun = document.querySelector('.theme-switch-sun svg');
  const moon = document.querySelector('.theme-switch-moon svg');
  const cs = getComputedStyle(root);
  return {
    theme: root.dataset.theme,
    colorScheme: cs.colorScheme,
    bg: cs.getPropertyValue('--background').trim(),
    fg: cs.getPropertyValue('--foreground').trim(),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    bodyColor: getComputedStyle(document.body).color,
    stored: localStorage.getItem('fbz-theme'),
    ariaChecked: btn.getAttribute('aria-checked'),
    title: btn.getAttribute('title'),
    knobTransform: getComputedStyle(knob).transform,
    knobBg: getComputedStyle(knob).backgroundColor,
    trackBg: getComputedStyle(document.querySelector('.theme-switch-track')).backgroundColor,
    sunColor: getComputedStyle(sun).color,
    moonColor: getComputedStyle(moon).color,
    btnRect: btn.getBoundingClientRect().toJSON(),
    trackRect: document.querySelector('.theme-switch-track').getBoundingClientRect().toJSON(),
  };
`;

const MATRIX_X = (t) => {
  if (!t || t === 'none') return 0;
  const m = t.match(/matrix\(([^)]+)\)/);
  return m ? parseFloat(m[1].split(',')[4]) : NaN;
};

function luminance(rgb) {
  const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map(Number);
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** 真实鼠标点击按钮中心 */
async function clickSwitch(send) {
  const rect = await evaluate(
    send,
    `return document.querySelector('.theme-switch').getBoundingClientRect().toJSON();`,
  );
  const x = Math.round(rect.x + rect.width / 2);
  const y = Math.round(rect.y + rect.height / 2);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
  }
  return { x, y };
}

/** 记录 data-theme 被写入的时刻，用来和首帧绘制时间比较 */
async function installFirstPaintRecorder(send) {
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__rec = { themeAt: -1, theme: null, bgAt: null };
      new MutationObserver(function () {
        if (window.__rec.themeAt < 0 && document.documentElement.dataset.theme) {
          window.__rec.themeAt = performance.now();
          window.__rec.theme = document.documentElement.dataset.theme;
          window.__rec.bgAt = getComputedStyle(document.body).backgroundColor;
        }
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-theme'] });
    `,
  });
}

(async () => {
  const { send, ws, consoleMsgs } = await connect();

  /* --- 1. 没有存过偏好时，跟随系统 ------------------------------------- */
  await setSystem(send, 'light');
  await load(send);
  await evaluate(send, `localStorage.clear(); return 1;`);

  await setSystem(send, 'dark');
  await load(send);
  let s = await evaluate(send, READ_STATE);
  check(
    '系统深色 → 自动深色',
    s.theme === 'dark' && s.colorScheme === 'dark' && s.bg === '#09090b',
    `theme=${s.theme} colorScheme=${s.colorScheme} --background=${s.bg}`,
  );
  check(
    '深色下开关状态与滑块位置正确',
    s.ariaChecked === 'true' && MATRIX_X(s.knobTransform) === 20,
    `aria-checked=${s.ariaChecked} knobX=${MATRIX_X(s.knobTransform)} title=${s.title}`,
  );

  await setSystem(send, 'light');
  await load(send);
  s = await evaluate(send, READ_STATE);
  check(
    '系统浅色 → 自动浅色',
    s.theme === 'light' &&
      s.colorScheme === 'light' &&
      s.bodyBg === 'rgb(255, 255, 255)',
    `theme=${s.theme} --background=${s.bg} body=${s.bodyBg}`,
  );
  check(
    '浅色下开关状态与滑块位置正确',
    s.ariaChecked === 'false' && MATRIX_X(s.knobTransform) === 0,
    `aria-checked=${s.ariaChecked} knobX=${MATRIX_X(s.knobTransform)}`,
  );

  /* --- 1.5 开关内部几何：轨道/滑块/图标各就各位 ------------------------ */
  const geom = await evaluate(
    send,
    `
    const r = (sel) => document.querySelector(sel).getBoundingClientRect();
    const track = r('.theme-switch-track');
    const knob = r('.theme-switch-knob');
    const sun = r('.theme-switch-sun');
    const moon = r('.theme-switch-moon');
    const svg = r('.theme-switch-sun svg');
    const top = document.elementFromPoint(knob.x + knob.width / 2, knob.y + knob.height / 2);
    return {
      track: [track.width, track.height],
      knob: [knob.width, knob.height, knob.x - track.x, knob.y - track.y],
      sunX: sun.x - track.x,
      moonX: moon.x - track.x,
      iconW: sun.width,
      svg: [svg.width, svg.height],
      topIsIcon: !!(top && top.closest('.theme-switch-icon')),
      topTag: top ? top.tagName : null,
    };
  `,
  );
  check(
    '轨道 44×24、滑块 20×20 内缩 2px',
    geom.track[0] === 44 &&
      geom.track[1] === 24 &&
      geom.knob[0] === 20 &&
      geom.knob[1] === 20 &&
      geom.knob[2] === 2 &&
      geom.knob[3] === 2,
    `轨道 ${geom.track.join('×')}，滑块 ${geom.knob.join('/')}（后两位是相对轨道的偏移）`,
  );
  check(
    '两枚图标各占 20px 半格、SVG 12×12',
    geom.sunX === 2 &&
      geom.moonX === 22 &&
      geom.iconW === 20 &&
      geom.svg[0] === 12 &&
      geom.svg[1] === 12,
    `太阳 x=${geom.sunX} 月亮 x=${geom.moonX} 图标宽=${geom.iconW} svg=${geom.svg.join('×')}`,
  );
  check(
    '滑块被图标压住（图标在上层，反白才看得见）',
    geom.topIsIcon,
    `滑块中心处最上层是 ${geom.topTag}`,
  );

  /* --- 1.6 键盘焦点环 --------------------------------------------------- */
  await evaluate(send, `document.activeElement.blur(); return 1;`);
  let focusInfo = null;
  for (let i = 0; i < 8 && !focusInfo; i++) {
    for (const type of ['keyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', {
        type,
        key: 'Tab',
        code: 'Tab',
        windowsVirtualKeyCode: 9,
        nativeVirtualKeyCode: 9,
      });
    }
    await sleep(120);
    const st = await evaluate(
      send,
      `
      const el = document.activeElement;
      if (!el || !el.classList.contains('theme-switch')) return null;
      const cs = getComputedStyle(el);
      return { outline: cs.outline, radius: cs.borderRadius, visible: el.matches(':focus-visible') };
    `,
    );
    if (st) focusInfo = st;
  }
  check(
    'Tab 能聚焦到开关且焦点环清晰',
    !!focusInfo &&
      focusInfo.visible &&
      focusInfo.outline.includes('2px') &&
      focusInfo.outline !== 'none',
    focusInfo ? `outline=${focusInfo.outline} 圆角=${focusInfo.radius}` : 'Tab 8 次没走到开关',
  );

  /* --- 2. 点击：切换 / 存盘 / 动画 ------------------------------------- */
  const click = await clickSwitch(send);
  /*
   * 轮询采样中间态，而不是在一个固定时刻取一个点。
   *
   * 滑块是被 View Transition 的快照回调推着动的：浏览器先拍一张旧主题的
   * 快照，回调里才提交新主题，动画从那一刻才开始。拍快照的耗时随机器负载
   * 和页面复杂度变化（本机实测 40~130ms 都有），固定取 90ms 会偶发地
   * 「还没起步」，报成动画失败——那是采样太窄，不是动画坏了。
   * 这里在 400ms 窗口内每 20ms 看一眼，出现过一次严格位于两端之间的位置
   * 就算通过；如果直接跳到 20 说明动画被跳过，同样判失败。
   */
  let midX = -1;
  for (let i = 0; i < 20; i += 1) {
    await sleep(20);
    const t = await evaluate(
      send,
      `return getComputedStyle(document.querySelector('.theme-switch-knob')).transform;`,
    );
    const x = MATRIX_X(t);
    if (x > 0.5 && x < 19.5) {
      midX = x;
      break;
    }
    // 已经贴到终点：说明中间态整个被跳过了，再等也没意义
    if (x >= 19.5) break;
  }
  await sleep(400);
  s = await evaluate(send, READ_STATE);
  check(
    '点击开关切换到深色并写入 localStorage',
    s.theme === 'dark' && s.stored === 'dark' && s.colorScheme === 'dark',
    `theme=${s.theme} stored=${s.stored}`,
  );
  check(
    '滑块是滑过去的（动画中间态介于 0 和 20 之间）',
    midX > 0.5 && midX < 19.5,
    midX > 0 ? `采样到的中间态 translateX=${midX.toFixed(2)}px` : '400ms 内没采到中间态',
  );
  check(
    '开关热区达到 44×44',
    s.btnRect.width === 44 && s.btnRect.height === 44,
    `${s.btnRect.width}×${s.btnRect.height}，点击点 (${click.x},${click.y})`,
  );
  check(
    '读屏语义：role=switch + aria-checked 同步',
    s.ariaChecked === 'true' && s.title === '切换到浅色模式',
    `aria-checked=${s.ariaChecked} title=${s.title}`,
  );

  /* --- 3. 手动选过之后，系统偏好不再生效 ------------------------------- */
  await setSystem(send, 'light');
  await sleep(200);
  s = await evaluate(send, READ_STATE);
  check(
    '手动选深色后，系统浅色也不改回来',
    s.theme === 'dark',
    `theme=${s.theme}（系统=light）`,
  );

  /* --- 4. 刷新后保持 + 首帧前就已应用（无白闪） ------------------------ */
  await installFirstPaintRecorder(send);
  await load(send, { wait: 1600 });
  s = await evaluate(send, READ_STATE);
  const rec = await evaluate(
    send,
    `
    const paints = performance.getEntriesByType('paint');
    const fp = paints.find((p) => p.name === 'first-paint');
    const fcp = paints.find((p) => p.name === 'first-contentful-paint');
    return {
      rec: window.__rec,
      firstPaint: fp ? fp.startTime : -1,
      firstContentfulPaint: fcp ? fcp.startTime : -1,
    };
  `,
  );
  check(
    '刷新后仍是深色（内联脚本先于样式生效）',
    s.theme === 'dark' && s.stored === 'dark',
    `theme=${s.theme} stored=${s.stored}`,
  );
  check(
    'data-theme 在首帧绘制之前就已写好',
    rec.rec.themeAt >= 0 && rec.firstPaint > 0 && rec.rec.themeAt < rec.firstPaint,
    `属性写入 ${rec.rec.themeAt.toFixed(1)}ms < 首帧 ${rec.firstPaint.toFixed(1)}ms（当时 body 背景 ${rec.rec.bgAt}）`,
  );

  /* --- 5. 手动选浅色时，深色系统也压得住 ------------------------------- */
  await setSystem(send, 'dark');
  await load(send);
  await evaluate(send, `localStorage.setItem('fbz-theme', 'light'); return 1;`);
  await load(send);
  s = await evaluate(send, READ_STATE);
  check(
    '系统深色 + 手动浅色 → 仍是浅色',
    s.theme === 'light' &&
      s.colorScheme === 'light' &&
      s.bodyBg === 'rgb(255, 255, 255)',
    `theme=${s.theme} --background=${s.bg} body=${s.bodyBg}`,
  );

  /* --- 5.5 没有 data-theme 属性时（= 内联脚本没跑成的场景）走媒体查询 --- */
  await evaluate(send, `localStorage.removeItem('fbz-theme'); return 1;`);
  await setSystem(send, 'dark');
  await load(send);
  await evaluate(
    send,
    `document.documentElement.removeAttribute('data-theme');
     document.documentElement.style.colorScheme = '';
     return 1;`,
  );
  await sleep(120);
  s = await evaluate(send, READ_STATE);
  check(
    '无 data-theme + 系统深色：配色与开关外观都按深色渲染（纯 CSS 回退）',
    s.theme === undefined &&
      s.bodyBg === 'rgb(9, 9, 11)' &&
      s.colorScheme === 'dark' &&
      MATRIX_X(s.knobTransform) === 20 &&
      s.moonColor === 'rgb(9, 9, 11)',
    `data-theme=${s.theme} body=${s.bodyBg} colorScheme=${s.colorScheme} knobX=${MATRIX_X(s.knobTransform)} moon=${s.moonColor}`,
  );

  /* --- 6. 跟随系统时，系统偏好实时变化要跟上 --------------------------- */
  await evaluate(send, `localStorage.removeItem('fbz-theme'); return 1;`);
  await setSystem(send, 'light');
  await load(send);
  await setSystem(send, 'dark');
  await sleep(300);
  s = await evaluate(send, READ_STATE);
  check(
    '未手动选择时，系统偏好变化实时跟随',
    s.theme === 'dark' && s.stored === null,
    `theme=${s.theme} stored=${s.stored}`,
  );

  /* --- 7. 对比度（非文本图形同样按 3:1 要求） --------------------------- */
  for (const [name, wantTheme] of [['浅色', 'light'], ['深色', 'dark']]) {
    await setSystem(send, wantTheme === 'dark' ? 'dark' : 'light');
    await load(send);
    await evaluate(
      send,
      `localStorage.setItem('fbz-theme', '${wantTheme}'); return 1;`,
    );
    await load(send);
    const c = await evaluate(send, READ_STATE);
    const active = wantTheme === 'dark' ? c.moonColor : c.sunColor;
    const idle = wantTheme === 'dark' ? c.sunColor : c.moonColor;
    check(
      `${name}：滑块与轨道对比度 ≥ 3:1`,
      contrast(c.knobBg, c.trackBg) >= 3,
      `${c.knobBg} / ${c.trackBg} = ${contrast(c.knobBg, c.trackBg).toFixed(2)}:1`,
    );
    /*
     * 图标按「非文本图形」的要求卡 3:1（WCAG 1.4.11），不是文字的 4.5:1。
     *
     * 这条原来写的是 4.5，那时滑块是近黑/近白，反白图标轻松过线。滑块改成
     * 浅一号的主题蓝（#3b82f6）之后，白图标是 3.68:1：够 3:1，够不上 4.5。
     * 图标本身是个 sun/moon 的图形，开关状态同时也由滑块位置和
     * aria-checked 表达，所以 3:1 是这里真正该守的门槛。
     * 再往下调蓝（比如 #60a5fa）就只有 2.5:1 左右，会在这一步挂掉。
     */
    check(
      `${name}：当前图标（反白压在滑块上）≥ 3:1`,
      contrast(active, c.knobBg) >= 3,
      `${active} / ${c.knobBg} = ${contrast(active, c.knobBg).toFixed(2)}:1`,
    );
    check(
      `${name}：另一枚图标与轨道 ≥ 3:1`,
      contrast(idle, c.trackBg) >= 3,
      `${idle} / ${c.trackBg} = ${contrast(idle, c.trackBg).toFixed(2)}:1`,
    );
    check(
      `${name}：正文用色正确`,
      (wantTheme === 'dark') === (c.bodyBg === 'rgb(9, 9, 11)'),
      `body 背景 ${c.bodyBg} 文字 ${c.bodyColor}`,
    );
  }

  /* --- 8. 水合报错 ----------------------------------------------------- */
  const hydration = consoleMsgs.filter(
    (m) => /hydrat|did not match|Warning/i.test(m) && !/DevTools/i.test(m),
  );
  check(
    '无 hydration / 水合相关报错',
    hydration.length === 0,
    hydration.length ? hydration.slice(0, 3).join(' | ') : `共 ${consoleMsgs.length} 条控制台消息`,
  );

  const failed = results.filter((r) => !r.pass);
  console.log(
    `\n${results.length - failed.length}/${results.length} 通过` +
      (failed.length ? `，失败：${failed.map((f) => f.name).join('、')}` : ''),
  );
  ws.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('脚本出错：', e);
  process.exit(2);
});
