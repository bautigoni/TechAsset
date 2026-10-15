// Corre el banco de pruebas del frontend en Edge/Chrome headless.
//
//   1. npx -p node@22 node server/scripts/bench/record-api.mjs perf/.out/perf-fixtures.json
//   2. npx vite build --config perf/vite.config.ts --outDir perf/.out/dist
//   3. node perf/run.mjs perf/.out/dist [cpuThrottle=4] [corridas=5]
//
// cpuThrottle simula una máquina N veces más lenta (4 ≈ notebook escolar o
// celular de gama media). Mide: arranque en frío, apertura de cada pantalla
// (primera vez = baja el chunk; segunda = ya en caché) y scroll.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const dist = path.resolve(process.argv[2] || 'perf/.out/dist');
const throttle = Number(process.argv[3] || 4);
const runs = Number(process.argv[4] || 5);
const fixtures = process.env.PERF_FIXTURES || path.join(dist, 'perf-fixtures.json');
const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
];
const VIEWS = ['Dispositivos', 'Préstamos', 'Inventario TIC', 'Analítica', 'Agenda TIC', 'Horarios', 'Tareas TIC', 'Estado aulas', 'Tickets', 'Configuración', 'Dashboard'];

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = url === '/perf-fixtures.json' ? fixtures : path.join(dist, url);
  if (!file.startsWith(dist) && file !== fixtures) { res.statusCode = 403; return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  // Como producción: assets con hash cacheables, html no.
  res.setHeader('Cache-Control', url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({
  executablePath: BROWSERS.find(candidate => fs.existsSync(candidate)),
  headless: true,
  args: ['--no-first-run', '--disable-extensions']
});
// Suma el tiempo del hilo principal por tipo de trabajo: los hijos directos de
// cada RunTask (EvaluateScript, FunctionCall, UpdateLayoutTree, Layout...).
async function traceBreakdown(page, action) {
  await page.tracing.start({ categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline'] });
  await action();
  const buffer = await page.tracing.stop();
  const events = JSON.parse(new TextDecoder().decode(buffer)).traceEvents || [];
  const renderers = new Set(events.filter(event => event.name === 'thread_name' && event.args?.name === 'CrRendererMain').map(event => `${event.pid}:${event.tid}`));
  const busiest = new Map();
  for (const event of events) if (event.ph === 'X' && event.name === 'RunTask' && renderers.has(`${event.pid}:${event.tid}`)) {
    const key = `${event.pid}:${event.tid}`;
    busiest.set(key, (busiest.get(key) || 0) + (event.dur || 0));
  }
  const main = [...busiest.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const list = events.filter(event => event.ph === 'X' && event.dur && `${event.pid}:${event.tid}` === main).sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const out = {};
  const stack = [];
  for (const event of list) {
    while (stack.length && stack[stack.length - 1].ts + stack[stack.length - 1].dur <= event.ts) stack.pop();
    if (stack.length === 1 && stack[0].name === 'RunTask') out[event.name] = (out[event.name] || 0) + event.dur / 1000;
    stack.push(event);
  }
  return Object.fromEntries(Object.entries(out).filter(([, ms]) => ms >= 5).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v)]));
}

// Tiempo propio (self) por función de un perfil de CPU de V8.
function topSelfTime(profile, limit = 25) {
  const byId = new Map(profile.nodes.map(node => [node.id, node]));
  const self = new Map();
  const deltas = profile.timeDeltas || [];
  (profile.samples || []).forEach((id, index) => {
    const frame = byId.get(id)?.callFrame;
    if (!frame) return;
    const file = (frame.url || '').split('/').pop();
    const key = `${frame.functionName || '(anónima)'} ${file}:${frame.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + (deltas[index] || 0) / 1000);
  });
  return [...self.entries()].filter(([key]) => !/^\((idle|program|garbage collector)\)/.test(key)).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k, v]) => `${v.toFixed(1).padStart(7)} ms  ${k}`);
}

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function openApp(context) {
  const page = await context.newPage();
  await page.setViewport({ width: 1366, height: 800 });
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => performance.getEntriesByName('perf-app-ready').length > 0, { timeout: 60000 });
  // Que termine lo que la app hace después de pintar (datos, prefetch en idle).
  await new Promise(resolve => setTimeout(resolve, 1500));
  return page;
}

try {
  // 1. Arranque en frío: contexto nuevo (sin caché) por corrida.
  const startups = [];
  for (let i = 0; i < runs; i += 1) {
    const context = await browser.createBrowserContext();
    const page = await openApp(context);
    startups.push(await page.evaluate(() => window.__perf.startup()));
    await context.close();
  }

  // 2. Pantallas: primera apertura (chunk frío) y segunda (en caché).
  const context = await browser.createBrowserContext();
  const page = await openApp(context);
  const first = await page.evaluate(labels => window.__perf.views(labels), VIEWS);
  const second = await page.evaluate(labels => window.__perf.views(labels), VIEWS);

  // 3. Scroll en las pantallas largas.
  const scrolls = {};
  for (const view of ['Dispositivos', 'Préstamos', 'Dashboard', 'Agenda TIC']) {
    await page.evaluate(label => window.__perf.views([label]), view);
    scrolls[view] = await page.evaluate(() => window.__perf.scroll(90));
  }
  await context.close();

  // 4. Desglose del hilo principal (script, estilos, layout, pintado...) del
  //    arranque y de abrir Préstamos/Dispositivos por primera vez.
  const traced = await browser.createBrowserContext();
  const tracePage = await traced.newPage();
  await tracePage.setViewport({ width: 1366, height: 800 });
  const traceCdp = await tracePage.createCDPSession();
  await traceCdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  const profiles = {};
  const profileDuring = async (label, action) => {
    if (!process.env.PERF_PROFILE) return action();
    await traceCdp.send('Profiler.enable');
    await traceCdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await traceCdp.send('Profiler.start');
    const result = await action();
    const { profile } = await traceCdp.send('Profiler.stop');
    profiles[label] = topSelfTime(profile);
    return result;
  };
  const startupBreakdown = await traceBreakdown(tracePage, () => profileDuring('startup', async () => {
    await tracePage.goto(`${base}/`, { waitUntil: 'load' });
    await tracePage.waitForFunction(() => performance.getEntriesByName('perf-app-ready').length > 0, { timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 1500));
  }));
  const viewBreakdown = {};
  for (const view of ['Préstamos', 'Dispositivos']) {
    viewBreakdown[view] = await traceBreakdown(tracePage, () => profileDuring(view, () => tracePage.evaluate(label => window.__perf.views([label]), view)));
  }
  await traced.close();

  const pick = key => median(startups.map(item => key(item)));
  const result = {
    cpuThrottle: throttle,
    startup: {
      domContentLoaded: pick(s => s.domContentLoaded),
      firstContentfulPaint: pick(s => s.firstContentfulPaint),
      appReady: pick(s => s.appReady),
      longTaskMs: pick(s => Math.round(s.longTasks.total)),
      blockingMs: pick(s => Math.round(s.longTasks.blocking)),
      jsKB: startups[0].jsKB, cssKB: startups[0].cssKB, domNodes: startups[0].domNodes
    },
    views: VIEWS.map((view, index) => ({
      view, firstMs: first[index].ms, againMs: second[index].ms,
      longTaskMs: Math.round(first[index].longTasks.total), domNodes: second[index].domNodes
    })),
    scroll: scrolls,
    mainThreadMs: { startup: startupBreakdown, ...viewBreakdown },
    ...(process.env.PERF_PROFILE ? { profiles } : {})
  };
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  server.close();
}
