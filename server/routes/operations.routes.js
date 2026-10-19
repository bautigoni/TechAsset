import { Router } from 'express';
import { buildTaskContext, getDb, nowIso, rowToAgenda, rowToTask } from '../db.js';
import { requireSite } from '../services/siteContext.service.js';
import { getMergedDevices, isLoanedState } from '../services/deviceInventory.service.js';
import { localDayRangeIso, localParts, toLocalDate, todayLocal } from '../services/localTime.js';

export const operationsRouter = Router();

operationsRouter.get('/internal-notes', (req, res) => {
  const siteCode = requireSite(req);
  const filter = String(req.query.filter || 'active');
  const where = filter === 'last30'
    ? "created_at >= datetime('now','-30 days')"
    : filter === 'all'
      ? 'COALESCE(visible,1)=1'
      : 'COALESCE(visible,1)=1';
  const rows = getDb().prepare(`SELECT * FROM internal_notes WHERE site_code=? AND ${where} ORDER BY importante DESC, id DESC LIMIT 250`).all(siteCode);
  res.json({ ok: true, items: rows.map(rowToNote) });
});

operationsRouter.post('/internal-notes', (req, res) => {
  const texto = String(req.body?.texto || '').trim();
  if (!texto) return res.status(400).json({ ok: false, error: 'La nota no puede estar vacía.' });
  const ts = nowIso();
  const info = getDb().prepare('INSERT INTO internal_notes (site_code, texto, operador, categoria, importante, archivada, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)')
    .run(requireSite(req), texto, req.body?.operator || req.body?.operador || '', req.body?.categoria || 'General', req.body?.importante ? 1 : 0, ts, ts);
  res.json({ ok: true, item: rowToNote(getDb().prepare('SELECT * FROM internal_notes WHERE id=?').get(info.lastInsertRowid)) });
});

operationsRouter.patch('/internal-notes/:id', (req, res) => {
  const old = getDb().prepare('SELECT * FROM internal_notes WHERE id=? AND site_code=?').get(req.params.id, requireSite(req));
  if (!old) return res.status(404).json({ ok: false, error: 'Nota no encontrada.' });
  const ts = nowIso();
  const siteCode = requireSite(req);
  getDb().prepare('UPDATE internal_notes SET texto=?, categoria=?, importante=?, archivada=?, visible=?, deleted_at=?, deleted_by=?, updated_at=? WHERE id=? AND site_code=?')
    .run(
      req.body.texto ?? old.texto,
      req.body.categoria ?? old.categoria,
      req.body.importante == null ? old.importante : (req.body.importante ? 1 : 0),
      req.body.archivada == null ? old.archivada : (req.body.archivada ? 1 : 0),
      req.body.visible == null ? (old.visible == null ? 1 : old.visible) : (req.body.visible ? 1 : 0),
      // Deshacer el borrado (visible:true) limpia la marca de borrado.
      req.body.visible === false ? ts : req.body.visible === true ? '' : (old.deleted_at || ''),
      req.body.visible === false ? (req.body.operator || req.body.operador || '') : req.body.visible === true ? '' : (old.deleted_by || ''),
      ts,
      req.params.id,
      siteCode
    );
  res.json({ ok: true, item: rowToNote(getDb().prepare('SELECT * FROM internal_notes WHERE id=? AND site_code=?').get(req.params.id, siteCode)) });
});

operationsRouter.delete('/internal-notes/:id', (req, res) => {
  const ts = nowIso();
  const operator = req.body?.operator || req.query.operator || '';
  const result = getDb().prepare('UPDATE internal_notes SET visible=0, deleted_at=?, deleted_by=?, updated_at=? WHERE id=? AND site_code=?').run(ts, operator, ts, req.params.id, requireSite(req));
  res.json({ ok: true, deleted: result.changes > 0 });
});

operationsRouter.get('/daily-closures', (_req, res) => {
  const rows = getDb().prepare('SELECT * FROM daily_closures WHERE site_code=? ORDER BY id DESC LIMIT 100').all(requireSite(_req));
  res.json({ ok: true, items: rows.map(rowToClosure) });
});

operationsRouter.get('/daily-closures/preview', async (req, res, next) => {
  try {
    res.json({ ok: true, resumen: await buildDailySummary(requireSite(req)) });
  } catch (error) {
    next(error);
  }
});

operationsRouter.post('/daily-closures', async (req, res, next) => {
  try {
    const ts = nowIso();
    const siteCode = requireSite(req);
    const resumen = req.body?.resumen || await buildDailySummary(siteCode);
    // La fecha del cierre es el día de la sede, no el día UTC (después de las 21 h
    // quedaba registrado como del día siguiente).
    const info = getDb().prepare('INSERT INTO daily_closures (site_code, fecha, operador, resumen_json, observaciones, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(siteCode, toLocalDate(ts), req.body?.operator || req.body?.operador || '', JSON.stringify(resumen), req.body?.observaciones || '', ts);
    res.json({ ok: true, item: rowToClosure(getDb().prepare('SELECT * FROM daily_closures WHERE id=?').get(info.lastInsertRowid)) });
  } catch (error) {
    next(error);
  }
});

operationsRouter.get('/quick-links', (_req, res) => {
  const rows = getDb().prepare('SELECT * FROM quick_links WHERE activo=1 AND site_code=? ORDER BY categoria, titulo').all(requireSite(_req));
  res.json({ ok: true, items: rows.map(rowToQuickLink) });
});

operationsRouter.post('/quick-links', (req, res) => {
  const payload = normalizeQuickLink(req.body);
  if (!payload.titulo || !payload.url) return res.status(400).json({ ok: false, error: 'Título y URL son obligatorios.' });
  if (!isSafeUrl(payload.url)) return res.status(400).json({ ok: false, error: 'Solo se permiten URLs http:// o https://.' });
  const ts = nowIso();
  const info = getDb().prepare('INSERT INTO quick_links (site_code, titulo, url, descripcion, categoria, icono, creado_por, activo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)')
    .run(requireSite(req), payload.titulo, payload.url, payload.descripcion, payload.categoria, payload.icono, payload.creadoPor, ts, ts);
  res.json({ ok: true, item: rowToQuickLink(getDb().prepare('SELECT * FROM quick_links WHERE id=?').get(info.lastInsertRowid)) });
});

operationsRouter.patch('/quick-links/:id', (req, res) => {
  const old = getDb().prepare('SELECT * FROM quick_links WHERE id=? AND site_code=?').get(req.params.id, requireSite(req));
  if (!old) return res.status(404).json({ ok: false, error: 'Acceso no encontrado.' });
  const payload = normalizeQuickLink({ ...old, ...req.body });
  if (!isSafeUrl(payload.url)) return res.status(400).json({ ok: false, error: 'Solo se permiten URLs http:// o https://.' });
  const siteCode = requireSite(req);
  getDb().prepare('UPDATE quick_links SET titulo=?, url=?, descripcion=?, categoria=?, icono=?, updated_at=? WHERE id=? AND site_code=?')
    .run(payload.titulo, payload.url, payload.descripcion, payload.categoria, payload.icono, nowIso(), req.params.id, siteCode);
  res.json({ ok: true, item: rowToQuickLink(getDb().prepare('SELECT * FROM quick_links WHERE id=? AND site_code=?').get(req.params.id, siteCode)) });
});

operationsRouter.delete('/quick-links/:id', (req, res) => {
  const result = getDb().prepare('UPDATE quick_links SET activo=0, updated_at=? WHERE id=? AND site_code=?').run(nowIso(), req.params.id, requireSite(req));
  res.json({ ok: true, deleted: result.changes > 0 });
});

operationsRouter.get('/settings/shifts', (_req, res) => {
  const rows = getDb().prepare("SELECT key, value_json FROM site_settings WHERE site_code=? AND key IN ('shift.morningOperator','shift.afternoonOperator')").all(requireSite(_req));
  const map = Object.fromEntries(rows.map(row => {
    try { return [row.key, JSON.parse(row.value_json)]; } catch { return [row.key, row.value_json]; }
  }));
  res.json({ ok: true, settings: { morningOperator: map['shift.morningOperator'] || '', afternoonOperator: map['shift.afternoonOperator'] || '' } });
});

operationsRouter.patch('/settings/shifts', (req, res) => {
  const ts = nowIso();
  const morning = req.body?.morningOperator || '';
  const afternoon = req.body?.afternoonOperator || '';
  const siteCode = requireSite(req);
  const stmt = getDb().prepare('INSERT INTO site_settings (site_code, key, value_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(site_code, key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at');
  stmt.run(siteCode, 'shift.morningOperator', JSON.stringify(morning), ts);
  stmt.run(siteCode, 'shift.afternoonOperator', JSON.stringify(afternoon), ts);
  res.json({ ok: true, settings: { morningOperator: morning, afternoonOperator: afternoon } });
});

async function buildDailySummary(siteCode) {
  const db = getDb();
  // "Hoy" es el día de la sede; las columnas ISO UTC se filtran por su rango.
  const today = todayLocal();
  const todayRange = localDayRangeIso(today);
  // rowToTask con su contexto: .map(rowToTask) le pasaba el índice como ctx.
  const taskCtx = buildTaskContext(siteCode);
  const tasks = db.prepare('SELECT * FROM tasks WHERE eliminada=0 AND site_code=?').all(siteCode).map(row => rowToTask(row, taskCtx));
  const agenda = db.prepare('SELECT * FROM agenda WHERE eliminada=0 AND site_code=?').all(siteCode).map(rowToAgenda);
  const notes = db.prepare("SELECT * FROM internal_notes WHERE site_code=? AND COALESCE(visible,1)=1 AND importante=1 AND created_at >= ? AND created_at < ? ORDER BY id DESC").all(siteCode, todayRange.start, todayRange.end).map(rowToNote);
  const classrooms = db.prepare("SELECT room_key, nombre, piso, estado_general FROM classrooms WHERE site_code=? AND estado_general IN ('Con observaciones','Problema') ORDER BY piso, nombre").all(siteCode);
  // Préstamos activos desde el inventario actual (local_states), con la misma
  // regla que Préstamos. La tabla vieja `prestamos` ya no se escribe: daba 0.
  // getMergedDevices usa la caché por sede, así que no suma queries si está fresca.
  const { items: devices } = await getMergedDevices({ siteCode });
  const prestados = devices.filter(device => isLoanedState(device.estado));
  return {
    fecha: today,
    prestamosActivos: prestados.length,
    dispositivosNoDevueltos: prestados.map(device => {
      const alias = String(device.aliasOperativo || '').trim();
      return alias && alias.toUpperCase() !== device.etiqueta ? `${alias} (${device.etiqueta})` : device.etiqueta;
    }).filter(Boolean),
    tareasPendientes: tasks.filter(t => t.estado === 'Pendiente').length,
    tareasEnProceso: tasks.filter(t => t.estado === 'En proceso').length,
    tareasHechasHoy: tasks.filter(t => t.estado === 'Hecha' && toLocalDate(t.ultimaModificacion || '') === today).length,
    agendaDelDia: agenda.filter(a => a.fecha === today || matchesTodayName(a.dia)),
    actividadesCanceladas: agenda.filter(a => a.estado === 'Cancelado' && (a.fecha === today || matchesTodayName(a.dia))).length,
    actividadesConFaltantes: agenda.filter(a => a.estado === 'Faltaron equipos' && (a.fecha === today || matchesTodayName(a.dia))).length,
    aulasConProblemas: classrooms,
    notasImportantes: notes
  };
}

function rowToNote(row) {
  // localDate: día de la nota en hora de la sede (created_at es ISO UTC). El
  // front filtra "hoy" con esto; comparar el ISO con la fecha local perdía las
  // notas escritas después de las 21 h.
  return { id: row.id, localDate: toLocalDate(row.created_at || ''), texto: row.texto, operador: row.operador, categoria: row.categoria, importante: Boolean(row.importante), archivada: Boolean(row.archivada), visible: Boolean(row.visible ?? 1), deletedAt: row.deleted_at || '', deletedBy: row.deleted_by || '', createdAt: row.created_at, updatedAt: row.updated_at };
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
  const today = names[localParts(new Date()).weekday];
  return normalize(day) === today;
}

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
