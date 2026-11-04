import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getDb, nowIso } from '../db.js';

// Pedidos de cambios: datos, capturas y vista que ve el front. La IA que
// entrevista vive en requestInterviewer.service.js.

export const REQUEST_LIMITS = {
  textChars: 4000,
  imagesPerMessage: 3,
  imagesPerRequest: 6,
  imageBytes: 5 * 1024 * 1024,
  messagesPerRequest: 40,
  listSize: 200
};

export const REQUEST_STATUSES = ['draft', 'pending', 'in_progress', 'done', 'discarded'];
export const OPEN_STATUSES = new Set(['draft', 'pending']);
export const REQUEST_KINDS = ['fix', 'change', 'new'];

export const GREETING = '¡Hola! Contame qué te gustaría cambiar, agregar o qué no te está funcionando. Si te ayuda, adjuntá una captura de la pantalla con el clip.';

// Las capturas NO van en data/uploads (eso se sirve por estático con solo tener
// sesión, y las de un borrador son privadas): van a una carpeta que solo sirve el
// endpoint del pedido, con la misma regla de lectura que el pedido.
const PRIVATE_ROOT = config.privateDataDir;

const EXTENSION_BY_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export const EMPTY_SUMMARY = { kind: 'change', title: '', screen: '', today: '', desired: '', details: [] };

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || '');
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function readRequestRow(row) {
  return {
    ...row,
    messages: parseJson(row.messages_json, []),
    images: parseJson(row.images_json, []),
    summary: { ...EMPTY_SUMMARY, ...parseJson(row.summary_json, {}) }
  };
}

export function userMessageCount(messages) {
  return messages.filter(message => message.role === 'user').length;
}

/** Lo que ve el front (cuenta o admin). Nunca expone la ruta en disco. */
export function requestView(request, { withMessages = true } = {}) {
  const view = {
    id: request.id,
    status: request.status,
    title: request.title || request.summary.title || '',
    summary: request.summary,
    ready: Number(request.ready) === 1,
    note: request.note || '',
    createdAt: request.created_at,
    updatedAt: request.updated_at,
    submittedAt: request.submitted_at || '',
    resolvedAt: request.resolved_at || ''
  };
  if (withMessages) {
    view.userMessages = userMessageCount(request.messages);
    view.awaitingReply = OPEN_STATUSES.has(request.status) && request.messages.at(-1)?.role === 'user';
    view.messages = request.messages;
    view.images = request.images.map(({ id, name, mime }) => ({ id, name, mime }));
  }
  return view;
}

export function isRequestOwner(request, userId) {
  return Number(request.user_id) === Number(userId);
}

function requesterName(request) {
  return request.user_nombre || String(request.user_email || '').split('@')[0] || 'Alguien del equipo';
}

/** La vista de una cuenta: suma de quién es, sin exponer su id ni su mail. */
export function requestViewFor(request, viewerId, options) {
  return {
    ...requestView(request, options),
    mine: isRequestOwner(request, viewerId),
    requester: { nombre: requesterName(request) }
  };
}

// Con el JOIN cada lectura trae quién lo pidió sin una query aparte.
export const REQUEST_SELECT = `
  SELECT r.*, u.nombre AS user_nombre, u.email AS user_email
  FROM change_requests r LEFT JOIN users u ON u.id=r.user_id`;

export function getRequestRow(id) {
  const row = getDb().prepare(`${REQUEST_SELECT} WHERE r.id=?`).get(String(id || ''));
  return row ? readRequestRow(row) : null;
}

/**
 * Regla de lectura: lo enviado lo ve cualquier cuenta; un borrador, solo su dueño.
 * Un borrador ajeno responde igual que uno que no existe.
 */
export function getVisibleRequest(id, viewerId) {
  const request = getRequestRow(id);
  if (!request) return null;
  return request.status !== 'draft' || isRequestOwner(request, viewerId) ? request : null;
}

export function saveRequest(request, fields) {
  const next = { ...request, ...fields, updated_at: nowIso() };
  getDb().prepare(`
    UPDATE change_requests SET status=?, title=?, summary_json=?, ready=?, messages_json=?, images_json=?, note=?,
      updated_at=?, submitted_at=?, resolved_at=?
    WHERE id=?
  `).run(
    next.status, next.title || '', JSON.stringify(next.summary || EMPTY_SUMMARY), next.ready ? 1 : 0,
    JSON.stringify(next.messages || []), JSON.stringify(next.images || []), next.note || '',
    next.updated_at, next.submitted_at || '', next.resolved_at || '', next.id
  );
  return next;
}

export function createDraft(userId, siteCode) {
  const ts = nowIso();
  const id = crypto.randomUUID();
  const messages = [{ role: 'assistant', text: GREETING, imageIds: [], at: ts }];
  getDb().prepare(`
    INSERT INTO change_requests (id, user_id, site_code, status, title, summary_json, ready, messages_json, images_json, note, created_at, updated_at)
    VALUES (?, ?, ?, 'draft', '', ?, 0, ?, '[]', '', ?, ?)
  `).run(id, userId, siteCode || '', JSON.stringify(EMPTY_SUMMARY), JSON.stringify(messages), ts, ts);
  return getRequestRow(id);
}

/** El borrador que se abrió y nunca se escribió (para no duplicarlo). */
export function findEmptyDraft(userId) {
  const rows = getDb().prepare(`${REQUEST_SELECT} WHERE r.user_id=? AND r.status='draft' ORDER BY r.created_at DESC LIMIT 20`).all(userId);
  return rows.map(readRequestRow).find(request => !userMessageCount(request.messages)) || null;
}

/**
 * La lista que ve una cuenta: sus borradores primero (el tope nunca se los come) y
 * después lo enviado por cualquiera, lo último arriba. Una sola query y sin las
 * conversaciones de los demás, que la lista no usa y pesan: solo las de los
 * borradores propios, para descartar los que se abrieron y nunca se escribieron.
 */
export function listVisibleRequests(viewerId) {
  // De más: los borradores vacíos se filtran acá (findEmptyDraft evita juntarlos)
  // y una fila extra dice si quedó algo afuera.
  const rows = getDb().prepare(`
    SELECT r.id, r.user_id, r.status, r.title, r.summary_json, r.ready, r.note, r.created_at, r.updated_at, r.submitted_at, r.resolved_at,
      CASE WHEN r.status='draft' THEN r.messages_json ELSE '[]' END AS messages_json,
      u.nombre AS user_nombre, u.email AS user_email
    FROM change_requests r LEFT JOIN users u ON u.id=r.user_id
    WHERE r.status<>'draft' OR r.user_id=?
    ORDER BY CASE WHEN r.status='draft' THEN 0 ELSE 1 END, COALESCE(NULLIF(r.submitted_at, ''), r.created_at) DESC
    LIMIT ?
  `).all(viewerId, REQUEST_LIMITS.listSize + 21);
  const visible = rows.map(readRequestRow)
    .filter(request => request.status !== 'draft' || userMessageCount(request.messages) > 0);
  return { items: visible.slice(0, REQUEST_LIMITS.listSize), truncated: visible.length > REQUEST_LIMITS.listSize };
}

// ---------- Capturas ----------

/** Tipo real por los primeros bytes: el mimetype que manda el navegador no vale. */
export function detectImageMime(buffer) {
  if (!buffer || buffer.length < 12) return '';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return '';
}

export function sanitizeFileName(name) {
  const clean = String(name || '')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return clean || 'captura';
}

export function storeImage(userId, buffer, originalName) {
  const mime = detectImageMime(buffer);
  if (!mime) throw Object.assign(new Error('Solo se pueden adjuntar imágenes JPG, PNG o WEBP.'), { status: 400 });
  if (buffer.length > REQUEST_LIMITS.imageBytes) throw Object.assign(new Error('Cada captura puede pesar hasta 5 MB.'), { status: 400 });
  const id = crypto.randomUUID();
  const key = `requests/${Number(userId)}/${id}.${EXTENSION_BY_MIME[mime]}`;
  const file = resolveKey(key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buffer);
  return { id, key, name: sanitizeFileName(originalName), mime };
}

function resolveKey(key) {
  const file = path.resolve(PRIVATE_ROOT, String(key || ''));
  if (!file.startsWith(PRIVATE_ROOT + path.sep)) throw new Error('Ruta de captura inválida.');
  return file;
}

export function imageFilePath(image) {
  return resolveKey(image.key);
}

export function readImage(image) {
  return fs.readFileSync(resolveKey(image.key));
}

export function removeImages(images) {
  for (const image of images || []) {
    try { fs.rmSync(resolveKey(image.key), { force: true }); } catch (error) { console.warn('[requests] no se pudo borrar la captura', image.key, error?.message); }
  }
}
