// Banco de pruebas de rendimiento del frontend.
//
// Es la app real (mismo main.tsx), compilada en modo producción, pero con fetch
// respondiendo desde respuestas grabadas con server/scripts/bench/record-api.mjs.
// Así se mide arranque, cambio de pantalla y scroll con datos verdaderos, sin
// servidor ni sesión en el navegador. Ver perf/README.md.
type Fixture = { status: number; body: unknown };

const params = new URLSearchParams(location.search);
const latency = Number(params.get('latency') || 0);

async function boot() {
  const fixtures: Record<string, Fixture> = await fetch('/perf-fixtures.json').then(r => r.json());
  const byPath = new Map<string, Fixture>();
  for (const [url, fixture] of Object.entries(fixtures)) {
    const pathOnly = url.split('?')[0];
    if (!byPath.has(pathOnly)) byPath.set(pathOnly, fixture);
  }
  const realFetch = window.fetch.bind(window);
  (window as unknown as { __perfRequests: string[] }).__perfRequests = [];
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url;
    if (!url.startsWith('/api/')) return realFetch(input, init);
    (window as unknown as { __perfRequests: string[] }).__perfRequests.push(url);
    if (latency) await new Promise(resolve => setTimeout(resolve, latency));
    const method = String(init?.method || 'GET').toUpperCase();
    const fixture = method === 'GET' ? (fixtures[url] || byPath.get(url.split('?')[0])) : undefined;
    const body = fixture && fixture.status === 200 ? fixture.body : { ok: true, items: [], settings: {} };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  // Sin service worker: cachearía assets entre builds y ensuciaría las mediciones.
  if ('serviceWorker' in navigator) {
    for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
    Object.defineProperty(navigator.serviceWorker, 'register', { value: async () => undefined });
  }
  performance.mark('perf-fetch-mock-ready');
  await import('../src/main');
}

// ── Mediciones (se llaman desde la consola o desde el navegador automatizado) ──
const longTasks: Array<{ start: number; duration: number }> = [];
try {
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) longTasks.push({ start: entry.startTime, duration: entry.duration });
  }).observe({ type: 'longtask', buffered: true });
} catch { /* sin soporte */ }

// "App lista" = primera vez que hay una vista activa con contenido.
const readyObserver = new MutationObserver(() => {
  const view = document.querySelector('.view.active');
  if (view && view.childElementCount > 0) {
    performance.mark('perf-app-ready');
    readyObserver.disconnect();
  }
});
readyObserver.observe(document.documentElement, { childList: true, subtree: true });

const blockingOver = (from: number) => longTasks.filter(task => task.start >= from)
  .reduce((acc, task) => ({ count: acc.count + 1, total: acc.total + task.duration, blocking: acc.blocking + Math.max(0, task.duration - 50) }), { count: 0, total: 0, blocking: 0 });

// Cede el hilo sin depender de frames ni timers: MessageChannel no se frena con
// la pestaña oculta (requestAnimationFrame se congela y setTimeout se espacia a 1 s).
const channel = new MessageChannel();
const pending: Array<() => void> = [];
channel.port1.onmessage = () => pending.shift()?.();
const yieldTask = () => new Promise<void>(resolve => { pending.push(resolve); channel.port2.postMessage(0); });

async function settle(from: number) {
  // Hasta que el DOM pasa 150 ms sin cambios. Cada vuelta fuerza el layout, así
  // el tiempo incluye estilos y layout (no el pintado).
  let lastMutation = performance.now();
  const observer = new MutationObserver(() => { lastMutation = performance.now(); });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  const deadline = performance.now() + 10000;
  while (performance.now() < deadline) {
    await yieldTask();
    void document.body.getBoundingClientRect().height;
    if (performance.now() - lastMutation > 150) break;
  }
  observer.disconnect();
  // Visible: esperar a que ese último cambio llegue a pintarse.
  if (document.visibilityState === 'visible') await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return lastMutation - from;
}

const perfApi = {
  startup() {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0;
    const ready = performance.getEntriesByName('perf-app-ready')[0]?.startTime || 0;
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const bytes = (ext: RegExp) => Math.round(resources.filter(r => ext.test(r.name)).reduce((acc, r) => acc + (r.decodedBodySize || 0), 0) / 1024);
    return {
      domContentLoaded: Math.round(nav?.domContentLoadedEventEnd || 0),
      firstContentfulPaint: Math.round(fcp),
      appReady: Math.round(ready),
      jsKB: bytes(/\.js(\?|$)/), cssKB: bytes(/\.css(\?|$)/),
      longTasks: blockingOver(0),
      domNodes: document.getElementsByTagName('*').length
    };
  },
  /** Abre cada pantalla del menú y mide hasta que el DOM se aquieta. */
  async views(labels: string[]) {
    const results: Array<{ view: string; ms: number; longTasks: ReturnType<typeof blockingOver>; domNodes: number }> = [];
    for (const label of labels) {
      const button = [...document.querySelectorAll<HTMLElement>('.sidebar button, .sidebar a')]
        .find(element => element.textContent?.trim().toLowerCase().startsWith(label.toLowerCase()));
      if (!button) { results.push({ view: label, ms: -1, longTasks: blockingOver(Infinity), domNodes: 0 }); continue; }
      await settle(performance.now());
      const previous = document.querySelector('.view.active');
      const started = performance.now();
      button.click();
      // Lista = hay una vista activa NUEVA con contenido, y llegó a pintarse.
      const deadline = started + 15000;
      while (performance.now() < deadline) {
        const current = document.querySelector('.view.active');
        if (current && current !== previous && current.childElementCount > 0 && !current.querySelector('.t-skel-card, .skeleton')) break;
        await yieldTask();
      }
      if (document.visibilityState === 'visible') await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const ms = performance.now() - started;
      results.push({ view: label, ms: Math.round(ms), longTasks: blockingOver(started), domNodes: document.getElementsByTagName('*').length });
    }
    return results;
  },
  /**
   * Scrollea la página entera de a pasos. Por paso mide lo que cuesta el scroll
   * en el hilo principal: los listeners de scroll (se disparan a mano, porque con
   * la pestaña oculta el navegador no los emite), lo que encolen, y el
   * recálculo de estilos + layout. No incluye el pintado.
   */
  async scroll(step = 120) {
    window.scrollTo(0, 0);
    await settle(performance.now());
    const started = performance.now();
    const frames: number[] = [];
    const max = document.documentElement.scrollHeight - innerHeight;
    const visible = document.visibilityState === 'visible';
    let last = performance.now();
    for (let y = 0; y <= max; y += step) {
      const t0 = performance.now();
      window.scrollTo(0, y);
      if (visible) {
        // Con la pestaña visible: tiempo real entre frames pintados.
        const now = await new Promise<number>(resolve => requestAnimationFrame(resolve));
        frames.push(now - last);
        last = now;
      } else {
        window.dispatchEvent(new Event('scroll'));
        await yieldTask();
        void document.body.getBoundingClientRect().height;
        frames.push(performance.now() - t0);
      }
    }
    const sorted = [...frames].sort((a, b) => a - b);
    return {
      frames: frames.length,
      p50: Math.round(sorted[Math.floor(sorted.length * 0.5)] || 0),
      p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] || 0),
      worst: Math.round(sorted[sorted.length - 1] || 0),
      over50ms: frames.filter(frame => frame > 50).length,
      longTasks: blockingOver(started)
    };
  }
};
(window as unknown as { __perf: typeof perfApi }).__perf = perfApi;

void boot();
