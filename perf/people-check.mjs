// Validación de la búsqueda rápida de personas (DIRECTIVA §6), de punta a punta.
//
//   node perf/people-check.mjs --repo=<checkout> [--runs=3] [--cpu=4] [--db=<snapshot>]
//
// Sobre una copia del snapshot (15 ms por query, red 40 ms / 10 / 5 Mbps, CPU 4×):
//   1. API: /api/loans/people (tamaño, ms, 304 con ETag) y /api/loans/suggest
//      para cada término: cada resultado contiene todas las palabras tipeadas
//      (sin mayúsculas ni tildes) y no hay repetidos.
//   2. Permisos: sin sesión → 401; un usuario de una sola sede pidiendo otra → 403.
//   3. Navegador, en Préstamos, para muchos registros (NFPT, ~370 personas) y
//      pocos (NFND, ~150): se tipea cada término letra por letra (110 ms entre
//      teclas, como una persona) y se mide desde la última tecla hasta el frame
//      con las sugerencias; cuántos pedidos /api salieron mientras se tipeaba;
//      tareas largas y la peor demora de input (Event Timing) durante el tipeo; y
//      si la lista mostrada es exactamente la que da la regla (misma función
//      que el front y el server, copiada abajo) sobre el directorio.
//   4. Respuestas viejas: con el directorio caído (pedido abortado), la app usa
//      /api/loans/suggest; la respuesta del primer término se demora 900 ms y la
//      del segundo no: lo que queda en pantalla tiene que ser lo del segundo.
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
const CPU = Number(option('cpu', 4));
const DB = path.resolve(option('db', path.join(here, '..', 'docs', 'redesign', 'bench', 'snapshot.db')));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const median = values => { const s = values.filter(v => typeof v === 'number').sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const p95 = values => { const s = values.filter(v => typeof v === 'number').sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] : null; };
const r1 = v => (v == null ? '×' : Math.round(v * 10) / 10);

// Misma regla que src/services/peopleDirectory.ts (searchPeople) y el server.
const normalizePerson = value => String(value || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
function searchPeople(people, query, limit = 8) {
  const q = normalizePerson(query);
  if (!q) return people.slice(0, limit);
  const tokens = q.split(' ');
  const ranks = [[], [], []];
  for (const person of people) {
    if (!tokens.every(token => person.key.includes(token))) continue;
    const rank = person.key.startsWith(q) ? 0 : person.key.split(' ').some(word => word.startsWith(tokens[0])) ? 1 : 2;
    ranks[rank].push(person);
    if (rank === 0 && ranks[0].length >= limit) break;
  }
  return ranks.flat().slice(0, limit);
}

/** Vacía el campo como una persona: foco, Ctrl+A, Borrar (el triple clic no siempre selecciona todo). */
async function clearField(page, input) {
  await input.focus();
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  const left = await page.evaluate(el => el.value, input);
  if (left) throw new Error(`No se pudo vaciar el campo (quedó "${left}")`);
}

// ── Base y server ────────────────────────────────────────────────────────────
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'techasset-people-'));
const dbCopy = path.join(tmpDir, 'people.db');
await snapshotDatabase(DB, dbCopy);
const db = new Database(dbCopy);
const now = new Date().toISOString();
const later = new Date(Date.now() + 86400000).toISOString();
const newToken = () => crypto.randomBytes(32).toString('hex');
const admin = db.prepare("SELECT id FROM users WHERE rol_global='Superadmin' AND activo=1 AND id IN (SELECT user_id FROM user_sites WHERE site_code='NFND') ORDER BY id LIMIT 1").get()
  || db.prepare("SELECT id FROM users WHERE rol_global='Superadmin' AND activo=1 ORDER BY id LIMIT 1").get();
const adminToken = newToken();
db.prepare('INSERT INTO user_sessions (token, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)').run(adminToken, admin.id, now, later, now);
// Usuario de una sola sede (NFPT, Asistente): para el chequeo de permisos.
db.prepare(`INSERT INTO users (email, nombre, rol_global, activo, last_login_at, created_at, updated_at) VALUES ('people-check@e2e.local', 'People Check', 'Asistente', 1, ?, ?, ?)
  ON CONFLICT(email) DO UPDATE SET activo=1`).run(now, now, now);
const single = db.prepare("SELECT id FROM users WHERE email='people-check@e2e.local'").get();
db.prepare("DELETE FROM user_sites WHERE user_id=?").run(single.id);
db.prepare(`INSERT INTO user_sites (user_id, site_code, site_role, turno, is_default, activo, created_at, updated_at) VALUES (?, 'NFPT', 'Asistente TIC', 'Sin turno', 1, 1, ?, ?)`).run(single.id, now, now);
const singleToken = newToken();
db.prepare('INSERT INTO user_sessions (token, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)').run(singleToken, single.id, now, later, now);
db.prepare("INSERT INTO app_settings (key, value) VALUES ('mail.modoPrueba', 'true') ON CONFLICT(key) DO UPDATE SET value='true'").run();
const peopleBySite = site => db.prepare("SELECT persona FROM loan_events WHERE site_code=? AND tipo='prestamo' AND TRIM(persona)<>''").all(site).map(row => row.persona);
const rawPeople = { NFPT: peopleBySite('NFPT'), NFND: peopleBySite('NFND') };
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
const api = (url, { token = adminToken, site = 'NFPT', headers = {} } = {}) => fetch(`${base}${url}`, { headers: { ...(token ? { cookie: `techasset_session=${token}` } : {}), 'X-Site-Code': site, ...headers } });

/** Términos de cada sede, sacados de sus datos (como perf/suite.mjs) + los casos de §6. */
function termsFor(directory) {
  const keys = directory.map(person => person.key);
  const words = keys.flatMap(key => key.split(' '));
  const firstCounts = new Map();
  for (const key of keys) { const first = key.split(' ')[0]; firstCounts.set(first, (firstCounts.get(first) || 0) + 1); }
  const repeated = [...firstCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'maria';
  const withSurname = keys.find(key => key.split(' ').length >= 2 && key.split(' ')[0] === repeated) || keys[0];
  const [first, surname] = withSurname.split(' ');
  const partialWord = words.find(word => word.length >= 7) || withSurname.replace(/ /g, '');
  const accentWord = rawWordsWithAccent.find(word => keys.some(key => key.includes(normalizePerson(word)))) || 'ramírez';
  let none = 'zqx';
  for (const candidate of ['zqx', 'qzx', 'xqz', 'wqz']) if (!keys.some(key => key.includes(candidate))) { none = candidate; break; }
  return [
    { kind: '3 letras (nombre repetido)', term: repeated.slice(0, 3) },
    { kind: 'nombre repetido completo', term: repeated },
    { kind: 'parcial (mitad de palabra)', term: partialWord.slice(2, 6) },
    { kind: 'apellido solo', term: surname ? surname.slice(0, 5) : first.slice(0, 4) },
    { kind: 'nombre + apellido', term: `${first} ${surname ? surname.slice(0, 3) : ''}`.trim() },
    { kind: 'apellido + nombre', term: `${surname ? surname.slice(0, 4) : first.slice(0, 4)} ${first.slice(0, 3)}` },
    { kind: 'MAYÚSCULAS', term: repeated.slice(0, 4).toUpperCase() },
    { kind: 'con tilde', term: accentWord.slice(0, Math.max(4, accentWord.search(/[áéíóúñ]/) + 1)) },
    { kind: 'sin tilde', term: normalizePerson(accentWord).slice(0, Math.max(4, accentWord.search(/[áéíóúñ]/) + 1)) },
    { kind: 'sin resultados', term: none }
  ];
}
const rawWordsWithAccent = [...new Set([...rawPeople.NFPT, ...rawPeople.NFND].flatMap(name => String(name).toLowerCase().split(/\s+/)).filter(word => /[áéíóú]/.test(word) && word.length >= 5))];

const report = { api: {}, permissions: {}, browser: {}, stale: null };
try {
  // ── 1. API ─────────────────────────────────────────────────────────────────
  const directories = {};
  for (const site of ['NFPT', 'NFND']) {
    const times = [];
    let body = null; let etag = ''; let bytes = 0;
    for (let i = 0; i < 15; i += 1) {
      const t0 = performance.now();
      const response = await api('/api/loans/people', { site });
      const text = await response.text();
      times.push(performance.now() - t0);
      body = JSON.parse(text); etag = response.headers.get('etag') || ''; bytes = text.length;
    }
    const conditional = etag ? (await api('/api/loans/people', { site, headers: { 'If-None-Match': etag } })).status : null;
    directories[site] = body.people;
    const terms = termsFor(body.people);
    const suggest = [];
    for (const { kind, term } of terms) {
      const t0 = performance.now();
      const response = await api(`/api/loans/suggest?q=${encodeURIComponent(term)}`, { site });
      const data = await response.json();
      const ms = performance.now() - t0;
      const items = data.items || data.suggestions || data.people || [];
      const names = items.map(item => item.persona || item.name || item.nombre || '');
      const tokens = normalizePerson(term).split(' ');
      const allMatch = names.every(name => tokens.every(token => normalizePerson(name).includes(token)));
      const keys = names.map(normalizePerson);
      suggest.push({ kind, term, count: names.length, ms: r1(ms), allMatch, duplicates: keys.length - new Set(keys).size, sameAsDirectoryRule: JSON.stringify(searchPeople(body.people, term).map(p => normalizePerson(p.persona || p.name))) === JSON.stringify(keys) });
    }
    report.api[site] = { people: body.people.length, kb: Math.round(bytes / 102.4) / 10, ms: { median: r1(median(times)), p95: r1(p95(times)) }, conditional, suggest };
  }

  // ── 2. Permisos ────────────────────────────────────────────────────────────
  report.permissions = {
    sinSesion: (await api('/api/loans/people', { token: '' })).status,
    otraSede: (await api('/api/loans/people', { token: singleToken, site: 'NFND' })).status,
    suSede: (await api('/api/loans/people', { token: singleToken, site: 'NFPT' })).status,
    suggestOtraSede: (await api('/api/loans/suggest?q=mar', { token: singleToken, site: 'NFND' })).status
  };

  // ── 3. Navegador ───────────────────────────────────────────────────────────
  const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true });
  try {
    const openPerson = async (page, site) => {
      await page.goto(`${base}/sede/${site.toLowerCase()}/loans`, { waitUntil: 'networkidle0', timeout: 60000 });
      await sleep(1200);
      const devices = await (await api('/api/devices', { site })).json();
      const free = (devices.items || []).find(item => /disponible|devuelto/i.test(item.estado || ''));
      const code = await page.$('main input');
      await code.click();
      await page.keyboard.type(free.etiqueta);
      for (let i = 0; i < 40 && !(await page.$('#lo-persona')); i += 1) await sleep(150);
      const person = await page.$('#lo-persona');
      if (!person) throw new Error(`No apareció Persona en ${site}`);
      await person.click();
      await sleep(1000);
      return person;
    };
    const newPage = async (context, site) => {
      const page = await context.newPage();
      await page.setViewport({ width: 1366, height: 800 });
      await page.setBypassServiceWorker(true);
      await page.evaluateOnNewDocument(siteCode => {
        try { localStorage.setItem('techasset_active_site', siteCode); sessionStorage.setItem('techasset_active_site', siteCode); localStorage.setItem('techasset_last_seen_release', '9999'); } catch { /* nada */ }
        window.__pc = { api: [], long: [], events: [] };
        const originalFetch = window.fetch;
        window.fetch = function pcFetch(input) {
          const url = typeof input === 'string' ? input : input?.url || String(input);
          if (/\/api\//.test(url)) window.__pc.api.push({ url, at: performance.now() });
          return originalFetch.apply(this, arguments);
        };
        try { new PerformanceObserver(list => { for (const e of list.getEntries()) window.__pc.long.push({ at: e.startTime, ms: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch { /* nada */ }
        try { new PerformanceObserver(list => { for (const e of list.getEntries()) if (/key/.test(e.name)) window.__pc.events.push({ at: e.startTime, ms: e.duration, delay: e.processingStart - e.startTime }); }).observe({ type: 'event', durationThreshold: 16, buffered: true }); } catch { /* nada */ }
      }, site);
      await page.emulateCPUThrottling(CPU);
      await page.emulateNetworkConditions({ download: (10 * 1e6) / 8, upload: (5 * 1e6) / 8, latency: 40 });
      return page;
    };
    for (const site of ['NFPT', 'NFND']) {
      const directory = directories[site];
      const terms = termsFor(directory);
      const rows = Object.fromEntries(terms.map(t => [t.kind, { term: t.term, expected: searchPeople(directory, t.term).length, ms: [], apiDuringTyping: [], longTaskMs: [], worstKeyMs: [], exact: [] }]));
      for (let run = 0; run < RUNS; run += 1) {
        const context = await browser.createBrowserContext();
        await context.setCookie({ name: 'techasset_session', value: adminToken, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' });
        const page = await newPage(context, site);
        const input = await openPerson(page, site);
        for (const { kind, term } of terms) {
          await clearField(page, input);
          await page.keyboard.press('Backspace');
          await sleep(700);
          const since = await page.evaluate(() => performance.now());
          for (const char of term) { await page.keyboard.type(char); await sleep(110); }
          const expected = searchPeople(directory, term).map(p => normalizePerson(p.persona || p.name));
          const out = await page.evaluate((expectedKeys, since0) => new Promise(resolve => {
            const norm = value => String(value || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
            const lastKey = Math.max(...window.__pc.events.map(e => e.at).filter(at => at >= since0), since0);
            const field = document.getElementById('lo-persona');
            const listId = field?.getAttribute('aria-controls');
            const options = () => {
              const scope = (listId && document.getElementById(listId)) || document.createElement('div');
              return [...scope.querySelectorAll('[role="option"]')].filter(el => el.getBoundingClientRect().height > 1);
            };
            const started = performance.now();
            const names = () => options().map(el => norm(el.querySelector('.lo-suggest-name')?.textContent || el.textContent));
            const tick = () => {
              const shown = options();
              const ok = expectedKeys.length ? shown.length > 0 && expectedKeys.every(key => names().some(name => name.includes(key))) : shown.length === 0;
              if (ok || performance.now() - started > 3000) {
                requestAnimationFrame(() => setTimeout(() => {
                  const t = performance.now();
                  resolve({
                    ok,
                    ms: ok ? Math.max(0, t - (window.__pc.lastKeyAt || t)) : null,
                    shown: shown.length,
                    api: window.__pc.api.filter(r => r.at >= since0 && r.url.includes("/api/loans/")).map(r => r.url.replace(location.origin, '')),
                    long: window.__pc.long.filter(l => l.at >= since0).reduce((sum, l) => sum + l.ms, 0),
                    worstKey: Math.max(0, ...window.__pc.events.filter(e => e.at >= since0).map(e => e.ms))
                  });
                }, 0));
                return;
              }
              requestAnimationFrame(tick);
            };
            tick();
          }), expected, since);
          // Tiempo desde la última tecla: se mide aparte con la marca del keydown.
          const timing = await page.evaluate(since0 => {
            const keys = performance.getEntriesByType('event').filter(e => e.name === 'keydown' && e.startTime >= since0);
            return keys.length ? keys[keys.length - 1].startTime : null;
          }, since);
          const row = rows[kind];
          row.apiDuringTyping.push(out.api.length);
          row.longTaskMs.push(out.long);
          row.worstKeyMs.push(out.worstKey);
          row.exact.push(out.ok);
          row.lastShown = out.shown;
          row.lastApi = out.api;
          row.timingProbe = timing;
        }
        await context.close();
      }
      report.browser[site] = rows;
    }

    // Tiempo "última tecla → sugerencias pintadas" con un probe dedicado (keydown real).
    for (const site of ['NFPT', 'NFND']) {
      const directory = directories[site];
      const terms = termsFor(directory).filter(t => t.kind !== 'sin resultados');
      for (let run = 0; run < RUNS; run += 1) {
        const context = await browser.createBrowserContext();
        await context.setCookie({ name: 'techasset_session', value: adminToken, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' });
        const page = await newPage(context, site);
        const input = await openPerson(page, site);
        for (const { kind, term } of terms) {
          await clearField(page, input);
          await page.keyboard.press('Backspace');
          await sleep(600);
          for (const char of term.slice(0, -1)) { await page.keyboard.type(char); await sleep(110); }
          const expected = searchPeople(directory, term).map(p => normalizePerson(p.persona || p.name)).slice(0, 1);
          // Antes de la última tecla: se marcan las opciones que ya están.
          await page.evaluate(() => { window.__pcT0 = 0; document.addEventListener('input', () => { window.__pcT0 = performance.now(); }, { once: true, capture: true }); });
          await page.keyboard.type(term.slice(-1));
          const ms = await page.evaluate(expectedKeys => new Promise(resolve => {
            const norm = value => String(value || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
            const field = document.getElementById('lo-persona');
            const listId = field?.getAttribute('aria-controls');
            const started = performance.now();
            const tick = () => {
              const scope = (listId && document.getElementById(listId)) || document.createElement('div');
              const names = [...scope.querySelectorAll('[role="option"]')].filter(el => el.getBoundingClientRect().height > 1).map(el => norm(el.querySelector('.lo-suggest-name')?.textContent || el.textContent));
              if (expectedKeys.every(key => names.some(name => name.includes(key))) && names.length) {
                requestAnimationFrame(() => setTimeout(() => resolve(performance.now() - window.__pcT0), 0));
                return;
              }
              if (performance.now() - started > 3000) { resolve(null); return; }
              requestAnimationFrame(tick);
            };
            tick();
          }), expected);
          report.browser[site][kind].ms.push(ms);
        }
        await context.close();
      }
    }

    // ── 4. Respuestas viejas (camino de respaldo, sin directorio) ────────────
    {
      const context = await browser.createBrowserContext();
      await context.setCookie({ name: 'techasset_session', value: adminToken, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' });
      const page = await newPage(context, 'NFPT');
      await page.setRequestInterception(true);
      const terms = termsFor(directories.NFPT);
      const slow = terms[0].term; // nombre repetido (3 letras)
      const fast = terms[3].term; // apellido
      page.on('request', request => {
        const url = request.url();
        if (/\/api\/loans\/people/.test(url)) { request.abort(); return; }
        if (/\/api\/loans\/suggest/.test(url) && url.includes(`q=${encodeURIComponent(slow)}`)) { setTimeout(() => request.continue().catch(() => undefined), 900); return; }
        request.continue().catch(() => undefined);
      });
      const input = await openPerson(page, 'NFPT');
      await page.keyboard.type(slow);
      await sleep(320); // pasa el debounce: sale el pedido lento
      await clearField(page, input);
      await page.keyboard.type(fast);
      await sleep(2200); // llegan las dos respuestas (la lenta, última)
      const shown = await page.evaluate(() => {
        const norm = value => String(value || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
        const field = document.getElementById('lo-persona');
        const listId = field?.getAttribute('aria-controls');
        const scope = (listId && document.getElementById(listId)) || document.createElement('div');
        return { value: field?.value, names: [...scope.querySelectorAll('[role="option"]')].filter(el => el.getBoundingClientRect().height > 1).map(el => norm(el.querySelector('.lo-suggest-name')?.textContent || el.textContent)) };
      });
      const tokens = normalizePerson(fast).split(' ');
      report.stale = { slowTerm: slow, fastTerm: fast, fieldValue: shown.value, shown: shown.names.length, allMatchLast: shown.names.length > 0 && shown.names.every(name => tokens.every(token => name.includes(token))), calls: (await page.evaluate(() => window.__pc.api.map(r => r.url.replace(location.origin, ''))).catch(() => [])).filter(url => /suggest|people/.test(url)) };
      await context.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  child.kill();
  await sleep(500);
  for (let i = 0; i < 10; i += 1) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); break; } catch { await sleep(200); } }
}

// ── Resumen ──────────────────────────────────────────────────────────────────
for (const [site, data] of Object.entries(report.api)) {
  console.log(`\nAPI ${site}: directorio ${data.people} personas · ${data.kb} KB · ${data.ms.median} / ${data.ms.p95} ms (n=15) · con ETag → ${data.conditional}`);
  for (const s of data.suggest) console.log(`  /suggest ${s.kind} "${s.term}": ${s.count} · ${s.ms} ms · todas las palabras ${s.allMatch ? 'sí' : 'NO'} · repetidos ${s.duplicates} · igual a la regla del front ${s.sameAsDirectoryRule ? 'sí' : 'NO'}`);
}
console.log(`\nPermisos: sin sesión ${report.permissions.sinSesion} · otra sede ${report.permissions.otraSede} · /suggest otra sede ${report.permissions.suggestOtraSede} · su sede ${report.permissions.suSede}`);
for (const [site, rows] of Object.entries(report.browser)) {
  console.log(`\nNavegador ${site} (CPU ${CPU}×, n=${RUNS}): | caso | término | esperadas | última tecla → sugerencias (med / p95) | pedidos /api al tipear | tareas largas | peor tecla | lista correcta |`);
  for (const [kind, row] of Object.entries(rows)) {
    console.log(`  | ${kind} | \`${row.term}\` | ${row.expected} | ${kind === 'sin resultados' ? '— (nada que mostrar)' : `${r1(median(row.ms))} / ${r1(p95(row.ms))}`} | ${Math.max(...row.apiDuringTyping)} | ${r1(median(row.longTaskMs))} ms | ${r1(median(row.worstKeyMs))} ms | ${row.exact.filter(Boolean).length}/${row.exact.length} |`);
  }
}
console.log(`\nRespuestas viejas (sin directorio, /suggest con el 1er término demorado 900 ms): campo "${report.stale?.fieldValue}" · ${report.stale?.shown} sugerencias · todas del último término: ${report.stale?.allMatchLast ? 'sí' : 'NO'} · pedidos ${JSON.stringify(report.stale?.calls)}`);
fs.mkdirSync(path.join(here, '.out'), { recursive: true });
fs.writeFileSync(path.join(here, '.out', 'people-check.json'), JSON.stringify(report, null, 2));
