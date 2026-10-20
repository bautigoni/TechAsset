import { Router } from 'express';
import { getDb, nowIso, rowToAgenda } from '../db.js';
import { requireSite } from '../services/siteContext.service.js';
import { sendWithEtag } from '../services/etag.service.js';
import { todayLocal } from '../services/localTime.js';

export const agendaRouter = Router();

const VALID_STATES = new Set(['Pendiente', 'Entregado', 'Realizado', 'Cancelado', 'Faltaron equipos']);
const CAPACITY = { touch: 25, tic: 99, plani: 99, dell: 99 };
// Las terminadas no tienen equipos afuera: no cuentan para el tope por franja.
const NOT_COUNTED = new Set(['Cancelado', 'Realizado']);
const WEEKDAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// Por defecto no viajan las actividades TERMINADAS (realizadas o canceladas)
// con más de AGENDA_RECENT_DAYS: la agenda se pollea y, sin tope, crecía año a
// año. Las pendientes viajan siempre. ?all=1 trae todo (historial completo).
const AGENDA_RECENT_DAYS = 120;
const FINISHED = "estado IN ('Realizado','Cancelado')";
const LAST_TOUCH = "COALESCE(NULLIF(ultima_modificacion,''), NULLIF(fecha,''), created_at, '')";

agendaRouter.get('/agenda', (_req, res) => {
  const siteCode = requireSite(_req);
  const all = _req.query.all === '1';
  const since = new Date(Date.now() - AGENDA_RECENT_DAYS * 86400000).toISOString().slice(0, 10);
  const countHidden = `SELECT COUNT(*) FROM agenda WHERE eliminada=0 AND site_code=? AND ${FINISHED} AND ${LAST_TOUCH} < ?`;
  // El conteo de ocultas viaja en la misma query (es un endpoint que se pollea:
  // cada query extra es un viaje más a la base en producción).
  const rows = all
    ? getDb().prepare('SELECT * FROM agenda WHERE eliminada=0 AND site_code=? ORDER BY dia, turno, desde').all(siteCode)
    : getDb().prepare(`SELECT agenda.*, (${countHidden}) AS older_hidden FROM agenda WHERE eliminada=0 AND site_code=? AND (NOT ${FINISHED} OR ${LAST_TOUCH} >= ?) ORDER BY dia, turno, desde`).all(siteCode, since, siteCode, since);
  const olderHidden = all ? 0 : rows.length
    ? Number(rows[0].older_hidden || 0)
    // Sin filas visibles el conteo no viajó: se pide aparte (caso raro).
    : Number(getDb().prepare(`${countHidden.replace('COUNT(*)', 'COUNT(*) AS total')}`).get(siteCode, since)?.total || 0);
  // El hash va sobre los items: `loadedAt` cambia siempre y rompería el 304.
  const items = rows.map(rowToAgenda);
  sendWithEtag(_req, res, { ok: true, items, olderHidden, loadedAt: nowIso() }, { items, olderHidden });
});

agendaRouter.post('/agenda', (req, res) => {
  const db = getDb();
  const siteCode = requireSite(req);
  const payload = normalizeAgendaPayload(req.body);
  const invalid = validateAgendaTimes(payload);
  if (invalid) return res.status(400).json({ ok: false, error: invalid });
  const conflict = agendaCapacityConflict(payload, siteCode);
  if (conflict) return res.status(409).json({ ok: false, error: conflict });
  const id = payload.id || `AG${Date.now()}`;
  const ts = nowIso();
  db.prepare(`
    INSERT INTO agenda (id, site_code, dia, fecha, turno, desde, hasta, curso, actividad, tipo_dispositivo, cantidad, ubicacion, responsable_tic, estado, nota, compus_retiradas, operador_ultimo_cambio, ultima_modificacion, created_at)
    VALUES (@id, @siteCode, @dia, @fecha, @turno, @desde, @hasta, @curso, @actividad, @tipoDispositivo, @cantidad, @ubicacion, @responsableTic, @estado, @nota, @compusRetiradas, @operator, @ts, @ts)
  `).run({ ...payload, id, ts, siteCode });
  db.prepare('INSERT INTO agenda_history (agenda_id, site_code, timestamp, accion, estado_anterior, estado_nuevo, nota, operador) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, siteCode, ts, 'actividad creada', '', payload.estado, payload.nota, payload.operator);
  res.json({ ok: true, item: rowToAgenda(db.prepare('SELECT * FROM agenda WHERE id=? AND site_code=?').get(id, siteCode)) });
});

agendaRouter.patch('/agenda/:id', (req, res) => {
  const db = getDb();
  const siteCode = requireSite(req);
  const old = db.prepare('SELECT * FROM agenda WHERE id=? AND eliminada=0 AND site_code=?').get(req.params.id, siteCode);
  if (!old) return res.status(404).json({ ok: false, error: 'Actividad no encontrada.' });
  const oldItem = rowToAgenda(old);
  const payload = normalizeAgendaPayload({ ...oldItem, ...req.body, id: req.params.id });
  // Solo se revalida lo que cambió: marcar Entregado una actividad vieja que ya
  // estaba sobre el tope no se bloquea; mover horario, tipo, cantidad o fecha, sí.
  const timesChanged = payload.desde !== oldItem.desde || payload.hasta !== oldItem.hasta;
  if (timesChanged) {
    const invalid = validateAgendaTimes(payload);
    if (invalid) return res.status(400).json({ ok: false, error: invalid });
  }
  const slotChanged = timesChanged || payload.dia !== oldItem.dia || payload.fecha !== oldItem.fecha
    || String(payload.tipoDispositivo).toLowerCase() !== String(oldItem.tipoDispositivo).toLowerCase()
    || payload.cantidad > Number(oldItem.cantidad || 0)
    || (NOT_COUNTED.has(oldItem.estado) && !NOT_COUNTED.has(payload.estado));
  if (slotChanged) {
    const conflict = agendaCapacityConflict(payload, siteCode);
    if (conflict) return res.status(409).json({ ok: false, error: conflict });
  }
  const ts = nowIso();
  db.prepare(`
    UPDATE agenda SET dia=@dia, fecha=@fecha, turno=@turno, desde=@desde, hasta=@hasta, curso=@curso, actividad=@actividad,
      tipo_dispositivo=@tipoDispositivo, cantidad=@cantidad, ubicacion=@ubicacion, responsable_tic=@responsableTic,
      estado=@estado, nota=@nota, compus_retiradas=@compusRetiradas, operador_ultimo_cambio=@operator, ultima_modificacion=@ts
    WHERE id=@id AND site_code=@siteCode
  `).run({ ...payload, ts, siteCode });
  db.prepare('INSERT INTO agenda_history (agenda_id, site_code, timestamp, accion, estado_anterior, estado_nuevo, nota, operador) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.params.id, siteCode, ts, payload.estado === oldItem.estado ? 'agenda modificada' : `agenda ${payload.estado}`, oldItem.estado, payload.estado, payload.nota, payload.operator);
  res.json({ ok: true, item: rowToAgenda(db.prepare('SELECT * FROM agenda WHERE id=? AND site_code=?').get(req.params.id, siteCode)) });
});

agendaRouter.delete('/agenda/:id', (req, res) => {
  const db = getDb();
  const siteCode = requireSite(req);
  const old = db.prepare('SELECT * FROM agenda WHERE id=? AND eliminada=0 AND site_code=?').get(req.params.id, siteCode);
  if (!old) return res.status(404).json({ ok: false, error: 'Actividad no encontrada.' });
  const operator = req.body?.operator || '';
  const ts = nowIso();
  db.prepare('UPDATE agenda SET eliminada=1, operador_ultimo_cambio=?, ultima_modificacion=? WHERE id=? AND site_code=?').run(operator, ts, req.params.id, siteCode);
  db.prepare('INSERT INTO agenda_history (agenda_id, site_code, timestamp, accion, estado_anterior, estado_nuevo, nota, operador) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.params.id, siteCode, ts, 'actividad borrada', old.estado, old.estado, old.nota, operator);
  res.json({ ok: true, id: req.params.id });
});

// Deshacer de "Borrar": vuelve a la agenda la actividad borrada (soft delete).
agendaRouter.post('/agenda/:id/restore', (req, res) => {
  const db = getDb();
  const siteCode = requireSite(req);
  const old = db.prepare('SELECT * FROM agenda WHERE id=? AND eliminada=1 AND site_code=?').get(req.params.id, siteCode);
  if (!old) return res.status(404).json({ ok: false, error: 'No hay una actividad borrada con ese id.' });
  const item = rowToAgenda(old);
  const conflict = agendaCapacityConflict(normalizeAgendaPayload(item), siteCode);
  if (conflict) return res.status(409).json({ ok: false, error: `No se pudo restaurar. ${conflict}` });
  const operator = req.body?.operator || '';
  const ts = nowIso();
  db.prepare('UPDATE agenda SET eliminada=0, operador_ultimo_cambio=?, ultima_modificacion=? WHERE id=? AND site_code=?').run(operator, ts, req.params.id, siteCode);
  db.prepare('INSERT INTO agenda_history (agenda_id, site_code, timestamp, accion, estado_anterior, estado_nuevo, nota, operador) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.params.id, siteCode, ts, 'actividad restaurada', old.estado, old.estado, old.nota, operator);
  res.json({ ok: true, item: rowToAgenda(db.prepare('SELECT * FROM agenda WHERE id=? AND site_code=?').get(req.params.id, siteCode)) });
});

// Registro de cambios. Viaja con curso/actividad/día/horario de la actividad
// (aunque esté borrada) para que la pantalla no tenga que cruzarlo a mano.
agendaRouter.get('/agenda/history', (_req, res) => {
  const limit = Math.min(200, Math.max(1, Math.floor(Number(_req.query.limit)) || 200));
  const rows = getDb().prepare(`
    SELECT h.*, a.curso AS curso, a.actividad AS actividad, a.dia AS dia, a.fecha AS fecha, a.desde AS desde, a.hasta AS hasta
    FROM agenda_history h
    LEFT JOIN agenda a ON a.id = h.agenda_id AND a.site_code = h.site_code
    WHERE h.site_code=? ORDER BY h.id DESC LIMIT ${limit}
  `).all(requireSite(_req));
  res.json({ ok: true, items: rows });
});

function normalizeAgendaPayload(raw) {
  const estado = VALID_STATES.has(raw.estado) ? raw.estado : 'Pendiente';
  const fecha = String(raw.fecha || '').trim();
  return {
    id: raw.id || '',
    // Con fecha concreta el día sale de la fecha (no puede contradecirla).
    dia: weekdayOfDate(fecha) || raw.dia || '',
    fecha,
    turno: raw.turno || '',
    desde: raw.desde || '',
    hasta: raw.hasta || '',
    curso: raw.curso || '',
    actividad: raw.actividad || '',
    tipoDispositivo: raw.tipoDispositivo || raw.tipo_dispositivo || '',
    cantidad: Number(raw.cantidad || 0),
    ubicacion: raw.ubicacion || '',
    responsableTic: raw.responsableTic || raw.responsable_tic || '',
    estado,
    nota: raw.nota || '',
    compusRetiradas: Number(raw.compusRetiradas || raw.compus_retiradas || 0),
    operator: raw.operator || raw.operador || ''
  };
}

/**
 * Tope por tipo en una franja. Suma las actividades del mismo tipo que se
 * superponen en horario y caen el mismo día:
 * - con fecha: las de esa fecha y las semanales de ese día de la semana;
 * - semanal: las semanales del mismo día y las de fecha (de hoy en adelante)
 *   que caen ese día de la semana.
 * Canceladas y realizadas no cuentan (no tienen equipos afuera).
 * La misma regla está en src/components/agenda/agendaModel.ts (aviso antes de guardar).
 */
function agendaCapacityConflict(payload, siteCode) {
  const type = String(payload.tipoDispositivo || '').toLowerCase();
  const max = CAPACITY[type];
  if (!max || NOT_COUNTED.has(payload.estado)) return '';
  const rows = getDb().prepare('SELECT id, dia, fecha, desde, hasta, cantidad, estado FROM agenda WHERE eliminada=0 AND site_code=? AND lower(tipo_dispositivo)=lower(?) AND id <> ?').all(siteCode, payload.tipoDispositivo, payload.id || '');
  const day = comparableDay(payload.dia);
  const today = todayLocal();
  const sameDay = row => {
    const rowFecha = String(row.fecha || '');
    if (payload.fecha) return rowFecha ? rowFecha === payload.fecha : comparableDay(row.dia) === day;
    if (!rowFecha) return comparableDay(row.dia) === day;
    return rowFecha >= today && comparableDay(weekdayOfDate(rowFecha) || row.dia) === day;
  };
  const used = rows
    .filter(row => !NOT_COUNTED.has(row.estado) && sameDay(row) && overlaps(payload.desde, payload.hasta, row.desde, row.hasta))
    .reduce((sum, row) => sum + Number(row.cantidad || 0), 0);
  return used + Number(payload.cantidad || 0) > max ? `Conflicto de disponibilidad: ${payload.tipoDispositivo} supera ${max} en ese horario.` : '';
}

function validateAgendaTimes(payload) {
  if (!/^\d{1,2}:\d{2}$/.test(payload.desde) || !/^\d{1,2}:\d{2}$/.test(payload.hasta)) return 'Horario inválido: usá HH:MM en Desde y Hasta.';
  if (minutes(payload.desde) >= minutes(payload.hasta)) return 'Hasta tiene que ser después de Desde.';
  return '';
}

function comparableDay(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function weekdayOfDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? '' : WEEKDAY_NAMES[date.getUTCDay()];
}

function minutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return minutes(aStart) < minutes(bEnd) && minutes(bStart) < minutes(aEnd);
}

