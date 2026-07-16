import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { getDb, nowIso } from '../db.js';
import { canEditModule, canViewModule, requireSite } from '../services/siteContext.service.js';
import { notifySiteAdmins } from '../services/notifications.service.js';
import { queueTicketSummary, refreshTicketSummary } from '../services/aiSummaries.service.js';

export const ticketsRouter = Router();

const FILE_TYPES = new Map([
  ['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/jpg', 'jpg'], ['image/webp', 'webp'], ['application/pdf', 'pdf']
]);
const ESTADOS = new Set(['No hecho', 'En proceso', 'Hecho']);
const PRIORIDADES = new Set(['Baja', 'Media', 'Alta', 'Urgente']);
const ORIGENES = new Set(['tik', 'handing']);

ticketsRouter.get('/tickets', (req, res) => {
  const siteCode = requireSite(req);
  if (!canViewModule(req, 'tickets', siteCode)) return forbidden(res);
  const rows = getDb().prepare(`
    SELECT * FROM tickets
    WHERE site_code=? AND COALESCE(activo,1)=1 AND (deleted_at IS NULL OR TRIM(deleted_at)='')
    ORDER BY CASE estado WHEN 'No hecho' THEN 0 WHEN 'En proceso' THEN 1 ELSE 2 END, updated_at DESC, id DESC
  `).all(siteCode);
  res.json({ ok: true, items: rows.map(rowToTicket) });
});

ticketsRouter.get('/ticket-templates', (req, res) => {
  const siteCode = requireSite(req);
  if (!canViewModule(req, 'tickets', siteCode)) return forbidden(res);
  res.json({ ok: true, items: getDb().prepare('SELECT * FROM ticket_templates WHERE site_code=? AND active=1 ORDER BY title,id').all(siteCode).map(rowToTemplate) });
});

ticketsRouter.post('/ticket-templates', (req, res) => {
  const siteCode = requireSite(req);
  if (!canEditModule(req, 'tickets', siteCode)) return forbidden(res);
  const item = normalizeTemplate(req.body);
  if (!item.title) return res.status(400).json({ ok: false, error: 'La plantilla necesita un título.' });
  const ts = nowIso();
  const info = getDb().prepare(`
    INSERT INTO ticket_templates (site_code,title,description,priority,category,suggested_assignee,checklist_json,tags_json,created_by,active,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,1,?,?)
  `).run(siteCode, item.title, item.description, item.priority, item.category, item.suggestedAssignee, JSON.stringify(item.checklist), JSON.stringify(item.tags), actor(req), ts, ts);
  res.json({ ok: true, item: rowToTemplate(getDb().prepare('SELECT * FROM ticket_templates WHERE id=? AND site_code=?').get(info.lastInsertRowid, siteCode)) });
});

ticketsRouter.patch('/ticket-templates/:id', (req, res) => {
  const siteCode = requireSite(req);
  if (!canEditModule(req, 'tickets', siteCode)) return forbidden(res);
  const old = getDb().prepare('SELECT * FROM ticket_templates WHERE id=? AND site_code=? AND active=1').get(req.params.id, siteCode);
  if (!old) return res.status(404).json({ ok: false, error: 'Plantilla no encontrada.' });
  const item = normalizeTemplate({ ...rowToTemplate(old), ...req.body });
  getDb().prepare('UPDATE ticket_templates SET title=?,description=?,priority=?,category=?,suggested_assignee=?,checklist_json=?,tags_json=?,updated_at=? WHERE id=? AND site_code=?')
    .run(item.title, item.description, item.priority, item.category, item.suggestedAssignee, JSON.stringify(item.checklist), JSON.stringify(item.tags), nowIso(), req.params.id, siteCode);
  res.json({ ok: true, item: rowToTemplate(getDb().prepare('SELECT * FROM ticket_templates WHERE id=? AND site_code=?').get(req.params.id, siteCode)) });
});

ticketsRouter.delete('/ticket-templates/:id', (req, res) => {
  const siteCode = requireSite(req);
  if (!canEditModule(req, 'tickets', siteCode)) return forbidden(res);
  const result = getDb().prepare('UPDATE ticket_templates SET active=0,updated_at=? WHERE id=? AND site_code=?').run(nowIso(), req.params.id, siteCode);
  res.json({ ok: true, deleted: result.changes > 0 });
});

ticketsRouter.post('/tickets/upload-image', (req, res) => {
  const siteCode = requireSite(req);
  if (!canEditModule(req, 'tickets', siteCode)) return forbidden(res);
  const dataUrl = String(req.body?.dataUrl || '').trim();
  const fileName = String(req.body?.fileName || 'ticket').trim();
  const match = dataUrl.match(/^data:(image\/(?:png|jpe?g|webp)|application\/pdf);base64,(.+)$/i);
  if (!match) return res.status(400).json({ ok: false, error: 'Formato no soportado. Usá PDF, PNG, JPG, JPEG o WEBP.' });
  const ext = FILE_TYPES.get(match[1].toLowerCase());
  const buffer = Buffer.from(match[2], 'base64');
  if (!ext || !buffer.length) return res.status(400).json({ ok: false, error: 'Archivo inválido.' });
  if (buffer.length > Math.max(1, config.maxUploadMb) * 1024 * 1024) return res.status(413).json({ ok: false, error: `El archivo supera ${config.maxUploadMb} MB.` });
  const uploadDir = path.join(config.rootDir, 'data', 'uploads', 'tickets', siteCode);
  fs.mkdirSync(uploadDir, { recursive: true });
  const baseName = sanitizeFileName(fileName).replace(/\.[a-z0-9]+$/i, '') || 'ticket';
  const storedName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${baseName}.${ext}`;
  fs.writeFileSync(path.join(uploadDir, storedName), buffer);
  res.json({ ok: true, url: `/uploads/tickets/${siteCode}/${storedName}` });
});

ticketsRouter.post('/tickets', (req, res) => {
  const siteCode = requireSite(req);
  if (!canEditModule(req, 'tickets', siteCode)) return forbidden(res);
  const payload = normalizeTicketPayload(req.body);
  if (payload.origen === 'tik' && !payload.numero) return res.status(400).json({ ok: false, error: 'Cargá el número de ticket Tik/InVgate.' });
  const template = payload.templateId ? getDb().prepare('SELECT * FROM ticket_templates WHERE id=? AND site_code=? AND active=1').get(payload.templateId, siteCode) : null;
  const checklist = payload.checklist.length ? payload.checklist : safeArray(template?.checklist_json);
  const operador = actor(req);
  const ts = nowIso();
  const info = getDb().prepare(`
    INSERT INTO tickets (site_code,numero,titulo,descripcion,estado,prioridad,responsables_json,categoria,imagen_url,nota,origen,tags_json,template_id,classroom,classroom_key,school,creado_por,operador_ultimo_cambio,activo,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)
  `).run(siteCode, payload.numero, payload.titulo, payload.descripcion, payload.estado, payload.prioridad, JSON.stringify(payload.responsables), payload.categoria, payload.imagenUrl, payload.nota, payload.origen, JSON.stringify(payload.tags), payload.templateId || null, payload.classroom, payload.classroomKey, payload.school, operador, operador, ts, ts);
  const ticketId = info.lastInsertRowid;
  insertChecklist(siteCode, ticketId, checklist, ts);
  addActivity(siteCode, ticketId, 'Ticket creado', payload.titulo, req);
  queueTicketSummary(ticketId, siteCode);
  try { notifySiteAdmins({ siteCode, kind: 'ticket.created', title: payload.origen === 'handing' ? 'Nuevo ticket Handing' : `Nuevo ticket #${payload.numero}`, body: payload.titulo || `Cargado por ${operador}`, link: `/sede/${siteCode}/tickets`, exceptEmail: req.user?.email }); } catch { /* noop */ }
  res.json({ ok: true, item: rowToTicket(getDb().prepare('SELECT * FROM tickets WHERE id=? AND site_code=?').get(ticketId, siteCode)) });
});

ticketsRouter.get('/tickets/:id/detail', (req, res) => {
  const siteCode = requireSite(req);
  if (!canViewModule(req, 'tickets', siteCode)) return forbidden(res);
  const row = getDb().prepare('SELECT * FROM tickets WHERE id=? AND site_code=? AND activo=1').get(req.params.id, siteCode);
  if (!row) return res.status(404).json({ ok: false, error: 'Ticket no encontrado.' });
  const comments = getDb().prepare("SELECT * FROM ticket_comments WHERE ticket_id=? AND site_code=? AND COALESCE(deleted_at,'')='' ORDER BY id").all(req.params.id, siteCode).map(rowToComment);
  const activity = getDb().prepare('SELECT * FROM ticket_activity WHERE ticket_id=? AND site_code=? ORDER BY id DESC LIMIT 100').all(req.params.id, siteCode).map(rowToActivity);
  const checklist = getDb().prepare('SELECT * FROM ticket_checklist_items WHERE ticket_id=? AND site_code=? ORDER BY position,id').all(req.params.id, siteCode).map(rowToChecklist);
  res.json({ ok: true, item: rowToTicket(row), comments, activity, checklist, related: relatedTickets(req.params.id, siteCode) });
});

ticketsRouter.patch('/tickets/:id', (req, res) => {
  const siteCode = requireSite(req);
  if (!canEditModule(req, 'tickets', siteCode)) return forbidden(res);
  const old = getDb().prepare('SELECT * FROM tickets WHERE id=? AND site_code=?').get(req.params.id, siteCode);
  if (!old) return res.status(404).json({ ok: false, error: 'Ticket no encontrado.' });
  const payload = normalizeTicketPayload({ ...rowToTicket(old), ...req.body });
  const ts = nowIso();
  const resolvedAt = payload.estado === 'Hecho' ? (old.resolved_at || ts) : '';
  getDb().prepare(`
    UPDATE tickets SET numero=?,titulo=?,descripcion=?,estado=?,prioridad=?,responsables_json=?,categoria=?,imagen_url=?,nota=?,origen=?,tags_json=?,template_id=?,classroom=?,classroom_key=?,school=?,resolved_at=?,operador_ultimo_cambio=?,updated_at=?
    WHERE id=? AND site_code=?
  `).run(payload.numero, payload.titulo, payload.descripcion, payload.estado, payload.prioridad, JSON.stringify(payload.responsables), payload.categoria, payload.imagenUrl, payload.nota, payload.origen, JSON.stringify(payload.tags), payload.templateId || null, payload.classroom, payload.classroomKey, payload.school, resolvedAt, actor(req), ts, req.params.id, siteCode);
  const action = old.estado !== payload.estado ? `Estado: ${old.estado} → ${payload.estado}` : 'Ticket editado';
  addActivity(siteCode, req.params.id, action, payload.nota, req);
  queueTicketSummary(req.params.id, siteCode);
  if (old.estado !== payload.estado) try { notifySiteAdmins({ siteCode, kind: 'ticket.updated', title: `Ticket #${payload.numero}: ${payload.estado}`, body: payload.titulo, link: `/sede/${siteCode}/tickets`, exceptEmail: req.user?.email }); } catch { /* noop */ }
  res.json({ ok: true, item: rowToTicket(getDb().prepare('SELECT * FROM tickets WHERE id=? AND site_code=?').get(req.params.id, siteCode)) });
});

ticketsRouter.delete('/tickets/:id', (req, res) => {
  const siteCode = requireSite(req);
  if (!canEditModule(req, 'tickets', siteCode)) return forbidden(res);
  const ts = nowIso();
  const result = getDb().prepare('UPDATE tickets SET activo=0,deleted_at=?,deleted_by=?,updated_at=? WHERE id=? AND site_code=?').run(ts, actor(req), ts, req.params.id, siteCode);
  res.json({ ok: true, deleted: result.changes > 0 });
});

ticketsRouter.post('/tickets/:id/relations', (req, res) => {
  const siteCode = requireSite(req);
  if (!canEditModule(req, 'tickets', siteCode)) return forbidden(res);
  const currentId = Number(req.params.id);
  const otherId = Number(req.body?.ticketId);
  const relationType = req.body?.relationType === 'parent' ? 'parent' : 'related';
  if (!currentId || !otherId || currentId === otherId) return res.status(400).json({ ok: false, error: 'Elegí otro ticket válido.' });
  const exists = getDb().prepare('SELECT id FROM tickets WHERE id=? AND site_code=? AND activo=1').get(otherId, siteCode);
  if (!exists) return res.status(404).json({ ok: false, error: 'El ticket relacionado no existe en esta sede.' });
  let a = currentId; let b = otherId;
  if (relationType === 'related' && a > b) [a, b] = [b, a];
  const duplicate = getDb().prepare('SELECT id FROM ticket_relations WHERE site_code=? AND ((ticket_a_id=? AND ticket_b_id=?) OR (ticket_a_id=? AND ticket_b_id=?))').get(siteCode, a, b, b, a);
  if (!duplicate) getDb().prepare('INSERT INTO ticket_relations (site_code,ticket_a_id,ticket_b_id,relation_type,created_by,created_at) VALUES (?,?,?,?,?,?)').run(siteCode, a, b, relationType, actor(req), nowIso());
  addActivity(siteCode, currentId, relationType === 'parent' ? 'Ticket padre vinculado' : 'Ticket relacionado', `#${otherId}`, req);
  try { notifySiteAdmins({ siteCode, kind: 'ticket.related', title: 'Tickets vinculados', body: `#${currentId} ↔ #${otherId}`, link: `/sede/${siteCode}/tickets`, exceptEmail: req.user?.email }); } catch { /* noop */ }
  res.json({ ok: true, items: relatedTickets(currentId, siteCode) });
});

ticketsRouter.delete('/tickets/:id/relations/:relationId', (req, res) => {
  const siteCode = requireSite(req);
  if (!canEditModule(req, 'tickets', siteCode)) return forbidden(res);
  const result = getDb().prepare('DELETE FROM ticket_relations WHERE id=? AND site_code=? AND (ticket_a_id=? OR ticket_b_id=?)').run(req.params.relationId, siteCode, req.params.id, req.params.id);
  res.json({ ok: true, deleted: result.changes > 0 });
});

ticketsRouter.post('/tickets/:id/comments', (req, res) => {
  const siteCode = requireSite(req);
  if (!canEditModule(req, 'tickets', siteCode)) return forbidden(res);
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ ok: false, error: 'El comentario está vacío.' });
  const ticket = getDb().prepare('SELECT * FROM tickets WHERE id=? AND site_code=? AND activo=1').get(req.params.id, siteCode);
  if (!ticket) return res.status(404).json({ ok: false, error: 'Ticket no encontrado.' });
  const ts = nowIso();
  const info = getDb().prepare('INSERT INTO ticket_comments (site_code,ticket_id,body,author_email,author_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(siteCode, req.params.id, body, req.user?.email || '', actor(req), ts, ts);
  if (!ticket.first_response_at) getDb().prepare('UPDATE tickets SET first_response_at=?,updated_at=? WHERE id=? AND site_code=?').run(ts, ts, req.params.id, siteCode);
  addActivity(siteCode, req.params.id, 'Comentario agregado', body.slice(0, 180), req);
  queueTicketSummary(req.params.id, siteCode);
  try { notifySiteAdmins({ siteCode, kind: 'ticket.comment', title: `Nuevo comentario en #${ticket.numero || ticket.id}`, body: body.slice(0, 140), link: `/sede/${siteCode}/tickets`, exceptEmail: req.user?.email }); } catch { /* noop */ }
  res.json({ ok: true, item: rowToComment(getDb().prepare('SELECT * FROM ticket_comments WHERE id=?').get(info.lastInsertRowid)) });
});

ticketsRouter.post('/tickets/:id/checklist', (req, res) => {
  const siteCode = requireSite(req);
  if (!canEditModule(req, 'tickets', siteCode)) return forbidden(res);
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ ok: false, error: 'La tarea está vacía.' });
  const position = Number(getDb().prepare('SELECT COALESCE(MAX(position),-1) value FROM ticket_checklist_items WHERE ticket_id=? AND site_code=?').get(req.params.id, siteCode).value) + 1;
  const info = getDb().prepare('INSERT INTO ticket_checklist_items (site_code,ticket_id,text,done,position,created_at) VALUES (?,?,?,0,?,?)').run(siteCode, req.params.id, text, position, nowIso());
  queueTicketSummary(req.params.id, siteCode);
  res.json({ ok: true, item: rowToChecklist(getDb().prepare('SELECT * FROM ticket_checklist_items WHERE id=?').get(info.lastInsertRowid)) });
});

ticketsRouter.patch('/tickets/:id/checklist/:itemId', (req, res) => {
  const siteCode = requireSite(req);
  if (!canEditModule(req, 'tickets', siteCode)) return forbidden(res);
  const old = getDb().prepare('SELECT * FROM ticket_checklist_items WHERE id=? AND ticket_id=? AND site_code=?').get(req.params.itemId, req.params.id, siteCode);
  if (!old) return res.status(404).json({ ok: false, error: 'Ítem no encontrado.' });
  const done = req.body?.done == null ? Number(old.done) : (req.body.done ? 1 : 0);
  const text = String(req.body?.text ?? old.text).trim();
  getDb().prepare('UPDATE ticket_checklist_items SET text=?,done=?,completed_by=?,completed_at=? WHERE id=? AND ticket_id=? AND site_code=?').run(text, done, done ? actor(req) : '', done ? (old.completed_at || nowIso()) : '', req.params.itemId, req.params.id, siteCode);
  addActivity(siteCode, req.params.id, done ? 'Checklist completado' : 'Checklist reabierto', text, req);
  queueTicketSummary(req.params.id, siteCode);
  res.json({ ok: true, item: rowToChecklist(getDb().prepare('SELECT * FROM ticket_checklist_items WHERE id=?').get(req.params.itemId)) });
});

ticketsRouter.delete('/tickets/:id/checklist/:itemId', (req, res) => {
  const siteCode = requireSite(req);
  if (!canEditModule(req, 'tickets', siteCode)) return forbidden(res);
  const result = getDb().prepare('DELETE FROM ticket_checklist_items WHERE id=? AND ticket_id=? AND site_code=?').run(req.params.itemId, req.params.id, siteCode);
  queueTicketSummary(req.params.id, siteCode);
  res.json({ ok: true, deleted: result.changes > 0 });
});

ticketsRouter.post('/tickets/:id/summary', async (req, res, next) => {
  try {
    const siteCode = requireSite(req);
    if (!canViewModule(req, 'tickets', siteCode)) return forbidden(res);
    const summary = await refreshTicketSummary(req.params.id, siteCode, { force: true });
    if (summary == null) return res.status(404).json({ ok: false, error: 'Ticket no encontrado.' });
    res.json({ ok: true, summary, updatedAt: nowIso() });
  } catch (error) { next(error); }
});

function normalizeTicketPayload(raw = {}) {
  return {
    numero: String(raw.numero || '').trim(), titulo: String(raw.titulo || '').trim(), descripcion: String(raw.descripcion || '').trim(),
    estado: ESTADOS.has(String(raw.estado)) ? String(raw.estado) : 'No hecho',
    prioridad: PRIORIDADES.has(String(raw.prioridad)) ? String(raw.prioridad) : 'Media',
    responsables: normalizeStrings(raw.responsables ?? raw.responsablesJson), categoria: String(raw.categoria || '').trim(),
    imagenUrl: String(raw.imagenUrl || raw.imagen_url || '').trim(), nota: String(raw.nota || '').trim(),
    origen: ORIGENES.has(String(raw.origen)) ? String(raw.origen) : 'tik', tags: normalizeStrings(raw.tags),
    templateId: Number(raw.templateId || raw.template_id || 0) || null, checklist: normalizeStrings(raw.checklist),
    classroom: String(raw.classroom || raw.aula || '').trim(), classroomKey: String(raw.classroomKey || raw.classroom_key || '').trim(), school: String(raw.school || raw.escuela || '').trim()
  };
}

function normalizeTemplate(raw = {}) {
  return { title: String(raw.title || '').trim(), description: String(raw.description || '').trim(), priority: PRIORIDADES.has(String(raw.priority)) ? String(raw.priority) : 'Media', category: String(raw.category || '').trim(), suggestedAssignee: String(raw.suggestedAssignee || raw.suggested_assignee || '').trim(), checklist: normalizeStrings(raw.checklist), tags: normalizeStrings(raw.tags) };
}

function rowToTicket(row) {
  return { id: Number(row.id), siteCode: row.site_code, numero: row.numero || '', titulo: row.titulo || '', descripcion: row.descripcion || '', estado: row.estado || 'No hecho', prioridad: row.prioridad || 'Media', responsables: safeArray(row.responsables_json), categoria: row.categoria || '', imagenUrl: row.imagen_url || '', nota: row.nota || '', origen: ORIGENES.has(String(row.origen)) ? row.origen : 'tik', tags: safeArray(row.tags_json), templateId: row.template_id || null, classroom: row.classroom || '', classroomKey: row.classroom_key || '', school: row.school || '', aiSummary: row.ai_summary || '', aiSummaryUpdatedAt: row.ai_summary_updated_at || '', firstResponseAt: row.first_response_at || '', resolvedAt: row.resolved_at || '', creadoPor: row.creado_por || '', operadorUltimoCambio: row.operador_ultimo_cambio || '', createdAt: row.created_at || '', updatedAt: row.updated_at || '' };
}
function rowToTemplate(row) { return { id: Number(row.id), title: row.title, description: row.description || '', priority: row.priority || 'Media', category: row.category || '', suggestedAssignee: row.suggested_assignee || '', checklist: safeArray(row.checklist_json), tags: safeArray(row.tags_json), createdBy: row.created_by || '', createdAt: row.created_at || '', updatedAt: row.updated_at || '' }; }
function rowToComment(row) { return { id: Number(row.id), ticketId: Number(row.ticket_id), body: row.body, authorEmail: row.author_email || '', authorName: row.author_name || '', createdAt: row.created_at || '' }; }
function rowToActivity(row) { return { id: Number(row.id), action: row.action, detail: row.detail || '', actorEmail: row.actor_email || '', actorName: row.actor_name || '', createdAt: row.created_at || '' }; }
function rowToChecklist(row) { return { id: Number(row.id), ticketId: Number(row.ticket_id), text: row.text, done: Boolean(row.done), position: Number(row.position || 0), completedBy: row.completed_by || '', completedAt: row.completed_at || '' }; }

function relatedTickets(ticketId, siteCode) {
  const rows = getDb().prepare(`
    SELECT r.id AS relationId,r.relation_type,r.ticket_a_id,r.ticket_b_id,t.*
    FROM ticket_relations r
    JOIN tickets t ON t.id=CASE WHEN r.ticket_a_id=? THEN r.ticket_b_id ELSE r.ticket_a_id END AND t.site_code=r.site_code
    WHERE r.site_code=? AND (r.ticket_a_id=? OR r.ticket_b_id=?) AND t.activo=1
    ORDER BY t.updated_at DESC
  `).all(ticketId, siteCode, ticketId, ticketId);
  return rows.map(row => ({ relationId: Number(row.relationId), relationType: row.relation_type, role: row.relation_type === 'parent' ? (Number(row.ticket_a_id) === Number(ticketId) ? 'parent' : 'child') : 'related', ticket: rowToTicket(row) }));
}

function insertChecklist(siteCode, ticketId, items, ts) {
  const insert = getDb().prepare('INSERT INTO ticket_checklist_items (site_code,ticket_id,text,done,position,created_at) VALUES (?,?,?,0,?,?)');
  items.forEach((text, index) => insert.run(siteCode, ticketId, String(text), index, ts));
}
function addActivity(siteCode, ticketId, action, detail, req) { getDb().prepare('INSERT INTO ticket_activity (site_code,ticket_id,action,detail,actor_email,actor_name,created_at) VALUES (?,?,?,?,?,?,?)').run(siteCode, ticketId, action, String(detail || ''), req.user?.email || '', actor(req), nowIso()); queueTicketSummary(ticketId, siteCode); }
function actor(req) { return req.user?.nombre || req.user?.email || 'Sistema'; }
function normalizeStrings(value) { if (Array.isArray(value)) return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))].slice(0, 40); if (typeof value === 'string' && value.trim().startsWith('[')) return safeArray(value); return String(value || '').split(',').map(item => item.trim()).filter(Boolean).slice(0, 40); }
function safeArray(value) { try { const parsed = typeof value === 'string' ? JSON.parse(value || '[]') : value; return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []; } catch { return []; } }
function sanitizeFileName(name) { return String(name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-').slice(0, 60); }
function forbidden(res) { return res.status(403).json({ ok: false, error: 'No tenés permiso para usar tickets.' }); }
