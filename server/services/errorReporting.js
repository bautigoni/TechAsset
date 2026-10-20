// Errores del server a Sentry, APAGADO por defecto: solo con SENTRY_DSN en el
// .env. Cliente mínimo (protocolo "store" de Sentry, sin SDK ni dependencias).
//
// Qué manda: tipo, mensaje y pila del error, método y ruta del pedido (SIN
// query), entorno y versión. Qué NO manda: cuerpos de pedidos, cookies,
// headers, query strings (pueden traer tokens), mails (se reemplazan por
// [mail]) ni tokens largos ([token]). Recomendado en el proyecto de Sentry:
// "Prevent Storing of IP Addresses".
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const DSN = String(process.env.SENTRY_DSN || '').trim();
const ENVIRONMENT = process.env.SENTRY_ENVIRONMENT || 'production';
const MAX_PER_MINUTE = 20;
let windowStart = 0;
let windowCount = 0;

function parseDsn(dsn) {
  try {
    const url = new URL(dsn);
    const parts = url.pathname.split('/').filter(Boolean);
    const project = parts.pop();
    if (!url.username || !project) return null;
    const prefix = parts.length ? `/${parts.join('/')}` : '';
    return {
      url: `${url.protocol}//${url.host}${prefix}/api/${project}/store/`,
      auth: `Sentry sentry_version=7, sentry_client=techasset-server/1.0, sentry_key=${url.username}`
    };
  } catch {
    return null;
  }
}

const target = DSN ? parseDsn(DSN) : null;
if (DSN && !target) console.warn('[sentry] SENTRY_DSN inválido: el reporte de errores queda apagado.');

export function scrub(text) {
  return String(text || '')
    .slice(0, 4000)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[mail]')
    .replace(/\b[a-f0-9]{32,}\b/gi, '[token]')
    .replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, '$1[credenciales]@');
}

function parseStack(stack) {
  const frames = [];
  for (const line of String(stack || '').split('\n').slice(1, 40)) {
    const match = line.match(/^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/);
    if (!match) continue;
    const filename = match[2].replace(/^file:\/\/\/?/, '').replace(/\\/g, '/').replace(/^.*?\/(server\/)/, '$1');
    frames.push({ function: match[1] || '?', filename, lineno: Number(match[3]), colno: Number(match[4]), in_app: !filename.includes('node_modules') && !filename.startsWith('node:') });
  }
  return frames.reverse();
}

function buildEvent(error, context = {}) {
  const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Error sin detalle');
  return {
    event_id: crypto.randomBytes(16).toString('hex'),
    timestamp: Date.now() / 1000,
    platform: 'node',
    level: context.level || 'error',
    logger: 'techasset.server',
    environment: ENVIRONMENT,
    tags: { ...(context.tags || {}) },
    ...(context.method ? { request: { method: context.method, url: String(context.path || '').split('?')[0] } } : {}),
    exception: { values: [{ type: err.name || 'Error', value: scrub(err.message), stacktrace: { frames: parseStack(err.stack) } }] }
  };
}

function allowed() {
  const now = Date.now();
  if (now - windowStart > 60_000) { windowStart = now; windowCount = 0; }
  windowCount += 1;
  return windowCount <= MAX_PER_MINUTE;
}

/** Reporta sin bloquear (fire and forget). No hace nada sin SENTRY_DSN. */
export function reportError(error, context = {}) {
  if (!target || !allowed()) return;
  const body = JSON.stringify(buildEvent(error, context));
  fetch(target.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sentry-Auth': target.auth }, body, signal: AbortSignal.timeout(5000) })
    .catch(() => undefined);
}

/**
 * Excepción sin atrapar: Node va a cerrar el proceso (no se cambia ese
 * comportamiento: systemd lo levanta de nuevo). Como el envío normal es
 * asíncrono y no llegaría, se manda con un proceso hijo sincrónico (máx. 3 s).
 */
export function installCrashReporting() {
  if (!target) return;
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    try {
      const body = JSON.stringify(buildEvent(error, { level: 'fatal', tags: { origin } }));
      const script = 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>fetch(process.argv[1],{method:"POST",headers:{"Content-Type":"application/json","X-Sentry-Auth":process.argv[2]},body:d}).catch(()=>{}).finally(()=>process.exit(0)))';
      spawnSync(process.execPath, ['-e', script, target.url, target.auth], { input: body, timeout: 3000, stdio: ['pipe', 'ignore', 'ignore'] });
    } catch {
      // Reportar nunca puede empeorar la caída.
    }
  });
}
