/* アイコンの生成。
 *
 * 直しているのは3つ。
 *  1. apple-touch-icon が icons/icon-192.png の流用で、透明を9%含んでいた。
 *     iOS は透明を黒で埋めるため、ホーム画面でアイコンの四隅だけが黒く出る。
 *     → 下地を端まで塗った不透明の 180×180 を作る。
 *  2. maskable が「余白あり」型だった。欠けはしないが、切り抜きの内側が
 *     余白色で埋まって縮んで見える。しかも中央80%の円の外に中身が 0.73% あり、
 *     ペン先と「Lite」の帯が切り取られていた（目標は 0.2% 以下）。
 *     → 絵を小さくしたうえで、下地を端まで伸ばす。
 *        単色を敷くと元の絵の下地（左上が明るく右下が影）と合わず輪郭が影として残るので、
 *        元の絵そのものを大きくぼかしたものを下地に使う。
 *  3. favicon.png が 512×512 フルカラーで 248KB あった。
 *     色数の少ない絵をフルカラーで持つ理由はない。favicon に 512 は要らない。
 *
 * sharp はこの1回きりの用途なので package.json には入れていない。
 *   npm i --no-save sharp && node tools/make-icons.mjs
 */
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...s) => join(ROOT, ...s);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

let sharp;
try {
  sharp = createRequire(import.meta.url)('sharp');
} catch {
  console.error('sharp が見つからない。`npm i --no-save sharp` を実行してから、もう一度走らせること。');
  process.exit(1);
}

// 元の絵は一度メモリへ読む。生成の途中で同じファイルを上書きするため、
// 遅延読み込みのまま扱うと「書きかけを読む」ことになる。
const SRC = readFileSync(p('icons/icon-512.png'));
const PAPER = { r: 253, g: 251, b: 247 }; // manifest の background_color と揃える

const before = {};
for (const f of ['favicon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png']) {
  if (existsSync(p(f))) before[f] = statSync(p(f)).size;
}

/* パレット PNG にする。色数を落としながら、いちばん軽くなった版を選ぶ。
 * ⚠️ sharp を通して書き直すとパレットが落ちる。作ったバッファをそのまま書くこと。 */
const writePalette = async (input, dest, size, maxColours = 128) => {
  let best = null;
  for (const colours of [32, 48, 64, 96, maxColours]) {
    const buf = await sharp(input)
      .resize(size, size, { fit: 'cover' })
      .png({ palette: true, colours, effort: 10, compressionLevel: 9 })
      .toBuffer();
    if (!best || buf.length < best.length) best = buf;
  }
  writeFileSync(p(dest), best);
  return best.length;
};

// ── 1. apple-touch-icon（透明を含まない 180×180） ──────────────────────
const appleBuf = await sharp(SRC)
  .resize(180, 180, { fit: 'cover' })
  .flatten({ background: PAPER })       // 透明を下地色で埋める
  .png({ palette: true, colours: 128, effort: 10, compressionLevel: 9 })
  .toBuffer();
writeFileSync(p('icons/apple-touch-icon.png'), appleBuf);

// ── 2. maskable（下地を端まで伸ばし、絵はセーフゾーンの内側に収める） ──
/* 下地の色は決め打ちにせず、元の絵から実際に読む。
 * この絵の下地は角丸四角の内側が一様な #fafafa だったので、同じ色を端まで塗れば
 * 継ぎ目は出ない。（元の下地が左上明るく右下暗い絵であれば、単色を敷くと
 * 角丸四角の輪郭が薄い影として残るため、そのときは元の下地を引き伸ばす必要がある。） */
const readPlateColour = async () => {
  const { data, info } = await sharp(SRC).flatten({ background: PAPER }).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const at = (x, y) => { const i = (y * info.width + x) * ch; return [data[i], data[i + 1], data[i + 2]]; };
  // 角丸四角の内側で、絵が載っていないところを何点か読む
  const pts = [[0.12, 0.12], [0.5, 0.12], [0.88, 0.12], [0.12, 0.88], [0.88, 0.88], [0.06, 0.5], [0.94, 0.5]]
    .map(([fx, fy]) => at(Math.round(info.width * fx), Math.round(info.height * fy)));
  const med = (i) => pts.map((c) => c[i]).sort((a, b) => a - b)[Math.floor(pts.length / 2)];
  return { r: med(0), g: med(1), b: med(2) };
};
const PLATE = await readPlateColour();

const SAFE_SCALE = 0.68; // 中央80%の円に収まるよう、対角も考えて内側に置く
const makeMaskable = async (size) => {
  const artSize = Math.round(size * SAFE_SCALE);
  const art = await sharp(SRC).resize(artSize, artSize, { fit: 'cover' }).toBuffer();
  const offset = Math.round((size - artSize) / 2);

  const buf = await sharp({ create: { width: size, height: size, channels: 4, background: { ...PLATE, alpha: 1 } } })
    .composite([{ input: art, left: offset, top: offset }])
    .png({ palette: true, colours: 128, effort: 10, compressionLevel: 9 })
    .toBuffer();
  writeFileSync(p(`icons/maskable-${size}.png`), buf);
  return buf.length;
};
await makeMaskable(512);
await makeMaskable(192);

// ── 3. favicon と any アイコンのパレット化 ────────────────────────────
// favicon に 512 は要らない。256 で足りる。
const faviconSize = await writePalette(SRC, 'favicon.png', 256, 96);
const icon192 = await writePalette(SRC, 'icons/icon-192.png', 192, 128);
const icon512 = await writePalette(SRC, 'icons/icon-512.png', 512, 128);

// ── 4. セーフゾーンの確認（画素を数える） ────────────────────────────
const safeZoneReport = async (file) => {
  const { data, info } = await sharp(p(file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const at = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; };
  // 下地は切り抜かれてよい。欠けては困る「中身」とを色で区別する。
  const bg = at(1, 1);
  const isBg = (c) => Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]) < 24;
  const cx = W / 2, cy = H / 2, r = W * 0.4;
  let outsideContent = 0, transparent = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = at(x, y);
      if (c[3] < 250) transparent++;
      if (Math.hypot(x - cx, y - cy) <= r) continue;
      if (c[3] >= 250 && !isBg(c)) outsideContent++;
    }
  }
  const total = W * H;
  return {
    file,
    outsidePct: (outsideContent / total) * 100,
    transparentPct: (transparent / total) * 100,
  };
};

console.log('生成物:');
console.log(`  icons/apple-touch-icon.png  ${kb(appleBuf.length)}`);
for (const f of ['icons/maskable-512.png', 'icons/maskable-192.png']) console.log(`  ${f.padEnd(27)} ${kb(statSync(p(f)).size)}`);
console.log(`  favicon.png                 ${kb(faviconSize)}  (前 ${before['favicon.png'] ? kb(before['favicon.png']) : '—'})`);
console.log(`  icons/icon-192.png          ${kb(icon192)}  (前 ${before['icons/icon-192.png'] ? kb(before['icons/icon-192.png']) : '—'})`);
console.log(`  icons/icon-512.png          ${kb(icon512)}  (前 ${before['icons/icon-512.png'] ? kb(before['icons/icon-512.png']) : '—'})`);

console.log(`\n下地として読んだ色: rgb(${PLATE.r}, ${PLATE.g}, ${PLATE.b})`);
console.log('セーフゾーン外の中身（目標 0.2% 以下）:');
for (const f of ['icons/maskable-512.png', 'icons/maskable-192.png']) {
  const r = await safeZoneReport(f);
  console.log(`  ${f.padEnd(27)} 外に出ている中身 ${r.outsidePct.toFixed(2)}%  透明 ${r.transparentPct.toFixed(2)}%`);
}
// apple-touch-icon は円ではなく角丸四角で切られるので、見るのは「透明が無いこと」だけ
const apple = await safeZoneReport('icons/apple-touch-icon.png');
console.log(`  ${'icons/apple-touch-icon.png'.padEnd(27)} 透明 ${apple.transparentPct.toFixed(2)}%（透明があると iOS で四隅が黒くなる）`);
