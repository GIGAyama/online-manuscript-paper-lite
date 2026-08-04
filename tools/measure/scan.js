/* ページ内で走らせる実測スクリプト（コントラスト・タップ領域）。
 * GIGA Standard v5 §7-2 の注意点をすべて踏まえている。
 *  - 色は 1px 実際に塗って getImageData で読む（oklch 対策）
 *  - グラデーション背景は backgroundImage の色を全部取り、最悪値で判定する
 *  - 絵文字はフォント自身の色で描かれるため除外する
 *  - disabled / cursor-not-allowed は WCAG 対象外なので除外する
 */
(() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const ctx = cv.getContext('2d', { willReadFrequently: true });

  // 色文字列 → [r,g,b,a]（アルファは 0..1）
  const parseColor = (s) => {
    if (!s) return [0, 0, 0, 0];
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    ctx.fillStyle = s;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    const a = d[3] / 255;
    // ⚠️ getImageData は Chrome では「アルファを乗算していない」値を返す。
    //    ここで d[0]/a のようにアルファで割ると、半透明の面が実際より明るく出る。
    //    （bg-white/90 の帯が rgb(297,297,295) と算出され、比が 3.19 → 4.45 に化けた）
    return a === 0 ? [0, 0, 0, 0] : [d[0], d[1], d[2], a];
  };

  const over = (fg, bg) => {
    const a = fg[3];
    if (a >= 1) return [fg[0], fg[1], fg[2], 1];
    return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
  };

  const lum = ([r, g, b]) => {
    const f = (v) => { v = Math.min(255, Math.max(0, v)) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };

  // backgroundImage から色を全部拾う（グラデーションは「白の上の白」誤報の元）
  const COLOR_RE = /(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|color\([^)]*\))/gi;
  const bgImageColors = (bi) => (bi && bi !== 'none' ? (bi.match(COLOR_RE) || []) : []).map(parseColor).filter((c) => c[3] > 0);

  // 要素の実効背景（自分→祖先へ、不透明になるまで重ねる）。候補が複数なら全部返す
  const effectiveBackgrounds = (el) => {
    let stack = [[255, 255, 255, 1]]; // 最終的な下地は白（body 未指定時）
    const layers = [];
    let node = el;
    while (node && node.nodeType === 1) {
      const cs = getComputedStyle(node);
      const grad = bgImageColors(cs.backgroundImage);
      const solid = parseColor(cs.backgroundColor);
      if (grad.length) layers.push(grad);
      else if (solid[3] > 0) layers.push([solid]);
      if (grad.length === 0 && solid[3] >= 1) break;
      if (grad.length && grad.every((c) => c[3] >= 1)) break;
      node = node.parentElement;
    }
    // 下から順に重ねる。候補が複数ある層は組み合わせを保つ（最大 8 通りまで）
    let results = stack;
    for (let i = layers.length - 1; i >= 0; i--) {
      const next = [];
      for (const base of results) for (const c of layers[i]) next.push(over(c, base));
      results = next.slice(0, 8);
    }
    return results;
  };

  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

  const isHidden = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return true;
    const r = el.getBoundingClientRect();
    return r.width < 1 || r.height < 1;
  };

  const isDisabled = (el) => {
    let n = el;
    while (n && n.nodeType === 1) {
      if (n.disabled) return true;
      if (n.getAttribute && n.getAttribute('aria-disabled') === 'true') return true;
      if (getComputedStyle(n).cursor === 'not-allowed') return true;
      n = n.parentElement;
    }
    return false;
  };

  const label = (el) => {
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
    return t.length > 40 ? t.slice(0, 40) + '…' : t;
  };
  const path = (el) => {
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && parts.length < 4) {
      parts.unshift(n.tagName.toLowerCase() + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).slice(0, 3).join('.') : ''));
      n = n.parentElement;
    }
    return parts.join(' > ');
  };

  window.__gigaScan = {
    contrast() {
      const bad = [];
      const seen = new Set();
      document.querySelectorAll('*').forEach((el) => {
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TITLE', 'HEAD'].includes(el.tagName)) return;
        // 直下のテキストノードだけを見る（祖先で二重に数えない）
        const text = Array.from(el.childNodes)
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent)
          .join('')
          .trim();
        if (!text) return;
        if (EMOJI.test(text)) return;
        if (isHidden(el) || isDisabled(el)) return;

        const cs = getComputedStyle(el);
        const fs = parseFloat(cs.fontSize);
        const weight = Number(cs.fontWeight) || (cs.fontWeight === 'bold' ? 700 : 400);
        const large = fs >= 24 || (fs >= 18.66 && weight >= 700);
        const need = large ? 3.0 : 4.5;

        const bgs = effectiveBackgrounds(el);
        const fgRaw = parseColor(cs.color);
        let worst = Infinity;
        let worstBg = null;
        for (const bg of bgs) {
          const fg = over(fgRaw, bg);
          const r = ratio(fg, bg);
          if (r < worst) { worst = r; worstBg = bg; }
        }
        if (worst + 1e-9 < need) {
          const key = path(el) + '|' + text.slice(0, 20);
          if (seen.has(key)) return;
          seen.add(key);
          bad.push({
            text: text.length > 30 ? text.slice(0, 30) + '…' : text,
            path: path(el),
            color: cs.color,
            bg: worstBg ? `rgb(${worstBg.slice(0, 3).map((v) => Math.round(v)).join(',')})` : '?',
            fontSize: fs, weight, large,
            ratio: Math.round(worst * 100) / 100, need,
          });
        }
      });
      return bad;
    },

    /* プレースホルダは要素の中身ではないので、上の走査では拾えない。
     * 「ここに書いてください」という案内がいちばん薄い、という形になりやすいので
     * 別に測る。Tailwind の既定は #9ca3af（白地で 2.54）で基準に届かない。 */
    placeholders() {
      const bad = [];
      document.querySelectorAll('input[placeholder], textarea[placeholder]').forEach((el) => {
        if (isHidden(el) || isDisabled(el)) return;
        const ps = getComputedStyle(el, '::placeholder');
        const cs = getComputedStyle(el);
        const fs = parseFloat(ps.fontSize || cs.fontSize);
        const weight = Number(ps.fontWeight || cs.fontWeight) || 400;
        const large = fs >= 24 || (fs >= 18.66 && weight >= 700);
        const need = large ? 3.0 : 4.5;
        const bgs = effectiveBackgrounds(el);
        const fgRaw = parseColor(ps.color || cs.color);
        let worst = Infinity;
        let worstBg = null;
        for (const bg of bgs) {
          const r = ratio(over(fgRaw, bg), bg);
          if (r < worst) { worst = r; worstBg = bg; }
        }
        if (worst + 1e-9 < need) {
          bad.push({
            text: el.getAttribute('placeholder'),
            path: path(el),
            color: ps.color,
            bg: worstBg ? `rgb(${worstBg.slice(0, 3).map((v) => Math.round(v)).join(',')})` : '?',
            fontSize: fs, weight, large,
            ratio: Math.round(worst * 100) / 100, need,
          });
        }
      });
      return bad;
    },

    tapTargets() {
      const SEL = 'a[href], button, input:not([type=hidden]), select, textarea, [role="button"], [onclick], [tabindex]:not([tabindex="-1"])';
      const bad = [];
      document.querySelectorAll(SEL).forEach((el) => {
        if (isHidden(el) || isDisabled(el)) return;
        if (el.tagName === 'TEXTAREA') return; // 入力面は面積で判定しない
        const r = el.getBoundingClientRect();
        let w = r.width, h = r.height;
        // 疑似要素で当たり判定だけ広げている場合を拾う（tap-44 方式）
        for (const pe of ['::after', '::before']) {
          const ps = getComputedStyle(el, pe);
          if (ps.content === 'none') continue;
          const pw = Math.max(parseFloat(ps.width) || 0, parseFloat(ps.minWidth) || 0);
          const ph = Math.max(parseFloat(ps.height) || 0, parseFloat(ps.minHeight) || 0);
          if (ps.position === 'absolute') { w = Math.max(w, pw); h = Math.max(h, ph); }
        }
        // チェックボックス・ラジオは囲みの label を当たり判定とみなす
        if (el.tagName === 'INPUT' && /^(checkbox|radio)$/.test(el.type)) {
          const lab = el.closest('label');
          if (lab) { const lr = lab.getBoundingClientRect(); w = Math.max(w, lr.width); h = Math.max(h, lr.height); }
        }
        if (w + 0.5 < 44 || h + 0.5 < 44) {
          bad.push({ path: path(el), label: label(el) || el.getAttribute('aria-label') || el.getAttribute('title') || '',
            w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10 });
        }
      });
      return bad;
    },

    overflowX() {
      const de = document.documentElement;
      const offenders = [];
      if (de.scrollWidth > de.clientWidth + 1) {
        document.querySelectorAll('*').forEach((el) => {
          if (isHidden(el)) return;
          const r = el.getBoundingClientRect();
          if (r.right > de.clientWidth + 1 || r.left < -1) offenders.push({ path: path(el), left: Math.round(r.left), right: Math.round(r.right) });
        });
      }
      return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, offenders: offenders.slice(0, 10) };
    },
  };
})();
