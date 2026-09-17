#!/usr/bin/env node
// 自动打包守护：源码一变就重新构建并产出 vscode-luogu.vsix。
//
// 为什么需要它 —— 本轮真实翻车：仓库里的 vscode-luogu.vsix 是 13:26 的，
// 而源码改到 15:31，手工打包一漏，交给用户实测的就是不含修复的旧包。
// 手工链条「改完记得打包」靠不住，所以做成常驻进程。
//
// 流水线：生产构建 → bundle 特性门禁 → vsce 打包 → 新鲜度自检
// 用法: npm run pack:watch
//      PACK_DEBOUNCE_MS=1000 npm run pack:watch   （调防抖，默认 2500ms）
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const PROJ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VSIX = path.join(PROJ, 'vscode-luogu.vsix');
// 日志必须放在 dist 之外：`npm run package` 的 prepackage 会 `del-cli dist`，
// 写进 dist 的日志会被删掉，且 Windows 上打开的文件句柄还会让 del-cli 直接失败。
const LOG = path.join(PROJ, 'pack-watch.log');

const WATCH_DIRS = ['src', 'webview', 'resources', 'scripts'];
const WATCH_FILES = ['package.json', 'webpack.config.js'];
const EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.css', '.json', '.html', '.png', '.svg', '.woff'
]);
// dist 是自己写的产物，绝不能监听 —— 否则打包触发改动、改动触发打包，死循环。
const IGNORE = /(^|[\\/])(node_modules|dist|out|\.git|\.vscode-test)([\\/]|$)/;
const DEBOUNCE_MS = Number(process.env.PACK_DEBOUNCE_MS || 2500);

fs.mkdirSync(path.join(PROJ, 'dist'), { recursive: true });
const logStream = fs.createWriteStream(LOG, { flags: 'a' });

function log(msg) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
  console.log(line);
  logStream.write(line + '\n');
}

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// Windows 上 Node 24 用 spawnSync 直接调 `npm.cmd` 会 EINVAL（.cmd 不能裸 spawn）。
// 正解是绕过 .cmd 壳，用 node 直接跑 npm 的 CLI 入口 JS。
// `npm run` 启动时 npm_execpath 就指向它；直接 `node scripts/watch-pack.mjs`
// 跑时则回退到 node 安装目录下的标准位置。
function resolveNpmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ].filter(Boolean);
  return candidates.find(p => p.endsWith('.js') && fs.existsSync(p)) || null;
}

const NPM_CLI = resolveNpmCli();
if (!NPM_CLI) log('⚠️ 未找到 npm CLI 入口，将回退到 shell 调用');

function run(label, cmd, args) {
  log(`▶ ${label}`);
  const r = spawnSync(cmd, args, { cwd: PROJ, stdio: 'inherit' });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    log(`✗ ${label} 失败 (exit=${r.status})`);
    return false;
  }
  return true;
}

// npm 子命令统一走 npm-cli.js
function runNpm(label, args) {
  if (NPM_CLI) return run(label, process.execPath, [NPM_CLI, ...args]);
  return run(label, NPM, args);
}

// 最新的产品源码时间 —— 用来证明产出的 .vsix 确实比源码新。
function newestSourceMtime() {
  let newest = 0;
  let newestFile = '';
  const visit = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (IGNORE.test(p)) continue;
      if (e.isDirectory()) visit(p);
      else if (EXT.has(path.extname(e.name))) {
        const m = fs.statSync(p).mtimeMs;
        if (m > newest) {
          newest = m;
          newestFile = p;
        }
      }
    }
  };
  for (const d of WATCH_DIRS) {
    const p = path.join(PROJ, d);
    if (fs.existsSync(p)) visit(p);
  }
  for (const f of WATCH_FILES) {
    const p = path.join(PROJ, f);
    if (fs.existsSync(p) && fs.statSync(p).mtimeMs > newest) {
      newest = fs.statSync(p).mtimeMs;
      newestFile = p;
    }
  }
  return { newest, newestFile };
}

function buildOnce(reason) {
  const started = Date.now();
  log(`=== 触发打包（${reason}）===`);

  // 1) 生产构建（prepackage 会自动清 dist）
  if (!runNpm('生产构建 npm run package', ['run', 'package'])) {
    log('构建失败，已中止 —— 保留上一次的 .vsix');
    return false;
  }

  // 2) bundle 特性门禁：新功能真进了生产 bundle 才算数。
  //    生产构建会 minify，所以只 grep 不会被压缩的中文文案 / 命令 id / 消息名。
  if (!run('特性门禁 check-bundle-features', process.execPath, ['scripts/check-bundle-features.cjs'])) {
    log('⚠️ 特性门禁未通过 —— 已跳过打包，避免产出缺功能的包');
    return false;
  }

  // 3) vsce 打包
  if (!runNpm('vsce 打包 npm run pack', ['run', 'pack'])) {
    log('打包失败');
    return false;
  }

  // 4) 新鲜度自检：这正是本轮翻车的那个点，做成硬校验。
  const { newest, newestFile } = newestSourceMtime();
  if (!fs.existsSync(VSIX)) {
    log('✗ 自检失败：没有产出 .vsix');
    return false;
  }
  const vsixMtime = fs.statSync(VSIX).mtimeMs;
  const size = (fs.statSync(VSIX).size / 1024 / 1024).toFixed(2);
  if (vsixMtime < newest) {
    log(`✗ 自检失败：.vsix 比源码旧！vsix=${new Date(vsixMtime).toISOString()} 源=${path.relative(PROJ, newestFile)}`);
    return false;
  }

  log(`✓ 完成：vscode-luogu.vsix  ${size} MB  ${((Date.now() - started) / 1000).toFixed(1)}s`);
  log(`  比最新源码新 ${((vsixMtime - newest) / 1000).toFixed(1)}s  (${path.relative(PROJ, newestFile)})`);
  return true;
}

// --- 监听 ---------------------------------------------------------------
let timer = null;
let pending = null;
let building = false;

function schedule(reason) {
  if (building) {
    pending = reason;
    return;
  }
  clearTimeout(timer);
  timer = setTimeout(() => {
    building = true;
    try {
      buildOnce(reason);
    } catch (e) {
      log(`✗ 异常：${e.message}`);
    } finally {
      building = false;
      if (pending) {
        const r = pending;
        pending = null;
        schedule(r);
      }
    }
  }, DEBOUNCE_MS);
}

const watchers = [];
for (const d of WATCH_DIRS) {
  const p = path.join(PROJ, d);
  if (!fs.existsSync(p)) continue;
  watchers.push(
    fs.watch(p, { recursive: true }, (_ev, file) => {
      if (!file) return schedule('目录变动');
      const rel = path.join(d, file.toString());
      if (IGNORE.test(rel)) return;
      if (!EXT.has(path.extname(rel))) return;
      schedule(rel);
    })
  );
}
for (const f of WATCH_FILES) {
  const p = path.join(PROJ, f);
  if (!fs.existsSync(p)) continue;
  watchers.push(fs.watch(p, () => schedule(f)));
}

log(`已监听 ${WATCH_DIRS.join('/')} + ${WATCH_FILES.join('/')}（防抖 ${DEBOUNCE_MS}ms）`);
log(`首次全量构建…`);
buildOnce('启动');
log('READY —— 改源码即自动重打包，Ctrl+C 退出');

process.on('SIGINT', () => {
  watchers.forEach(w => w.close());
  log('已停止监听');
  process.exit(0);
});
