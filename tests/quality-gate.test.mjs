/* 品質ゲートが「本当に見ているか」を確かめるテスト。
 *
 * 0件でしたと出ているだけでは、検査が動いているのか何も見ていないのか区別できない。
 * ここではリポジトリの中身をわざと壊した写しを作り、狙った検査が落ちることを見る。
 * （ファイルは書き換えない。読み手を差し替えているだけ。）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContext, runChecks } from '../scripts/check-project.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

const resultOf = (id, overrides = {}) => {
  const results = runChecks(buildContext(overrides));
  const r = results.find((x) => x.id === id);
  assert.ok(r, `${id} という検査が無い`);
  return r;
};

test('壊していないときは全部通る', () => {
  const failed = runChecks(buildContext()).filter((r) => !r.skip && !r.ok);
  assert.deepEqual(failed.map((r) => r.id), [], `不合格: ${failed.map((r) => `${r.id}(${r.detail})`).join(', ')}`);
});

// ── わざと壊す ────────────────────────────────────────────────────────
const breakages = [
  {
    id: 'LEGAL_LICENSE',
    how: 'LICENSE を消す',
    overrides: { removed: ['LICENSE'] },
  },
  {
    id: 'LEGAL_GITIGNORE',
    how: '.gitignore から node_modules を抜く',
    overrides: { patched: { '.gitignore': 'dist/\n' } },
  },
  {
    id: 'CI_ON_PULL_REQUEST',
    how: 'CI を push だけにする',
    overrides: { patched: { '.github/workflows/ci.yml': 'on:\n  push:\n    branches: [main]\n' } },
  },
  {
    id: 'SECRET_FILES',
    how: '.env をコミットしたことにする',
    overrides: { patched: { '.env': 'TOKEN=x\n' } },
  },
  {
    id: 'NO_LOCALSTORAGE_CLEAR',
    how: 'localStorage.clear() を書く',
    overrides: { patched: { 'src/app.jsx': `${read('src/app.jsx')}\nlocalStorage.clear();\n` } },
  },
  {
    id: 'NO_POSTMESSAGE_STAR',
    how: "postMessage(..., '*') を書く",
    overrides: { patched: { 'src/app.jsx': `${read('src/app.jsx')}\nparent.postMessage(data, '*');\n` } },
  },
  {
    id: 'INITIAL_JS_BUDGET',
    how: '予算を 10KB に絞る',
    overrides: { config: { initialJsLimitBytes: 10 * 1024 } },
  },
  {
    id: 'IMAGE_SIZE',
    how: 'favicon の上限を 1KB にする',
    overrides: { config: { imageLimits: { default: 1024 } } },
  },
  {
    id: 'DEP_BROWSER_BABEL',
    how: '@babel/standalone を読み込む',
    overrides: { patched: { 'index.html': read('index.html').replace('</head>', '<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script></head>') } },
  },
  {
    id: 'DEP_TAILWIND_CDN',
    how: 'cdn.tailwindcss.com を読み込む',
    overrides: { patched: { 'index.html': read('index.html').replace('</head>', '<script src="https://cdn.tailwindcss.com"></script></head>') } },
  },
  {
    id: 'DEP_CDN_SCRIPT',
    how: 'CDN から実行コードを読む',
    overrides: { patched: { 'index.html': read('index.html').replace('</head>', '<script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script></head>') } },
  },
  {
    id: 'VIEWPORT_FIT_COVER',
    how: 'viewport-fit=cover を外す',
    overrides: { patched: { 'index.html': read('index.html').replace(', viewport-fit=cover', '') } },
  },
  {
    id: 'VIEWPORT_NO_ZOOM_LOCK',
    how: 'user-scalable=no を足す',
    overrides: { patched: { 'index.html': read('index.html').replace('initial-scale=1.0', 'initial-scale=1.0, user-scalable=no') } },
  },
  {
    id: 'VIEWPORT_100VH',
    how: '@supports なしで 100vh を書く',
    overrides: { patched: { 'src/style.css': '.foo { height: 100vh; }\n' } },
  },
  {
    id: 'SAFE_AREA',
    how: 'safe-area-inset を全部消す',
    overrides: { patched: { 'src/style.css': read('src/style.css').replaceAll('safe-area-inset', 'xx'), 'offline.html': read('offline.html').replaceAll('safe-area-inset', 'xx') } },
  },
  {
    id: 'REDUCED_MOTION',
    how: 'animation-duration を 0 にする（fill-mode: forwards が壊れる）',
    overrides: { patched: { 'src/style.css': read('src/style.css').replace('animation-duration: .01ms !important;', 'animation-duration: 0s !important;') } },
  },
  {
    id: 'FORCED_COLORS',
    how: 'forced-colors 対応を消す',
    overrides: { patched: { 'src/style.css': read('src/style.css').replaceAll('forced-colors', 'xx'), 'offline.html': read('offline.html').replaceAll('forced-colors', 'xx') } },
  },
  {
    id: 'RUBY_RT_COLOR',
    how: 'rt に色クラスを直接当てる',
    overrides: { patched: { 'src/app.jsx': read('src/app.jsx').replace('<rt\n      className="absolute', '<rt\n      className="text-slate-500 absolute') } },
  },
  {
    id: 'PWA_MANIFEST_IDENTITY',
    how: 'start_url を "./" に戻す',
    overrides: { patched: { 'manifest.webmanifest': read('manifest.webmanifest').replace('"start_url": "/online-manuscript-paper-lite/"', '"start_url": "./"') } },
  },
  {
    id: 'PWA_ICONS',
    how: 'maskable-192 を消す',
    overrides: { removed: ['icons/maskable-192.png'] },
  },
  {
    id: 'PWA_APPLE_TOUCH_ICON',
    how: 'apple-touch-icon に icon-192 を流用する',
    overrides: { patched: { 'index.html': read('index.html').replace('./icons/apple-touch-icon.png', './icons/icon-192.png') } },
  },
  {
    id: 'PWA_INSTALL_HOOK',
    how: 'install-hook.js より前に別のスクリプトを置く',
    overrides: { patched: { 'index.html': read('index.html').replace('<script src="./install-hook.js"></script>', '<script src="./vendor/react.js"></script>\n<script src="./install-hook.js"></script>') } },
  },
  {
    id: 'PWA_SW_CACHE_WIPE',
    // 「消す式」を正規表現で追うと (k) => caches.delete(k) を見落とす。
    // 見るのは「startsWith で絞っているか」なので、この壊し方で落ちる必要がある。
    how: 'startsWith の絞り込みを外して全部消す',
    overrides: { patched: { 'sw.js': read('sw.js').replace(/\.filter\(\(key\) =>[\s\S]*?\)\)\n/, '') } },
  },
  {
    id: 'PWA_SW_LOCALSTORAGE',
    how: 'sw.js から localStorage を触る',
    overrides: { patched: { 'sw.js': `${read('sw.js')}\nlocalStorage.setItem('x', '1');\n` } },
  },
  {
    id: 'PWA_SW_NO_SKIPWAITING_ON_INSTALL',
    how: 'install の中で skipWaiting する',
    overrides: { patched: { 'sw.js': read('sw.js').replace('const cache = await caches.open(CACHE_STATIC);', 'self.skipWaiting();\n    const cache = await caches.open(CACHE_STATIC);') } },
  },
  {
    id: 'PWA_SW_VERSION_BUMPED',
    how: 'APP_VERSION を上げ忘れる',
    // 版は上がっていくので、決め打ちにせず「今の版を古い値に戻す」形で壊す
    overrides: { patched: { 'sw.js': read('sw.js').replace(/const APP_VERSION = '[^']*'/, "const APP_VERSION = 'v0'") } },
  },
  {
    id: 'PWA_SW_REGISTER_READYSTATE',
    how: 'load を待つだけにする（React の effect では二度と呼ばれない）',
    overrides: { patched: { 'src/app.jsx': read('src/app.jsx').replace("if (document.readyState === 'complete') start();\n  else window.addEventListener('load', start, { once: true });", "window.addEventListener('load', start);") } },
  },
  {
    id: 'PWA_OFFLINE_PAGE',
    how: 'offline.html を消す',
    overrides: { removed: ['offline.html'] },
  },
  {
    id: 'CSP_PRESENT',
    how: "script-src に 'unsafe-inline' を足す",
    overrides: { patched: { 'index.html': read('index.html').replace("script-src 'self' file:;", "script-src 'self' file: 'unsafe-inline';") } },
  },
  {
    id: 'CSP_NO_FRAME_ANCESTORS_META',
    how: 'frame-ancestors を <meta> に書く',
    overrides: { patched: { 'index.html': read('index.html').replace("base-uri 'self';", "base-uri 'self'; frame-ancestors 'none';") } },
  },
  {
    id: 'NO_INLINE_HANDLERS',
    how: 'onclick= を書く',
    overrides: { patched: { 'index.html': read('index.html').replace('<div id="root">', '<div id="root"><button onclick="start()">はじめる</button>') } },
  },
  {
    id: 'NO_INLINE_SCRIPT',
    how: 'インラインの <script> を書く',
    overrides: { patched: { 'index.html': read('index.html').replace('</body>', '<script>init();</script></body>') } },
  },
  {
    id: 'BUILD_ARTIFACTS_PRESENT',
    how: '生成物を消す（ビルドし忘れた状態）',
    overrides: { removed: ['js/app.js'] },
  },
  {
    id: 'FILE_SIZE',
    how: '5,000行を超えるファイルを置く',
    overrides: { patched: { 'src/app.jsx': 'const a = 1;\n'.repeat(5100) } },
  },
];

for (const b of breakages) {
  test(`${b.id} は「${b.how}」で落ちる`, () => {
    const r = resultOf(b.id, b.overrides);
    assert.equal(r.ok, false, `${b.id} が落ちなかった（検査が何も見ていない可能性）`);
    assert.ok(r.detail, '落ちた理由が書かれていない');
  });
}

test('壊し方の一覧が、検査の一覧を取りこぼしていない', () => {
  const all = runChecks(buildContext()).map((r) => r.id);
  const covered = new Set(breakages.map((b) => b.id));
  // 環境に依らず壊しようがないものだけを除外する
  const exempt = new Set(['LEGAL_DEPENDABOT', 'DOCS_PRESENT', 'SECRET_INLINE', 'CANVAS_DPR', 'FLUID_TYPE']);
  const uncovered = all.filter((id) => !covered.has(id) && !exempt.has(id));
  assert.deepEqual(uncovered, [], `わざと壊す試験が無い検査: ${uncovered.join(', ')}`);
});
