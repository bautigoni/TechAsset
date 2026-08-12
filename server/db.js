import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';
import { createPgSync } from './pg-sync.js';

let db;

export const isPg = () => config.dbDriver === 'postgres';

export function getDb() {
  if (!db) {
    if (isPg()) {
      db = createPgSync(config.databaseUrl);
    } else {
      fs.mkdirSync(path.dirname(config.sqliteDbPath), { recursive: true });
      db = new Database(config.sqliteDbPath);
      db.pragma('journal_mode = WAL');
    }
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
      status TEXT DEFAULT 'Activo',
      activo INTEGER DEFAULT 1,
      notification_prefs_json TEXT DEFAULT '',
      deleted_at TEXT DEFAULT '',
      deleted_by TEXT DEFAULT '',
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
    CREATE TABLE IF NOT EXISTS inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      nombre TEXT NOT NULL,
      categoria TEXT DEFAULT 'Otro',
      cantidad INTEGER DEFAULT 0,
      unidad TEXT DEFAULT 'unidades',
      imagen_url TEXT DEFAULT '',
      estado TEXT DEFAULT '',
      observaciones TEXT DEFAULT '',
      activo INTEGER DEFAULT 1,
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
    CREATE TABLE IF NOT EXISTS loan_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      tipo TEXT,
      etiqueta TEXT,
      alias TEXT DEFAULT '',
      filtro TEXT DEFAULT '',
      persona TEXT DEFAULT '',
      rol TEXT DEFAULT '',
      ubicacion TEXT DEFAULT '',
      ubicacion_detalle TEXT DEFAULT '',
      curso TEXT DEFAULT '',
      motivo TEXT DEFAULT '',
      motivo_detalle TEXT DEFAULT '',
      comentarios TEXT DEFAULT '',
      operador TEXT DEFAULT '',
      origen TEXT DEFAULT 'Local',
      loan_session_id TEXT DEFAULT '',
      accessories_json TEXT DEFAULT '[]',
      expected_accessories_json TEXT DEFAULT '[]',
      timestamp TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_loan_events_site_ts ON loan_events(site_code, timestamp);
    CREATE INDEX IF NOT EXISTS idx_loan_events_persona ON loan_events(site_code, persona);
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      numero TEXT DEFAULT '',
      titulo TEXT DEFAULT '',
      descripcion TEXT DEFAULT '',
      estado TEXT DEFAULT 'No hecho',
      prioridad TEXT DEFAULT 'Media',
      responsables_json TEXT DEFAULT '',
      categoria TEXT DEFAULT '',
      imagen_url TEXT DEFAULT '',
      nota TEXT DEFAULT '',
      origen TEXT DEFAULT 'tik',
      creado_por TEXT DEFAULT '',
      operador_ultimo_cambio TEXT DEFAULT '',
      activo INTEGER DEFAULT 1,
      deleted_at TEXT DEFAULT '',
      deleted_by TEXT DEFAULT '',
      created_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tickets_site ON tickets(site_code, estado);
    CREATE TABLE IF NOT EXISTS ticket_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      priority TEXT DEFAULT 'Media',
      category TEXT DEFAULT '',
      suggested_assignee TEXT DEFAULT '',
      checklist_json TEXT DEFAULT '[]',
      tags_json TEXT DEFAULT '[]',
      created_by TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ticket_templates_site ON ticket_templates(site_code, active, title);
    CREATE TABLE IF NOT EXISTS ticket_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      ticket_a_id INTEGER NOT NULL,
      ticket_b_id INTEGER NOT NULL,
      relation_type TEXT DEFAULT 'related',
      created_by TEXT DEFAULT '',
      created_at TEXT,
      UNIQUE(site_code, ticket_a_id, ticket_b_id)
    );
    CREATE INDEX IF NOT EXISTS idx_ticket_relations_a ON ticket_relations(site_code, ticket_a_id);
    CREATE INDEX IF NOT EXISTS idx_ticket_relations_b ON ticket_relations(site_code, ticket_b_id);
    CREATE TABLE IF NOT EXISTS ticket_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      ticket_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      author_email TEXT DEFAULT '',
      author_name TEXT DEFAULT '',
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket ON ticket_comments(site_code, ticket_id, id);
    CREATE TABLE IF NOT EXISTS ticket_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      ticket_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      detail TEXT DEFAULT '',
      actor_email TEXT DEFAULT '',
      actor_name TEXT DEFAULT '',
      created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ticket_activity_ticket ON ticket_activity(site_code, ticket_id, id);
    CREATE TABLE IF NOT EXISTS ticket_checklist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      ticket_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      done INTEGER DEFAULT 0,
      position INTEGER DEFAULT 0,
      completed_by TEXT DEFAULT '',
      completed_at TEXT DEFAULT '',
      created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ticket_checklist_ticket ON ticket_checklist_items(site_code, ticket_id, position, id);
    CREATE TABLE IF NOT EXISTS knowledge_articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT DEFAULT '',
      tags_json TEXT DEFAULT '[]',
      attachments_json TEXT DEFAULT '[]',
      created_by TEXT DEFAULT '',
      updated_by TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_articles_site ON knowledge_articles(site_code, active, category);
    CREATE TABLE IF NOT EXISTS suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT DEFAULT 'General',
      status TEXT DEFAULT 'Proposed',
      author_email TEXT DEFAULT '',
      author_name TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      deleted_at TEXT DEFAULT '',
      deleted_by TEXT DEFAULT '',
      created_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_suggestions_site_status ON suggestions(site_code, active, status, created_at);
    CREATE TABLE IF NOT EXISTS suggestion_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      suggestion_id INTEGER NOT NULL,
      user_email TEXT NOT NULL,
      created_at TEXT,
      UNIQUE(site_code, suggestion_id, user_email)
    );
    CREATE INDEX IF NOT EXISTS idx_suggestion_votes_item ON suggestion_votes(site_code, suggestion_id);
    CREATE TABLE IF NOT EXISTS suggestion_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      suggestion_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      author_email TEXT DEFAULT '',
      author_name TEXT DEFAULT '',
      deleted_at TEXT DEFAULT '',
      created_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_suggestion_comments_item ON suggestion_comments(site_code, suggestion_id, id);
    CREATE TABLE IF NOT EXISTS device_ai_summaries (
      site_code TEXT NOT NULL,
      device_tag TEXT NOT NULL,
      source_signature TEXT DEFAULT '',
      summary TEXT DEFAULT '',
      generated_at TEXT,
      PRIMARY KEY(site_code, device_tag)
    );
    CREATE TABLE IF NOT EXISTS invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      site_code TEXT NOT NULL,
      role TEXT DEFAULT 'Consulta',
      turno TEXT DEFAULT 'Sin turno',
      kind TEXT DEFAULT 'standard',
      email TEXT DEFAULT '',
      created_by TEXT DEFAULT '',
      expires_at TEXT DEFAULT '',
      used_at TEXT DEFAULT '',
      used_by TEXT DEFAULT '',
      revoked_at TEXT DEFAULT '',
      created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_invites_site ON invites(site_code);
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      user_email TEXT,
      kind TEXT DEFAULT 'general',
      title TEXT,
      body TEXT DEFAULT '',
      link TEXT DEFAULT '',
      read INTEGER DEFAULT 0,
      payload_json TEXT DEFAULT '',
      created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(site_code, user_email, read);
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT,
      site_code TEXT DEFAULT 'NFPT',
      endpoint TEXT UNIQUE,
      p256dh TEXT,
      auth TEXT,
      created_at TEXT,
      last_seen_at TEXT
    );
    CREATE TABLE IF NOT EXISTS release_notes (
      version TEXT PRIMARY KEY,
      title TEXT,
      body_md TEXT DEFAULT '',
      sent_at TEXT DEFAULT '',
      sent_by TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS agenda_calendar_tokens (
      token TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      site_code TEXT NOT NULL,
      created_at TEXT,
      revoked_at TEXT DEFAULT '',
      UNIQUE(user_email, site_code)
    );
    CREATE INDEX IF NOT EXISTS idx_agenda_calendar_tokens_site ON agenda_calendar_tokens(site_code, revoked_at);
    CREATE TABLE IF NOT EXISTS teacher_schedule_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      teacher TEXT NOT NULL,
      course TEXT NOT NULL,
      subject TEXT DEFAULT '',
      room TEXT DEFAULT '',
      school_level TEXT DEFAULT 'primary_first',
      day_of_week INTEGER DEFAULT 1,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      created_by TEXT DEFAULT '',
      created_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_teacher_schedule_site_day ON teacher_schedule_entries(site_code, day_of_week, start_time);
    CREATE TABLE IF NOT EXISTS recess_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TEXT,
      updated_at TEXT,
      UNIQUE(site_code, name)
    );
    CREATE TABLE IF NOT EXISTS recess_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      label TEXT DEFAULT 'Recreo',
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_recess_slots_group ON recess_slots(group_id, sort_order);
    CREATE TABLE IF NOT EXISTS task_columns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      name TEXT NOT NULL,
      color TEXT DEFAULT '',
      position INTEGER DEFAULT 0,
      is_done INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_by TEXT DEFAULT '',
      created_at TEXT,
      updated_at TEXT,
      UNIQUE(site_code, name)
    );
    CREATE INDEX IF NOT EXISTS idx_task_columns_site_position ON task_columns(site_code, active, position);
    CREATE TABLE IF NOT EXISTS task_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      site_code TEXT DEFAULT 'NFPT',
      body TEXT NOT NULL,
      author_email TEXT DEFAULT '',
      author_name TEXT DEFAULT '',
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(site_code, task_id, id);
    CREATE TABLE IF NOT EXISTS canvas_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      item_type TEXT DEFAULT 'sticky',
      title TEXT DEFAULT '',
      content_json TEXT DEFAULT '{}',
      x REAL DEFAULT 0,
      y REAL DEFAULT 0,
      width REAL DEFAULT 240,
      height REAL DEFAULT 180,
      z_index INTEGER DEFAULT 1,
      color TEXT DEFAULT '',
      created_by TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_canvas_items_site ON canvas_items(site_code, active, z_index);
    CREATE TABLE IF NOT EXISTS petty_cash_config (
      site_code TEXT PRIMARY KEY,
      initial_amount REAL DEFAULT 0,
      requests_enabled INTEGER DEFAULT 0,
      updated_by TEXT DEFAULT '',
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS petty_cash_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      expense_date TEXT NOT NULL,
      description TEXT NOT NULL,
      supplier TEXT DEFAULT '',
      amount REAL NOT NULL,
      category TEXT DEFAULT 'General',
      receipt_url TEXT DEFAULT '',
      purchase_request_id INTEGER,
      inventory_item_id INTEGER,
      created_by TEXT DEFAULT '',
      created_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_petty_expenses_site_date ON petty_cash_expenses(site_code, expense_date);
    CREATE TABLE IF NOT EXISTS purchase_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      description TEXT NOT NULL,
      category TEXT DEFAULT 'General',
      estimated_amount REAL DEFAULT 0,
      requested_supplier TEXT DEFAULT '',
      justification TEXT DEFAULT '',
      receipt_url TEXT DEFAULT '',
      status TEXT DEFAULT 'Pendiente',
      requester_email TEXT DEFAULT '',
      requester_name TEXT DEFAULT '',
      final_cost REAL DEFAULT 0,
      final_supplier TEXT DEFAULT '',
      resolution_note TEXT DEFAULT '',
      resolved_by TEXT DEFAULT '',
      resolved_at TEXT DEFAULT '',
      created_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_purchase_requests_site_status ON purchase_requests(site_code, status, id);
    CREATE TABLE IF NOT EXISTS classroom_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      category_key TEXT NOT NULL,
      label TEXT NOT NULL,
      category_type TEXT DEFAULT 'status',
      options_json TEXT DEFAULT '[]',
      sort_order INTEGER DEFAULT 0,
      built_in INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TEXT,
      updated_at TEXT,
      UNIQUE(site_code, category_key)
    );
    CREATE INDEX IF NOT EXISTS idx_classroom_categories_site_order ON classroom_categories(site_code, active, sort_order);
    CREATE TABLE IF NOT EXISTS notification_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      audience TEXT DEFAULT 'site',
      user_email TEXT DEFAULT '',
      kind TEXT DEFAULT 'general',
      title TEXT NOT NULL,
      body TEXT DEFAULT '',
      link TEXT DEFAULT '',
      payload_json TEXT DEFAULT '',
      due_at TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      result_count INTEGER DEFAULT 0,
      last_error TEXT DEFAULT '',
      created_at TEXT,
      processed_at TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_notification_outbox_due ON notification_outbox(status, due_at, id);
    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      remind_at TEXT NOT NULL,
      owner_email TEXT DEFAULT '',
      owner_name TEXT DEFAULT '',
      priority TEXT DEFAULT 'Media',
      related_type TEXT DEFAULT '',
      related_id TEXT DEFAULT '',
      related_label TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      created_by_email TEXT DEFAULT '',
      created_by_name TEXT DEFAULT '',
      completed_at TEXT DEFAULT '',
      completed_by TEXT DEFAULT '',
      notification_sent_at TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(site_code, active, status, remind_at);
    CREATE INDEX IF NOT EXISTS idx_reminders_related ON reminders(site_code, related_type, related_id, active);
    CREATE TABLE IF NOT EXISTS device_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      classroom_key TEXT DEFAULT '',
      created_by TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at TEXT,
      updated_at TEXT,
      UNIQUE(site_code, name)
    );
    CREATE TABLE IF NOT EXISTS device_group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      group_id INTEGER NOT NULL,
      device_tag TEXT NOT NULL,
      created_at TEXT,
      UNIQUE(site_code, device_tag)
    );
    CREATE INDEX IF NOT EXISTS idx_device_group_members_group ON device_group_members(site_code, group_id);
    CREATE TABLE IF NOT EXISTS device_metadata (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      device_tag TEXT NOT NULL,
      condition TEXT DEFAULT 'Excelente',
      notes TEXT DEFAULT '',
      updated_by TEXT DEFAULT '',
      updated_at TEXT,
      UNIQUE(site_code, device_tag)
    );
    CREATE TABLE IF NOT EXISTS photo_passes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      numero INTEGER NOT NULL,
      estado TEXT DEFAULT 'Disponible',
      prestado_a TEXT DEFAULT '',
      rol TEXT DEFAULT '',
      motivo TEXT DEFAULT '',
      loaned_at TEXT DEFAULT '',
      returned_at TEXT DEFAULT '',
      notas TEXT DEFAULT '',
      activo INTEGER DEFAULT 1,
      created_at TEXT,
      updated_at TEXT,
      UNIQUE(site_code, numero)
    );
    CREATE TABLE IF NOT EXISTS photo_pass_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      numero INTEGER NOT NULL,
      tipo TEXT,
      persona TEXT DEFAULT '',
      rol TEXT DEFAULT '',
      motivo TEXT DEFAULT '',
      operador TEXT DEFAULT '',
      timestamp TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_photo_pass_events ON photo_pass_events(site_code, numero, timestamp);
    CREATE TABLE IF NOT EXISTS lifecycle_defaults (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      asset_class TEXT NOT NULL,
      meses INTEGER DEFAULT 0,
      updated_by TEXT DEFAULT '',
      updated_at TEXT,
      UNIQUE(site_code, asset_class)
    );
    CREATE TABLE IF NOT EXISTS classroom_health_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_code TEXT DEFAULT 'NFPT',
      room_key TEXT NOT NULL,
      report_json TEXT DEFAULT '{}',
      generated_by TEXT DEFAULT '',
      generated_at TEXT,
      UNIQUE(site_code, room_key)
    );
  `);

  ensureColumn(database, 'agenda', 'site_code', "TEXT DEFAULT 'NFPT'");
  ensureColumn(database, 'agenda_history', 'site_code', "TEXT DEFAULT 'NFPT'");
  ensureColumn(database, 'tasks', 'site_code', "TEXT DEFAULT 'NFPT'");
  ensureColumn(database, 'task_history', 'site_code', "TEXT DEFAULT 'NFPT'");
  ensureColumn(database, 'task_items', 'site_code', "TEXT DEFAULT 'NFPT'");
  ensureColumn(database, 'local_movements', 'site_code', "TEXT DEFAULT 'NFPT'");
  ensureColumn(database, 'local_devices', 'site_code', "TEXT DEFAULT 'NFPT'");
  ensureColumn(database, 'local_devices', 'categoria', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'filtro', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'modelo', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'marca', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'serial', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'numero_operativo', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'alias_operativo', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'alias_alternativos', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'estado', "TEXT DEFAULT 'Disponible'");
  ensureColumn(database, 'local_devices', 'prestada_a', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'rol', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'ubicacion', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'motivo', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'comentarios', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'fecha_prestamo', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'fecha_devolucion', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'ultima_modificacion', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'activo', "INTEGER DEFAULT 1");
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
  ensureColumn(database, 'tasks', 'visibility', "TEXT DEFAULT 'team'");
  ensureColumn(database, 'tasks', 'owner_email', "TEXT DEFAULT ''");
  ensureColumn(database, 'tasks', 'column_id', 'INTEGER');
  ensureColumn(database, 'tasks', 'assignee_emails_json', "TEXT DEFAULT '[]'");
  ensureColumn(database, 'tasks', 'attachments_json', "TEXT DEFAULT '[]'");
  ensureColumn(database, 'internal_notes', 'visible', "INTEGER DEFAULT 1");
  ensureColumn(database, 'internal_notes', 'deleted_at', "TEXT DEFAULT ''");
  ensureColumn(database, 'internal_notes', 'deleted_by', "TEXT DEFAULT ''");
  ensureColumn(database, 'inventory_items', 'site_code', "TEXT DEFAULT 'NFPT'");
  ensureColumn(database, 'inventory_items', 'unidad', "TEXT DEFAULT 'unidades'");
  ensureColumn(database, 'inventory_items', 'imagen_url', "TEXT DEFAULT ''");
  ensureColumn(database, 'inventory_items', 'estado', "TEXT DEFAULT ''");
  ensureColumn(database, 'inventory_items', 'observaciones', "TEXT DEFAULT ''");
  ensureColumn(database, 'inventory_items', 'activo', "INTEGER DEFAULT 1");
  ensureColumn(database, 'inventory_items', 'deleted_at', "TEXT DEFAULT ''");
  ensureColumn(database, 'inventory_items', 'deleted_by', "TEXT DEFAULT ''");
  // Ciclo de vida / condición. Los campos por dispositivo viven en device_metadata
  // (NO en local_devices: esa tabla la pisa la reimportación del padrón CSV).
  ensureColumn(database, 'device_metadata', 'asset_class', "TEXT DEFAULT ''");
  ensureColumn(database, 'device_metadata', 'expected_life_months', 'INTEGER');
  ensureColumn(database, 'device_metadata', 'fecha_alta', "TEXT DEFAULT ''");
  ensureColumn(database, 'device_metadata', 'last_reviewed_at', "TEXT DEFAULT ''");
  ensureColumn(database, 'inventory_items', 'condicion', "TEXT DEFAULT ''");
  ensureColumn(database, 'inventory_items', 'min_stock', 'INTEGER DEFAULT 3');
  ensureColumn(database, 'inventory_items', 'estado_legacy', "TEXT DEFAULT ''");
  ensureColumn(database, 'inventory_items', 'condicion_updated_at', "TEXT DEFAULT ''");
  ensureColumn(database, 'inventory_items', 'subcategoria', "TEXT DEFAULT ''");
  ensureColumn(database, 'tickets', 'origen', "TEXT DEFAULT 'tik'");
  ensureColumn(database, 'tickets', 'tags_json', "TEXT DEFAULT '[]'");
  ensureColumn(database, 'tickets', 'template_id', 'INTEGER');
  ensureColumn(database, 'tickets', 'classroom', "TEXT DEFAULT ''");
  ensureColumn(database, 'tickets', 'classroom_key', "TEXT DEFAULT ''");
  ensureColumn(database, 'tickets', 'school', "TEXT DEFAULT ''");
  ensureColumn(database, 'tickets', 'first_response_at', "TEXT DEFAULT ''");
  ensureColumn(database, 'tickets', 'resolved_at', "TEXT DEFAULT ''");
  ensureColumn(database, 'tickets', 'ai_summary', "TEXT DEFAULT ''");
  ensureColumn(database, 'tickets', 'ai_summary_updated_at', "TEXT DEFAULT ''");
  ensureColumn(database, 'loan_events', 'loan_session_id', "TEXT DEFAULT ''");
  ensureColumn(database, 'loan_events', 'accessories_json', "TEXT DEFAULT '[]'");
  ensureColumn(database, 'loan_events', 'expected_accessories_json', "TEXT DEFAULT '[]'");
  ensureColumn(database, 'teacher_schedule_entries', 'school_level', "TEXT DEFAULT 'primary_first'");
  migrateInventorySiteCodes(database);
  migrateInventoryConditionFromEstado(database);

  seedDefaultSite(database);
  seedDefaultSettings(database);
  seedInitialInventory(database, config.defaultSiteCode || 'NFPT');
  for (const site of parseBootstrapSites()) {
    seedDefaultSettings(database, site.siteCode);
  }
  seedTaskColumns(database);
  seedClassroomCategories(database);
  migrateNewModuleSettings(database);
  migrateRetiredModules(database);
  migrateLegacyQuickLinks(database);
  cleanupNonDefaultSeedInventory(database);
  seedAllowedUsers(database);
  // Las migraciones de identidad usan RENAME/DROP TABLE (semántica SQLite).
  // En Postgres se logra el mismo resultado (PK compuesta site_code+etiqueta)
  // con ALTER, sin recrear tablas.
  if (isPg()) ensurePgIdentityPks(database);
  else migrateDeviceIdentityTables(database);
  ensureColumn(database, 'local_devices', 'categoria', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'filtro', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'modelo', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'marca', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'serial', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'numero_operativo', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'alias_operativo', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'alias_alternativos', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'estado', "TEXT DEFAULT 'Disponible'");
  ensureColumn(database, 'local_devices', 'prestada_a', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'rol', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'ubicacion', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'motivo', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'comentarios', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'fecha_prestamo', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'fecha_devolucion', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'ultima_modificacion', "TEXT DEFAULT ''");
  ensureColumn(database, 'local_devices', 'activo', "INTEGER DEFAULT 1");
  ensureColumn(database, 'allowed_users', 'status', "TEXT DEFAULT 'Activo'");
  ensureColumn(database, 'allowed_users', 'deleted_at', "TEXT DEFAULT ''");
  ensureColumn(database, 'allowed_users', 'deleted_by', "TEXT DEFAULT ''");
  ensureColumn(database, 'allowed_users', 'password_hash', "TEXT DEFAULT ''");
  ensureColumn(database, 'allowed_users', 'notif_email', 'INTEGER DEFAULT 0');
  ensureColumn(database, 'allowed_users', 'notification_prefs_json', "TEXT DEFAULT ''");
  ensureColumn(database, 'allowed_users', 'prefs_json', "TEXT DEFAULT ''");

  const count = database.prepare('SELECT COUNT(*) AS total FROM agenda').get().total;
  if (!count) seedAgenda(database);
  ensureFixedAgenda(database);

  backfillLoanEventsFromMovements(database);
  if (isPg()) {
    ensurePgNotificationFunction(database);
    ensurePgRls(database);
  }
}

function ensurePgNotificationFunction(database) {
  database.exec(`
    CREATE OR REPLACE FUNCTION public.enqueue_techasset_notification(
      p_title TEXT,
      p_body TEXT DEFAULT '',
      p_site_code TEXT DEFAULT 'NFPT',
      p_audience TEXT DEFAULT 'site',
      p_user_email TEXT DEFAULT '',
      p_kind TEXT DEFAULT 'general',
      p_link TEXT DEFAULT '',
      p_due_at TEXT DEFAULT ''
    ) RETURNS BIGINT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
    DECLARE new_id BIGINT;
    BEGIN
      IF trim(COALESCE(p_title, '')) = '' THEN RAISE EXCEPTION 'title is required'; END IF;
      IF lower(COALESCE(p_audience, 'site')) NOT IN ('all', 'site', 'user') THEN RAISE EXCEPTION 'invalid audience'; END IF;
      INSERT INTO public.notification_outbox
        (site_code, audience, user_email, kind, title, body, link, due_at, status, attempts, created_at)
      VALUES
        (upper(COALESCE(NULLIF(trim(p_site_code), ''), 'NFPT')), lower(COALESCE(p_audience, 'site')),
         lower(COALESCE(p_user_email, '')), COALESCE(NULLIF(trim(p_kind), ''), 'general'), trim(p_title),
         COALESCE(p_body, ''), COALESCE(p_link, ''), COALESCE(p_due_at, ''), 'pending', 0, now()::text)
      RETURNING id INTO new_id;
      RETURN new_id;
    END $$;
    REVOKE ALL ON FUNCTION public.enqueue_techasset_notification(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
  `);
}

function ensurePgRls(database) {
  // Supabase expone public mediante PostgREST. Cada arranque aplica RLS también
  // a tablas recién creadas; el rol dueño que usa Express conserva acceso.
  database.exec(`
    DO $$
    DECLARE r RECORD;
    BEGIN
      FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public'
      LOOP
        BEGIN
          EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
        EXCEPTION WHEN insufficient_privilege THEN
          RAISE WARNING 'Sin permisos para habilitar RLS en public.%', r.tablename;
        END;
      END LOOP;
    END $$;
  `);
}

export function seedInitialInventory(database, siteCode = config.defaultSiteCode || 'NFPT') {
  const normalizedSite = String(siteCode || 'NFPT').trim().toUpperCase();
  const count = database.prepare('SELECT COUNT(*) AS total FROM inventory_items WHERE site_code=?').get(normalizedSite).total;
  if (count) return;
  const ts = nowIso();
  const rows = [
    ['LEDs', 'Componentes', 0],
    ['Resistencias', 'Componentes', 0],
    ['Sensores de distancia', 'Sensores', 34],
    ['Fotoresistencias', 'Sensores', 34],
    ['Servomotores', 'Robótica', 31],
    ['Capacitores', 'Componentes', 26],
    ['Buzzers', 'Componentes', 20],
    ['Display LCD', 'Electrónica', 17],
    ['Stepper motor drive board', 'Arduino', 17],
    ['Diodos', 'Componentes', 16],
    ['Control', 'Otro', 16],
    ['Transistores', 'Componentes', 15],
    ['Protoboard', 'Electrónica', 14],
    ['Push button', 'Componentes', 14],
    ['Step motor', 'Robótica', 13],
    ['Sensor infrarrojo', 'Sensores', 13],
    ['Sensor de humedad', 'Sensores', 13],
    ['Motor amarillo', 'Robótica', 11],
    ['Adaptador batería 9v', 'Componentes', 11],
    ['Placa con fotoresistencia', 'Sensores', 11],
    ['Display múltiple 7 segmentos', 'Electrónica', 10],
    ['Botones pulsadores', 'Componentes', 9],
    ['Matriz LED', 'Electrónica', 9],
    ['Relé sin placa', 'Electrónica', 9],
    ['Resistencia giratoria 10K', 'Componentes', 9],
    ['Joysticks', 'Componentes', 8],
    ['Display 7 segmentos', 'Electrónica', 8],
    ['Resistencia giratoria B10K', 'Componentes', 8],
    ['Breadboard power supply', 'Arduino', 8],
    ['Placa Arduino Uno', 'Arduino', 8],
    ['Sensor de nivel de agua', 'Sensores', 7],
    ['Botonera', 'Componentes', 6],
    ['Relé con placa', 'Electrónica', 6],
    ['Reloj de tiempo real', 'Electrónica', 6],
    ['Sensor de sonido', 'Sensores', 6],
    ['Pack NFCs (pin, tarjeta y receptor)', 'Componentes', 5],
    ['Elego 1', 'Robótica', 3],
    ['Sensor de gas', 'Sensores', 2],
    ['Full color RGB', 'Electrónica', 2],
    ['Placa WiFi', 'Arduino', 1],
    ['DK-Nano-003 v3.0', 'Arduino', 1],
    ['Placa Arduino Nano v3', 'Arduino', 1],
    ['Mega ADK', 'Arduino', 1]
  ];
  const insert = database.prepare(`
    INSERT INTO inventory_items (site_code, nombre, categoria, cantidad, unidad, estado, observaciones, activo, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'unidades', '', '', 1, ?, ?)
  `);
  const tx = database.transaction(() => rows.forEach(row => insert.run(normalizedSite, row[0], row[1], row[2], ts, ts)));
  tx();
}

function migrateInventorySiteCodes(database) {
  const defaultSite = String(config.defaultSiteCode || 'NFPT').trim().toUpperCase();
  database.prepare("UPDATE inventory_items SET site_code=? WHERE site_code IS NULL OR TRIM(site_code)=''").run(defaultSite);
  database.prepare("UPDATE inventory_items SET site_code=UPPER(TRIM(site_code)) WHERE site_code IS NOT NULL AND TRIM(site_code)<>''").run();
}

// El `estado` viejo de inventario mezclaba disponibilidad, stock y condición.
// Traducimos a `condicion` (misma escala que device_metadata) una sola vez y
// guardamos el valor original en `estado_legacy`: se traduce, no se borra.
function migrateInventoryConditionFromEstado(database) {
  const pending = database.prepare(`
    SELECT id, COALESCE(estado,'') AS estado
    FROM inventory_items
    WHERE COALESCE(estado_legacy,'')='' AND COALESCE(estado,'')<>''
  `).all();
  if (!pending.length) return;
  const update = database.prepare('UPDATE inventory_items SET condicion=?, estado_legacy=? WHERE id=?');
  const tx = database.transaction(() => {
    for (const row of pending) {
      const estado = String(row.estado || '').trim();
      // 'Disponible'/'Operativo'/'No disponible' no dicen nada de la condición
      // real (o son ambiguos entre roto y sin stock): quedan sin revisar.
      const normalized = estado.toLowerCase();
      const condicion = normalized === 'revisar' || normalized === 'incompleto' ? 'Regular' : '';
      update.run(condicion, estado, row.id);
    }
  });
  tx();
}

function cleanupNonDefaultSeedInventory(database) {
  const defaultSite = String(config.defaultSiteCode || 'NFPT').trim().toUpperCase();
  const sites = database.prepare(`
    SELECT DISTINCT site_code
    FROM inventory_items
    WHERE site_code IS NOT NULL AND TRIM(site_code)<>'' AND site_code<>?
  `).all(defaultSite);
  const seedNames = seedInventoryNameSet();
  const ts = nowIso();
  for (const site of sites) {
    const siteCode = String(site.site_code || '').trim().toUpperCase();
    if (!siteCode || siteCode === defaultSite) continue;
    const rows = database.prepare(`
      SELECT nombre, COALESCE(imagen_url,'') AS imagen_url, COALESCE(estado,'') AS estado, COALESCE(observaciones,'') AS observaciones
      FROM inventory_items
      WHERE site_code=? AND COALESCE(activo,1)=1
    `).all(siteCode);
    if (rows.length !== seedNames.size) continue;
    const looksLikeClonedSeed = rows.every(row =>
      seedNames.has(normalizeInventoryName(row.nombre)) &&
      !String(row.imagen_url || '').trim() &&
      !String(row.estado || '').trim() &&
      !String(row.observaciones || '').trim()
    );
    if (!looksLikeClonedSeed) continue;
    database.prepare(`
      UPDATE inventory_items
      SET activo=0, deleted_at=?, deleted_by='migracion', updated_at=?
      WHERE site_code=? AND COALESCE(activo,1)=1
    `).run(ts, ts, siteCode);
  }
}

function seedInventoryNameSet() {
  return new Set([
    'LEDs',
    'Resistencias',
    'Sensores de distancia',
    'Fotoresistencias',
    'Servomotores',
    'Capacitores',
    'Buzzers',
    'Display LCD',
    'Stepper motor drive board',
    'Diodos',
    'Control',
    'Transistores',
    'Protoboard',
    'Push button',
    'Step motor',
    'Sensor infrarrojo',
    'Sensor de humedad',
    'Motor amarillo',
    'Adaptador bateria 9v',
    'Placa con fotoresistencia',
    'Display multiple 7 segmentos',
    'Botones pulsadores',
    'Matriz LED',
    'Rele sin placa',
    'Resistencia giratoria 10K',
    'Joysticks',
    'Display 7 segmentos',
    'Resistencia giratoria B10K',
    'Breadboard power supply',
    'Placa Arduino Uno',
    'Sensor de nivel de agua',
    'Botonera',
    'Rele con placa',
    'Reloj de tiempo real',
    'Sensor de sonido',
    'Pack NFCs (pin, tarjeta y receptor)',
    'Elego 1',
    'Sensor de gas',
    'Full color RGB',
    'Placa WiFi',
    'DK-Nano-003 v3.0',
    'Placa Arduino Nano v3',
    'Mega ADK'
  ].map(normalizeInventoryName));
}

function normalizeInventoryName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
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
  `).run(siteCode, 'Northfield Puertos', 'Sede actual', config.googleSheetCsvUrl || '', '', ts, ts);
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
    'loan.gradeOptions': ['1N', '1F', '1S', '2N', '2F', '2S', '3N', '3F', '3S', '4N', '4F', '4S', '5N', '5F', '5S', '6N', '6F', '6S'],
    'devices.categories': ['Tablet', 'Notebook', 'Chromebook', 'Cámara', 'Proyector', 'Router', 'Impresora', 'Otro'],
    'classrooms.floors': [{ key: 'planta', label: 'Planta baja', enabled: true, component: 'PrimerPisoModel' }],
    'modules.enabled': ['devices', 'loans', 'inventory', 'analytics', 'agenda', 'schedules', 'tasks', 'pettycash', 'classrooms', 'tickets', 'suggestions', 'tools', 'quickaccess', 'photopasses'],
    'modules.order': ['devices', 'loans', 'inventory', 'analytics', 'agenda', 'schedules', 'tasks', 'pettycash', 'classrooms', 'tickets', 'suggestions', 'tools', 'quickaccess', 'photopasses'],
    'roles.config': [
      { name: 'Administrador', admin: true, view: ['*'], edit: ['*'] },
      { name: 'Asistente', admin: false, view: ['*'], edit: ['devices', 'loans', 'inventory', 'agenda', 'schedules', 'tasks', 'pettycash', 'classrooms', 'tickets', 'suggestions', 'tools', 'quickaccess', 'photopasses'] },
      { name: 'Consulta', admin: false, view: ['*'], edit: [] }
    ],
    'shift.options': ['Sin turno', 'Mañana', 'Tarde', 'Todo el día'],
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
  const catStmt = database.prepare('INSERT INTO device_categories (site_code, nombre, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(site_code, nombre) DO NOTHING');
  for (const name of defaults['devices.categories']) catStmt.run(siteCode, name, ts, ts);
}

// Módulos retirados: se sacan de la config de cada sede para que no queden
// colgados en el menú. Las tablas y la API no se tocan: los datos quedan.
// Los accesos institucionales estaban hardcodeados en el front, así que nadie
// podía editarlos. Se pasan a `quick_links` una sola vez, y solo para las sedes
// que ya existían: un tenant nuevo arranca con la lista vacía, no con los links
// de Northfield.
const LEGACY_QUICK_LINKS = [
  { titulo: 'Listas EP', descripcion: 'Planilla de listas de Escuela Primaria', url: 'https://docs.google.com/spreadsheets/d/1ppF2IBLxlLUTZ5HS35_C8SOy07VsjtI2WC9JGlqec7U/edit?gid=1611662790#gid=1611662790' },
  { titulo: 'Listas ES', descripcion: 'Planilla de listas de Escuela Secundaria', url: 'https://docs.google.com/spreadsheets/d/1uVsdBk3McaT8WQI7Svv3e2wRvx6i5XpV52GlEasVJ0w/edit?gid=1617997660#gid=1617997660' },
  { titulo: 'Hosking', descripcion: 'Portal Northfield Hosking', url: 'https://northfield.hosking.ar/' },
  { titulo: 'Tiknology / InvGate', descripcion: 'Crear incidente en mesa de ayuda', url: 'https://tikno.sd.cloud.invgate.net/incident/create' },
  { titulo: 'Drive TIC', descripcion: 'Carpeta general del equipo TIC', url: 'https://drive.google.com/drive/folders/0AGIDB9iIjXK4Uk9PVA' },
  { titulo: 'Drive recursos presentaciones/pantalla', descripcion: 'Logos, imágenes y recursos visuales institucionales', url: 'https://drive.google.com/drive/folders/1uhfmwUrYrrWAEtTUGxjCO4xLoGVlGUEV' }
];

function migrateLegacyQuickLinks(database) {
  const done = database.prepare("SELECT value FROM app_settings WHERE key='quicklinks.legacy_seeded'").get();
  if (done?.value === '1') return;
  const sites = database.prepare('SELECT site_code FROM sites WHERE COALESCE(activo,1)=1').all().map(row => row.site_code);
  const ts = nowIso();
  const exists = database.prepare('SELECT id FROM quick_links WHERE site_code=? AND url=? LIMIT 1');
  const insert = database.prepare(`
    INSERT INTO quick_links (site_code, titulo, url, descripcion, categoria, icono, creado_por, activo, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'Institucionales', '', 'Sistema', 1, ?, ?)
  `);
  for (const siteCode of sites) {
    for (const link of LEGACY_QUICK_LINKS) {
      if (exists.get(siteCode, link.url)) continue;
      insert.run(siteCode, link.titulo, link.url, link.descripcion, ts, ts);
    }
  }
  database.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('quicklinks.legacy_seeded','1',?) ON CONFLICT(key) DO UPDATE SET value='1', updated_at=excluded.updated_at").run(ts);
}

function migrateRetiredModules(database) {
  const retired = new Set(['reminders']);
  const rows = database.prepare("SELECT site_code, key, value_json FROM site_settings WHERE key IN ('modules.enabled','modules.order')").all();
  const update = database.prepare('UPDATE site_settings SET value_json=? WHERE site_code=? AND key=?');
  for (const row of rows) {
    let list;
    try { list = JSON.parse(row.value_json || '[]'); } catch { continue; }
    if (!Array.isArray(list)) continue;
    const next = list.filter(item => !retired.has(String(item)));
    if (next.length !== list.length) update.run(JSON.stringify(next), row.site_code, row.key);
  }
}

function migrateNewModuleSettings(database) {
  const added = ['schedules', 'pettycash', 'suggestions', 'photopasses'];
  const rows = database.prepare("SELECT site_code, key, value_json FROM site_settings WHERE key IN ('modules.enabled','modules.order')").all();
  const update = database.prepare('UPDATE site_settings SET value_json=?, updated_at=? WHERE site_code=? AND key=?');
  const ts = nowIso();
  for (const row of rows) {
    let current = [];
    try { current = JSON.parse(row.value_json || '[]'); } catch { current = []; }
    if (!Array.isArray(current)) current = [];
    const next = [...current];
    for (const moduleKey of added) if (!next.includes(moduleKey)) next.push(moduleKey);
    if (next.length !== current.length) update.run(JSON.stringify(next), ts, row.site_code, row.key);
  }
}

function seedTaskColumns(database) {
  const sites = database.prepare('SELECT site_code FROM sites WHERE activo=1 ORDER BY site_code').all();
  const ts = nowIso();
  const defaults = [
    ['Pendiente', '#3b82f6', 0, 0],
    ['En proceso', '#f59e0b', 1, 0],
    ['Hecha', '#22c55e', 2, 1]
  ];
  const insert = database.prepare(`
    INSERT INTO task_columns (site_code, name, color, position, is_done, active, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, 'migracion', ?, ?)
    ON CONFLICT(site_code, name) DO UPDATE SET active=1
  `);
  for (const site of sites) {
    for (const [name, color, position, isDone] of defaults) insert.run(site.site_code, name, color, position, isDone, ts, ts);
    const columns = database.prepare('SELECT id, name FROM task_columns WHERE site_code=? AND active=1').all(site.site_code);
    const byName = new Map(columns.map(column => [column.name, column.id]));
    const rows = database.prepare('SELECT id, estado FROM tasks WHERE site_code=? AND column_id IS NULL').all(site.site_code);
    const fallback = byName.get('Pendiente');
    const update = database.prepare('UPDATE tasks SET column_id=? WHERE id=? AND site_code=?');
    for (const task of rows) update.run(byName.get(task.estado) || fallback, task.id, site.site_code);
  }
}

function seedClassroomCategories(database) {
  const sites = database.prepare('SELECT site_code FROM sites WHERE activo=1 ORDER BY site_code').all();
  const ts = nowIso();
  const options = JSON.stringify(['OK', 'Con falla', 'No tiene', 'En reparación', 'Sin revisar']);
  const defaults = [
    ['proyector', 'Proyector'], ['nuc', 'NUC'], ['monitor', 'Monitor'],
    ['tecladoMouse', 'Teclado/Mouse'], ['tele', 'Tele'], ['notebook', 'Notebook'],
    ['parlantes', 'Parlantes'], ['conectividad', 'Conectividad'], ['otro', 'Otro']
  ];
  const insert = database.prepare(`
    INSERT INTO classroom_categories (site_code, category_key, label, category_type, options_json, sort_order, built_in, active, created_at, updated_at)
    VALUES (?, ?, ?, 'status', ?, ?, 1, 1, ?, ?)
    ON CONFLICT(site_code, category_key) DO NOTHING
  `);
  for (const site of sites) defaults.forEach(([key, label], index) => insert.run(site.site_code, key, label, options, index, ts, ts));
}

function seedAllowedUsers(database) {
  const ts = nowIso();
  const emails = config.authAllowedEmails.length ? config.authAllowedEmails : ['admin@northfield.local'];
  const defaultSiteCode = config.defaultSiteCode || 'NFPT';
  const bootstrapEmail = String(emails[0] || 'admin@northfield.local').trim().toLowerCase();
  const stmt = database.prepare(`
    INSERT INTO allowed_users (email, nombre, default_role, can_choose_role, activo, created_at, updated_at)
    VALUES (?, ?, 'Jefe TIC', 0, 1, ?, ?)
    ON CONFLICT(email) DO NOTHING
  `);
  for (const rawEmail of emails) {
    const email = String(rawEmail || '').trim().toLowerCase();
    if (!email) continue;
    stmt.run(email, email.split('@')[0], ts, ts);
    const allowed = database.prepare('SELECT id FROM allowed_users WHERE email=?').get(email);
    if (allowed) {
      database.prepare(`
        INSERT INTO allowed_user_sites (allowed_user_id, site_code, site_role, turno, is_default, activo, created_at, updated_at)
        VALUES (?, ?, 'Jefe TIC', 'Todo el día', 1, 1, ?, ?)
        ON CONFLICT(allowed_user_id, site_code) DO NOTHING
      `).run(allowed.id, defaultSiteCode, ts, ts);
    }
  }
  const hasSuperadmin = database.prepare(`
    SELECT 1 FROM allowed_users
    WHERE activo=1 AND default_role='Superadmin'
    LIMIT 1
  `).get();
  if (!hasSuperadmin && bootstrapEmail) {
    database.prepare(`
      INSERT INTO allowed_users (email, nombre, default_role, can_choose_role, activo, created_at, updated_at)
      VALUES (?, ?, 'Superadmin', 0, 1, ?, ?)
      ON CONFLICT(email) DO UPDATE SET default_role='Superadmin', can_choose_role=0, activo=1, updated_at=excluded.updated_at
    `).run(bootstrapEmail, bootstrapEmail.split('@')[0], ts, ts);
    const allowed = database.prepare('SELECT id FROM allowed_users WHERE email=?').get(bootstrapEmail);
    if (allowed) {
      database.prepare(`
        INSERT INTO allowed_user_sites (allowed_user_id, site_code, site_role, turno, is_default, activo, created_at, updated_at)
        VALUES (?, ?, 'Superadmin', 'Todo el día', 1, 1, ?, ?)
        ON CONFLICT(allowed_user_id, site_code) DO UPDATE SET site_role='Superadmin', turno='Todo el día', is_default=1, activo=1, updated_at=excluded.updated_at
      `).run(allowed.id, defaultSiteCode, ts, ts);
    }
    database.prepare(`
      UPDATE users SET rol_global='Superadmin', activo=1, updated_at=?
      WHERE lower(email)=?
    `).run(ts, bootstrapEmail);
  }
}

function ensurePgIdentityPks(database) {
  for (const table of ['local_devices', 'local_states', 'hidden_devices']) {
    const pk = tablePkColumns(database, table).slice().sort().join(',');
    if (pk === 'etiqueta,site_code') continue; // ya es compuesta (set ordenado)
    database.exec(`UPDATE ${table} SET site_code='NFPT' WHERE site_code IS NULL OR site_code=''`);
    database.exec(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_pkey`);
    database.exec(`ALTER TABLE ${table} ADD PRIMARY KEY (site_code, etiqueta)`);
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
    ['AG001', 'Lunes', '', 'Mañana', '08:15', '09:05', '2N', 'Glifing', 'Touch', 25, 'Aula'],
    ['AG002', 'Lunes', '', 'Mañana', '09:05', '09:55', '2N', 'Glifing', 'Touch', 25, 'Aula'],
    ['AG003', 'Lunes', '', 'Mañana', '10:10', '11:00', '2N', 'Glifing', 'Touch', 25, 'Aula'],
    ['AG004', 'Martes', '', 'Mañana', '09:05', '09:55', '4N', 'Programación', 'Touch', 25, 'Aula'],
    ['AG005', 'Martes', '', 'Mañana', '10:10', '11:00', '4S', 'Programación', 'Touch', 25, 'Aula'],
    ['AG006', 'Martes', '', 'Mañana', '11:00', '11:45', '4F', 'Programación', 'Touch', 25, 'Aula'],
    ['AG007', 'Miércoles', '', 'Mañana', '08:15', '09:05', '1F', 'Glifing', 'Touch', 25, 'Aula'],
    ['AG008', 'Miércoles', '', 'Mañana', '09:05', '09:55', '1N', 'Glifing', 'Touch', 25, 'Aula'],
    ['AG009', 'Miércoles', '', 'Mañana', '10:10', '11:00', '1S', 'Glifing', 'Touch', 25, 'Aula'],
    ['AG010', 'Jueves', '', 'Mañana', '09:05', '09:55', '1N', 'Glifing', 'Touch', 14, 'Aula'],
    ['AG011', 'Jueves', '', 'Mañana', '10:10', '11:00', '1N', 'Glifing', 'Touch', 14, 'Aula'],
    ['AG012', 'Jueves', '', 'Mañana', '11:00', '11:45', '1N', 'Glifing', 'Touch', 14, 'Aula'],
    ['AG013', 'Viernes', '', 'Mañana', '08:15', '09:05', 'Matific grupo total', 'Matific', 'Touch', 25, 'Aula'],
    ['AG014', 'Viernes', '', 'Mañana', '09:05', '09:55', 'Matific grupo total', 'Matific', 'Touch', 25, 'Aula'],
    ['AG015', 'Viernes', '', 'Mañana', '10:10', '11:00', 'Matific grupo total', 'Matific', 'Touch', 25, 'Aula'],
    ['AG016', 'Lunes', '', 'Tarde', '13:30', '14:15', '2N', 'Reserva Touch', 'Touch', 14, 'Aula'],
    ['AG017', 'Lunes', '', 'Tarde', '14:35', '15:25', '3N', 'Reserva Touch', 'Touch', 14, 'Aula'],
    ['AG018', 'Lunes', '', 'Tarde', '15:25', '16:20', '2S', 'Reserva Touch', 'Touch', 14, 'Aula'],
    ['AG019', 'Martes', '', 'Tarde', '13:30', '14:15', '1S', 'Reserva Touch', 'Touch', 14, 'Aula'],
    ['AG020', 'Martes', '', 'Tarde', '14:35', '15:25', '1N', 'Reserva Touch', 'Touch', 14, 'Aula'],
    ['AG021', 'Martes', '', 'Tarde', '15:25', '16:20', '1F', 'Reserva Touch', 'Touch', 14, 'Aula'],
    ['AG022', 'Miércoles', '', 'Tarde', '13:30', '14:15', '2F', 'Reserva Touch', 'Touch', 14, 'Aula'],
    ['AG023', 'Miércoles', '', 'Tarde', '14:35', '15:25', '3S', 'Reserva Touch', 'Touch', 14, 'Aula'],
    ['AG024', 'Miércoles', '', 'Tarde', '15:25', '16:20', '3F', 'Reserva Touch', 'Touch', 14, 'Aula'],
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
  const assigneeEmails = parseJsonArray(row.assignee_emails_json);
  const attachments = parseJsonArray(row.attachments_json);
  const column = row.column_id ? getDb().prepare('SELECT id, name, color, position, is_done FROM task_columns WHERE id=? AND site_code=?').get(row.column_id, row.site_code || config.defaultSiteCode || 'NFPT') : null;
  const commentsCount = getDb().prepare("SELECT COUNT(*) AS total FROM task_comments WHERE task_id=? AND site_code=? AND COALESCE(deleted_at,'')='' ").get(row.id, row.site_code || config.defaultSiteCode || 'NFPT').total || 0;
  return {
    id: row.id,
    siteCode: row.site_code || config.defaultSiteCode || 'NFPT',
    titulo: row.titulo || '',
    descripcion: row.descripcion || '',
    responsable: responsables.length > 1 ? responsables.join(',') : (responsables[0] || row.responsable || 'Sin asignar'),
    responsables,
    assigneeEmails,
    estado: column?.name || row.estado || 'Pendiente',
    columnId: column?.id || row.column_id || null,
    columnColor: column?.color || '',
    done: Boolean(column?.is_done) || row.estado === 'Hecha',
    visibility: row.visibility === 'private' ? 'private' : 'team',
    ownerEmail: row.owner_email || '',
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
    attachments,
    commentsCount: Number(commentsCount),
    items,
    checklistTotal: items.length,
    checklistDone: items.filter(item => item.completada).length
  };
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
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

// Historial durable de préstamos/devoluciones. A diferencia de local_states (estado
// vivo que se limpia al devolver), esto NUNCA se borra: es la fuente de la analítica
// histórica y del recomendador. tipo: 'prestamo' | 'devolucion'.
export function addLoanEvent(fields = {}) {
  getDb().prepare(`
    INSERT INTO loan_events (site_code, tipo, etiqueta, alias, filtro, persona, rol, ubicacion, ubicacion_detalle, curso, motivo, motivo_detalle, comentarios, operador, origen, loan_session_id, accessories_json, expected_accessories_json, timestamp)
    VALUES (@site_code, @tipo, @etiqueta, @alias, @filtro, @persona, @rol, @ubicacion, @ubicacion_detalle, @curso, @motivo, @motivo_detalle, @comentarios, @operador, @origen, @loan_session_id, @accessories_json, @expected_accessories_json, @timestamp)
  `).run({
    site_code: fields.siteCode || config.defaultSiteCode || 'NFPT',
    tipo: fields.tipo || 'prestamo',
    etiqueta: String(fields.etiqueta || '').trim(),
    alias: fields.alias || '',
    filtro: fields.filtro || '',
    persona: fields.persona || '',
    rol: fields.rol || '',
    ubicacion: fields.ubicacion || '',
    ubicacion_detalle: fields.ubicacionDetalle || '',
    curso: fields.curso || '',
    motivo: fields.motivo || '',
    motivo_detalle: fields.motivoDetalle || '',
    comentarios: fields.comentarios || '',
    operador: fields.operador || '',
    origen: fields.origen || 'Local',
    loan_session_id: fields.loanSessionId || '',
    accessories_json: JSON.stringify(normalizeStringList(fields.accessories)),
    expected_accessories_json: JSON.stringify(normalizeStringList(fields.expectedAccessories)),
    timestamp: fields.timestamp || nowIso()
  });
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))].slice(0, 30);
}

// Reconstruye loan_events desde local_movements (que sí tiene timestamps históricos)
// la primera vez, para no arrancar la analítica de cero. Idempotente: solo corre si
// loan_events está vacío.
function backfillLoanEventsFromMovements(database) {
  const existing = database.prepare('SELECT COUNT(*) AS total FROM loan_events').get().total;
  if (existing) return;
  const rows = database.prepare(`
    SELECT timestamp, tipo, descripcion, operador, etiqueta, COALESCE(site_code,'NFPT') AS site_code
    FROM local_movements
    WHERE lower(tipo) LIKE 'prést%' OR lower(tipo) LIKE 'prest%' OR lower(tipo) LIKE 'devol%'
    ORDER BY id
  `).all();
  if (!rows.length) return;
  const insert = database.prepare(`
    INSERT INTO loan_events (site_code, tipo, etiqueta, alias, persona, operador, origen, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, 'backfill', ?)
  `);
  const tx = database.transaction(() => {
    for (const row of rows) {
      const lowerTipo = String(row.tipo || '').toLowerCase();
      const tipo = lowerTipo.startsWith('devol') ? 'devolucion' : 'prestamo';
      const desc = String(row.descripcion || '');
      const persona = tipo === 'prestamo' ? (desc.match(/prestad[ao]\s+a\s+(.+?)\s*$/i)?.[1] || '').trim() : '';
      const alias = (desc.match(/·\s*([^·]+?)\s+(?:prestad|devuelt)/i)?.[1] || '').trim();
      insert.run(row.site_code, tipo, String(row.etiqueta || '').trim(), alias, persona, row.operador || '', row.timestamp || nowIso());
    }
  });
  tx();
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

export function getSiteSetting(siteCode, key) {
  const row = getDb().prepare('SELECT value_json FROM site_settings WHERE site_code=? AND key=?').get(siteCode, key);
  if (!row) return null;
  try { return JSON.parse(row.value_json || 'null'); }
  catch { return row.value_json; }
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
