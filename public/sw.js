/* TechAsset service worker - shell cache + estrategia por tipo de request. */
const CACHE = 'techasset-shell-v3';
const SHELL = ['/manifest.webmanifest', '/favicon.png', '/techasset-logo.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => clients.forEach((client) => client.postMessage({ type: 'TECHASSET_SW_READY' })))
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API: network-first (datos siempre frescos; sin cache offline para no servir viejo).
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
    return;
  }

  // Navegación (SPA): red primero y sin HTTP cache, así nunca queda pegado un bundle viejo.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('/index.html', copy));
        }
        return response;
      }).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Assets versionados por Vite: cache-first. El nombre hash cambia con cada build.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request).then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Resto de estáticos: network-first para que sw.js, manifest e íconos no queden congelados.
  event.respondWith(
    fetch(request, { cache: 'no-store' }).then((response) => {
      if (response && response.status === 200) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    }).catch(() => caches.match(request))
  );
});

// Push: notificaciones (sección F). Cae bien aunque no haya VAPID configurado.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || 'TechAsset';
  const options = {
    body: data.body || '',
    icon: '/favicon.png',
    badge: '/favicon.png',
    data: { link: data.link || '/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then((clients) => {
    for (const client of clients) {
      if ('focus' in client) { client.navigate(link); return client.focus(); }
    }
    return self.clients.openWindow(link);
  }));
});
