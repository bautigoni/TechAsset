import { Router } from 'express';
import { getDb, nowIso } from '../db.js';
import { canEditModule, isSiteManager, requireSite } from '../services/siteContext.service.js';
import { notifyUser } from '../services/notifications.service.js';

export const remindersRouter = Router();
const RELATED = new Set(['device', 'classroom', 'ticket', 'loan', 'task', 'purchase', 'suggestion', 'group', 'knowledge']);

remindersRouter.get('/reminders', (req, res) => {
  const siteCode = requireSite(req);
  const where = ['site_code=?', 'active=1'];
  const params = [siteCode];
  if (req.query.status) { where.push('status=?'); params.push(String(req.query.status)); }
  if (req.query.relatedType) { where.push('related_type=?'); params.push(String(req.query.relatedType)); }
  if (req.query.relatedId) { where.push('related_id=?'); params.push(String(req.query.relatedId)); }
  const rows = getDb().prepare(`SELECT * FROM reminders WHERE ${where.join(' AND ')} ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END, remind_at, id DESC`).all(...params);
  res.json({ ok: true, items: rows.map(rowToReminder) });
});

remindersRouter.post('/reminders', (req, res) => {
  const siteCode = requireSite(req);
  const title = String(req.body?.title || '').trim();
  const remindAt = normalizeDate(req.body?.remindAt);
  if (!title || !remindAt) return res.status(400).json({ ok: false, error: 'Completá título y fecha del recordatorio.' });
  const relatedType = RELATED.has(String(req.body?.relatedType || '')) ? String(req.body.relatedType) : '';
  const ownerEmail = String(req.body?.ownerEmail || req.user?.email || '').trim().toLowerCase();
  const ts = nowIso();
  const info = getDb().prepare(`
    INSERT INTO reminders (site_code,title,description,remind_at,owner_email,owner_name,priority,related_type,related_id,related_label,status,created_by_email,created_by_name,active,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?, 'pending',?,?,1,?,?)
  `).run(siteCode, title, String(req.body?.description || '').trim(), remindAt, ownerEmail, String(req.body?.ownerName || '').trim(), priority(req.body?.priority), relatedType, String(req.body?.relatedId || '').trim(), String(req.body?.relatedLabel || '').trim(), String(req.user?.email || '').toLowerCase(), req.user?.nombre || '', ts, ts);
  const item = rowToReminder(getDb().prepare('SELECT * FROM reminders WHERE id=?').get(info.lastInsertRowid));
  if (ownerEmail && ownerEmail !== String(req.user?.email || '').toLowerCase()) notifyUser({ siteCode, email: ownerEmail, kind: 'reminder.assigned', title: 'Te asignaron un recordatorio', body: title, link: `/sede/${siteCode.toLowerCase()}/reminders` });
  res.json({ ok: true, item });
});

remindersRouter.patch('/reminders/:id', (req, res) => {
  const row = editableReminder(req, res); if (!row) return;
  const title = String(req.body?.title ?? row.title).trim();
  const remindAt = normalizeDate(req.body?.remindAt ?? row.remind_at);
  if (!title || !remindAt) return res.status(400).json({ ok: false, error: 'Completá título y fecha.' });
  const relatedType = RELATED.has(String(req.body?.relatedType ?? row.related_type)) ? String(req.body?.relatedType ?? row.related_type) : '';
  getDb().prepare(`UPDATE reminders SET title=?,description=?,remind_at=?,owner_email=?,owner_name=?,priority=?,related_type=?,related_id=?,related_label=?,notification_sent_at='',updated_at=? WHERE id=? AND site_code=?`)
    .run(title, String(req.body?.description ?? row.description), remindAt, String(req.body?.ownerEmail ?? row.owner_email).toLowerCase(), String(req.body?.ownerName ?? row.owner_name), priority(req.body?.priority ?? row.priority), relatedType, String(req.body?.relatedId ?? row.related_id), String(req.body?.relatedLabel ?? row.related_label), nowIso(), row.id, row.site_code);
  res.json({ ok: true, item: rowToReminder(getDb().prepare('SELECT * FROM reminders WHERE id=?').get(row.id)) });
});

remindersRouter.post('/reminders/:id/complete', (req, res) => {
  const row = editableReminder(req, res); if (!row) return;
  const ts = nowIso();
  getDb().prepare("UPDATE reminders SET status='completed',completed_at=?,completed_by=?,updated_at=? WHERE id=? AND site_code=?")
    .run(ts, req.user?.nombre || req.user?.email || '', ts, row.id, row.site_code);
  res.json({ ok: true, item: rowToReminder(getDb().prepare('SELECT * FROM reminders WHERE id=?').get(row.id)) });
});

remindersRouter.post('/reminders/:id/postpone', (req, res) => {
  const row = editableReminder(req, res); if (!row) return;
  const remindAt = normalizeDate(req.body?.remindAt);
  if (!remindAt) return res.status(400).json({ ok: false, error: 'Elegí una nueva fecha.' });
  getDb().prepare("UPDATE reminders SET remind_at=?,status='pending',notification_sent_at='',updated_at=? WHERE id=? AND site_code=?")
    .run(remindAt, nowIso(), row.id, row.site_code);
  res.json({ ok: true, item: rowToReminder(getDb().prepare('SELECT * FROM reminders WHERE id=?').get(row.id)) });
});

remindersRouter.delete('/reminders/:id', (req, res) => {
  const row = editableReminder(req, res); if (!row) return;
  getDb().prepare('UPDATE reminders SET active=0,updated_at=? WHERE id=? AND site_code=?').run(nowIso(), row.id, row.site_code);
  res.json({ ok: true, deleted: true });
});

function editableReminder(req, res) {
  const siteCode = requireSite(req);
  const row = getDb().prepare('SELECT * FROM reminders WHERE id=? AND site_code=? AND active=1').get(req.params.id, siteCode);
  if (!row) { res.status(404).json({ ok: false, error: 'Recordatorio no encontrado.' }); return null; }
  const email = String(req.user?.email || '').toLowerCase();
  if (row.created_by_email !== email && row.owner_email !== email && !isSiteManager(req, siteCode) && !canEditModule(req, 'tasks', siteCode)) {
    res.status(403).json({ ok: false, error: 'No podés modificar este recordatorio.' }); return null;
  }
  return row;
}

function rowToReminder(row) { return { id: Number(row.id), siteCode: row.site_code, title: row.title, description: row.description || '', remindAt: row.remind_at, ownerEmail: row.owner_email || '', ownerName: row.owner_name || '', priority: row.priority || 'Media', relatedType: row.related_type || '', relatedId: row.related_id || '', relatedLabel: row.related_label || '', status: row.status || 'pending', createdByEmail: row.created_by_email || '', createdByName: row.created_by_name || '', completedAt: row.completed_at || '', createdAt: row.created_at || '', updatedAt: row.updated_at || '' }; }
function priority(value) { const v = String(value || 'Media'); return ['Baja','Media','Alta','Urgente'].includes(v) ? v : 'Media'; }
function normalizeDate(value) { const date = new Date(String(value || '')); return Number.isNaN(date.getTime()) ? '' : date.toISOString(); }
