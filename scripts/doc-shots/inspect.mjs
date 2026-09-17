// Screenshot self-check: decode PNG pixel-by-pixel, no image library needed.
// A "successful" screenshot run does NOT prove the picture is right - Chrome can
// happily capture a blank page or a half-rendered state. So we assert:
//   1. pixel variety (not a flat fill) and real contrast
//   2. presence of VS Code semantic colours => the UI actually painted
//   3. an ASCII downsample so the layout is inspectable as text
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '..', '..', 'docs', 'images');

function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8, width, height, colorType, bitDepth, interlace;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('only 8bit supported, got ' + bitDepth);
  if (interlace) throw new Error('interlaced PNG unsupported');
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error('unsupported colour type ' + colorType);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      const x = line[i];
      let v;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error('bad filter ' + filter);
      }
      cur[i] = v & 0xff;
    }
  }
  return { width, height, at(x, y) {
    const o = y * stride + x * channels;
    return [out[o], channels >= 3 ? out[o + 1] : out[o], channels >= 3 ? out[o + 2] : out[o]];
  } };
}

const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const near = (c, t, tol) => Math.abs(c[0] - t[0]) < tol && Math.abs(c[1] - t[1]) < tol && Math.abs(c[2] - t[2]) < tol;

const KEY = {
  buttonBlue: [14, 99, 156],
  linkBlue: [55, 148, 255],
  acGreen: [115, 201, 145],
  textGray: [204, 204, 204],
  panelBg: [37, 37, 38]
};

function inspect(file) {
  const buf = readFileSync(file);
  const img = decodePNG(buf);
  const { width, height, at } = img;
  const colors = new Set();
  const hits = Object.fromEntries(Object.keys(KEY).map(k => [k, 0]));
  let sum = 0, sumSq = 0, n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = at(x, y);
      if (n % 7 === 0) colors.add((c[0] << 16) | (c[1] << 8) | c[2]);
      const l = lum(c);
      sum += l; sumSq += l * l; n++;
      for (const k of Object.keys(KEY)) if (near(c, KEY[k], 26)) hits[k]++;
    }
  }
  const mean = sum / n;
  const std = Math.sqrt(sumSq / n - mean * mean);

  const CW = 74, CH = 30, ramp = ' .:-=+*#%@';
  const rows = [];
  for (let cy = 0; cy < CH; cy++) {
    let row = '';
    for (let cx = 0; cx < CW; cx++) {
      const x0 = Math.floor((cx * width) / CW), x1 = Math.floor(((cx + 1) * width) / CW);
      const y0 = Math.floor((cy * height) / CH), y1 = Math.floor(((cy + 1) * height) / CH);
      let s = 0, m = 0;
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { s += lum(at(x, y)); m++; }
      const avg = m ? s / m : 0;
      row += ramp[Math.min(ramp.length - 1, Math.floor((avg / 255) * ramp.length))];
    }
    rows.push(row);
  }
  return { width, height, uniqueColors: colors.size, mean, std, hits, rows, bytes: buf.length };
}

const files = readdirSync(outDir).filter(f => f.endsWith('.png')).sort();
console.log(files.length + ' screenshots\n');
let bad = 0;
for (const f of files) {
  const r = inspect(join(outDir, f));
  const p = [];
  if (r.uniqueColors < 200) p.push('too few colours (' + r.uniqueColors + ') - likely blank');
  if (r.std < 12) p.push('near-flat contrast (std=' + r.std.toFixed(1) + ')');
  if (r.hits.textGray < 500) p.push('almost no body-text pixels (' + r.hits.textGray + ')');
  if (r.hits.buttonBlue + r.hits.linkBlue < 100) p.push('no interactive control colour');
  if (p.length) bad++;
  console.log((p.length ? 'FAIL ' : 'OK   ') + f + '  ' + r.width + 'x' + r.height + '  ' +
    (r.bytes / 1024).toFixed(0) + 'KB  colours=' + r.uniqueColors +
    '  lum=' + r.mean.toFixed(1) + ' std=' + r.std.toFixed(1));
  console.log('     keys: ' + Object.keys(r.hits).map(k => k + '=' + r.hits[k]).join('  '));
  if (p.length) console.log('     !! ' + p.join('; '));
  console.log(r.rows.map(l => '   |' + l + '|').join('\n'));
  console.log('');
}
console.log(bad ? bad + ' screenshot(s) failed' : 'all screenshots passed self-check');
process.exit(bad ? 1 : 0);