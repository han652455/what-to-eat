/* 今天吃什么 · Service Worker
 * 作用：把应用外壳（HTML / Manifest / 图标）缓存到本地，
 * 使「添加到主屏幕」后以全屏 App 形态离线可用。
 * 注意：请用 http(s)（如本地静态服务器或托管）访问本页，
 *       file:// 直接打开时浏览器不会注册 SW，属正常现象。
 */
const CACHE = 'what2eat-v1';
const ASSETS = ['index.html', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((r) =>
      r || fetch(e.request).then((resp) => {
        const cp = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, cp));
        return resp;
      }).catch(() => caches.match('index.html'))
    )
  );
});
