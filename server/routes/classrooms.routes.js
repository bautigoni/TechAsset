import { Router } from 'express';
import { getDb, nowIso } from '../db.js';

export const classroomsRouter = Router();

const VALID_ITEM_STATES = new Set(['OK', 'Con falla', 'No tiene', 'En reparación', 'Sin revisar']);

function migrateItemState(value) {
  if (value === 'No encontrado') return 'Con falla';
  if (VALID_ITEM_STATES.has(value)) return value;
  return 'Sin revisar';
}

function rowToClassroom(row) {
  return {
    roomKey: row.room_key,
    nombre: row.nombre || '',
    nivel: row.nivel || '',
    piso: row.piso === 'Primer piso' ? 'Planta baja' : (row.piso || ''),
    sector: row.sector || '',
    estadoGeneral: row.estado_general || 'Sin revisar',
    proyector: migrateItemState(row.proyector_estado || 'Sin revisar'),
    nuc: migrateItemState(row.nuc_estado || 'Sin revisar'),
    monitor: migrateItemState(row.monitor_estado || 'Sin revisar'),
    tecladoMouse: migrateItemState(row.teclado_mouse_estado || 'Sin revisar'),
    observaciones: row.observaciones || '',
    ultimaActualizacion: row.ultima_actualizacion || '',
    operadorUltimoCambio: row.operador_ultimo_cambio || ''
  };
}

function calcEstadoGeneral(c) {
  const items = [c.proyector, c.nuc, c.monitor, c.tecladoMouse];
  if (items.some(v => v === 'En reparación')) return 'Problema';
  if (items.some(v => v === 'Con falla' || v === 'Sin revisar')) return 'Con observaciones';
  if (items.every(v => v === 'OK' || v === 'No tiene')) return 'OK';
  return 'Sin revisar';
}

function migrateLegacyClassroomData(db) {
  try {
    db.exec(`UPDATE classrooms SET piso='Planta baja' WHERE piso='Primer piso'`);
    for (const col of ['proyector_estado', 'nuc_estado', 'monitor_estado', 'teclado_mouse_estado']) {
      db.prepare(`UPDATE classrooms SET ${col}='Con falla' WHERE ${col}='No encontrado'`).run();
    }
  } catch { /* migration is best-effort */ }
}

let migrated = false;
function ensureMigrated(db) {
  if (migrated) return;
  migrateLegacyClassroomData(db);
  migrated = true;
}

function ensureClassroom(roomKey, defaults = {}) {
  const db = getDb();
  ensureMigrated(db);
  let row = db.prepare('SELECT * FROM classrooms WHERE room_key = ?').get(roomKey);
  if (!row) {
    db.prepare(`
      INSERT INTO classrooms (room_key, nombre, nivel, piso, sector, estado_general, proyector_estado, nuc_estado, monitor_estado, teclado_mouse_estado, observaciones, ultima_actualizacion, operador_ultimo_cambio)
      VALUES (?, ?, ?, ?, ?, 'Sin revisar', 'Sin revisar', 'Sin revisar', 'Sin revisar', 'Sin revisar', '', '', '')
    `).run(roomKey, defaults.nombre || roomKey, defaults.nivel || '', defaults.piso || 'Planta baja', defaults.sector || '');
    row = db.prepare('SELECT * FROM classrooms WHERE room_key = ?').get(roomKey);
  }
  return row;
}

classroomsRouter.get('/classrooms', (_req, res) => {
  const db = getDb();
  ensureMigrated(db);
  const rows = db.prepare('SELECT * FROM classrooms ORDER BY piso, nombre').all();
  res.json({ ok: true, items: rows.map(rowToClassroom) });
});

classroomsRouter.get('/classrooms/summary', (_req, res) => {
  const db = getDb();
  ensureMigrated(db);
  const rows = db.prepare('SELECT * FROM classrooms').all().map(rowToClassroom);
  const summary = {
    total: rows.length,
    ok: rows.filter(r => r.estadoGeneral === 'OK').length,
    observaciones: rows.filter(r => r.estadoGeneral === 'Con observaciones').length,
    problema: rows.filter(r => r.estadoGeneral === 'Problema').length,
    sinRevisar: rows.filter(r => r.estadoGeneral === 'Sin revisar').length,
    proyectorFalla: rows.filter(r => r.proyector === 'Con falla' || r.proyector === 'En reparación').length,
    nucFalla: rows.filter(r => r.nuc === 'Con falla' || r.nuc === 'En reparación').length,
    monitorFalla: rows.filter(r => r.monitor === 'Con falla' || r.monitor === 'En reparación').length
  };
  res.json({ ok: true, summary });
});

classroomsRouter.get('/classrooms/:roomKey', (req, res) => {
  const row = ensureClassroom(req.params.roomKey, req.query || {});
  res.json({ ok: true, item: rowToClassroom(row) });
});

classroomsRouter.patch('/classrooms/:roomKey', (req, res) => {
  const db = getDb();
  const oldRow = ensureClassroom(req.params.roomKey, req.body || {});
  const old = rowToClassroom(oldRow);
  const body = req.body || {};
  const operator = String(body.operator || body.operador || '');
  const ts = nowIso();

  const next = {
    nombre: body.nombre ?? old.nombre,
    nivel: body.nivel ?? old.nivel,
    piso: body.piso ?? old.piso,
    sector: body.sector ?? old.sector,
    proyector: body.proyector ?? old.proyector,
    nuc: body.nuc ?? old.nuc,
    monitor: body.monitor ?? old.monitor,
    tecladoMouse: body.tecladoMouse ?? old.tecladoMouse,
    observaciones: body.observaciones ?? old.observaciones
  };

  for (const key of ['proyector', 'nuc', 'monitor', 'tecladoMouse']) {
    next[key] = migrateItemState(next[key]);
  }
  if (next.piso === 'Primer piso') next.piso = 'Planta baja';
  next.estadoGeneral = calcEstadoGeneral(next);

  db.prepare(`
    UPDATE classrooms SET nombre=?, nivel=?, piso=?, sector=?, estado_general=?, proyector_estado=?, nuc_estado=?, monitor_estado=?, teclado_mouse_estado=?, observaciones=?, ultima_actualizacion=?, operador_ultimo_cambio=?
    WHERE room_key=?
  `).run(next.nombre, next.nivel, next.piso, next.sector, next.estadoGeneral, next.proyector, next.nuc, next.monitor, next.tecladoMouse, next.observaciones, ts, operator, req.params.roomKey);

  const fields = [
    ['proyector', old.proyector, next.proyector],
    ['nuc', old.nuc, next.nuc],
    ['monitor', old.monitor, next.monitor],
    ['tecladoMouse', old.tecladoMouse, next.tecladoMouse],
    ['observaciones', old.observaciones, next.observaciones],
    ['estadoGeneral', old.estadoGeneral, next.estadoGeneral]
  ];
  const insertHist = db.prepare('INSERT INTO classroom_history (room_key, timestamp, operador, campo, valor_anterior, valor_nuevo, observacion) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const [campo, antes, despues] of fields) {
    if (String(antes) !== String(despues)) insertHist.run(req.params.roomKey, ts, operator, campo, String(antes), String(despues), '');
  }

  const updated = db.prepare('SELECT * FROM classrooms WHERE room_key=?').get(req.params.roomKey);
  res.json({ ok: true, item: rowToClassroom(updated) });
});

classroomsRouter.get('/classrooms/:roomKey/history', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM classroom_history WHERE room_key = ? ORDER BY id DESC LIMIT 100').all(req.params.roomKey);
  res.json({ ok: true, items: rows.map(row => ({
    id: row.id,
    roomKey: row.room_key,
    timestamp: row.timestamp,
    operador: row.operador,
    campo: row.campo,
    valorAnterior: row.valor_anterior,
    valorNuevo: row.valor_nuevo,
    observacion: row.observacion
  })) });
});
