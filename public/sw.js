/* TechAsset service worker.
 *
 * Versión: `__BUILD_ID__` lo reemplaza el build (vite.config.ts, plugin
 * techasset:sw-version) por un hash del bundle. Cada deploy cambia sw.js, el
 * navegador instala el nuevo y la app avisa "Hay una versión nueva · Actualizar"
 * (con la app abierta no se activa solo: el cambio de código a mitad de un
 * préstamo no lo decide el SW). Al activarse borra los cachés de versiones viejas.
 *
 * Estrategias:
 *  - navegación: red primero y sin caché HTTP (siempre el index.html del último
 *    deploy, que apunta a los /assets nuevos); sin red, el shell guardado.
 *  - /assets/* (nombres con hash): caché primero; un deploy cambia los nombres,
 *    así que nunca se sirve CSS/JS viejo para un index nuevo.
 *  - /api/*, /uploads/*, /downloads/*: no pasan por el SW (siempre red, sin
 *    datos viejos ni archivos guardados en el dispositivo).
 *  - resto (manifest, íconos, logos): red primero, caché si no hay red.
 */
const VERSION = '__BUILD_ID__';
const CACHE = `techasset-${VERSION}`;
// Rutas de la app (el mismo index.html). Las páginas que arma el server (el
// calendario público, por ejemplo) no se guardan como shell.
const SPA_ROUTE = /^\/(login|register|sede\/.*)?$/i;
const BYPASS = /^\/(api|uploads|downloads)\//;
const SHELL = ['/manifest.webmanifest', '/favicon.png', '/techasset-logo.svg', '/icons/icon-192.png', '/icons/badge-96.png'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // El shell para abrir sin conexión: index.html y lo que carga al arrancar
    // (JS y CSS de entrada, la fuente precargada), leído del propio index.
    try {
      const response = await fetch('/', { cache: 'no-store' });
      if (response.ok) {
        const html = await response.clone().text();
        await cache.put('/', response);
        const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]))];
        await cache.addAll(assets);
      }
      await cache.addAll(SHELL);
    } catch {
      // Sin red al instalar: el shell se completa con lo que se vaya pidiendo.
    }
    // Primera instalación (todavía no hay un SW activo): tomar el control ya.
    // Una actualización espera a que la app pida SKIP_WAITING ("Actualizar").
    if (!self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key.startsWith('techasset-')).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

const offlinePage = () => new Response(
  '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TechAsset</title>'
  + '<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0D0F12;color:#ECEEF1;font:15px system-ui,sans-serif">'
  + '<p>Sin conexión. TechAsset se abre cuando vuelva internet.</p></body></html>',
  { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
);

const remember = (key, response) => {
  if (!response || !response.ok) return;
  const copy = response.clone();
  caches.open(CACHE).then((cache) => cache.put(key, copy)).catch(() => undefined);
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || BYPASS.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((response) => {
          if (SPA_ROUTE.test(url.pathname)) remember('/', response);
          return response;
        })
        .catch(() => caches.match('/').then((cached) => cached || offlinePage()))
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        remember(request, response);
        return response;
      }))
    );
    return;
  }

  event.respondWith(
    fetch(request, { cache: 'no-store' })
      .then((response) => {
        remember(request, response);
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || Response.error()))
  );
});

// Push: notificaciones. Cae bien aunque no haya VAPID configurado.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || 'TechAsset';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
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
