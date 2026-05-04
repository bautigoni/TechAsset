import { Router } from 'express';
import { getDb, nowIso, rowToTask } from '../db.js';

export const tasksRouter = Router();
const STATES = new Set(['Pendiente', 'En proceso', 'Hecha']);
const RESPONSABLES = new Set(['Bauti', 'Equi']);

tasksRouter.get('/tasks', (_req, res) => {
  const rows = getDb().prepare("SELECT * FROM tasks WHERE eliminada=0 ORDER BY CASE estado WHEN 'Pendiente' THEN 1 WHEN 'En proceso' THEN 2 ELSE 3 END, fecha_creacion DESC").all();
  res.json({ ok: true, items: rows.map(rowToTask), loadedAt: nowIso() });
});

tasksRouter.get('/tareas', (_req, res) => {
  const rows = getDb().prepare("SELECT * FROM tasks WHERE eliminada=0 ORDER BY fecha_creacion DESC").all();
  res.json({ ok: true, items: rows.map(rowToTask), loadedAt: nowIso() });
});

tasksRouter.get('/tareas/:id', (req, res) => {
  const row = getDb().prepare('SELECT * FROM tasks WHERE id=? AND eliminada=0').get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'Tarea no encontrada.' });
  res.json({ ok: true, item: rowToTask(row) });
});

tasksRouter.post('/tasks', (req, res) => {
  const db = getDb();
  const payload = normalizeTaskPayload(req.body);
  const id = payload.id || `TK${Date.now()}`;
  const ts = nowIso();
  db.prepare(`
    INSERT INTO tasks (id, titulo, descripcion, responsable, estado, prioridad, tipo, fecha_creacion, fecha_vencimiento, comentario, creado_por, operador_ultimo_cambio, agenda_id, ultima_modificacion)
    VALUES (@id, @titulo, @descripcion, @responsable, @estado, @prioridad, @tipo, @ts, @fechaVencimiento, @comentario, @operator, @operator, @agendaId, @ts)
  `).run({ ...payload, id, ts });
  db.prepare('INSERT INTO task_history (task_id, timestamp, titulo, accion, responsable, estado_anterior, estado_nuevo, comentario, operador, agenda_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, ts, payload.titulo, 'tarea creada', payload.responsable, '', payload.estado, payload.comentario, payload.operator, payload.agendaId);
  res.json({ ok: true, item: rowToTask(db.prepare('SELECT * FROM tasks WHERE id=?').get(id)) });
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
  const old = db.prepare('SELECT * FROM tasks WHERE id=? AND eliminada=0').get(req.params.id);
  if (!old) return res.status(404).json({ ok: false, error: 'Tarea no encontrada.' });
  const oldItem = rowToTask(old);
  const payload = normalizeTaskPayload({ ...oldItem, ...req.body, id: req.params.id });
  const ts = nowIso();
  db.prepare(`
    UPDATE tasks SET titulo=@titulo, descripcion=@descripcion, responsable=@responsable, estado=@estado, prioridad=@prioridad,
      tipo=@tipo, fecha_vencimiento=@fechaVencimiento, comentario=@comentario, operador_ultimo_cambio=@operator,
      agenda_id=@agendaId, ultima_modificacion=@ts WHERE id=@id
  `).run({ ...payload, ts });
  db.prepare('INSERT INTO task_history (task_id, timestamp, titulo, accion, responsable, estado_anterior, estado_nuevo, comentario, operador, agenda_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.params.id, ts, payload.titulo, payload.estado === oldItem.estado ? 'tarea modificada' : 'tarea movida', payload.responsable, oldItem.estado, payload.estado, payload.comentario, payload.operator, payload.agendaId);
  res.json({ ok: true, item: rowToTask(db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id)) });
});

tasksRouter.delete('/tasks/:id', (req, res) => {
  const db = getDb();
  const old = db.prepare('SELECT * FROM tasks WHERE id=? AND eliminada=0').get(req.params.id);
  if (!old) return res.status(404).json({ ok: false, error: 'Tarea no encontrada.' });
  const operator = req.body?.operator || '';
  const ts = nowIso();
  db.prepare('UPDATE tasks SET eliminada=1, operador_ultimo_cambio=?, ultima_modificacion=? WHERE id=?').run(operator, ts, req.params.id);
  db.prepare('INSERT INTO task_history (task_id, timestamp, titulo, accion, responsable, estado_anterior, estado_nuevo, comentario, operador, agenda_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.params.id, ts, old.titulo, 'tarea borrada', old.responsable, old.estado, old.estado, old.comentario, operator, old.agenda_id);
  res.json({ ok: true, id: req.params.id });
});

tasksRouter.get('/tasks/history', (_req, res) => {
  res.json({ ok: true, items: getDb().prepare('SELECT * FROM task_history ORDER BY id DESC LIMIT 200').all() });
});

tasksRouter.get('/tasks/analytics', (_req, res) => {
  const rows = getDb().prepare('SELECT * FROM tasks WHERE eliminada=0').all().map(rowToTask);
  const assistants = ['Bauti', 'Equi'].map(name => {
    const assigned = rows.filter(task => task.responsable === name);
    const done = assigned.filter(task => task.estado === 'Hecha').length;
    return { name, assigned: assigned.length, pending: assigned.filter(task => task.estado === 'Pendiente').length, progress: assigned.filter(task => task.estado === 'En proceso').length, done, resolution: assigned.length ? Math.round(done / assigned.length * 100) : 0 };
  });
  res.json({ ok: true, assistants });
});

tasksRouter.get('/tasks/export.csv', (_req, res) => {
  const rows = getDb().prepare('SELECT * FROM tasks WHERE eliminada=0 ORDER BY fecha_creacion DESC').all();
  res.type('text/csv').send(toCsv(rows));
});

function normalizeTaskPayload(raw) {
  return {
    id: raw.id || '',
    titulo: raw.titulo || 'Tarea sin título',
    descripcion: raw.descripcion || '',
    responsable: RESPONSABLES.has(raw.responsable) ? raw.responsable : 'Bauti',
    estado: STATES.has(raw.estado) ? raw.estado : 'Pendiente',
    prioridad: raw.prioridad || 'Media',
    tipo: raw.tipo || 'Soporte',
    fechaVencimiento: raw.fechaVencimiento || raw.fecha_vencimiento || '',
    comentario: raw.comentario || '',
    agendaId: raw.agendaId || raw.agenda_id || '',
    operator: raw.operator || raw.operador || ''
  };
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  return [headers.join(','), ...rows.map(row => headers.map(key => `"${String(row[key] ?? '').replaceAll('"', '""')}"`).join(','))].join('\n');
}
