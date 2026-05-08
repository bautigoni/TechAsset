import { Router } from 'express';
import { getDb, nowIso } from '../db.js';
import { requireSite } from '../services/siteContext.service.js';

export const classroomsRouter = Router();

const VALID_ITEM_STATES = new Set(['OK', 'Con falla', 'No tiene', 'En reparación', 'Sin revisar']);
const EQUIPMENT_OPTIONS = [
  { key: 'proyector', label: 'Proyector', column: 'proyector_estado' },
  { key: 'nuc', label: 'NUC', column: 'nuc_estado' },
  { key: 'monitor', label: 'Monitor', column: 'monitor_estado' },
  { key: 'tecladoMouse', label: 'Teclado/Mouse', column: 'teclado_mouse_estado' },
  { key: 'tele', label: 'Tele' },
  { key: 'notebook', label: 'Notebook' },
  { key: 'parlantes', label: 'Parlantes' },
  { key: 'conectividad', label: 'Conectividad' },
  { key: 'otro', label: 'Otro' }
];
const EQUIPMENT_BY_KEY = new Map(EQUIPMENT_OPTIONS.map(item => [item.key, item]));
const DEFAULT_EQUIPMENT_KEYS = ['proyector', 'nuc', 'monitor', 'tecladoMouse'];
const ROOM_DEFAULT_EQUIPMENT = {
  room_Arte: ['notebook', 'proyector'],
  room_Directores: ['tele'],
  pp_TIC: ['notebook', 'proyector'],
  pp_Lab: ['notebook', 'proyector'],
  pp_Maker: ['notebook', 'proyector']
};

const DEFAULT_CLASSROOMS = [
  ['room_3ero_N', '3ero N', 'Planta baja', 'classroom'],
  ['room_5to_N', '5to N', 'Planta baja', 'classroom'],
  ['room_5to_F', '5to F', 'Planta baja', 'classroom'],
  ['room_5to_S', '5to S', 'Planta baja', 'classroom'],
  ['room_3ero_F', '3ero F', 'Planta baja', 'classroom'],
  ['room_3ero_S', '3ero S', 'Planta baja', 'classroom'],
  ['room_4to_N', '4to N', 'Planta baja', 'classroom'],
  ['room_4to_F', '4to F', 'Planta baja', 'classroom'],
  ['room_4to_S', '4to S', 'Planta baja', 'classroom'],
  ['room_Arte', 'Arte', 'Planta baja', 'classroom'],
  ['room_2do_N', '2do N', 'Planta baja', 'classroom'],
  ['room_2do_F', '2do F', 'Planta baja', 'classroom'],
  ['room_2do_S', '2do S', 'Planta baja', 'classroom'],
  ['room_1ero_N', '1ero N', 'Planta baja', 'classroom'],
  ['room_1ero_F', '1ero F', 'Planta baja', 'classroom'],
  ['room_1ero_S', '1ero S', 'Planta baja', 'classroom'],
  ['room_Zoom', 'Zoom', 'Planta baja', 'special'],
  ['3S', '3S', 'Segundo piso', 'classroom'],
  ['4N', '4N', 'Segundo piso', 'classroom'],
  ['4F', '4F', 'Segundo piso', 'classroom'],
  ['4S', '4S', 'Segundo piso', 'classroom'],
  ['pp_Direccion', 'Direccion', 'Primer piso', 'admin'],
  ['pp_DOE', 'DOE', 'Primer piso', 'admin'],
  ['pp_2N', '2N', 'Primer piso', 'classroom'],
  ['pp_2F', '2F', 'Primer piso', 'classroom'],
  ['pp_2S', '2S', 'Primer piso', 'classroom'],
  ['pp_Precep', 'PRECEP', 'Primer piso', 'admin'],
  ['pp_3N', '3N', 'Primer piso', 'classroom'],
  ['pp_5S', '5S', 'Primer piso', 'classroom'],
  ['pp_5F', '5F', 'Primer piso', 'classroom'],
  ['pp_Lab', 'LAB', 'Primer piso', 'special'],
  ['pp_Maker', 'MAKER', 'Primer piso', 'special'],
  ['pp_SalaProfs', 'SALA PROFES', 'Primer piso', 'admin'],
  ['pp_3F', '3F', 'Primer piso', 'classroom'],
  ['pp_6F', '6F', 'Primer piso', 'classroom'],
  ['pp_6N', '6N', 'Primer piso', 'classroom'],
  ['pp_1F', '1F', 'Primer piso', 'classroom'],
  ['pp_1N', '1N', 'Primer piso', 'classroom'],
  ['pp_6F2', '6F', 'Primer piso', 'classroom'],
  ['pp_TIC', 'TIC', 'Primer piso', 'special'],
  ['pp_1S', '1S', 'Primer piso', 'classroom'],
  ['pp_6S', '6S', 'Primer piso', 'classroom'],
  ['pp_6N2', '6N', 'Primer piso', 'classroom'],
  ['sp_Pasillo_Precep', 'Pasillo / precep', 'Segundo piso', 'admin']
];

function migrateItemState(value) {
  if (value === 'No encontrado') return 'Con falla';
  if (VALID_ITEM_STATES.has(value)) return value;
  return 'Sin revisar';
}

function stateFromRow(row, key) {
  const option = EQUIPMENT_BY_KEY.get(key);
  if (option?.column) return migrateItemState(row[option.column] || 'Sin revisar');
  return 'Sin revisar';
}

function normalizeEquipmentItem(item, row) {
  const key = String(item?.key || '').trim();
  const option = EQUIPMENT_BY_KEY.get(key);
  if (!option) return null;
  return {
    key,
    label: option.label,
    state: migrateItemState(item?.state || stateFromRow(row, key))
  };
}

function defaultEquipment(row) {
  const keys = ROOM_DEFAULT_EQUIPMENT[row.room_key] || DEFAULT_EQUIPMENT_KEYS;
  return keys.map(key => ({
    key,
    label: EQUIPMENT_BY_KEY.get(key)?.label || key,
    state: stateFromRow(row, key)
  }));
}

function parseEquipment(row) {
  try {
    const raw = row.equipment_json ? JSON.parse(row.equipment_json) : null;
    if (Array.isArray(raw)) {
      const items = raw.map(item => normalizeEquipmentItem(item, row)).filter(Boolean);
      if (items.length) return items;
    }
  } catch { /* fall back to legacy columns */ }
  return defaultEquipment(row);
}

function rowToClassroom(row) {
  const equipment = parseEquipment(row);
  return {
    roomKey: row.room_key,
    siteCode: row.site_code || '',
    nombre: row.nombre || '',
    nivel: row.nivel || '',
    piso: row.piso || '',
    sector: row.sector || '',
    estadoGeneral: calcEstadoGeneral({ equipment }),
    proyector: migrateItemState(row.proyector_estado || 'Sin revisar'),
    nuc: migrateItemState(row.nuc_estado || 'Sin revisar'),
    monitor: migrateItemState(row.monitor_estado || 'Sin revisar'),
    tecladoMouse: migrateItemState(row.teclado_mouse_estado || 'Sin revisar'),
    equipment,
    observaciones: row.observaciones || '',
    ultimaActualizacion: row.ultima_actualizacion || '',
    operadorUltimoCambio: row.operador_ultimo_cambio || ''
  };
}

function calcEstadoGeneral(c) {
  const items = Array.isArray(c.equipment) && c.equipment.length
    ? c.equipment.map(item => migrateItemState(item.state))
    : [c.proyector, c.nuc, c.monitor, c.tecladoMouse];
  if (items.some(v => v === 'En reparación')) return 'Problema';
  if (items.some(v => v === 'Con falla' || v === 'Sin revisar')) return 'Con observaciones';
  if (items.every(v => v === 'OK' || v === 'No tiene')) return 'OK';
  return 'Sin revisar';
}

function migrateLegacyClassroomData(db) {
  try {
    db.prepare(`UPDATE classrooms SET piso='Planta baja' WHERE piso='Primer piso' AND room_key LIKE 'room_%'`).run();
    db.prepare(`UPDATE classrooms SET piso='Segundo piso' WHERE piso IN ('1er piso', 'Primer piso') AND room_key IN ('3S', '4N', '4F', '4S')`).run();
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

function ensureClassroom(roomKey, defaults = {}, siteCode = 'NFPT') {
  const db = getDb();
  ensureMigrated(db);
  let row = db.prepare('SELECT * FROM classrooms WHERE room_key = ? AND site_code=?').get(roomKey, siteCode);
  if (!row) {
    db.prepare(`
      INSERT INTO classrooms (room_key, site_code, nombre, nivel, piso, sector, estado_general, proyector_estado, nuc_estado, monitor_estado, teclado_mouse_estado, observaciones, ultima_actualizacion, operador_ultimo_cambio, equipment_json)
      VALUES (?, ?, ?, ?, ?, ?, 'Sin revisar', 'Sin revisar', 'Sin revisar', 'Sin revisar', 'Sin revisar', '', '', '', '')
    `).run(roomKey, siteCode, defaults.nombre || roomKey, defaults.nivel || '', defaults.piso || 'Planta baja', defaults.sector || '');
    row = db.prepare('SELECT * FROM classrooms WHERE room_key = ? AND site_code=?').get(roomKey, siteCode);
  }
  return row;
}

function ensureDefaultClassrooms(siteCode = 'NFPT') {
  for (const [roomKey, nombre, piso, sector] of DEFAULT_CLASSROOMS) {
    ensureClassroom(roomKey, { nombre, piso, sector }, siteCode);
    getDb().prepare(`
      UPDATE classrooms
      SET nombre = COALESCE(NULLIF(nombre, ''), ?),
          piso = ?,
          sector = COALESCE(NULLIF(sector, ''), ?)
      WHERE room_key = ? AND site_code=?
    `).run(nombre, piso, sector, roomKey, siteCode);
  }
}

function equipmentFromBody(body, old) {
  if (!Array.isArray(body.equipment)) return old.equipment;
  const byOldState = new Map((old.equipment || []).map(item => [item.key, item.state]));
  const items = body.equipment.map(item => {
    const key = String(item?.key || '').trim();
    const option = EQUIPMENT_BY_KEY.get(key);
    if (!option) return null;
    return {
      key,
      label: option.label,
      state: migrateItemState(item?.state || byOldState.get(key) || 'Sin revisar')
    };
  }).filter(Boolean);
  return items.length ? items : old.equipment;
}

function syncLegacyStates(next) {
  for (const key of DEFAULT_EQUIPMENT_KEYS) {
    const item = next.equipment.find(entry => entry.key === key);
    next[key] = item ? migrateItemState(item.state) : 'No tiene';
  }
}

classroomsRouter.get('/classrooms', (_req, res) => {
  const db = getDb();
  const siteCode = requireSite(_req);
  ensureMigrated(db);
  ensureDefaultClassrooms(siteCode);
  const rows = db.prepare('SELECT * FROM classrooms WHERE site_code=? ORDER BY piso, nombre').all(siteCode);
  res.json({ ok: true, items: rows.map(rowToClassroom) });
});

classroomsRouter.get('/classrooms/summary', (_req, res) => {
  const db = getDb();
  const siteCode = requireSite(_req);
  ensureMigrated(db);
  ensureDefaultClassrooms(siteCode);
  const rows = db.prepare('SELECT * FROM classrooms WHERE site_code=?').all(siteCode).map(rowToClassroom);
  const hasFault = (room, key) => room.equipment?.some(item => item.key === key && (item.state === 'Con falla' || item.state === 'En reparación'));
  const summary = {
    total: rows.length,
    ok: rows.filter(r => r.estadoGeneral === 'OK').length,
    observaciones: rows.filter(r => r.estadoGeneral === 'Con observaciones').length,
    problema: rows.filter(r => r.estadoGeneral === 'Problema').length,
    sinRevisar: rows.filter(r => r.estadoGeneral === 'Sin revisar').length,
    proyectorFalla: rows.filter(r => hasFault(r, 'proyector')).length,
    nucFalla: rows.filter(r => hasFault(r, 'nuc')).length,
    monitorFalla: rows.filter(r => hasFault(r, 'monitor')).length
  };
  res.json({ ok: true, summary });
});

classroomsRouter.get('/classrooms/:roomKey', (req, res) => {
  const row = ensureClassroom(req.params.roomKey, req.query || {}, requireSite(req));
  res.json({ ok: true, item: rowToClassroom(row) });
});

classroomsRouter.patch('/classrooms/:roomKey', (req, res) => {
  const db = getDb();
  const siteCode = requireSite(req);
  const oldRow = ensureClassroom(req.params.roomKey, req.body || {}, siteCode);
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
    observaciones: body.observaciones ?? old.observaciones,
    equipment: equipmentFromBody(body, old)
  };

  for (const key of DEFAULT_EQUIPMENT_KEYS) {
    next[key] = migrateItemState(body[key] ?? next[key]);
  }
  if (!Array.isArray(body.equipment)) {
    next.equipment = next.equipment.map(item => {
      if (!DEFAULT_EQUIPMENT_KEYS.includes(item.key)) return item;
      return { ...item, state: next[item.key] };
    });
  }
  syncLegacyStates(next);
  next.estadoGeneral = calcEstadoGeneral(next);
  const equipmentJson = JSON.stringify(next.equipment);

  db.prepare(`
    UPDATE classrooms SET nombre=?, nivel=?, piso=?, sector=?, estado_general=?, proyector_estado=?, nuc_estado=?, monitor_estado=?, teclado_mouse_estado=?, observaciones=?, ultima_actualizacion=?, operador_ultimo_cambio=?, equipment_json=?
    WHERE room_key=? AND site_code=?
  `).run(next.nombre, next.nivel, next.piso, next.sector, next.estadoGeneral, next.proyector, next.nuc, next.monitor, next.tecladoMouse, next.observaciones, ts, operator, equipmentJson, req.params.roomKey, siteCode);

  const fields = [
    ['proyector', old.proyector, next.proyector],
    ['nuc', old.nuc, next.nuc],
    ['monitor', old.monitor, next.monitor],
    ['tecladoMouse', old.tecladoMouse, next.tecladoMouse],
    ['equipment', JSON.stringify(old.equipment || []), equipmentJson],
    ['observaciones', old.observaciones, next.observaciones],
    ['estadoGeneral', old.estadoGeneral, next.estadoGeneral]
  ];
  const insertHist = db.prepare('INSERT INTO classroom_history (room_key, site_code, timestamp, operador, campo, valor_anterior, valor_nuevo, observacion) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const [campo, antes, despues] of fields) {
    if (String(antes) !== String(despues)) insertHist.run(req.params.roomKey, siteCode, ts, operator, campo, String(antes), String(despues), '');
  }

  const updated = db.prepare('SELECT * FROM classrooms WHERE room_key=? AND site_code=?').get(req.params.roomKey, siteCode);
  res.json({ ok: true, item: rowToClassroom(updated) });
});

classroomsRouter.get('/classrooms/:roomKey/history', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM classroom_history WHERE room_key = ? AND site_code=? ORDER BY id DESC LIMIT 100').all(req.params.roomKey, requireSite(req));
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
