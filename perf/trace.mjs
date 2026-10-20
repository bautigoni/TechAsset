// Traza del hilo principal de UNA interacción, para encontrar dónde se va el
// tiempo (estilos, layout, pintado, script y qué funciones).
//
//   node perf/trace.mjs --repo=<checkout> --view=devices --action=scroll [--expand] [--db=<snapshot>] [--cpu=4]
//   node perf/trace.mjs --repo=<checkout> --view=dashboard --action=load
//
// action=scroll: abre la vista, (con --expand toca "Ver todos"/"Ver más" hasta
//   el final), y traza 120 px por frame hacia abajo y hacia arriba.
// action=load:   traza la carga en frío de la vista (contexto nuevo).
// Muestra los tipos de evento con más tiempo propio y las funciones JS con más
// muestras del profiler. Base: copia del snapshot (nunca la real).
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
const root = path.resolve(here, '..');
const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const found = argv.find(arg => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const repo = path.resolve(option('repo', root));
const VIEW = option('view', 'devices');
const ACTION = option('action', 'scroll');
const EXPAND = argv.includes('--expand');
const CPU = Number(option('cpu', 4));
const DB = path.resolve(option('db', path.join(root, 'docs', 'redesign', 'bench', 'snapshot.db')));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'techasset-trace-'));
const dbCopy = path.join(tmpDir, 'trace.db');
await snapshotDatabase(DB, dbCopy);
const db = new Database(dbCopy);
const admin = db.prepare("SELECT id FROM users WHERE rol_global='Superadmin' AND activo=1 ORDER BY id LIMIT 1").get();
const token = crypto.randomBytes(32).toString('hex');
const now = new Date().toISOString();
db.prepare('INSERT INTO user_sessions (token, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)').run(token, admin.id, now, new Date(Date.now() + 86400000).toISOString(), now);
db.prepare("INSERT INTO app_settings (key, value) VALUES ('mail.modoPrueba', 'true') ON CONFLICT(key) DO UPDATE SET value='true'").run();
db.close();

const port = await freePort();
const statsPort = await freePort();
const child = spawn(process.execPath, ['--import', pathToFileURL(path.join(here, 'suite-preload.mjs')).href, 'server/index.js'], {
  cwd: repo,
  env: { ...process.env, PORT: String(port), SERVER_HOST: '127.0.0.1', SQLITE_DB_PATH: dbCopy, DB_DRIVER: 'sqlite', DATABASE_URL: '', MODO_PRUEBA: 'true',
    SMTP_SERVER: '', SMTP_USER: '', SMTP_APP_PASSWORD: '', RESEND_API_KEY: '', GOOGLE_SHEET_CSV_URL: '', OPENAI_API_KEY: '', VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '',
    UPLOADS_DIR: path.join(tmpDir, 'uploads'), TOOLS_TEMP_DIR: path.join(tmpDir, 'tools'), CACHE_CSV_PATH: path.join(tmpDir, 'c.csv'), DEVICES_APP_CSV_PATH: path.join(tmpDir, 'd.csv'),
    BENCH_STATS_PORT: String(statsPort), BENCH_LATENCY_MS: '15' },
  stdio: 'ignore'
});
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 400; i += 1) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* todavía no */ } await sleep(100); }

const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true });
try {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: 'techasset_session', value: token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' });
  const page = await context.newPage();
  await page.setViewport({ width: 1366, height: 800 });
  await page.setBypassServiceWorker(true);
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem('techasset_active_site', 'NFPT'); sessionStorage.setItem('techasset_active_site', 'NFPT'); localStorage.setItem('techasset_last_seen_release', '9999'); } catch { /* nada */ }
  });
  await page.emulateCPUThrottling(CPU);
  const url = `${base}/sede/nfpt/${VIEW}`;
  const traceFile = path.join(tmpDir, 'trace.json');
  if (ACTION === 'mutations') {
    // Qué sigue cambiando el DOM después de cargar (agrupado por elemento y por 250 ms).
    await page.evaluateOnNewDocument(() => {
      window.__muts = [];
      new MutationObserver(list => {
        const t = Math.round(performance.now());
        for (const m of list) {
          const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
          const desc = el ? `${el.tagName.toLowerCase()}.${String(el.className || '').split(' ').slice(0, 2).join('.')}` : '?';
          window.__muts.push([t, m.type === 'attributes' ? `${desc}[${m.attributeName}]` : `${desc} ${m.type}`]);
        }
      }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(6000);
    const muts = await page.evaluate(() => window.__muts);
    const buckets = new Map();
    for (const [t, desc] of muts) {
      const key = `${String(Math.floor(t / 250) * 250).padStart(5)} ms  ${desc}`;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    for (const [key, n] of [...buckets.entries()].sort()) console.log(`${key} ×${n}`);
  } else if (ACTION === 'load') {
    await page.tracing.start({ path: traceFile, categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8.execute', 'disabled-by-default-v8.cpu_profiler'] });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
    await sleep(1500);
    await page.tracing.stop();
  } else {
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
    await sleep(1500);
    if (EXPAND) {
      for (let i = 0; i < 20; i += 1) {
        const clicked = await page.evaluate(() => {
          const button = [...document.querySelectorAll('main button')].find(b => /^(ver|mostrar|cargar) (mas|más|todos|todo)/i.test(b.textContent.trim()));
          if (!button) return false;
          button.click();
          return true;
        });
        if (!clicked) break;
        await sleep(600);
      }
    }
    // Con --hover el puntero queda sobre la lista (como al scrollear con la rueda).
    if (argv.includes('--hover')) await page.mouse.move(700, 500);
    await page.tracing.start({ path: traceFile, categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8.execute', 'disabled-by-default-v8.cpu_profiler'] });
    const frames = await page.evaluate(() => new Promise(resolve => {
      const candidates = [document.scrollingElement, ...document.querySelectorAll('body *')].filter(el => el && el.scrollHeight > el.clientHeight + 80 && (el === document.scrollingElement || /(auto|scroll)/.test(getComputedStyle(el).overflowY)));
      candidates.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
      const scroller = candidates[0];
      const range = scroller.scrollHeight - scroller.clientHeight;
      let y = 0; let dir = 1; let last = performance.now(); const times = [];
      const step = () => {
        const t = performance.now(); times.push(t - last); last = t;
        y += dir * 120;
        if (y >= range) dir = -1;
        scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: dir * 120, bubbles: true }));
        scroller.scrollTop = Math.max(0, Math.min(y, range));
        if (dir < 0 && y <= 0) { times.sort((a, b) => a - b); resolve({ n: times.length, p50: times[Math.floor(times.length / 2)], p95: times[Math.floor(times.length * 0.95)] }); return; }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }));
    await page.tracing.stop();
    console.log('frames', frames);
  }
  if (ACTION !== 'mutations') {
  const trace = JSON.parse(fs.readFileSync(traceFile, 'utf8'));
  const events = trace.traceEvents || trace;
  const main = events.find(e => e.name === 'thread_name' && e.args?.name === 'CrRendererMain');
  const mainEvents = events.filter(e => main && e.pid === main.pid && e.tid === main.tid && e.ph === 'X');
  // Tiempo propio por tipo de evento (descontando hijos).
  mainEvents.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const self = new Map();
  const stack = [];
  for (const event of mainEvents) {
    while (stack.length && stack.at(-1).ts + stack.at(-1).dur <= event.ts) stack.pop();
    if (stack.length) stack.at(-1).childDur = (stack.at(-1).childDur || 0) + (event.dur || 0);
    stack.push(event);
  }
  for (const event of mainEvents) self.set(event.name, (self.get(event.name) || 0) + Math.max(0, (event.dur || 0) - (event.childDur || 0)));
  console.log('\nTiempo propio por evento (ms, hilo principal):');
  for (const [name, us] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`  ${(us / 1000).toFixed(1).padStart(8)}  ${name}`);
  // Funciones con más muestras del profiler.
  const nodes = new Map();
  const counts = new Map();
  for (const event of events) {
    if (event.name !== 'ProfileChunk') continue;
    const profile = event.args?.data?.cpuProfile;
    for (const node of profile?.nodes || []) nodes.set(node.id, node.callFrame);
    for (const sample of profile?.samples || []) counts.set(sample, (counts.get(sample) || 0) + 1);
  }
  const byFn = new Map();
  for (const [id, count] of counts) {
    const frame = nodes.get(id);
    if (!frame || /^\((idle|program|garbage collector|root)\)$/.test(frame.functionName)) continue;
    const key = `${frame.functionName || '(anónima)'} ${String(frame.url || '').split('/').pop()}:${frame.lineNumber}:${frame.columnNumber}`;
    byFn.set(key, (byFn.get(key) || 0) + count);
  }
  console.log('\nFunciones con más muestras:');
  for (const [name, count] of [...byFn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${String(count).padStart(6)}  ${name}`);
  }
} finally {
  await browser.close();
  child.kill();
  await sleep(500);
  for (let i = 0; i < 10; i += 1) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); break; } catch { await sleep(200); } }
}
