// Suite de benchmarks reproducible de TechAsset (rediseño Grafito).
//
//   node perf/suite.mjs --repo=<checkout> --label=<nombre> [opciones]
//
// Mide un checkout cualquiera (main, la rama de trabajo, un worktree temporal)
// con el mismo banco, para comparar el estado inicial con cada pasada de
// optimización. Solo mediciones reales: cada métrica guarda las muestras crudas,
// la mediana, el p95 y el tamaño de muestra.
//
// Qué hace:
//   1. `npm run build` en el checkout si dist/ falta o quedó viejo (--build lo
//      fuerza, --no-build lo saltea).
//   2. Copia data/techasset.db (de ESTE repo, o --db=<archivo>) a un temporal con
//      la API de backup de SQLite, crea una sesión de superadmin en la copia y
//      apaga mails y push. Nunca toca la base real ni Postgres.
//   3. Levanta `node server/index.js` del checkout en un puerto libre de 127.0.0.1
//      con DATABASE_URL, SMTP, Resend, OpenAI, Google y VAPID vacíos,
//      MODO_PRUEBA=true y el preload de latencia (15 ms por query, como Supabase).
//   4. Abre Chrome headless (puppeteer-core) con CPU 4× más lenta y red simulada,
//      y mide N corridas de: inicio en frío y en caliente, cambio de módulo (1ª y
//      2ª vez), búsqueda de personas, búsqueda flexible de equipos, historial,
//      scroll, prestar y devolver. Después, la API desde Node (mediana/p95 y
//      queries por endpoint) y el tamaño del bundle.
//   5. Escribe docs/redesign/bench/<label>.json (crudo) y <label>.md (resumen).
//
// "Contenido cargado" no depende de clases CSS de una pantalla: es el primer
// momento en que (a) no queda ningún pedido /api/ en vuelo de los que salieron
// después de la acción, (b) no se ve ningún esqueleto ([class*=skel],
// [aria-busy=true], "Cargando…") y (c) el DOM no cambió durante una ventana de
// calma. El tiempo reportado es el del frame pintado después del ÚLTIMO cambio
// del DOM (no el de la detección). Los cambios de solo dígitos (relojes,
// contadores animados) no cuentan. "Respuesta" es el primer frame con un cambio
// dentro de <main> después de la acción.
//
// Opciones:
//   --runs=7          corridas por métrica
//   --cpu=4           factor de CPU throttling
//   --latency=15      ms sincrónicos por query en el server
//   --rtt=40 --down=10 --up=5   red simulada (ms de ida y vuelta, Mbps)
//   --db=<archivo>    base de origen (por defecto data/techasset.db de este repo)
//   --site=NFPT       sede
//   --only=startup,views,people,devsearch,history,scroll,ops,api,sizes
//   --out=<dir>       por defecto docs/redesign/bench de este repo
//   --build / --no-build, --headful, --keep (conserva la copia de la base)
//   E2E_BROWSER=<ruta> para elegir el navegador (si no, Chrome; si no, Edge).
//
// Ejemplo (estado inicial = main, en un worktree temporal):
//   git worktree add %TEMP%\techasset-main main
//   cd %TEMP%\techasset-main && cmd /c mklink /J node_modules C:\...\techasset\node_modules
//   node C:\...\techasset\perf\suite.mjs --repo=%TEMP%\techasset-main --label=00-inicial
//   git worktree remove --force %TEMP%\techasset-main
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import puppeteer from 'puppeteer-core';
import { snapshotDatabase } from '../e2e/lib/env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const suiteRoot = path.resolve(here, '..');

// ── Argumentos ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const option = (name, fallback) => {
  const found = argv.find(arg => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const repo = path.resolve(option('repo', suiteRoot));
const label = option('label', '');
if (!label) {
  console.error('Falta --label=<nombre> (ej. --label=00-inicial).');
  process.exit(2);
}
const RUNS = Number(option('runs', 7));
const CPU = Number(option('cpu', 4));
const LATENCY = Number(option('latency', 15));
const NET = { rtt: Number(option('rtt', 40)), down: Number(option('down', 10)), up: Number(option('up', 5)) };
const SITE = option('site', 'NFPT');
const DB_SOURCE = path.resolve(option('db', path.join(suiteRoot, 'data', 'techasset.db')));
const OUT_DIR = path.resolve(option('out', path.join(suiteRoot, 'docs', 'redesign', 'bench')));
const ONLY = new Set(String(option('only', 'startup,views,people,devsearch,history,scroll,ops,api,sizes')).split(',').map(item => item.trim()).filter(Boolean));
const BUILD_MODE = flag('build') ? 'force' : flag('no-build') ? 'skip' : 'auto';
const VIEWPORT = { width: 1366, height: 800 };
const COOKIE_NAME = 'techasset_session';

// Pantallas principales y cómo reconocerlas en la navegación (texto sin tildes,
// en minúsculas; acepta un contador al final, ej. "tickets 3"). Si el rediseño
// renombra un ítem, sumar la variante acá.
const VIEWS = [
  ['dashboard', 'Dashboard', 'dashboard|inicio|tablero|panel'],
  ['loans', 'Préstamos', 'prestamos'],
  ['devices', 'Dispositivos', 'dispositivos|equipos'],
  ['inventory', 'Inventario', 'inventario|inventario tic'],
  ['agenda', 'Agenda', 'agenda|agenda tic'],
  ['tasks', 'Tareas', 'tareas|tareas tic'],
  ['tickets', 'Tickets', 'tickets?'],
  ['history', 'Historial', 'historial'],
  ['analytics', 'Analítica', 'analitica'],
  ['settings', 'Configuración', 'configuracion|ajustes']
];
// Orden del recorrido: se arranca en el dashboard, así que va último (vuelta).
const VIEW_ORDER = ['loans', 'devices', 'inventory', 'agenda', 'tasks', 'tickets', 'history', 'analytics', 'settings', 'dashboard'];

// Endpoints que se miden siempre desde Node (además de los que pida el navegador).
const BASE_ENDPOINTS = [
  '/api/auth/session',
  '/api/site-settings',
  '/api/devices',
  '/api/movements',
  '/api/agenda',
  '/api/tasks?space=team',
  '/api/notifications',
  '/api/user/prefs',
  '/api/release-notes/latest',
  '/api/internal-notes?filter=all',
  '/api/loans/previous-day',
  '/api/photo-passes',
  '/api/history?kind=loans&limit=50',
  '/api/history?kind=all&limit=50'
];

const log = message => console.log(`[suite ${label}] ${message}`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const r1 = value => (Number.isFinite(value) ? Math.round(value * 10) / 10 : null);
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Mediana, p95 (rango más cercano: con n=7 es el máximo), mín, máx y las muestras. */
function stats(values) {
  const clean = values.filter(Number.isFinite);
  const sorted = [...clean].sort((a, b) => a - b);
  const n = sorted.length;
  if (!n) return { n: 0, median: null, p95: null, min: null, max: null, values: values.map(r1) };
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const p95 = sorted[Math.min(n - 1, Math.ceil(0.95 * n) - 1)];
  return { n, median: r1(median), p95: r1(p95), min: r1(sorted[0]), max: r1(sorted[n - 1]), values: values.map(r1) };
}

// ── Entorno: build, base, server, navegador ──────────────────────────────────
const BROWSERS = [
  process.env.E2E_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);

function findBrowser() {
  const found = BROWSERS.find(candidate => fs.existsSync(candidate));
  if (!found) throw new Error(`No encontré Chrome ni Edge (${BROWSERS.join(', ')}). Usá E2E_BROWSER=<ruta>.`);
  return found;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function newestSourceMtime(root) {
  let newest = 0;
  const walk = dir => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else newest = Math.max(newest, fs.statSync(full).mtimeMs);
    }
  };
  walk(path.join(root, 'src'));
  walk(path.join(root, 'public'));
  for (const file of ['index.html', 'vite.config.ts', 'package.json', 'tsconfig.json']) {
    const full = path.join(root, file);
    if (fs.existsSync(full)) newest = Math.max(newest, fs.statSync(full).mtimeMs);
  }
  return newest;
}

function ensureBuild(root) {
  const index = path.join(root, 'dist', 'index.html');
  const exists = fs.existsSync(index);
  const stale = exists && fs.statSync(index).mtimeMs < newestSourceMtime(root);
  if (BUILD_MODE === 'skip' || (BUILD_MODE === 'auto' && exists && !stale)) {
    if (!exists) throw new Error(`No hay ${index} y se pidió --no-build.`);
    return { built: false, stale, ms: 0 };
  }
  log(`npm run build en ${root} (${exists ? (stale ? 'dist/ viejo' : 'forzado') : 'sin dist/'})...`);
  const started = Date.now();
  const result = spawnSync('npm run build', { cwd: root, stdio: 'inherit', shell: true });
  if (result.status !== 0) throw new Error('Falló `npm run build` en el checkout.');
  return { built: true, stale, ms: Date.now() - started };
}

function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  return (result.stdout || '').trim();
}

/** Copia la base y deja una sesión de superadmin; nada sale afuera. */
async function prepareDatabase() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'techasset-suite-'));
  const dbCopy = path.join(tmpDir, 'suite.db');
  await snapshotDatabase(DB_SOURCE, dbCopy);
  const db = new Database(dbCopy);
  const now = new Date().toISOString();
  const admin = db.prepare("SELECT id, email FROM users WHERE rol_global='Superadmin' AND activo=1 ORDER BY id LIMIT 1").get();
  if (!admin) throw new Error('La copia no tiene ningún Superadmin activo.');
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO user_sessions (token, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
    .run(token, admin.id, now, new Date(Date.now() + 86400000).toISOString(), now);
  db.prepare("INSERT INTO app_settings (key, value) VALUES ('mail.modoPrueba', 'true') ON CONFLICT(key) DO UPDATE SET value='true'").run();
  db.prepare('DELETE FROM push_subscriptions').run();

  const count = (sql, ...params) => { try { return db.prepare(sql).get(...params)?.n ?? null; } catch { return null; } };
  const dataset = {
    devices: count('SELECT COUNT(*) n FROM local_devices WHERE site_code=? AND COALESCE(eliminado,0)=0', SITE),
    loanEvents: count('SELECT COUNT(*) n FROM loan_events WHERE site_code=?', SITE),
    movements: count('SELECT COUNT(*) n FROM local_movements'),
    tasks: count('SELECT COUNT(*) n FROM tasks'),
    agenda: count('SELECT COUNT(*) n FROM agenda'),
    tickets: count('SELECT COUNT(*) n FROM tickets')
  };
  const people = db.prepare("SELECT persona FROM loan_events WHERE site_code=? AND tipo='prestamo' AND TRIM(persona)<>''").all(SITE).map(row => row.persona);
  db.close();
  return { tmpDir, dbCopy, token, admin, dataset, people };
}

/**
 * Términos reales para la búsqueda de personas, sacados de loan_events:
 * coincidencia común (inicio del nombre más usado), parcial (mitad de un
 * apellido), con tilde y sin tilde (mismas letras) y sin resultados.
 */
function personTerms(people) {
  const groups = new Map();
  for (const name of people) {
    const key = normalize(name);
    if (key) groups.set(key, (groups.get(key) || 0) + 1);
  }
  const ranked = [...groups.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
  const matches = term => ranked.filter(key => key.includes(normalize(term))).length;
  const top = ranked[0] || 'alex cavalli';
  const common = top.split(' ')[0].slice(0, 3);
  const longWord = top.split(' ').filter(word => word.length >= 5).pop() || top.replace(/ /g, '');
  let partial = longWord.slice(2, 5);
  if (partial.length < 3) partial = top.replace(/ /g, '').slice(1, 4);
  const accentable = ranked.map(key => key.split(' ')[0].slice(0, 3)).find(prefix => prefix !== common && /^[a-z]{3}$/.test(prefix) && /[aeiou]/.test(prefix)) || 'mar';
  const accents = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú' };
  const accented = accentable.replace(/[aeiou]/, vowel => accents[vowel]);
  let none = 'zqx';
  for (const candidate of ['zqx', 'qzx', 'xqz', 'wqz']) if (!matches(candidate)) { none = candidate; break; }
  return [
    { kind: 'común', term: common, expected: matches(common) },
    { kind: 'parcial', term: partial, expected: matches(partial) },
    { kind: 'con tilde', term: accented, expected: matches(accented) },
    { kind: 'sin tilde', term: accentable, expected: matches(accentable) },
    { kind: 'sin resultados', term: none, expected: matches(none) }
  ];
}

async function startServer({ dbCopy, tmpDir }) {
  const port = await freePort();
  const statsPort = await freePort();
  const env = {
    ...process.env,
    PORT: String(port),
    SERVER_HOST: '127.0.0.1',
    SQLITE_DB_PATH: dbCopy,
    DB_DRIVER: 'sqlite',
    DATABASE_URL: '',
    MODO_PRUEBA: 'true',
    SMTP_SERVER: '', SMTP_USER: '', SMTP_APP_PASSWORD: '',
    RESEND_API_KEY: '', RESEND_FROM: '',
    GOOGLE_SHEET_CSV_URL: '',
    GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_REDIRECT_URI: '',
    OPENAI_API_KEY: '',
    VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '',
    SUPERADMIN_EMAILS: '',
    LOCALTUNNEL_SUBDOMAIN: '',
    CACHE_CSV_PATH: path.join(tmpDir, 'cache_sheet.csv'),
    DEVICES_APP_CSV_PATH: path.join(tmpDir, 'devices_app.csv'),
    TOOLS_TEMP_DIR: path.join(tmpDir, 'tools'),
    UPLOADS_DIR: path.join(tmpDir, 'uploads'),
    APP_BASE_URL: `http://127.0.0.1:${port}`,
    TECHASSET_PUBLIC_URL: `http://127.0.0.1:${port}`,
    DEBUG_DEVICE_PERF: '',
    BENCH_STATS_PORT: String(statsPort),
    BENCH_LATENCY_MS: String(LATENCY)
  };
  const preload = pathToFileURL(path.join(here, 'suite-preload.mjs')).href;
  const child = spawn(process.execPath, ['--import', preload, 'server/index.js'], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 240; i += 1) {
    if (child.exitCode !== null) throw new Error(`El server se cerró al arrancar:\n${output}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) {
        const counter = async op => (await fetch(`http://127.0.0.1:${statsPort}/${op}`)).json();
        return { child, base, port, counter, getLog: () => output };
      }
    } catch { /* todavía no */ }
    await sleep(250);
  }
  child.kill();
  throw new Error(`El server no arrancó en 60 s:\n${output}`);
}

async function stopServer(server) {
  if (!server?.child || server.child.exitCode !== null) return;
  const exited = new Promise(resolve => server.child.once('exit', resolve));
  server.child.kill();
  await Promise.race([exited, sleep(5000)]);
}

async function removeTmp(dir) {
  for (let i = 0; i < 20; i += 1) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return; } catch { await sleep(200); }
  }
}

function apiClient(base, token) {
  const headers = { cookie: `${COOKIE_NAME}=${token}`, 'X-Site-Code': SITE, Accept: 'application/json' };
  const call = async (method, url, body) => {
    const started = performance.now();
    const response = await fetch(`${base}${url}`, {
      method,
      headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const buffer = await response.arrayBuffer();
    const ms = performance.now() - started;
    let data = null;
    try { data = JSON.parse(new TextDecoder().decode(buffer)); } catch { /* no JSON */ }
    return { status: response.status, ms, bytes: buffer.byteLength, data };
  };
  return {
    get: url => call('GET', url),
    post: (url, body) => call('POST', url, body),
    devices: async () => (await call('GET', '/api/devices')).data?.items || []
  };
}

const loanState = estado => {
  const value = String(estado || '').trim();
  if (/prest/i.test(value)) return 'loaned';
  if (/^(|disponible|devuelto)$/i.test(value)) return 'available';
  return 'other';
};

// ── Instrumentación dentro de la página ──────────────────────────────────────
// Corre antes que cualquier script de la app (evaluateOnNewDocument). Tiene que
// ser autocontenida: puppeteer la serializa con toString().
function instrument(site, release) {
  try {
    localStorage.setItem('techasset_active_site', site);
    sessionStorage.setItem('techasset_active_site', site);
    if (release) localStorage.setItem('techasset_last_seen_release', release);
  } catch { /* sin storage */ }
  const now = () => performance.now();
  const B = {
    api: [], longTasks: [], inputs: [],
    lastMut: 0, lastMutFrame: 0, mainFrames: [], shellAt: 0,
    frameReq: false, mainPending: false
  };
  window.__bench = B;

  // Después de pintar: rAF + mensaje (corre tras estilos, layout y pintado del frame).
  const channel = new MessageChannel();
  const afterPaintQueue = [];
  channel.port1.onmessage = () => { const t = now(); while (afterPaintQueue.length) afterPaintQueue.shift()(t); };
  B.afterPaint = callback => requestAnimationFrame(() => { afterPaintQueue.push(callback); channel.port2.postMessage(0); });

  // Pedidos a la API (fetch): inicio, fin del cuerpo, estado y tamaño.
  const originalFetch = window.fetch;
  window.fetch = function benchFetch(input, init) {
    let url = '';
    try { url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url; } catch { /* nada */ }
    if (!/\/api\//.test(url)) return originalFetch.apply(this, arguments);
    let pathOnly = url;
    try { const parsed = new URL(url, location.href); pathOnly = parsed.pathname + parsed.search; } catch { /* nada */ }
    let method = 'GET';
    let bg = false;
    try {
      method = String((init && init.method) || (input && typeof input === 'object' && input.method) || 'GET').toUpperCase();
      const headers = new Headers((init && init.headers) || (input && typeof input === 'object' && input.headers) || undefined);
      bg = headers.has('X-Revalidate');
    } catch { /* nada */ }
    const record = { url: pathOnly, method, bg, start: now(), headersAt: 0, end: 0, status: 0, bytes: 0 };
    B.api.push(record);
    if (B.api.length > 2000) B.api.splice(0, 1000);
    const promise = originalFetch.apply(this, arguments);
    promise.then(response => {
      record.status = response.status;
      record.headersAt = now();
      response.clone().arrayBuffer().then(buffer => { record.bytes = buffer.byteLength; record.end = now(); }, () => { record.end = now(); });
    }, () => { record.status = -1; record.end = now(); });
    return promise;
  };

  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) B.longTasks.push({ start: entry.startTime, dur: entry.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch { /* sin longtask */ }

  for (const type of ['pointerdown', 'click', 'keydown']) {
    addEventListener(type, event => {
      B.inputs.push({ type, t: event.timeStamp, key: event.key || '' });
      if (B.inputs.length > 400) B.inputs.splice(0, 200);
    }, true);
  }

  // Cambios del DOM. Los de solo dígitos (reloj, contador animado) no cuentan.
  const digitsOnly = (a, b) => a != null && b != null && a.length < 32 && b.length < 32 && a.replace(/\d/g, '') === b.replace(/\d/g, '');
  const onFrame = t => {
    B.frameReq = false;
    B.lastMutFrame = t;
    if (B.mainPending) {
      B.mainPending = false;
      B.mainFrames.push(t);
      if (B.mainFrames.length > 600) B.mainFrames.splice(0, 300);
    }
  };
  new MutationObserver(records => {
    let relevant = false;
    let inMain = false;
    for (const record of records) {
      if (record.type === 'characterData' && digitsOnly(record.oldValue, record.target.data)) continue;
      const element = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      // <head>: los <link> que agrega la precarga de chunks (modulepreload y el
      // CSS de cada pantalla) no se ven; contarlos estiraba "pantalla quieta"
      // hasta que terminaba de precargar todo.
      if (record.target === document.head || (element && element.closest && element.closest('head'))) continue;
      relevant = true;
      if (element && element.closest && element.closest('main,[role="main"]')) inMain = true;
    }
    if (!relevant) return;
    B.lastMut = now();
    if (inMain) B.mainPending = true;
    if (!B.frameReq) { B.frameReq = true; B.afterPaint(onFrame); }
  }).observe(document, { childList: true, subtree: true, characterData: true, characterDataOldValue: true });

  // App visible: hay navegación con ítems y un <main>, pintados.
  const shellCheck = () => {
    if (B.shellAt) return;
    const nav = document.querySelector('nav,[role="navigation"]');
    const main = document.querySelector('main,[role="main"]');
    if (nav && main && nav.querySelectorAll('a,button,[role="link"],[role="menuitem"]').length >= 3) {
      B.afterPaint(t => { if (!B.shellAt) B.shellAt = t; });
      return;
    }
    requestAnimationFrame(shellCheck);
  };
  requestAnimationFrame(shellCheck);

  const visible = element => {
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    if (element.checkVisibility && !element.checkVisibility({ visibilityProperty: true })) return false;
    return true;
  };
  B.visible = visible;

  /** ¿Se ve algo "cargando"? Devuelve una descripción o ''. */
  B.loadingVisible = () => {
    // Solo lo que está a la vista: una pantalla que monta secciones al
    // scrollear (Analítica del rediseño) deja esqueletos debajo del pliegue a propósito.
    const inViewport = element => { const rect = element.getBoundingClientRect(); return rect.bottom > 0 && rect.top < innerHeight; };
    for (const element of document.querySelectorAll('[class*="skel" i],[class*="shimmer" i],[aria-busy="true"]')) {
      if (visible(element) && inViewport(element)) return `${element.tagName.toLowerCase()}.${String(element.className || '').slice(0, 40)}`;
    }
    const scope = document.querySelector('main,[role="main"]') || document.body;
    if (!scope) return '';
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.data.trim();
      if (text.length && text.length < 40 && /^cargando\b/i.test(text) && node.parentElement && visible(node.parentElement)) return text;
    }
    return '';
  };

  /**
   * Espera "contenido cargado" a partir de `since` (ver encabezado de la suite).
   * ms = frame pintado tras el último cambio del DOM − since.
   */
  B.waitSettled = ({ since = 0, quiet = 600, timeout = 25000, requireChange = true, requireShell = false } = {}) => new Promise(resolve => {
    const t0 = now();
    const apisSince = () => B.api.filter(record => record.start >= since - 2);
    const tick = () => {
      const t = now();
      const pending = apisSince().filter(record => !record.end);
      const loading = B.loadingVisible();
      const changed = B.lastMut > since;
      const framed = B.lastMutFrame >= B.lastMut;
      const lastChange = Math.max(B.lastMut, since);
      const firstMain = B.mainFrames.find(frame => frame > since);
      const summary = () => apisSince().map(record => ({ url: record.url, method: record.method, bg: record.bg, status: record.status, startMs: Math.round(record.start - since), ms: record.end ? Math.round(record.end - record.start) : null, bytes: record.bytes }));
      if (!pending.length && !loading && framed && t - lastChange >= quiet && (changed || !requireChange) && (B.shellAt || !requireShell)) {
        const settledAt = changed ? B.lastMutFrame : since;
        resolve({ ok: true, ms: settledAt - since, firstChangeMs: firstMain ? firstMain - since : null, apis: summary() });
        return;
      }
      if (t - t0 > timeout) {
        resolve({
          ok: false,
          reason: pending.length ? `pedidos sin terminar: ${pending.map(record => record.url).join(', ')}` : loading ? `sigue cargando: ${loading}` : requireShell && !B.shellAt ? 'la app no mostró navegación + main' : !changed ? 'la acción no cambió nada en pantalla' : 'el DOM no se aquietó',
          ms: null, firstChangeMs: firstMain ? firstMain - since : null, apis: summary()
        });
        return;
      }
      setTimeout(tick, 100);
    };
    tick();
  });

  /** TTI: fin de la última tarea larga antes de 5 s sin tareas largas (desde FCP). TBT entre FCP y TTI. */
  B.waitInteractive = ({ windowMs = 5000, timeout = 45000 } = {}) => new Promise(resolve => {
    const t0 = now();
    const tick = () => {
      const t = now();
      const fcp = (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime || 0;
      const nav = performance.getEntriesByType('navigation')[0] || {};
      const lastEnd = B.longTasks.reduce((max, task) => Math.max(max, task.start + task.dur), 0);
      if (fcp && t - Math.max(fcp, lastEnd) >= windowMs) {
        const tti = Math.max(fcp, nav.domContentLoadedEventEnd || 0, lastEnd);
        let tbt = 0;
        for (const task of B.longTasks) {
          const start = Math.max(task.start, fcp);
          const end = Math.min(task.start + task.dur, tti);
          if (end - start > 50) tbt += end - start - 50;
        }
        resolve({
          ok: true, fcp, tti, tbt,
          dcl: nav.domContentLoadedEventEnd || null,
          load: nav.loadEventEnd || null,
          longTasks: B.longTasks.length,
          longTaskMs: B.longTasks.reduce((sum, task) => sum + task.dur, 0)
        });
        return;
      }
      if (t - t0 > timeout) { resolve({ ok: false, fcp, tti: null, tbt: null }); return; }
      setTimeout(tick, 250);
    };
    tick();
  });

  B.lastInput = type => {
    for (let i = B.inputs.length - 1; i >= 0; i -= 1) if (B.inputs[i].type === type) return B.inputs[i].t;
    return null;
  };

  /** Filas visibles de tablas/listas dentro de <main>. */
  B.countRows = () => {
    const scope = document.querySelector('main,[role="main"]') || document.body;
    return [...scope.querySelectorAll('tbody tr, [role="row"]')].filter(visible).length;
  };

  /** Scroll de la lista más larga: tiempos entre frames pintados, bajando y subiendo. */
  B.scroll = async ({ step = 120, maxFrames = 400 } = {}) => {
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const candidates = [document.scrollingElement, ...document.querySelectorAll('body *')]
      .filter(element => element && element.scrollHeight > element.clientHeight + 80)
      .filter(element => {
        if (element === document.scrollingElement) return true;
        const style = getComputedStyle(element);
        return /(auto|scroll)/.test(style.overflowY);
      })
      // Primero el que contiene la lista (filas de <main>); entre esos, el de más recorrido.
      .map(element => ({ element, score: (element.scrollHeight - element.clientHeight) + (element.querySelector('main tbody tr, main [role="row"], tbody tr, [role="row"]') || element.closest('main') ? 1e7 : 0) }))
      .sort((a, b) => b.score - a.score)
      .map(item => item.element);
    const scroller = candidates[0];
    if (!scroller) return { ok: false, reason: 'no hay nada que scrollear' };
    const range = scroller.scrollHeight - scroller.clientHeight;
    scroller.scrollTop = 0;
    await frame(); await frame();
    const frames = [];
    const ltBefore = B.longTasks.length;
    let last = await frame();
    // Como la rueda: un evento `wheel` (que la app puede escuchar) y el scroll.
    // El puntero queda donde lo dejó el último clic (en general, sobre la lista).
    const wheel = deltaY => { try { scroller.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true })); } catch { /* nada */ } };
    for (let y = step; y <= range + step && frames.length < maxFrames; y += step) {
      wheel(step);
      scroller.scrollTop = Math.min(y, range);
      const t = await frame();
      frames.push(t - last);
      last = t;
    }
    for (let y = range - step; y >= -step && frames.length < maxFrames * 2; y -= step) {
      wheel(-step);
      scroller.scrollTop = Math.max(y, 0);
      const t = await frame();
      frames.push(t - last);
      last = t;
    }
    const sorted = [...frames].sort((a, b) => a - b);
    const tasks = B.longTasks.slice(ltBefore);
    return {
      ok: true,
      scroller: scroller === document.scrollingElement ? 'documento' : `${scroller.tagName.toLowerCase()}.${String(scroller.className || '').split(' ')[0]}`,
      rangePx: range,
      frames: frames.length,
      p50: sorted[Math.floor(sorted.length * 0.5)] || 0,
      p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] || 0,
      worst: sorted[sorted.length - 1] || 0,
      over50: frames.filter(value => value > 50).length,
      longTasks: tasks.length,
      longTaskMs: tasks.reduce((sum, task) => sum + task.dur, 0)
    };
  };
}

// ── Ayudas de navegador ──────────────────────────────────────────────────────
let browser;
let server;
let api;
let releaseVersion = '';

async function newSession() {
  const context = await browser.createBrowserContext();
  const cookie = { name: COOKIE_NAME, value: server.token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' };
  if (typeof context.setCookie === 'function') await context.setCookie(cookie);
  const page = await context.newPage();
  if (typeof context.setCookie !== 'function') await page.setCookie(cookie);
  await page.setViewport(VIEWPORT);
  await page.setBypassServiceWorker(true);
  await page.emulateCPUThrottling(CPU);
  await page.emulateNetworkConditions({ download: (NET.down * 1e6) / 8, upload: (NET.up * 1e6) / 8, latency: NET.rtt });
  await page.evaluateOnNewDocument(instrument, SITE, releaseVersion);
  page.setDefaultTimeout(30000);
  page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
  const errors = [];
  page.on('pageerror', error => errors.push(String(error?.message || error)));
  await page.bringToFront();
  return { context, page, errors };
}

const settle = (page, options) => page.evaluate(opts => window.__bench.waitSettled(opts), options);
// Entrada por la URL de la sede: con "/" la app abre la sede por defecto del
// usuario (que puede no ser SITE) y se mediría con otros datos.
const ENTRY = () => `${server.base}/sede/${SITE.toLowerCase()}/dashboard`;
const nowIn = page => page.evaluate(() => performance.now());

/** Abre la app en el dashboard de la sede y espera el contenido con datos. */
async function openApp(page) {
  await page.goto(ENTRY(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  const result = await settle(page, { since: 0, quiet: 800, timeout: 40000, requireShell: true });
  if (!result.ok) throw new Error(`La app no terminó de cargar: ${result.reason}`);
  const where = await page.evaluate(() => location.pathname.toLowerCase());
  if (!where.includes(`/${SITE.toLowerCase()}`)) throw new Error(`La app no quedó en la sede ${SITE} (ruta ${where}).`);
  return result;
}

/** Ítem de navegación de una vista (texto, aria-label, title o href /<vista>). */
async function navItem(page, key) {
  const [, , pattern] = VIEWS.find(([viewKey]) => viewKey === key);
  const handle = await page.evaluateHandle((viewKey, source) => {
    const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    // Acepta un contador pegado o separado: "prestamos 3", "prestamos3", "prestamos, 3".
    const rx = new RegExp(`^(?:${source})(?:,? ?\\d+)?$`);
    const hrefRx = new RegExp(`/${viewKey}/?$`);
    for (const root of document.querySelectorAll('nav, aside, [role="navigation"]')) {
      for (const element of root.querySelectorAll('a, button, [role="link"], [role="menuitem"], [role="tab"]')) {
        if (!window.__bench.visible(element)) continue;
        const texts = [element.textContent, element.getAttribute('aria-label'), element.getAttribute('title')].map(norm);
        if (texts.some(text => rx.test(text)) || hrefRx.test(element.getAttribute('href') || '')) return element;
      }
    }
    return null;
  }, key, pattern);
  const element = handle.asElement();
  if (!element) await handle.dispose();
  return element;
}

/** Click en la navegación y espera el contenido. Devuelve { ok, ms, firstChangeMs, apis }. */
async function switchView(page, key) {
  const item = await waitFor(() => navItem(page, key), { timeout: 3000 });
  if (!item) return { ok: false, reason: 'no está en la navegación', ms: null, firstChangeMs: null };
  await item.click();
  const since = await page.evaluate(() => window.__bench.lastInput('click'));
  await item.dispose();
  return settle(page, { since, quiet: 600, timeout: 25000 });
}

/** Campo de texto de <main> por contexto (label, placeholder, aria-label). */
async function findField(page, kind) {
  const handle = await page.evaluateHandle(fieldKind => {
    const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const scope = document.querySelector('main,[role="main"]') || document.body;
    const inputs = [...scope.querySelectorAll('input, textarea, [role="searchbox"], [role="combobox"]')]
      .filter(element => !/^(hidden|checkbox|radio|date|number|file|button|submit)$/i.test(element.type || ''))
      .filter(element => !element.disabled && window.__bench.visible(element));
    const context = element => {
      const parts = [element.getAttribute('aria-label'), element.placeholder, element.title, element.name];
      if (element.labels) for (const labelEl of element.labels) parts.push(labelEl.textContent);
      const wrapping = element.closest('label');
      if (wrapping) parts.push(wrapping.textContent);
      if (element.previousElementSibling?.tagName === 'LABEL') parts.push(element.previousElementSibling.textContent);
      let parent = element.parentElement;
      for (let i = 0; i < 2 && parent; i += 1) {
        const prev = parent.previousElementSibling;
        if (prev && (prev.textContent || '').length < 60) parts.push(prev.textContent);
        parent = parent.parentElement;
      }
      return norm(parts.filter(Boolean).join(' | '));
    };
    const RULES = {
      person: [[/persona|quien recibe/, 5], [/recibe|nombre/, 2], [/alumno|docente/, -3]],
      code: [[/etiqueta|codigo|\bqr\b|escane/, 5], [/d\d{3,4}/, 3], [/persona|nombre|filtr|busc/, -5]],
      deviceSearch: [[/dispositiv|etiqueta|alias|equipo/, 3], [/filtr|busc/, 2], [/persona|historial/, -3]],
      historySearch: [[/persona|equipo|descripcion|busc/, 3]]
    };
    let best = null;
    let bestScore = 0;
    for (const element of inputs) {
      const text = context(element);
      let score = 0;
      for (const [rx, points] of RULES[fieldKind]) if (rx.test(text)) score += points;
      if (fieldKind === 'deviceSearch' && (element.type === 'search' || element.getAttribute('role') === 'searchbox')) score += 2;
      if (element.closest('header')) score -= 4;
      if (score > bestScore) { best = element; bestScore = score; }
    }
    return best;
  }, kind);
  const element = handle.asElement();
  if (!element) await handle.dispose();
  return element;
}

async function clearAndType(page, element, text) {
  await element.click({ clickCount: 3 });
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  if (text) await page.keyboard.type(text);
}

/** Botón visible por texto (regex sobre el texto normalizado), opcionalmente habilitado. */
async function findButton(page, source, { enabled = false, near = null } = {}) {
  const handle = await page.evaluateHandle((pattern, mustBeEnabled, nearElement) => {
    const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const rx = new RegExp(pattern);
    // Con `near`, primero el formulario/secci\u00f3n de ese campo (otro "Prestar" de la pantalla no sirve).
    const scope = (nearElement && nearElement.closest('form, [role="form"], section')) || document.querySelector('main,[role="main"]') || document.body;
    for (const element of scope.querySelectorAll('button, [role="button"], a')) {
      if (!window.__bench.visible(element)) continue;
      if (mustBeEnabled && (element.disabled || element.getAttribute('aria-disabled') === 'true')) continue;
      if (rx.test(norm(element.textContent)) || rx.test(norm(element.getAttribute('aria-label')))) return element;
    }
    return null;
  }, source, enabled, near);
  const element = handle.asElement();
  if (!element) await handle.dispose();
  return element;
}

async function waitFor(fn, { timeout = 8000, interval = 100 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await fn();
    if (value) return value;
    await sleep(interval);
  }
  return null;
}

/**
 * Elige un valor en un control rotulado (select nativo, botón con lista
 * role=option, o grupo de radios/chips). `prefer` = regex del valor preferido.
 */
async function chooseOption(page, labelSource, preferSource) {
  const kind = await page.evaluate((labelPattern, preferPattern) => {
    const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const rx = new RegExp(labelPattern);
    const prefer = new RegExp(preferPattern);
    const scope = document.querySelector('main,[role="main"]') || document.body;
    const labelOf = element => norm(element.getAttribute('aria-label') || (element.labels && element.labels[0]?.textContent) || element.closest('label')?.firstChild?.textContent || '');
    for (const select of scope.querySelectorAll('select')) {
      if (!rx.test(labelOf(select))) continue;
      const options = [...select.options].filter(opt => opt.value && !/^seleccion/i.test(norm(opt.textContent)));
      const pick = options.find(opt => prefer.test(norm(opt.textContent))) || options[0];
      if (!pick) return 'vacío';
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(select, pick.value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return 'select';
    }
    // Grupos de radios o de chips (rediseño: OptionGroup = role="group" con botones aria-pressed).
    for (const group of scope.querySelectorAll('[role="radiogroup"], [role="group"][aria-label]')) {
      const name = norm(group.getAttribute('aria-label') || document.getElementById(group.getAttribute('aria-labelledby') || '')?.textContent || '');
      if (!rx.test(name)) continue;
      const radios = [...group.querySelectorAll('[role="radio"], input[type="radio"], button')];
      const pick = radios.find(radio => prefer.test(norm(radio.textContent || radio.value))) || radios[0];
      if (!pick) return 'vacío';
      pick.click();
      return 'radio';
    }
    for (const trigger of scope.querySelectorAll('button[aria-label], [role="combobox"][aria-label]')) {
      if (rx.test(norm(trigger.getAttribute('aria-label'))) && window.__bench.visible(trigger)) {
        trigger.setAttribute('data-bench-trigger', '1');
        return 'lista';
      }
    }
    return 'no encontrado';
  }, labelSource, preferSource);
  if (kind !== 'lista') return kind;
  const trigger = await page.$('[data-bench-trigger="1"]');
  await trigger.click();
  const option = await waitFor(async () => {
    const handle = await page.evaluateHandle(preferPattern => {
      const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
      const prefer = new RegExp(preferPattern);
      const options = [...document.querySelectorAll('[role="option"]')].filter(element => window.__bench.visible(element) && !/^seleccion/.test(norm(element.textContent)));
      return options.find(element => prefer.test(norm(element.textContent))) || options[0] || null;
    }, preferSource);
    const element = handle.asElement();
    if (!element) await handle.dispose();
    return element;
  }, { timeout: 4000 });
  await page.evaluate(() => document.querySelector('[data-bench-trigger="1"]')?.removeAttribute('data-bench-trigger'));
  if (!option) return 'sin opciones';
  await option.click();
  return 'lista';
}

// ── Mediciones ───────────────────────────────────────────────────────────────
const results = { startup: { cold: [], warm: [] }, views: { first: {}, second: {} }, people: {}, devsearch: [], history: { first: [], more: [] }, scroll: { devices: [], history: [] }, ops: { lend: [], ret: [] }, api: {}, sizes: {}, errors: [], observedApis: new Set(), startupApis: [], viewApis: {} };
const fail = (section, run, error) => {
  const message = error instanceof Error ? error.message : String(error);
  results.errors.push({ section, run, message: message.slice(0, 600) });
  log(`  ! ${section} (corrida ${run + 1}): ${message.slice(0, 200)}`);
};
// Sin el `_ts` anti-caché, para no medir el mismo endpoint varias veces.
const cleanUrl = url => String(url).replace(/([?&])_ts=\d+&?/, '$1').replace(/[?&]$/, '');
const observe = apis => { for (const item of apis || []) if (item.method === 'GET' && item.status >= 200 && item.status < 400) results.observedApis.add(cleanUrl(item.url)); };

/** Bytes transferidos por tipo de recurso durante una carga (CDP Network). */
async function trackTransfer(page) {
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  const types = new Map();
  const totals = {};
  cdp.on('Network.responseReceived', event => types.set(event.requestId, event.type));
  cdp.on('Network.loadingFinished', event => {
    const type = types.get(event.requestId) || 'Other';
    totals[type] = (totals[type] || 0) + event.encodedDataLength;
  });
  return async () => { await cdp.detach().catch(() => {}); return Object.fromEntries(Object.entries(totals).map(([type, bytes]) => [type, Math.round(bytes / 102.4) / 10])); };
}

async function measureLoad(page, { transfer = false } = {}) {
  const stopTransfer = transfer ? await trackTransfer(page) : null;
  await page.goto(ENTRY(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  const content = await settle(page, { since: 0, quiet: 800, timeout: 40000, requireShell: true });
  const interactive = await page.evaluate(() => window.__bench.waitInteractive({ windowMs: 5000, timeout: 45000 }));
  const shellAt = await page.evaluate(() => window.__bench.shellAt || null);
  const kb = stopTransfer ? await stopTransfer() : null;
  return {
    ok: content.ok && interactive.ok,
    reason: content.ok ? (interactive.ok ? '' : 'sin 5 s de calma para TTI') : content.reason,
    fcp: interactive.fcp || null,
    shell: shellAt,
    dashboardData: content.ok ? content.ms : null,
    tti: interactive.tti,
    tbt: interactive.tbt,
    dcl: interactive.dcl,
    load: interactive.load,
    longTasks: interactive.longTasks,
    longTaskMs: interactive.longTaskMs,
    transferKB: kb,
    apis: content.apis
  };
}

async function runStartup(run) {
  const { context, page } = await newSession();
  try {
    const cold = await measureLoad(page, { transfer: true });
    results.startup.cold.push(cold);
    observe(cold.apis);
    if (run === 0) results.startupApis = cold.apis;
    const warm = await measureLoad(page, { transfer: true });
    results.startup.warm.push(warm);
    log(`  inicio: frío FCP ${r1(cold.fcp)} · app ${r1(cold.shell)} · datos ${r1(cold.dashboardData)} · TTI ${r1(cold.tti)} · TBT ${r1(cold.tbt)} | caliente datos ${r1(warm.dashboardData)} · TTI ${r1(warm.tti)}`);
  } finally {
    await context.close();
  }
}

async function runViews(run) {
  const { context, page } = await newSession();
  try {
    await openApp(page);
    await sleep(2000);
    for (const pass of ['first', 'second']) {
      for (const key of VIEW_ORDER) {
        const result = await switchView(page, key);
        (results.views[pass][key] ||= []).push(result);
        observe(result.apis);
        if (run === 0 && pass === 'first') results.viewApis[key] = (result.apis || []).map(item => `${item.method} ${item.url} ${item.ms ?? '-'} ms`);
        if (!result.ok) results.errors.push({ section: `views.${pass}.${key}`, run, message: result.reason });
        await sleep(400);
      }
    }
    const line = pass => VIEW_ORDER.map(key => `${key} ${r1(results.views[pass][key].at(-1)?.ms) ?? '×'}`).join(' · ');
    log(`  pantallas 1ª: ${line('first')}`);
    log(`  pantallas 2ª: ${line('second')}`);
  } finally {
    await context.close();
  }
}

async function runPeople(run, terms) {
  const { context, page } = await newSession();
  try {
    await openApp(page);
    const opened = await switchView(page, 'loans');
    if (!opened.ok) throw new Error(`Préstamos no cargó: ${opened.reason}`);
    let input = await findField(page, 'person');
    if (!input) {
      // Rediseño: el formulario de préstamo (con el campo Persona) se despliega
      // recién al elegir un equipo disponible. Se escribe la etiqueta de uno en
      // el campo de código y se espera a que aparezca el formulario.
      const code = await findField(page, 'code');
      const free = (await api.devices()).find(item => loanState(item.estado) === 'available');
      if (code && free) {
        await clearAndType(page, code, free.etiqueta);
        const t = await page.evaluate(() => window.__bench.lastInput('keydown'));
        await settle(page, { since: t, quiet: 400, timeout: 10000 });
        input = await findField(page, 'person');
      }
    }
    if (!input) throw new Error('No encontré el campo de persona en Préstamos.');
    const parts = [];
    for (const { kind, term } of terms) {
      await clearAndType(page, input, '');
      await sleep(800);
      // Solo cuentan como "viejas" las opciones que se ven ahora: una lista plegada
      // que React reusa (misma persona en dos búsquedas) vuelve a valer al desplegarse.
      await page.evaluate(() => { for (const element of document.querySelectorAll('li, [role="option"]')) element.__benchOld = window.__bench.visible(element); });
      await input.focus();
      await page.keyboard.type(term);
      const result = await page.evaluate((query, expectNone) => new Promise(resolve => {
        const B = window.__bench;
        const since = B.lastInput('keydown');
        const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
        const q = norm(query);
        const field = document.activeElement;
        const fieldRect = field ? field.getBoundingClientRect() : null;
        const fresh = () => [...document.querySelectorAll('li, [role="option"]')].filter(element => !element.__benchOld && B.visible(element)
          && (!fieldRect || Math.abs(element.getBoundingClientRect().top - fieldRect.bottom) < 520));
        const apiFor = () => B.api.filter(record => record.start >= since - 2);
        const started = performance.now();
        const done = (ok, t, extra) => {
          const calls = apiFor();
          const call = calls.find(record => record.url.includes(encodeURIComponent(query)) || /suggest|people|persona/i.test(record.url)) || calls[0];
          resolve({
            ok, ms: t != null ? t - since : null,
            apiMs: call && call.end ? call.end - call.start : null,
            waitBeforeApiMs: call ? call.start - since : null,
            apiUrl: call ? call.url : null,
            shown: fresh().filter(element => norm(element.textContent).includes(q)).length,
            apis: calls.map(record => ({ url: record.url, method: record.method, status: record.status, ms: record.end ? Math.round(record.end - record.start) : null })),
            ...extra
          });
        };
        const tick = () => {
          const elapsed = performance.now() - started;
          if (!expectNone) {
            if (fresh().some(element => norm(element.textContent).includes(q))) { B.afterPaint(t => done(true, t)); return; }
          } else {
            const calls = apiFor();
            if (calls.length && calls.every(record => record.end)) {
              const end = Math.max(...calls.map(record => record.end));
              B.afterPaint(t => done(fresh().filter(element => norm(element.textContent).includes(q)).length === 0, Math.max(t, end)));
              return;
            }
            if (!calls.length && elapsed > 2500) {
              B.waitSettled({ since, quiet: 400, timeout: 5000, requireChange: false }).then(settled => done(settled.ok, settled.ok ? since + settled.ms : null, { note: 'sin pedido a la API' }));
              return;
            }
          }
          if (elapsed > 10000) { done(false, null, { reason: 'no aparecieron sugerencias' }); return; }
          requestAnimationFrame(tick);
        };
        tick();
      }), term, kind === 'sin resultados');
      (results.people[kind] ||= { term, samples: [] }).samples.push(result);
      if (result.apiUrl) results.observedApis.add(result.apiUrl);
      parts.push(`${term} ${r1(result.ms) ?? '×'}`);
      if (!result.ok) results.errors.push({ section: `people.${kind}`, run, message: result.reason || 'falló' });
    }
    await clearAndType(page, input, '');
    log(`  personas: ${parts.join(' · ')} ms`);
  } finally {
    await context.close();
  }
}

async function runDevicesAndHistory(run, deviceTerm) {
  const { context, page } = await newSession();
  try {
    await openApp(page);
    // Historial: primera página (al abrir la pantalla) y "Cargar más".
    if (ONLY.has('history') || ONLY.has('scroll')) {
      const first = await switchView(page, 'history');
      const rowsFirst = await page.evaluate(() => window.__bench.countRows());
      results.history.first.push({ ...first, rows: rowsFirst });
      let line = `historial 1ª página ${r1(first.ms) ?? '×'} ms (${rowsFirst} filas)`;
      const moreButton = await findButton(page, '^(cargar|ver) mas|anteriores', { enabled: true });
      if (moreButton) {
        await moreButton.click();
        const since = await page.evaluate(() => window.__bench.lastInput('click'));
        const more = await settle(page, { since, quiet: 500, timeout: 20000 });
        const rowsMore = await page.evaluate(() => window.__bench.countRows());
        results.history.more.push({ ...more, rowsBefore: rowsFirst, rows: rowsMore });
        observe(more.apis);
        line += ` · cargar más ${r1(more.ms) ?? '×'} ms (${rowsFirst}→${rowsMore})`;
        // Dos páginas más (sin medir) para que el scroll sea sobre una lista larga.
        for (let i = 0; i < 2; i += 1) {
          const again = await findButton(page, '^(cargar|ver) mas|anteriores', { enabled: true });
          if (!again) break;
          await again.click();
          const t = await page.evaluate(() => window.__bench.lastInput('click'));
          await settle(page, { since: t, quiet: 400, timeout: 20000 });
        }
      } else {
        results.history.more.push({ ok: false, reason: 'no hay botón "Cargar más" (¿una sola página?)', ms: null });
      }
      if (ONLY.has('scroll')) {
        const scroll = await page.evaluate(() => window.__bench.scroll({ step: 120 }));
        scroll.rows = await page.evaluate(() => window.__bench.countRows());
        results.scroll.history.push(scroll);
        line += ` · scroll p95 ${r1(scroll.p95) ?? '×'} ms (${scroll.rows} filas)`;
      }
      log(`  ${line}`);
    }
    // Dispositivos: scroll de la tabla completa y búsqueda flexible.
    if (ONLY.has('devsearch') || ONLY.has('scroll')) {
      const opened = await switchView(page, 'devices');
      if (!opened.ok) throw new Error(`Dispositivos no cargó: ${opened.reason}`);
      await sleep(500);
      let line = '';
      // La tabla puede entrar de a partes ("Ver más"): se abre entera para que
      // el scroll y el filtro trabajen sobre la lista completa.
      let expanded = 0;
      for (let i = 0; i < 15; i += 1) {
        const more = await findButton(page, '^(ver|mostrar|cargar) (mas|todos|todo)\\b', { enabled: true });
        if (!more) break;
        await more.click();
        const t = await page.evaluate(() => window.__bench.lastInput('click'));
        await settle(page, { since: t, quiet: 300, timeout: 10000 });
        expanded += 1;
      }
      if (expanded) line += `(${expanded}× "ver más") `;
      if (ONLY.has('scroll')) {
        const scroll = await page.evaluate(() => window.__bench.scroll({ step: 120 }));
        scroll.rows = await page.evaluate(() => window.__bench.countRows());
        results.scroll.devices.push(scroll);
        line += `dispositivos scroll p95 ${r1(scroll.p95) ?? '×'} ms (${scroll.rows} filas)`;
        await page.evaluate(() => { document.scrollingElement.scrollTop = 0; });
      }
      if (ONLY.has('devsearch')) {
        const input = await findField(page, 'deviceSearch');
        if (!input) throw new Error('No encontré el buscador de Dispositivos.');
        const rowsBefore = await page.evaluate(() => window.__bench.countRows());
        await input.focus();
        await page.keyboard.type(deviceTerm.term);
        const since = await page.evaluate(() => window.__bench.lastInput('keydown'));
        const result = await settle(page, { since, quiet: 500, timeout: 15000 });
        const after = await page.evaluate(tag => ({
          rows: window.__bench.countRows(),
          found: [...(document.querySelector('main') || document.body).querySelectorAll('tbody tr, [role="row"], li, article')].some(element => window.__bench.visible(element) && (element.textContent || '').includes(tag))
        }), deviceTerm.etiqueta);
        results.devsearch.push({ ...result, rowsBefore, rows: after.rows, found: after.found });
        line += ` · "${deviceTerm.term}" ${r1(result.ms) ?? '×'} ms (${rowsBefore}→${after.rows} filas, ${deviceTerm.etiqueta} ${after.found ? 'visible' : 'NO visible'})`;
        await clearAndType(page, input, '');
      }
      log(`  ${line.replace(/^ · /, '')}`);
    }
  } finally {
    await context.close();
  }
}

/** Prestar y devolver un equipo por la pantalla de Préstamos, hasta que la UI se aquieta. */
async function runOps(run, tag) {
  const { context, page } = await newSession();
  try {
    await openApp(page);
    const opened = await switchView(page, 'loans');
    if (!opened.ok) throw new Error(`Préstamos no cargó: ${opened.reason}`);
    const code = await findField(page, 'code');
    if (!code) throw new Error('No encontré el campo de código/etiqueta.');

    // Prestar.
    await clearAndType(page, code, tag);
    // Rediseño: el botón Prestar vive en el formulario que se despliega, fuera de la sección del campo de código.
    const lendButton = await waitFor(async () => (await findButton(page, '^prestar[^a-z0-9]*$', { enabled: true, near: code })) || findButton(page, '^prestar[^a-z0-9]*$', { enabled: true }), { timeout: 8000 });
    if (!lendButton) throw new Error(`No apareció "Prestar" para ${tag}.`);
    const person = await findField(page, 'person');
    if (!person) throw new Error('No encontré el campo de persona.');
    await clearAndType(page, person, 'Bench Prueba');
    await page.keyboard.press('Tab');
    const filled = [];
    filled.push(await chooseOption(page, '^rol$', '^doe$'));
    filled.push(await chooseOption(page, '^ubicacion$', '^doe$'));
    if (await page.$('[aria-label="Nivel"]')) filled.push(await chooseOption(page, '^nivel$', '^ep$'));
    if (await page.$('[aria-label="Grado, año o curso"]')) filled.push(await chooseOption(page, '^grado', '.'));
    const lendNow = (await findButton(page, '^prestar[^a-z0-9]*$', { enabled: true, near: code })) || await findButton(page, '^prestar[^a-z0-9]*$', { enabled: true });
    if (!lendNow) throw new Error(`"Prestar" se deshabilitó (campos: ${filled.join(', ')}).`);
    await lendNow.click();
    const lendSince = await page.evaluate(() => window.__bench.lastInput('click'));
    const lend = await settle(page, { since: lendSince, quiet: 600, timeout: 20000 });
    const post = (lend.apis || []).find(item => item.method === 'POST');
    const afterLend = (await api.devices()).find(item => item.etiqueta === tag);
    const lendOk = lend.ok && loanState(afterLend?.estado) === 'loaned';
    results.ops.lend.push({ ...lend, ok: lendOk, postMs: post?.ms ?? null, estado: afterLend?.estado || null, filled });
    if (!lendOk) throw new Error(`Prestar ${tag}: ${lend.reason || `quedó "${afterLend?.estado}"`}`);

    // Devolver.
    await sleep(800);
    await clearAndType(page, code, tag);
    const returnButton = await waitFor(async () => (await findButton(page, '^devolver[^a-z0-9]*$', { enabled: true, near: code })) || findButton(page, '^devolver[^a-z0-9]*$', { enabled: true }), { timeout: 8000 });
    if (!returnButton) throw new Error(`No apareció "Devolver" para ${tag}.`);
    await returnButton.click();
    const retSince = await page.evaluate(() => window.__bench.lastInput('click'));
    const ret = await settle(page, { since: retSince, quiet: 600, timeout: 20000 });
    const retPost = (ret.apis || []).find(item => item.method === 'POST');
    const afterReturn = (await api.devices()).find(item => item.etiqueta === tag);
    const retOk = ret.ok && loanState(afterReturn?.estado) === 'available';
    results.ops.ret.push({ ...ret, ok: retOk, postMs: retPost?.ms ?? null, estado: afterReturn?.estado || null });
    log(`  prestar ${tag} ${r1(lend.ms) ?? '×'} ms (POST ${post?.ms ?? '-'}) · devolver ${r1(ret.ms) ?? '×'} ms (POST ${retPost?.ms ?? '-'})`);
  } finally {
    await context.close();
    // Si algo falló a mitad de camino, que el equipo no quede prestado en la copia.
    const device = (await api.devices()).find(item => item.etiqueta === tag);
    if (loanState(device?.estado) === 'loaned') await api.post('/api/loans/return', { etiqueta: tag });
  }
}

/** API desde Node: tiempo, queries y tamaño por endpoint; ráfaga de arranque; prestar/devolver. */
async function runApi(terms, tags) {
  const counter = server.counter;
  const fixed = [...BASE_ENDPOINTS, ...terms.map(item => `/api/loans/suggest?q=${encodeURIComponent(item.term)}`)];
  const observed = [...results.observedApis].filter(url => !/[?&](before|cursor)=/.test(url));
  const urls = [...new Set([...fixed, ...observed])].slice(0, 60);
  for (const url of urls) await api.get(url); // calentar cachés del server, como en uso normal
  const endpoints = [];
  for (const url of urls) {
    const times = [];
    const queries = [];
    let last;
    for (let i = 0; i < RUNS; i += 1) {
      await counter('reset');
      last = await api.get(url);
      times.push(last.ms);
      queries.push((await counter('stats')).queries);
    }
    endpoints.push({ url, status: last.status, kb: Math.round(last.bytes / 102.4) / 10, ms: stats(times), queries: stats(queries) });
  }
  results.api.endpoints = endpoints;

  // Ráfaga de arranque: los GET que pidió el navegador al abrir, 6 a la vez.
  const burstUrls = [...new Set((results.startupApis || []).filter(item => item.method === 'GET').map(item => item.url))];
  const burstList = burstUrls.length ? burstUrls : BASE_ENDPOINTS.slice(0, 12);
  const burstTimes = [];
  const burstQueries = [];
  for (let i = 0; i < RUNS; i += 1) {
    await counter('reset');
    const started = performance.now();
    const queue = [...burstList];
    await Promise.all(Array.from({ length: 6 }, async () => { while (queue.length) await api.get(queue.shift()); }));
    burstTimes.push(performance.now() - started);
    burstQueries.push((await counter('stats')).queries);
  }
  results.api.burst = { urls: burstList, ms: stats(burstTimes), queries: stats(burstQueries) };

  // Prestar y devolver por API hasta verlo en /api/devices.
  const lend = [];
  const ret = [];
  const lendQ = [];
  const retQ = [];
  for (let i = 0; i < RUNS; i += 1) {
    const tag = tags[(i + RUNS) % tags.length];
    await counter('reset');
    let started = performance.now();
    const lent = await api.post('/api/loans/lend', { etiqueta: tag, person: 'Bench', role: 'Otro', location: 'DOE' });
    const seenLoaned = loanState((await api.devices()).find(item => item.etiqueta === tag)?.estado) === 'loaned';
    lend.push(lent.status < 300 && seenLoaned ? performance.now() - started : NaN);
    lendQ.push((await counter('stats')).queries);
    await counter('reset');
    started = performance.now();
    const back = await api.post('/api/loans/return', { etiqueta: tag });
    const seenBack = loanState((await api.devices()).find(item => item.etiqueta === tag)?.estado) === 'available';
    ret.push(back.status < 300 && seenBack ? performance.now() - started : NaN);
    retQ.push((await counter('stats')).queries);
  }
  results.api.ops = { lend: { ms: stats(lend), queries: stats(lendQ) }, ret: { ms: stats(ret), queries: stats(retQ) } };
}

/** Tamaños del build: lo que pide index.html (crítico) y el total de dist/assets. */
function measureSizes(root) {
  const dist = path.join(root, 'dist');
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const gz = buffer => zlib.gzipSync(buffer, { level: 6 }).length;
  const entry = (file, kind) => {
    const full = path.join(dist, file.replace(/^\//, ''));
    if (!fs.existsSync(full)) return null;
    const buffer = fs.readFileSync(full);
    return { file: file.replace(/^\//, ''), kind, raw: buffer.length, gzip: kind === 'font' ? buffer.length : gz(buffer) };
  };
  const critical = [{ file: 'index.html', kind: 'html', raw: Buffer.byteLength(html), gzip: gz(Buffer.from(html)) }];
  const seen = new Set();
  const add = (file, kind) => { if (seen.has(file)) return; seen.add(file); const item = entry(file, kind); if (item) critical.push(item); };
  for (const match of html.matchAll(/<script[^>]*src="([^"]+)"/g)) add(match[1], 'js');
  for (const match of html.matchAll(/<link[^>]*>/g)) {
    const tag = match[0];
    const href = /href="([^"]+)"/.exec(tag)?.[1];
    if (!href || /^https?:/.test(href)) continue;
    if (/rel="modulepreload"/.test(tag)) add(href, 'js');
    else if (/rel="stylesheet"/.test(tag)) add(href, 'css');
    else if (/rel="preload"/.test(tag) && /as="font"/.test(tag)) add(href, 'font');
  }
  const sum = (list, key) => list.reduce((acc, item) => acc + item[key], 0);
  const byKind = kind => critical.filter(item => item.kind === kind);
  const assets = fs.existsSync(path.join(dist, 'assets')) ? fs.readdirSync(path.join(dist, 'assets')) : [];
  const all = ext => assets.filter(file => file.endsWith(ext)).map(file => fs.readFileSync(path.join(dist, 'assets', file)));
  const js = all('.js');
  const css = all('.css');
  const kb = bytes => Math.round(bytes / 102.4) / 10;
  return {
    critical: critical.map(item => ({ ...item, rawKB: kb(item.raw), gzipKB: kb(item.gzip) })),
    initialJsGzipKB: kb(sum(byKind('js'), 'gzip')),
    initialJsRawKB: kb(sum(byKind('js'), 'raw')),
    initialCssGzipKB: kb(sum(byKind('css'), 'gzip')),
    initialCssRawKB: kb(sum(byKind('css'), 'raw')),
    preloadFontsKB: kb(sum(byKind('font'), 'raw')),
    criticalTotalGzipKB: kb(sum(critical, 'gzip')),
    allJs: { files: js.length, rawKB: kb(js.reduce((a, b) => a + b.length, 0)), gzipKB: kb(js.reduce((a, b) => a + gz(b), 0)) },
    allCss: { files: css.length, rawKB: kb(css.reduce((a, b) => a + b.length, 0)), gzipKB: kb(css.reduce((a, b) => a + gz(b), 0)) }
  };
}

// ── Reporte ──────────────────────────────────────────────────────────────────
const fmt = s => (s && s.n ? `${s.median} / ${s.p95}` : '–');
const fmtN = s => (s && s.n ? `${s.median} / ${s.p95} (${s.n})` : '–');

function summarize(meta) {
  const pick = (list, key) => stats((list || []).map(item => (item && item.ok !== false ? item[key] : NaN)).map(value => (value == null ? NaN : value)));
  const pickAny = (list, key) => stats((list || []).map(item => (item?.[key] == null ? NaN : item[key])));
  const summary = { startup: {}, views: {}, people: {}, devsearch: null, history: {}, scroll: {}, ops: {} };
  for (const mode of ['cold', 'warm']) {
    const list = results.startup[mode];
    summary.startup[mode] = {
      fcp: pickAny(list, 'fcp'), shell: pickAny(list, 'shell'), dashboardData: pickAny(list, 'dashboardData'),
      tti: pickAny(list, 'tti'), tbt: pickAny(list, 'tbt'), dcl: pickAny(list, 'dcl'), longTaskMs: pickAny(list, 'longTaskMs'),
      transferKB: list[0]?.transferKB || null
    };
  }
  for (const [key] of VIEWS) {
    summary.views[key] = {
      firstResponse: pickAny(results.views.first[key], 'firstChangeMs'), firstContent: pick(results.views.first[key], 'ms'),
      secondResponse: pickAny(results.views.second[key], 'firstChangeMs'), secondContent: pick(results.views.second[key], 'ms'),
      failures: [...(results.views.first[key] || []), ...(results.views.second[key] || [])].filter(item => !item.ok).length
    };
  }
  for (const [kind, data] of Object.entries(results.people)) {
    summary.people[kind] = {
      term: data.term, expected: meta.terms.find(item => item.kind === kind)?.expected,
      visible: pick(data.samples, 'ms'), apiInBrowser: pickAny(data.samples, 'apiMs'), waitBeforeApi: pickAny(data.samples, 'waitBeforeApiMs'),
      shown: pickAny(data.samples, 'shown'), apiUrl: data.samples.find(item => item.apiUrl)?.apiUrl || null,
      failures: data.samples.filter(item => !item.ok).length
    };
  }
  summary.devsearch = { ms: pick(results.devsearch, 'ms'), rowsBefore: pickAny(results.devsearch, 'rowsBefore'), rows: pickAny(results.devsearch, 'rows'), found: results.devsearch.filter(item => item.found).length, n: results.devsearch.length };
  summary.history = { first: pick(results.history.first, 'ms'), firstRows: pickAny(results.history.first, 'rows'), more: pick(results.history.more, 'ms'), moreRows: pickAny(results.history.more, 'rows') };
  for (const list of ['devices', 'history']) {
    const samples = results.scroll[list].filter(item => item.ok);
    summary.scroll[list] = { p95: stats(samples.map(item => item.p95)), p50: stats(samples.map(item => item.p50)), worst: stats(samples.map(item => item.worst)), over50: stats(samples.map(item => item.over50)), frames: stats(samples.map(item => item.frames)), rows: stats(samples.map(item => item.rows)), scroller: samples[0]?.scroller || null };
  }
  summary.ops = { lend: pick(results.ops.lend, 'ms'), lendPost: pickAny(results.ops.lend, 'postMs'), ret: pick(results.ops.ret, 'ms'), retPost: pickAny(results.ops.ret, 'postMs') };
  return summary;
}

function markdown(meta, summary) {
  const lines = [];
  const row = cells => lines.push(`| ${cells.join(' | ')} |`);
  lines.push(`# Benchmark ${label}`, '');
  lines.push(`Checkout \`${meta.git.describe}\` (${meta.git.sha.slice(0, 7)}${meta.git.branch ? `, ${meta.git.branch}` : ''}) · ${meta.date} · generado por \`perf/suite.mjs\`.`, '');
  lines.push(`**Condiciones:** ${meta.runs} corridas por métrica · CPU ${meta.cpu}× más lenta · red simulada ${meta.net.rtt} ms RTT, ${meta.net.down} Mbps bajada, ${meta.net.up} Mbps subida · ${meta.latency} ms sincrónicos por query en el server (simula Supabase) · Chrome ${meta.browserVersion} headless, ${VIEWPORT.width}×${VIEWPORT.height} · Node ${meta.node} · ${meta.cpuModel}. Una pasada de calentamiento sin registrar antes de las corridas; cada medición en un contexto de navegador nuevo, sin service worker.`);
  lines.push(`**Datos (copia de la base, sede ${SITE}):** ${meta.dataset.devices} equipos, ${meta.dataset.loanEvents} eventos de préstamo, ${meta.dataset.movements} movimientos, ${meta.dataset.tasks ?? '?'} tareas, ${meta.dataset.agenda ?? '?'} actividades de agenda, ${meta.dataset.tickets ?? '?'} tickets.`, '');
  lines.push('Valores en ms: **mediana / p95** (p95 por rango más cercano; con n = 7 coincide con el máximo). Entre paréntesis, el tamaño de muestra válida. "–" = no se pudo medir (ver Fallas).', '');

  const s = summary.startup;
  lines.push('## Inicio de la aplicación', '');
  row(['Métrica', 'Frío (sin caché)', 'Caliente (recarga con caché)']);
  row(['---', '---:', '---:']);
  row(['FCP (primer pintado con contenido)', fmtN(s.cold.fcp), fmtN(s.warm.fcp)]);
  row(['App visible (navegación + main pintados)', fmtN(s.cold.shell), fmtN(s.warm.shell)]);
  row(['Dashboard con datos (todos los pedidos terminados y pantalla quieta)', fmtN(s.cold.dashboardData), fmtN(s.warm.dashboardData)]);
  row(['Interactiva (TTI: 5 s sin tareas largas)', fmtN(s.cold.tti), fmtN(s.warm.tti)]);
  row(['TBT (FCP → TTI)', fmtN(s.cold.tbt), fmtN(s.warm.tbt)]);
  row(['Tareas largas totales (ms)', fmtN(s.cold.longTaskMs), fmtN(s.warm.longTaskMs)]);
  row(['DOMContentLoaded', fmtN(s.cold.dcl), fmtN(s.warm.dcl)]);
  if (s.cold.transferKB) {
    const kbLine = obj => Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).map(([type, kb]) => `${type} ${kb}`).join(', ');
    row(['Transferido hasta TTI (KB, corrida 1)', kbLine(s.cold.transferKB), kbLine(s.warm.transferKB)]);
  }
  lines.push('');

  lines.push('## Cambio de módulo', '');
  lines.push('Click en la navegación → **respuesta** (primer frame con un cambio en `<main>`) y **contenido** (datos cargados y pantalla quieta). 1ª vez = primera visita en la sesión (puede bajar el chunk); 2ª = volver a una pantalla ya vista.', '');
  row(['Pantalla', '1ª respuesta', '1ª contenido', '2ª respuesta', '2ª contenido', 'Fallas']);
  row(['---', '---:', '---:', '---:', '---:', '---:']);
  for (const [key, name] of VIEWS) {
    const v = summary.views[key];
    row([name, fmt(v.firstResponse), fmtN(v.firstContent), fmt(v.secondResponse), fmtN(v.secondContent), String(v.failures)]);
  }
  lines.push('');

  lines.push('## Búsqueda rápida de personas (Préstamos)', '');
  lines.push(`Se tipean 3 letras seguidas en el campo Persona; se mide desde la 3ª tecla hasta el frame pintado con la sugerencia en pantalla. Hoy: \`LoanForm\` espera ${meta.peopleDebounceNote} y pide \`${summary.people['común']?.apiUrl?.split('?')[0] || '/api/loans/suggest'}\`; el server lee todo \`loan_events\` de la sede y filtra en JS.`, '');
  row(['Caso', 'Término', 'Personas que coinciden', 'Visible en pantalla', 'Espera antes del pedido', 'Pedido (navegador)', 'Endpoint (Node)', 'Fallas']);
  row(['---', '---', '---:', '---:', '---:', '---:', '---:', '---:']);
  for (const [kind, p] of Object.entries(summary.people)) {
    const endpoint = (results.api.endpoints || []).find(item => item.url === `/api/loans/suggest?q=${encodeURIComponent(p.term)}`);
    row([kind, `\`${p.term}\``, String(p.expected ?? '?'), fmtN(p.visible), fmt(p.waitBeforeApi), fmt(p.apiInBrowser), endpoint ? `${fmt(endpoint.ms)} · ${endpoint.queries.median} q` : '–', String(p.failures)]);
  }
  lines.push('', 'En "sin resultados" la columna visible mide hasta que llega la respuesta vacía y se pinta el frame siguiente.', '');

  lines.push('## Búsqueda flexible de equipos (Dispositivos)', '');
  const d = summary.devsearch;
  lines.push(`\`${meta.deviceTerm.term}\` (debería encontrar ${meta.deviceTerm.etiqueta}): **${fmtN(d.ms)}** ms desde la última tecla hasta que la tabla se aquieta · filas ${d.rowsBefore.median ?? '?'} → ${d.rows.median ?? '?'} · encontrado en ${d.found}/${d.n} corridas.`, '');

  lines.push('## Historial', '');
  const h = summary.history;
  row(['Acción', 'ms', 'Filas']);
  row(['---', '---:', '---:']);
  row(['Abrir Historial (primera página)', fmtN(h.first), String(h.firstRows.median ?? '–')]);
  row(['Cargar más', fmtN(h.more), String(h.moreRows.median ?? '–')]);
  lines.push('');

  lines.push('## Desplazamiento en listas largas', '');
  lines.push('Scroll programático de 120 px por frame, bajando y subiendo, sobre el contenedor que scrollea. Duración entre frames pintados (16,7 ms = 60 fps).', '');
  row(['Lista', 'Filas', 'Frames', 'p50 frame', 'p95 frame', 'Peor frame', 'Frames > 50 ms']);
  row(['---', '---:', '---:', '---:', '---:', '---:', '---:']);
  for (const [key, name] of [['devices', 'Dispositivos (tabla abierta entera)'], ['history', 'Historial (hasta 4 páginas)']]) {
    const sc = summary.scroll[key];
    row([name, String(sc.rows.median ?? '–'), String(sc.frames.median ?? '–'), fmt(sc.p50), fmtN(sc.p95), fmt(sc.worst), fmt(sc.over50)]);
  }
  lines.push('');

  lines.push('## Operaciones frecuentes', '');
  const o = summary.ops;
  row(['Operación', 'UI: click → pantalla quieta', 'POST (navegador)', 'API desde Node (POST + ver en /api/devices)', 'Queries']);
  row(['---', '---:', '---:', '---:', '---:']);
  row(['Prestar uno', fmtN(o.lend), fmt(o.lendPost), fmt(results.api.ops?.lend.ms), fmt(results.api.ops?.lend.queries)]);
  row(['Devolver uno', fmtN(o.ret), fmt(o.retPost), fmt(results.api.ops?.ret.ms), fmt(results.api.ops?.ret.queries)]);
  lines.push('');

  if (results.api.endpoints) {
    lines.push('## API (desde Node, sin red simulada)', '');
    lines.push(`Cada endpoint ${RUNS} veces con las cachés del server calientes. Ráfaga de arranque (los GET que pide la app al abrir, 6 en paralelo): **${fmtN(results.api.burst.ms)}** ms, ${results.api.burst.queries.median} queries.`, '');
    row(['Endpoint', 'Estado', 'ms', 'Queries', 'KB']);
    row(['---', '---:', '---:', '---:', '---:']);
    for (const item of results.api.endpoints) row([`\`${item.url}\``, String(item.status), fmt(item.ms), String(item.queries.median), String(item.kb)]);
    lines.push('');
  }

  if (results.sizes.critical) {
    const z = results.sizes;
    lines.push('## Tamaños del build', '');
    row(['Recurso', 'Crudo (KB)', 'gzip (KB)']);
    row(['---', '---:', '---:']);
    row(['JS inicial (entry + modulepreload)', String(z.initialJsRawKB), String(z.initialJsGzipKB)]);
    row(['CSS inicial', String(z.initialCssRawKB), String(z.initialCssGzipKB)]);
    row(['Fuentes precargadas', String(z.preloadFontsKB), String(z.preloadFontsKB)]);
    row(['**Total crítico** (HTML + JS + CSS + fuentes precargadas)', '', `**${z.criticalTotalGzipKB}**`]);
    row([`Todo el JS de dist/assets (${z.allJs.files} archivos)`, String(z.allJs.rawKB), String(z.allJs.gzipKB)]);
    row([`Todo el CSS de dist/assets (${z.allCss.files} archivos)`, String(z.allCss.rawKB), String(z.allCss.gzipKB)]);
    lines.push('', `Crítico: ${z.critical.map(item => `\`${item.file}\` ${item.gzipKB} KB`).join(', ')}.`, '');
  }

  lines.push('## Fallas', '');
  if (!results.errors.length) lines.push('Ninguna.');
  else for (const error of results.errors) lines.push(`- ${error.section} (corrida ${error.run + 1}): ${error.message}`);
  lines.push('');

  lines.push('## Cómo reproducir', '');
  lines.push('```bash');
  lines.push(`node perf/suite.mjs --repo=<checkout> --label=${label} --runs=${meta.runs} --cpu=${meta.cpu} --latency=${meta.latency} --rtt=${meta.net.rtt} --down=${meta.net.down} --up=${meta.net.up}`);
  lines.push('```', '');
  lines.push('Para medir otra rama sin tocar el repo principal: `git worktree add <tmp> <rama>`, junction de `node_modules` (`cmd /c mklink /J node_modules <repo>\\node_modules`), correr la suite con `--repo=<tmp>` y `git worktree remove --force <tmp>`. Usá la misma base (`--db=<snapshot>`) en todas las etiquetas que quieras comparar.');
  lines.push('');
  return lines.join('\n');
}

// ── Principal ────────────────────────────────────────────────────────────────
const started = Date.now();
let env;
const meta = {};
try {
  meta.label = label;
  meta.date = new Date().toISOString();
  meta.repo = repo;
  meta.git = { sha: git(repo, 'rev-parse', 'HEAD'), branch: git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'), describe: git(repo, 'log', '-1', '--format=%h %s') };
  meta.runs = RUNS; meta.cpu = CPU; meta.latency = LATENCY; meta.net = NET; meta.viewport = VIEWPORT;
  meta.node = process.version; meta.cpuModel = `${os.cpus()[0]?.model?.trim()} ×${os.cpus().length}`; meta.os = `${os.type()} ${os.release()}`;
  meta.dbSource = DB_SOURCE;
  meta.only = [...ONLY];
  meta.peopleDebounceNote = '220 ms (debounce)';
  log(`checkout ${meta.git.describe}`);

  meta.build = ensureBuild(repo);
  if (ONLY.has('sizes')) results.sizes = measureSizes(repo);

  env = await prepareDatabase();
  meta.dataset = env.dataset;
  meta.terms = personTerms(env.people);
  server = await startServer(env);
  server.token = env.token;
  api = apiClient(server.base, env.token);
  const session = await api.get('/api/auth/session');
  if (!session.data?.authenticated) throw new Error(`La sesión de prueba no autentica: ${JSON.stringify(session.data).slice(0, 300)}`);
  await server.counter('reset');
  await api.get('/api/site-settings');
  if (!(await server.counter('stats')).queries) throw new Error('El preload de latencia no está contando queries (¿otro better-sqlite3?).');
  releaseVersion = (await api.get('/api/release-notes/latest')).data?.release?.version || '';
  log(`server ${server.base} · copia ${env.dbCopy} · superadmin ${env.admin.email}`);

  const devices = await api.devices();
  const available = devices.filter(item => loanState(item.estado) === 'available').map(item => item.etiqueta);
  if (available.length < 3) throw new Error('La copia tiene menos de 3 equipos disponibles.');
  const opsTags = available.slice(0, Math.max(RUNS * 2, 2));
  const touch = devices.find(item => /^touch\s*34$/i.test(String(item.alias || item.aliasOperativo || `${item.filtro || ''} ${item.numeroOperativo || item.numero_operativo || ''}`).trim()))
    || devices.find(item => item.etiqueta === 'D1436');
  meta.deviceTerm = { term: 'touch 34', etiqueta: touch?.etiqueta || 'D1436' };
  log(`términos de personas: ${meta.terms.map(item => `${item.kind} "${item.term}" (${item.expected})`).join(' · ')}`);

  browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: !flag('headful'),
    args: ['--no-first-run', '--disable-extensions', '--no-default-browser-check', `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']
  });
  meta.browserVersion = (await browser.version()).replace(/^[^/]*\//, '');

  // Calentamiento sin registrar: JIT del server y del navegador, caché de disco
  // del sistema. Cada medición usa después un contexto nuevo (caché HTTP vacía).
  log('calentamiento (no se registra)');
  {
    const { context, page } = await newSession();
    try {
      await openApp(page);
      for (const key of VIEW_ORDER) await switchView(page, key);
    } catch (error) {
      log(`  ! calentamiento: ${error instanceof Error ? error.message : error}`);
    } finally {
      await context.close();
    }
  }

  for (let run = 0; run < RUNS; run += 1) {
    log(`corrida ${run + 1}/${RUNS}`);
    if (ONLY.has('startup')) await runStartup(run).catch(error => fail('startup', run, error));
    if (ONLY.has('views')) await runViews(run).catch(error => fail('views', run, error));
    if (ONLY.has('people')) await runPeople(run, meta.terms).catch(error => fail('people', run, error));
    if (ONLY.has('history') || ONLY.has('scroll') || ONLY.has('devsearch')) await runDevicesAndHistory(run, meta.deviceTerm).catch(error => fail('devices/history', run, error));
    if (ONLY.has('ops')) await runOps(run, opsTags[run % opsTags.length]).catch(error => fail('ops', run, error));
  }
  await browser.close();
  browser = null;

  if (ONLY.has('api')) {
    log('API desde Node...');
    await runApi(meta.terms, opsTags);
  }
} catch (error) {
  results.errors.push({ section: 'entorno', run: -1, message: error instanceof Error ? error.stack || error.message : String(error) });
  console.error(`[suite ${label}] No se pudo completar: ${error instanceof Error ? error.message : error}`);
  if (server) console.error(server.getLog().slice(-3000));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopServer(server);
  if (env && !flag('keep')) await removeTmp(env.tmpDir);
}

meta.totalSeconds = Math.round((Date.now() - started) / 1000);
const summary = summarize({ ...meta, terms: meta.terms || [] });
const raw = { meta, summary, results: { ...results, observedApis: [...results.observedApis] } };
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, `${label}.json`), JSON.stringify(raw, null, 2));
if (meta.dataset) fs.writeFileSync(path.join(OUT_DIR, `${label}.md`), markdown(meta, summary));
log(`listo en ${meta.totalSeconds} s → ${path.join(OUT_DIR, `${label}.json`)} y .md`);
