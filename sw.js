/* オンライン原稿用紙 Lite — Service Worker
 *
 * 【重要】activate では自アプリ以外のキャッシュを削除しない。
 *   旧配信元の gigayama.github.io は数十個のアプリが同一オリジンを共有していた。
 *   同居する配置に戻したときに他アプリを巻き込まないよう、
 *   caches.keys() を全部消すと、他のアプリがオフラインで起動しなくなる。
 *   CACHE_PREFIX で始まるキャッシュだけを掃除する。
 *
 * この Service Worker は localStorage を一切操作しない
 * （そもそも Service Worker からは触れないうえ、児童の書きかけを壊す元になる）。
 *
 * APP_VERSION は手で上げない。`npm run build:sw` が先読み対象の中身から自動で決める。
 * （手で上げる運用は 2026-08-21 に全リポジトリで同時に漏れる事故を起こした）
 */
const CACHE_PREFIX = 'genko-lite-';
const APP_VERSION = 'v1da88ed2'; /* __APP_VERSION__ */
const CACHE_STATIC = CACHE_PREFIX + 'static-' + APP_VERSION;
const CACHE_RUNTIME = CACHE_PREFIX + 'runtime-' + APP_VERSION;

// 先読みするのはアプリ本体だけ。校内 Wi-Fi で40人が同時に開くため、
// 先読みの総量が膨らむと初回表示が止まる。
const PRECACHE_URLS = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './install-hook.js',
  './css/style.css',
  './js/icons.js',
  './js/app.js',
  './vendor/react.js',
  './vendor/react-dom.js',
  './vendor/sweetalert2.js',
  './favicon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_STATIC);
    // addAll は1本でも失敗すると全体が落ちる。個別に入れて、
    // 1ファイル取りこぼしただけでオフライン対応がまるごと無くなる事故を防ぐ。
    await Promise.all(PRECACHE_URLS.map((url) => cache
      .add(new Request(url, { cache: 'reload' }))
      .catch((err) => console.warn('[sw] 先読みできなかった:', url, err))));
    // ここでは skipWaiting しない。
    // 児童が作文を打っている最中に中身が入れ替わると、打ちかけの文が消える。
    // 画面の「さいしんに する」を押してもらってから切り替える。
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      // ⚠️ 自アプリの接頭辞で始まるものだけを消す。
      //    ここを外すと同じオリジンにある他のアプリのキャッシュまで消える。
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_STATIC && key !== CACHE_RUNTIME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 画面遷移は network-first。更新をすぐ届け、圏外なら手元の控えを出す。
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        // ⚠️ 200 以外を控えにしない。学校のフィルタリングが返すブロック画面や
        //    404 をそのまま控えにすると、以後オフラインのたびにそれが出る。
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          // respondWith が終わると clone の中身が捨てられることがあるので待たせる
          event.waitUntil(caches.open(CACHE_STATIC).then((cache) => cache.put('./index.html', copy)));
        }
        return response;
      } catch (err) {
        return (await caches.match('./index.html'))
          || (await caches.match('./offline.html'))
          || Response.error();
      }
    })());
    return;
  }

  // 同一オリジンの静的ファイルは cache-first（校内Wi-Fiが混んでいても即表示）。
  // 他オリジン（Google Fonts）は素通しする。届かなくても字の形が変わるだけで動く。
  if (url.origin !== self.location.origin) return;

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response && response.ok && response.type === 'basic') {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE_RUNTIME).then((cache) => cache.put(request, copy)));
    }
    return response;
  })));
});

self.addEventListener('message', (event) => {
  // 画面側で「さいしんに する」が押されたときだけ切り替える
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
