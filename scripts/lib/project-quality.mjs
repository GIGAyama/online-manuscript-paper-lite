/* 共通の品質検査（どのリポジトリでも同じもの）。
 *
 * ⚠️ この節はフリート共通の「正本」を丸ごと差し替えて受け取れる形にしてある。
 *    正本（scripts/lib/project-quality.mjs）が配られたら、このファイルをバイト単位で
 *    置き換えること。このリポジトリ固有の検査は giga-v5-checks.mjs 側にある。
 *    現時点では正本を入手できていないため、同じインタフェースで最小限を実装してある。
 *
 * 検査の形： { id, title, run(ctx) -> { ok, detail } | { skip, detail } }
 *   ctx.read(path)   … ファイルの中身（無ければ null）
 *   ctx.exists(path) … あるか
 *   ctx.size(path)   … バイト数（無ければ 0）
 *   ctx.files        … 対象ファイルの相対パス一覧（node_modules と .git は除く）
 *   ctx.config       … quality.config.json の中身
 */

export const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

/* 配信されるコードだけを見る。検査そのもの（scripts/ tools/ tests/）は
 * 「localStorage.clear() を探す正規表現」のような文字列を含むので、
 * 一緒に走査すると自分自身に反応する。 */
export const isShipped = (f) => !/^(vendor|node_modules|scripts|tools|tests)\//.test(f);

const ok = (detail = '') => ({ ok: true, detail });
const ng = (detail) => ({ ok: false, detail });

export const projectQualityChecks = [
  {
    id: 'LEGAL_LICENSE',
    title: 'LICENSE が実ファイルとして置かれている',
    run: (ctx) => (ctx.exists('LICENSE') ? ok() : ng('LICENSE が無い')),
  },
  {
    id: 'LEGAL_GITIGNORE',
    title: '.gitignore に node_modules がある',
    run: (ctx) => {
      const src = ctx.read('.gitignore');
      if (!src) return ng('.gitignore が無い');
      return /node_modules/.test(src) ? ok() : ng('node_modules が書かれていない');
    },
  },
  {
    id: 'LEGAL_DEPENDABOT',
    title: '.github/dependabot.yml がある',
    run: (ctx) => (ctx.exists('.github/dependabot.yml') ? ok() : ng('dependabot.yml が無い')),
  },
  {
    id: 'DOCS_PRESENT',
    title: 'README / MANUAL / AUDIT が揃っている',
    run: (ctx) => {
      const missing = ['README.md', 'MANUAL.md', 'AUDIT.md'].filter((f) => !ctx.exists(f));
      return missing.length ? ng(`${missing.join(' / ')} が無い`) : ok();
    },
  },
  {
    id: 'CI_ON_PULL_REQUEST',
    title: 'CI が pull_request でも動く',
    run: (ctx) => {
      const files = ctx.files.filter((f) => f.startsWith('.github/workflows/'));
      if (!files.length) return ng('ワークフローが無い');
      const src = files.map((f) => ctx.read(f)).join('\n');
      return /pull_request/.test(src) ? ok() : ng('push だけで pull_request が無い。PR の時点で落ちていることに気づけない');
    },
  },
  {
    id: 'SECRET_FILES',
    title: '秘密になりうるファイルがコミットされていない',
    run: (ctx) => {
      const bad = ctx.files.filter((f) => /(^|\/)(\.env|\.clasp\.json|service-account.*\.json)$/.test(f));
      return bad.length ? ng(`${bad.join(', ')} が入っている`) : ok();
    },
  },
  {
    id: 'SECRET_INLINE',
    title: 'APIキーらしき直書きが無い',
    run: (ctx) => {
      const hits = [];
      for (const f of ctx.files) {
        if (!/\.(js|jsx|mjs|html|json|gs)$/.test(f)) continue;
        if (!isShipped(f)) continue;
        const src = ctx.read(f) || '';
        src.split('\n').forEach((line, i) => {
          if (/AIza[0-9A-Za-z_-]{35}|sk-[A-Za-z0-9]{32,}|ghp_[A-Za-z0-9]{36}/.test(line)) hits.push(`${f}:${i + 1}`);
        });
      }
      // 値は写さない。ファイル名と行番号だけを出す。
      return hits.length ? ng(`${hits.join(', ')} に鍵らしき文字列がある`) : ok();
    },
  },
  {
    id: 'NO_LOCALSTORAGE_CLEAR',
    title: 'localStorage.clear() を使っていない',
    run: (ctx) => {
      const hits = [];
      for (const f of ctx.files) {
        if (!/\.(js|jsx|mjs|html)$/.test(f) || !isShipped(f)) continue;
        if (/localStorage\s*\.\s*clear\s*\(/.test(stripComments(ctx.read(f) || ''))) hits.push(f);
      }
      return hits.length ? ng(`${hits.join(', ')}（他のアプリの記録まで消える）`) : ok();
    },
  },
  {
    id: 'NO_POSTMESSAGE_STAR',
    title: 'postMessage の宛先が * でない',
    run: (ctx) => {
      const hits = [];
      for (const f of ctx.files) {
        if (!/\.(js|jsx|mjs|html)$/.test(f) || !isShipped(f)) continue;
        if (/postMessage\s*\([^)]*,\s*['"]\*['"]\s*\)/.test(stripComments(ctx.read(f) || ''))) hits.push(f);
      }
      return hits.length ? ng(hits.join(', ')) : ok();
    },
  },
  {
    id: 'FILE_SIZE',
    title: '1ファイルが 5,000行 / 400KB を超えない',
    run: (ctx) => {
      const bad = [];
      for (const f of ctx.files) {
        if (!/\.(js|jsx|mjs|css|html)$/.test(f) || /^(vendor|node_modules)\//.test(f)) continue;
        if (/^tests\//.test(f)) continue;
        const src = ctx.read(f) || '';
        const lines = src.split('\n').length;
        const bytes = Buffer.byteLength(src);
        if (lines > 5000 || bytes > 400 * 1024) bad.push(`${f} (${lines}行 / ${(bytes / 1024).toFixed(0)}KB)`);
      }
      return bad.length ? ng(bad.join(', ')) : ok();
    },
  },
  {
    id: 'IMAGE_SIZE',
    title: '画像が 150KB を超えない（PWA アイコンは別枠）',
    run: (ctx) => {
      const limits = ctx.config.imageLimits || {};
      const bad = [];
      for (const f of ctx.files) {
        if (!/\.(png|jpe?g|webp|gif)$/i.test(f)) continue;
        const limit = limits[f] || limits.default || 150 * 1024;
        const size = ctx.size(f);
        if (size > limit) bad.push(`${f} ${(size / 1024).toFixed(1)}KB > ${(limit / 1024).toFixed(0)}KB`);
      }
      return bad.length ? ng(bad.join(', ')) : ok();
    },
  },
  {
    id: 'INITIAL_JS_BUDGET',
    title: '初回に必要な JS が予算内',
    run: (ctx) => {
      const list = ctx.config.initialJs || [];
      if (!list.length) return { skip: true, detail: 'quality.config.json に initialJs が無い' };
      const total = list.reduce((sum, f) => sum + ctx.size(f), 0);
      const limit = ctx.config.initialJsLimitBytes || 300 * 1024;
      const detail = `${(total / 1024).toFixed(1)}KB / ${(limit / 1024).toFixed(0)}KB`;
      return total <= limit ? ok(detail) : ng(detail);
    },
  },
];
