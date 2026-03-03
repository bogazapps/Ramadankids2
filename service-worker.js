// الصائم الصغير — Service Worker v14
// هدف التحديث: منع تعليق الأجهزة على نسخة قديمة + إجبار تفعيل النسخة الجديدة تلقائياً
// - تغيير أسماء الكاش عند كل إصدار (v14) لمسح القديم
// - Network-first للـ HTML و JSON مع bypass للـ HTTP cache
// - Stale-while-revalidate للـ assets مع bypass
// - إرسال إشعار للصفحات عند تفعيل SW (حتى يعمل reload عبر app.js)

const SW_VERSION = 'v14';
const PRECACHE = `lfa-precache-${SW_VERSION}`;
const RUNTIME  = `lfa-runtime-${SW_VERSION}`;

// ملفات أساسية للتشغيل
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
// Helpers
// ─────────────────────────────────────────────────────────────
function noStore(req) {
  // bypass browser HTTP cache
  return new Request(req, { cache: 'no-store' });
}
function isHTMLRequest(req) {
  return req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
}
function isJSONRequest(req) {
  return (req.headers.get('accept') || '').includes('application/json') || req.url.endsWith('.json');
}
function isAssetRequest(url) {
  return url.pathname.endsWith('.js') ||
         url.pathname.endsWith('.css') ||
         url.pathname.endsWith('.png') ||
         url.pathname.endsWith('.webmanifest') ||
         url.pathname.endsWith('.ico') ||
         url.pathname.endsWith('.svg');
}

// ─────────────────────────────────────────────────────────────
// Install: precache core + activate ASAP
// ─────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(PRECACHE);
      // cache: 'reload' forces revalidation even if HTTP cached
      await cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' })));
    } catch (err) {
      console.warn('[SW] precache error:', err);
    }
    await self.skipWaiting();
  })());
});

// ─────────────────────────────────────────────────────────────
// Activate: cleanup old caches + claim clients + notify pages
// ─────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => ![PRECACHE, RUNTIME].includes(k))
      .map((k) => caches.delete(k))
    );

    await self.clients.claim();

    // notify all open pages (app.js will reload on controllerchange, but this helps too)
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clients.forEach((c) => c.postMessage({ type: 'SW_ACTIVATED', version: SW_VERSION }));
  })());
});

// ─────────────────────────────────────────────────────────────
// Fetch strategies:
// 1) HTML: Network-first (حتى يلتقط index/app/css فوراً) مع fallback للكاش عند انقطاع النت
// 2) JSON: Network-first (مهم للأسئلة) مع fallback
// 3) Assets: Stale-while-revalidate (يفتح بسرعة ويُحدّث بالخلفية)
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
        const fresh = await fetch(noStore(req));
        const cache = await caches.open(RUNTIME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match(req);
        return cached || caches.match('./index.html') ||
          new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  // (2) JSON
  if (isJSONRequest(req)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(noStore(req));
        const cache = await caches.open(RUNTIME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match(req);
        return cached ||
          new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  // (3) Static assets
  if (isAssetRequest(url)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      const cache = await caches.open(RUNTIME);

      const fetchAndUpdate = fetch(noStore(req)).then((resp) => {
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
    caches.match(req).then((cached) => cached || fetch(noStore(req)))
  );
});

// ─────────────────────────────────────────────────────────────
// Messages
// ─────────────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  const d = event.data;
  if (!d) return;

  if (d === 'skipWaiting' || d === 'SKIP_WAITING' || (typeof d === 'object' && d.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});
