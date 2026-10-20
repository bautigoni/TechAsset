// Barrido de los 5 ejes por pantalla (pasada 3): lo que cuesta abrir cada
// pantalla y una interacción típica, con el mismo banco que perf/suite.mjs.
//
//   node perf/sweep.mjs --repo=<checkout> [--views=agenda,tickets,...] [--runs=3] [--modules=knowledge,reminders,canvas]
//
// Por pantalla (abierta desde el menú con la app ya cargada en el Inicio, CPU 4×,
// red 40 ms / 10 / 5 Mbps, 15 ms por query) y por corrida:
//   - abrir: ms hasta la pantalla quieta (sin pedidos en vuelo y sin cambios del
//     DOM por 600 ms), commits de React, pedidos /api (y cuáles), consultas a la
//     base que hizo el server, JS y CSS nuevos bajados (archivos y KB
//     transferidos: 0 si ya estaban precargados), imágenes y fuentes pedidas;
//   - interacción: tipear 3 letras en el primer campo de texto de la pantalla
//     (buscador o filtro): commits, pedidos y ms hasta quieto; si no hay campo,
//     se informa "sin campo";
//   - reposo: 20 s quieta en la pantalla: pedidos y commits (escalados a 1 min).
// --modules prende módulos en la copia de la base (arrancan apagados).
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
const RUNS = Number(option('runs', 3));
const VIEWS = option('views', 'agenda,tickets,classrooms,inventory,settings,knowledge,reminders,canvas,schedules,tools,quickaccess,pettycash,suggestions').split(',').filter(Boolean);
const MODULES = option('modules', 'knowledge,reminders,canvas').split(',').filter(Boolean);
const DB = path.resolve(option('db', path.join(here, '..', 'docs', 'redesign', 'bench', 'snapshot.db')));
const LABEL = option('label', 'sweep');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const median = values => { const s = values.filter(v => typeof v === 'number').sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const r1 = v => (v == null ? null : Math.round(v * 10) / 10);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'techasset-sweep-'));
const dbCopy = path.join(tmpDir, 'sweep.db');
await snapshotDatabase(DB, dbCopy);
const db = new Database(dbCopy);
const admin = db.prepare("SELECT id FROM users WHERE rol_global='Superadmin' AND activo=1 ORDER BY id LIMIT 1").get();
const token = crypto.randomBytes(32).toString('hex');
const now = new Date().toISOString();
db.prepare('INSERT INTO user_sessions (token, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)').run(token, admin.id, now, new Date(Date.now() + 86400000).toISOString(), now);
db.prepare("INSERT INTO app_settings (key, value) VALUES ('mail.modoPrueba', 'true') ON CONFLICT(key) DO UPDATE SET value='true'").run();
db.prepare('DELETE FROM push_subscriptions').run();
for (const key of ['modules.enabled', 'modules.order']) {
  const row = db.prepare("SELECT value_json FROM site_settings WHERE site_code='NFPT' AND key=?").get(key);
  if (!row) continue;
  const list = JSON.parse(row.value_json);
  for (const module of MODULES) if (!list.includes(module)) list.push(module);
  db.prepare("UPDATE site_settings SET value_json=? WHERE site_code='NFPT' AND key=?").run(JSON.stringify(list), key);
}
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
const stats = async op => (await fetch(`http://127.0.0.1:${statsPort}/${op}`)).json();
for (let i = 0; i < 600; i += 1) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* todavía no */ } await sleep(100); }

function instrument() {
  try { localStorage.setItem('techasset_active_site', 'NFPT'); sessionStorage.setItem('techasset_active_site', 'NFPT'); localStorage.setItem('techasset_last_seen_release', '9999'); } catch { /* nada */ }
  const S = { commits: 0, api: [], inflight: 0, lastMut: 0 };
  window.__sw = S;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, isDisabled: false, renderers: new Map(), inject() { return 1; }, onCommitFiberRoot() { S.commits += 1; }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, setStrictMode() {}, checkDCE() {} };
  const originalFetch = window.fetch;
  window.fetch = function swFetch(input) {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    const isApi = /\/api\//.test(url);
    if (isApi) { S.api.push({ url: url.replace(location.origin, ''), at: performance.now() }); S.inflight += 1; }
    const promise = originalFetch.apply(this, arguments);
    if (isApi) promise.finally(() => { S.inflight -= 1; S.lastMut = performance.now(); }).catch(() => undefined);
    return promise;
  };
  new MutationObserver(() => { S.lastMut = performance.now(); }).observe(document, { childList: true, subtree: true, characterData: true, attributes: true });
  S.quiet = (since, quietMs = 600, timeout = 15000) => new Promise(resolve => {
    const tick = () => {
      const t = performance.now();
      if (S.inflight === 0 && t - Math.max(S.lastMut, since) >= quietMs) { resolve(Math.max(S.lastMut, since) - since); return; }
      if (t - since > timeout) { resolve(null); return; }
      setTimeout(tick, 50);
    };
    tick();
  });
}

const results = {};
const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true });
try {
  for (let run = 0; run < RUNS; run += 1) {
    const context = await browser.createBrowserContext();
    await context.setCookie({ name: 'techasset_session', value: token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' });
    const page = await context.newPage();
    await page.setViewport({ width: 1366, height: 800 });
    await page.setBypassServiceWorker(true);
    await page.evaluateOnNewDocument(instrument);
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    const resources = [];
    cdp.on('Network.responseReceived', event => resources.push({ id: event.requestId, url: event.response.url.replace(base, ''), type: event.type, at: Date.now() }));
    const sizes = new Map();
    cdp.on('Network.loadingFinished', event => sizes.set(event.requestId, event.encodedDataLength));
    await page.emulateCPUThrottling(4);
    await page.emulateNetworkConditions({ download: (10 * 1e6) / 8, upload: (5 * 1e6) / 8, latency: 40 });
    await page.goto(`${base}/sede/nfpt/dashboard`, { waitUntil: 'networkidle0', timeout: 60000 });
    await sleep(4000);
    for (const view of VIEWS) {
      const exists = await page.evaluate(key => Boolean(document.querySelector(`aside [data-view="${key}"]`)), view);
      if (!exists) { (results[view] ||= { missing: true }); continue; }
      // Volver al Inicio entre pantallas (misma partida para todas).
      await page.evaluate(() => document.querySelector('aside [data-view="dashboard"]')?.click());
      await sleep(1500);
      const resBefore = resources.length;
      await stats('reset');
      const open = await page.evaluate(async key => {
        const S = window.__sw;
        const commits = S.commits; const api = S.api.length;
        const since = performance.now();
        document.querySelector(`aside [data-view="${key}"]`).click();
        const ms = await S.quiet(since);
        return { ms, commits: S.commits - commits, api: S.api.slice(api).map(r => r.url) };
      }, view);
      const openQueries = (await stats('stats')).queries;
      await sleep(300);
      const fresh = resources.slice(resBefore);
      const bytes = type => fresh.filter(r => r.type === type).reduce((sum, r) => sum + (sizes.get(r.id) || 0), 0);
      const files = type => fresh.filter(r => r.type === type).length;
      // Interacción: 3 letras en el primer campo de texto de <main>.
      await stats('reset');
      const interaction = await page.evaluate(async () => {
        const S = window.__sw;
        const field = [...document.querySelectorAll('main input, main textarea')].find(el => !/^(hidden|checkbox|radio|button|submit|file|range)$/i.test(el.type || '') && !el.disabled && !el.readOnly && el.getBoundingClientRect().width > 20);
        if (!field) return null;
        field.focus();
        return { label: field.getAttribute('aria-label') || field.placeholder || field.name || field.id || '' };
      });
      let interact = null;
      if (interaction) {
        const commits0 = await page.evaluate(() => [window.__sw.commits, window.__sw.api.length]);
        const since = await page.evaluate(() => performance.now());
        await page.keyboard.type('mar', { delay: 90 });
        const ms = await page.evaluate(s => window.__sw.quiet(s, 600), since);
        const after = await page.evaluate(() => [window.__sw.commits, window.__sw.api.length, window.__sw.api.slice(-5).map(r => r.url)]);
        interact = { field: interaction.label.slice(0, 40), ms: ms == null ? null : r1(ms), commits: after[0] - commits0[0], api: after[1] - commits0[1], apiUrls: after[2].slice(-(after[1] - commits0[1])), queries: (await stats('stats')).queries };
        await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace');
        await sleep(800);
      }
      // Reposo: 20 s.
      const idle0 = await page.evaluate(() => [window.__sw.commits, window.__sw.api.length]);
      await stats('reset');
      await sleep(20000);
      const idle1 = await page.evaluate(() => [window.__sw.commits, window.__sw.api.length]);
      const idleQueries = (await stats('stats')).queries;
      const entry = results[view] ||= { samples: [] };
      entry.samples.push({
        openMs: open.ms == null ? null : r1(open.ms), openCommits: open.commits, openApi: open.api, openQueries,
        jsFiles: files('Script'), jsKB: r1(bytes('Script') / 1024), cssFiles: files('Stylesheet'), cssKB: r1(bytes('Stylesheet') / 1024),
        images: fresh.filter(r => r.type === 'Image').map(r => `${r.url.split('?')[0].split('/').pop()} ${r1((sizes.get(r.id) || 0) / 1024)} KB`),
        fonts: fresh.filter(r => r.type === 'Font').map(r => `${r.url.split('/').pop()} ${r1((sizes.get(r.id) || 0) / 1024)} KB`),
        interact, idleApiPerMin: (idle1[1] - idle0[1]) * 3, idleCommitsPerMin: (idle1[0] - idle0[0]) * 3, idleQueriesPerMin: idleQueries * 3
      });
      console.log(`[sweep] ${run} ${view}: abrir ${r1(open.ms)} ms · ${open.commits} commits · ${open.api.length} pedidos · ${openQueries} q · JS ${files('Script')} (${r1(bytes('Script') / 1024)} KB) · tipeo ${interact ? `${interact.ms} ms, ${interact.commits} commits, ${interact.api} pedidos` : 'sin campo'} · reposo ${(idle1[1] - idle0[1]) * 3} ped/min, ${(idle1[0] - idle0[0]) * 3} commits/min`);
    }
    await context.close();
  }
} finally {
  await browser.close();
  child.kill();
  await sleep(500);
  for (let i = 0; i < 10; i += 1) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); break; } catch { await sleep(200); } }
}

const lines = ['| Pantalla | Abrir (ms, med) | Commits al abrir | Pedidos al abrir | Consultas | JS nuevo 1ª vez (archivos / KB) | Tipeo 3 letras: ms · commits · pedidos | Reposo: pedidos/min · commits/min · consultas/min |', '| --- | ---: | ---: | --- | ---: | ---: | --- | --- |'];
for (const [view, entry] of Object.entries(results)) {
  if (entry.missing) { lines.push(`| ${view} | (no está en el menú) | | | | | | |`); continue; }
  const s = entry.samples;
  const m = key => median(s.map(x => x[key]));
  const i = s.map(x => x.interact).filter(Boolean);
  const urls = [...new Set(s.flatMap(x => x.openApi.map(u => u.split('?')[0])))].join(', ');
  lines.push(`| ${view} | ${r1(m('openMs'))} | ${m('openCommits')} | ${median(s.map(x => x.openApi.length))}: ${urls || '—'} | ${m('openQueries')} | ${s[0].jsFiles} / ${s[0].jsKB} | ${i.length ? `${r1(median(i.map(x => x.ms)))} · ${median(i.map(x => x.commits))} · ${median(i.map(x => x.api))} (${i[0].field})` : 'sin campo'} | ${m('idleApiPerMin')} · ${m('idleCommitsPerMin')} · ${m('idleQueriesPerMin')} |`);
}
console.log(`\n${lines.join('\n')}`);
const imgs = [...new Set(Object.values(results).flatMap(e => (e.samples || []).flatMap(x => [...x.images, ...x.fonts])))];
console.log(`\nImágenes y fuentes pedidas al abrir: ${imgs.join(' · ') || 'ninguna'}`);
fs.mkdirSync(path.join(here, '.out'), { recursive: true });
fs.writeFileSync(path.join(here, '.out', `sweep-${LABEL}.json`), JSON.stringify(results, null, 2));
