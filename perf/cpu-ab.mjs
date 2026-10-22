// A/B por TIEMPO DE CPU del hilo principal (reloj del hilo, `tdur` de la traza),
// para comparar dos checkouts cuando la máquina tiene carga de fondo: el tiempo
// de pared se infla cuando el renderer espera núcleo, el de CPU casi no.
//
//   node perf/cpu-ab.mjs --a=<checkout> --b=<checkout> --scenario=warm|cold|scroll|more|view:<vista> [--runs=5] [--cpu=4]
//
// Escenarios (misma red y CPU que perf/suite.mjs):
//   warm   recarga con caché y sesión recordada (inicio en caliente)
//   cold   contexto nuevo (inicio en frío)
//   scroll Dispositivos con la tabla entera, rueda 120 px por frame ida y vuelta
//   more   Historial: "Cargar más"
//   view:x abrir la vista x desde el menú con la app ya cargada en el Inicio
// Por corrida: CPU del hilo principal hasta el primer pintado con contenido
// (solo warm/cold) y total de la ventana, CPU de estilo, de layout y de script,
// layouts y recálculos de estilo, y la tarea más larga (CPU). Alterna A y B.
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
const A = path.resolve(option('a')); const B = path.resolve(option('b'));
const SCENARIO = option('scenario', 'warm');
const RUNS = Number(option('runs', 5));
const CPU = Number(option('cpu', 4));
const DB = path.resolve(option('db', path.join(here, '..', 'docs', 'redesign', 'bench', 'snapshot.db')));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const median = values => { const s = values.filter(v => typeof v === 'number').sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const r1 = v => (v == null ? '–' : Math.round(v * 10) / 10);
const categories = ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8.execute', 'loading', 'blink.user_timing'];

async function startServer(repo) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'techasset-cpuab-'));
  const dbCopy = path.join(tmpDir, 'cpu.db');
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
      SMTP_SERVER: '', SMTP_USER: '', SMTP_APP_PASSWORD: '', RESEND_API_KEY: '', GOOGLE_SHEET_CSV_URL: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '',
      UPLOADS_DIR: path.join(tmpDir, 'uploads'), TOOLS_TEMP_DIR: path.join(tmpDir, 'tools'), CACHE_CSV_PATH: path.join(tmpDir, 'c.csv'), DEVICES_APP_CSV_PATH: path.join(tmpDir, 'd.csv'),
      BENCH_STATS_PORT: String(statsPort), BENCH_LATENCY_MS: '15' },
    stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 600; i += 1) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* todavía no */ } await sleep(100); }
  return { base, token, tmpDir, child };
}

function analyze(traceFile) {
  const trace = JSON.parse(fs.readFileSync(traceFile, 'utf8'));
  const events = trace.traceEvents || trace;
  const mains = events.filter(e => e.name === 'thread_name' && e.args?.name === 'CrRendererMain');
  const countFor = thread => events.reduce((n, e) => n + (e.pid === thread.pid && e.tid === thread.tid && e.ph === 'X' ? 1 : 0), 0);
  const main = mains.map(thread => ({ thread, n: countFor(thread) })).sort((a, b) => b.n - a.n)[0]?.thread;
  const mainEvents = events.filter(e => main && e.pid === main.pid && e.tid === main.tid && e.ph === 'X');
  const fcp = events.find(e => e.name === 'firstContentfulPaint' && e.pid === main.pid);
  const tasks = mainEvents.filter(e => e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask');
  const cpu = list => list.reduce((sum, e) => sum + (e.tdur ?? e.dur ?? 0), 0) / 1000;
  const byName = name => mainEvents.filter(e => e.name === name);
  // Layout / estilo FORZADOS: los que ocurren dentro de JS (alguien leyó una
  // medida con el layout sucio). Se cuentan, no dependen de la carga.
  const js = mainEvents.filter(e => e.name === 'FunctionCall' || e.name === 'EvaluateScript' || e.name === 'v8.evaluateModule' || e.name === 'TimerFire' || e.name === 'FireAnimationFrame');
  const inside = e => js.some(f => f.ts <= e.ts && e.ts + (e.dur || 0) <= f.ts + (f.dur || 0));
  const forcedLayout = byName('Layout').filter(inside);
  const forcedStyle = byName('UpdateLayoutTree').filter(inside);
  return {
    forcedLayouts: forcedLayout.length,
    forcedLayoutCpu: cpu(forcedLayout),
    forcedStyles: forcedStyle.length,
    cpuToFcp: fcp ? cpu(tasks.filter(t => t.ts < fcp.ts)) : null,
    cpuTotal: cpu(tasks),
    styleCpu: cpu(byName('UpdateLayoutTree')),
    layoutCpu: cpu(byName('Layout')),
    scriptCpu: cpu(byName('FunctionCall')) + cpu(byName('v8.evaluateModule')) + cpu(byName('EvaluateScript')),
    paintCpu: cpu(byName('Paint')) + cpu(byName('PrePaint')) + cpu(byName('Layerize')),
    hitTestCpu: cpu(byName('HitTest')),
    layouts: byName('Layout').length,
    styleRecalcs: byName('UpdateLayoutTree').length,
    longestTaskCpu: Math.max(0, ...tasks.map(t => (t.tdur ?? t.dur ?? 0) / 1000))
  };
}

async function measure(server, browser) {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: 'techasset_session', value: server.token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' });
  const page = await context.newPage();
  await page.setViewport({ width: 1366, height: 800 });
  await page.setBypassServiceWorker(true);
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('techasset_active_site', 'NFPT'); sessionStorage.setItem('techasset_active_site', 'NFPT'); localStorage.setItem('techasset_last_seen_release', '9999'); } catch { /* nada */ } });
  await page.emulateCPUThrottling(CPU);
  await page.emulateNetworkConditions({ download: (10 * 1e6) / 8, upload: (5 * 1e6) / 8, latency: 40 });
  const traceFile = path.join(server.tmpDir, `t-${Date.now()}.json`);
  const dash = `${server.base}/sede/nfpt/dashboard`;
  let extra = {};
  try {
    if (SCENARIO === 'cold' || SCENARIO === 'warm') {
      if (SCENARIO === 'warm') { await page.goto(dash, { waitUntil: 'networkidle0', timeout: 90000 }); await sleep(2500); }
      await page.tracing.start({ path: traceFile, categories });
      await page.goto(dash, { waitUntil: 'networkidle0', timeout: 90000 });
      await sleep(1500);
      await page.tracing.stop();
    } else if (SCENARIO === 'scroll') {
      await page.goto(`${server.base}/sede/nfpt/devices`, { waitUntil: 'networkidle0', timeout: 90000 });
      await sleep(1500);
      for (let i = 0; i < 20; i += 1) {
        const clicked = await page.evaluate(() => { const b = [...document.querySelectorAll('main button')].find(x => /^(ver|mostrar|cargar) (mas|más|todos|todo)/i.test(x.textContent.trim())); if (!b) return false; b.click(); return true; });
        if (!clicked) break;
        await sleep(700);
      }
      await page.mouse.move(700, 500);
      await sleep(500);
      await page.tracing.start({ path: traceFile, categories });
      await page.evaluate(() => new Promise(resolve => {
        const scroller = document.querySelector('.shell-scroll');
        const range = scroller.scrollHeight - scroller.clientHeight;
        let y = 0; let dir = 1;
        const step = () => {
          y += dir * 120;
          if (y >= range) dir = -1;
          scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: dir * 120, bubbles: true }));
          scroller.scrollTop = Math.max(0, Math.min(y, range));
          if (dir < 0 && y <= 0) { setTimeout(resolve, 400); return; }
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }));
      await page.tracing.stop();
    } else if (SCENARIO === 'more') {
      await page.goto(`${server.base}/sede/nfpt/history`, { waitUntil: 'networkidle0', timeout: 90000 });
      await sleep(1500);
      await page.tracing.start({ path: traceFile, categories });
      await page.evaluate(() => [...document.querySelectorAll('main button')].find(b => /^cargar más/i.test(b.textContent.trim()))?.click());
      await sleep(2000);
      await page.tracing.stop();
    } else if (SCENARIO.startsWith('view:')) {
      const view = SCENARIO.slice(5);
      await page.goto(dash, { waitUntil: 'networkidle0', timeout: 90000 });
      await sleep(4000);
      // Pedidos /api que salen al abrir (cuántos, cuáles) y cuándo termina el último.
      const api = [];
      const onRequest = request => { if (/\/api\//.test(request.url())) api.push({ url: request.url().replace(server.base, '').split('?')[0], start: Date.now(), end: null, request }); };
      const onDone = request => { const item = api.find(entry => entry.request === request); if (item) item.end = Date.now(); };
      page.on('request', onRequest);
      page.on('requestfinished', onDone);
      page.on('requestfailed', onDone);
      await page.tracing.start({ path: traceFile, categories });
      const clickedAt = Date.now();
      await page.evaluate(key => document.querySelector(`aside [data-view="${key}"]`)?.click(), view);
      await page.waitForNetworkIdle({ idleTime: 600, timeout: 30000 }).catch(() => undefined);
      await sleep(600);
      await page.tracing.stop();
      page.off('request', onRequest);
      page.off('requestfinished', onDone);
      page.off('requestfailed', onDone);
      const ends = api.map(entry => entry.end).filter(Boolean);
      extra = { apiRequests: api.length, apiLastEndMs: ends.length ? Math.max(...ends) - clickedAt : 0, apiList: api.map(entry => entry.url).join(' ') };
    }
    return { ...analyze(traceFile), ...extra };
  } finally {
    await context.close();
    fs.rmSync(traceFile, { force: true });
  }
}

const servers = { A: await startServer(A), B: await startServer(B) };
const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true });
const results = { A: [], B: [] };
try {
  for (let run = 0; run < RUNS; run += 1) {
    for (const side of run % 2 === 0 ? ['A', 'B'] : ['B', 'A']) {
      const sample = await measure(servers[side], browser);
      results[side].push(sample);
      console.log(`${side} ${run}: ${JSON.stringify(Object.fromEntries(Object.entries(sample).map(([k, v]) => [k, typeof v === "number" ? r1(v) : v])))}`);
    }
  }
} finally {
  await browser.close();
  for (const server of Object.values(servers)) { server.child.kill(); }
  await sleep(500);
  for (const server of Object.values(servers)) { for (let i = 0; i < 10; i += 1) { try { fs.rmSync(server.tmpDir, { recursive: true, force: true }); break; } catch { await sleep(200); } } }
}
const keys = Object.keys(results.A[0] || {});
console.log(`\nEscenario ${SCENARIO} · CPU ${CPU}× · n=${RUNS} por lado (medianas, ms de CPU del hilo principal)\n\n| métrica | A | B | B vs A |\n| --- | ---: | ---: | ---: |`);
for (const key of keys) {
  const a = median(results.A.map(s => s[key])); const b = median(results.B.map(s => s[key]));
  console.log(`| ${key} | ${r1(a)} | ${r1(b)} | ${a ? `${b >= a ? '+' : ''}${Math.round(((b - a) / a) * 1000) / 10} %` : '–'} |`);
}
