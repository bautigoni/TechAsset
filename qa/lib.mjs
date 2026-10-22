// Piezas compartidas del entorno de QA (qa/seed-qa-tenant.mjs, qa/serve-qa.mjs,
// qa/approve.mjs, qa/stop-qa.mjs). Reusa lo del banco e2e (copia segura de la
// base, puerto libre, build) y agrega: server real con TODO lo externo apagado
// sobre una base propia, y un cliente HTTP que se loguea por la API real.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { root, snapshotDatabase, freePort, ensureBuild, findBrowser, COOKIE_NAME } from '../e2e/lib/env.mjs';

export { root, snapshotDatabase, freePort, ensureBuild, findBrowser, COOKIE_NAME };

export const QA_SITE = 'QA';
export const QA_SITE_NAME = 'Sede de prueba';
export const OUT_DIR = path.join(root, 'qa', '.out');
export const DEFAULT_SEED_DB = path.join(OUT_DIR, 'qa-seed.db');
export const CREDENTIALS_FILE = path.join(OUT_DIR, 'credenciales.json');
export const REAL_DB = path.join(root, 'data', 'techasset.db');
// Los usa el dueño (Vite y su server de desarrollo): nunca se tocan.
export const RESERVED_PORTS = new Set([5173, 8000]);

const argv = process.argv.slice(2);
export const flag = name => argv.includes(`--${name}`);
export const option = name => argv.find(arg => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

export function die(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

/** Nunca la base real: ni la ruta exacta ni nada dentro de data/. */
export function assertSafeDbPath(target) {
  const resolved = path.resolve(target);
  const real = path.resolve(REAL_DB);
  const dataDir = path.resolve(root, 'data') + path.sep;
  const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (same(resolved, real) || (process.platform === 'win32' ? resolved.toLowerCase() : resolved).startsWith(process.platform === 'win32' ? dataDir.toLowerCase() : dataDir)) {
    die(`Ruta prohibida: ${resolved}. El entorno de QA nunca escribe en data/ (la base real). Usá algo bajo qa/.out/.`);
  }
  return resolved;
}

/** Nombre de persona → carpeta segura (impaciente, movil, nonativo...). */
export function safeName(value) {
  const name = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,40}$/.test(name)) die(`--name inválido ("${value}"): usá letras, números, - o _ (ej. --name=impaciente).`);
  return name;
}

export function parsePort(value, { required = true } = {}) {
  if (!value) {
    if (required) die('Falta --port=<número> (cualquiera libre salvo 5173 y 8000).');
    return 0;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) die(`--port inválido: ${value}`);
  if (RESERVED_PORTS.has(port)) die(`El puerto ${port} es del dueño (dev server). Elegí otro.`);
  return port;
}

export function removeDbFiles(file) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(`${file}${suffix}`, { force: true });
}

/**
 * Entorno del server de QA: SQLite sobre la base indicada, mails en modo prueba
 * (capturados en un archivo), sin Google, sin push, sin IA, sin Sentry.
 * Las claves "apagadas" van VACÍAS y no borradas: el server carga .env con
 * dotenv, que no pisa variables que ya existen, pero sí completaría las que
 * faltan (y el .env del repo tiene ANTHROPIC_API_KEY, SMTP, etc.).
 */
export function qaServerEnv({ dbPath, port, uploadsDir, mailFile, tmpDir }) {
  const base = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    PORT: String(port),
    SERVER_HOST: '127.0.0.1',
    SQLITE_DB_PATH: dbPath,
    DB_DRIVER: 'sqlite',
    DATABASE_URL: '',
    MODO_PRUEBA: 'true',
    SMTP_SERVER: '', SMTP_USER: '', SMTP_APP_PASSWORD: '',
    RESEND_API_KEY: '', RESEND_FROM: '',
    GOOGLE_SHEET_CSV_URL: '',
    GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_REDIRECT_URI: '',
    ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', AI_PROVIDER: 'local',
    VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '',
    SENTRY_DSN: '', VITE_SENTRY_DSN: '',
    SUPERADMIN_EMAILS: '',
    AUTH_ALLOWED_EMAILS: '',
    BOOTSTRAP_SITES: '',
    LOCALTUNNEL_SUBDOMAIN: '',
    CACHE_CSV_PATH: path.join(tmpDir, 'cache_sheet.csv'),
    DEVICES_APP_CSV_PATH: path.join(tmpDir, 'devices_app.csv'),
    TOOLS_TEMP_DIR: path.join(tmpDir, 'tools'),
    UPLOADS_DIR: uploadsDir,
    APP_BASE_URL: base,
    TECHASSET_PUBLIC_URL: base,
    DEBUG_DEVICE_PERF: '',
    // Con NODE_ENV=test + MAIL_CAPTURE_FILE los mails de modo prueba quedan en
    // ese archivo (una línea JSON por mail): de ahí sale el link de "olvidé mi contraseña".
    NODE_ENV: 'test',
    MAIL_CAPTURE_FILE: mailFile
  };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  return { env, base };
}

/** Levanta `node server/index.js` y espera /api/health. `logFile` opcional (si no, en memoria). */
export async function startQaServer({ dbPath, port, uploadsDir, mailFile, tmpDir, logFile }) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(path.dirname(mailFile), { recursive: true });
  const { env, base } = qaServerEnv({ dbPath, port, uploadsDir, mailFile, tmpDir });
  const child = spawn(process.execPath, ['server/index.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let log = '';
  const sink = logFile ? fs.createWriteStream(logFile, { flags: 'a' }) : null;
  const onData = chunk => { log = (log + chunk).slice(-200000); sink?.write(chunk); };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  for (let i = 0; i < 200; i += 1) {
    if (child.exitCode !== null) throw new Error(`El server se cerró al arrancar:\n${log}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return { child, base, getLog: () => log, sink };
    } catch { /* todavía no */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  child.kill();
  throw new Error(`El server no arrancó en 50 s:\n${log}`);
}

export async function stopQaServer(server) {
  if (!server?.child || server.child.exitCode !== null) return;
  const exited = new Promise(resolve => server.child.once('exit', resolve));
  server.child.kill();
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
  server.sink?.end();
}

/** Cliente de la API con cookie de sesión y sede fija (X-Site-Code). */
export function apiAs(base, { token = '', site = QA_SITE } = {}) {
  let cookie = token ? `${COOKIE_NAME}=${token}` : '';
  const call = async (method, url, body) => {
    const headers = { Accept: 'application/json', 'X-Site-Code': site };
    if (cookie) headers.cookie = cookie;
    if (body) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${base}${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const setCookie = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    const session = setCookie.map(item => item.split(';')[0]).find(item => item.startsWith(`${COOKIE_NAME}=`) && item.length > COOKIE_NAME.length + 1);
    if (session) cookie = session;
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
    return { status: response.status, data };
  };
  return {
    get: url => call('GET', url),
    post: (url, body = {}) => call('POST', url, body),
    patch: (url, body = {}) => call('PATCH', url, body),
    async login(email, password) {
      const result = await call('POST', '/api/auth/login', { email, password });
      if (result.status !== 200 || !result.data?.authenticated) throw new Error(`No pude entrar como ${email}: ${result.status} ${JSON.stringify(result.data).slice(0, 300)}`);
      return result.data;
    }
  };
}

/** Falla con el detalle de la respuesta si no fue 2xx/ok. */
export function must(result, what) {
  if (result.status >= 300 || result.data?.ok === false) {
    throw new Error(`${what}: HTTP ${result.status} ${JSON.stringify(result.data).slice(0, 400)}`);
  }
  return result.data;
}

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function instanceDir(name) {
  return path.join(OUT_DIR, name);
}
