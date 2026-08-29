/* =========================================================================
 * オンライン原稿用紙 Lite — アプリ本体（原本）
 *
 * ここが原本。直したら必ず `npm run build` を走らせてから push すること。
 * 生成物は js/app.js（手で編集しない）。
 *
 * 以前はこのコードが index.html の中に <script type="text/babel"> として
 * 直接書かれ、ブラウザに載せた @babel/standalone が開くたびに翻訳していた。
 * 学校のフィルタリングで CDN が1本でも塞がれると画面が真っ白になるため、
 * ビルド時に1回だけ翻訳する形へ移した。
 * ========================================================================= */

import { parseGenko } from './genko-parser.js';

const { useState, useEffect, useMemo, useRef, useCallback, useId } = React;

const STORAGE_KEY = 'genko_lite_v2';

/* 書きかけの保存。保存領域がいっぱい／プライベートモードでは setItem が例外を投げる。
 * 投げっぱなしにすると自動保存のタイマーの中で落ち、以後の保存が止まるので必ず受ける。
 * （画面の文字は消えないので、児童には何も知らせない。） */
const saveDoc = (doc, settings) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...doc,
      charsPerLine: settings.charsPerLine,
      kinsokuMode: settings.kinsokuMode,
    }));
  } catch (e) { /* 保存できなくても書きかけは画面に残る */ }
};

/* 小さな通知。Swal.mixin は呼ぶたびに新しい設定を作るので、
 * 描画のたびに作り直さないよう1つだけ持って使い回す。 */
let toastInstance = null;
const toast = (options) => {
  if (!toastInstance) {
    toastInstance = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 });
  }
  return toastInstance.fire(options);
};

// ==========================================
// 端末まわりの下ごしらえ
// ==========================================

/* ソフトキーボードが出ると window.innerHeight は変わらないが visualViewport は縮む。
 * 原稿用紙は「打つ」ことが主目的なので、入力欄がキーボードに隠れると機能が消える。
 * 実際に見えている高さを CSS 変数へ流し込み、.app-shell がそれに追従する。 */
const syncVisualViewport = () => {
  const vv = window.visualViewport;
  if (!vv) return;
  const sync = () => document.documentElement.style.setProperty('--vvh', `${vv.height}px`);
  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
  sync();
};

/* Service Worker の登録と更新の案内。
 *
 * ⚠️ 「もう load が済んでいる」場合を必ず見る。React の effect は描画のあとに走るため、
 *    そのとき load は終わっていることがある。load を待つだけだとリスナーは付くが
 *    二度と呼ばれず、Service Worker が黙って登録されない。
 *
 * ⚠️ controllerchange は初回訪問でも飛んでくる（activate の clients.claim() で
 *    ページが管理下に入るため）。素直に受けると初回が必ず1回リロードされ、
 *    打ちかけの作文が消える。見るべきは「利用者が押したかどうか」だけ。 */
let userAskedUpdate = false;
let reloading = false;

const setupServiceWorker = (onUpdateAvailable) => {
  if (!('serviceWorker' in navigator)) return;
  // file:// で直接開いた場合は登録しない（通常のページとしては動く）
  if (!/^https?:$/.test(location.protocol)) return;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!userAskedUpdate || reloading) return;
    reloading = true;
    location.reload();
  });

  const start = async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      const notify = (worker) => onUpdateAvailable(() => {
        userAskedUpdate = true;
        worker.postMessage({ type: 'SKIP_WAITING' });
      });
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          // controller が居る＝初回インストールではなく更新。
          // 初回で知らせると「入れた直後に更新があります」と出て混乱する。
          if (sw.state === 'installed' && navigator.serviceWorker.controller) notify(sw);
        });
      });
      // 前回のうちに新しい版が待機していた場合も拾う
      if (reg.waiting && navigator.serviceWorker.controller) notify(reg.waiting);
    } catch (err) {
      console.warn('Service Worker の登録に失敗しました', err);
    }
  };

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
};

// ==========================================
// ユーティリティ・共通コンポーネント
// ==========================================

/* アイコン。以前は bootstrap-icons のフォント（CSS 85KB + woff2 128KB）を
 * CDN から読んでいた。使うのは13個だけなので、その形だけを埋め込む。
 * 中身はビルド時に node_modules から取り出した SVG（js/icons.js）。 */
const Icon = ({ name, className = '', style }) => {
  const icon = (window.GENKO_ICONS || {})[name];
  if (!icon) return null;
  return (
    <svg
      className={className}
      style={style}
      width="1em"
      height="1em"
      viewBox={icon.vb}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: icon.d }}
    />
  );
};

/* 小学生向けルビ。
 * rt に色を書かないのが要点。色は CSS 側で、白地だけ既定値を与え、
 * 色のついた面では親から継がせる（src/style.css を見ること）。
 * <rp> を添えて、読み上げのときに二重に読まれないようにする。 */
const Rb = ({ t, r }) => (
  <ruby className="relative inline-block text-center align-baseline leading-none">
    {t}
    <rp>(</rp>
    <rt
      className="absolute bottom-full left-1/2 -translate-x-1/2 whitespace-nowrap text-[0.6em] pointer-events-none mb-[0.1em] font-medium tracking-normal"
      style={{ letterSpacing: 'normal' }}
    >
      {r}
    </rt>
    <rp>)</rp>
  </ruby>
);

// 共通モーダル。role="dialog" / Esc で閉じる / フォーカスを閉じ込める
const Modal = ({ isOpen, onClose, title, children, maxWidth = 'max-w-md' }) => {
  const panelRef = useRef(null);
  const lastFocused = useRef(null);
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return undefined;
    lastFocused.current = document.activeElement;

    const focusables = () => Array.from(
      panelRef.current ? panelRef.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') : []
    ).filter((el) => !el.disabled && el.offsetParent !== null);

    const onKeyDown = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      // キーボードだけで操作する子のために、Tab がモーダルの外へ出ないようにする
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    window.addEventListener('keydown', onKeyDown);
    const t = setTimeout(() => { const list = focusables(); if (list[0]) list[0].focus(); }, 0);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      clearTimeout(t);
      if (lastFocused.current && lastFocused.current.focus) lastFocused.current.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 no-print" role="presentation">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`bg-white rounded-2xl shadow-2xl w-full ${maxWidth} flex flex-col overflow-hidden transform transition-all animate-modal`}
      >
        <div className="flex justify-between items-center p-4 sm:p-5 border-b border-slate-100 bg-slate-50/50">
          <h2 id={titleId} className="font-bold text-lg text-slate-800 pt-1">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="tap-44 p-1.5 hover:bg-slate-200 rounded-full text-slate-600 transition-all active:scale-90"
          >
            <Icon name="x-lg" className="text-[20px]" />
          </button>
        </div>
        <div className="p-4 sm:p-5">{children}</div>
      </div>
    </div>
  );
};

// プレビュー領域を画面サイズに合わせて自動縮小するラッパー
const ScalableWrapper = ({ children, scrollContainerRef, onScroll }) => {
  const wrapperRef = useRef(null);
  const containerRef = useRef(null);
  const contentRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  useEffect(() => {
    let reqId;
    const updateScale = () => {
      if (!containerRef.current || !contentRef.current) return;
      const availableH = containerRef.current.clientHeight - 48; // 上下余白 (p-6 = 24px x 2)
      const firstChild = contentRef.current.firstElementChild;
      if (!firstChild) return;

      const originalW = firstChild.offsetWidth;
      const originalH = firstChild.offsetHeight;

      if (originalH > 10 && availableH > 10) {
        let s = availableH / originalH;

        // 画面の高さいっぱいに拡大する。ただし極端な拡大は防ぐ
        if (s > 3) s = 3;
        if (s < 0.1) s = 0.1;

        setDims((prev) => {
          if (prev.w !== originalW || prev.h !== originalH) return { w: originalW, h: originalH };
          return prev;
        });
        setScale(s);
      }
    };

    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(reqId);
      reqId = requestAnimationFrame(updateScale);
    });
    if (containerRef.current) observer.observe(containerRef.current);
    if (contentRef.current && contentRef.current.firstElementChild) observer.observe(contentRef.current.firstElementChild);

    updateScale();
    const timeoutId = setTimeout(updateScale, 100);
    return () => { observer.disconnect(); cancelAnimationFrame(reqId); clearTimeout(timeoutId); };
    /* 依存に children を入れない。children は1文字打つたびに新しい要素になるので、
     * 入れると打つたびに ResizeObserver を捨てて作り直すことになる。
     * 見張っている DOM の要素そのものは入れ替わらず、行が増えて大きさが変われば
     * ResizeObserver が呼んでくれるため、これで足りる。 */
  }, []);

  // 縦・横どちらのスクロール操作でも、プレビュー画面を横スクロールさせる
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const container = containerRef.current;
    if (!wrapper || !container) return undefined;

    const handleWheel = (e) => {
      // ブラウザのズーム機能（Ctrl+ホイール等）は妨害しない。
      // 見えづらい子が拡大できることのほうが大事なため。
      if (e.ctrlKey || e.shiftKey || e.altKey) return;

      e.preventDefault();

      let scrollAmount = 0;
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) scrollAmount = -e.deltaY;
      else scrollAmount = e.deltaX;

      if (typeof container.scrollBy === 'function') container.scrollBy({ left: scrollAmount, behavior: 'auto' });
      else container.scrollLeft += scrollAmount;
    };

    wrapper.addEventListener('wheel', handleWheel, { passive: false });
    return () => wrapper.removeEventListener('wheel', handleWheel);
  }, []);

  return (
    <div ref={wrapperRef} className="absolute inset-0 bg-slate-100/50 overflow-hidden">
      <div
        ref={(el) => {
          containerRef.current = el;
          if (scrollContainerRef) scrollContainerRef.current = el;
        }}
        onScroll={onScroll}
        className="w-full h-full overflow-auto relative hide-scrollbar scroll-area p-6"
        style={{ direction: 'rtl' }}
      >
        <div style={{ direction: 'ltr' }} className="flex-shrink-0 w-max h-max mx-auto">
          <div style={{ width: dims.w > 0 ? dims.w * scale : '100%', height: dims.h > 0 ? dims.h * scale : '100%', position: 'relative' }}>
            <div
              ref={contentRef}
              style={{ transform: `scale(${scale})`, transformOrigin: 'top right', position: 'absolute', top: 0, right: 0 }}
              className="shadow-xl rounded-sm bg-paper inline-block border border-slate-200"
            >
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ==========================================
// カスタムフック (原稿用紙ロジック)
// ==========================================

const useGenkoParser = (doc, settings) => useMemo(
  () => parseGenko(doc, settings),
  [doc, settings.charsPerLine, settings.kinsokuMode],
);

// ==========================================
// UI コンポーネント
// ==========================================

const Header = ({ onSettingClick, canInstall, onInstallClick }) => (
  <nav className="bg-white border-b-4 border-amber-500 px-3 md:px-6 py-2.5 md:py-3 flex justify-between items-center shrink-0 shadow-sm z-10 no-print">
    <div className="flex items-center gap-2 md:gap-3 min-w-0">
      <div className="p-1.5 md:p-2 rounded-xl text-white shadow-sm bg-amber-700 shrink-0">
        <Icon name="pencil-square" className="text-[20px] md:text-[24px]" />
      </div>
      <div className="flex items-baseline gap-2 min-w-0">
        <h1 className="font-bold tracking-wide pt-3 text-amber-700 truncate text-[length:var(--fs-title)]">
          オンライン<Rb t="原稿用紙" r="げんこうようし" />
        </h1>
        <span className="px-2 py-0.5 rounded-full text-xs font-bold text-white shadow-sm bg-amber-700 relative -top-[1px] shrink-0">Lite</span>
      </div>
    </div>
    <div className="flex items-center gap-1 md:gap-2 shrink-0">
      {canInstall && (
        <button
          type="button"
          onClick={onInstallClick}
          className="tap-44 flex items-center gap-1.5 px-2.5 md:px-3 pt-2 pb-1.5 rounded-xl font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 transition-all active:scale-95 leading-loose"
          title="アプリとしてインストール"
        >
          <Icon name="box-arrow-down" className="text-[16px] -mt-1" />
          <span className="text-xs md:text-sm">インストール</span>
        </button>
      )}
      <button
        type="button"
        onClick={onSettingClick}
        className="tap-44 p-2 pt-3 text-slate-600 hover:bg-slate-100 rounded-full transition-all active:scale-95"
        title="設定"
        aria-label="設定をひらく"
      >
        <Icon name="gear" className="text-[22px]" />
      </button>
    </div>
  </nav>
);

/* 新しい版が待機したときの案内。押されるまで切り替えない。
 * 児童が書いている最中に画面が入れ替わると、打ちかけの作文が消えるため。 */
const UpdateBanner = ({ onApply }) => (
  <div className="fixed left-0 right-0 bottom-0 z-[200] flex justify-center px-3 pb-3 safe-bottom no-print" role="status">
    <div className="flex items-center gap-3 bg-slate-800 text-white rounded-2xl shadow-2xl px-4 py-3 max-w-md w-full">
      <Icon name="arrow-clockwise" className="text-[20px] shrink-0" />
      <span className="font-bold text-sm flex-1">あたらしい ばんが あります</span>
      <button
        type="button"
        onClick={onApply}
        className="tap-44 px-4 py-2 rounded-xl bg-white text-slate-800 font-bold text-sm active:scale-95 transition-all"
      >
        さいしんに する
      </button>
    </div>
  </div>
);

// 行単位での再レンダリングを防ぐためのメモ化コンポーネント（極限最適化）
const GenkoLine = React.memo(({ rowData, chars, cellSize, isFirst, isLast }) => (
  <div className={`flex flex-col flex-shrink-0 border-l border-genkoLine ${isFirst ? 'border-r border-genkoStrong' : ''} ${isLast ? 'border-l-genkoStrong' : ''}`}>
    {Array.from({ length: chars }).map((_, j) => (
      <div key={j} className={`genko-cell vertical-rl flex items-center justify-center border-b border-genkoLine relative flex-shrink-0 ${cellSize} ${j === chars - 1 ? 'border-b-0' : ''}`}>
        {rowData[j] || ''}
        {/* ぶら下がり文字 */}
        {j === chars - 1 && rowData.length > chars && (
          <div className="absolute top-full left-1/2 -translate-x-1/2 whitespace-nowrap vertical-rl text-[0.7em] leading-none mt-1 pointer-events-none text-black z-10">
            {rowData.slice(chars).join('')}
          </div>
        )}
      </div>
    ))}
  </div>
), (prevProps, nextProps) => {
  // 設定が変わった場合は再描画
  if (prevProps.chars !== nextProps.chars) return false;
  if (prevProps.cellSize !== nextProps.cellSize) return false;
  if (prevProps.isFirst !== nextProps.isFirst) return false;
  if (prevProps.isLast !== nextProps.isLast) return false;

  // 配列の中身を浅く比較して、変更がなければ再描画をスキップ（高速化の肝）
  const prevRow = prevProps.rowData || [];
  const nextRow = nextProps.rowData || [];
  if (prevRow.length !== nextRow.length) return false;
  for (let i = 0; i < prevRow.length; i++) {
    if (prevRow[i] !== nextRow[i]) return false;
  }
  return true;
});

const GenkoPaperPreview = ({ parsedGenko, settings }) => {
  const chars = settings.charsPerLine;
  const linesPerPage = chars === 20 ? 20 : 16;
  const cellSize = chars === 20 ? 'w-[2.8rem] h-[2.8rem] text-[1.6rem]' : 'w-[3.6rem] h-[3.6rem] text-[2.0rem]';

  // 常に1ページ（20行 or 16行）の倍数で描画し、用紙の形を綺麗に保つ
  const pageCount = Math.ceil(parsedGenko.length / linesPerPage) || 1;
  const renderLen = pageCount * linesPerPage;

  return (
    <div className="flex flex-row-reverse p-10 gap-8 font-genko w-max text-slate-800">
      <div className="flex flex-row-reverse border-y border-genkoStrong">
        {Array.from({ length: renderLen }).map((_, i) => (
          <GenkoLine
            key={i}
            rowData={parsedGenko[i] || []}
            chars={chars}
            cellSize={cellSize}
            isFirst={i === 0}
            isLast={i === renderLen - 1}
          />
        ))}
      </div>
    </div>
  );
};

const PrintGenkoView = ({ parsedGenko, settings, doc }) => {
  const chars = settings.charsPerLine;
  const linesPerPage = chars === 20 ? 20 : 16;
  const halfLines = linesPerPage / 2;
  const pageCount = Math.ceil(parsedGenko.length / linesPerPage) || 1;
  const fontSize = chars === 20 ? '16pt' : '20pt';

  const pages = Array.from({ length: pageCount }, (_, i) => parsedGenko.slice(i * linesPerPage, (i + 1) * linesPerPage));

  const shortTitle = (doc.title || '無題').substring(0, 10);

  return (
    <div className="print-only font-genko">
      {pages.map((pageLines, pIndex) => (
        <div key={pIndex} className="print-page">
          <div className="print-layout-grid">

            {/* 左半分のグリッド（表示は左側、内容は後半の行） */}
            <div className="print-half-grid left-side">
              {Array.from({ length: halfLines }).map((_, i) => {
                const actualIndex = i + halfLines;
                const lineData = pageLines[actualIndex] || [];
                return (
                  <div key={actualIndex} className="print-line">
                    {Array.from({ length: chars }).map((_, j) => (
                      <div key={j} className="print-cell" style={{ fontSize }}>
                        {lineData[j] || ''}
                        {j === chars - 1 && lineData.length > chars && (
                          <div className="hanging-chars-print">{lineData.slice(chars).join('')}</div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>

            {/* 中央の魚尾（とじしろ）エリア */}
            <div className="print-gyobi-area">
              <div className="gyobi-content">
                <div className="gyobi-mark"></div>
                <div className="font-bold">{shortTitle}</div>
                <div className="text-[0.8em] mt-[5mm]">{pIndex + 1}</div>
              </div>
            </div>

            {/* 右半分のグリッド（表示は右側、内容は前半の行） */}
            <div className="print-half-grid right-side">
              {Array.from({ length: halfLines }).map((_, i) => {
                const lineData = pageLines[i] || [];
                return (
                  <div key={i} className="print-line">
                    {Array.from({ length: chars }).map((_, j) => (
                      <div key={j} className="print-cell" style={{ fontSize }}>
                        {lineData[j] || ''}
                        {j === chars - 1 && lineData.length > chars && (
                          <div className="hanging-chars-print">{lineData.slice(chars).join('')}</div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>

          </div>
        </div>
      ))}
    </div>
  );
};

// ==========================================
// メインアプリケーション
// ==========================================

const App = () => {
  const [settings, setSettings] = useState({ charsPerLine: 20, kinsokuMode: 'burasagari' });
  const [doc, setDoc] = useState({ title: '', class: '', name: '', content: '' });
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [isSettingsModalOpen, setSettingsModalOpen] = useState(false);
  // モバイル表示 (md未満) では「かく」と「原稿用紙」をタブで切り替えて全画面表示する
  const [mobileView, setMobileView] = useState('edit');
  const [canInstall, setCanInstall] = useState(!!window.__pwaInstallPrompt);
  const [applyUpdate, setApplyUpdate] = useState(null);

  const handleChange = (e) => setDoc((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  /* 文字数。改行は「文字」ではないので数えない（原稿用紙の 400 字と見比べるため）。
   * Array.from で数えるのは、絵文字や一部の漢字（𩸽 など）を2文字と数えないため。 */
  const charCount = useMemo(() => Array.from((doc.content || '').replace(/\n/g, '')).length, [doc.content]);

  // スクロール同期用のRefとフラグ
  const textareaRef = useRef(null);
  const previewContainerRef = useRef(null);
  const isSyncingLeft = useRef(false);
  const isSyncingRight = useRef(false);

  // 保存する内容の最新値。pagehide から参照する（描画に使わないので ref で持つ）
  const latest = useRef({ doc, settings });
  latest.current = { doc, settings };

  // エディタのスクロールに合わせて原稿用紙を同期
  const handleTextareaScroll = useCallback(() => {
    if (isSyncingRight.current) return;
    const left = textareaRef.current;
    const right = previewContainerRef.current;
    if (!left || !right) return;

    isSyncingLeft.current = true;
    const scrollableHeight = left.scrollHeight - left.clientHeight;
    const ratio = scrollableHeight > 0 ? left.scrollTop / scrollableHeight : 0;

    const scrollableWidth = right.scrollWidth - right.clientWidth;
    // RTLのscrollLeftはChrome/Edge等で負の値になる
    right.scrollLeft = -scrollableWidth * ratio;

    setTimeout(() => { isSyncingLeft.current = false; }, 50);
  }, []);

  // 原稿用紙のスクロールに合わせてエディタを同期
  const handlePreviewScroll = useCallback(() => {
    if (isSyncingLeft.current) return;
    const left = textareaRef.current;
    const right = previewContainerRef.current;
    if (!left || !right) return;

    isSyncingRight.current = true;
    const scrollableWidth = right.scrollWidth - right.clientWidth;
    const ratio = scrollableWidth > 0 ? Math.abs(right.scrollLeft) / scrollableWidth : 0;

    const scrollableHeight = left.scrollHeight - left.clientHeight;
    left.scrollTop = scrollableHeight * ratio;

    setTimeout(() => { isSyncingRight.current = false; }, 50);
  }, []);

  // 初期データの復元
  useEffect(() => {
    let saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) { /* 記憶領域が使えない端末 */ }
    if (saved) {
      try {
        const data = JSON.parse(saved);
        const restored = {
          title: data.title || '', class: data.class || '', name: data.name || '', content: data.content || '',
        };
        setDoc(restored);
        // 20/15 以外は受け取らない（壊れた記録で用紙が消えないように）
        setSettings({
          charsPerLine: data.charsPerLine === 15 ? 15 : 20,
          kinsokuMode: data.kinsokuMode === 'oidashi' ? 'oidashi' : 'burasagari',
        });
        /* 「前回の続き」は中身があるときだけ知らせる。
         * 新規のあとは空の記録が残るので、無条件に出すと
         * 何も書いていないのに「続きから始めます」と出て混乱する。 */
        if (Object.values(restored).some((v) => v !== '')) {
          toast({ icon: 'info', html: '<span class="font-bold">前回の続きから始めます</span>' });
        }
      } catch (e) { console.error('Restore error', e); }
    }
    setIsInitialLoad(false);
  }, []);

  // 自動保存 (入力から1秒後)
  useEffect(() => {
    if (isInitialLoad) return undefined;
    const timer = setTimeout(() => saveDoc(doc, settings), 1000);
    return () => clearTimeout(timer);
  }, [doc, settings, isInitialLoad]);

  /* Chromebook はメモリ不足でタブを黙って破棄する。1秒待つ自動保存だけでは
   * 直前の数文字が消えるため、画面を離れる合図で必ず確定させる。
   * localStorage.clear() は使わない（他のアプリの記録まで消える）。 */
  useEffect(() => {
    const flush = () => {
      const { doc: d, settings: s } = latest.current;
      saveDoc(d, s);
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  // PWA インストール可否の監視
  useEffect(() => {
    const onInstallable = () => setCanInstall(true);
    const onInstalled = () => {
      setCanInstall(false);
      toast({ icon: 'success', html: '<span class="font-bold">アプリをインストールしました</span>' });
    };
    window.addEventListener('pwa-install-available', onInstallable);
    window.addEventListener('pwa-installed', onInstalled);
    return () => {
      window.removeEventListener('pwa-install-available', onInstallable);
      window.removeEventListener('pwa-installed', onInstalled);
    };
  }, []);

  // Service Worker の登録と更新の案内
  useEffect(() => {
    setupServiceWorker((apply) => setApplyUpdate(() => apply));
  }, []);

  const handleInstall = async () => {
    const promptEvent = window.__pwaInstallPrompt;
    if (!promptEvent) return;
    promptEvent.prompt();
    await promptEvent.userChoice;
    // prompt() は1度しか呼べないため、結果に関わらず破棄する
    window.__pwaInstallPrompt = null;
    setCanInstall(false);
  };

  const parsedGenko = useGenkoParser(doc, settings);

  // --- アクションハンドラ ---

  const handleNew = () => {
    Swal.fire({
      title: '新しく書く',
      text: '今書いている内容は消えます。よろしいですか？',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc2626',
      confirmButtonText: 'はい、消して新しく書く',
      cancelButtonText: 'いいえ',
    }).then((result) => {
      if (result.isConfirmed) {
        setDoc({ title: '', class: '', name: '', content: '' });
        toast({ icon: 'success', title: '新しく始めました' });
      }
    });
  };

  const handleDownload = () => {
    if (!doc.content && !doc.title) {
      Swal.fire({ icon: 'warning', text: 'まだ何も書いていません' });
      return;
    }
    const textContent = `【題名】${doc.title}\n【学年】${doc.class}\n【氏名】${doc.name}\n---------------------------\n${doc.content}`;
    // charset を書いておかないと、端末によっては開いたときに文字化けする
    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    /* ファイル名。使えない記号のほかに改行とタブも落とす（題名に改行が入りうる）。
     * 記号を落とした結果が「_」だけになる場合も拾う（以前は完全一致だけを見ていたので、
     * 題名が「?」だけのようなときに「_.txt」という名前で保存されていた）。 */
    let filename = `${doc.title}_${doc.name}`.replace(/[/\\:*?"<>|\r\n\t]/g, '').trim();
    if (!filename.replace(/[_\s.]/g, '')) {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      filename = `作文_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    a.href = url;
    a.download = `${filename}.txt`;
    // DOM に無い <a> のクリックを無視するブラウザがあるため、一度置いてから押す
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    /* すぐ片付けると、保存が始まる前に中身が消えて 0 バイトのファイルになる端末がある。
     * <a> の取り外しも同じ理由で待つ。 */
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
  };

  const handleLoad = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onerror = () => {
        Swal.fire({ icon: 'error', title: 'よみこめませんでした', text: 'もういちど ためして ください。' });
      };
      reader.onload = (event) => {
        /* Windows のメモ帳で開いて保存し直すと改行が CRLF になる。
         * そのままだと題名の行が見つからず、全部が本文に流れ込むうえ、
         * 残った \r が原稿用紙の1マスを占めてしまう。先に LF へ揃える。 */
        const text = String(event.target.result || '').replace(/\r\n?/g, '\n');
        const headerRegex = /【題名】(.*)\n【学年】(.*)\n【氏名】(.*)\n-{10,}\n([\s\S]*)/;
        const match = text.match(headerRegex);
        if (match) {
          /* 本文の先頭は落とさない。trim() だと段落のはじめの全角スペース（字下げの1マス）
           * まで消えてしまい、保存したものを開き直すたびに原稿用紙の形が変わる。
           * 用紙の終わりに空のマスが並ばないよう、末尾の空白だけを落とす。 */
          setDoc({ title: match[1].trim(), class: match[2].trim(), name: match[3].trim(), content: match[4].replace(/\s+$/, '') });
          toast({ icon: 'success', title: '読み込みました' });
        } else {
          Swal.fire({
            title: '確認',
            text: '題名などの情報が見つかりません。すべて「本文」に読み込みますか？',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: '読み込む',
            // 既定のままだと取り消しのボタンだけ「Cancel」と英語で出る。
            // ふりがなを振ってある画面に英語が1つ混じると、そこで読めなくなる子がいる。
            cancelButtonText: 'いいえ',
            confirmButtonColor: '#b45309',
          }).then((result) => {
            if (result.isConfirmed) {
              setDoc((prev) => ({ ...prev, content: text }));
              toast({ icon: 'success', title: '読み込みました' });
            }
          });
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  return (
    <div className="app-shell w-full flex flex-col font-sans">
      <Header onSettingClick={() => setSettingsModalOpen(true)} canInstall={canInstall} onInstallClick={handleInstall} />

      {/* PC(md以上): 左カラム(入力+ボタン)と右カラム(プレビュー)のGrid。
          スマホ・タブレット縦(md未満): タブで「かく」「原稿用紙」を切り替えて全画面表示 */}
      <main className="flex-1 min-h-0 flex flex-col md:grid md:grid-cols-[minmax(300px,380px)_1fr] lg:grid-cols-[minmax(320px,420px)_1fr] md:grid-rows-[1fr_auto] p-2 md:p-4 gap-2 md:gap-4 overflow-hidden no-print">

        {/* 0. モバイル用タブ切り替え */}
        <div className="md:hidden flex bg-white rounded-xl border border-slate-200 p-1 gap-1 shrink-0 shadow-sm" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mobileView === 'edit'}
            onClick={() => setMobileView('edit')}
            className={`flex-1 flex items-center justify-center gap-1.5 pt-2.5 pb-1.5 rounded-lg font-bold text-sm transition-all active:scale-95 leading-loose min-h-[44px] ${mobileView === 'edit' ? 'bg-amber-700 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            <Icon name="pencil-fill" className="text-[14px] -mt-1" /> <span>かく</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileView === 'preview'}
            onClick={() => setMobileView('preview')}
            className={`flex-1 flex items-center justify-center gap-1.5 pt-2.5 pb-1.5 rounded-lg font-bold text-sm transition-all active:scale-95 leading-loose min-h-[44px] ${mobileView === 'preview' ? 'bg-amber-700 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            <Icon name="eye-fill" className="text-[14px] -mt-1" /> <span><Rb t="原稿用紙" r="げんこうようし" />をみる</span>
          </button>
        </div>

        {/* 1. 入力エリア (スマホ: 「かく」タブ, PC: 左カラム上部) */}
        <div className={`${mobileView === 'edit' ? 'flex' : 'hidden'} md:flex flex-1 min-h-0 md:col-start-1 md:row-start-1 bg-white rounded-2xl md:rounded-b-none shadow-sm border border-slate-200 flex-col overflow-hidden z-10 md:border-b-0`}>
          <div className="p-4 md:p-5 border-b border-slate-100 bg-slate-50 shrink md:max-h-[30vh] overflow-auto scroll-area">
            <div className="text-sm font-bold text-slate-600 mb-1 md:mb-2 pt-1 leading-loose">
              <Icon name="person-vcard" /> <Rb t="基本情報" r="きほんじょうほう" />
            </div>
            <input
              type="text" name="title" value={doc.title} onChange={handleChange} placeholder="だいめい"
              aria-label="だいめい"
              className="tap-44-box w-full px-3 py-2 md:px-4 md:py-2.5 mb-2 md:mb-3 border border-slate-200 rounded-xl outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 font-bold text-base md:text-lg transition-all bg-white text-slate-800"
            />
            <div className="flex gap-2 md:gap-3">
              <input
                type="text" name="class" value={doc.class} onChange={handleChange} placeholder="がくねん・くみ"
                aria-label="がくねん・くみ"
                className="tap-44-box w-1/3 px-3 py-1.5 md:px-4 md:py-2 border border-slate-200 rounded-xl outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all bg-white text-slate-800 text-sm"
              />
              <input
                type="text" name="name" value={doc.name} onChange={handleChange} placeholder="なまえ"
                aria-label="なまえ"
                className="tap-44-box flex-1 px-3 py-1.5 md:px-4 md:py-2 border border-slate-200 rounded-xl outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all bg-white text-slate-800 text-sm"
              />
            </div>
          </div>

          <div className="flex-1 relative bg-amber-50/30 min-h-[120px] md:min-h-[30vh]">
            {/* 罫線・行の高さ・内側余白は .manuscript-editor に集めてある（src/style.css）。
                ここで p-4 や leading-* を足すと、罫線と文字がまたずれる。 */}
            <textarea
              ref={textareaRef}
              onScroll={handleTextareaScroll}
              name="content" value={doc.content} onChange={handleChange}
              placeholder="ここをクリックして、さくぶんをかいてください..."
              aria-label="ほんぶん"
              className="manuscript-editor w-full h-full resize-none border-none focus:outline-none focus:bg-amber-50/60 text-slate-800 bg-transparent hide-scrollbar scroll-area transition-colors"
            />
            {/* 1文字ごとに読み上げられると邪魔になるので、ここは live 領域にしない */}
            <div className="absolute bottom-4 right-4 bg-white px-4 py-1.5 rounded-full shadow-sm border border-slate-200 text-sm font-bold text-amber-700 pointer-events-none">
              {charCount.toLocaleString()} <Rb t="文字" r="もじ" />
            </div>
          </div>
        </div>

        {/* 2. プレビューエリア (スマホ: 「原稿用紙」タブ, PC: 右カラム全体) */}
        <div className={`${mobileView === 'preview' ? 'flex' : 'hidden'} md:flex flex-1 min-h-0 md:col-start-2 md:row-start-1 md:row-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 flex-col overflow-hidden relative min-w-0`}>
          <div className="absolute top-2 right-2 md:top-4 md:right-4 z-20">
            <button
              type="button"
              onClick={() => window.print()}
              className="tap-44 px-3 pt-2 pb-1.5 md:px-4 md:pt-3 md:pb-2 rounded-xl font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 transition-all active:scale-95 flex items-center gap-2 shadow-sm leading-loose"
            >
              <Icon name="printer" className="text-[16px] md:text-[18px] -mt-1" />
              <span className="text-sm md:text-base"><Rb t="印刷" r="いんさつ" />する</span>
            </button>
          </div>
          <ScalableWrapper scrollContainerRef={previewContainerRef} onScroll={handlePreviewScroll}>
            <GenkoPaperPreview parsedGenko={parsedGenko} settings={settings} />
          </ScalableWrapper>
        </div>

        {/* 3. ボタンエリア (スマホ: 最下部に1行, PC: 左カラム下部) */}
        <div className="md:col-start-1 md:row-start-2 p-2 md:p-5 border border-slate-200 bg-white rounded-2xl md:rounded-t-none md:border-t-0 grid grid-cols-3 md:grid-cols-2 gap-2 md:gap-3 shrink-0 shadow-sm z-10">
          <button type="button" onClick={handleNew} className="tap-44 flex items-center justify-center gap-1.5 md:gap-2 pt-2.5 pb-1.5 md:pt-4 md:pb-2.5 border border-slate-200 rounded-xl bg-slate-50 hover:bg-slate-100 font-bold text-slate-700 transition-all active:scale-95 leading-loose text-sm md:text-base">
            <Icon name="file-earmark-plus" className="text-[16px] md:text-[18px]" /> <span><Rb t="新規" r="しんき" /></span>
          </button>
          <button type="button" onClick={handleLoad} className="tap-44 flex items-center justify-center gap-1.5 md:gap-2 pt-2.5 pb-1.5 md:pt-4 md:pb-2.5 border border-amber-200 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 font-bold transition-all active:scale-95 leading-loose text-sm md:text-base">
            <Icon name="folder2-open" className="text-[16px] md:text-[18px]" /> <span><Rb t="開" r="ひら" />く</span>
          </button>
          <button type="button" onClick={handleDownload} className="tap-44 md:col-span-2 flex items-center justify-center gap-1.5 md:gap-2 pt-2.5 pb-1.5 md:pt-4 md:pb-3 bg-gradient-to-r from-slate-700 to-slate-800 text-white rounded-xl font-bold hover:from-slate-800 hover:to-slate-900 transition-all active:scale-95 shadow-md hover:shadow-lg leading-loose text-sm md:text-base">
            <Icon name="download" className="text-[16px] md:text-[18px]" /> <span><Rb t="保存" r="ほぞん" />する</span>
          </button>
        </div>

      </main>

      {/* フッター */}
      {/* ⚠️ 1 行に収める。flex-nowrap と min-w-0 の 2 つが要る。nowrap だけだと、
          クレジットの文字列が縮まずに列を押し広げて横スクロールになる。
          狭い画面ではクレジットが … で切れる。ここが太ると、そのぶん
          原稿用紙のマス目が狭くなる。 */}
      <footer className="flex-shrink-0 w-full flex flex-nowrap items-center justify-center gap-1 bg-white border-t border-slate-200 py-1 text-center text-[10px] md:text-sm text-slate-600 font-bold no-print z-40 shadow-sm relative safe-bottom">
        <span className="min-w-0 truncate">
          &copy; 2026 オンライン原稿用紙 Lite.{' '}
          <a href="https://giga-school.com" target="_blank" rel="noopener noreferrer" className="tap-44 inline-block text-inherit no-underline hover:opacity-80 transition-opacity">GIGA山</a>
        </span>
        {/* ⚠️ 行き先のリンクを手で書かないこと。中身は正本の部品
            standards/web/giga-app-links.js（配布物 web/giga-app-links.js）が
            この中に出す。文言も並びも行き先も、あちらで決まっている。

            ⚠️ ここにあった「使い方を読む」（紹介記事へのリンク）は外した。
               紹介記事は「なぜ作ったか」を、まだ使っていない先生に向けて
               書いたもので、いま画面の前で困っている人が求めるものではない。
               艦隊のほかのアプリでも既に外れている。

            ⚠️ <div> にしないこと。そこで改行が入ってフッターが 2 行になる。

            ⚠️ data-links で「つかいかた」を外してある。このアプリにはまだ
               docs/manual/ が無く、既定のまま出すと行き止まりのリンクになる。
               マニュアルを書いたら、この属性ごと消すこと。 */}
        <span data-giga-links data-links="terms,privacy" />
      </footer>

      {/* 印刷用DOM */}
      <PrintGenkoView parsedGenko={parsedGenko} settings={settings} doc={doc} />

      {/* 設定モーダル */}
      <Modal isOpen={isSettingsModalOpen} onClose={() => setSettingsModalOpen(false)} title={<Rb t="設定" r="せってい" />}>
        <div className="space-y-8 p-2">
          {/* 用紙の文字数 */}
          <div>
            <h3 className="font-bold text-slate-800 text-[1.1rem] mb-4"><Rb t="用紙" r="ようし" />の<Rb t="文字数" r="もじすう" /></h3>
            {/* 読み上げでも「2つのうちの1つ」と分かるように束ねる */}
            <div className="space-y-5 pl-2" role="radiogroup" aria-label="用紙の文字数">
              <label className="flex items-center gap-4 cursor-pointer group min-h-[44px]">
                <span className="relative flex items-center justify-center shrink-0">
                  <input type="radio" name="chars" checked={settings.charsPerLine === 20} onChange={() => setSettings((prev) => ({ ...prev, charsPerLine: 20 }))} className="peer appearance-none w-[22px] h-[22px] border-[2.5px] border-slate-300 rounded-full checked:border-teal-700 transition-all cursor-pointer bg-white" />
                  <span className="absolute w-[10px] h-[10px] bg-teal-700 rounded-full opacity-0 peer-checked:opacity-100 transition-all pointer-events-none"></span>
                </span>
                <span className="font-bold text-slate-800 text-[1.1rem]">20<Rb t="文字" r="もじ" /> × 20<Rb t="行" r="ぎょう" /> (<Rb t="高学年" r="こうがくねん" />)</span>
              </label>
              <label className="flex items-center gap-4 cursor-pointer group min-h-[44px]">
                <span className="relative flex items-center justify-center shrink-0">
                  <input type="radio" name="chars" checked={settings.charsPerLine === 15} onChange={() => setSettings((prev) => ({ ...prev, charsPerLine: 15 }))} className="peer appearance-none w-[22px] h-[22px] border-[2.5px] border-slate-300 rounded-full checked:border-teal-700 transition-all cursor-pointer bg-white" />
                  <span className="absolute w-[10px] h-[10px] bg-teal-700 rounded-full opacity-0 peer-checked:opacity-100 transition-all pointer-events-none"></span>
                </span>
                <span className="font-bold text-slate-800 text-[1.1rem]">15<Rb t="文字" r="もじ" /> × 16<Rb t="行" r="ぎょう" /> (<Rb t="低学年" r="ていがくねん" />)</span>
              </label>
            </div>
          </div>

          {/* 禁則処理 */}
          <div>
            <h3 className="font-bold text-slate-800 text-[1.1rem] mb-4"><Rb t="禁則処理" r="きんそくしょり" /></h3>
            <div className="space-y-5 pl-2" role="radiogroup" aria-label="禁則処理">
              <label className="flex items-center gap-4 cursor-pointer group min-h-[44px]">
                <span className="relative flex items-center justify-center shrink-0">
                  <input type="radio" name="kinsoku" checked={settings.kinsokuMode === 'oidashi'} onChange={() => setSettings((prev) => ({ ...prev, kinsokuMode: 'oidashi' }))} className="peer appearance-none w-[22px] h-[22px] border-[2.5px] border-slate-300 rounded-full checked:border-teal-700 transition-all cursor-pointer bg-white" />
                  <span className="absolute w-[10px] h-[10px] bg-teal-700 rounded-full opacity-0 peer-checked:opacity-100 transition-all pointer-events-none"></span>
                </span>
                <span className="font-bold text-slate-800 text-[1.1rem] leading-relaxed">
                  <Rb t="追" r="お" />い<Rb t="出" r="だ" />し <span className="font-medium text-slate-600 text-[1rem]">（<Rb t="前行末" r="ぜんぎょうまつ" />の<Rb t="文字" r="もじ" />を<Rb t="次行" r="じぎょう" />に<Rb t="送" r="おく" />る）</span>
                </span>
              </label>
              <label className="flex items-center gap-4 cursor-pointer group min-h-[44px]">
                <span className="relative flex items-center justify-center shrink-0">
                  <input type="radio" name="kinsoku" checked={settings.kinsokuMode === 'burasagari'} onChange={() => setSettings((prev) => ({ ...prev, kinsokuMode: 'burasagari' }))} className="peer appearance-none w-[22px] h-[22px] border-[2.5px] border-slate-300 rounded-full checked:border-teal-700 transition-all cursor-pointer bg-white" />
                  <span className="absolute w-[10px] h-[10px] bg-teal-700 rounded-full opacity-0 peer-checked:opacity-100 transition-all pointer-events-none"></span>
                </span>
                <span className="font-bold text-slate-800 text-[1.1rem] leading-relaxed">
                  ぶら<Rb t="下" r="さ" />がり <span className="font-medium text-slate-600 text-[1rem]">（マス<Rb t="外" r="そと" />に<Rb t="小" r="ちい" />さく<Rb t="表示" r="ひょうじ" />）</span>
                </span>
              </label>
            </div>
          </div>

          <div className="flex justify-end pt-4">
            <button type="button" onClick={() => setSettingsModalOpen(false)} className="tap-44 px-8 pt-3 pb-2 rounded-xl bg-slate-800 text-white font-bold hover:bg-slate-700 transition-all active:scale-95 shadow-sm leading-loose">
              <Rb t="保存" r="ほぞん" />して<Rb t="閉" r="と" />じる
            </button>
          </div>
        </div>
      </Modal>

      {applyUpdate && <UpdateBanner onApply={applyUpdate} />}
    </div>
  );
};

syncVisualViewport();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
