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
    CREATE TABLE IF NOT EXISTS sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT UNIQUE NOT NULL,
      nombre TEXT,
      subtitulo TEXT DEFAULT '',
      logo TEXT DEFAULT '',
      activo INTEGER DEFAULT 1,
      spreadsheet_url TEXT DEFAULT '',
      apps_script_url TEXT DEFAULT '',
      inventory_sheet_name TEXT DEFAULT '',
      theme_color TEXT DEFAULT '',
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS allowed_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      nombre TEXT DEFAULT '',
      default_role TEXT DEFAULT 'Consulta',
      can_choose_role INTEGER DEFAULT 0,
      activo INTEGER DEFAULT 1,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS allowed_user_sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      allowed_user_id INTEGER,
      site_code TEXT,
      site_role TEXT DEFAULT 'Consulta',
      turno TEXT DEFAULT 'Sin turno',
      is_default INTEGER DEFAULT 0,
      activo INTEGER DEFAULT 1,
      created_at TEXT,
      updated_at TEXT,
      UNIQUE(allowed_user_id, site_code)
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      nombre TEXT DEFAULT '',
      rol_global TEXT DEFAULT 'Consulta',
      activo INTEGER DEFAULT 1,
      last_login_at TEXT DEFAULT '',
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS user_sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      site_code TEXT,
      site_role TEXT DEFAULT 'Consulta',
      turno TEXT DEFAULT 'Sin turno',
      is_default INTEGER DEFAULT 0,
      activo INTEGER DEFAULT 1,
      created_at TEXT,
      updated_at TEXT,
      UNIQUE(user_id, site_code)
    );
    CREATE TABLE IF NOT EXISTS user_sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER,
      created_at TEXT,
      expires_at TEXT,
      last_seen_at TEXT
    );
    CREATE TABLE IF NOT EXISTS site_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT,
      key TEXT,
      value_json TEXT DEFAULT '',
      updated_at TEXT,
      UNIQUE(site_code, key)
    );
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
      responsables_json TEXT DEFAULT '',
      estado TEXT DEFAULT 'Pendiente',
      prioridad TEXT DEFAULT 'Media',
      tipo TEXT DEFAULT 'Soporte',
      turno TEXT DEFAULT 'Sin turno',
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
    CREATE TABLE IF NOT EXISTS task_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT,
      texto TEXT,
      completada INTEGER DEFAULT 0,
      orden INTEGER DEFAULT 0,
      creado_por TEXT DEFAULT '',
      completado_por TEXT DEFAULT '',
      created_at TEXT,
      completed_at TEXT DEFAULT ''
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
    CREATE TABLE IF NOT EXISTS hidden_devices (
      etiqueta TEXT PRIMARY KEY,
      deleted_at TEXT,
      deleted_by TEXT DEFAULT '',
      reason TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS device_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      nombre TEXT,
      color TEXT DEFAULT '',
      icono TEXT DEFAULT '',
      activo INTEGER DEFAULT 1,
      created_at TEXT,
      updated_at TEXT,
      UNIQUE(site_code, nombre)
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
    CREATE TABLE IF NOT EXISTS internal_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      texto TEXT NOT NULL,
      operador TEXT DEFAULT '',
      categoria TEXT DEFAULT 'General',
      importante INTEGER DEFAULT 0,
      archivada INTEGER DEFAULT 0,
      visible INTEGER DEFAULT 1,
      deleted_at TEXT DEFAULT '',
      deleted_by TEXT DEFAULT '',
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS daily_closures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT,
      operador TEXT DEFAULT '',
      resumen_json TEXT DEFAULT '{}',
      observaciones TEXT DEFAULT '',
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS quick_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo TEXT,
      url TEXT,
      descripcion TEXT DEFAULT '',
      categoria TEXT DEFAULT '',
      icono TEXT DEFAULT '',
      creado_por TEXT DEFAULT '',
      activo INTEGER DEFAULT 1,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS classroom_maps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT,
      floor_key TEXT,
      floor_name TEXT,
      component_name TEXT DEFAULT '',
      activo INTEGER DEFAULT 1,
      created_at TEXT,
      updated_at TEXT,
      UNIQUE(site_code, floor_key)
    );
  `);

  ensureColumn(database, 'agenda', 'site_code', "TEXT DEFAULT 'NFPT'");
  ensureColumn(database, 'agenda_history', 'site_code', "TEXT DEFAULT 'NFPT'");
  ensureColumn(database, 'tasks', 'site_code', "TEXT DEFAULT 'NFPT'");
  ensureColumn(database, 'task_history', 'site_code', "TEXT DEFAULT 'NFPT'");
  ensureColumn(database, 'task_items', 'site_code', "TEXT DEFAULT 'NFPT'");
  ensureColumn(database, 'local_movements', 'site_code', "TEXT DEFAULT 'NFPT'");
  ensureColumn(database, 'local_devices', 'site_code', "TEXT DEFAULT 'NFPT'");
  ensureColumn(database, 'local_devices', 'eliminado', "INTEGER DEFAULT 0");
  ensureColumn(database, 'local_devices', 'deleted_at', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'deleted_by', "TEXT DEFAULT ''");
  ensureColumn(database, 'hidden_devices', 'site_code', "TEXT DEFAULT 'NFPT'");
  ensureColumn(database, 'device_categories', 'site_code', "TEXT DEFAULT 'NFPT'");
  ensureColumn(database, 'local_states', 'site_code', "TEXT DEFAULT 'NFPT'");
  ensureColumn(database, 'local_states', 'ubicacion_detalle', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_states', 'curso', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_states', 'motivo_detalle', "TEXT DEFAULT ''");
  ensureColumn(database, 'prestamos', 'site_code', "TEXT DEFAULT 'NFPT'");
  ensureColumn(database, 'prestamos', 'ubicacion_detalle', "TEXT DEFAULT ''");
  ensureColumn(database, 'prestamos', 'motivo_detalle', "TEXT DEFAULT ''");
  ensureColumn(database, 'classrooms', 'site_code', "TEXT DEFAULT 'NFPT'");
  ensureColumn(database, 'classroom_history', 'site_code', "TEXT DEFAULT 'NFPT'");
  ensureColumn(database, 'devoluciones', 'site_code', "TEXT DEFAULT 'NFPT'");
  ensureColumn(database, 'internal_notes', 'site_code', "TEXT DEFAULT 'NFPT'");
  ensureColumn(database, 'daily_closures', 'site_code', "TEXT DEFAULT 'NFPT'");
  ensureColumn(database, 'quick_links', 'site_code', "TEXT DEFAULT 'NFPT'");
  ensureColumn(database, 'agenda', 'compus_retiradas', 'INTEGER DEFAULT 0');
  ensureColumn(database, 'classrooms', 'equipment_json', "TEXT DEFAULT ''");
  ensureColumn(database, 'tasks', 'responsables_json', "TEXT DEFAULT ''");
  ensureColumn(database, 'tasks', 'turno', "TEXT DEFAULT 'Sin turno'");
  ensureColumn(database, 'internal_notes', 'visible', "INTEGER DEFAULT 1");
  ensureColumn(database, 'internal_notes', 'deleted_at', "TEXT DEFAULT ''");
  ensureColumn(database, 'internal_notes', 'deleted_by', "TEXT DEFAULT ''");

  seedDefaultSite(database);
  seedDefaultSettings(database);
  for (const site of parseBootstrapSites()) seedDefaultSettings(database, site.siteCode);
  seedAllowedUsers(database);
  migrateDeviceIdentityTables(database);

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

function seedDefaultSite(database) {
  const ts = nowIso();
  const siteCode = config.defaultSiteCode || 'NFPT';
  const bootstrap = parseBootstrapSites();
  database.prepare(`
    INSERT INTO sites (site_code, nombre, subtitulo, activo, spreadsheet_url, apps_script_url, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT(site_code) DO UPDATE SET
      nombre=COALESCE(NULLIF(sites.nombre,''), excluded.nombre),
      subtitulo=COALESCE(NULLIF(sites.subtitulo,''), excluded.subtitulo),
      spreadsheet_url=COALESCE(NULLIF(sites.spreadsheet_url,''), excluded.spreadsheet_url),
      apps_script_url=COALESCE(NULLIF(sites.apps_script_url,''), excluded.apps_script_url),
      updated_at=excluded.updated_at
  `).run(siteCode, 'Northfield Puertos', 'Sede actual', config.googleSheetCsvUrl || '', config.appsScriptUrl || '', ts, ts);
  const stmt = database.prepare(`
    INSERT INTO sites (site_code, nombre, subtitulo, activo, created_at, updated_at)
    VALUES (?, ?, '', 1, ?, ?)
    ON CONFLICT(site_code) DO NOTHING
  `);
  for (const site of bootstrap) stmt.run(site.siteCode, site.nombre, ts, ts);
}

function parseBootstrapSites() {
  return String(config.bootstrapSites || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const [code, ...rest] = item.split(':');
      return { siteCode: String(code || '').trim().toUpperCase(), nombre: rest.join(':').trim() || String(code || '').trim().toUpperCase() };
    })
    .filter(item => item.siteCode);
}

export function seedDefaultSettings(database, siteCode = config.defaultSiteCode || 'NFPT') {
  const defaults = {
    'loan.roles': ['DOE', 'Alumno', 'Maestra', 'Profesor', 'Directivo', 'Preceptor', 'Otro'],
    'loan.locations': [
      { label: 'Aula', requiresCourse: true },
      { label: 'DOE' },
      { label: 'Planificación móvil' },
      { label: 'Dirección / Coordinación' },
      { label: 'Departamento' },
      { label: 'Otro', requiresDetail: true }
    ],
    'loan.motives': [
      { label: 'Planificación' },
      { label: 'Préstamo autorizado' },
      { label: 'Proyecto / actividad de aula' },
      { label: 'Evaluación' },
      { label: 'Soporte temporal' },
      { label: 'Otro', requiresDetail: true }
    ],
    'loan.gradeOptions': ['1N', '1F', '2N', '2F', '3N', '3F', '4N', '4F', '5N', '5F', '6N', '6F'],
    'devices.categories': ['Tablet', 'Notebook', 'Chromebook', 'Cámara', 'Proyector', 'Router', 'Impresora', 'Otro'],
    'classrooms.floors': [{ key: 'planta', label: 'Planta baja', enabled: true, component: 'PrimerPisoModel' }],
    'shift.morningOperator': '',
    'shift.afternoonOperator': '',
    quickLinks: []
  };
  const ts = nowIso();
  const stmt = database.prepare(`
    INSERT INTO site_settings (site_code, key, value_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(site_code, key) DO NOTHING
  `);
  for (const [key, value] of Object.entries(defaults)) {
    stmt.run(siteCode, key, JSON.stringify(value), ts);
  }
  const catStmt = database.prepare('INSERT OR IGNORE INTO device_categories (site_code, nombre, created_at, updated_at) VALUES (?, ?, ?, ?)');
  for (const name of defaults['devices.categories']) catStmt.run(siteCode, name, ts, ts);
}

function seedAllowedUsers(database) {
  const ts = nowIso();
  const emails = config.authAllowedEmails.length ? config.authAllowedEmails : ['admin@northfield.local'];
  const stmt = database.prepare(`
    INSERT INTO allowed_users (email, nombre, default_role, can_choose_role, activo, created_at, updated_at)
    VALUES (?, ?, 'Jefe TIC', 0, 1, ?, ?)
    ON CONFLICT(email) DO NOTHING
  `);
  for (const email of emails) {
    stmt.run(email, email.split('@')[0], ts, ts);
    const allowed = database.prepare('SELECT id FROM allowed_users WHERE email=?').get(email);
    if (allowed) {
      database.prepare(`
        INSERT INTO allowed_user_sites (allowed_user_id, site_code, site_role, turno, is_default, activo, created_at, updated_at)
        VALUES (?, ?, 'Jefe TIC', 'Todo el día', 1, 1, ?, ?)
        ON CONFLICT(allowed_user_id, site_code) DO NOTHING
      `).run(allowed.id, config.defaultSiteCode || 'NFPT', ts, ts);
    }
  }
}

function migrateDeviceIdentityTables(database) {
  migrateLocalDevices(database);
  migrateLocalStates(database);
  migrateHiddenDevices(database);
  migrateDeviceCategories(database);
}

function tablePkColumns(database, table) {
  return database.prepare(`PRAGMA table_info(${table})`).all().filter(col => col.pk).sort((a, b) => a.pk - b.pk).map(col => col.name);
}

function migrateLocalDevices(database) {
  const pk = tablePkColumns(database, 'local_devices');
  if (pk.join(',') === 'site_code,etiqueta') return;
  database.exec(`
    ALTER TABLE local_devices RENAME TO local_devices_legacy;
    CREATE TABLE local_devices (
      site_code TEXT DEFAULT 'NFPT',
      etiqueta TEXT,
      payload TEXT NOT NULL,
      eliminado INTEGER DEFAULT 0,
      deleted_at TEXT DEFAULT '',
      deleted_by TEXT DEFAULT '',
      created_at TEXT,
      updated_at TEXT,
      PRIMARY KEY(site_code, etiqueta)
    );
    INSERT OR REPLACE INTO local_devices (site_code, etiqueta, payload, eliminado, deleted_at, deleted_by, created_at, updated_at)
      SELECT COALESCE(site_code,'NFPT'), etiqueta, payload, COALESCE(eliminado,0), COALESCE(deleted_at,''), COALESCE(deleted_by,''), created_at, updated_at
      FROM local_devices_legacy;
    DROP TABLE local_devices_legacy;
  `);
}

function migrateLocalStates(database) {
  const pk = tablePkColumns(database, 'local_states');
  if (pk.join(',') === 'site_code,etiqueta') return;
  database.exec(`
    ALTER TABLE local_states RENAME TO local_states_legacy;
    CREATE TABLE local_states (
      site_code TEXT DEFAULT 'NFPT',
      etiqueta TEXT,
      estado TEXT,
      prestado_a TEXT DEFAULT '',
      rol TEXT DEFAULT '',
      ubicacion TEXT DEFAULT '',
      ubicacion_detalle TEXT DEFAULT '',
      curso TEXT DEFAULT '',
      motivo TEXT DEFAULT '',
      motivo_detalle TEXT DEFAULT '',
      comentarios TEXT DEFAULT '',
      loaned_at TEXT DEFAULT '',
      returned_at TEXT DEFAULT '',
      updated_at TEXT,
      PRIMARY KEY(site_code, etiqueta)
    );
    INSERT OR REPLACE INTO local_states (site_code, etiqueta, estado, prestado_a, rol, ubicacion, ubicacion_detalle, curso, motivo, motivo_detalle, comentarios, loaned_at, returned_at, updated_at)
      SELECT COALESCE(site_code,'NFPT'), etiqueta, estado, prestado_a, rol, ubicacion, COALESCE(ubicacion_detalle,''), COALESCE(curso,''), motivo, COALESCE(motivo_detalle,''), comentarios, loaned_at, returned_at, updated_at
      FROM local_states_legacy;
    DROP TABLE local_states_legacy;
  `);
}

function migrateHiddenDevices(database) {
  const pk = tablePkColumns(database, 'hidden_devices');
  if (pk.join(',') === 'site_code,etiqueta') return;
  database.exec(`
    ALTER TABLE hidden_devices RENAME TO hidden_devices_legacy;
    CREATE TABLE hidden_devices (
      site_code TEXT DEFAULT 'NFPT',
      etiqueta TEXT,
      deleted_at TEXT,
      deleted_by TEXT DEFAULT '',
      reason TEXT DEFAULT '',
      PRIMARY KEY(site_code, etiqueta)
    );
    INSERT OR REPLACE INTO hidden_devices (site_code, etiqueta, deleted_at, deleted_by, reason)
      SELECT COALESCE(site_code,'NFPT'), etiqueta, deleted_at, deleted_by, reason
      FROM hidden_devices_legacy;
    DROP TABLE hidden_devices_legacy;
  `);
}

function migrateDeviceCategories(database) {
  const indexes = database.prepare('PRAGMA index_list(device_categories)').all();
  const hasComposite = indexes.some(index => {
    const cols = database.prepare(`PRAGMA index_info(${index.name})`).all().map(col => col.name).join(',');
    return index.unique && cols === 'site_code,nombre';
  });
  if (hasComposite) return;
  database.exec(`
    ALTER TABLE device_categories RENAME TO device_categories_legacy;
    CREATE TABLE device_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      nombre TEXT,
      color TEXT DEFAULT '',
      icono TEXT DEFAULT '',
      activo INTEGER DEFAULT 1,
      created_at TEXT,
      updated_at TEXT,
      UNIQUE(site_code, nombre)
    );
    INSERT OR IGNORE INTO device_categories (site_code, nombre, color, icono, activo, created_at, updated_at)
      SELECT COALESCE(site_code,'NFPT'), nombre, COALESCE(color,''), COALESCE(icono,''), COALESCE(activo,1), created_at, updated_at
      FROM device_categories_legacy
      WHERE nombre IS NOT NULL AND TRIM(nombre) <> '';
    DROP TABLE device_categories_legacy;
  `);
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
    siteCode: row.site_code || config.defaultSiteCode || 'NFPT',
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
  const responsables = parseTaskResponsables(row);
  const items = getDb().prepare('SELECT * FROM task_items WHERE task_id=? AND site_code=? ORDER BY orden, id').all(row.id, row.site_code || config.defaultSiteCode || 'NFPT').map(rowToTaskItem);
  return {
    id: row.id,
    siteCode: row.site_code || config.defaultSiteCode || 'NFPT',
    titulo: row.titulo || '',
    descripcion: row.descripcion || '',
    responsable: responsables.length > 1 ? responsables.join(',') : (responsables[0] || row.responsable || 'Sin asignar'),
    responsables,
    estado: row.estado || 'Pendiente',
    prioridad: row.prioridad || 'Media',
    tipo: row.tipo || 'Soporte',
    turno: row.turno || 'Sin turno',
    fechaCreacion: row.fecha_creacion || '',
    fechaVencimiento: row.fecha_vencimiento || '',
    comentario: row.comentario || '',
    creadoPor: row.creado_por || '',
    operadorUltimoCambio: row.operador_ultimo_cambio || '',
    agendaId: row.agenda_id || '',
    ultimaModificacion: row.ultima_modificacion || '',
    items,
    checklistTotal: items.length,
    checklistDone: items.filter(item => item.completada).length
  };
}

export function rowToTaskItem(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    siteCode: row.site_code || config.defaultSiteCode || 'NFPT',
    texto: row.texto || '',
    completada: Boolean(row.completada),
    orden: Number(row.orden || 0),
    creadoPor: row.creado_por || '',
    completadoPor: row.completado_por || '',
    createdAt: row.created_at || '',
    completedAt: row.completed_at || ''
  };
}

function parseTaskResponsables(row) {
  try {
    const parsed = row.responsables_json ? JSON.parse(row.responsables_json) : null;
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch { /* legacy fallback */ }
  return String(row.responsable || 'Sin asignar')
    .split(/,| y |\/|\+/i)
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => item === 'Ambos' ? ['Compartida'] : item)
    .flat();
}

export function addLocalMovement({ tipo, descripcion, operador, origen = 'Local', etiqueta = '', siteCode = config.defaultSiteCode || 'NFPT' }) {
  getDb().prepare('INSERT INTO local_movements (timestamp, tipo, descripcion, operador, origen, etiqueta, site_code) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(nowIso(), tipo, descripcion, operador || '', origen, etiqueta || '', siteCode);
}

export function setLocalState(etiqueta, fields) {
  const tag = String(etiqueta || '').trim();
  if (!tag) return;
  getDb().prepare(`
    INSERT INTO local_states (etiqueta, site_code, estado, prestado_a, rol, ubicacion, ubicacion_detalle, curso, motivo, motivo_detalle, comentarios, loaned_at, returned_at, updated_at)
    VALUES (@etiqueta, @site_code, @estado, @prestado_a, @rol, @ubicacion, @ubicacion_detalle, @curso, @motivo, @motivo_detalle, @comentarios, @loaned_at, @returned_at, @updated_at)
    ON CONFLICT(site_code, etiqueta) DO UPDATE SET
      site_code=excluded.site_code,
      estado=excluded.estado,
      prestado_a=excluded.prestado_a,
      rol=excluded.rol,
      ubicacion=excluded.ubicacion,
      ubicacion_detalle=excluded.ubicacion_detalle,
      curso=excluded.curso,
      motivo=excluded.motivo,
      motivo_detalle=excluded.motivo_detalle,
      comentarios=excluded.comentarios,
      loaned_at=excluded.loaned_at,
      returned_at=excluded.returned_at,
      updated_at=excluded.updated_at
  `).run({
    etiqueta: tag,
    site_code: fields.siteCode || config.defaultSiteCode || 'NFPT',
    estado: fields.estado || '',
    prestado_a: fields.prestadoA || '',
    rol: fields.rol || '',
    ubicacion: fields.ubicacion || '',
    ubicacion_detalle: fields.ubicacionDetalle || '',
    curso: fields.curso || '',
    motivo: fields.motivo || '',
    motivo_detalle: fields.motivoDetalle || '',
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

export function getLocalStates(siteCode = config.defaultSiteCode || 'NFPT') {
  return getDb().prepare('SELECT * FROM local_states WHERE site_code=?').all(siteCode).map(row => ({
    etiqueta: row.etiqueta,
    siteCode: row.site_code || siteCode,
    estado: row.estado || '',
    prestadoA: row.prestado_a || '',
    rol: row.rol || '',
    ubicacion: row.ubicacion || '',
    ubicacionDetalle: row.ubicacion_detalle || '',
    curso: row.curso || '',
    motivo: row.motivo || '',
    motivoDetalle: row.motivo_detalle || '',
    comentarios: row.comentarios || '',
    loanedAt: row.loaned_at || '',
    returnedAt: row.returned_at || '',
    updatedAt: row.updated_at || ''
  }));
}
