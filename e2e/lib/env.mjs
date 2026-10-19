// Entorno descartable para las pruebas de punta a punta:
//   - copia de data/techasset.db (nunca la real ni Postgres) con sesiones de prueba;
//   - build del front si hace falta;
//   - server real (`node server/index.js`) con todo lo externo apagado;
//   - el Chrome/Edge instalado, como en perf/run.mjs.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SITE = 'NFPT';
export const COOKIE_NAME = 'techasset_session';

// Chrome primero: en esta máquina Edge headless no arranca. E2E_BROWSER pisa la búsqueda.
const BROWSERS = [
  process.env.E2E_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);

export function findBrowser() {
  const found = BROWSERS.find(candidate => fs.existsSync(candidate));
  if (!found) throw new Error(`No encontré Chrome ni Edge. Probé: ${BROWSERS.join(', ')}. Usá E2E_BROWSER=<ruta>.`);
  return found;
}

export async function freePort() {
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

/** Lo más nuevo entre lo que entra al build del front. */
function newestSourceMtime() {
  let newest = 0;
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else newest = Math.max(newest, fs.statSync(full).mtimeMs);
    }
  };
  walk(path.join(root, 'src'));
  walk(path.join(root, 'public'));
  for (const file of ['index.html', 'vite.config.ts', 'package.json']) {
    const full = path.join(root, file);
    if (fs.existsSync(full)) newest = Math.max(newest, fs.statSync(full).mtimeMs);
  }
  return newest;
}

/**
 * mode: 'auto' (buildea si no hay dist o si quedó viejo respecto de src/),
 * 'force' (--build) o 'skip' (--no-build: usa el dist que haya, aunque esté viejo).
 * Solo `vite build`: el chequeo de tipos es de `npm run build`, no de esta prueba.
 */
export function ensureBuild(mode, log) {
  const index = path.join(root, 'dist', 'index.html');
  const exists = fs.existsSync(index);
  const stale = exists && fs.statSync(index).mtimeMs < newestSourceMtime();
  if (mode === 'skip') {
    if (!exists) throw new Error('No hay dist/ y se pidió --no-build. Corré sin el flag o `npm run build`.');
    if (stale) log('Aviso: dist/ es más viejo que src/ (se usa igual por --no-build).');
    return { built: false, stale, ms: 0 };
  }
  if (mode === 'auto' && exists && !stale) return { built: false, stale: false, ms: 0 };
  log(mode === 'force' ? 'Buildeando el front (--build)...' : exists ? 'dist/ quedó viejo respecto de src/: buildeando...' : 'No hay dist/: buildeando...');
  const started = Date.now();
  const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const result = spawnSync(process.execPath, [viteBin, 'build', '--logLevel', 'warn'], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Falló `vite build`.');
  return { built: true, stale, ms: Date.now() - started };
}

/**
 * Copia la base a un temporal y deja lista la copia:
 *   - sesión de superadmin (usuario existente con rol_global Superadmin);
 *   - usuario de solo consulta (lo crea si no hay ninguno) con su sesión;
 *   - un equipo bloqueado (Fuera de servicio) para probar el chip deshabilitado;
 *   - todo lo que podría salir afuera apagado: modo prueba de mail forzado en la
 *     base y sin suscripciones push.
 */
export async function prepareDatabase() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'techasset-e2e-'));
  const dbCopy = path.join(tmpDir, 'e2e.db');
  const source = new Database(path.join(root, 'data', 'techasset.db'), { readonly: true, fileMustExist: true });
  await source.backup(dbCopy);
  source.close();

  const db = new Database(dbCopy);
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 86400000).toISOString();
  const newToken = () => crypto.randomBytes(32).toString('hex');

  const superadmin = db.prepare("SELECT id, email, nombre FROM users WHERE rol_global='Superadmin' AND activo=1 ORDER BY id LIMIT 1").get();
  if (!superadmin) throw new Error('La copia no tiene ningún usuario Superadmin activo en `users`.');

  // Usuario de consulta: uno existente con rol Consulta en la sede, o uno nuevo solo en la copia.
  let consulta = db.prepare(`
    SELECT u.id, u.email, u.nombre FROM users u JOIN user_sites us ON us.user_id=u.id
    WHERE u.activo=1 AND us.activo=1 AND us.site_code=? AND us.site_role='Consulta' AND COALESCE(u.rol_global,'') <> 'Superadmin'
    ORDER BY u.id LIMIT 1
  `).get(SITE);
  let consultaCreated = false;
  if (!consulta) {
    const email = 'e2e-consulta@e2e.local';
    db.prepare(`INSERT INTO users (email, nombre, rol_global, activo, last_login_at, created_at, updated_at) VALUES (?, ?, 'Consulta', 1, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET rol_global='Consulta', activo=1`).run(email, 'E2E Consulta', now, now, now);
    consulta = db.prepare('SELECT id, email, nombre FROM users WHERE email=?').get(email);
    db.prepare(`INSERT INTO user_sites (user_id, site_code, site_role, turno, is_default, activo, created_at, updated_at) VALUES (?, ?, 'Consulta', 'Sin turno', 1, 1, ?, ?)
      ON CONFLICT(user_id, site_code) DO UPDATE SET site_role='Consulta', activo=1`).run(consulta.id, SITE, now, now);
    db.prepare(`INSERT INTO allowed_users (email, nombre, default_role, can_choose_role, status, activo, created_at, updated_at) VALUES (?, ?, 'Consulta', 0, 'Activo', 1, ?, ?)
      ON CONFLICT(email) DO NOTHING`).run(email, 'E2E Consulta', now, now);
    consultaCreated = true;
  }

  const insertSession = db.prepare('INSERT INTO user_sessions (token, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)');
  const adminToken = newToken();
  const consultaToken = newToken();
  insertSession.run(adminToken, superadmin.id, now, expires, now);
  insertSession.run(consultaToken, consulta.id, now, expires, now);

  // Equipo bloqueado: el último disponible por etiqueta (lejos de los que usan las pruebas).
  const states = new Map(db.prepare('SELECT etiqueta, estado FROM local_states WHERE site_code=?').all(SITE).map(row => [row.etiqueta, String(row.estado || '')]));
  const hidden = new Set(db.prepare('SELECT etiqueta FROM hidden_devices WHERE site_code=?').all(SITE).map(row => row.etiqueta));
  const candidates = db.prepare('SELECT etiqueta FROM local_devices WHERE site_code=? AND COALESCE(eliminado,0)=0 ORDER BY etiqueta DESC').all(SITE)
    .map(row => row.etiqueta)
    .filter(tag => !hidden.has(tag) && /^(|disponible|devuelto)$/i.test(states.get(tag) || ''));
  const blockedTag = candidates[0] || '';
  if (blockedTag) {
    db.prepare(`INSERT INTO local_states (site_code, etiqueta, estado, updated_at) VALUES (?, ?, 'Fuera de servicio', ?)
      ON CONFLICT(site_code, etiqueta) DO UPDATE SET estado='Fuera de servicio', prestado_a='', updated_at=excluded.updated_at`).run(SITE, blockedTag, '2000-01-01T00:00:00.000Z');
  }

  // Nada sale afuera: mail en modo prueba aunque la base tuviera otra cosa, sin push.
  db.prepare(`INSERT INTO app_settings (key, value) VALUES ('mail.modoPrueba', 'true') ON CONFLICT(key) DO UPDATE SET value='true'`).run();
  db.prepare('DELETE FROM push_subscriptions').run();
  db.close();

  return {
    tmpDir,
    dbCopy,
    admin: { ...superadmin, token: adminToken },
    consulta: { ...consulta, token: consultaToken, created: consultaCreated },
    blockedTag
  };
}

/** Levanta el server real contra la copia. Todo lo que habla con afuera queda vacío. */
export async function startServer({ dbCopy, tmpDir, port }) {
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
    APP_BASE_URL: `http://127.0.0.1:${port}`,
    TECHASSET_PUBLIC_URL: `http://127.0.0.1:${port}`,
    DEBUG_DEVICE_PERF: ''
  };
  const child = spawn(process.execPath, ['server/index.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', chunk => { log += chunk; });
  child.stderr.on('data', chunk => { log += chunk; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 160; i += 1) {
    if (child.exitCode !== null) throw new Error(`El server se cerró al arrancar:\n${log}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return { child, base, getLog: () => log };
    } catch { /* todavía no */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  child.kill();
  throw new Error(`El server no arrancó en 40 s:\n${log}`);
}

export async function stopServer(server) {
  if (!server?.child || server.child.exitCode !== null) return;
  const exited = new Promise(resolve => server.child.once('exit', resolve));
  server.child.kill();
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
}

export async function removeTmp(tmpDir) {
  // En Windows el archivo puede seguir tomado unos ms después de que el proceso muere.
  for (let i = 0; i < 20; i += 1) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); return; } catch { await new Promise(resolve => setTimeout(resolve, 150)); }
  }
}

/** Cliente de la API del lado de Node (para preparar datos y verificar efectos). */
export function apiClient(base, token, site = SITE) {
  const headers = { cookie: `${COOKIE_NAME}=${token}`, 'X-Site-Code': site, Accept: 'application/json' };
  const call = async (method, url, body) => {
    const response = await fetch(`${base}${url}`, {
      method,
      headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: response.status, data };
  };
  return {
    get: url => call('GET', url),
    post: (url, body = {}) => call('POST', url, body),
    patch: (url, body = {}) => call('PATCH', url, body),
    del: url => call('DELETE', url),
    async devices() {
      const { data } = await call('GET', '/api/devices');
      return data.items || [];
    },
    async device(tag) {
      return (await this.devices()).find(item => item.etiqueta === tag);
    }
  };
}

// Misma regla que getLoanState (src/utils/deviceState.ts).
export function loanState(estado) {
  const value = String(estado || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (value.includes('prest') || value.includes('retir')) return 'loaned';
  if (!value || value === 'devuelto' || value === 'sin revisar') return 'available';
  if (value.includes('disponible') && !value.includes('no disponible')) return 'available';
  return 'blocked';
}
