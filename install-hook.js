/* インストールの合図（beforeinstallprompt）を、いちばん先に受け取るための小さな部品。
 *
 * Chrome は条件が揃うと即座にこのイベントを出す。React の読み込みや描画のあとで
 * 待ち構えても、そのときには合図が終わっていて「インストール」ボタンが出ない。
 * 通信の遅い端末ほど起きやすい。
 *
 * インラインの <script> にすると CSP の script-src に 'unsafe-inline' が要る。
 * それでは CSP を入れた意味がほとんど無くなるので、小さな外部ファイルにして
 * <head> の先頭で同期読み込みしている。 */
(function () {
  window.__pwaInstallPrompt = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    window.__pwaInstallPrompt = e;
    window.dispatchEvent(new Event('pwa-install-available'));
  });

  window.addEventListener('appinstalled', function () {
    window.__pwaInstallPrompt = null;
    window.dispatchEvent(new Event('pwa-installed'));
  });
})();
