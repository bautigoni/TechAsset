// Graba respuestas reales de la API (sobre una COPIA de data/techasset.db) en un
// JSON, para que el banco de pruebas del frontend (perf-harness) abra la app con
// datos verdaderos sin servidor ni sesión en el navegador.
//
//   npx -p node@22 node server/scripts/bench/record-api.mjs <salida.json>
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const out = path.resolve(process.argv[2] || 'api-fixtures.json');
const PORT = 8033;
const SITE = process.env.BENCH_SITE || 'NFPT';
const USER_ID = Number(process.env.BENCH_USER_ID || 2);

const ENDPOINTS = [
  '/api/auth/session', '/api/site-settings', '/api/devices', '/api/movements', '/api/agenda',
  '/api/tasks?space=team', '/api/tasks?space=my', '/api/tasks?space=all', '/api/task-columns', '/api/notifications',
  '/api/user/prefs', '/api/release-notes/latest', '/api/internal-notes?filter=all', '/api/internal-notes?filter=important',
  '/api/daily-closures', '/api/daily-closures/preview', '/api/loans/previous-day', '/api/photo-passes',
  '/api/photo-passes/options', '/api/quick-links', '/api/recess-schedules', '/api/teacher-schedules', '/api/settings/shifts',
  '/api/sites', '/api/analytics', '/api/analytics/parque', '/api/classrooms', '/api/classrooms/summary',
  '/api/classroom-categories', '/api/device-categories', '/api/device-groups', '/api/devices/review-queue',
  '/api/inventory/items', '/api/tickets', '/api/ticket-templates', '/api/petty-cash', '/api/suggestions',
  '/api/reminders', '/api/lifecycle/defaults', '/api/agenda/history', '/api/tasks/history', '/api/tasks/analytics',
  '/api/notifications/prefs', '/api/site-assistants', '/api/agenda/upcoming', '/api/push/vapid-public-key'
];

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'techasset-record-'));
const dbCopy = path.join(tmpDir, 'record.db');
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
const child = spawn(process.execPath, ['server/index.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), SQLITE_DB_PATH: dbCopy, DB_DRIVER: 'sqlite', DATABASE_URL: '', MODO_PRUEBA: 'true', SMTP_SERVER: '', SMTP_USER: '', SMTP_APP_PASSWORD: '', RESEND_API_KEY: '', GOOGLE_SHEET_CSV_URL: '' },
  stdio: 'ignore'
});
const headers = { cookie: `${process.env.SESSION_COOKIE_NAME || 'techasset_session'}=${token}`, 'X-Site-Code': SITE };
try {
  for (let i = 0; i < 120; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) break; } catch { /* arrancando */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const fixtures = {};
  for (const url of ENDPOINTS) {
    const response = await fetch(`http://127.0.0.1:${PORT}${url}`, { headers });
    const text = await response.text();
    try { fixtures[url] = { status: response.status, body: JSON.parse(text) }; } catch { /* no JSON */ }
  }
  fs.writeFileSync(out, JSON.stringify(fixtures));
  console.log(`Grabadas ${Object.keys(fixtures).length} respuestas en ${out}`);
} finally {
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill();
  await exited;
  for (let i = 0; i < 20; i += 1) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); break; } catch { await new Promise(resolve => setTimeout(resolve, 150)); }
  }
}
