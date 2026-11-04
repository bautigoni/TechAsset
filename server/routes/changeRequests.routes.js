import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { addLocalMovement, getDb, nowIso } from '../db.js';
import { getUserSession, getUserSites, isSuperadmin, normalizeEmail } from '../services/siteContext.service.js';
import {
  OPEN_STATUSES,
  REQUEST_LIMITS,
  REQUEST_STATUSES,
  createDraft,
  findEmptyDraft,
  getOwnRequest,
  getRequestRow,
  imageFilePath,
  listOwnRequests,
  readRequestRow,
  removeImages,
  requestView,
  saveRequest,
  storeImage,
  userMessageCount
} from '../services/changeRequests.service.js';
import { interviewer } from '../services/requestInterviewer.service.js';

// «Pedidos de cambios». Dos routers:
// - changeRequestsRouter: la persona habilitada (can_request_changes) charla con
//   la IA y envía el pedido. Va después de authMiddleware y ANTES de requireEditor:
//   una directora con rol de consulta tiene que poder pedir cambios igual.
// - changeRequestsAdminRouter: el desarrollador (o su script) lee y resuelve los
//   pedidos. Sesión propia con contraseña de .env, o un Superadmin logueado.
//   Va antes de authMiddleware porque el script no tiene sesión de usuario.

export const changeRequestsRouter = Router();
export const changeRequestsAdminRouter = Router();

const NOT_FOUND = 'No encontramos ese pedido.';
const CLOSED = 'Este pedido ya está cerrado. Si querés sumar algo, empezá uno nuevo.';

// ---------- Límites de frecuencia (en memoria, por usuario) ----------

const windows = new Map();
function tooMany(key, max, windowMs) {
  const now = Date.now();
  const recent = (windows.get(key) || []).filter(ts => now - ts < windowMs);
  if (recent.length >= max) { windows.set(key, recent); return true; }
  recent.push(now);
  windows.set(key, recent);
  if (windows.size > 5000) windows.clear();
  return false;
}
const HOUR = 60 * 60 * 1000;

export function resetRequestRateLimits() {
  windows.clear();
}

function fail(res, status, error) {
  return res.status(status).json({ ok: false, error });
}

function auditSite(userId, fallback = '') {
  return fallback || getUserSites(userId)[0]?.siteCode || config.defaultSiteCode || 'NFPT';
}

// ---------- Usuario ----------

changeRequestsRouter.use('/requests', (req, res, next) => {
  if (!req.user?.canRequestChanges) return fail(res, 403, 'Esta sección no está habilitada en tu cuenta.');
  next();
});

changeRequestsRouter.get('/requests', (req, res) => {
  res.json({ ok: true, items: listOwnRequests(req.user.id).map(item => requestView(item, { withMessages: false })) });
});

changeRequestsRouter.post('/requests', (req, res) => {
  const draft = findEmptyDraft(req.user.id) || createDraft(req.user.id, req.siteCode);
  res.json({ ok: true, item: requestView(draft) });
});

changeRequestsRouter.get('/requests/:id', (req, res) => {
  const request = getOwnRequest(req.params.id, req.user.id);
  if (!request) return fail(res, 404, NOT_FOUND);
  res.json({ ok: true, item: requestView(request) });
});

// Los archivos quedan en memoria hasta validarlos: recién se escriben a disco
// cuando pasaron tipo real, tamaño y los topes del pedido.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: REQUEST_LIMITS.imageBytes, files: REQUEST_LIMITS.imagesPerMessage, fields: 4, fieldSize: 64 * 1024 }
});

function receiveFiles(req, res, next) {
  upload.array('file', REQUEST_LIMITS.imagesPerMessage)(req, res, error => {
    if (!error) return next();
    if (error.code === 'LIMIT_FILE_SIZE') return fail(res, 400, 'Cada captura puede pesar hasta 5 MB.');
    if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') return fail(res, 400, `Podés adjuntar hasta ${REQUEST_LIMITS.imagesPerMessage} capturas por mensaje.`);
    return fail(res, 400, 'No se pudo leer el mensaje.');
  });
}

changeRequestsRouter.post('/requests/:id/messages', (req, res, next) => {
  const request = getOwnRequest(req.params.id, req.user.id);
  if (!request) return fail(res, 404, NOT_FOUND);
  if (!OPEN_STATUSES.has(request.status)) return fail(res, 409, CLOSED);
  if (tooMany(`msg:${req.user.id}`, 60, HOUR)) return fail(res, 429, 'Mandaste muchos mensajes en poco tiempo. Esperá un rato y seguimos.');
  next();
}, receiveFiles, (req, res) => {
  // Se relee: mientras subían los archivos pudo cambiar.
  const request = getOwnRequest(req.params.id, req.user.id);
  if (!request) return fail(res, 404, NOT_FOUND);
  if (!OPEN_STATUSES.has(request.status)) return fail(res, 409, CLOSED);
  const text = String(req.body?.text || '').trim();
  const files = req.files || [];
  if (!text && !files.length) return fail(res, 400, 'Escribí algo o adjuntá una captura.');
  if (text.length > REQUEST_LIMITS.textChars) return fail(res, 400, `El mensaje puede tener hasta ${REQUEST_LIMITS.textChars} caracteres.`);
  if (request.messages.length >= REQUEST_LIMITS.messagesPerRequest) return fail(res, 409, 'Esta conversación ya es muy larga: enviá el pedido como está y empezá otro.');
  if (request.images.length + files.length > REQUEST_LIMITS.imagesPerRequest) return fail(res, 400, `Cada pedido puede tener hasta ${REQUEST_LIMITS.imagesPerRequest} capturas.`);

  const stored = [];
  try {
    for (const file of files) stored.push(storeImage(req.user.id, file.buffer, file.originalname));
  } catch (error) {
    removeImages(stored);
    return fail(res, error.status || 500, error.status ? error.message : 'No se pudo guardar la captura.');
  }
  const message = { role: 'user', text, imageIds: stored.map(image => image.id), at: nowIso() };
  const saved = saveRequest(request, { messages: [...request.messages, message], images: [...request.images, ...stored] });
  res.json({ ok: true, item: requestView(saved) });
});

// Una respuesta en curso por pedido: si llega otra (doble click, reintento
// apurado) espera a la misma en vez de pagar dos llamadas a la IA.
const replying = new Map();

async function replyTo(requestId) {
  const request = getRequestRow(requestId);
  const result = await interviewer.run({ messages: request.messages, images: request.images });
  // Se relee para no pisar un mensaje que llegó mientras la IA pensaba.
  const latest = getRequestRow(requestId);
  if (!latest || !OPEN_STATUSES.has(latest.status)) return latest;
  return saveRequest(latest, {
    messages: [...latest.messages, { role: 'assistant', text: result.reply, imageIds: [], at: nowIso() }],
    summary: result.summary,
    title: result.summary.title,
    ready: result.ready
  });
}

changeRequestsRouter.post('/requests/:id/reply', async (req, res) => {
  const request = getOwnRequest(req.params.id, req.user.id);
  if (!request) return fail(res, 404, NOT_FOUND);
  if (!OPEN_STATUSES.has(request.status)) return fail(res, 409, CLOSED);
  if (request.messages.at(-1)?.role !== 'user') return res.json({ ok: true, item: requestView(request) });
  let pending = replying.get(request.id);
  if (!pending) {
    if (tooMany(`reply:${req.user.id}`, 60, HOUR)) return fail(res, 429, 'La IA necesita un respiro. Probá de nuevo en un rato.');
    pending = replyTo(request.id).finally(() => replying.delete(request.id));
    replying.set(request.id, pending);
  }
  try {
    const saved = await pending;
    res.json({ ok: true, item: requestView(saved || request) });
  } catch (error) {
    console.error('[requests] la IA no respondió:', error?.message || error);
    // El mensaje del usuario ya quedó guardado: el front ofrece "Reintentar".
    fail(res, 502, 'La IA no pudo responder ahora. Tu mensaje quedó guardado: tocá Reintentar.');
  }
});

changeRequestsRouter.post('/requests/:id/submit', (req, res) => {
  const request = getOwnRequest(req.params.id, req.user.id);
  if (!request) return fail(res, 404, NOT_FOUND);
  if (request.status !== 'draft') return fail(res, 409, 'Este pedido ya fue enviado.');
  if (!userMessageCount(request.messages)) return fail(res, 400, 'Contanos qué necesitás antes de enviar el pedido.');
  const ts = nowIso();
  const title = request.title || request.summary.title || 'Pedido sin título';
  const saved = saveRequest(request, { status: 'pending', submitted_at: ts, title });
  addLocalMovement({ tipo: 'pedido', descripcion: `Pedido de cambios enviado: ${title}`, operador: req.user.nombre || req.user.email, origen: 'Pedidos de cambios', siteCode: auditSite(req.user.id, req.siteCode) });
  res.json({ ok: true, item: requestView(saved) });
});

changeRequestsRouter.post('/requests/:id/withdraw', (req, res) => {
  const request = getOwnRequest(req.params.id, req.user.id);
  if (!request) return fail(res, 404, NOT_FOUND);
  if (request.status !== 'pending') return fail(res, 409, 'Solo se puede cancelar un pedido enviado que todavía no empezó.');
  const saved = saveRequest(request, { status: 'discarded', note: 'Cancelado por el usuario', resolved_at: nowIso() });
  addLocalMovement({ tipo: 'pedido', descripcion: `Pedido de cambios cancelado: ${saved.title}`, operador: req.user.nombre || req.user.email, origen: 'Pedidos de cambios', siteCode: auditSite(req.user.id, req.siteCode) });
  res.json({ ok: true, item: requestView(saved) });
});

changeRequestsRouter.delete('/requests/:id', (req, res) => {
  const request = getOwnRequest(req.params.id, req.user.id);
  if (!request) return fail(res, 404, NOT_FOUND);
  if (request.status !== 'draft') return fail(res, 409, 'Solo se pueden descartar borradores.');
  getDb().prepare("DELETE FROM change_requests WHERE id=? AND status='draft'").run(request.id);
  removeImages(request.images);
  res.json({ ok: true });
});

function sendImage(res, request, imageId) {
  const image = request?.images.find(item => item.id === String(imageId || ''));
  if (!image) return fail(res, 404, 'No encontramos esa captura.');
  res.set('Cache-Control', 'private, max-age=3600');
  res.set('X-Content-Type-Options', 'nosniff');
  res.type(image.mime);
  res.sendFile(imageFilePath(image), error => {
    if (error && !res.headersSent) fail(res, 404, 'No encontramos esa captura.');
  });
}

changeRequestsRouter.get('/requests/:id/images/:imageId', (req, res) => {
  const request = getOwnRequest(req.params.id, req.user.id);
  if (!request) return fail(res, 404, NOT_FOUND);
  sendImage(res, request, req.params.imageId);
});

// ---------- Admin ----------

const ADMIN_COOKIE = 'techasset_requests_admin';
const ADMIN_SESSION_MS = 12 * HOUR;

// Token sin estado: vencimiento + HMAC con una clave derivada de la contraseña.
// Cambiar REQUESTS_ADMIN_PASSWORD invalida todas las sesiones de admin.
function adminKey() {
  return crypto.createHash('sha256').update(`techasset-requests-admin:${config.requestsAdminPassword}`).digest();
}

function signAdminToken(expires) {
  return `${expires}.${crypto.createHmac('sha256', adminKey()).update(String(expires)).digest('hex')}`;
}

function validAdminToken(token) {
  if (!config.requestsAdminPassword || !token) return false;
  const [expires] = String(token).split('.');
  if (!(Number(expires) > Date.now())) return false;
  const expected = Buffer.from(signAdminToken(expires));
  const given = Buffer.from(String(token));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

function samePassword(given) {
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(config.requestsAdminPassword).digest();
  return crypto.timingSafeEqual(a, b);
}

function requireRequestsAdmin(req, res, next) {
  if (validAdminToken(req.cookies?.[ADMIN_COOKIE])) {
    req.requestsAdmin = { nombre: 'Desarrollo', email: '' };
    return next();
  }
  const session = getUserSession(req);
  if (session && isSuperadmin(session.user)) {
    req.requestsAdmin = { nombre: session.user.nombre || session.user.email, email: session.user.email };
    return next();
  }
  return fail(res, 401, 'Necesitás la sesión de administración.');
}

changeRequestsAdminRouter.post('/admin/login', (req, res) => {
  if (!config.requestsAdminPassword) return fail(res, 503, 'La API de administración no está configurada (falta REQUESTS_ADMIN_PASSWORD).');
  if (tooMany(`admin-login:${req.ip}`, 10, 15 * 60 * 1000)) return fail(res, 429, 'Demasiados intentos. Esperá 15 minutos.');
  if (!samePassword(req.body?.password)) return fail(res, 401, 'Contraseña incorrecta.');
  const expires = Date.now() + ADMIN_SESSION_MS;
  res.cookie(ADMIN_COOKIE, signAdminToken(expires), {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.sessionCookieSecure,
    path: '/api/admin',
    maxAge: ADMIN_SESSION_MS
  });
  res.json({ ok: true, expiresAt: new Date(expires).toISOString() });
});

changeRequestsAdminRouter.post('/admin/logout', (_req, res) => {
  res.clearCookie(ADMIN_COOKIE, { path: '/api/admin' });
  res.json({ ok: true });
});

function adminView(row) {
  const request = readRequestRow(row);
  return {
    ...requestView(request),
    siteCode: row.site_code || '',
    requester: { id: row.user_id, nombre: row.user_nombre || '', email: row.user_email || '' }
  };
}

const ADMIN_SELECT = `
  SELECT r.*, u.nombre AS user_nombre, u.email AS user_email
  FROM change_requests r LEFT JOIN users u ON u.id=r.user_id`;

function adminRequest(id) {
  const row = getDb().prepare(`${ADMIN_SELECT} WHERE r.id=? AND r.status<>'draft'`).get(String(id || ''));
  return row || null;
}

changeRequestsAdminRouter.get('/admin/requests', requireRequestsAdmin, (req, res) => {
  const status = String(req.query.status || '').trim();
  let rows;
  if (status === 'all') {
    rows = getDb().prepare(`${ADMIN_SELECT} WHERE r.status<>'draft' ORDER BY r.submitted_at DESC LIMIT 500`).all();
  } else if (status && status !== 'draft' && REQUEST_STATUSES.includes(status)) {
    rows = getDb().prepare(`${ADMIN_SELECT} WHERE r.status=? ORDER BY r.submitted_at DESC LIMIT 500`).all(status);
  } else if (status) {
    return fail(res, 400, 'Estado inválido. Usá pending, in_progress, done, discarded o all.');
  } else {
    rows = getDb().prepare(`${ADMIN_SELECT} WHERE r.status IN ('pending','in_progress') ORDER BY r.submitted_at ASC LIMIT 500`).all();
  }
  res.json({ ok: true, items: rows.map(adminView) });
});

changeRequestsAdminRouter.get('/admin/requests/:id', requireRequestsAdmin, (req, res) => {
  const row = adminRequest(req.params.id);
  if (!row) return fail(res, 404, NOT_FOUND);
  res.json({ ok: true, item: adminView(row) });
});

changeRequestsAdminRouter.patch('/admin/requests/:id', requireRequestsAdmin, (req, res) => {
  const row = adminRequest(req.params.id);
  if (!row) return fail(res, 404, NOT_FOUND);
  const request = readRequestRow(row);
  const fields = {};
  if (req.body?.status !== undefined) {
    const status = String(req.body.status);
    if (status === 'draft' || !REQUEST_STATUSES.includes(status)) return fail(res, 400, 'Estado inválido. Usá pending, in_progress, done o discarded.');
    fields.status = status;
    fields.resolved_at = status === 'done' || status === 'discarded' ? (request.status === status && request.resolved_at ? request.resolved_at : nowIso()) : '';
  }
  if (req.body?.note !== undefined) {
    const note = String(req.body.note || '').trim();
    if (note.length > REQUEST_LIMITS.textChars) return fail(res, 400, `La nota puede tener hasta ${REQUEST_LIMITS.textChars} caracteres.`);
    fields.note = note;
  }
  if (!Object.keys(fields).length) return fail(res, 400, 'Mandá status y/o note.');
  saveRequest(request, fields);
  if (fields.status && fields.status !== request.status) {
    addLocalMovement({ tipo: 'pedido', descripcion: `Pedido de cambios "${request.title}": ${request.status} → ${fields.status}`, operador: req.requestsAdmin.nombre, origen: 'Pedidos de cambios', siteCode: auditSite(request.user_id, request.site_code) });
  }
  res.json({ ok: true, item: adminView(adminRequest(request.id)) });
});

changeRequestsAdminRouter.get('/admin/requests/:id/images/:imageId', requireRequestsAdmin, (req, res) => {
  const row = adminRequest(req.params.id);
  if (!row) return fail(res, 404, NOT_FOUND);
  sendImage(res, readRequestRow(row), req.params.imageId);
});

// Prende o apaga la sección para una cuenta. No toca nada más del usuario.
changeRequestsAdminRouter.post('/admin/requests-access', requireRequestsAdmin, (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email) return fail(res, 400, 'Falta el mail.');
  const enabled = req.body?.enabled === true || req.body?.enabled === 'true' || req.body?.enabled === 1;
  const user = getDb().prepare('SELECT id, email, nombre FROM users WHERE lower(email)=?').get(email);
  if (!user) return fail(res, 404, 'Ese mail todavía no entró nunca a TechAsset. Tiene que iniciar sesión una vez y después lo habilitás.');
  getDb().prepare('UPDATE users SET can_request_changes=?, updated_at=? WHERE id=?').run(enabled ? 1 : 0, nowIso(), user.id);
  addLocalMovement({ tipo: 'permiso', descripcion: `Pedidos de cambios ${enabled ? 'habilitado' : 'deshabilitado'} para ${user.email}`, operador: req.requestsAdmin.nombre, origen: 'Pedidos de cambios', siteCode: auditSite(user.id) });
  res.json({ ok: true, email: user.email, nombre: user.nombre || '', enabled });
});
