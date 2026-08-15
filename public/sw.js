// NF-01: オフライン動作。アプリシェルと静的アセットをキャッシュする。
const CACHE = 'coffeerence-v1';
// サブパス配信（GitHub Pages 等）でも動くよう、スコープ基準の相対パスで持つ。
const BASE = new URL('./', self.location.href).pathname;
const SHELL_DOCUMENT = `${BASE}index.html`;
const APP_SHELL = [
  BASE,
  SHELL_DOCUMENT,
  `${BASE}manifest.webmanifest`,
  `${BASE}icon.svg`,
  `${BASE}bell.mp3`,
  `${BASE}chime-desk.mp3`,
  `${BASE}chime-high.mp3`,
  `${BASE}chime-low.mp3`,
  `${BASE}chime-beep.mp3`,
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(SHELL_DOCUMENT, copy));
          return response;
        })
        .catch(() => caches.match(SHELL_DOCUMENT).then((hit) => hit || Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => hit || Response.error());
      return hit || network;
    }),
  );
});
