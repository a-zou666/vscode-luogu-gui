// Dump the rendered text of each screenshot scene.
// The strongest proof that a screenshot shows the intended state is to ask the
// very same page what it contains: if the DOM text matches the scene's intent,
// the pixels cannot be a blank page or a half-rendered skeleton.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..');
const harness = join(__dirname, 'index.html');

const SCENES = [
  { scene: 'plaza', shell: 1, w: 1180, h: 720 },
  { scene: 'training', shell: 1, w: 1180, h: 720 },
  { scene: 'problem', shell: 1, w: 1180, h: 720 },
  { scene: 'search', shell: 1, w: 1180, h: 720 },
  { scene: 'captcha', shell: 1, w: 1180, h: 720 },
  { scene: 'result', shell: 1, w: 1180, h: 720 }
];

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
].find(p => existsSync(p));
if (!CHROME) throw new Error('no Chrome');

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, fail) => {
    ws.addEventListener('open', ok, { once: true });
    ws.addEventListener('error', () => fail(new Error('cdp connect failed')), { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { ok, fail } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? fail(new Error(JSON.stringify(m.error))) : ok(m.result);
    }
  });
  const send = (method, params = {}) => new Promise((ok, fail) => {
    const mid = ++id;
    pending.set(mid, { ok, fail });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  return { send, close: () => ws.close() };
}

const port = 9800 + Math.floor(Math.random() * 400);
const profile = join(process.env.TEMP || '/tmp', 'dumptext-' + port);
const proc = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'
], { stdio: 'ignore' });

let cdp;
try {
  let list = null;
  for (let i = 0; i < 100 && !list; i++) {
    await new Promise(r => setTimeout(r, 150));
    try { list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); } catch {}
  }
  if (!list) throw new Error('debug port not ready');
  cdp = await connect(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  for (const s of SCENES) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: 1, mobile: false });
    const url = 'file:///' + harness.replace(/\\/g, '/') + '?scene=' + s.scene + '&shell=' + s.shell;
    await cdp.send('Page.navigate', { url });
    let ready = '';
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 200));
      const { result } = await cdp.send('Runtime.evaluate', {
        expression: "document.documentElement.getAttribute('data-ready') || ''", returnByValue: true
      });
      ready = result.value;
      if (ready === '1' || (ready && ready.startsWith('error:'))) break;
    }
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: "(document.querySelector('#app')||document.body).innerText.replace(/\\n{2,}/g,'\\n').trim()",
      returnByValue: true
    });
    const text = result.value || '';
    const lines = text.split('\n');
    console.log('===== scene=' + s.scene + '  ready=' + ready + '  chars=' + text.length + '  lines=' + lines.length + ' =====');
    console.log(lines.slice(0, 45).join('\n'));
    if (lines.length > 45) console.log('... (+' + (lines.length - 45) + ' more lines)');
    console.log('');
  }
} finally {
  cdp?.close();
  proc.kill();
}