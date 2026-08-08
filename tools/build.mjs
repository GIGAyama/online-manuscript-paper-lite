/* ビルド（原本 → 生成物）。
 *
 * なぜビルドがあるか：
 *   以前はブラウザへ @babel/standalone（約 3.1MB）を送り、開くたびに JSX を
 *   翻訳させていた。学校のネットワークが unpkg.com などを塞ぐと、
 *   1本届かないだけで画面が真っ白になり、原因がアプリの外にあるので
 *   先生が調べても分からない。だから「先に作っておく」形にした。
 *
 * 原本（ここを直す）           : src/app.jsx / src/style.css / tailwind.config.js
 * 生成物（手で編集しない）     : js/app.js / js/icons.js / css/style.css / vendor/*
 *
 * 生成物は GitHub Pages がそのまま配信するため、リポジトリにコミットする。
 * 原本を直したら必ず `npm run build` を走らせてから push すること。
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...s) => join(ROOT, ...s);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

mkdirSync(p('vendor'), { recursive: true });
mkdirSync(p('js'), { recursive: true });
mkdirSync(p('css'), { recursive: true });

const GENERATED_HEADER = '/* 自動生成ファイル。手で編集しないこと。原本は src/ と tools/build.mjs。 */\n';

// ── 1. vendor（実行コードの自己ホスト） ─────────────────────────────
// react の package.json は exports で umd/ を公開していないため require.resolve は使えない。
// node_modules のパスを直に指す。
const VENDOR = [
  ['node_modules/react/umd/react.production.min.js', 'vendor/react.js'],
  ['node_modules/react-dom/umd/react-dom.production.min.js', 'vendor/react-dom.js'],
  ['node_modules/sweetalert2/dist/sweetalert2.all.min.js', 'vendor/sweetalert2.js'],
];
for (const [from, to] of VENDOR) {
  writeFileSync(p(to), readFileSync(p(from)));
  console.log(`vendor  ${to.padEnd(24)} ${kb(statSync(p(to)).size)}`);
}

// ── 2. アイコン（bootstrap-icons のフォントをやめて SVG を埋め込む） ──
// フォント方式だと CSS 85KB + woff2 128KB を全端末へ送ることになる。
// 実際に使うのは 13 個だけなので、その形だけを取り出す。
const ICON_NAMES = [
  'pencil-square', 'box-arrow-down', 'gear', 'x-lg', 'person-vcard',
  'pencil-fill', 'eye-fill', 'printer', 'file-earmark-plus', 'folder2-open',
  'download', 'arrow-clockwise', 'wifi-off',
];
const icons = {};
for (const name of ICON_NAMES) {
  const svg = readFileSync(p('node_modules/bootstrap-icons/icons', `${name}.svg`), 'utf8');
  const vb = (svg.match(/viewBox="([^"]+)"/) || [, '0 0 16 16'])[1];
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
  icons[name] = { vb, d: inner };
}
writeFileSync(p('js/icons.js'), `${GENERATED_HEADER}window.GENKO_ICONS = ${JSON.stringify(icons)};\n`);
console.log(`icons   ${'js/icons.js'.padEnd(24)} ${kb(statSync(p('js/icons.js')).size)} (${ICON_NAMES.length} 個)`);

// ── 3. アプリ本体（JSX をビルド時に1回だけ翻訳する） ─────────────────
// React と ReactDOM はページ側の <script> で読み込む素の UMD なので、
// ここでは束ねずグローバルとして参照する（バンドルに含めると二重に載る）。
await esbuild.build({
  entryPoints: [p('src/app.jsx')],
  outfile: p('js/app.js'),
  bundle: true,
  format: 'iife',
  loader: { '.jsx': 'jsx' },
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  minify: true,
  target: ['chrome100', 'safari15'],
  banner: { js: GENERATED_HEADER.trim() },
  legalComments: 'none',
});
console.log(`app     ${'js/app.js'.padEnd(24)} ${kb(statSync(p('js/app.js')).size)}`);

// ── 4. CSS（Tailwind をビルド時に生成する） ──────────────────────────
const cssIn = readFileSync(p('src/style.css'), 'utf8');
const result = await postcss([tailwindcss({ config: p('tailwind.config.js') }), autoprefixer]).process(cssIn, {
  from: p('src/style.css'),
  to: p('css/style.css'),
});
const cssMin = await esbuild.transform(result.css, { loader: 'css', minify: true });
writeFileSync(p('css/style.css'), GENERATED_HEADER + cssMin.code);
console.log(`css     ${'css/style.css'.padEnd(24)} ${kb(statSync(p('css/style.css')).size)}`);

// ── 5. 予算の確認（校内Wi-Fiで40人同時を想定） ───────────────────────
const initialJs = ['vendor/react.js', 'vendor/react-dom.js', 'vendor/sweetalert2.js', 'js/icons.js', 'js/app.js', 'install-hook.js']
  .reduce((sum, f) => sum + statSync(p(f)).size, 0);
const assets = [];
const walk = (dir) => {
  for (const e of readdirSync(p(dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const rel = `${dir}/${e.name}`.replace(/^\.\//, '');
    if (e.isDirectory()) walk(rel);
    // docs/ は記事や説明のための置き場で、アプリが読み込むものではない。
    // ここを数えると、note の記事に貼る画面写真が予算を食いつぶす。
    else if (/\.(js|css|png|html|webmanifest|woff2)$/.test(e.name) && !/^(src|tools|scripts|tests|docs)\//.test(rel)) {
      assets.push([rel, statSync(p(rel)).size]);
    }
  }
};
walk('.');
const total = assets.reduce((s, [, n]) => s + n, 0);

console.log('\n初回に必要な JS 合計 :', kb(initialJs), initialJs <= 300 * 1024 ? '(目標 300KB 以下 ✅)' : '(目標 300KB 超過 ❌)');
console.log('総アセット           :', kb(total), total <= 1024 * 1024 ? '(目標 1MB 以下 ✅)' : '(目標 1MB 超過 ❌)');

if (initialJs > 300 * 1024) {
  console.error('\n初回 JS が 300KB を超えた。校内Wi-Fiで40人が同時に開く前提を満たせない。');
  process.exit(1);
}
