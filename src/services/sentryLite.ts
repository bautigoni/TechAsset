/**
 * Cliente mínimo de Sentry para el navegador (sin SDK: ~2 kB, sin scripts de
 * terceros). Habla el protocolo "store" de Sentry con el DSN público del
 * proyecto. Solo se carga si el build tiene VITE_SENTRY_DSN (errorReporting.ts).
 *
 * Qué manda: tipo y mensaje del error, la pila (archivo, línea, función), la
 * ruta de la pantalla SIN query ni hash, navegador, sede y vista.
 * Qué NO manda: mails (se reemplazan por [mail]), el nombre y el mail del
 * usuario logueado (se reemplazan por [persona]), cookies, cuerpos de pedidos,
 * datos de formularios, query strings (pueden traer tokens) ni el usuario.
 * Recomendado en el proyecto de Sentry: "Prevent Storing of IP Addresses".
 */

type ParsedDsn = { url: string };
type Frame = { filename: string; function: string; lineno?: number; colno?: number; in_app: boolean };

const MAX_EVENTS = 10;
let sent = 0;
const seen = new Set<string>();
let target: ParsedDsn | null = null;

function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const url = new URL(dsn);
    const key = url.username;
    const parts = url.pathname.split('/').filter(Boolean);
    const project = parts.pop();
    if (!key || !project) return null;
    const prefix = parts.length ? `/${parts.join('/')}` : '';
    return { url: `${url.protocol}//${url.host}${prefix}/api/${project}/store/?sentry_key=${encodeURIComponent(key)}&sentry_version=7` };
  } catch {
    return null;
  }
}

/** Nombre y mail del usuario de esta sesión (para borrarlos de los mensajes). */
function personalStrings(): string[] {
  const out: string[] = [];
  try {
    const cache = JSON.parse(localStorage.getItem('techasset_session_cache') || 'null') as { user?: { nombre?: string; email?: string } } | null;
    if (cache?.user?.nombre) out.push(cache.user.nombre);
    if (cache?.user?.email) out.push(cache.user.email);
    const operator = localStorage.getItem('techasset_operator');
    if (operator) out.push(operator);
  } catch { /* sin storage */ }
  return out.filter(value => value && value.trim().length >= 3);
}

const escapeRx = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function scrub(text: string): string {
  let out = String(text || '').slice(0, 2000);
  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[mail]');
  for (const value of personalStrings()) out = out.replace(new RegExp(escapeRx(value.trim()), 'gi'), '[persona]');
  // Tokens largos sueltos (links de contraseña, sesiones).
  out = out.replace(/\b[a-f0-9]{32,}\b/gi, '[token]');
  return out;
}

const cleanUrl = (raw: string) => {
  try {
    const url = new URL(raw, window.location.origin);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '';
  }
};

function parseStack(stack: string): Frame[] {
  const frames: Frame[] = [];
  for (const line of String(stack || '').split('\n').slice(0, 40)) {
    // Chrome: "    at fn (https://x/assets/a.js:1:2)" · Firefox/Safari: "fn@https://x/assets/a.js:1:2"
    const match = line.match(/^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/) || line.match(/^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/);
    if (!match) continue;
    const filename = cleanUrl(match[2]);
    frames.push({ function: scrub(match[1] || '?'), filename, lineno: Number(match[3]), colno: Number(match[4]), in_app: filename.includes('/assets/') });
  }
  return frames.reverse(); // Sentry: la más vieja primero
}

function eventId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function captureError(error: unknown) {
  if (!target || sent >= MAX_EVENTS) return;
  const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Error sin detalle');
  const value = scrub(err.message);
  const key = `${err.name}:${value}`;
  if (seen.has(key)) return;
  seen.add(key);
  sent += 1;
  const path = window.location.pathname;
  const event = {
    event_id: eventId(),
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    level: 'error',
    logger: 'techasset.front',
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || 'production',
    tags: {
      sede: (() => { try { return sessionStorage.getItem('techasset_active_site') || ''; } catch { return ''; } })(),
      vista: path.match(/^\/sede\/[^/]+\/([^/]+)/)?.[1] || (path === '/' ? 'landing' : path.replace(/^\//, '').split('/')[0])
    },
    request: { url: cleanUrl(window.location.href), headers: { 'User-Agent': navigator.userAgent } },
    exception: { values: [{ type: err.name || 'Error', value, stacktrace: { frames: parseStack(err.stack || '') } }] }
  };
  // text/plain: sin preflight de CORS (el endpoint de Sentry lo acepta igual).
  fetch(target.url, { method: 'POST', body: JSON.stringify(event), keepalive: true, headers: { 'Content-Type': 'text/plain;charset=UTF-8' } }).catch(() => undefined);
}

export function startSentryLite(dsn: string) {
  if (target) return;
  target = parseDsn(dsn);
  if (!target) return;
  window.addEventListener('error', event => {
    // Los errores de carga de recursos (img, script) no traen `error`: no son excepciones de la app.
    if (event.error) captureError(event.error);
  });
  window.addEventListener('unhandledrejection', event => captureError(event.reason));
}
