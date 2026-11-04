#!/usr/bin/env node
// Pedidos de cambios — lado del desarrollador.
//
//   node scripts/dev/pedidos.mjs                      pendientes y en curso, con resumen y charla
//   node scripts/dev/pedidos.mjs --all                todos (menos borradores)
//   node scripts/dev/pedidos.mjs --json               lo mismo en JSON (para otro script o un agente)
//   node scripts/dev/pedidos.mjs estado <id> <pending|in_progress|done|discarded> "nota"
//
// La nota la ve la persona en la app: escribila cálida y concreta, en
// rioplatense, y decí dónde encontrar el cambio. <id> acepta los primeros
// caracteres si no se repiten.
//
// Las capturas se bajan a .pedidos/<id>/ (está en .gitignore): nunca se suben a ningún lado.
//
// Secretos en scripts/dev/.secrets.json (también en .gitignore):
//   { "url": "https://techasset.bauhub.online", "password": "<REQUESTS_ADMIN_PASSWORD>" }
// TECHASSET_URL pisa la url (ej. http://127.0.0.1:8000 para probar en local).
// La contraseña nunca se imprime.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const SECRETS = path.join(here, '.secrets.json');
const STATUSES = ['pending', 'in_progress', 'done', 'discarded'];
const STATUS_LABEL = { draft: 'Borrador', pending: 'Enviado', in_progress: 'En curso', done: 'Hecho', discarded: 'Descartado' };
const KIND_LABEL = { fix: 'Algo no funciona', change: 'Cambiar algo que ya existe', new: 'Algo nuevo' };

function die(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function readSecrets() {
  if (!fs.existsSync(SECRETS)) die(`Falta ${path.relative(root, SECRETS)} con { "url": "...", "password": "..." }.`);
  let secrets;
  try { secrets = JSON.parse(fs.readFileSync(SECRETS, 'utf8')); } catch { die(`${path.relative(root, SECRETS)} no es JSON válido.`); }
  const url = String(process.env.TECHASSET_URL || secrets.url || '').replace(/\/+$/, '');
  if (!url) die('Falta "url" en los secretos (o TECHASSET_URL).');
  if (!secrets.password) die('Falta "password" en los secretos.');
  return { url, password: String(secrets.password) };
}

const { url: BASE, password } = readSecrets();
let cookie = '';

async function api(method, route, body) {
  const response = await fetch(`${BASE}/api${route}`, {
    method,
    headers: { Accept: 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if ((response.headers.get('content-type') || '').includes('json')) {
    const data = await response.json();
    if (!response.ok || data.ok === false) die(`${method} ${route}: ${data.error || response.status}`);
    return { data, response };
  }
  if (!response.ok) die(`${method} ${route}: HTTP ${response.status}`);
  return { data: Buffer.from(await response.arrayBuffer()), response };
}

async function login() {
  const { response } = await api('POST', '/admin/login', { password });
  const raw = response.headers.get('set-cookie') || '';
  cookie = raw.split(';')[0];
  if (!cookie) die('El servidor no devolvió la cookie de admin.');
}

async function fetchRequests(all) {
  const { data } = await api('GET', `/admin/requests${all ? '?status=all' : ''}`);
  return data.items;
}

async function resolveId(prefix) {
  const items = await fetchRequests(true);
  const matches = items.filter(item => item.id.startsWith(prefix));
  if (!matches.length) die(`No hay ningún pedido que empiece con "${prefix}".`);
  if (matches.length > 1) die(`"${prefix}" coincide con ${matches.length} pedidos; usá más caracteres.`);
  return matches[0];
}

async function downloadImages(item) {
  const images = item.images || [];
  if (!images.length) return [];
  const dir = path.join(root, '.pedidos', item.id);
  fs.mkdirSync(dir, { recursive: true });
  const saved = [];
  for (const [index, image] of images.entries()) {
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[image.mime] || 'img';
    const file = path.join(dir, `${String(index + 1).padStart(2, '0')}-${image.id.slice(0, 8)}.${ext}`);
    if (!fs.existsSync(file)) {
      const { data } = await api('GET', `/admin/requests/${item.id}/images/${image.id}`);
      fs.writeFileSync(file, data);
    }
    saved.push({ id: image.id, name: image.name, file: path.relative(root, file) });
  }
  return saved;
}

function fmt(date) {
  if (!date) return '—';
  return new Date(date).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Argentina/Buenos_Aires' });
}

function printRequest(item, files) {
  const s = item.summary || {};
  const fileById = new Map(files.map(file => [file.id, file.file]));
  const line = '─'.repeat(72);
  console.log(line);
  console.log(`${item.title || s.title || 'Pedido sin título'}`);
  console.log(`  id:        ${item.id}`);
  console.log(`  estado:    ${STATUS_LABEL[item.status] || item.status}${item.ready ? '' : ' (la IA no llegó a marcarlo listo)'}`);
  console.log(`  pidió:     ${item.requester?.nombre || '—'} <${item.requester?.email || '—'}>${item.siteCode ? ` · sede ${item.siteCode}` : ''}`);
  console.log(`  enviado:   ${fmt(item.submittedAt)}${item.resolvedAt ? ` · resuelto ${fmt(item.resolvedAt)}` : ''}`);
  console.log('');
  console.log(`  Tipo:      ${KIND_LABEL[s.kind] || s.kind || '—'}`);
  console.log(`  Dónde:     ${s.screen || '—'}`);
  if (s.today) console.log(`  Hoy:       ${s.today}`);
  console.log(`  Quiere:    ${s.desired || '—'}`);
  for (const detail of s.details || []) console.log(`    • ${detail}`);
  if (item.note) console.log(`\n  Nota al usuario: ${item.note}`);
  console.log('\n  Conversación:');
  for (const message of item.messages || []) {
    const who = message.role === 'user' ? 'USUARIO' : 'IA';
    const text = String(message.text || '').split('\n').join('\n             ');
    console.log(`  [${fmt(message.at)}] ${who}: ${text}`);
    for (const id of message.imageIds || []) console.log(`             📎 ${fileById.get(id) || id}`);
  }
}

async function list(all, asJson) {
  const items = await fetchRequests(all);
  const withFiles = [];
  for (const item of items) withFiles.push({ ...item, files: await downloadImages(item) });
  if (asJson) {
    console.log(JSON.stringify(withFiles, null, 2));
    return;
  }
  if (!withFiles.length) {
    console.log(all ? 'No hay pedidos.' : 'No hay pedidos pendientes ni en curso. 🎉');
    return;
  }
  for (const item of withFiles) printRequest(item, item.files);
  console.log('─'.repeat(72));
  console.log(`${withFiles.length} pedido${withFiles.length === 1 ? '' : 's'}. Capturas en .pedidos/<id>/.`);
}

async function setStatus(prefix, status, note) {
  if (!prefix || !STATUSES.includes(status)) die(`Uso: estado <id> <${STATUSES.join('|')}> "nota"`);
  const item = await resolveId(prefix);
  const body = { status };
  if (note !== undefined) body.note = note;
  const { data } = await api('PATCH', `/admin/requests/${item.id}`, body);
  console.log(`✔ "${data.item.title}" → ${STATUS_LABEL[data.item.status]}${data.item.note ? `\n  Nota: ${data.item.note}` : ''}`);
}

const args = process.argv.slice(2);
await login();
if (args[0] === 'estado') await setStatus(args[1], args[2], args[3]);
else if (!args[0] || args[0].startsWith('--')) await list(args.includes('--all'), args.includes('--json'));
else die(`Comando desconocido "${args[0]}". Mirá el encabezado de scripts/dev/pedidos.mjs.`);
