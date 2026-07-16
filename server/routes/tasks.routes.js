import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { getDb, nowIso, rowToTask, rowToTaskItem } from '../db.js';
import { canEditModule, requireSite } from '../services/siteContext.service.js';
import { notifySiteAdmins, notifyUser } from '../services/notifications.service.js';

export const tasksRouter = Router();
const STATES = new Set(['Pendiente', 'En proceso', 'Hecha']);
const TASK_UPLOAD_EXTENSIONS = new Map([
  ['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'], ['image/gif', 'gif'],
  ['application/pdf', 'pdf'], ['text/plain', 'txt'],
  ['application/msword', 'doc'], ['application/vnd.ms-excel', 'xls'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx']
]);

tasksRouter.get('/tasks', (req, res) => {
  const siteCode = requireSite(req);
  ensureTaskColumns(siteCode, req.user?.nombre || req.user?.email || '');
  const email = String(req.user?.email || '').toLowerCase();
  const name = String(req.user?.nombre || '').toLowerCase();
  const space = String(req.query.space || 'all');
  const rows = getDb().prepare("SELECT * FROM tasks WHERE eliminada=0 AND site_code=? ORDER BY fecha_creacion DESC").all(siteCode)
    .map(rowToTask)
    .filter(task => canSeeTask(task, email))
    .filter(task => space === 'team' ? task.visibility === 'team' : space === 'my' ? isMine(task, email, name) : true)
    .sort((a, b) => Number(a.done) - Number(b.done) || String(b.fechaCreacion || '').localeCompare(String(a.fechaCreacion || '')));
  res.json({ ok: true, items: rows, loadedAt: nowIso(), space });
});

tasksRouter.get('/tareas', (req, res) => {
  req.url = '/tasks';
  tasksRouter.handle(req, res);
});

tasksRouter.get('/tareas/:id', (req, res) => {
  const row = getDb().prepare('SELECT * FROM tasks WHERE id=? AND eliminada=0 AND site_code=?').get(req.params.id, requireSite(req));
  if (!row) return res.status(404).json({ ok: false, error: 'Tarea no encontrada.' });
  const item = rowToTask(row);
  if (!canSeeTask(item, String(req.user?.email || '').toLowerCase())) return res.status(404).json({ ok: false, error: 'Tarea no encontrada.' });
  res.json({ ok: true, item });
});

tasksRouter.post('/tasks/upload', (req, res) => {
  const siteCode = requireSite(req);
  if (!canEditModule(req, 'tasks', siteCode)) return res.status(403).json({ ok: false, error: 'No tenés permiso para adjuntar archivos.' });
  const mimeType = String(req.body?.mimeType || '').toLowerCase();
  const extension = TASK_UPLOAD_EXTENSIONS.get(mimeType);
  const raw = String(req.body?.base64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!extension || !raw) return res.status(400).json({ ok: false, error: 'Tipo de archivo no permitido.' });
  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length || buffer.length > config.maxUploadMb * 1024 * 1024) return res.status(400).json({ ok: false, error: `El archivo supera ${config.maxUploadMb} MB.` });
  const directory = path.join(config.rootDir, 'data', 'uploads', 'tasks', siteCode);
  fs.mkdirSync(directory, { recursive: true });
  const storedName = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}.${extension}`;
  fs.writeFileSync(path.join(directory, storedName), buffer);
  res.json({ ok: true, attachment: { name: String(req.body?.name || storedName).slice(0, 180), url: `/uploads/tasks/${siteCode}/${storedName}`, mimeType } });
});

tasksRouter.post('/tasks', (req, res) => {
  const db = getDb();
  const siteCode = requireSite(req);
  ensureTaskColumns(siteCode, req.user?.nombre || req.user?.email || '');
  const payload = normalizeTaskPayload(req.body, siteCode);
  payload.visibility = payload.visibility === 'private' ? 'private' : 'team';
  payload.ownerEmail = payload.visibility === 'private' ? String(req.user?.email || '').toLowerCase() : '';
  if (payload.visibility === 'private' && !payload.ownerEmail) return res.status(400).json({ ok: false, error: 'No se pudo identificar al propietario de la tarea privada.' });
  const id = payload.id || `TK${Date.now()}`;
  const ts = nowIso();
  db.prepare(`
    INSERT INTO tasks (id, site_code, titulo, descripcion, responsable, responsables_json, assignee_emails_json, estado, column_id, visibility, owner_email, prioridad, tipo, turno, fecha_creacion, fecha_vencimiento, comentario, attachments_json, creado_por, operador_ultimo_cambio, agenda_id, ultima_modificacion)
    VALUES (@id, @siteCode, @titulo, @descripcion, @responsable, @responsablesJson, @assigneeEmailsJson, @estado, @columnId, @visibility, @ownerEmail, @prioridad, @tipo, @turno, @ts, @fechaVencimiento, @comentario, @attachmentsJson, @operator, @operator, @agendaId, @ts)
  `).run({ ...payload, id, ts, siteCode });
  db.prepare('INSERT INTO task_history (task_id, site_code, timestamp, titulo, accion, responsable, estado_anterior, estado_nuevo, comentario, operador, agenda_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, siteCode, ts, payload.titulo, 'tarea creada', payload.responsable, '', payload.estado, payload.comentario, payload.operator, payload.agendaId);
  try {
    notifyTaskAssignees({ req, siteCode, taskId: id, payload, kind: 'task.assigned', title: `Te asignaron: ${payload.titulo}`, body: `Asignada por ${payload.operator || req.user?.nombre || 'el equipo'}` });
    if (payload.visibility === 'team') {
    notifySiteAdmins({
      siteCode, kind: 'task.created',
      title: `Nueva tarea: ${payload.titulo}`,
      body: `Cargada por ${payload.operator || 'alguien del equipo'}`,
      link: `/sede/${siteCode}/tasks`,
      exceptEmail: req.user?.email
    });
    }
  } catch { /* las notificaciones no deben bloquear la creación */ }
  res.json({ ok: true, item: rowToTask(db.prepare('SELECT * FROM tasks WHERE id=? AND site_code=?').get(id, siteCode)) });
});

tasksRouter.post('/tareas', (req, res) => {
  req.url = '/tasks';
  tasksRouter.handle(req, res);
});

tasksRouter.put('/tareas/:id', (req, res) => {
  req.url = `/tasks/${req.params.id}`;
  req.method = 'PATCH';
  tasksRouter.handle(req, res);
});

tasksRouter.delete('/tareas/:id', (req, res) => {
  req.url = `/tasks/${req.params.id}`;
  req.method = 'DELETE';
  tasksRouter.handle(req, res);
});

tasksRouter.patch('/tasks/:id', (req, res) => {
  const db = getDb();
  const siteCode = requireSite(req);
  const old = db.prepare('SELECT * FROM tasks WHERE id=? AND eliminada=0 AND site_code=?').get(req.params.id, siteCode);
  if (!old) return res.status(404).json({ ok: false, error: 'Tarea no encontrada.' });
  const oldItem = rowToTask(old);
  if (!canSeeTask(oldItem, String(req.user?.email || '').toLowerCase())) return res.status(404).json({ ok: false, error: 'Tarea no encontrada.' });
  if (oldItem.visibility === 'private' && oldItem.ownerEmail !== String(req.user?.email || '').toLowerCase()) return res.status(403).json({ ok: false, error: 'Solo el propietario puede modificar esta tarea privada.' });
  const payload = normalizeTaskPayload({ ...oldItem, ...req.body, id: req.params.id }, siteCode);
  payload.visibility = oldItem.visibility;
  payload.ownerEmail = oldItem.ownerEmail;
  const ts = nowIso();
  db.prepare(`
    UPDATE tasks SET titulo=@titulo, descripcion=@descripcion, responsable=@responsable, responsables_json=@responsablesJson, assignee_emails_json=@assigneeEmailsJson, estado=@estado, column_id=@columnId, prioridad=@prioridad,
      tipo=@tipo, turno=@turno, fecha_vencimiento=@fechaVencimiento, comentario=@comentario, attachments_json=@attachmentsJson, operador_ultimo_cambio=@operator,
      agenda_id=@agendaId, ultima_modificacion=@ts WHERE id=@id AND site_code=@siteCode
  `).run({ ...payload, ts, siteCode });
  db.prepare('INSERT INTO task_history (task_id, site_code, timestamp, titulo, accion, responsable, estado_anterior, estado_nuevo, comentario, operador, agenda_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.params.id, siteCode, ts, payload.titulo, payload.estado === oldItem.estado ? 'tarea modificada' : 'tarea movida', payload.responsable, oldItem.estado, payload.estado, payload.comentario, payload.operator, payload.agendaId);
  try {
    const oldEmails = new Set(oldItem.assigneeEmails || []);
    const added = payload.assigneeEmails.filter(email => !oldEmails.has(email));
    notifyTaskAssignees({ req, siteCode, taskId: req.params.id, payload: { ...payload, assigneeEmails: added }, kind: 'task.assigned', title: `Te asignaron: ${payload.titulo}`, body: `Asignada por ${payload.operator || req.user?.nombre || 'el equipo'}` });
    if (payload.estado !== oldItem.estado && payload.visibility === 'team') notifyTaskFollowers({ req, siteCode, task: { ...oldItem, ...payload }, kind: 'task.moved', title: `Tarea movida a ${payload.estado}`, body: payload.titulo });
  } catch { /* noop */ }
  res.json({ ok: true, item: rowToTask(db.prepare('SELECT * FROM tasks WHERE id=? AND site_code=?').get(req.params.id, siteCode)) });
});

tasksRouter.delete('/tasks/:id', (req, res) => {
  const db = getDb();
  const siteCode = requireSite(req);
  const old = db.prepare('SELECT * FROM tasks WHERE id=? AND eliminada=0 AND site_code=?').get(req.params.id, siteCode);
  if (!old) return res.status(404).json({ ok: false, error: 'Tarea no encontrada.' });
  const oldItem = rowToTask(old);
  if (!canSeeTask(oldItem, String(req.user?.email || '').toLowerCase())) return res.status(404).json({ ok: false, error: 'Tarea no encontrada.' });
  if (oldItem.visibility === 'private' && oldItem.ownerEmail !== String(req.user?.email || '').toLowerCase()) return res.status(403).json({ ok: false, error: 'Solo el propietario puede borrar esta tarea privada.' });
  const operator = req.body?.operator || '';
  const ts = nowIso();
  db.prepare('UPDATE tasks SET eliminada=1, operador_ultimo_cambio=?, ultima_modificacion=? WHERE id=? AND site_code=?').run(operator, ts, req.params.id, siteCode);
  db.prepare('INSERT INTO task_history (task_id, site_code, timestamp, titulo, accion, responsable, estado_anterior, estado_nuevo, comentario, operador, agenda_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.params.id, siteCode, ts, old.titulo, 'tarea borrada', old.responsable, old.estado, old.estado, old.comentario, operator, old.agenda_id);
  res.json({ ok: true, id: req.params.id });
});

tasksRouter.get('/tasks/history', (req, res) => {
  const siteCode = requireSite(req);
  const email = String(req.user?.email || '').toLowerCase();
  const items = getDb().prepare(`
    SELECT h.* FROM task_history h
    JOIN tasks t ON t.id=h.task_id AND t.site_code=h.site_code
    WHERE h.site_code=? AND (COALESCE(t.visibility,'team')<>'private' OR lower(t.owner_email)=?)
    ORDER BY h.id DESC LIMIT 200
  `).all(siteCode, email);
  res.json({ ok: true, items });
});

tasksRouter.get('/tasks/analytics', (_req, res) => {
  const siteCode = requireSite(_req);
  const rows = getDb().prepare("SELECT * FROM tasks WHERE eliminada=0 AND site_code=? AND COALESCE(visibility,'team')<>'private'").all(siteCode).map(rowToTask);
  const names = getSiteAssistantNames(siteCode);
  const fallback = Array.from(new Set(rows.flatMap(task => task.responsables?.length ? task.responsables : String(task.responsable || '').split(',').map(item => item.trim())).filter(Boolean)));
  const assistants = (names.length ? names : fallback).map(name => {
    const assigned = rows.filter(task => task.responsables?.includes(name) || task.responsable === name);
    const done = assigned.filter(task => task.estado === 'Hecha').length;
    return { name, assigned: assigned.length, pending: assigned.filter(task => task.estado === 'Pendiente').length, progress: assigned.filter(task => task.estado === 'En proceso').length, done, resolution: assigned.length ? Math.round(done / assigned.length * 100) : 0 };
  });
  res.json({ ok: true, assistants });
});

tasksRouter.get('/task-columns', (req, res) => {
  const siteCode = requireSite(req);
  ensureTaskColumns(siteCode, req.user?.nombre || req.user?.email || '');
  res.json({ ok: true, items: getDb().prepare('SELECT * FROM task_columns WHERE site_code=? AND active=1 ORDER BY position, id').all(siteCode).map(rowToColumn) });
});

tasksRouter.post('/task-columns', (req, res) => {
  const siteCode = requireSite(req);
  if (!canEditModule(req, 'tasks', siteCode)) return res.status(403).json({ ok: false, error: 'No tenés permiso para configurar columnas.' });
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ ok: false, error: 'La columna necesita un nombre.' });
  const existing = getDb().prepare('SELECT id FROM task_columns WHERE site_code=? AND lower(name)=lower(?)').get(siteCode, name);
  if (existing) return res.status(409).json({ ok: false, error: 'Ya existe una columna con ese nombre.' });
  const position = Number(getDb().prepare('SELECT COALESCE(MAX(position),-1) AS value FROM task_columns WHERE site_code=? AND active=1').get(siteCode).value) + 1;
  const ts = nowIso();
  const info = getDb().prepare('INSERT INTO task_columns (site_code, name, color, position, is_done, active, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)')
    .run(siteCode, name, String(req.body?.color || '#64748b'), position, req.body?.isDone ? 1 : 0, req.user?.nombre || req.user?.email || '', ts, ts);
  res.json({ ok: true, item: rowToColumn(getDb().prepare('SELECT * FROM task_columns WHERE id=?').get(info.lastInsertRowid)) });
});

tasksRouter.patch('/task-columns/reorder', (req, res) => {
  const siteCode = requireSite(req);
  if (!canEditModule(req, 'tasks', siteCode)) return res.status(403).json({ ok: false, error: 'No tenés permiso para configurar columnas.' });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : [];
  const update = getDb().prepare('UPDATE task_columns SET position=?, updated_at=? WHERE id=? AND site_code=? AND active=1');
  const ts = nowIso();
  getDb().transaction(() => ids.forEach((id, index) => update.run(index, ts, id, siteCode)))();
  res.json({ ok: true, items: getDb().prepare('SELECT * FROM task_columns WHERE site_code=? AND active=1 ORDER BY position, id').all(siteCode).map(rowToColumn) });
});

tasksRouter.patch('/task-columns/:id', (req, res) => {
  const siteCode = requireSite(req);
  if (!canEditModule(req, 'tasks', siteCode)) return res.status(403).json({ ok: false, error: 'No tenés permiso para configurar columnas.' });
  const old = getDb().prepare('SELECT * FROM task_columns WHERE id=? AND site_code=? AND active=1').get(req.params.id, siteCode);
  if (!old) return res.status(404).json({ ok: false, error: 'Columna no encontrada.' });
  const name = String(req.body?.name ?? old.name).trim();
  if (!name) return res.status(400).json({ ok: false, error: 'La columna necesita un nombre.' });
  const duplicate = getDb().prepare('SELECT id FROM task_columns WHERE site_code=? AND lower(name)=lower(?) AND id<>?').get(siteCode, name, old.id);
  if (duplicate) return res.status(409).json({ ok: false, error: 'Ya existe una columna con ese nombre.' });
  getDb().transaction(() => {
    getDb().prepare('UPDATE task_columns SET name=?, color=?, is_done=?, updated_at=? WHERE id=? AND site_code=?').run(name, String(req.body?.color ?? old.color), req.body?.isDone == null ? old.is_done : (req.body.isDone ? 1 : 0), nowIso(), old.id, siteCode);
    if (name !== old.name) getDb().prepare('UPDATE tasks SET estado=?, ultima_modificacion=? WHERE column_id=? AND site_code=?').run(name, nowIso(), old.id, siteCode);
  })();
  res.json({ ok: true, item: rowToColumn(getDb().prepare('SELECT * FROM task_columns WHERE id=?').get(old.id)) });
});

tasksRouter.delete('/task-columns/:id', (req, res) => {
  const siteCode = requireSite(req);
  if (!canEditModule(req, 'tasks', siteCode)) return res.status(403).json({ ok: false, error: 'No tenés permiso para configurar columnas.' });
  const columns = getDb().prepare('SELECT * FROM task_columns WHERE site_code=? AND active=1 ORDER BY position, id').all(siteCode);
  const old = columns.find(column => Number(column.id) === Number(req.params.id));
  if (!old) return res.status(404).json({ ok: false, error: 'Columna no encontrada.' });
  if (columns.length === 1) return res.status(400).json({ ok: false, error: 'El tablero debe conservar al menos una columna.' });
  const fallback = columns.find(column => column.id !== old.id);
  getDb().transaction(() => {
    getDb().prepare('UPDATE tasks SET column_id=?, estado=?, ultima_modificacion=? WHERE column_id=? AND site_code=?').run(fallback.id, fallback.name, nowIso(), old.id, siteCode);
    getDb().prepare('UPDATE task_columns SET active=0, updated_at=? WHERE id=? AND site_code=?').run(nowIso(), old.id, siteCode);
  })();
  res.json({ ok: true, deleted: true, fallback: rowToColumn(fallback) });
});

tasksRouter.get('/tasks/:id/comments', (req, res) => {
  const siteCode = requireSite(req);
  const taskRow = getDb().prepare('SELECT * FROM tasks WHERE id=? AND site_code=? AND eliminada=0').get(req.params.id, siteCode);
  if (!taskRow) return res.status(404).json({ ok: false, error: 'Tarea no encontrada.' });
  const task = rowToTask(taskRow);
  if (!canSeeTask(task, String(req.user?.email || '').toLowerCase())) return res.status(404).json({ ok: false, error: 'Tarea no encontrada.' });
  const items = getDb().prepare("SELECT * FROM task_comments WHERE task_id=? AND site_code=? AND COALESCE(deleted_at,'')='' ORDER BY id").all(req.params.id, siteCode).map(rowToComment);
  res.json({ ok: true, items });
});

tasksRouter.post('/tasks/:id/comments', (req, res) => {
  const siteCode = requireSite(req);
  const taskRow = getDb().prepare('SELECT * FROM tasks WHERE id=? AND site_code=? AND eliminada=0').get(req.params.id, siteCode);
  if (!taskRow) return res.status(404).json({ ok: false, error: 'Tarea no encontrada.' });
  const task = rowToTask(taskRow);
  if (!canSeeTask(task, String(req.user?.email || '').toLowerCase())) return res.status(404).json({ ok: false, error: 'Tarea no encontrada.' });
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ ok: false, error: 'El comentario no puede estar vacío.' });
  const ts = nowIso();
  const info = getDb().prepare('INSERT INTO task_comments (task_id, site_code, body, author_email, author_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(task.id, siteCode, body, req.user?.email || '', req.user?.nombre || req.user?.email || '', ts, ts);
  try { notifyTaskFollowers({ req, siteCode, task, kind: 'task.comment', title: `Nuevo comentario en ${task.titulo}`, body: `${req.user?.nombre || req.user?.email}: ${body.slice(0, 120)}` }); } catch { /* noop */ }
  res.json({ ok: true, item: rowToComment(getDb().prepare('SELECT * FROM task_comments WHERE id=?').get(info.lastInsertRowid)) });
});

tasksRouter.get('/tasks/:id/items', (req, res) => {
  const siteCode = requireSite(req);
  const task = getDb().prepare('SELECT * FROM tasks WHERE id=? AND site_code=? AND eliminada=0').get(req.params.id, siteCode);
  if (!task || !canSeeTask(rowToTask(task), String(req.user?.email || '').toLowerCase())) return res.status(404).json({ ok: false, error: 'Tarea no encontrada.' });
  const rows = getDb().prepare('SELECT * FROM task_items WHERE task_id=? AND site_code=? ORDER BY orden, id').all(req.params.id, siteCode);
  res.json({ ok: true, items: rows.map(rowToTaskItem) });
});

tasksRouter.post('/tasks/:id/items', (req, res) => {
  const db = getDb();
  const siteCode = requireSite(req);
  const task = db.prepare('SELECT * FROM tasks WHERE id=? AND eliminada=0 AND site_code=?').get(req.params.id, siteCode);
  if (!task) return res.status(404).json({ ok: false, error: 'Tarea no encontrada.' });
  if (!canSeeTask(rowToTask(task), String(req.user?.email || '').toLowerCase())) return res.status(404).json({ ok: false, error: 'Tarea no encontrada.' });
  const texto = String(req.body?.texto || '').trim();
  if (!texto) return res.status(400).json({ ok: false, error: 'La subtarea no puede estar vacía.' });
  const ts = nowIso();
  const max = db.prepare('SELECT COALESCE(MAX(orden), 0) AS orden FROM task_items WHERE task_id=? AND site_code=?').get(req.params.id, siteCode).orden || 0;
  const info = db.prepare('INSERT INTO task_items (task_id, site_code, texto, orden, creado_por, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(req.params.id, siteCode, texto, max + 1, req.body?.operator || '', ts);
  db.prepare('INSERT INTO task_history (task_id, site_code, timestamp, titulo, accion, responsable, estado_anterior, estado_nuevo, comentario, operador, agenda_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.params.id, siteCode, ts, task.titulo, 'subtarea agregada', task.responsable, task.estado, task.estado, texto, req.body?.operator || '', task.agenda_id || '');
  res.json({ ok: true, item: rowToTaskItem(db.prepare('SELECT * FROM task_items WHERE id=?').get(info.lastInsertRowid)) });
});

tasksRouter.patch('/tasks/:taskId/items/:itemId', (req, res) => {
  const db = getDb();
  const siteCode = requireSite(req);
  const task = db.prepare('SELECT * FROM tasks WHERE id=? AND site_code=? AND eliminada=0').get(req.params.taskId, siteCode);
  if (!task || !canSeeTask(rowToTask(task), String(req.user?.email || '').toLowerCase())) return res.status(404).json({ ok: false, error: 'Tarea no encontrada.' });
  const item = db.prepare('SELECT * FROM task_items WHERE id=? AND task_id=? AND site_code=?').get(req.params.itemId, req.params.taskId, siteCode);
  if (!item) return res.status(404).json({ ok: false, error: 'Subtarea no encontrada.' });
  const nextDone = req.body.completada == null ? Boolean(item.completada) : Boolean(req.body.completada);
  const nextText = String(req.body.texto ?? item.texto).trim();
  const ts = nowIso();
  db.prepare('UPDATE task_items SET texto=?, completada=?, completado_por=?, completed_at=? WHERE id=? AND task_id=?')
    .run(nextText, nextDone ? 1 : 0, nextDone ? (req.body.operator || item.completado_por || '') : '', nextDone ? (item.completed_at || ts) : '', req.params.itemId, req.params.taskId);
  res.json({ ok: true, item: rowToTaskItem(db.prepare('SELECT * FROM task_items WHERE id=?').get(req.params.itemId)) });
});

tasksRouter.delete('/tasks/:taskId/items/:itemId', (req, res) => {
  const siteCode = requireSite(req);
  const task = getDb().prepare('SELECT * FROM tasks WHERE id=? AND site_code=? AND eliminada=0').get(req.params.taskId, siteCode);
  if (!task || !canSeeTask(rowToTask(task), String(req.user?.email || '').toLowerCase())) return res.status(404).json({ ok: false, error: 'Tarea no encontrada.' });
  const result = getDb().prepare('DELETE FROM task_items WHERE id=? AND task_id=? AND site_code=?').run(req.params.itemId, req.params.taskId, siteCode);
  res.json({ ok: true, deleted: result.changes > 0 });
});

tasksRouter.get('/tasks/export.csv', (_req, res) => {
  const email = String(_req.user?.email || '').toLowerCase();
  const rows = getDb().prepare('SELECT * FROM tasks WHERE eliminada=0 AND site_code=? ORDER BY fecha_creacion DESC').all(requireSite(_req)).filter(row => canSeeTask(rowToTask(row), email));
  res.type('text/csv').send(toCsv(rows));
});

function normalizeTaskPayload(raw, siteCode) {
  const responsables = normalizeResponsables(raw.responsables || raw.responsable || raw.operator || raw.operador);
  const assigneeEmails = Array.isArray(raw.assigneeEmails) ? raw.assigneeEmails.map(value => String(value || '').trim().toLowerCase()).filter(value => value.includes('@')) : [];
  const requestedColumn = Number(raw.columnId || raw.column_id || 0);
  const column = requestedColumn
    ? getDb().prepare('SELECT * FROM task_columns WHERE id=? AND site_code=? AND active=1').get(requestedColumn, siteCode)
    : getDb().prepare('SELECT * FROM task_columns WHERE site_code=? AND active=1 AND lower(name)=lower(?) ORDER BY position LIMIT 1').get(siteCode, String(raw.estado || 'Pendiente'))
      || getDb().prepare('SELECT * FROM task_columns WHERE site_code=? AND active=1 ORDER BY position, id LIMIT 1').get(siteCode);
  const attachments = Array.isArray(raw.attachments) ? raw.attachments.filter(item => item && typeof item === 'object').slice(0, 20) : [];
  return {
    id: raw.id || '',
    titulo: raw.titulo || 'Tarea sin título',
    descripcion: raw.descripcion || '',
    responsable: responsables.join(','),
    responsables,
    responsablesJson: JSON.stringify(responsables),
    estado: column?.name || (STATES.has(raw.estado) ? raw.estado : 'Pendiente'),
    columnId: column?.id || null,
    visibility: raw.visibility === 'private' ? 'private' : 'team',
    ownerEmail: String(raw.ownerEmail || raw.owner_email || '').toLowerCase(),
    assigneeEmails,
    assigneeEmailsJson: JSON.stringify(assigneeEmails),
    attachments,
    attachmentsJson: JSON.stringify(attachments),
    prioridad: raw.prioridad || 'Media',
    tipo: raw.tipo || 'Soporte',
    turno: normalizeTurno(raw.turno),
    fechaVencimiento: raw.fechaVencimiento || raw.fecha_vencimiento || '',
    comentario: raw.comentario || '',
    agendaId: raw.agendaId || raw.agenda_id || '',
    operator: raw.operator || raw.operador || ''
  };
}

function ensureTaskColumns(siteCode, operator = '') {
  const count = Number(getDb().prepare('SELECT COUNT(*) AS total FROM task_columns WHERE site_code=? AND active=1').get(siteCode).total || 0);
  if (count) return;
  const ts = nowIso();
  const insert = getDb().prepare('INSERT INTO task_columns (site_code, name, color, position, is_done, active, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?) ON CONFLICT(site_code, name) DO UPDATE SET active=1');
  [['Pendiente', '#3b82f6', 0, 0], ['En proceso', '#f59e0b', 1, 0], ['Hecha', '#22c55e', 2, 1]].forEach(column => insert.run(siteCode, column[0], column[1], column[2], column[3], operator, ts, ts));
}

function canSeeTask(task, email) {
  return task.visibility !== 'private' || (email && task.ownerEmail === email);
}

function isMine(task, email, name) {
  if (task.visibility === 'private') return task.ownerEmail === email;
  if (task.assigneeEmails?.includes(email)) return true;
  const names = (task.responsables || []).map(value => String(value).toLowerCase());
  return Boolean(name && names.includes(name)) || names.includes(email);
}

function rowToColumn(row) { return { id: row.id, name: row.name, color: row.color || '#64748b', position: Number(row.position || 0), isDone: Boolean(row.is_done), createdBy: row.created_by || '' }; }
function rowToComment(row) { return { id: row.id, taskId: row.task_id, body: row.body, authorEmail: row.author_email || '', authorName: row.author_name || '', createdAt: row.created_at || '', updatedAt: row.updated_at || '' }; }

function notifyTaskAssignees({ req, siteCode, taskId, payload, kind, title, body }) {
  for (const email of payload.assigneeEmails || []) {
    if (!email || email === String(req.user?.email || '').toLowerCase()) continue;
    notifyUser({ siteCode, email, kind, title, body, link: `/sede/${siteCode}/tasks`, payload: { taskId } });
  }
}

function notifyTaskFollowers({ req, siteCode, task, kind, title, body }) {
  const recipients = new Set([...(task.assigneeEmails || []), task.ownerEmail].map(value => String(value || '').toLowerCase()).filter(Boolean));
  recipients.delete(String(req.user?.email || '').toLowerCase());
  for (const email of recipients) notifyUser({ siteCode, email, kind, title, body, link: `/sede/${siteCode}/tasks`, payload: { taskId: task.id } });
}

function normalizeResponsables(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/,| y |\/|\+/i);
  const flat = raw.map(item => String(item).trim()).flatMap(item => item === 'Ambos' ? ['Compartida'] : item).filter(Boolean);
  return [...new Set(flat.length ? flat : ['Sin asignar'])];
}

function getSiteAssistantNames(siteCode) {
  const rows = getDb().prepare(`
    SELECT u.nombre AS name, u.email FROM user_sites us JOIN users u ON u.id=us.user_id
    WHERE us.site_code=? AND us.activo=1 AND u.activo=1 AND lower(COALESCE(us.site_role,'')) LIKE '%asistente%'
    UNION
    SELECT au.nombre AS name, au.email FROM allowed_user_sites aus JOIN allowed_users au ON au.id=aus.allowed_user_id
    WHERE aus.site_code=? AND aus.activo=1 AND au.activo=1 AND lower(COALESCE(aus.site_role,'')) LIKE '%asistente%'
  `).all(siteCode, siteCode);
  return [...new Set(rows.map(row => String(row.name || row.email || '').trim()).filter(Boolean))];
}

function normalizeTurno(value) {
  const raw = String(value || 'Sin turno').trim();
  return ['Mañana', 'Tarde', 'Todo el día', 'Sin turno'].includes(raw) ? raw : 'Sin turno';
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  return [headers.join(','), ...rows.map(row => headers.map(key => `"${String(row[key] ?? '').replaceAll('"', '""')}"`).join(','))].join('\n');
}
