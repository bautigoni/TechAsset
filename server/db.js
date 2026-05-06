import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

let db;

export function getDb() {
  if (!db) {
    fs.mkdirSync(path.dirname(config.sqliteDbPath), { recursive: true });
    db = new Database(config.sqliteDbPath);
    db.pragma('journal_mode = WAL');
    initDb(db);
  }
  return db;
}

export function nowIso() {
  return new Date().toISOString();
}

export function initDb(database = getDb()) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS agenda (
      id TEXT PRIMARY KEY,
      dia TEXT,
      fecha TEXT,
      turno TEXT,
      desde TEXT,
      hasta TEXT,
      curso TEXT,
      actividad TEXT,
      tipo_dispositivo TEXT,
      cantidad INTEGER,
      ubicacion TEXT,
      responsable_tic TEXT,
      estado TEXT DEFAULT 'Pendiente',
      nota TEXT DEFAULT '',
      compus_retiradas INTEGER DEFAULT 0,
      operador_ultimo_cambio TEXT DEFAULT '',
      ultima_modificacion TEXT DEFAULT '',
      eliminada INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS agenda_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agenda_id TEXT,
      timestamp TEXT,
      accion TEXT,
      estado_anterior TEXT,
      estado_nuevo TEXT,
      nota TEXT,
      operador TEXT
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      titulo TEXT NOT NULL,
      descripcion TEXT DEFAULT '',
      responsable TEXT,
      estado TEXT DEFAULT 'Pendiente',
      prioridad TEXT DEFAULT 'Media',
      tipo TEXT DEFAULT 'Soporte',
      fecha_creacion TEXT,
      fecha_vencimiento TEXT DEFAULT '',
      comentario TEXT DEFAULT '',
      creado_por TEXT DEFAULT '',
      operador_ultimo_cambio TEXT DEFAULT '',
      agenda_id TEXT DEFAULT '',
      ultima_modificacion TEXT DEFAULT '',
      eliminada INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS task_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT,
      timestamp TEXT,
      titulo TEXT,
      accion TEXT,
      responsable TEXT,
      estado_anterior TEXT,
      estado_nuevo TEXT,
      comentario TEXT,
      operador TEXT,
      agenda_id TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS local_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT,
      tipo TEXT,
      descripcion TEXT,
      operador TEXT,
      origen TEXT,
      etiqueta TEXT
    );
    CREATE TABLE IF NOT EXISTS local_devices (
      etiqueta TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS local_states (
      etiqueta TEXT PRIMARY KEY,
      estado TEXT,
      prestado_a TEXT DEFAULT '',
      rol TEXT DEFAULT '',
      ubicacion TEXT DEFAULT '',
      motivo TEXT DEFAULT '',
      comentarios TEXT DEFAULT '',
      loaned_at TEXT DEFAULT '',
      returned_at TEXT DEFAULT '',
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS prestamos (
      id TEXT PRIMARY KEY,
      dispositivo_id TEXT,
      codigo_dispositivo TEXT,
      tipo_dispositivo TEXT,
      usuario_nombre TEXT,
      usuario_email TEXT DEFAULT '',
      curso_o_area TEXT DEFAULT '',
      sede TEXT DEFAULT 'NFPT',
      responsable_entrega TEXT,
      fecha_prestamo TEXT,
      fecha_devolucion_prevista TEXT,
      estado TEXT DEFAULT 'activo',
      observaciones_entrega TEXT DEFAULT '',
      condicion_entrega TEXT DEFAULT 'bueno',
      accesorios_entregados TEXT DEFAULT '',
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS classrooms (
      room_key TEXT PRIMARY KEY,
      nombre TEXT,
      nivel TEXT DEFAULT '',
      piso TEXT DEFAULT '',
      sector TEXT DEFAULT '',
      estado_general TEXT DEFAULT 'Sin revisar',
      proyector_estado TEXT DEFAULT 'Sin revisar',
      nuc_estado TEXT DEFAULT 'Sin revisar',
      monitor_estado TEXT DEFAULT 'Sin revisar',
      teclado_mouse_estado TEXT DEFAULT 'Sin revisar',
      observaciones TEXT DEFAULT '',
      ultima_actualizacion TEXT DEFAULT '',
      operador_ultimo_cambio TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS classroom_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_key TEXT,
      timestamp TEXT,
      operador TEXT DEFAULT '',
      campo TEXT DEFAULT '',
      valor_anterior TEXT DEFAULT '',
      valor_nuevo TEXT DEFAULT '',
      observacion TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS devoluciones (
      id TEXT PRIMARY KEY,
      prestamo_id TEXT,
      dispositivo_id TEXT,
      codigo_dispositivo TEXT,
      usuario_nombre TEXT,
      fecha_devolucion_real TEXT,
      responsable_recepcion TEXT,
      condicion_devolucion TEXT DEFAULT 'bueno',
      accesorios_devueltos TEXT DEFAULT '',
      observaciones_devolucion TEXT DEFAULT '',
      penalizacion_aplicada TEXT DEFAULT 'no',
      detalle_penalizacion TEXT DEFAULT '',
      created_at TEXT
    );
  `);

  ensureColumn(database, 'agenda', 'compus_retiradas', 'INTEGER DEFAULT 0');
  ensureColumn(database, 'classrooms', 'equipment_json', "TEXT DEFAULT ''");

  const count = database.prepare('SELECT COUNT(*) AS total FROM agenda').get().total;
  if (!count) seedAgenda(database);
  ensureFixedAgenda(database);
}

function ensureColumn(database, table, column, definition) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all().map(item => item.name);
  if (!columns.includes(column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function seedAgenda(database) {
  const rows = [
    ['AG001', 'Lunes', '', 'Mañana', '08:15', '09:05', '2N', 'Glifing', 'Touch', 25, 'Aula'],
    ['AG002', 'Lunes', '', 'Mañana', '09:05', '09:55', '2N', 'Glifing', 'Touch', 25, 'Aula'],
    ['AG003', 'Lunes', '', 'Mañana', '10:10', '11:00', '2N', 'Glifing', 'Touch', 25, 'Aula'],
    ['AG004', 'Martes', '', 'Mañana', '09:05', '09:55', '4N', 'Programación', 'Touch', 25, 'Aula'],
    ['AG005', 'Martes', '', 'Mañana', '10:10', '11:00', '4S', 'Programación', 'Touch', 25, 'Aula'],
    ['AG006', 'Miércoles', '', 'Mañana', '08:15', '09:05', '1F', 'Glifing', 'Touch', 25, 'Aula'],
    ['AG007', 'Jueves', '', 'Mañana', '09:05', '09:55', '1N', 'Glifing', 'Touch', 14, 'Aula'],
    ['AG008', 'Viernes', '', 'Tarde', '13:30', '14:15', '4N', 'TIC Grupo completo', 'TIC', 3, 'Aula TIC']
  ];
  const insert = database.prepare(`
    INSERT INTO agenda (id, dia, fecha, turno, desde, hasta, curso, actividad, tipo_dispositivo, cantidad, ubicacion, estado, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pendiente', ?)
  `);
  const ts = nowIso();
  const tx = database.transaction(() => rows.forEach(row => insert.run(...row, ts)));
  tx();
}

function fixedAgendaRows() {
  return [
    ['AG001', 'Lunes', '', 'Manana', '08:15', '09:05', '2N', 'Glifing', 'Touch', 25, 'Aula'],
    ['AG002', 'Lunes', '', 'Manana', '09:05', '09:55', '2N', 'Glifing', 'Touch', 25, 'Aula'],
    ['AG003', 'Lunes', '', 'Manana', '10:10', '11:00', '2N', 'Glifing', 'Touch', 25, 'Aula'],
    ['AG004', 'Martes', '', 'Manana', '09:05', '09:55', '4N', 'Programacion', 'Touch', 25, 'Aula'],
    ['AG005', 'Martes', '', 'Manana', '10:10', '11:00', '4S', 'Programacion', 'Touch', 25, 'Aula'],
    ['AG006', 'Martes', '', 'Manana', '11:00', '11:45', '4F', 'Programacion', 'Touch', 25, 'Aula'],
    ['AG007', 'Miercoles', '', 'Manana', '08:15', '09:05', '1F', 'Glifing', 'Touch', 25, 'Aula'],
    ['AG008', 'Miercoles', '', 'Manana', '09:05', '09:55', '1N', 'Glifing', 'Touch', 25, 'Aula'],
    ['AG009', 'Miercoles', '', 'Manana', '10:10', '11:00', '1S', 'Glifing', 'Touch', 25, 'Aula'],
    ['AG010', 'Jueves', '', 'Manana', '09:05', '09:55', '1N', 'Glifing', 'Touch', 14, 'Aula'],
    ['AG011', 'Jueves', '', 'Manana', '10:10', '11:00', '1N', 'Glifing', 'Touch', 14, 'Aula'],
    ['AG012', 'Jueves', '', 'Manana', '11:00', '11:45', '1N', 'Glifing', 'Touch', 14, 'Aula'],
    ['AG013', 'Viernes', '', 'Manana', '08:15', '09:05', 'Matific grupo total', 'Matific', 'Touch', 25, 'Aula'],
    ['AG014', 'Viernes', '', 'Manana', '09:05', '09:55', 'Matific grupo total', 'Matific', 'Touch', 25, 'Aula'],
    ['AG015', 'Viernes', '', 'Manana', '10:10', '11:00', 'Matific grupo total', 'Matific', 'Touch', 25, 'Aula'],
    ['AG016', 'Lunes', '', 'Tarde', '13:30', '14:15', '2N', 'Reserva Touch', 'Touch', 14, 'Aula'],
    ['AG017', 'Lunes', '', 'Tarde', '14:35', '15:25', '3N', 'Reserva Touch', 'Touch', 14, 'Aula'],
    ['AG018', 'Lunes', '', 'Tarde', '15:25', '16:20', '2S', 'Reserva Touch', 'Touch', 14, 'Aula'],
    ['AG019', 'Martes', '', 'Tarde', '13:30', '14:15', '1S', 'Reserva Touch', 'Touch', 14, 'Aula'],
    ['AG020', 'Martes', '', 'Tarde', '14:35', '15:25', '1N', 'Reserva Touch', 'Touch', 14, 'Aula'],
    ['AG021', 'Martes', '', 'Tarde', '15:25', '16:20', '1F', 'Reserva Touch', 'Touch', 14, 'Aula'],
    ['AG022', 'Miercoles', '', 'Tarde', '13:30', '14:15', '2F', 'Reserva Touch', 'Touch', 14, 'Aula'],
    ['AG023', 'Miercoles', '', 'Tarde', '14:35', '15:25', '3S', 'Reserva Touch', 'Touch', 14, 'Aula'],
    ['AG024', 'Miercoles', '', 'Tarde', '15:25', '16:20', '3F', 'Reserva Touch', 'Touch', 14, 'Aula'],
    ['AG025', 'Viernes', '', 'Tarde', '13:30', '14:15', '4N', 'TIC Grupo completo', 'TIC', 3, 'Aula TIC'],
    ['AG026', 'Viernes', '', 'Tarde', '14:35', '15:25', '4S', 'TIC Grupo completo', 'TIC', 3, 'Aula TIC'],
    ['AG027', 'Viernes', '', 'Tarde', '15:25', '16:20', '4F', 'TIC Grupo completo', 'TIC', 3, 'Aula TIC']
  ];
}

function ensureFixedAgenda(database) {
  const ts = nowIso();
  const upsert = database.prepare(`
    INSERT INTO agenda (id, dia, fecha, turno, desde, hasta, curso, actividad, tipo_dispositivo, cantidad, ubicacion, estado, ultima_modificacion, eliminada, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pendiente', ?, 0, ?)
    ON CONFLICT(id) DO UPDATE SET
      dia = excluded.dia,
      fecha = excluded.fecha,
      turno = excluded.turno,
      desde = excluded.desde,
      hasta = excluded.hasta,
      curso = excluded.curso,
      actividad = excluded.actividad,
      tipo_dispositivo = excluded.tipo_dispositivo,
      cantidad = excluded.cantidad,
      ubicacion = excluded.ubicacion,
      eliminada = 0,
      ultima_modificacion = excluded.ultima_modificacion
  `);
  const tx = database.transaction(() => fixedAgendaRows().forEach(row => upsert.run(...row, ts, ts)));
  tx();
}

export function rowToAgenda(row) {
  return {
    id: row.id,
    dia: row.dia || '',
    fecha: row.fecha || '',
    turno: row.turno || '',
    desde: row.desde || '',
    hasta: row.hasta || '',
    curso: row.curso || '',
    actividad: row.actividad || '',
    tipoDispositivo: row.tipo_dispositivo || '',
    cantidad: Number(row.cantidad || 0),
    ubicacion: row.ubicacion || '',
    responsableTic: row.responsable_tic || '',
    estado: row.estado || 'Pendiente',
    nota: row.nota || '',
    compusRetiradas: Number(row.compus_retiradas || 0),
    operadorUltimoCambio: row.operador_ultimo_cambio || '',
    ultimaModificacion: row.ultima_modificacion || '',
    createdAt: row.created_at || ''
  };
}

export function rowToTask(row) {
  return {
    id: row.id,
    titulo: row.titulo || '',
    descripcion: row.descripcion || '',
    responsable: row.responsable || 'Bauti',
    estado: row.estado || 'Pendiente',
    prioridad: row.prioridad || 'Media',
    tipo: row.tipo || 'Soporte',
    fechaCreacion: row.fecha_creacion || '',
    fechaVencimiento: row.fecha_vencimiento || '',
    comentario: row.comentario || '',
    creadoPor: row.creado_por || '',
    operadorUltimoCambio: row.operador_ultimo_cambio || '',
    agendaId: row.agenda_id || '',
    ultimaModificacion: row.ultima_modificacion || ''
  };
}

export function addLocalMovement({ tipo, descripcion, operador, origen = 'Local', etiqueta = '' }) {
  getDb().prepare('INSERT INTO local_movements (timestamp, tipo, descripcion, operador, origen, etiqueta) VALUES (?, ?, ?, ?, ?, ?)')
    .run(nowIso(), tipo, descripcion, operador || '', origen, etiqueta || '');
}

export function setLocalState(etiqueta, fields) {
  const tag = String(etiqueta || '').trim();
  if (!tag) return;
  getDb().prepare(`
    INSERT INTO local_states (etiqueta, estado, prestado_a, rol, ubicacion, motivo, comentarios, loaned_at, returned_at, updated_at)
    VALUES (@etiqueta, @estado, @prestado_a, @rol, @ubicacion, @motivo, @comentarios, @loaned_at, @returned_at, @updated_at)
    ON CONFLICT(etiqueta) DO UPDATE SET
      estado=excluded.estado,
      prestado_a=excluded.prestado_a,
      rol=excluded.rol,
      ubicacion=excluded.ubicacion,
      motivo=excluded.motivo,
      comentarios=excluded.comentarios,
      loaned_at=excluded.loaned_at,
      returned_at=excluded.returned_at,
      updated_at=excluded.updated_at
  `).run({
    etiqueta: tag,
    estado: fields.estado || '',
    prestado_a: fields.prestadoA || '',
    rol: fields.rol || '',
    ubicacion: fields.ubicacion || '',
    motivo: fields.motivo || '',
    comentarios: fields.comentarios || '',
    loaned_at: fields.loanedAt || '',
    returned_at: fields.returnedAt || '',
    updated_at: nowIso()
  });
}

export function getAppSetting(key) {
  const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setAppSetting(key, value) {
  getDb().prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
  `).run(key, value == null ? '' : String(value), nowIso());
}

export function getLocalStates() {
  return getDb().prepare('SELECT * FROM local_states').all().map(row => ({
    etiqueta: row.etiqueta,
    estado: row.estado || '',
    prestadoA: row.prestado_a || '',
    rol: row.rol || '',
    ubicacion: row.ubicacion || '',
    motivo: row.motivo || '',
    comentarios: row.comentarios || '',
    loanedAt: row.loaned_at || '',
    returnedAt: row.returned_at || '',
    updatedAt: row.updated_at || ''
  }));
}
