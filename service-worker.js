// الصائم الصغير — Service Worker v13 (Fix: تحديثات مضمونة + كاش أذكى)
// الهدف: ما يعود يعلق الموقع على نسخة قديمة من app.js/styles.css بعد نشر GitHub/Netlify

const PRECACHE = 'lfa-precache-v13';
const RUNTIME  = 'lfa-runtime-v13';

// ملفات أساسية للتشغيل (أضفنا styles.css لأنها كانت غير مُخزّنة)
const PRECACHE_URLS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './data.json',
  './questions.json',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-192-maskable.png',
  './icon-512-maskable.png',
  './apple-touch-icon.png'
];

// ─────────────────────────────────────────────────────────────
// Install: precache core
// ─────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[SW] precache error:', err))
  );
});

// ─────────────────────────────────────────────────────────────
// Activate: cleanup old caches + claim clients
// ─────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => ![PRECACHE, RUNTIME].includes(k)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function isHTMLRequest(req) {
  return req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
}
function isJSONRequest(req) {
  return (req.headers.get('accept') || '').includes('application/json') || req.url.endsWith('.json');
}
function isAssetRequest(url) {
  return url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.endsWith('.png') || url.pathname.endsWith('.webmanifest') || url.pathname.endsWith('.ico') || url.pathname.endsWith('.svg');
}

// ─────────────────────────────────────────────────────────────
// Fetch strategies:
// 1) HTML (pages): Network-first (حتى يلتقط التحديث فوراً) مع fallback للنسخة المخزنة عند انقطاع النت
// 2) JSON: Network-first مع fallback
// 3) Assets (js/css/images): Stale-while-revalidate (يفتح بسرعة ويُحدّث بالخلفية)
// ─────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // لا نخزن طلبات خارج الدومين (fonts, supabase…)
  if (url.origin !== self.location.origin) return;

  // (1) HTML
  if (isHTMLRequest(req)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(RUNTIME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match(req);
        return cached || caches.match('./index.html') || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  // (2) JSON
  if (isJSONRequest(req)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(RUNTIME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match(req);
        return cached || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  // (3) Static assets
  if (isAssetRequest(url)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      const cache = await caches.open(RUNTIME);

      const fetchAndUpdate = fetch(req).then((resp) => {
        if (resp && resp.status === 200 && resp.type !== 'opaque') {
          cache.put(req, resp.clone());
        }
        return resp;
      }).catch(() => null);

      // stale-while-revalidate
      return cached || (await fetchAndUpdate) || new Response('', { status: 503 });
    })());
    return;
  }

  // Default: try cache then network
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});

// ─────────────────────────────────────────────────────────────
// Messages
// ─────────────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data === 'skipWaiting' || event.data === 'SKIP_WAITING') self.skipWaiting();
});
