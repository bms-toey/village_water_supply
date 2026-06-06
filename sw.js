// AquaFlow Pro — Service Worker
// Strategy:
//   Local app files  → Network-first  (always fresh on deploy, cache = offline fallback)
//   CDN resources    → Cache-first    (fonts/icons rarely change, saves bandwidth)
//   Supabase API     → Network-only   (never cache live data)

const CACHE_APP = 'aquaflow-app-v2';
const CACHE_CDN = 'aquaflow-cdn-v1';

// ─── Install ──────────────────────────────────────────────────
self.addEventListener('install', event => {
  // Pre-cache minimal shell for offline access
  event.waitUntil(
    caches.open(CACHE_APP)
      .then(cache => cache.addAll(['/', '/index.html', '/manifest.json']))
      .catch(() => {})
  );
  // Take control immediately — client will reload to login on controllerchange
  self.skipWaiting();
});

// ─── Activate ─────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_APP && k !== CACHE_CDN)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch ────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // 1. Supabase / REST API → Network only (never cache live data)
  if (url.hostname.includes('supabase.co') || url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 2. CDN (fonts, tabler icons, leaflet) → Cache-first (stable external resources)
  if (url.origin !== self.location.origin) {
    event.respondWith(
      caches.open(CACHE_CDN).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(res => {
            if (res?.ok) cache.put(event.request, res.clone());
            return res;
          }).catch(() => cached || new Response('', { status: 503 }));
        })
      )
    );
    return;
  }

  // 3. Local app files (HTML, JS, CSS, images) → Network-first
  //    Try network → update cache → serve fresh
  //    If offline → fall back to cache
  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (res?.ok) {
          caches.open(CACHE_APP).then(c => c.put(event.request, res.clone()));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});

// ─── Message from client ──────────────────────────────────────
// Client calls: reg.waiting.postMessage({ type: 'SKIP_WAITING' })
// to activate the new SW immediately after user confirms
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
