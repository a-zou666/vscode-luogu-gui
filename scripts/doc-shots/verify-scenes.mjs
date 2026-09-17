// 截图回归门禁 —— 两种互补的检查，缺一不可：
//
//  1) 文本断言：把每个场景在浏览器里真实渲染出的 DOM 文本抓回来，断言它包含
//     该场景「必须出现」的关键词。像素自检（inspect.mjs）只能证明「画出了东西」，
//     证明不了「画的是对的东西」——一个停在题单页的题目页截图同样色彩丰富。
//  2) 哈希去重：断言 8 张图两两不同。这条是专门为下面这个真实事故加的：
//     题目场景少点了一跳，UI 停在题单页，超时又被嵌套回调吞掉，于是
//     「失败」被写成 data-ready=1，problem.png 与 training.png 字节数完全相同。
//     只有「两张图必须不一样」这一条断言能抓住它。
//
// 用法：node scripts/doc-shots/verify-scenes.mjs
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const harness = join(__dirname, 'index.html');
const imgDir = join(root, 'docs', 'images');

const SCENES = [
  { scene: 'plaza',   shell: 1, w: 1180, h: 720, must: ['题单广场', '官方精选', '【入门1】顺序结构', '已过 12'] },
  { scene: 'training',shell: 1, w: 1180, h: 720, must: ['← 返回题单', '【入门1】顺序结构', 'P1001', 'A+B Problem'] },
  { scene: 'problem', shell: 1, w: 1180, h: 720, must: ['← 返回列表', 'A+B Problem', '题目描述', '输入格式', '时间限制 1000ms', '输入输出样例'] },
  { scene: 'search',  shell: 1, w: 1180, h: 720, must: ['全部难度', '入门', 'P1002', '过河卒'] },
  { scene: 'captcha', shell: 1, w: 1180, h: 720, must: ['洛谷要求填写验证码后才能继续提交', '提交验证码', '提交目标'] },
  { scene: 'result',  shell: 1, w: 1180, h: 720, must: ['Accepted', '评测结果 · R118392012', '得分', '100', '耗时'] }
];

const PNG = ['hero', 'training', 'problem', 'search', 'captcha', 'result', 'panel-plaza', 'panel-problem'];

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
].find(p => existsSync(p));
if (!CHROME) throw new Error('未找到 Chrome');

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, fail) => {
    ws.addEventListener('open', ok, { once: true });
    ws.addEventListener('error', () => fail(new Error('CDP 连接失败')), { once: true });
  });
  let id = 0; const pending = new Map();
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { ok, fail } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? fail(new Error(JSON.stringify(m.error))) : ok(m.result);
    }
  });
  const send = (method, params = {}) => new Promise((ok, fail) => {
    const mid = ++id; pending.set(mid, { ok, fail });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  return { send, close: () => ws.close() };
}

// ── 1) 哈希去重：先跑，不依赖浏览器 ──
let bad = 0;
console.log('── 截图哈希去重 ──');
const seen = new Map();
for (const n of PNG) {
  const p = join(imgDir, n + '.png');
  if (!existsSync(p)) { console.log(`  ✗ ${n}.png 不存在`); bad++; continue; }
  const h = createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 12);
  if (seen.has(h)) { console.log(`  ✗ ${n}.png 与 ${seen.get(h)}.png 内容完全相同（哈希 ${h}）`); bad++; }
  else { seen.set(h, n); console.log(`  ✓ ${n}.png  ${h}`); }
}

// ── 2) 文本断言：开浏览器逐场景取真实 DOM 文本 ──
const port = 9700 + Math.floor(Math.random() * 200);
const proc = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=' + port,
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'verify-' + port),
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'
], { stdio: 'ignore' });

let cdp;
try {
  let list = null;
  for (let i = 0; i < 100 && !list; i++) {
    await new Promise(r => setTimeout(r, 150));
    try { list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); } catch {}
  }
  if (!list) throw new Error('Chrome 调试端口未就绪');
  cdp = await connect(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const ev = async e =>
    (await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true })).result.value;

  console.log('\n── 场景文本断言 ──');
  for (const s of SCENES) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: 'file:///' + harness.replace(/\\/g, '/') + '?scene=' + s.scene + '&shell=' + s.shell });

    let ready = '';
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 200));
      ready = await ev("document.documentElement.getAttribute('data-ready') || ''");
      if (ready === '1' || (ready && ready.startsWith('error:'))) break;
    }
    if (ready !== '1') { console.log(`  ✗ ${s.scene}: 未就绪（ready=${ready || 'timeout'}）`); bad++; continue; }

    const text = (await ev("(document.querySelector('#app')||document.body).innerText")) || '';
    const missing = s.must.filter(k => text.indexOf(k) < 0);
    if (missing.length) { console.log(`  ✗ ${s.scene}: 缺少关键词 ${JSON.stringify(missing)}`); bad++; }
    else console.log(`  ✓ ${s.scene}: ${s.must.length} 个关键词全部命中（${text.length} 字符）`);
  }
} finally {
  cdp?.close();
  proc.kill();
}

console.log('');
if (bad) { console.log(`FAILED: ${bad} 项不达标`); process.exit(1); }
console.log('all scenes verified');