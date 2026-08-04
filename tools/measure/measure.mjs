/* 実ブラウザで開いて測る。読むだけでは分からないことを、実際に押して確かめる。
 *
 *   node tools/measure/measure.mjs            … このリポジトリを測る
 *   node tools/measure/measure.mjs --json out.json
 *
 * playwright-core は入れていない（CI では走らせない）。手元で測るときだけ:
 *   npm i --no-save playwright-core
 * ブラウザは環境にあるものを使う。PLAYWRIGHT_CHROMIUM で場所を指定できる。
 */
import { readFileSync, writeFileSync, cpSync, mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SCAN = readFileSync(join(HERE, 'scan.js'), 'utf8');
const PORT = Number(process.env.MEASURE_PORT || 8181);
const BASE = `http://127.0.0.1:${PORT}/`;

let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)('playwright-core'));
} catch {
  console.error('playwright-core が見つからない。`npm i --no-save playwright-core` を実行すること。');
  process.exit(1);
}

const findChromium = () => {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && existsSync(base)) {
    const dir = readdirSync(base).find((d) => /^chromium-\d+$/.test(d));
    if (dir) return join(base, dir, 'chrome-linux', 'chrome');
  }
  return undefined; // playwright-core の既定に任せる
};

const VIEWPORTS = [
  { name: 'Chromebook 1366x768', width: 1366, height: 768 },
  { name: 'iPad 810x1080', width: 810, height: 1080 },
  { name: 'iPhone SE 375x667', width: 375, height: 667 },
  { name: '最小 320x568', width: 320, height: 568 },
];

// 画面を歩く。開くだけでなく、押して開いたところまで測る。
const SCREENS = [
  { name: '初期表示', act: async () => {} },
  {
    name: '入力あり',
    act: async (page) => {
      await page.fill('input[name="title"]', 'ぼくの夏休み').catch(() => {});
      await page.fill('input[name="class"]', '三年二組').catch(() => {});
      await page.fill('input[name="name"]', 'やまだ たろう').catch(() => {});
      await page.fill('textarea[name="content"]', 'きのう、家族で海に行った。\n「およげるかな。」とお父さんが言った。とても楽しかった！').catch(() => {});
      await page.waitForTimeout(300);
    },
  },
  {
    name: 'プレビュー',
    act: async (page) => {
      await page.fill('textarea[name="content"]', 'きのう、家族で海に行った。\n「およげるかな。」とお父さんが言った。').catch(() => {});
      await page.click('button:has-text("をみる")').catch(() => {});
      await page.waitForTimeout(500);
    },
  },
  {
    name: '設定モーダル',
    act: async (page) => {
      await page.click('button[aria-label="設定をひらく"], button[title="設定"]').catch(() => {});
      await page.waitForTimeout(400);
    },
  },
];

/* ⚠️ 前回の測定が途中で落ちてサーバーが残っていると、こちらの起動が黙って失敗し、
 *    ブラウザは「前回の測定用ディレクトリ」を見にいく。直したはずの CSS が
 *    直っていないように見え、原因が分からなくなる。使う前に必ず塞がっていないか見る。 */
const assertPortFree = () => new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', (err) => reject(new Error(
    `ポート ${PORT} が使われている（${err.code}）。前回の測定のサーバーが残っている可能性がある。`
    + ' `pkill -f tools/measure/serve.mjs` してから、もう一度走らせること。',
  )));
  probe.once('listening', () => probe.close(() => resolve()));
  probe.listen(PORT, '127.0.0.1');
});

const serveDir = (dir) => spawn(process.execPath, [join(HERE, 'serve.mjs'), dir, String(PORT)], { stdio: 'ignore' });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  await assertPortFree();
  // sw.js を書き換えて更新の挙動を測るため、リポジトリの複製を配る
  const work = mkdtempSync(join(tmpdir(), 'genko-measure-'));
  for (const entry of ['index.html', 'offline.html', 'manifest.webmanifest', 'sw.js', 'install-hook.js', 'favicon.png', 'css', 'js', 'vendor', 'icons']) {
    if (existsSync(join(ROOT, entry))) cpSync(join(ROOT, entry), join(work, entry), { recursive: true });
  }
  const server = serveDir(work);
  await wait(600);

  const executablePath = findChromium();
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
  const report = {
    url: BASE,
    consoleErrors: [], pageErrors: [], cspViolations: [], failedRequests: [],
    screens: [], pwa: {},
  };

  const attach = (page, where) => {
    page.on('console', (m) => {
      const t = m.text();
      if (/Content Security Policy|Refused to (load|execute|apply)/i.test(t)) report.cspViolations.push(`[${where}] ${t}`);
      else if (m.type() === 'error') report.consoleErrors.push(`[${where}] ${t}`);
    });
    page.on('pageerror', (e) => report.pageErrors.push(`[${where}] ${e.message}`));
    page.on('requestfailed', (r) => {
      // Google Fonts は学校のフィルタリングと同じ状態を再現するため、届かなくてよい
      if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) return;
      report.failedRequests.push(`[${where}] ${r.url()} :: ${r.failure()?.errorText}`);
    });
  };

  // ── 表示（コントラスト・タップ・横スクロール） ────────────────────
  for (const vp of VIEWPORTS) {
    for (const screen of SCREENS) {
      const where = `${vp.name}/${screen.name}`;
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      attach(page, where);
      await page.goto(BASE, { waitUntil: 'load' }).catch((e) => report.pageErrors.push(`goto ${where}: ${e.message}`));
      await page.waitForTimeout(900);
      await screen.act(page);
      // CSP が効いているので addScriptTag（DOM に <script> を挿す）は弾かれる。
      // 検査そのものは CDP 経由で流し込む。
      await page.evaluate(SCAN);
      const [contrast, placeholders, taps, overflow, rendered] = await Promise.all([
        page.evaluate(() => window.__gigaScan.contrast()),
        page.evaluate(() => window.__gigaScan.placeholders()),
        page.evaluate(() => window.__gigaScan.tapTargets()),
        page.evaluate(() => window.__gigaScan.overflowX()),
        page.evaluate(() => document.querySelectorAll('#root *').length),
      ]);
      report.screens.push({ viewport: vp.name, screen: screen.name, rendered, contrast, placeholders, taps, overflow });
      await ctx.close();
    }
  }

  // ── PWA の挙動（§7-5） ─────────────────────────────────────────────
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await ctx.newPage();
    attach(page, 'PWA');

    // (1) まっさらな状態で1回開き、画面遷移の回数を数える。1回なら正常、2回なら勝手にリロードしている
    let navigations = 0;
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations += 1; });
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForTimeout(3000);
    report.pwa.firstVisitNavigations = navigations;

    // (2) Service Worker が実際に登録されているか（sw.js を読んでも分からない）
    report.pwa.registered = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return !!(reg && (reg.active || reg.installing || reg.waiting));
    });
    report.pwa.controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
    report.pwa.caches = await page.evaluate(() => caches.keys());

    // (3) 他アプリのキャッシュを巻き添えにしないか
    await page.evaluate(async () => {
      const c = await caches.open('other-app-static-v1');
      await c.put('/other-app-marker', new Response('別アプリの控え'));
    });

    // (4) 版を上げる → 3秒放置して waiting のままか（押すまで切り替わらない）
    const swPath = join(work, 'sw.js');
    writeFileSync(swPath, readFileSync(swPath, 'utf8').replace("const APP_VERSION = 'v2';", "const APP_VERSION = 'v3';"));
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1200);
    await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); if (r) await r.update(); });
    // 新しい版が待機に入るまで待つ（入るのに数秒かかることがある）
    const isWaiting = () => page.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      return !!(r && r.waiting);
    });
    for (let i = 0; i < 30 && !(await isWaiting()); i++) await wait(500);
    // 待機に入ってから、さらに3秒放置しても待機のままか。
    // ここが本題。勝手に切り替わると、書きかけの作文が消える。
    await page.waitForTimeout(3000);
    report.pwa.waitingAfter3s = await isWaiting();
    report.pwa.updateBannerVisible = await page.locator('text=あたらしい ばんが あります').isVisible().catch(() => false);
    report.pwa.cachesBeforeApply = await page.evaluate(() => caches.keys());

    // (5) 押したら切り替わるか
    if (report.pwa.updateBannerVisible) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'load', timeout: 15000 }).catch(() => {}),
        page.click('button:has-text("さいしんに する")'),
      ]);
      await page.waitForTimeout(2500);
    }
    report.pwa.cachesAfterApply = await page.evaluate(() => caches.keys());
    report.pwa.otherAppCacheSurvived = report.pwa.cachesAfterApply.includes('other-app-static-v1');
    report.pwa.oldCacheRemoved = !report.pwa.cachesAfterApply.some((k) => k.includes('genko-lite-static-v2'));

    /* (6) 圏外で起動するか
     *
     * ⚠️ context.setOffline(true) だけでは足りない。
     *    Service Worker 自身の fetch はこれを素通りしてサーバーへ届いてしまい、
     *    「キャッシュから出た」ように見えて実際はネットワークから出ている。
     *    実測でも、控えを消したのに本体が表示され、offline.html が出なかった。
     *    サーバーそのものを止めるのが、本当の圏外である。 */
    server.kill();
    await wait(500);
    await ctx.setOffline(true);
    await page.goto(BASE, { waitUntil: 'load' }).catch(() => {});
    await page.waitForTimeout(1200);
    report.pwa.worksOffline = await page.evaluate(() => !!document.querySelector('textarea[name="content"]'));

    // (7) 本体の控えが無ければ offline.html が出るか
    await page.evaluate(async () => {
      for (const key of await caches.keys()) {
        const c = await caches.open(key);
        for (const req of await c.keys()) {
          if (/index\.html$|\/$/.test(new URL(req.url).pathname)) await c.delete(req);
        }
      }
    });
    await page.goto(`${BASE}?offline-test`, { waitUntil: 'load' }).catch(() => {});
    await page.waitForTimeout(800);
    report.pwa.offlineFallbackShown = await page.evaluate(() => /つながっていません/.test(document.body.textContent || ''));
    await ctx.close();
  }

  await browser.close();
  server.kill();   // 圏外の測定で止めているが、途中で抜けた場合に備えて念のため
  process.on('exit', () => { try { server.kill(); } catch { /* すでに終わっている */ } });
  rmSync(work, { recursive: true, force: true });

  const jsonIdx = process.argv.indexOf('--json');
  const out = JSON.stringify(report, null, 2);
  if (jsonIdx >= 0 && process.argv[jsonIdx + 1]) writeFileSync(process.argv[jsonIdx + 1], out);

  // ── まとめ ────────────────────────────────────────────────────────
  const uniq = (key) => {
    const m = new Map();
    for (const s of report.screens) for (const c of s[key]) m.set(`${c.path}|${c.text}`, c);
    return [...m.values()];
  };
  const contrast = uniq('contrast');
  const placeholders = uniq('placeholders');
  const taps = (() => {
    const m = new Map();
    for (const s of report.screens) for (const c of s.taps) m.set(`${c.path}|${c.label}`, c);
    return [...m.values()];
  })();
  const overflow = report.screens.filter((s) => s.overflow.scrollWidth > s.overflow.clientWidth + 1);

  console.log('=== 表示 ===');
  console.log(`コントラスト基準未満 : ${contrast.length} 件`);
  for (const c of contrast) console.log(`   ${c.ratio} (要 ${c.need}) ${c.color} on ${c.bg} 「${c.text}」`);
  console.log(`案内文（プレースホルダ）: ${placeholders.length} 件`);
  for (const c of placeholders) console.log(`   ${c.ratio} (要 ${c.need}) ${c.color} on ${c.bg} 「${c.text}」`);
  console.log(`タップ44px未満       : ${taps.length} 件`);
  for (const t of taps) console.log(`   ${t.w}x${t.h} 「${t.label}」 ${t.path.split(' > ').pop()}`);
  console.log(`横スクロール発生     : ${overflow.length} 件`);
  console.log(`JS エラー            : ${report.pageErrors.length} 件`);
  for (const e of report.pageErrors) console.log(`   ${e}`);
  console.log(`コンソールエラー     : ${report.consoleErrors.length} 件`);
  for (const e of report.consoleErrors) console.log(`   ${e}`);
  console.log(`CSP 違反             : ${report.cspViolations.length} 件`);
  for (const e of report.cspViolations) console.log(`   ${e}`);
  console.log(`読み込み失敗         : ${report.failedRequests.length} 件（Google Fonts は除外）`);
  for (const e of report.failedRequests) console.log(`   ${e}`);

  console.log('\n=== PWA ===');
  const yn = (v) => (v ? '✅' : '❌');
  console.log(`初回訪問の画面遷移       : ${report.pwa.firstVisitNavigations} 回 ${report.pwa.firstVisitNavigations === 1 ? '✅' : '❌ 勝手にリロードしている'}`);
  console.log(`Service Worker の登録    : ${yn(report.pwa.registered)}`);
  console.log(`3秒放置で waiting のまま : ${yn(report.pwa.waitingAfter3s)}（押すまで切り替わらない）`);
  console.log(`更新の案内が出た         : ${yn(report.pwa.updateBannerVisible)}`);
  console.log(`押したら古い版が消えた   : ${yn(report.pwa.oldCacheRemoved)}`);
  console.log(`他アプリのキャッシュ残存 : ${yn(report.pwa.otherAppCacheSurvived)}`);
  console.log(`圏外で起動する           : ${yn(report.pwa.worksOffline)}`);
  console.log(`offline.html が出る      : ${yn(report.pwa.offlineFallbackShown)}`);
  console.log(`キャッシュ一覧           : ${report.pwa.cachesAfterApply.join(', ')}`);

  const failed = contrast.length || placeholders.length || taps.length || overflow.length
    || report.pageErrors.length || report.cspViolations.length || report.failedRequests.length
    || report.pwa.firstVisitNavigations !== 1 || !report.pwa.registered || !report.pwa.waitingAfter3s
    || !report.pwa.otherAppCacheSurvived || !report.pwa.worksOffline || !report.pwa.offlineFallbackShown;
  process.exit(failed ? 1 : 0);
};

main();
