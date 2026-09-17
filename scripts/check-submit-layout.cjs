// 布局回归：锁住「提交目标」输入框不被纵向拉伸。
//
// 背景：`.wb-input` 带 `flex: 1`（为横排工具栏设计）。它一旦直接成为
// `.wb-card`（flex-column）的 flex item，`flex:1` 就沿**纵轴**生长 ——
// 侧栏越高框越大，实测 winH=1000 时高达 176px（用户反馈「框太大了」）。
//
// 本脚本用真实 Chrome 无头渲染量几何，防止回归。
// 用法: node scripts/check-submit-layout.cjs [--chrome=<path>]
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROJ = path.resolve(__dirname, '..');
const HARNESS = path.join(PROJ, 'scripts/layout-harness/index.html');
const DIST = path.join(PROJ, 'dist/webview-workbench.js');

const argChrome = (process.argv.find(a => a.startsWith('--chrome=')) || '').split('=')[1];
const CANDIDATES = [
  argChrome,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].filter(Boolean);
const CHROME = CANDIDATES.find(p => fs.existsSync(p));

if (!CHROME) {
  console.log('[skip] 未找到 Chrome/Edge，跳过布局回归（非失败）');
  process.exit(0);
}
if (!fs.existsSync(HARNESS)) {
  console.log('[skip] 缺少 scripts/layout-harness/index.html，跳过');
  process.exit(0);
}
if (!fs.existsSync(DIST)) {
  console.error('[fail] 缺少 dist/webview-workbench.js —— 请先 npx webpack --mode development');
  process.exit(1);
}

const probe = (w, h, mode) => {
  const url = 'file:///' + HARNESS.replace(/\\/g, '/') + `?mode=${mode}&w=${w}`;
  const c = spawnSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--window-size=' + w + ',' + h,
      '--virtual-time-budget=6000',
      '--dump-dom',
      url
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 90000 }
  );
  const m = (c.stdout || '').match(/data-report="([^"]*)"/);
  if (!m) throw new Error(`无 data-report（chromeStatus=${c.status}）`);
  return JSON.parse(
    m[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
  );
};

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

try {
  // 1) 输入框在任何侧栏高度下都保持单行高度（核心回归点）
  for (const h of [600, 900, 1200]) {
    const rep = probe(420, h, 'normal');
    const ih = rep.targetInput && rep.targetInput.h;
    check(
      `输入框在 winH=${h} 时保持单行高度`,
      typeof ih === 'number' && ih > 0 && ih <= 44,
      `.wb-target h=${ih}`
    );
  }

  // 2) 常态下不出现验证码区（按需出现的「不出现」半边）
  const normal = probe(420, 900, 'normal');
  check('服务端未要求时不渲染验证码区', normal.captcha === null, `captcha=${normal.captcha}`);

  // 3) 要求时验证码区出现，且图形码与输入框都在容器内
  const cap = probe(420, 900, 'captcha');
  const img = cap.captchaImg;
  check('要求验证码时渲染出验证码区', !!cap.captcha, cap.captcha ? JSON.stringify(cap.captcha) : 'null');
  check(
    '图形码可见（有宽高）',
    !!img && img.w > 0 && img.h > 0,
    img ? `w=${img.w} h=${img.h}` : 'null'
  );
  check(
    '图形码右边界在容器内',
    !!img && !!cap.captcha && img.x + img.w <= cap.captcha.x + cap.captcha.w + 1,
    img && cap.captcha ? `imgRight=${img.x + img.w} capRight=${cap.captcha.x + cap.captcha.w}` : '-'
  );
  check('验证码文案存在', !!cap.captchaText, JSON.stringify(cap.captchaText));

  // 3b) 验证码区必须自带提交按钮（用户反馈：「你的验证码提交按钮在哪里」）。
  // 底部「提交评测」在「当前文件」卡片之下，验证码出现时它在视口外，
  // 所以验证码容器内必须有一个就地按钮 —— 真实渲染里量它的存在与位置。
  check(
    '验证码区内有就地提交按钮',
    !!cap.captchaBtn,
    cap.captchaBtn ? JSON.stringify(cap.captchaBtn) : 'null'
  );
  check(
    '该按钮位于验证码容器内',
    !!cap.captchaBtn && !!cap.captcha &&
      cap.captchaBtn.x >= cap.captcha.x - 1 &&
      cap.captchaBtn.y >= cap.captcha.y - 1 &&
      cap.captchaBtn.y + cap.captchaBtn.h <= cap.captcha.y + cap.captcha.h + 1,
    cap.captchaBtn && cap.captcha
      ? `btn=[${cap.captchaBtn.x},${cap.captchaBtn.y},${cap.captchaBtn.w}x${cap.captchaBtn.h}] cap=[${cap.captcha.x},${cap.captcha.y},${cap.captcha.w}x${cap.captcha.h}]`
      : '-'
  );

  // 4) 无横向溢出、无运行时错误（窄栏尤其容易崩）
  for (const w of [300, 420, 520]) {
    for (const mode of ['normal', 'captcha']) {
      const rep = probe(w, 900, mode);
      check(
        `w=${w} mode=${mode} 无横向溢出`,
        rep.overflowX === false,
        `overflowX=${rep.overflowX}`
      );
      check(`w=${w} mode=${mode} 无运行时错误`, !rep.err, `err=${JSON.stringify(rep.err)}`);
    }
  }

  const failed = checks.filter(c => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} 通过`);
  process.exit(failed.length ? 1 : 0);
} catch (e) {
  console.error('布局回归执行失败:', e.message);
  process.exit(1);
}
