import { Router } from 'express';
import { getDb, nowIso } from '../db.js';
import { isSiteManager, requireSite } from '../services/siteContext.service.js';
import { notifySiteAdmins } from '../services/notifications.service.js';
import { callOpenAiResponses, responseOutputText } from '../services/openaiResponses.service.js';

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

// Nordelta (NFND). room_key/nombre/piso deben coincidir con NordeltaModels.jsx.
// Los pisos coinciden con los `piso` de SITE_MAPS.NFND en ClassroomStatusPage.
const NFND_CLASSROOMS = [
  // Bloque 3 · Planta baja
  ['nd_pb_2S_EP', '2°S EP', 'Planta baja', 'classroom'],
  ['nd_pb_2F_EP', '2°F EP', 'Planta baja', 'classroom'],
  ['nd_pb_agora', 'Ágora', 'Planta baja', 'special'],
  ['nd_pb_2N_EP', '2°N EP', 'Planta baja', 'classroom'],
  ['nd_pb_1S_EP', '1°S EP', 'Planta baja', 'classroom'],
  ['nd_pb_1F_EP', '1°F EP', 'Planta baja', 'classroom'],
  ['nd_pb_1N_EP', '1°N EP', 'Planta baja', 'classroom'],
  ['nd_pb_blooming', 'Blooming', 'Planta baja', 'special'],
  ['nd_pb_5N_ES', '5°N ES', 'Planta baja', 'classroom'],
  ['nd_pb_5F_ES', '5°F ES', 'Planta baja', 'classroom'],
  ['nd_pb_under', 'Under', 'Planta baja', 'special'],
  ['nd_pb_5S_ES', '5°S ES', 'Planta baja', 'classroom'],
  ['nd_pb_6N_ES', '6°N ES', 'Planta baja', 'classroom'],
  ['nd_pb_6F_ES', '6°F ES', 'Planta baja', 'classroom'],
  // Bloque 3 · 1er piso
  ['nd_p1_3F_EP', '3°F EP', '1er piso', 'classroom'],
  ['nd_p1_3N_EP', '3°N EP', '1er piso', 'classroom'],
  ['nd_p1_3S_EP', '3°S EP', '1er piso', 'classroom'],
  ['nd_p1_5N_EP', '5°N EP', '1er piso', 'classroom'],
  ['nd_p1_TICS', 'TICS', '1er piso', 'special'],
  ['nd_p1_2N_ES', '2do N ES', '1er piso', 'classroom'],
  ['nd_p1_2F_ES', '2do F ES', '1er piso', 'classroom'],
  ['nd_p1_2S_ES', '2do S ES', '1er piso', 'classroom'],
  ['nd_p1_4N_EP', '4°N EP', '1er piso', 'classroom'],
  ['nd_p1_4NF_EP', '4°NF EP', '1er piso', 'classroom'],
  ['nd_p1_4S_EP', '4°S EP', '1er piso', 'classroom'],
  ['nd_p1_5F_EP', '5°F EP', '1er piso', 'classroom'],
  ['nd_p1_5S_EP', '5°S EP', '1er piso', 'classroom'],
  ['nd_p1_1N_ES', '1ro N ES', '1er piso', 'classroom'],
  ['nd_p1_1F_ES', '1ro F ES', '1er piso', 'classroom'],
  ['nd_p1_1S_ES', '1ro S ES', '1er piso', 'classroom'],
  // Bloque 3 · 2do piso
  ['nd_p2_TICS', 'TICS', '2do piso', 'special'],
  ['nd_p2_6S_EP', '6°S EP', '2do piso', 'classroom'],
  ['nd_p2_lab', 'Laboratorio', '2do piso', 'special'],
  ['nd_p2_4N_ES', '4to N ES', '2do piso', 'classroom'],
  ['nd_p2_4F_ES', '4to F ES', '2do piso', 'classroom'],
  ['nd_p2_4S_ES', '4to S ES', '2do piso', 'classroom'],
  ['nd_p2_6N_EP', '6°N EP', '2do piso', 'classroom'],
  ['nd_p2_6F_EP', '6°F EP', '2do piso', 'classroom'],
  ['nd_p2_3N_ES', '3ro N ES', '2do piso', 'classroom'],
  ['nd_p2_3F_ES', '3ro F ES', '2do piso', 'classroom'],
  ['nd_p2_3S_ES', '3ro S ES', '2do piso', 'classroom'],
  // Nivel inicial
  ['nd_ini_K1y2', 'K 1y2', 'Nivel inicial', 'classroom'],
  ['nd_ini_K2F', 'K2 F', 'Nivel inicial', 'classroom'],
  ['nd_ini_K2N', 'K2 N', 'Nivel inicial', 'classroom'],
  ['nd_ini_SUM', 'SUM', 'Nivel inicial', 'special'],
  ['nd_ini_K3Taller', 'K3 Taller', 'Nivel inicial', 'special'],
  ['nd_ini_K4N', 'K4 N', 'Nivel inicial', 'classroom'],
  ['nd_ini_K4F', 'K4 F', 'Nivel inicial', 'classroom'],
  ['nd_ini_K4S', 'K4 S', 'Nivel inicial', 'classroom'],
  ['nd_ini_K3N', 'K3 N', 'Nivel inicial', 'classroom'],
  ['nd_ini_K3F', 'K3 F', 'Nivel inicial', 'classroom'],
  ['nd_ini_K5S', 'K5 S', 'Nivel inicial', 'classroom'],
  ['nd_ini_K5F', 'K5 F', 'Nivel inicial', 'classroom'],
  ['nd_ini_K5N', 'K5 N', 'Nivel inicial', 'classroom'],
  // Edificio SUM / Artes
  ['nd_art_SUM', 'SUM', 'Artes', 'special'],
  ['nd_art_music', 'Música', 'Artes', 'classroom'],
  ['nd_art_arte', 'Arte', 'Artes', 'classroom'],
  ['nd_art_esceno', 'Escenografía', 'Artes', 'special'],
  ['nd_art_blooming', 'Blooming Inicial', 'Artes', 'special'],
  ['nd_art_drama', 'Drama', 'Artes', 'classroom']
];

const SITE_DEFAULT_CLASSROOMS = {
  NFPT: DEFAULT_CLASSROOMS,
  NFND: NFND_CLASSROOMS
};

function migrateItemState(value) {
  if (value === 'No encontrado') return 'Con falla';
  if (VALID_ITEM_STATES.has(value)) return value;
  return 'Sin revisar';
}

function stateFromRow(row, key) {
  const option = equipmentOption(row.site_code, key);
  if (option?.column) return migrateItemState(row[option.column] || 'Sin revisar');
  return 'Sin revisar';
}

function normalizeEquipmentItem(item, row) {
  const key = String(item?.key || '').trim();
  const option = equipmentOption(row.site_code, key) || { key, label: String(item?.label || key) };
  if (!key) return null;
  return {
    key,
    label: String(item?.label || option.label || key),
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

function equipmentOption(siteCode, key) {
  const configured = getDb().prepare('SELECT category_key AS key, label FROM classroom_categories WHERE site_code=? AND category_key=? AND active=1').get(siteCode || 'NFPT', key);
  return configured || EQUIPMENT_BY_KEY.get(key);
}

function activeCategoryMap(siteCode) {
  return new Map(getDb().prepare('SELECT category_key AS key, label FROM classroom_categories WHERE site_code=? AND active=1 ORDER BY sort_order, id').all(siteCode).map(item => [item.key, item]));
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
  // Cada sede siembra su propio padrón de aulas. Sedes sin plano definido no
  // seedean nada (no heredan las aulas de NFPT).
  const defaults = SITE_DEFAULT_CLASSROOMS[siteCode];
  if (!defaults) return;
  for (const [roomKey, nombre, piso, sector] of defaults) {
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
  const configured = activeCategoryMap(old.siteCode || 'NFPT');
  const byOldState = new Map((old.equipment || []).map(item => [item.key, item.state]));
  const oldLabels = new Map((old.equipment || []).map(item => [item.key, item.label]));
  const items = body.equipment.map(item => {
    const key = String(item?.key || '').trim();
    const option = configured.get(key) || (byOldState.has(key) ? { label: oldLabels.get(key) || key } : null);
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

classroomsRouter.get('/classroom-categories', (req, res) => {
  const siteCode = requireSite(req);
  ensureClassroomCategories(siteCode);
  const items = getDb().prepare('SELECT * FROM classroom_categories WHERE site_code=? AND active=1 ORDER BY sort_order, id').all(siteCode).map(rowToCategory);
  res.json({ ok: true, items, canManage: isSiteManager(req, siteCode) });
});

classroomsRouter.post('/classroom-categories', (req, res) => {
  const siteCode = requireSite(req);
  if (!isSiteManager(req, siteCode)) return res.status(403).json({ ok: false, error: 'Solo un administrador puede crear categorías de aula.' });
  const label = String(req.body?.label || '').trim();
  if (!label) return res.status(400).json({ ok: false, error: 'La categoría necesita un nombre.' });
  const key = uniqueCategoryKey(siteCode, req.body?.key || label);
  const options = normalizeCategoryOptions(req.body?.options);
  const order = Number(getDb().prepare('SELECT COALESCE(MAX(sort_order),-1) AS value FROM classroom_categories WHERE site_code=? AND active=1').get(siteCode).value) + 1;
  const ts = nowIso();
  const info = getDb().prepare(`
    INSERT INTO classroom_categories (site_code, category_key, label, category_type, options_json, sort_order, built_in, active, created_at, updated_at)
    VALUES (?, ?, ?, 'status', ?, ?, 0, 1, ?, ?)
  `).run(siteCode, key, label, JSON.stringify(options), order, ts, ts);
  try { notifySiteAdmins({ siteCode, kind: 'classroom.category.created', title: 'Nueva categoría de aula', body: label, link: `/sede/${siteCode}/classrooms`, exceptEmail: req.user?.email }); } catch { /* noop */ }
  res.json({ ok: true, item: rowToCategory(getDb().prepare('SELECT * FROM classroom_categories WHERE id=?').get(info.lastInsertRowid)) });
});

classroomsRouter.patch('/classroom-categories/reorder', (req, res) => {
  const siteCode = requireSite(req);
  if (!isSiteManager(req, siteCode)) return res.status(403).json({ ok: false, error: 'Solo un administrador puede ordenar categorías.' });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : [];
  const update = getDb().prepare('UPDATE classroom_categories SET sort_order=?, updated_at=? WHERE id=? AND site_code=? AND active=1');
  const ts = nowIso();
  getDb().transaction(() => ids.forEach((id, index) => update.run(index, ts, id, siteCode)))();
  res.json({ ok: true });
});

classroomsRouter.patch('/classroom-categories/:id', (req, res) => {
  const siteCode = requireSite(req);
  if (!isSiteManager(req, siteCode)) return res.status(403).json({ ok: false, error: 'Solo un administrador puede editar categorías.' });
  const old = getDb().prepare('SELECT * FROM classroom_categories WHERE id=? AND site_code=? AND active=1').get(req.params.id, siteCode);
  if (!old) return res.status(404).json({ ok: false, error: 'Categoría no encontrada.' });
  const label = String(req.body?.label ?? old.label).trim();
  const options = req.body?.options == null ? parseOptions(old.options_json) : normalizeCategoryOptions(req.body.options);
  getDb().prepare('UPDATE classroom_categories SET label=?, options_json=?, updated_at=? WHERE id=? AND site_code=?').run(label, JSON.stringify(options), nowIso(), old.id, siteCode);
  res.json({ ok: true, item: rowToCategory(getDb().prepare('SELECT * FROM classroom_categories WHERE id=?').get(old.id)) });
});

classroomsRouter.delete('/classroom-categories/:id', (req, res) => {
  const siteCode = requireSite(req);
  if (!isSiteManager(req, siteCode)) return res.status(403).json({ ok: false, error: 'Solo un administrador puede eliminar categorías.' });
  const result = getDb().prepare('UPDATE classroom_categories SET active=0, updated_at=? WHERE id=? AND site_code=?').run(nowIso(), req.params.id, siteCode);
  res.json({ ok: true, deleted: result.changes > 0 });
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

classroomsRouter.get('/classrooms/:roomKey/incidents', (req, res) => {
  const siteCode = requireSite(req);
  const classroom = ensureClassroom(req.params.roomKey, {}, siteCode);
  const rows = getDb().prepare(`
    SELECT * FROM tickets
    WHERE site_code=? AND COALESCE(activo,1)=1 AND COALESCE(deleted_at,'')=''
      AND (
        classroom_key=?
        OR (COALESCE(classroom_key,'')='' AND lower(trim(classroom))=lower(trim(?)))
        OR (COALESCE(classroom_key,'')='' AND lower(trim(classroom))=lower(trim(?)))
      )
    ORDER BY COALESCE(created_at,updated_at) DESC, id DESC
  `).all(siteCode, req.params.roomKey, classroom.nombre || '', req.params.roomKey);
  const categoryCounts = new Map();
  for (const row of rows) {
    const category = String(row.categoria || 'Sin categoría').trim() || 'Sin categoría';
    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
  }
  const incidents = rows.map(row => ({
    id: Number(row.id), numero: row.numero || '', titulo: row.titulo || '', descripcion: row.descripcion || '',
    estado: row.estado || 'No hecho', prioridad: row.prioridad || 'Media', categoria: row.categoria || 'Sin categoría',
    responsables: parseStringArray(row.responsables_json), createdAt: row.created_at || '', updatedAt: row.updated_at || '', resolvedAt: row.resolved_at || ''
  }));
  res.json({
    ok: true,
    summary: {
      open: incidents.filter(item => item.estado !== 'Hecho').length,
      closed: incidents.filter(item => item.estado === 'Hecho').length,
      total: incidents.length,
      lastIncidentAt: incidents[0]?.createdAt || incidents[0]?.updatedAt || '',
      commonCategories: [...categoryCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, value]) => ({ label, value }))
    },
    items: incidents
  });
});

classroomsRouter.post('/classrooms/:roomKey/health', async (req, res, next) => {
  try {
    const siteCode = requireSite(req);
    const classroom = ensureClassroom(req.params.roomKey, {}, siteCode);
    const tickets = getDb().prepare(`SELECT numero,titulo,descripcion,estado,prioridad,categoria,created_at,updated_at FROM tickets WHERE site_code=? AND activo=1 AND (classroom_key=? OR lower(trim(classroom))=lower(trim(?))) ORDER BY created_at DESC LIMIT 80`).all(siteCode, req.params.roomKey, classroom.nombre || '');
    const devices = getDb().prepare(`SELECT etiqueta,categoria,modelo,estado,ubicacion,comentarios FROM local_devices WHERE site_code=? AND activo=1 AND eliminado=0 AND lower(COALESCE(ubicacion,'')) LIKE lower(?) LIMIT 80`).all(siteCode, `%${classroom.nombre || req.params.roomKey}%`);
    const equipment = parseHealthEquipment(classroom.equipment_json, classroom);
    let report;
    try {
      const data = await callOpenAiResponses({
        instructions: 'Sos analista de salud de aulas escolares. Respondé SOLO JSON válido, conciso, en español, con score (0-100), status, summary, recurringProblems[], positives[], risks[], preventiveActions[]. No inventes datos.',
        input: `Aula: ${JSON.stringify({ name:classroom.nombre, state:classroom.estado_general, observations:classroom.observaciones, equipment, tickets, devices })}`,
        maxOutputTokens: 900
      });
      report = parseHealthReport(responseOutputText(data));
    } catch {
      report = localHealthReport(classroom, equipment, tickets, devices);
    }
    const ts=nowIso();
    getDb().prepare(`INSERT INTO classroom_health_reports (site_code,room_key,report_json,generated_by,generated_at) VALUES (?,?,?,?,?) ON CONFLICT(site_code,room_key) DO UPDATE SET report_json=excluded.report_json,generated_by=excluded.generated_by,generated_at=excluded.generated_at`)
      .run(siteCode,req.params.roomKey,JSON.stringify(report),req.user?.nombre||req.user?.email||'',ts);
    res.json({ok:true,report,generatedAt:ts});
  } catch(error){ next(error); }
});

function parseHealthReport(text){ const clean=String(text||'').replace(/^```json\s*/i,'').replace(/```$/,'').trim(); const value=JSON.parse(clean); return {score:Math.max(0,Math.min(100,Number(value.score)||0)),status:String(value.status||'Sin datos'),summary:String(value.summary||''),recurringProblems:list(value.recurringProblems),positives:list(value.positives),risks:list(value.risks),preventiveActions:list(value.preventiveActions)}; }
function list(value){ return Array.isArray(value)?value.map(String).filter(Boolean).slice(0,6):[]; }
function parseHealthEquipment(value,row){ try{const parsed=JSON.parse(value||'[]');if(Array.isArray(parsed))return parsed;}catch{} return [{label:'Proyector',state:row.proyector_estado},{label:'NUC',state:row.nuc_estado},{label:'Monitor',state:row.monitor_estado},{label:'Teclado/Mouse',state:row.teclado_mouse_estado}]; }
function localHealthReport(classroom,equipment,tickets,devices){ const bad=equipment.filter(item=>!['OK','No tiene'].includes(String(item.state))).map(item=>`${item.label}: ${item.state}`); const open=tickets.filter(item=>item.estado!=='Hecho'); const score=Math.max(10,100-bad.length*12-open.length*7); const counts={}; tickets.forEach(item=>{const key=item.categoria||'Sin categoría';counts[key]=(counts[key]||0)+1;}); const recurring=Object.entries(counts).filter(([,n])=>n>1).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([key,n])=>`${key} (${n})`); return {score,status:score>=85?'Saludable':score>=65?'Atención':'Crítico',summary:`${classroom.nombre||'El aula'} tiene ${open.length} incidentes abiertos y ${bad.length} componentes para revisar.`,recurringProblems:recurring,positives:[...equipment.filter(item=>item.state==='OK').map(item=>`${item.label} funciona correctamente`),devices.length?`${devices.length} dispositivos vinculados`:''].filter(Boolean).slice(0,4),risks:[...bad,...open.slice(0,3).map(item=>item.titulo||item.descripcion)].filter(Boolean),preventiveActions:[bad.length?'Revisar el equipamiento marcado antes de la próxima clase':'Mantener la revisión periódica',open.length?'Resolver y documentar los incidentes abiertos':'Continuar registrando incidentes por aula']}; }

function ensureClassroomCategories(siteCode) {
  const count = Number(getDb().prepare('SELECT COUNT(*) AS total FROM classroom_categories WHERE site_code=?').get(siteCode).total || 0);
  if (count) return;
  const ts = nowIso();
  const options = JSON.stringify([...VALID_ITEM_STATES]);
  const insert = getDb().prepare("INSERT INTO classroom_categories (site_code, category_key, label, category_type, options_json, sort_order, built_in, active, created_at, updated_at) VALUES (?, ?, ?, 'status', ?, ?, 1, 1, ?, ?) ON CONFLICT(site_code, category_key) DO NOTHING");
  EQUIPMENT_OPTIONS.forEach((item, index) => insert.run(siteCode, item.key, item.label, options, index, ts, ts));
}

function parseOptions(value) {
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [...VALID_ITEM_STATES]; }
  catch { return [...VALID_ITEM_STATES]; }
}

function parseStringArray(value) {
  try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []; } catch { return []; }
}

function normalizeCategoryOptions(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  const options = raw.map(item => String(item).trim()).filter(item => VALID_ITEM_STATES.has(item));
  return options.length ? [...new Set(options)] : [...VALID_ITEM_STATES];
}

function rowToCategory(row) {
  return { id: row.id, key: row.category_key, label: row.label, type: row.category_type || 'status', options: parseOptions(row.options_json), sortOrder: Number(row.sort_order || 0), builtIn: Boolean(row.built_in) };
}

function uniqueCategoryKey(siteCode, value) {
  const base = String(value || 'categoria').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+(.)?/g, (_match, next) => next ? next.toUpperCase() : '').replace(/^[A-Z]/, letter => letter.toLowerCase()).slice(0, 48) || 'categoria';
  let key = base;
  let suffix = 2;
  while (getDb().prepare('SELECT 1 FROM classroom_categories WHERE site_code=? AND category_key=?').get(siteCode, key)) key = `${base}${suffix++}`;
  return key;
}
