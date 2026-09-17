// 文档截图生成器 —— 用真实构建产物渲染工作台，再用无头 Chrome 出图。
//
// 为什么不用 puppeteer/playwright：本项目零额外依赖也能出图。Chrome 自带的
// `--headless --screenshot` 不等待异步渲染，截出来是空白/半成品；这里改用
// CDP（Chrome DevTools Protocol）：开一个 headless 实例，用 Page.captureScreenshot
// 抓图，期间轮询页面上的 data-ready 标记，确保截到的是**渲染完成**的状态。
//
// 用法：
//   node scripts/doc-shots/shoot.mjs            # 出全部场景
//   node scripts/doc-shots/shoot.mjs plaza      # 只出指定场景
//
// 产物：docs/images/*.png（README 直接引用）
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..');
const outDir = join(root, 'docs', 'images');
const harness = join(__dirname, 'index.html');

/** 场景表：name = 输出文件名，scene = harness 查询参数，w/h = 视口，shell = 是否带编辑器上下文。 */
const SCENES = [
  { name: 'hero', scene: 'plaza', w: 1180, h: 720, shell: 1, desc: '头图：工作台嵌在 VS Code 侧栏' },
  { name: 'training', scene: 'training', w: 1180, h: 720, shell: 1, desc: '题单广场下钻到题单内题目' },
  { name: 'problem', scene: 'problem', w: 1180, h: 720, shell: 1, desc: '题面内嵌渲染（含样例复制）' },
  { name: 'search', scene: 'search', w: 1180, h: 720, shell: 1, desc: '按关键词搜索题目' },
  { name: 'captcha', scene: 'captcha', w: 1180, h: 720, shell: 1, desc: '按需出现的验证码' },
  { name: 'result', scene: 'result', w: 1180, h: 720, shell: 1, desc: '提交后实时评测结果' },
  { name: 'panel-plaza', scene: 'plaza', w: 420, h: 720, shell: 0, desc: '面板细节：题单广场' },
  { name: 'panel-problem', scene: 'problem', w: 420, h: 720, shell: 0, desc: '面板细节：题面' }
];

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
];

const findChrome = () => {
  const found = CHROME_CANDIDATES.find(p => existsSync(p));
  if (!found) throw new Error('未找到 Chrome/Edge，无法截图');
  return found;
};

/** 极简 CDP 客户端：WebSocket + JSON 消息，够用即可，不引第三方依赖。 */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, fail) => {
    ws.addEventListener('open', ok, { once: true });
    ws.addEventListener('error', () => fail(new Error('CDP 连接失败')), { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? fail(new Error(JSON.stringify(msg.error))) : ok(msg.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((ok, fail) => {
      const mid = ++id;
      pending.set(mid, { ok, fail });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return { send, close: () => ws.close() };
}

/** 等 Chrome 把调试端口写进文件，再连上去。 */
async function launchChrome(chrome, port) {
  const profile = join(process.env.TEMP || '/tmp', `docshots-${port}`);
  const proc = spawn(
    chrome,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=2', // 2x 出图，README 里在 HiDPI 屏上不糊
      'about:blank'
    ],
    { stdio: 'ignore' }
  );
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 150));
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return { proc, version: await res.json() };
    } catch {
      /* 还没起来，继续等 */
    }
  }
  proc.kill();
  throw new Error('Chrome 调试端口未就绪');
}

const shoot = async (cdp, s) => {
  const url =
    `file:///${harness.replace(/\\/g, '/')}` +
    `?scene=${s.scene}&shell=${s.shell}`;
  // 每次截图前重设视口，避免沿用上一个场景的尺寸
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: s.w,
    height: s.h,
    deviceScaleFactor: 2,
    mobile: false
  });
  await cdp.send('Page.navigate', { url });

  // 轮询 data-ready：页面把 UI 驱动到目标状态后才置位
  const deadline = Date.now() + 20000;
  let ready = false;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 200));
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: `document.documentElement.getAttribute('data-ready') || ''`,
      returnByValue: true
    });
    const v = result.value;
    if (v === '1') {
      ready = true;
      break;
    }
    if (v && v.startsWith('error:')) throw new Error(`场景 ${s.scene} 失败：${v}`);
  }
  if (!ready) throw new Error(`场景 ${s.scene} 等待渲染超时`);

  await new Promise(r => setTimeout(r, 350)); // 让字体/滚动条稳定
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false
  });
  const buf = Buffer.from(data, 'base64');
  writeFileSync(join(outDir, `${s.name}.png`), buf);
  return buf.length;
};

const main = async () => {
  const only = process.argv.slice(2).filter(a => !a.startsWith('-'));
  const scenes = only.length
    ? SCENES.filter(s => only.includes(s.name) || only.includes(s.scene))
    : SCENES;
  if (!scenes.length) throw new Error(`没有匹配的场景。可选：${SCENES.map(s => s.name).join(', ')}`);

  // 真实产物必须先存在：截图的意义就在于「所见即实现」
  const bundle = join(root, 'dist', 'webview-workbench.js');
  if (!existsSync(bundle)) throw new Error('缺少 dist/webview-workbench.js，请先运行 npm run package');

  mkdirSync(outDir, { recursive: true });
  const chrome = findChrome();
  const port = 9222 + Math.floor(Math.random() * 500);
  const { proc } = await launchChrome(chrome, port);

  let cdp;
  try {
    // 复用已开的目标页，省一次创建
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find(t => t.type === 'page');
    cdp = await connect(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    for (const s of scenes) {
      const bytes = await shoot(cdp, s);
      console.log(`✓ ${s.name}.png  ${(bytes / 1024).toFixed(0)} KB  — ${s.desc}`);
    }
  } finally {
    cdp?.close();
    proc.kill();
  }
  console.log(`\n输出目录：${outDir}`);
};

main().catch(e => {
  console.error('截图失败：', e.message);
  process.exit(1);
});
