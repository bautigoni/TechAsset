import { Router } from 'express';
import { getDb, nowIso, rowToTask, rowToTaskItem } from '../db.js';
import { requireSite } from '../services/siteContext.service.js';

export const tasksRouter = Router();
const STATES = new Set(['Pendiente', 'En proceso', 'Hecha']);
const RESPONSABLES = new Set(['Bauti', 'Equi']);

tasksRouter.get('/tasks', (_req, res) => {
  const rows = getDb().prepare("SELECT * FROM tasks WHERE eliminada=0 AND site_code=? ORDER BY CASE estado WHEN 'Pendiente' THEN 1 WHEN 'En proceso' THEN 2 ELSE 3 END, fecha_creacion DESC").all(requireSite(_req));
  res.json({ ok: true, items: rows.map(rowToTask), loadedAt: nowIso() });
});

tasksRouter.get('/tareas', (_req, res) => {
  const rows = getDb().prepare("SELECT * FROM tasks WHERE eliminada=0 AND site_code=? ORDER BY fecha_creacion DESC").all(requireSite(_req));
  res.json({ ok: true, items: rows.map(rowToTask), loadedAt: nowIso() });
});

tasksRouter.get('/tareas/:id', (req, res) => {
  const row = getDb().prepare('SELECT * FROM tasks WHERE id=? AND eliminada=0 AND site_code=?').get(req.params.id, requireSite(req));
  if (!row) return res.status(404).json({ ok: false, error: 'Tarea no encontrada.' });
  res.json({ ok: true, item: rowToTask(row) });
});

tasksRouter.post('/tasks', (req, res) => {
  const db = getDb();
  const siteCode = requireSite(req);
  const payload = normalizeTaskPayload(req.body);
  const id = payload.id || `TK${Date.now()}`;
  const ts = nowIso();
  db.prepare(`
    INSERT INTO tasks (id, site_code, titulo, descripcion, responsable, responsables_json, estado, prioridad, tipo, turno, fecha_creacion, fecha_vencimiento, comentario, creado_por, operador_ultimo_cambio, agenda_id, ultima_modificacion)
    VALUES (@id, @siteCode, @titulo, @descripcion, @responsable, @responsablesJson, @estado, @prioridad, @tipo, @turno, @ts, @fechaVencimiento, @comentario, @operator, @operator, @agendaId, @ts)
  `).run({ ...payload, id, ts, siteCode });
  db.prepare('INSERT INTO task_history (task_id, site_code, timestamp, titulo, accion, responsable, estado_anterior, estado_nuevo, comentario, operador, agenda_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, siteCode, ts, payload.titulo, 'tarea creada', payload.responsable, '', payload.estado, payload.comentario, payload.operator, payload.agendaId);
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
  const payload = normalizeTaskPayload({ ...oldItem, ...req.body, id: req.params.id });
  const ts = nowIso();
  db.prepare(`
    UPDATE tasks SET titulo=@titulo, descripcion=@descripcion, responsable=@responsable, responsables_json=@responsablesJson, estado=@estado, prioridad=@prioridad,
      tipo=@tipo, turno=@turno, fecha_vencimiento=@fechaVencimiento, comentario=@comentario, operador_ultimo_cambio=@operator,
      agenda_id=@agendaId, ultima_modificacion=@ts WHERE id=@id AND site_code=@siteCode
  `).run({ ...payload, ts, siteCode });
  db.prepare('INSERT INTO task_history (task_id, site_code, timestamp, titulo, accion, responsable, estado_anterior, estado_nuevo, comentario, operador, agenda_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.params.id, siteCode, ts, payload.titulo, payload.estado === oldItem.estado ? 'tarea modificada' : 'tarea movida', payload.responsable, oldItem.estado, payload.estado, payload.comentario, payload.operator, payload.agendaId);
  res.json({ ok: true, item: rowToTask(db.prepare('SELECT * FROM tasks WHERE id=? AND site_code=?').get(req.params.id, siteCode)) });
});

tasksRouter.delete('/tasks/:id', (req, res) => {
  const db = getDb();
  const siteCode = requireSite(req);
  const old = db.prepare('SELECT * FROM tasks WHERE id=? AND eliminada=0 AND site_code=?').get(req.params.id, siteCode);
  if (!old) return res.status(404).json({ ok: false, error: 'Tarea no encontrada.' });
  const operator = req.body?.operator || '';
  const ts = nowIso();
  db.prepare('UPDATE tasks SET eliminada=1, operador_ultimo_cambio=?, ultima_modificacion=? WHERE id=? AND site_code=?').run(operator, ts, req.params.id, siteCode);
  db.prepare('INSERT INTO task_history (task_id, site_code, timestamp, titulo, accion, responsable, estado_anterior, estado_nuevo, comentario, operador, agenda_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.params.id, siteCode, ts, old.titulo, 'tarea borrada', old.responsable, old.estado, old.estado, old.comentario, operator, old.agenda_id);
  res.json({ ok: true, id: req.params.id });
});

tasksRouter.get('/tasks/history', (_req, res) => {
  res.json({ ok: true, items: getDb().prepare('SELECT * FROM task_history WHERE site_code=? ORDER BY id DESC LIMIT 200').all(requireSite(_req)) });
});

tasksRouter.get('/tasks/analytics', (_req, res) => {
  const rows = getDb().prepare('SELECT * FROM tasks WHERE eliminada=0 AND site_code=?').all(requireSite(_req)).map(rowToTask);
  const assistants = ['Bauti', 'Equi'].map(name => {
    const assigned = rows.filter(task => task.responsables?.includes(name) || task.responsable === name);
    const done = assigned.filter(task => task.estado === 'Hecha').length;
    return { name, assigned: assigned.length, pending: assigned.filter(task => task.estado === 'Pendiente').length, progress: assigned.filter(task => task.estado === 'En proceso').length, done, resolution: assigned.length ? Math.round(done / assigned.length * 100) : 0 };
  });
  res.json({ ok: true, assistants });
});

tasksRouter.get('/tasks/:id/items', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM task_items WHERE task_id=? AND site_code=? ORDER BY orden, id').all(req.params.id, requireSite(req));
  res.json({ ok: true, items: rows.map(rowToTaskItem) });
});

tasksRouter.post('/tasks/:id/items', (req, res) => {
  const db = getDb();
  const siteCode = requireSite(req);
  const task = db.prepare('SELECT * FROM tasks WHERE id=? AND eliminada=0 AND site_code=?').get(req.params.id, siteCode);
  if (!task) return res.status(404).json({ ok: false, error: 'Tarea no encontrada.' });
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
  const result = getDb().prepare('DELETE FROM task_items WHERE id=? AND task_id=? AND site_code=?').run(req.params.itemId, req.params.taskId, requireSite(req));
  res.json({ ok: true, deleted: result.changes > 0 });
});

tasksRouter.get('/tasks/export.csv', (_req, res) => {
  const rows = getDb().prepare('SELECT * FROM tasks WHERE eliminada=0 AND site_code=? ORDER BY fecha_creacion DESC').all(requireSite(_req));
  res.type('text/csv').send(toCsv(rows));
});

function normalizeTaskPayload(raw) {
  const responsables = normalizeResponsables(raw.responsables || raw.responsable);
  return {
    id: raw.id || '',
    titulo: raw.titulo || 'Tarea sin título',
    descripcion: raw.descripcion || '',
    responsable: responsables.join(','),
    responsables,
    responsablesJson: JSON.stringify(responsables),
    estado: STATES.has(raw.estado) ? raw.estado : 'Pendiente',
    prioridad: raw.prioridad || 'Media',
    tipo: raw.tipo || 'Soporte',
    turno: normalizeTurno(raw.turno),
    fechaVencimiento: raw.fechaVencimiento || raw.fecha_vencimiento || '',
    comentario: raw.comentario || '',
    agendaId: raw.agendaId || raw.agenda_id || '',
    operator: raw.operator || raw.operador || ''
  };
}

function normalizeResponsables(value) {
  const raw = Array.isArray(value) ? value : String(value || 'Bauti').split(/,| y |\/|\+/i);
  const flat = raw.map(item => String(item).trim()).flatMap(item => item === 'Ambos' ? ['Bauti', 'Equi'] : item).filter(item => RESPONSABLES.has(item));
  return [...new Set(flat.length ? flat : ['Bauti'])];
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
