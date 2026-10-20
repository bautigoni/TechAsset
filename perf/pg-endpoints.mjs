// Consultas por pedido contra un Postgres REAL con el volumen del snapshot.
//
//   docker run -d --rm --name techasset-pgq -e POSTGRES_PASSWORD=pgtest -e POSTGRES_DB=techasset \
//     -p 127.0.0.1:55460:5432 postgres:17-alpine -c shared_preload_libraries=pg_stat_statements
//   PG_TEST_URL="postgresql://postgres:pgtest@127.0.0.1:55460/techasset?sslmode=disable" \
//     node perf/pg-endpoints.mjs --repo=<checkout> [--db=<snapshot>]
//
// 1. Carga el snapshot de SQLite en ese Postgres con migrate_to_postgres.cjs
//    (DROP + CREATE + datos: base descartable). 2. Levanta el server del
//    checkout contra él (pg-sync, como producción). 3. Para cada endpoint de las
//    pantallas: vacía pg_stat_statements, hace el pedido 2 veces (frío y con las
//    cachés del server calientes) y cuenta las consultas que llegaron a la base
//    y su tiempo de ejecución. Así se ven los N+1 con datos de verdad.
// Nunca apuntarlo a producción (se niega con supabase/pooler en la URL).
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { freePort, snapshotDatabase } from '../e2e/lib/env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.PG_TEST_URL;
if (!url || /supabase|pooler|amazonaws/i.test(url)) { console.error('PG_TEST_URL tiene que ser un Postgres local de pruebas.'); process.exit(2); }
const option = (name, fallback) => { const found = process.argv.slice(2).find(arg => arg.startsWith(`--${name}=`)); return found ? found.slice(name.length + 3) : fallback; };
const repo = path.resolve(option('repo', path.join(here, '..')));
const DB = path.resolve(option('db', path.join(here, '..', 'docs', 'redesign', 'bench', 'snapshot.db')));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const ENDPOINTS = [
  // Arranque y polling
  '/api/auth/session', '/api/site-settings', '/api/devices', '/api/movements', '/api/agenda', '/api/tasks?space=all', '/api/notifications', '/api/user/prefs',
  '/api/release-notes/latest', '/api/internal-notes?filter=active', '/api/quick-links', '/api/tools/config', '/api/recess-schedules', '/api/settings/shifts',
  // Pantallas del barrido
  '/api/tickets', '/api/classrooms', '/api/inventory', '/api/knowledge', '/api/reminders', '/api/canvas', '/api/schedules', '/api/petty-cash', '/api/suggestions',
  '/api/site-assistants', '/api/task-columns', '/api/devices/panel-counts', '/api/device-groups', '/api/devices/deleted',
  '/api/history?kind=loans&limit=50', '/api/history?kind=all&limit=50', '/api/loans/people', '/api/loans/suggest?q=mar', '/api/loans/previous-day',
  '/api/photo-passes/options', '/api/daily-closures', '/api/daily-closures/preview', '/api/analytics/summary', '/api/allowed-users', '/api/sites'
];

// 1. Snapshot → Postgres
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'techasset-pgq-'));
const dbCopy = path.join(tmpDir, 'pgq.db');
await snapshotDatabase(DB, dbCopy);
const load = spawnSync(process.execPath, [path.join(repo, 'migrate_to_postgres.cjs'), url], { cwd: repo, env: { ...process.env, SQLITE_PATH: dbCopy }, encoding: 'utf8' });
if (load.status !== 0) { console.error(load.stdout?.slice(-2000), load.stderr?.slice(-2000)); process.exit(1); }
const client = new pg.Client({ connectionString: url, ssl: false });
await client.connect();
await client.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
const admin = (await client.query("SELECT id FROM users WHERE rol_global='Superadmin' AND activo=1 ORDER BY id LIMIT 1")).rows[0];
const token = crypto.randomBytes(32).toString('hex');
const now = new Date().toISOString();
await client.query('INSERT INTO user_sessions (token, user_id, created_at, expires_at, last_seen_at) VALUES ($1, $2, $3, $4, $5)', [token, admin.id, now, new Date(Date.now() + 86400000).toISOString(), now]);

// 2. Server contra Postgres
const port = await freePort();
const child = spawn(process.execPath, ['server/index.js'], {
  cwd: repo,
  env: { ...process.env, PORT: String(port), SERVER_HOST: '127.0.0.1', DATABASE_URL: url, DB_DRIVER: 'postgres', MODO_PRUEBA: 'true',
    SMTP_SERVER: '', SMTP_USER: '', SMTP_APP_PASSWORD: '', RESEND_API_KEY: '', GOOGLE_SHEET_CSV_URL: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', AI_PROVIDER: 'local', VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '',
    UPLOADS_DIR: path.join(tmpDir, 'uploads'), TOOLS_TEMP_DIR: path.join(tmpDir, 'tools'), CACHE_CSV_PATH: path.join(tmpDir, 'c.csv'), DEVICES_APP_CSV_PATH: path.join(tmpDir, 'd.csv') },
  stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { output += chunk; });
const base = `http://127.0.0.1:${port}`;
let up = false;
for (let i = 0; i < 1200 && child.exitCode === null; i += 1) { try { if ((await fetch(`${base}/api/health`)).ok) { up = true; break; } } catch { /* todavía no */ } await sleep(50); }
if (!up) { console.error(output.slice(-3000)); process.exit(1); }
await sleep(3000); // arranque y primer tick de fondo

const count = async () => (await client.query(`
  SELECT COALESCE(SUM(calls),0)::int AS calls, COALESCE(SUM(total_exec_time),0)::float AS ms
  FROM pg_stat_statements WHERE query NOT ILIKE '%pg_stat_statements%' AND dbid = (SELECT oid FROM pg_database WHERE datname = current_database())`)).rows[0];
const rows = [];
try {
  for (const endpoint of ENDPOINTS) {
    const sample = [];
    for (const phase of ['frío', 'caliente']) {
      await client.query('SELECT pg_stat_statements_reset()');
      const t0 = performance.now();
      const response = await fetch(`${base}${endpoint}`, { headers: { cookie: `techasset_session=${token}`, 'X-Site-Code': 'NFPT' } });
      const body = await response.arrayBuffer();
      const ms = performance.now() - t0;
      const stat = await count();
      sample.push({ phase, status: response.status, kb: Math.round(body.byteLength / 102.4) / 10, ms: Math.round(ms), queries: stat.calls, execMs: Math.round(stat.ms * 10) / 10 });
    }
    rows.push({ endpoint, sample });
    console.log(`${endpoint}: ${sample.map(s => `${s.phase} ${s.status} ${s.queries} q (${s.execMs} ms en PG) ${s.ms} ms ${s.kb} KB`).join(' · ')}`);
  }
} finally {
  child.kill();
  await client.end();
  await sleep(300);
  for (let i = 0; i < 10; i += 1) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); break; } catch { await sleep(200); } }
}
console.log('\n| Endpoint | Estado | Consultas (frío / caliente) | Ejecución en PG ms (frío / caliente) | Respuesta ms (frío / caliente) | KB |\n| --- | ---: | ---: | ---: | ---: | ---: |');
for (const { endpoint, sample: [cold, warm] } of rows) console.log(`| \`${endpoint}\` | ${cold.status} | ${cold.queries} / ${warm.queries} | ${cold.execMs} / ${warm.execMs} | ${cold.ms} / ${warm.ms} | ${cold.kb} |`);
fs.mkdirSync(path.join(here, '.out'), { recursive: true });
fs.writeFileSync(path.join(here, '.out', 'pg-endpoints.json'), JSON.stringify(rows, null, 2));
