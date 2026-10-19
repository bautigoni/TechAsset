import { Router } from 'express';
import { getDb, nowIso } from '../db.js';
import { config } from '../config.js';
import { canEditModule, isSiteManager, requireSite } from '../services/siteContext.service.js';
import { notifyUser, sendPush } from '../services/notifications.service.js';

export const remindersRouter = Router();
const RELATED = new Set(['device', 'classroom', 'ticket', 'loan', 'task', 'purchase', 'suggestion', 'group', 'knowledge']);

/** Lo que hace falta para decir, por fila, si es tuyo y si lo podés tocar. Se calcula una vez por request. */
function viewerOf(req, siteCode) {
  const email = String(req.user?.email || '').toLowerCase();
  return { email, power: isSiteManager(req, siteCode) || canEditModule(req, 'tasks', siteCode) };
}

remindersRouter.get('/reminders', (req, res) => {
  const siteCode = requireSite(req);
  const where = ['site_code=?', 'active=1'];
  const params = [siteCode];
  if (req.query.status) {
    where.push('status=?');
    params.push(String(req.query.status));
  }
  if (req.query.relatedType) {
    where.push('related_type=?');
    params.push(String(req.query.relatedType));
  }
  if (req.query.relatedId) {
    where.push('related_id=?');
    params.push(String(req.query.relatedId));
  }
  const rows = getDb()
    .prepare(
      `SELECT * FROM reminders WHERE ${where.join(' AND ')} ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END, remind_at, id DESC`
    )
    .all(...params);
  const viewer = viewerOf(req, siteCode);
  res.json({ ok: true, items: rows.map(row => rowToReminder(row, viewer)) });
});

// Personas de la sede para elegir el responsable (nombre + mail). Una consulta;
// no se pollea (la pantalla la pide al abrir el formulario).
remindersRouter.get('/reminders/people', (req, res) => {
  const siteCode = requireSite(req);
  const rows = getDb()
    .prepare(
      `SELECT lower(au.email) AS email, au.nombre AS nombre
       FROM allowed_users au
       JOIN allowed_user_sites aus ON aus.allowed_user_id=au.id
       WHERE upper(aus.site_code)=? AND aus.activo=1 AND au.activo=1 AND COALESCE(au.deleted_at,'')='' AND COALESCE(au.email,'')<>''
       ORDER BY nombre, email`
    )
    .all(String(siteCode).toUpperCase());
  const seen = new Set();
  const items = [];
  for (const row of rows) {
    if (seen.has(row.email)) continue;
    seen.add(row.email);
    items.push({ email: row.email, name: String(row.nombre || '').trim() || row.email });
  }
  res.json({ ok: true, items, me: String(req.user?.email || '').toLowerCase() });
});

remindersRouter.post('/reminders', (req, res) => {
  const siteCode = requireSite(req);
  const title = String(req.body?.title || '').trim();
  const remindAt = normalizeDate(req.body?.remindAt);
  if (!title || !remindAt) return res.status(400).json({ ok: false, error: 'Completá título y fecha del recordatorio.' });
  const relatedType = RELATED.has(String(req.body?.relatedType || '')) ? String(req.body.relatedType) : '';
  const ownerEmail = String(req.body?.ownerEmail || req.user?.email || '')
    .trim()
    .toLowerCase();
  const ts = nowIso();
  const info = getDb()
    .prepare(
      `
    INSERT INTO reminders (site_code,title,description,remind_at,owner_email,owner_name,priority,related_type,related_id,related_label,status,created_by_email,created_by_name,active,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?, 'pending',?,?,1,?,?)
  `
    )
    .run(
      siteCode,
      title,
      String(req.body?.description || '').trim(),
      remindAt,
      ownerEmail,
      String(req.body?.ownerName || '').trim(),
      priority(req.body?.priority),
      relatedType,
      String(req.body?.relatedId || '').trim(),
      String(req.body?.relatedLabel || '').trim(),
      String(req.user?.email || '').toLowerCase(),
      req.user?.nombre || '',
      ts,
      ts
    );
  const item = rowToReminder(getDb().prepare('SELECT * FROM reminders WHERE id=?').get(info.lastInsertRowid), viewerOf(req, siteCode));
  if (ownerEmail && ownerEmail !== String(req.user?.email || '').toLowerCase())
    notifyUser({
      siteCode,
      email: ownerEmail,
      kind: 'reminder.assigned',
      title: 'Te asignaron un recordatorio',
      body: title,
      link: `/sede/${siteCode.toLowerCase()}/reminders`
    });
  res.json({ ok: true, item });
});

// Probar el aviso push en los dispositivos del usuario (no manda mail).
remindersRouter.post('/reminders/push-test', async (req, res) => {
  const email = String(req.user?.email || '').toLowerCase();
  if (!email) return res.status(401).json({ ok: false, error: 'Sesión vencida.' });
  const available = Boolean(config.vapid?.publicKey && config.vapid?.privateKey);
  const subs = getDb().prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE lower(user_email)=?').all(email);
  if (!available) return res.json({ ok: true, available, subscriptions: subs.length, sent: 0 });
  const results = await Promise.all(subs.map(sub => sendPush(sub, { title: 'Prueba de recordatorio', body: 'Si ves esto, los avisos de TechAsset llegan a este dispositivo.', link: `/sede/${String(req.siteCode || config.defaultSiteCode).toLowerCase()}/reminders` })));
  res.json({ ok: true, available, subscriptions: subs.length, sent: results.filter(Boolean).length });
});

remindersRouter.patch('/reminders/:id', (req, res) => {
  const row = editableReminder(req, res);
  if (!row) return;
  const title = String(req.body?.title ?? row.title).trim();
  const remindAt = normalizeDate(req.body?.remindAt ?? row.remind_at);
  if (!title || !remindAt) return res.status(400).json({ ok: false, error: 'Completá título y fecha.' });
  const relatedType = RELATED.has(String(req.body?.relatedType ?? row.related_type))
    ? String(req.body?.relatedType ?? row.related_type)
    : '';
  getDb()
    .prepare(
      `UPDATE reminders SET title=?,description=?,remind_at=?,owner_email=?,owner_name=?,priority=?,related_type=?,related_id=?,related_label=?,notification_sent_at='',updated_at=? WHERE id=? AND site_code=?`
    )
    .run(
      title,
      String(req.body?.description ?? row.description),
      remindAt,
      String(req.body?.ownerEmail ?? row.owner_email).toLowerCase(),
      String(req.body?.ownerName ?? row.owner_name),
      priority(req.body?.priority ?? row.priority),
      relatedType,
      String(req.body?.relatedId ?? row.related_id),
      String(req.body?.relatedLabel ?? row.related_label),
      nowIso(),
      row.id,
      row.site_code
    );
  res.json({ ok: true, item: rowToReminder(getDb().prepare('SELECT * FROM reminders WHERE id=?').get(row.id), viewerOf(req, row.site_code)) });
});

remindersRouter.post('/reminders/:id/complete', (req, res) => {
  const row = editableReminder(req, res);
  if (!row) return;
  const ts = nowIso();
  getDb()
    .prepare("UPDATE reminders SET status='completed',completed_at=?,completed_by=?,updated_at=? WHERE id=? AND site_code=?")
    .run(ts, req.user?.nombre || req.user?.email || '', ts, row.id, row.site_code);
  res.json({ ok: true, item: rowToReminder(getDb().prepare('SELECT * FROM reminders WHERE id=?').get(row.id), viewerOf(req, row.site_code)) });
});

remindersRouter.post('/reminders/:id/postpone', (req, res) => {
  const row = editableReminder(req, res);
  if (!row) return;
  const remindAt = normalizeDate(req.body?.remindAt);
  if (!remindAt) return res.status(400).json({ ok: false, error: 'Elegí una nueva fecha.' });
  getDb()
    .prepare("UPDATE reminders SET remind_at=?,status='pending',notification_sent_at='',updated_at=? WHERE id=? AND site_code=?")
    .run(remindAt, nowIso(), row.id, row.site_code);
  res.json({ ok: true, item: rowToReminder(getDb().prepare('SELECT * FROM reminders WHERE id=?').get(row.id), viewerOf(req, row.site_code)) });
});

/**
 * Deshacer: vuelve el recordatorio al estado que tenía antes de completar,
 * reabrir, posponer o borrar (lo manda la pantalla con lo que tenía en la
 * mano). Solo toca estado, fecha, aviso enviado y activo; mismos permisos que
 * modificarlo. Sirve también para "Volver a pendiente".
 */
remindersRouter.post('/reminders/:id/undo', (req, res) => {
  const row = editableReminder(req, res, { includeDeleted: true });
  if (!row) return;
  const prev = req.body?.previous || {};
  const status = prev.status === 'completed' ? 'completed' : 'pending';
  const remindAt = normalizeDate(prev.remindAt) || row.remind_at;
  const sentAt = prev.notificationSentAt ? normalizeDate(prev.notificationSentAt) : '';
  const completedAt = status === 'completed' ? normalizeDate(prev.completedAt) || nowIso() : '';
  const completedBy = status === 'completed' ? String(prev.completedBy || req.user?.nombre || req.user?.email || '') : '';
  getDb()
    .prepare('UPDATE reminders SET status=?,remind_at=?,notification_sent_at=?,completed_at=?,completed_by=?,active=1,updated_at=? WHERE id=? AND site_code=?')
    .run(status, remindAt, sentAt, completedAt, completedBy, nowIso(), row.id, row.site_code);
  res.json({ ok: true, item: rowToReminder(getDb().prepare('SELECT * FROM reminders WHERE id=?').get(row.id), viewerOf(req, row.site_code)) });
});

remindersRouter.delete('/reminders/:id', (req, res) => {
  const row = editableReminder(req, res);
  if (!row) return;
  getDb().prepare('UPDATE reminders SET active=0,updated_at=? WHERE id=? AND site_code=?').run(nowIso(), row.id, row.site_code);
  res.json({ ok: true, deleted: true });
});

function editableReminder(req, res, { includeDeleted = false } = {}) {
  const siteCode = requireSite(req);
  const row = getDb()
    .prepare(`SELECT * FROM reminders WHERE id=? AND site_code=?${includeDeleted ? '' : ' AND active=1'}`)
    .get(req.params.id, siteCode);
  if (!row) {
    res.status(404).json({ ok: false, error: 'Recordatorio no encontrado.' });
    return null;
  }
  if (!canTouch(row, viewerOf(req, siteCode))) {
    res.status(403).json({ ok: false, error: 'No podés modificar este recordatorio.' });
    return null;
  }
  return row;
}

function canTouch(row, viewer) {
  return row.created_by_email === viewer.email || row.owner_email === viewer.email || viewer.power;
}

function rowToReminder(row, viewer = { email: '', power: false }) {
  const owner = String(row.owner_email || '').toLowerCase();
  const creator = String(row.created_by_email || '').toLowerCase();
  return {
    id: Number(row.id),
    siteCode: row.site_code,
    title: row.title,
    description: row.description || '',
    remindAt: row.remind_at,
    ownerEmail: row.owner_email || '',
    ownerName: row.owner_name || '',
    priority: row.priority || 'Media',
    relatedType: row.related_type || '',
    relatedId: row.related_id || '',
    relatedLabel: row.related_label || '',
    status: row.status || 'pending',
    createdByEmail: row.created_by_email || '',
    createdByName: row.created_by_name || '',
    completedAt: row.completed_at || '',
    completedBy: row.completed_by || '',
    notificationSentAt: row.notification_sent_at || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    // Para la pantalla: "Solo los míos" y qué acciones habilitar.
    mine: Boolean(viewer.email) && (owner === viewer.email || (!owner && creator === viewer.email)),
    canEdit: canTouch(row, viewer)
  };
}
function priority(value) {
  const v = String(value || 'Media');
  return ['Baja', 'Media', 'Alta', 'Urgente'].includes(v) ? v : 'Media';
}
function normalizeDate(value) {
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}
