// Benchmark de la API con latencia de base simulada.
//
//   npx -p node@22 node server/scripts/bench/bench-api.mjs [latenciaMs=15] [corridas=7]
//
// Trabaja sobre una COPIA descartable de data/techasset.db (nunca la real ni
// Postgres): crea ahí una sesión de prueba para un usuario existente, levanta el
// server real en un proceso aparte con latency-preload.mjs, y mide:
//   - por endpoint: queries a la base, tiempo (mediana) y tamaño de respuesta;
//   - "arranque": los pedidos que hace la app al abrir, en paralelo como el
//     navegador (6 a la vez), hasta que llega el último.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const latency = Number(process.argv[2] ?? 15);
const runs = Number(process.argv[3] ?? 7);
const PORT = 8031;
const STATS_PORT = 8032;
const SITE = process.env.BENCH_SITE || 'NFPT';
const USER_ID = Number(process.env.BENCH_USER_ID || 2);

const ENDPOINTS = [
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
  '/api/daily-closures/preview',
  '/api/loans/previous-day',
  '/api/photo-passes'
];

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'techasset-bench-'));
const dbCopy = path.join(tmpDir, 'bench.db');
const source = new Database(path.join(root, 'data', 'techasset.db'), { readonly: true });
await source.backup(dbCopy);
source.close();

const token = crypto.randomBytes(32).toString('hex');
{
  const db = new Database(dbCopy);
  const now = new Date().toISOString();
  db.prepare('INSERT INTO user_sessions (token, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
    .run(token, USER_ID, now, new Date(Date.now() + 86400000).toISOString(), now);
  db.close();
}

const child = spawn(process.execPath, ['--import', pathToFileURL(path.join(here, 'latency-preload.mjs')).href, 'server/index.js'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(PORT),
    BENCH_STATS_PORT: String(STATS_PORT),
    BENCH_LATENCY_MS: String(latency),
    SQLITE_DB_PATH: dbCopy,
    DB_DRIVER: 'sqlite',
    DATABASE_URL: '',
    MODO_PRUEBA: 'true',
    SMTP_SERVER: '', SMTP_USER: '', SMTP_APP_PASSWORD: '', RESEND_API_KEY: '',
    DEBUG_DEVICE_PERF: '',
    GOOGLE_SHEET_CSV_URL: ''
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverLog = '';
child.stdout.on('data', chunk => { serverLog += chunk; });
child.stderr.on('data', chunk => { serverLog += chunk; });

const cookieName = process.env.SESSION_COOKIE_NAME || 'techasset_session';
const headers = { cookie: `${cookieName}=${token}`, 'X-Site-Code': SITE, Accept: 'application/json' };
const stats = async op => (await fetch(`http://127.0.0.1:${STATS_PORT}/${op}`)).json();

async function waitReady() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (response.ok) return;
    } catch { /* todavía no */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`El server no arrancó:\n${serverLog}`);
}

async function hit(url) {
  const started = performance.now();
  const response = await fetch(`http://127.0.0.1:${PORT}${url}`, { headers });
  const body = await response.arrayBuffer();
  return { ms: performance.now() - started, status: response.status, bytes: body.byteLength };
}

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

try {
  await waitReady();
  // Calentar caches del server (inventario, settings) como en uso normal.
  for (const url of ENDPOINTS) await hit(url);

  const rows = [];
  for (const url of ENDPOINTS) {
    const times = [];
    let queries = 0;
    let last;
    for (let i = 0; i < runs; i += 1) {
      await stats('reset');
      last = await hit(url);
      times.push(last.ms);
      queries = (await stats('stats')).queries;
    }
    rows.push({ url, status: last.status, queries, ms: median(times), kb: last.bytes / 1024 });
  }

  // Arranque: todo junto, con el límite de 6 conexiones por host del navegador.
  const bursts = [];
  for (let i = 0; i < runs; i += 1) {
    await stats('reset');
    const started = performance.now();
    const queue = [...ENDPOINTS];
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (queue.length) await hit(queue.shift());
    }));
    bursts.push({ ms: performance.now() - started, queries: (await stats('stats')).queries });
  }

  console.log(`\nLatencia simulada por query: ${latency} ms · ${runs} corridas · sede ${SITE}\n`);
  console.log('endpoint'.padEnd(36), 'st', 'queries'.padStart(8), 'ms(med)'.padStart(9), 'KB'.padStart(8));
  for (const row of rows) {
    console.log(row.url.padEnd(36), String(row.status), String(row.queries).padStart(8), row.ms.toFixed(1).padStart(9), row.kb.toFixed(1).padStart(8));
  }
  const total = rows.reduce((acc, row) => ({ queries: acc.queries + row.queries, kb: acc.kb + row.kb }), { queries: 0, kb: 0 });
  console.log('TOTAL'.padEnd(36), '  ', String(total.queries).padStart(8), ''.padStart(9), total.kb.toFixed(1).padStart(8));
  console.log(`\nArranque (13 pedidos, 6 en paralelo): ${median(bursts.map(b => b.ms)).toFixed(0)} ms (mediana), ${bursts[0].queries} queries`);

  // Correctitud de las cachés: prestar y devolver (en la copia) tiene que verse
  // al instante en /api/devices, sin esperar ningún TTL.
  const send = (url, body) => fetch(`http://127.0.0.1:${PORT}${url}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
  const estadoDe = async tag => (await (await fetch(`http://127.0.0.1:${PORT}/api/devices`, { headers })).json()).items.find(item => item.etiqueta === tag)?.estado;
  const devices = (await (await fetch(`http://127.0.0.1:${PORT}/api/devices`, { headers })).json()).items;
  const libre = devices.find(item => /disponible|devuelto|^$/i.test(String(item.estado || '').trim()));
  if (libre) {
    const lend = await send('/api/loans/lend', { etiqueta: libre.etiqueta, person: 'Bench', role: 'Otro', location: 'DOE' });
    const afterLend = await estadoDe(libre.etiqueta);
    const ret = await send('/api/loans/return', { etiqueta: libre.etiqueta });
    const afterReturn = await estadoDe(libre.etiqueta);
    const ok = lend.ok && ret.ok && /prest/i.test(afterLend || '') && !/prest/i.test(afterReturn || '');
    console.log(`Verificación caché: prestar ${libre.etiqueta} -> "${afterLend}", devolver -> "${afterReturn}" => ${ok ? 'OK' : 'FALLA'}`);
    if (!ok) process.exitCode = 1;
  }
} finally {
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill();
  await exited;
  // En Windows el archivo puede seguir tomado unos ms después de que el proceso muere.
  for (let i = 0; i < 20; i += 1) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); break; } catch { await new Promise(resolve => setTimeout(resolve, 150)); }
  }
}
