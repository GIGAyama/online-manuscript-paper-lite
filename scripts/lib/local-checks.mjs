/* このリポジトリ固有の検査。
 *
 * Part I の共通検査は正本コピー（scripts/lib/giga-v5-checks.mjs、
 * 正本: GIGAyama.github.io/standards/lib/）が受け持つ。ここに残るのは
 * src/（ビルド前の JSX）を見る検査や、このリポジトリだけの決まりごと。
 * 重なりがあっても両方走らせる（片方を消して穴が開くよりよい）。
 *
 * ここは「読めば分かること」だけを見る。読んでも分からないこと
 * （実際に登録されたか／初回にリロードしないか／色が本当に読めるか）は
 * tools/measure/measure.mjs で実ブラウザから測る。両方が要る。
 *
 * ⚠️ 検査を書いたら必ず「わざと壊して落ちること」を確かめる。
 *    0件でしたと出ているだけでは、検査が動いているのか何も見ていないのか区別できない。
 *    tests/quality-gate.test.mjs がそれをやっている。
 */
import { stripComments } from './project-quality.mjs';

const ok = (detail = '') => ({ ok: true, detail });
const ng = (detail) => ({ ok: false, detail });

const htmlFiles = (ctx) => ctx.files.filter((f) => /\.html$/.test(f) && !/^(vendor|node_modules)\//.test(f));
const swFiles = (ctx) => ctx.files.filter((f) => /(^|\/)sw\.js$/.test(f));

export const gigaV5Checks = [
  // ── 依存（v5 の最重要） ────────────────────────────────────────────
  {
    id: 'DEP_BROWSER_BABEL',
    title: 'ブラウザへ @babel/standalone を送っていない',
    run: (ctx) => {
      const bad = htmlFiles(ctx).filter((f) => /babel\/standalone|text\/babel/.test(ctx.read(f) || ''));
      return bad.length ? ng(`${bad.join(', ')}（開くたびにコンパイルし、塞がれると画面が真っ白になる）`) : ok();
    },
  },
  {
    id: 'DEP_TAILWIND_CDN',
    title: 'cdn.tailwindcss.com を使っていない',
    run: (ctx) => {
      const bad = htmlFiles(ctx).filter((f) => /cdn\.tailwindcss\.com/.test(ctx.read(f) || ''));
      return bad.length ? ng(bad.join(', ')) : ok();
    },
  },
  {
    id: 'DEP_CDN_SCRIPT',
    title: 'CDN から取る実行コードが 0 バイト',
    run: (ctx) => {
      const bad = [];
      for (const f of htmlFiles(ctx)) {
        const src = ctx.read(f) || '';
        for (const m of src.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/gi)) {
          if (/^https?:\/\//i.test(m[1])) bad.push(`${f} → ${m[1]}`);
        }
      }
      return bad.length ? ng(bad.join(', ')) : ok();
    },
  },

  // ── 表示 ───────────────────────────────────────────────────────────
  {
    id: 'VIEWPORT_FIT_COVER',
    title: 'viewport に viewport-fit=cover',
    run: (ctx) => {
      const bad = htmlFiles(ctx).filter((f) => {
        const src = ctx.read(f) || '';
        const m = src.match(/<meta[^>]+name=["']viewport["'][^>]*>/i);
        return m && !/viewport-fit\s*=\s*cover/.test(m[0]);
      });
      return bad.length ? ng(bad.join(', ')) : ok();
    },
  },
  {
    id: 'VIEWPORT_NO_ZOOM_LOCK',
    title: '拡大を禁止していない（user-scalable=no / maximum-scale）',
    run: (ctx) => {
      const bad = [...htmlFiles(ctx), ...ctx.files.filter((f) => /\.gs$/.test(f))]
        .filter((f) => /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/.test(ctx.read(f) || ''));
      return bad.length ? ng(`${bad.join(', ')}（見えづらい子が拡大できない害のほうが大きい）`) : ok();
    },
  },
  {
    id: 'VIEWPORT_100VH',
    title: '100vh を単独で使っていない',
    run: (ctx) => {
      const bad = [];
      for (const f of ctx.files) {
        if (!/\.(css|html)$/.test(f) || /^(vendor|node_modules|css)\//.test(f)) continue;
        const lines = (ctx.read(f) || '').split('\n');
        lines.forEach((line, i) => {
          if (!/\b100vh\b/.test(line)) return;
          // 前後を見る。@supports not (height: 100dvh) { … 100vh } は正しい書き方で、
          // 同じ規則の中に dvh があるかどうかを見ないと誤検知する。
          const around = lines.slice(Math.max(0, i - 4), i + 5).join('\n');
          if (/dvh/.test(around)) return;
          bad.push(`${f}:${i + 1}`);
        });
      }
      return bad.length ? ng(bad.join(', ')) : ok();
    },
  },
  {
    id: 'SAFE_AREA',
    title: 'safe-area-inset を使っている',
    run: (ctx) => {
      const found = ctx.files.some((f) => /\.(css|html)$/.test(f) && !/^(vendor|css)\//.test(f) && /safe-area-inset/.test(ctx.read(f) || ''));
      return found ? ok() : ng('ノッチ・ホームバーの領域に入り込む');
    },
  },
  {
    id: 'FLUID_TYPE',
    title: 'clamp() による文字サイズがある',
    run: (ctx) => {
      const found = ctx.files.some((f) => /\.(css)$/.test(f) && !/^(vendor|css)\//.test(f) && /clamp\(/.test(ctx.read(f) || ''));
      return found ? ok() : ng('固定 px だけだと 320px でははみ出し、電子黒板では小さい');
    },
  },
  {
    id: 'CANVAS_DPR',
    title: 'Canvas に devicePixelRatio 補正がある',
    run: (ctx) => {
      const users = ctx.files.filter((f) => /\.(js|jsx|mjs|html)$/.test(f) && !/^(vendor|node_modules|js)\//.test(f)
        && /getContext\(\s*['"]2d['"]/.test(stripComments(ctx.read(f) || '')));
      // 実測ツールの 1px キャンバス（色を読むだけ）は表示に関係しないので除く
      const drawing = users.filter((f) => !/^tools\/measure\//.test(f));
      if (!drawing.length) return { skip: true, detail: '描画に使う Canvas は無い' };
      const bad = drawing.filter((f) => !/devicePixelRatio/.test(ctx.read(f) || ''));
      return bad.length ? ng(bad.join(', ')) : ok();
    },
  },
  {
    id: 'REDUCED_MOTION',
    title: 'prefers-reduced-motion 対応（.01ms であって 0 でない）',
    run: (ctx) => {
      const files = ctx.files.filter((f) => /\.(css|html)$/.test(f) && !/^(vendor|css)\//.test(f));
      const withRule = files.filter((f) => /prefers-reduced-motion/.test(ctx.read(f) || ''));
      if (!withRule.length) return ng('指定が無い');
      for (const f of withRule) {
        const src = ctx.read(f) || '';
        const block = src.slice(src.indexOf('prefers-reduced-motion'));
        const head = block.slice(0, 600);
        if (/animation-duration:\s*0s?\s*!/.test(head) || /transition-duration:\s*0s?\s*!/.test(head)) {
          return ng(`${f}: 0 にすると fill-mode: forwards が壊れ、フェードインする要素が消える`);
        }
      }
      return ok();
    },
  },
  {
    id: 'FORCED_COLORS',
    title: 'forced-colors（ハイコントラスト）対応',
    run: (ctx) => {
      const found = ctx.files.some((f) => /\.(css|html)$/.test(f) && !/^(vendor|css)\//.test(f) && /forced-colors/.test(ctx.read(f) || ''));
      return found ? ok() : ng('背景色が無効化されると押せると分からなくなる');
    },
  },
  {
    id: 'RUBY_RT_COLOR',
    title: 'rt（ふりがな）の色を決め打ちしていない',
    run: (ctx) => {
      const files = ctx.files.filter((f) => /\.(css|html|jsx?)$/.test(f) && !/^(vendor|css|js)\//.test(f));
      let declaresRt = false;
      let inherits = false;
      for (const f of files) {
        const src = ctx.read(f) || '';
        if (/(^|\s|,)rt\s*\{/.test(src)) declaresRt = true;
        // 色のついた面では継がせているか（まとめて継がせるのが正しい）
        if (/rt\s*\{\s*color:\s*inherit|rt\s*\{[^}]*inherit/.test(src)) inherits = true;
        // JSX 側で rt に色クラスを直接当てていないか
        if (/<rt[^>]*className=["'][^"']*text-(slate|gray|zinc|neutral|stone)-\d+/.test(src)) {
          return ng(`${f}: rt に色クラスを直接当てている。色のついた面の上で読めなくなる`);
        }
      }
      if (!declaresRt) return { skip: true, detail: 'rt の指定が無い' };
      return inherits ? ok() : ng('白地の既定値だけで、色のついた面で継がせる指定が無い');
    },
  },

  // ── PWA ────────────────────────────────────────────────────────────
  {
    id: 'PWA_MANIFEST_IDENTITY',
    title: 'manifest の id / scope / start_url が配信場所と合っている',
    run: (ctx) => {
      const src = ctx.read('manifest.webmanifest');
      if (!src) return ng('manifest.webmanifest が無い');
      const m = JSON.parse(src);
      const want = ctx.config.basePath;
      const bad = ['id', 'scope', 'start_url'].filter((k) => m[k] !== want);
      return bad.length ? ng(`${bad.join(' / ')} が ${want} でない`) : ok(want);
    },
  },
  {
    id: 'PWA_ICONS',
    title: 'アイコン4種と apple-touch-icon が揃っている',
    run: (ctx) => {
      const need = ['icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-192.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png'];
      const missing = need.filter((f) => !ctx.exists(f));
      return missing.length ? ng(`${missing.join(', ')} が無い`) : ok();
    },
  },
  {
    id: 'PWA_APPLE_TOUCH_ICON',
    title: 'apple-touch-icon に icon-192 を流用していない',
    run: (ctx) => {
      const bad = [];
      for (const f of htmlFiles(ctx)) {
        const src = ctx.read(f) || '';
        for (const m of src.matchAll(/<link[^>]+rel=["']apple-touch-icon["'][^>]*>/gi)) {
          const href = (m[0].match(/href=["']([^"']+)["']/) || [])[1] || '';
          if (/icon-\d+\.png/.test(href)) bad.push(`${f} → ${href}`);
        }
      }
      return bad.length ? ng(`${bad.join(', ')}（透明が黒で埋まり iOS で四隅が黒くなる）`) : ok();
    },
  },
  {
    id: 'PWA_INSTALL_HOOK',
    title: 'beforeinstallprompt を head 最上部の外部ファイルで捕まえている',
    run: (ctx) => {
      if (!ctx.exists('install-hook.js')) return ng('install-hook.js が無い');
      if (!/beforeinstallprompt/.test(ctx.read('install-hook.js') || '')) return ng('install-hook.js が捕まえていない');
      for (const f of htmlFiles(ctx)) {
        const src = ctx.read(f) || '';
        if (!/install-hook\.js/.test(src)) continue;
        const hookAt = src.indexOf('install-hook.js');
        const others = [...src.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
          .filter((m) => !/install-hook\.js/.test(m[1]));
        const earlier = others.filter((m) => m.index < hookAt);
        if (earlier.length) return ng(`${f}: ${earlier[0][1]} のほうが先。合図を取りこぼす`);
        if (/<script[^>]*\bdefer\b[^>]*install-hook\.js|install-hook\.js[^>]*\bdefer\b/.test(src)) {
          return ng(`${f}: install-hook.js に defer が付いている。同期読み込みにすること`);
        }
      }
      return ok();
    },
  },
  {
    id: 'PWA_SW_CACHE_WIPE',
    title: 'sw.js が自アプリ接頭辞のキャッシュだけを消す',
    run: (ctx) => {
      const files = swFiles(ctx);
      if (!files.length) return ng('sw.js が無い');
      for (const f of files) {
        const src = stripComments(ctx.read(f) || '');
        if (!/caches\.keys\(\)/.test(src)) continue;
        // 「消す式」を正規表現で追うと (k) => caches.delete(k) のような書き方を見落とす。
        // 見るべきは「startsWith で自アプリに絞っているか」。
        const narrowed = /\.filter\([^)]*startsWith\s*\(/s.test(src)
          || /startsWith\([^)]*\)\s*&&/.test(src);
        if (!narrowed) return ng(`${f}: caches.keys() を絞らずに消している。同じオリジンの他アプリがオフラインで起動しなくなる`);
      }
      return ok();
    },
  },
  {
    id: 'PWA_SW_LOCALSTORAGE',
    title: 'sw.js が localStorage に触れていない',
    run: (ctx) => {
      const bad = swFiles(ctx).filter((f) => {
        // 「localStorage は操作しない」という注意書きに反応しないよう、判定前にコメントを落とす
        const src = stripComments(ctx.read(f) || '');
        return /localStorage/.test(src);
      });
      return bad.length ? ng(bad.join(', ')) : ok();
    },
  },
  {
    id: 'PWA_SW_NO_SKIPWAITING_ON_INSTALL',
    title: 'install の中で skipWaiting していない',
    run: (ctx) => {
      for (const f of swFiles(ctx)) {
        const src = stripComments(ctx.read(f) || '');
        const i = src.indexOf("addEventListener('install'");
        if (i < 0) continue;
        const j = src.indexOf("addEventListener('activate'");
        const installBlock = src.slice(i, j > i ? j : src.length);
        if (/skipWaiting\s*\(/.test(installBlock)) {
          return ng(`${f}: 児童が操作している最中に中身が入れ替わり、打ちかけの入力が消える`);
        }
      }
      return ok();
    },
  },
  {
    id: 'PWA_SW_VERSION_BUMPED',
    title: 'sw.js の版が自動生成されている',
    run: (ctx) => {
      const files = swFiles(ctx);
      if (!files.length) return ng('sw.js が無い');
      // 手で上げる運用は上げ忘れが起きる（2026-08-21 に全リポジトリで同時に漏れた）。
      // 版は tools/build-sw.mjs が先読み対象の中身から決め、CI の --check がずれを止める。
      // ここでは「自動生成の形になっているか」を見る。
      if (!ctx.files.includes('tools/build-sw.mjs')) {
        return ng('tools/build-sw.mjs が無い。版の自動生成が外れている');
      }
      const bad = files.filter((f) => {
        const m = /APP_VERSION\s*=\s*['"]([^'"]*)['"];?\s*\/\* __APP_VERSION__ \*\//.exec(ctx.read(f) || '');
        return !m || m[1] === 'v0' || m[1] === 'dev';
      });
      return bad.length
        ? ng(`${bad.join(', ')}: 版が自動生成の形（__APP_VERSION__ の目印つき）になっていない`)
        : ok('自動生成');
    },
  },
  {
    id: 'PWA_SW_REGISTER_READYSTATE',
    title: 'Service Worker の登録に readyState の分岐がある',
    run: (ctx) => {
      const files = ctx.files.filter((f) => /\.(js|jsx|mjs|html)$/.test(f) && !/^(vendor|node_modules|js)\//.test(f)
        && /serviceWorker\s*\.\s*register/.test(ctx.read(f) || ''));
      if (!files.length) return ng('登録している場所が無い');
      const bad = files.filter((f) => {
        const src = ctx.read(f) || '';
        if (!/addEventListener\(\s*['"]load['"]/.test(src)) return false; // load を待っていないなら分岐は不要
        return !/readyState\s*===?\s*['"]complete['"]/.test(src);
      });
      return bad.length ? ng(`${bad.join(', ')}: load が済んでいるとリスナーは付くが二度と呼ばれない`) : ok();
    },
  },
  {
    id: 'PWA_OFFLINE_PAGE',
    title: 'offline.html があり、外部資産にも JS にも頼らない',
    run: (ctx) => {
      const src = ctx.read('offline.html');
      if (!src) return ng('offline.html が無い');
      if (/<script/i.test(src)) return ng('JavaScript に頼っている');
      if (/https?:\/\//.test(src.replace(/<!--[\s\S]*?-->/g, ''))) return ng('外部の資産を読んでいる');
      return ok();
    },
  },

  // ── セキュリティ ───────────────────────────────────────────────────
  {
    id: 'CSP_PRESENT',
    title: 'CSP があり、script-src に unsafe-inline が無い',
    run: (ctx) => {
      for (const f of htmlFiles(ctx)) {
        if (f === 'offline.html') continue;
        const src = ctx.read(f) || '';
        const m = src.match(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/i);
        if (!m) return ng(`${f}: CSP が無い`);
        // ⚠️ content=["']…["'] のように書くと、値の中の 'self' の ' で切れてしまい、
        //    script-src を取り出せずに何も見ないまま通る。引用符は後方参照で合わせる。
        const content = (m[0].match(/content=(["'])([\s\S]*?)\1/) || [])[2] || '';
        const scriptSrc = (content.match(/script-src([^;]*)/) || [])[1] || '';
        if (/unsafe-inline|unsafe-eval/.test(scriptSrc)) return ng(`${f}: script-src に unsafe-inline があると CSP を入れた意味がほとんど無い`);
      }
      return ok();
    },
  },
  {
    id: 'CSP_NO_FRAME_ANCESTORS_META',
    title: 'frame-ancestors を <meta> に書いていない',
    run: (ctx) => {
      for (const f of htmlFiles(ctx)) {
        const src = ctx.read(f) || '';
        const m = src.match(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/i);
        if (m && /frame-ancestors/.test(m[0])) return ng(`${f}: <meta> では無視され、警告が出るだけになる`);
      }
      return ok();
    },
  },
  {
    id: 'NO_INLINE_HANDLERS',
    title: 'onclick= などのインライン属性が無い（CSP で動かなくなる）',
    run: (ctx) => {
      const bad = [];
      for (const f of htmlFiles(ctx)) {
        const src = (ctx.read(f) || '').replace(/<!--[\s\S]*?-->/g, '');
        if (/\son(click|change|input|submit|load)\s*=\s*["']/i.test(src)) bad.push(f);
      }
      return bad.length ? ng(bad.join(', ')) : ok();
    },
  },
  {
    id: 'NO_INLINE_SCRIPT',
    title: 'インラインの <script> が無い',
    run: (ctx) => {
      const bad = [];
      for (const f of htmlFiles(ctx)) {
        const src = (ctx.read(f) || '').replace(/<!--[\s\S]*?-->/g, '');
        for (const m of src.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
          if (m[1].trim()) bad.push(f);
        }
      }
      return bad.length ? ng(`${[...new Set(bad)].join(', ')}: CSP の script-src 'self' では実行されない`) : ok();
    },
  },

  // ── 生成物 ─────────────────────────────────────────────────────────
  {
    id: 'BUILD_ARTIFACTS_PRESENT',
    title: '生成物が揃っている（GitHub Pages はこれをそのまま配る）',
    run: (ctx) => {
      const need = ctx.config.buildArtifacts || [];
      const missing = need.filter((f) => !ctx.exists(f));
      return missing.length ? ng(`${missing.join(', ')} が無い。npm run build を走らせてから push すること`) : ok();
    },
  },
];
