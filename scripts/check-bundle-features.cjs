// 打包前核验：新功能是否真的进了生产 bundle。
// 生产构建会 minify，所以只 grep「不会被压缩的东西」：中文文案、命令 id、消息名。
const fs = require('fs');
const path = require('path');

const DIST = path.resolve('dist');
const targets = [
  // [文件, 关键词, 说明]
  ['webview-workbench.js', '洛谷要求填写验证码后才能继续提交', '验证码提示文案'],
  ['webview-workbench.js', '输入右侧图形验证码', '验证码输入框 placeholder'],
  ['webview-workbench.js', '换一张', '验证码换一张'],
  ['webview-workbench.js', 'workbenchCaptcha', '验证码消息名'],
  ['webview-workbench.js', 'workbenchSubmit', '提交消息名'],
  ['webview-workbench.js', 'wb-captcha', '验证码样式类'],
  ['webview-workbench.js', 'wb-target-row', '提交目标行容器'],
  ['webview-workbench.js', 'wb-tabpane', '双页常驻容器'],
  ['webview-workbench.js', 'wb-sample-col', '样例分框'],
  ['extension.js', 'workbenchCaptcha', '验证码处理器消息名'],
  ['extension.js', 'retainContextWhenHidden', 'webview 保活选项']
];

const blobs = {};
for (const f of ['webview-workbench.js', 'extension.js']) {
  const p = path.join(DIST, f);
  if (!fs.existsSync(p)) {
    console.log(`MISSING FILE: ${f}`);
    process.exit(1);
  }
  blobs[f] = fs.readFileSync(p, 'utf8');
  console.log(`${f}: ${(blobs[f].length / 1024).toFixed(0)} KiB`);
}

let bad = 0;
console.log('\n--- bundle 关键词命中 ---');
for (const [file, kw, desc] of targets) {
  const n = blobs[file].split(kw).length - 1;
  const ok = n > 0;
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${file}  「${kw}」 x${n}  (${desc})`);
}

console.log(`\n${targets.length - bad}/${targets.length} 命中`);
process.exit(bad ? 1 : 0);
