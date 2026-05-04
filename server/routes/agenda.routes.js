import { Router } from 'express';
import { getDb, nowIso, rowToAgenda } from '../db.js';

export const agendaRouter = Router();

const VALID_STATES = new Set(['Pendiente', 'Entregado', 'Realizado', 'Cancelado', 'Faltaron equipos']);
const CAPACITY = { touch: 25, tic: 99, plani: 99, dell: 99 };

agendaRouter.get('/agenda', (_req, res) => {
  const rows = getDb().prepare('SELECT * FROM agenda WHERE eliminada=0 ORDER BY dia, turno, desde').all();
  res.json({ ok: true, items: rows.map(rowToAgenda), loadedAt: nowIso() });
});

agendaRouter.get('/agenda/today', (_req, res) => {
  const rows = getDb().prepare('SELECT * FROM agenda WHERE eliminada=0 ORDER BY turno, desde').all();
  res.json({ ok: true, items: rows.map(rowToAgenda), loadedAt: nowIso() });
});

agendaRouter.get('/agenda/:id', (req, res) => {
  const row = getDb().prepare('SELECT * FROM agenda WHERE id=? AND eliminada=0').get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'Actividad no encontrada.' });
  res.json({ ok: true, item: rowToAgenda(row) });
});

agendaRouter.post('/agenda', (req, res) => {
  const db = getDb();
  const payload = normalizeAgendaPayload(req.body);
  const conflict = agendaCapacityConflict(payload);
  if (conflict) return res.status(409).json({ ok: false, error: conflict });
  const id = payload.id || `AG${Date.now()}`;
  const ts = nowIso();
  db.prepare(`
    INSERT INTO agenda (id, dia, fecha, turno, desde, hasta, curso, actividad, tipo_dispositivo, cantidad, ubicacion, responsable_tic, estado, nota, compus_retiradas, operador_ultimo_cambio, ultima_modificacion, created_at)
    VALUES (@id, @dia, @fecha, @turno, @desde, @hasta, @curso, @actividad, @tipoDispositivo, @cantidad, @ubicacion, @responsableTic, @estado, @nota, @compusRetiradas, @operator, @ts, @ts)
  `).run({ ...payload, id, ts });
  db.prepare('INSERT INTO agenda_history (agenda_id, timestamp, accion, estado_anterior, estado_nuevo, nota, operador) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, ts, 'actividad creada', '', payload.estado, payload.nota, payload.operator);
  res.json({ ok: true, item: rowToAgenda(db.prepare('SELECT * FROM agenda WHERE id=?').get(id)) });
});

agendaRouter.patch('/agenda/:id', (req, res) => {
  const db = getDb();
  const old = db.prepare('SELECT * FROM agenda WHERE id=? AND eliminada=0').get(req.params.id);
  if (!old) return res.status(404).json({ ok: false, error: 'Actividad no encontrada.' });
  const oldItem = rowToAgenda(old);
  const payload = normalizeAgendaPayload({ ...oldItem, ...req.body, id: req.params.id });
  const ts = nowIso();
  db.prepare(`
    UPDATE agenda SET dia=@dia, fecha=@fecha, turno=@turno, desde=@desde, hasta=@hasta, curso=@curso, actividad=@actividad,
      tipo_dispositivo=@tipoDispositivo, cantidad=@cantidad, ubicacion=@ubicacion, responsable_tic=@responsableTic,
      estado=@estado, nota=@nota, compus_retiradas=@compusRetiradas, operador_ultimo_cambio=@operator, ultima_modificacion=@ts
    WHERE id=@id
  `).run({ ...payload, ts });
  db.prepare('INSERT INTO agenda_history (agenda_id, timestamp, accion, estado_anterior, estado_nuevo, nota, operador) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(req.params.id, ts, payload.estado === oldItem.estado ? 'agenda modificada' : `agenda ${payload.estado}`, oldItem.estado, payload.estado, payload.nota, payload.operator);
  res.json({ ok: true, item: rowToAgenda(db.prepare('SELECT * FROM agenda WHERE id=?').get(req.params.id)) });
});

agendaRouter.put('/agenda/:id', (req, res) => {
  req.method = 'PATCH';
  agendaRouter.handle(req, res);
});

agendaRouter.delete('/agenda/:id', (req, res) => {
  const db = getDb();
  const old = db.prepare('SELECT * FROM agenda WHERE id=? AND eliminada=0').get(req.params.id);
  if (!old) return res.status(404).json({ ok: false, error: 'Actividad no encontrada.' });
  const operator = req.body?.operator || '';
  const ts = nowIso();
  db.prepare('UPDATE agenda SET eliminada=1, operador_ultimo_cambio=?, ultima_modificacion=? WHERE id=?').run(operator, ts, req.params.id);
  db.prepare('INSERT INTO agenda_history (agenda_id, timestamp, accion, estado_anterior, estado_nuevo, nota, operador) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(req.params.id, ts, 'actividad borrada', old.estado, old.estado, old.nota, operator);
  res.json({ ok: true, id: req.params.id });
});

agendaRouter.get('/agenda/history', (_req, res) => {
  const rows = getDb().prepare('SELECT * FROM agenda_history ORDER BY id DESC LIMIT 200').all();
  res.json({ ok: true, items: rows });
});

agendaRouter.get('/agenda/export.csv', (_req, res) => {
  const rows = getDb().prepare('SELECT * FROM agenda WHERE eliminada=0 ORDER BY dia, desde').all();
  res.type('text/csv').send(toCsv(rows));
});

function normalizeAgendaPayload(raw) {
  const estado = VALID_STATES.has(raw.estado) ? raw.estado : 'Pendiente';
  return {
    id: raw.id || '',
    dia: raw.dia || '',
    fecha: raw.fecha || '',
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

function agendaCapacityConflict(payload) {
  const type = String(payload.tipoDispositivo || '').toLowerCase();
  const max = CAPACITY[type];
  if (!max) return '';
  const rows = getDb().prepare('SELECT * FROM agenda WHERE eliminada=0 AND lower(dia)=lower(?) AND lower(tipo_dispositivo)=lower(?) AND id <> ?').all(payload.dia, payload.tipoDispositivo, payload.id || '');
  const used = rows.filter(row => overlaps(payload.desde, payload.hasta, row.desde, row.hasta)).reduce((sum, row) => sum + Number(row.cantidad || 0), 0);
  return used + Number(payload.cantidad || 0) > max ? `Conflicto de disponibilidad: ${payload.tipoDispositivo} supera ${max} en ese horario.` : '';
}

function minutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return minutes(aStart) < minutes(bEnd) && minutes(bStart) < minutes(aEnd);
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  return [headers.join(','), ...rows.map(row => headers.map(key => `"${String(row[key] ?? '').replaceAll('"', '""')}"`).join(','))].join('\n');
}
