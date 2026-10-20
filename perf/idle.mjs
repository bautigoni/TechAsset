// Costo "en reposo" de TechAsset: lo que la app y el server gastan sin que nadie
// toque nada (polling, ticks de background, re-renders por reloj).
//
//   node perf/idle.mjs --repo=<checkout> --label=<nombre> [--db=<snapshot>] [--seconds=60] [--runs=3]
//
// Mide, con el mismo preload de latencia que perf/suite.mjs (15 ms sincrónicos
// por query, como Supabase):
//   1. Arranque del server: ms hasta /api/health y queries hechas en el arranque.
//   2. Server solo (sin navegador): queries por minuto de los ticks de background.
//   3. App abierta y quieta en Inicio, Préstamos y Dispositivos (pestaña visible,
//      CPU 4× más lenta): pedidos /api por minuto, queries del server por minuto,
//      commits de React por minuto (hook de DevTools, funciona en producción) y
//      ms de script del hilo principal por minuto (CDP Performance.getMetrics).
// Escribe docs/redesign/bench/idle-<label>.json y muestra un resumen.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import puppeteer from 'puppeteer-core';
import { findBrowser, freePort, snapshotDatabase } from '../e2e/lib/env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const suiteRoot = path.resolve(here, '..');
const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const found = argv.find(arg => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const repo = path.resolve(option('repo', suiteRoot));
const label = option('label', 'idle');
const DB_SOURCE = path.resolve(option('db', path.join(suiteRoot, 'docs', 'redesign', 'bench', 'snapshot.db')));
const SECONDS = Number(option('seconds', 60));
const RUNS = Number(option('runs', 3));
const LATENCY = Number(option('latency', 15));
const CPU = Number(option('cpu', 4));
const SITE = 'NFPT';
const VIEWS = (option('views', 'dashboard,loans,devices')).split(',');
const OUT = path.join(suiteRoot, 'docs', 'redesign', 'bench', `idle-${label}.json`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const median = values => { const s = [...values].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const r1 = value => Math.round(value * 10) / 10;

async function prepareDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'techasset-idle-'));
  const dbCopy = path.join(tmpDir, 'idle.db');
  await snapshotDatabase(DB_SOURCE, dbCopy);
  const db = new Database(dbCopy);
  const now = new Date().toISOString();
  const admin = db.prepare("SELECT id FROM users WHERE rol_global='Superadmin' AND activo=1 ORDER BY id LIMIT 1").get();
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO user_sessions (token, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
    .run(token, admin.id, now, new Date(Date.now() + 86400000).toISOString(), now);
  db.prepare("INSERT INTO app_settings (key, value) VALUES ('mail.modoPrueba', 'true') ON CONFLICT(key) DO UPDATE SET value='true'").run();
  db.prepare('DELETE FROM push_subscriptions').run();
  db.close();
  return { tmpDir, dbCopy, token };
}

async function startServer({ tmpDir, dbCopy }) {
  const port = await freePort();
  const statsPort = await freePort();
  const env = {
    ...process.env, PORT: String(port), SERVER_HOST: '127.0.0.1', SQLITE_DB_PATH: dbCopy, DB_DRIVER: 'sqlite', DATABASE_URL: '',
    MODO_PRUEBA: 'true', SMTP_SERVER: '', SMTP_USER: '', SMTP_APP_PASSWORD: '', RESEND_API_KEY: '', RESEND_FROM: '', GOOGLE_SHEET_CSV_URL: '',
    GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_REDIRECT_URI: '', OPENAI_API_KEY: '', VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '',
    SUPERADMIN_EMAILS: '', LOCALTUNNEL_SUBDOMAIN: '', CACHE_CSV_PATH: path.join(tmpDir, 'cache_sheet.csv'),
    DEVICES_APP_CSV_PATH: path.join(tmpDir, 'devices_app.csv'), TOOLS_TEMP_DIR: path.join(tmpDir, 'tools'), UPLOADS_DIR: path.join(tmpDir, 'uploads'),
    APP_BASE_URL: `http://127.0.0.1:${port}`, TECHASSET_PUBLIC_URL: `http://127.0.0.1:${port}`, DEBUG_DEVICE_PERF: '',
    BENCH_STATS_PORT: String(statsPort), BENCH_LATENCY_MS: String(LATENCY)
  };
  const preload = pathToFileURL(path.join(here, 'suite-preload.mjs')).href;
  const started = performance.now();
  const child = spawn(process.execPath, ['--import', preload, 'server/index.js'], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const base = `http://127.0.0.1:${port}`;
  const stats = async op => (await fetch(`http://127.0.0.1:${statsPort}/${op}`)).json();
  for (let i = 0; i < 1200; i += 1) {
    if (child.exitCode !== null) throw new Error(`El server se cerró:\n${output}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) {
        const readyMs = performance.now() - started;
        const startupQueries = (await stats('stats')).queries;
        return { child, base, stats, readyMs, startupQueries, getLog: () => output };
      }
    } catch { /* todavía no */ }
    await sleep(50);
  }
  throw new Error('El server no arrancó');
}

async function stopServer(server) {
  if (!server?.child || server.child.exitCode !== null) return;
  const exited = new Promise(resolve => server.child.once('exit', resolve));
  server.child.kill();
  await Promise.race([exited, sleep(5000)]);
}

function instrument(site, release) {
  try {
    localStorage.setItem('techasset_active_site', site);
    sessionStorage.setItem('techasset_active_site', site);
    if (release) localStorage.setItem('techasset_last_seen_release', release);
  } catch { /* nada */ }
  const B = { commits: 0, api: 0 };
  window.__idle = B;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, isDisabled: false, renderers: new Map(),
    inject() { return 1; },
    onCommitFiberRoot() { B.commits += 1; },
    onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, setStrictMode() {}, checkDCE() {}
  };
  const originalFetch = window.fetch;
  window.fetch = function idleFetch(input) {
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (/\/api\//.test(url)) B.api += 1;
    } catch { /* nada */ }
    return originalFetch.apply(this, arguments);
  };
}

async function main() {
  const prep = await prepareDb();
  const result = { label, repo, commit: spawnSync('git', ['-C', repo, 'log', '-1', '--format=%h %s'], { encoding: 'utf8' }).stdout.trim(), seconds: SECONDS, runs: RUNS, latency: LATENCY, cpu: CPU, startup: [], serverIdle: [], views: {} };

  // 1 + 2: arranque y server solo (varias veces, base nueva cada vez no hace falta: el arranque es idempotente).
  for (let i = 0; i < RUNS; i += 1) {
    const server = await startServer(prep);
    result.startup.push({ readyMs: r1(server.readyMs), queries: server.startupQueries });
    await sleep(2000);
    await server.stats('reset');
    await sleep(SECONDS * 1000);
    result.serverIdle.push((await server.stats('stats')).queries * (60 / SECONDS));
    await stopServer(server);
  }
  console.log(`[idle ${label}] arranque`, result.startup, 'server solo q/min', result.serverIdle);

  // 3: app quieta.
  const server = await startServer(prep);
  const release = await fetch(`${server.base}/api/release-notes/latest`, { headers: { cookie: `techasset_session=${prep.token}`, 'X-Site-Code': SITE } })
    .then(r => r.json()).then(json => json?.note?.version || json?.version || '').catch(() => '');
  const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, args: ['--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  try {
    for (const view of VIEWS) {
      const samples = [];
      for (let i = 0; i < RUNS; i += 1) {
        const context = await browser.createBrowserContext();
        await context.setCookie({ name: 'techasset_session', value: prep.token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' });
        const page = await context.newPage();
        await page.setViewport({ width: 1366, height: 800 });
        await page.setBypassServiceWorker(true);
        await page.emulateCPUThrottling(CPU);
        await page.evaluateOnNewDocument(instrument, SITE, release);
        const cdp = await page.createCDPSession();
        await cdp.send('Performance.enable');
        await page.goto(`${server.base}/sede/${SITE.toLowerCase()}/${view}`, { waitUntil: 'networkidle0', timeout: 60000 });
        await sleep(8000);
        const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
        const before = { ...(await page.evaluate(() => ({ ...window.__idle }))), ...(await metric()) };
        await server.stats('reset');
        await sleep(SECONDS * 1000);
        const after = { ...(await page.evaluate(() => ({ ...window.__idle }))), ...(await metric()) };
        const queries = (await server.stats('stats')).queries;
        const k = 60 / SECONDS;
        samples.push({
          apiPerMin: r1((after.api - before.api) * k),
          commitsPerMin: r1((after.commits - before.commits) * k),
          scriptMsPerMin: r1((after.ScriptDuration - before.ScriptDuration) * 1000 * k),
          taskMsPerMin: r1((after.TaskDuration - before.TaskDuration) * 1000 * k),
          layoutsPerMin: r1((after.LayoutCount - before.LayoutCount) * k),
          serverQueriesPerMin: r1(queries * k)
        });
        await context.close();
      }
      const keys = Object.keys(samples[0]);
      result.views[view] = { samples, median: Object.fromEntries(keys.map(key => [key, r1(median(samples.map(s => s[key])))])) };
      console.log(`[idle ${label}] ${view}`, result.views[view].median);
    }
  } finally {
    await browser.close();
    await stopServer(server);
    for (let i = 0; i < 20; i += 1) { try { fs.rmSync(prep.tmpDir, { recursive: true, force: true }); break; } catch { await sleep(200); } }
  }
  result.summary = {
    startupReadyMs: r1(median(result.startup.map(s => s.readyMs))),
    startupQueries: median(result.startup.map(s => s.queries)),
    serverIdleQueriesPerMin: median(result.serverIdle)
  };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(`[idle ${label}] resumen`, result.summary, `→ ${OUT}`);
}

main().catch(error => { console.error(error); process.exit(1); });
