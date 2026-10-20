// Sesión larga: fugas de memoria, pedidos duplicados y errores de consola.
//
//   node perf/soak.mjs --repo=<checkout> [--minutes=10] [--warp=3] [--db=<snapshot>] [--label=x]
//
// Sobre una copia del snapshot (15 ms por query, como Supabase):
//   1. Front: la app abierta navegando por todas las pantallas del menú (una
//      cada pocos segundos, ida y vuelta) durante --minutes minutos reales, con
//      los timers de la página acelerados --warp veces (setTimeout/setInterval
//      más cortos: el polling de 30 s corre cada 10 s con warp 3), así 10 min
//      reales ≈ 30 min de polling. Cada minuto: GC forzado y heap usado, nodos
//      del DOM y listeners (CDP Performance.getMetrics).
//   2. Pedidos duplicados: el mismo GET /api saliendo mientras otro idéntico
//      todavía está en vuelo (lo que una caché o un "en vuelo" tendría que evitar).
//   3. Errores: console.error, excepciones sin atrapar y respuestas 5xx.
//   4. Server: memoria (rss y heap después de GC) antes y después de 3 ráfagas
//      de 600 pedidos a los endpoints que más se usan.
// Escribe perf/.out/soak-<label>.json y un resumen.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import puppeteer from 'puppeteer-core';
import { findBrowser, freePort, snapshotDatabase } from '../e2e/lib/env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const option = (name, fallback) => { const found = argv.find(arg => arg.startsWith(`--${name}=`)); return found ? found.slice(name.length + 3) : fallback; };
const repo = path.resolve(option('repo', path.join(here, '..')));
const MINUTES = Number(option('minutes', 10));
const WARP = Number(option('warp', 3));
const LABEL = option('label', 'soak');
const DB = path.resolve(option('db', path.join(here, '..', 'docs', 'redesign', 'bench', 'snapshot.db')));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const MB = bytes => Math.round((bytes / 1048576) * 10) / 10;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'techasset-soak-'));
const dbCopy = path.join(tmpDir, 'soak.db');
await snapshotDatabase(DB, dbCopy);
const db = new Database(dbCopy);
const admin = db.prepare("SELECT id FROM users WHERE rol_global='Superadmin' AND activo=1 ORDER BY id LIMIT 1").get();
const token = crypto.randomBytes(32).toString('hex');
const now = new Date().toISOString();
db.prepare('INSERT INTO user_sessions (token, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)').run(token, admin.id, now, new Date(Date.now() + 86400000).toISOString(), now);
db.prepare("INSERT INTO app_settings (key, value) VALUES ('mail.modoPrueba', 'true') ON CONFLICT(key) DO UPDATE SET value='true'").run();
db.prepare('DELETE FROM push_subscriptions').run();
db.close();

const port = await freePort();
const statsPort = await freePort();
const child = spawn(process.execPath, ['--expose-gc', '--import', pathToFileURL(path.join(here, 'suite-preload.mjs')).href, 'server/index.js'], {
  cwd: repo,
  env: { ...process.env, PORT: String(port), SERVER_HOST: '127.0.0.1', SQLITE_DB_PATH: dbCopy, DB_DRIVER: 'sqlite', DATABASE_URL: '', MODO_PRUEBA: 'true',
    SMTP_SERVER: '', SMTP_USER: '', SMTP_APP_PASSWORD: '', RESEND_API_KEY: '', GOOGLE_SHEET_CSV_URL: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '',
    GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_REDIRECT_URI: '', SENTRY_DSN: '',
    UPLOADS_DIR: path.join(tmpDir, 'uploads'), TOOLS_TEMP_DIR: path.join(tmpDir, 'tools'), CACHE_CSV_PATH: path.join(tmpDir, 'c.csv'), DEVICES_APP_CSV_PATH: path.join(tmpDir, 'd.csv'),
    BENCH_STATS_PORT: String(statsPort), BENCH_LATENCY_MS: '15' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverLog = '';
child.stdout.on('data', chunk => { serverLog += chunk; });
child.stderr.on('data', chunk => { serverLog += chunk; });
const base = `http://127.0.0.1:${port}`;
const stats = async op => (await fetch(`http://127.0.0.1:${statsPort}/${op}`)).json();
for (let i = 0; i < 600; i += 1) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* todavía no */ } await sleep(100); }

const result = { label: LABEL, repo, minutes: MINUTES, warp: WARP, samples: [], duplicates: [], consoleErrors: [], pageErrors: [], serverErrors: [], requests: 0, views: 0, server: {} };
const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true });
try {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: 'techasset_session', value: token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' });
  const page = await context.newPage();
  await page.setViewport({ width: 1366, height: 800 });
  await page.setBypassServiceWorker(true);
  await page.evaluateOnNewDocument((warp) => {
    try { localStorage.setItem('techasset_active_site', 'NFPT'); localStorage.setItem('techasset_last_seen_release', '9999'); } catch { /* nada */ }
    // Timers acelerados: el polling y los relojes corren `warp` veces más seguido.
    const st = window.setTimeout; const si = window.setInterval;
    window.setTimeout = (fn, ms, ...rest) => st(fn, Math.max(0, (Number(ms) || 0) / warp), ...rest);
    window.setInterval = (fn, ms, ...rest) => si(fn, Math.max(1, (Number(ms) || 0) / warp), ...rest);
  }, WARP);
  const cdp = await page.createCDPSession();
  await cdp.send('Performance.enable');
  await cdp.send('Network.enable');
  const inflight = new Map();
  cdp.on('Network.requestWillBeSent', event => {
    const { url, method } = event.request;
    if (!/\/api\//.test(url)) return;
    result.requests += 1;
    const key = `${method} ${url.replace(base, '')}`;
    const list = inflight.get(key) || [];
    if (method === 'GET' && list.length) result.duplicates.push({ at: Date.now(), key, view: currentView });
    list.push(event.requestId);
    inflight.set(key, list);
    reqKey.set(event.requestId, key);
  });
  const reqKey = new Map();
  const done = event => {
    const key = reqKey.get(event.requestId);
    if (!key) return;
    reqKey.delete(event.requestId);
    const list = (inflight.get(key) || []).filter(id => id !== event.requestId);
    if (list.length) inflight.set(key, list); else inflight.delete(key);
  };
  cdp.on('Network.loadingFinished', done);
  cdp.on('Network.loadingFailed', done);
  cdp.on('Network.responseReceived', event => { if (event.response.status >= 500) result.serverErrors.push({ url: event.response.url.replace(base, ''), status: event.response.status }); });
  page.on('console', message => { if (message.type() === 'error') result.consoleErrors.push(message.text().slice(0, 300)); });
  page.on('pageerror', error => result.pageErrors.push(String(error?.message || error).slice(0, 300)));
  let currentView = 'dashboard';

  await page.goto(`${base}/sede/nfpt/dashboard`, { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(3000);
  const views = await page.evaluate(() => [...new Set([...document.querySelectorAll('aside [data-view]')].map(element => element.getAttribute('data-view')))].filter(Boolean));
  const sample = async minute => {
    await cdp.send('HeapProfiler.collectGarbage');
    await sleep(300);
    const heap = await cdp.send('Runtime.getHeapUsage');
    const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]));
    const entry = { minute, view: currentView, heapMB: MB(heap.usedSize), nodes: metrics.Nodes, listeners: metrics.JSEventListeners, documents: metrics.Documents };
    result.samples.push(entry);
    console.log(`  min ${minute}: heap ${entry.heapMB} MB · nodos ${entry.nodes} · listeners ${entry.listeners} · pedidos ${result.requests} · vistas ${result.views}`);
  };
  // Línea base en el Inicio, ya cargado.
  await sample(0);
  const end = Date.now() + MINUTES * 60000;
  let nextSample = Date.now() + 60000;
  let minute = 0;
  let index = 0;
  while (Date.now() < end) {
    // Recorrido: cada pantalla del menú y vuelta al Inicio (como alguien que trabaja).
    const view = views[index % views.length];
    index += 1;
    currentView = view;
    await page.evaluate(key => document.querySelector(`aside [data-view="${key}"]`)?.click(), view);
    result.views += 1;
    await sleep(2500);
    if (index % 3 === 0) {
      currentView = 'dashboard';
      await page.evaluate(() => document.querySelector('aside [data-view="dashboard"]')?.click());
      result.views += 1;
      await sleep(2500);
    }
    if (Date.now() >= nextSample) {
      minute += 1;
      nextSample += 60000;
      // Mismo punto de comparación: el Inicio, quieto 2 s.
      currentView = 'dashboard';
      await page.evaluate(() => document.querySelector('aside [data-view="dashboard"]')?.click());
      await sleep(2000);
      await sample(minute);
    }
  }
  await context.close();

  // Server: memoria tras ráfagas.
  const headers = { cookie: `techasset_session=${token}`, 'X-Site-Code': 'NFPT' };
  const endpoints = ['/api/devices', '/api/movements', '/api/agenda', '/api/tasks?space=all', '/api/notifications', '/api/loans/people', '/api/history?kind=loans&limit=50', '/api/site-settings'];
  const memory = async () => { await stats('gc'); await sleep(200); const s = await stats('stats'); return { rssMB: MB(s.rss), heapMB: MB(s.heapUsed) }; };
  result.server.before = await memory();
  result.server.bursts = [];
  for (let burst = 0; burst < 3; burst += 1) {
    const started = Date.now();
    let i = 0;
    const worker = async () => { while (i < 600) { const url = endpoints[i % endpoints.length]; i += 1; const response = await fetch(`${base}${url}`, { headers }); await response.arrayBuffer(); if (response.status >= 500) result.serverErrors.push({ url, status: response.status }); } };
    await Promise.all(Array.from({ length: 6 }, worker));
    result.server.bursts.push({ ms: Date.now() - started, ...(await memory()) });
  }
} finally {
  await browser.close();
  child.kill();
  await sleep(500);
  for (let i = 0; i < 10; i += 1) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); break; } catch { await sleep(200); } }
}

const first = result.samples[1] || result.samples[0];
const last = result.samples.at(-1);
const byKey = new Map();
for (const item of result.duplicates) byKey.set(item.key, (byKey.get(item.key) || 0) + 1);
console.log(`\nVistas abiertas: ${result.views} · pedidos /api: ${result.requests} · ${MINUTES} min reales × warp ${WARP}`);
console.log(`Heap del front (tras GC): min 0 ${result.samples[0]?.heapMB} MB · min 1 ${first?.heapMB} MB · final ${last?.heapMB} MB · nodos ${first?.nodes} → ${last?.nodes} · listeners ${first?.listeners} → ${last?.listeners}`);
console.log(`Pedidos GET duplicados en vuelo: ${result.duplicates.length}${byKey.size ? ` (${[...byKey].map(([k, n]) => `${k} ×${n}`).join(', ')})` : ''}`);
console.log(`Errores de consola: ${result.consoleErrors.length} · excepciones: ${result.pageErrors.length} · 5xx: ${result.serverErrors.length}`);
for (const text of [...new Set([...result.consoleErrors, ...result.pageErrors])].slice(0, 10)) console.log(`  · ${text}`);
console.log(`Server (tras GC): antes ${JSON.stringify(result.server.before)} · ráfagas ${JSON.stringify(result.server.bursts)}`);
fs.mkdirSync(path.join(here, '.out'), { recursive: true });
fs.writeFileSync(path.join(here, '.out', `soak-${LABEL}.json`), JSON.stringify(result, null, 2));
