import { Router } from 'express';
import { getDb, nowIso, rowToAgenda, rowToTask } from '../db.js';

export const operationsRouter = Router();

operationsRouter.get('/internal-notes', (req, res) => {
  const filter = String(req.query.filter || 'active');
  const where = filter === 'last30'
    ? "created_at >= datetime('now','-30 days')"
    : filter === 'all'
      ? 'COALESCE(visible,1)=1'
      : 'COALESCE(visible,1)=1';
  const rows = getDb().prepare(`SELECT * FROM internal_notes WHERE ${where} ORDER BY importante DESC, id DESC LIMIT 250`).all();
  res.json({ ok: true, items: rows.map(rowToNote) });
});

operationsRouter.post('/internal-notes', (req, res) => {
  const texto = String(req.body?.texto || '').trim();
  if (!texto) return res.status(400).json({ ok: false, error: 'La nota no puede estar vacía.' });
  const ts = nowIso();
  const info = getDb().prepare('INSERT INTO internal_notes (texto, operador, categoria, importante, archivada, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
    .run(texto, req.body?.operator || req.body?.operador || '', req.body?.categoria || 'General', req.body?.importante ? 1 : 0, ts, ts);
  res.json({ ok: true, item: rowToNote(getDb().prepare('SELECT * FROM internal_notes WHERE id=?').get(info.lastInsertRowid)) });
});

operationsRouter.patch('/internal-notes/:id', (req, res) => {
  const old = getDb().prepare('SELECT * FROM internal_notes WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ ok: false, error: 'Nota no encontrada.' });
  const ts = nowIso();
  getDb().prepare('UPDATE internal_notes SET texto=?, categoria=?, importante=?, archivada=?, visible=?, deleted_at=?, deleted_by=?, updated_at=? WHERE id=?')
    .run(
      req.body.texto ?? old.texto,
      req.body.categoria ?? old.categoria,
      req.body.importante == null ? old.importante : (req.body.importante ? 1 : 0),
      req.body.archivada == null ? old.archivada : (req.body.archivada ? 1 : 0),
      req.body.visible == null ? (old.visible == null ? 1 : old.visible) : (req.body.visible ? 1 : 0),
      req.body.visible === false ? ts : (old.deleted_at || ''),
      req.body.visible === false ? (req.body.operator || req.body.operador || '') : (old.deleted_by || ''),
      ts,
      req.params.id
    );
  res.json({ ok: true, item: rowToNote(getDb().prepare('SELECT * FROM internal_notes WHERE id=?').get(req.params.id)) });
});

operationsRouter.delete('/internal-notes/:id', (req, res) => {
  const ts = nowIso();
  const operator = req.body?.operator || req.query.operator || '';
  const result = getDb().prepare('UPDATE internal_notes SET visible=0, deleted_at=?, deleted_by=?, updated_at=? WHERE id=?').run(ts, operator, ts, req.params.id);
  res.json({ ok: true, deleted: result.changes > 0 });
});

operationsRouter.get('/daily-closures', (_req, res) => {
  const rows = getDb().prepare('SELECT * FROM daily_closures ORDER BY id DESC LIMIT 100').all();
  res.json({ ok: true, items: rows.map(rowToClosure) });
});

operationsRouter.get('/daily-closures/preview', (_req, res) => {
  res.json({ ok: true, resumen: buildDailySummary() });
});

operationsRouter.post('/daily-closures', (req, res) => {
  const ts = nowIso();
  const resumen = req.body?.resumen || buildDailySummary();
  const info = getDb().prepare('INSERT INTO daily_closures (fecha, operador, resumen_json, observaciones, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(ts.slice(0, 10), req.body?.operator || req.body?.operador || '', JSON.stringify(resumen), req.body?.observaciones || '', ts);
  res.json({ ok: true, item: rowToClosure(getDb().prepare('SELECT * FROM daily_closures WHERE id=?').get(info.lastInsertRowid)) });
});

operationsRouter.get('/quick-links', (_req, res) => {
  const rows = getDb().prepare('SELECT * FROM quick_links WHERE activo=1 ORDER BY categoria, titulo').all();
  res.json({ ok: true, items: rows.map(rowToQuickLink) });
});

operationsRouter.post('/quick-links', (req, res) => {
  const payload = normalizeQuickLink(req.body);
  if (!payload.titulo || !payload.url) return res.status(400).json({ ok: false, error: 'Título y URL son obligatorios.' });
  if (!isSafeUrl(payload.url)) return res.status(400).json({ ok: false, error: 'Solo se permiten URLs http:// o https://.' });
  const ts = nowIso();
  const info = getDb().prepare('INSERT INTO quick_links (titulo, url, descripcion, categoria, icono, creado_por, activo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)')
    .run(payload.titulo, payload.url, payload.descripcion, payload.categoria, payload.icono, payload.creadoPor, ts, ts);
  res.json({ ok: true, item: rowToQuickLink(getDb().prepare('SELECT * FROM quick_links WHERE id=?').get(info.lastInsertRowid)) });
});

operationsRouter.patch('/quick-links/:id', (req, res) => {
  const old = getDb().prepare('SELECT * FROM quick_links WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ ok: false, error: 'Acceso no encontrado.' });
  const payload = normalizeQuickLink({ ...old, ...req.body });
  if (!isSafeUrl(payload.url)) return res.status(400).json({ ok: false, error: 'Solo se permiten URLs http:// o https://.' });
  getDb().prepare('UPDATE quick_links SET titulo=?, url=?, descripcion=?, categoria=?, icono=?, updated_at=? WHERE id=?')
    .run(payload.titulo, payload.url, payload.descripcion, payload.categoria, payload.icono, nowIso(), req.params.id);
  res.json({ ok: true, item: rowToQuickLink(getDb().prepare('SELECT * FROM quick_links WHERE id=?').get(req.params.id)) });
});

operationsRouter.delete('/quick-links/:id', (req, res) => {
  const result = getDb().prepare('UPDATE quick_links SET activo=0, updated_at=? WHERE id=?').run(nowIso(), req.params.id);
  res.json({ ok: true, deleted: result.changes > 0 });
});

operationsRouter.get('/settings/shifts', (_req, res) => {
  const rows = getDb().prepare("SELECT key, value FROM app_settings WHERE key IN ('shift.morningOperator','shift.afternoonOperator')").all();
  const map = Object.fromEntries(rows.map(row => [row.key, row.value]));
  res.json({ ok: true, settings: { morningOperator: map['shift.morningOperator'] || 'Bauti', afternoonOperator: map['shift.afternoonOperator'] || 'Equi' } });
});

operationsRouter.patch('/settings/shifts', (req, res) => {
  const ts = nowIso();
  const morning = req.body?.morningOperator || 'Bauti';
  const afternoon = req.body?.afternoonOperator || 'Equi';
  const stmt = getDb().prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at');
  stmt.run('shift.morningOperator', morning, ts);
  stmt.run('shift.afternoonOperator', afternoon, ts);
  res.json({ ok: true, settings: { morningOperator: morning, afternoonOperator: afternoon } });
});

function buildDailySummary() {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const tasks = db.prepare('SELECT * FROM tasks WHERE eliminada=0').all().map(rowToTask);
  const agenda = db.prepare('SELECT * FROM agenda WHERE eliminada=0').all().map(rowToAgenda);
  const notes = db.prepare("SELECT * FROM internal_notes WHERE COALESCE(visible,1)=1 AND importante=1 AND created_at LIKE ? ORDER BY id DESC").all(`${today}%`).map(rowToNote);
  const classrooms = db.prepare("SELECT room_key, nombre, piso, estado_general FROM classrooms WHERE estado_general IN ('Con observaciones','Problema') ORDER BY piso, nombre").all();
  const prestamos = db.prepare("SELECT * FROM prestamos WHERE estado='activo' ORDER BY created_at DESC").all();
  return {
    fecha: today,
    prestamosActivos: prestamos.length,
    dispositivosNoDevueltos: prestamos.map(p => p.codigo_dispositivo).filter(Boolean),
    tareasPendientes: tasks.filter(t => t.estado === 'Pendiente').length,
    tareasEnProceso: tasks.filter(t => t.estado === 'En proceso').length,
    tareasHechasHoy: tasks.filter(t => t.estado === 'Hecha' && String(t.ultimaModificacion || '').startsWith(today)).length,
    agendaDelDia: agenda.filter(a => a.fecha === today || matchesTodayName(a.dia)),
    actividadesCanceladas: agenda.filter(a => a.estado === 'Cancelado' && (a.fecha === today || matchesTodayName(a.dia))).length,
    actividadesConFaltantes: agenda.filter(a => a.estado === 'Faltaron equipos' && (a.fecha === today || matchesTodayName(a.dia))).length,
    aulasConProblemas: classrooms,
    notasImportantes: notes
  };
}

function rowToNote(row) {
  return { id: row.id, texto: row.texto, operador: row.operador, categoria: row.categoria, importante: Boolean(row.importante), archivada: Boolean(row.archivada), visible: Boolean(row.visible ?? 1), deletedAt: row.deleted_at || '', deletedBy: row.deleted_by || '', createdAt: row.created_at, updatedAt: row.updated_at };
}

function rowToClosure(row) {
  let resumen = {};
  try { resumen = JSON.parse(row.resumen_json || '{}'); } catch { resumen = {}; }
  return { id: row.id, fecha: row.fecha, operador: row.operador, resumen, observaciones: row.observaciones, createdAt: row.created_at };
}

function rowToQuickLink(row) {
  return { id: row.id, titulo: row.titulo, url: row.url, descripcion: row.descripcion, categoria: row.categoria, icono: row.icono, creadoPor: row.creado_por, activo: Boolean(row.activo), createdAt: row.created_at, updatedAt: row.updated_at };
}

function normalizeQuickLink(raw) {
  return { titulo: String(raw.titulo || raw.title || '').trim(), url: String(raw.url || '').trim(), descripcion: String(raw.descripcion || '').trim(), categoria: String(raw.categoria || '').trim(), icono: String(raw.icono || '').trim(), creadoPor: String(raw.operator || raw.creadoPor || '').trim() };
}

function isSafeUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function matchesTodayName(day) {
  const names = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  const today = names[new Date().getDay()];
  return normalize(day) === today;
}

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
