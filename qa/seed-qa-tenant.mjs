// Siembra la sede de prueba "QA" sobre una COPIA de data/techasset.db.
//
//   node qa/seed-qa-tenant.mjs                         # salida por defecto: qa/.out/qa-seed.db
//   node qa/seed-qa-tenant.mjs --out=qa/.out/otra.db
//   node qa/seed-qa-tenant.mjs --fresh                 # tira la salida y vuelve a copiar la base
//
// - La base real solo se LEE (copia consistente con la API de backup, como el
//   banco e2e). Si la salida ya existe se reusa: correrlo dos veces no duplica.
// - Todo pasa por el server real (node server/index.js) levantado un momento
//   sobre la salida, en un puerto libre, con mails en modo prueba y sin nada
//   externo: alta de sede, invitación + registro del admin (POST /api/auth/register,
//   contraseña con password.service), ingreso por /api/auth/login, equipos,
//   préstamos, agenda, tareas, tickets, notas, recordatorios, conocimiento e
//   invitaciones (POST /api/invites).
// - Deja las credenciales y los códigos en qa/.out/credenciales.json (gitignoreado).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  CREDENTIALS_FILE, DEFAULT_SEED_DB, OUT_DIR, QA_SITE, QA_SITE_NAME, REAL_DB,
  apiAs, assertSafeDbPath, flag, freePort, must, option, removeDbFiles, root, snapshotDatabase, startQaServer, stopQaServer
} from './lib.mjs';

const ADMIN = { email: 'jefa.qa@qa.test', nombre: 'Carla Jefa QA', password: 'QaJefe-2026' };
const PERSONAS = ['impaciente', 'esceptico', 'movil', 'nonativo', 'destructor'];
const SPARES = ['repuesto1', 'repuesto2', 'repuesto3', 'repuesto4', 'repuesto5'];
const ASSISTANT_ROLE = 'Asistente TIC general';
const ASSISTANT_TURNO = 'Todo el día';
const INVITE_DAYS = 90;
const INVITES_KEY = 'qa.seed.invites';

const ALL_MODULES = ['devices', 'loans', 'inventory', 'analytics', 'agenda', 'schedules', 'tasks', 'pettycash', 'classrooms', 'tickets', 'suggestions', 'tools', 'quickaccess', 'knowledge', 'reminders', 'canvas'];
const ASSISTANT_EDIT = ALL_MODULES.filter(key => key !== 'analytics');
const ROLES_CONFIG = [
  { name: 'Jefe TIC', admin: true, view: ['*'], edit: ['*'] },
  { name: ASSISTANT_ROLE, admin: false, view: ['*'], edit: ASSISTANT_EDIT },
  { name: 'Asistente TIC mañana', admin: false, view: ['*'], edit: ASSISTANT_EDIT },
  { name: 'Asistente TIC tarde', admin: false, view: ['*'], edit: ASSISTANT_EDIT },
  { name: 'Consulta', admin: false, view: ['*'], edit: [] }
];

const log = message => console.log(message);
const out = assertSafeDbPath(option('out') || DEFAULT_SEED_DB);

// ── Equipos: 40, con etiquetas D5xxx y alias operativos (Filtro + Número) ────
function buildDevices() {
  const list = [];
  let tag = 5001;
  const add = (count, base) => {
    for (let n = 1; n <= count; n += 1) list.push({ etiqueta: `D${tag++}`, numero: String(n), ...base(n) });
  };
  add(16, n => ({ categoria: 'Chromebook', filtro: 'Touch', dispositivo: 'Chromebook', marca: 'Lenovo', modelo: '300e Gen 2', sn: `LNV3E${String(4100 + n * 7)}` }));
  add(8, n => ({ categoria: 'Chromebook', filtro: 'Plani', dispositivo: 'Chromebook', marca: 'Samsung', modelo: 'XE500C12', sn: `SMG5C${String(2200 + n * 13)}` }));
  add(8, n => ({ categoria: 'Notebook', filtro: 'Dell', dispositivo: 'Notebook', marca: 'Dell', modelo: 'Latitude 3420', sn: `DL34${String(900 + n * 11)}` }));
  add(6, n => ({ categoria: 'Tablet', filtro: 'Tablet', dispositivo: 'Tablet', marca: 'Samsung', modelo: 'Galaxy Tab A8', sn: `TABA8${String(300 + n * 5)}` }));
  add(2, n => ({ categoria: 'Chromebook', filtro: 'TIC', dispositivo: 'Chromebook', marca: 'HP', modelo: 'Chromebook 14 G7', sn: `HP14G${String(70 + n)}` }));
  return list;
}
// Alias de cada etiqueta (Touch 3 → D5003, Plani 1 → D5017, Dell 1 → D5025, Tablet 1 → D5033, TIC 1 → D5039).
const LOANS = [
  { etiquetas: ['D5003', 'D5004', 'D5005'], body: { person: 'Laura Méndez', role: 'Maestra', location: 'Aula', schoolLevel: 'EP', course: '4N', reason: 'Proyecto / actividad de aula' } },
  { etiquetas: ['D5017'], body: { person: 'Martín Ríos', role: 'Profesor', location: 'Planificación móvil', reason: 'Planificación' } },
  { etiquetas: ['D5025', 'D5026'], body: { person: 'Sofía Paredes', role: 'Directivo', location: 'Dirección / Coordinación', reason: 'Préstamo autorizado' } },
  { etiquetas: ['D5033'], body: { person: 'Julián Ferreyra', role: 'DOE', location: 'DOE', reason: 'Soporte temporal' } }
];
const STATUSES = [
  { etiqueta: 'D5016', estado: 'En reparación', comentario: 'Pantalla con líneas: enviada al service.' },
  { etiqueta: 'D5032', estado: 'Fuera de servicio', comentario: 'No enciende, placa dañada.' }
];

function localDate(offsetDays = 0, from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function weekDates() {
  const now = new Date();
  const monday = (now.getDay() + 6) % 7; // 0 = lunes
  return [0, 1, 2, 3, 4].map(i => localDate(i - monday, now));
}

function buildAgenda() {
  const [lun, mar, mie, jue, vie] = weekDates();
  const today = localDate(0);
  const items = [
    { fecha: lun, turno: 'Mañana', desde: '08:00', hasta: '09:20', curso: '3N', actividad: 'Lectura en plataforma Glifing', tipoDispositivo: 'Touch', cantidad: 12, ubicacion: 'Aula 3N', estado: 'Realizado' },
    { fecha: lun, turno: 'Tarde', desde: '13:30', hasta: '14:50', curso: '6F', actividad: 'Presentaciones de Ciencias', tipoDispositivo: 'Dell', cantidad: 4, ubicacion: 'Laboratorio', estado: 'Realizado' },
    { fecha: mar, turno: 'Mañana', desde: '09:30', hasta: '10:50', curso: '5S', actividad: 'Evaluación de Matemática en Classroom', tipoDispositivo: 'Touch', cantidad: 15, ubicacion: 'Aula 5S', estado: 'Realizado' },
    { fecha: mie, turno: 'Mañana', desde: '08:00', hasta: '09:20', curso: '2N', actividad: 'Juegos de cálculo mental', tipoDispositivo: 'Tablet', cantidad: 6, ubicacion: 'Aula 2N', estado: 'Cancelado', nota: 'La maestra faltó.' },
    { fecha: jue, turno: 'Mañana', desde: '10:00', hasta: '11:20', curso: '4N', actividad: 'Robótica con kits', tipoDispositivo: 'Touch', cantidad: 10, ubicacion: 'Laboratorio', estado: 'Pendiente' },
    { fecha: jue, turno: 'Tarde', desde: '14:00', hasta: '15:20', curso: '1S', actividad: 'Investigación en Ciencias Sociales', tipoDispositivo: 'Plani', cantidad: 4, ubicacion: 'Biblioteca', estado: 'Pendiente' },
    { fecha: vie, turno: 'Mañana', desde: '08:00', hasta: '09:20', curso: '6N', actividad: 'Edición de video para el acto', tipoDispositivo: 'Dell', cantidad: 5, ubicacion: 'Sala de música', estado: 'Pendiente' },
    { fecha: vie, turno: 'Tarde', desde: '13:30', hasta: '14:50', curso: '3F', actividad: 'Escritura colaborativa en Docs', tipoDispositivo: 'Touch', cantidad: 14, ubicacion: 'Aula 3F', estado: 'Pendiente' },
    // Hoy, para que el Inicio tenga "en curso / próxima" y Agenda tenga del día.
    { fecha: today, turno: 'Mañana', desde: '07:45', hasta: '09:00', curso: '5N', actividad: 'Kahoot de repaso de Lengua', tipoDispositivo: 'Touch', cantidad: 8, ubicacion: 'Aula 5N', estado: 'Entregado' },
    { fecha: today, turno: 'Tarde', desde: '15:30', hasta: '16:40', curso: '2S', actividad: 'Taller de programación en Scratch', tipoDispositivo: 'Dell', cantidad: 3, ubicacion: 'Laboratorio', estado: 'Pendiente' },
    { fecha: today, turno: 'Tarde', desde: '17:00', hasta: '18:00', curso: 'Docentes', actividad: 'Capacitación: uso de la pizarra digital', tipoDispositivo: 'TIC', cantidad: 1, ubicacion: 'SUM', estado: 'Pendiente' }
  ];
  return items.map((item, index) => ({ id: `QAAG${String(index + 1).padStart(2, '0')}`, responsableTic: ADMIN.nombre, nota: '', ...item }));
}

function buildTasks() {
  const due = days => localDate(days);
  return [
    { titulo: 'Revisar cargadores del carro Touch', descripcion: 'Contar cargadores y marcar los que no cargan.', prioridad: 'Alta', estado: 'Pendiente', fechaVencimiento: due(1) },
    { titulo: 'Actualizar Chrome OS de las Plani', descripcion: 'Forzar actualización desde la consola de admin.', prioridad: 'Media', estado: 'Pendiente', fechaVencimiento: due(3) },
    { titulo: 'Etiquetar las tablets nuevas', descripcion: 'Imprimir etiquetas D5033 a D5038 y pegarlas.', prioridad: 'Baja', estado: 'Pendiente', fechaVencimiento: due(7) },
    { titulo: 'Configurar proyector del SUM', descripcion: 'Ajustar resolución para la capacitación de hoy.', prioridad: 'Urgente', estado: 'En proceso', fechaVencimiento: due(0) },
    { titulo: 'Reclamar service de la Touch 16', descripcion: 'Llamar al proveedor por la pantalla con líneas.', prioridad: 'Media', estado: 'En proceso', fechaVencimiento: due(2) },
    { titulo: 'Inventario de mouses y teclados', descripcion: 'Contar stock del depósito TIC.', prioridad: 'Baja', estado: 'Hecha', fechaVencimiento: due(-2) },
    { titulo: 'Instalar Scratch en las Dell', descripcion: 'Para el taller de 2S.', prioridad: 'Alta', estado: 'Hecha', fechaVencimiento: due(-1) }
  ].map((task, index) => ({ id: `QATK${String(index + 1).padStart(2, '0')}`, responsables: [ADMIN.nombre], turno: 'Todo el día', ...task }));
}

const TICKETS = [
  { numero: '48211', titulo: 'Proyector del aula 4N no enciende', descripcion: 'La lámpara parpadea y se apaga.', prioridad: 'Alta', estado: 'No hecho', checklist: ['Probar otro cable de alimentación', 'Revisar horas de lámpara', 'Pedir repuesto'] },
  { numero: '48212', titulo: 'Sin Wi-Fi en la biblioteca', descripcion: 'Los equipos no ven la red Alumnos.', prioridad: 'Urgente', estado: 'En proceso', checklist: ['Reiniciar access point', 'Verificar VLAN'] },
  { numero: '48213', titulo: 'Impresora de sala de profesores atascada', descripcion: 'Atasco recurrente en bandeja 2.', prioridad: 'Media', estado: 'No hecho' },
  { numero: '48214', titulo: 'Alta de usuario de Classroom para docente nueva', descripcion: 'Docente de 3F, ingresa el lunes.', prioridad: 'Baja', estado: 'Hecho' },
  { numero: '', origen: 'handing', titulo: 'Parlante del SUM con ruido', descripcion: 'Zumbido al conectar la notebook.', prioridad: 'Media', estado: 'No hecho' }
];

const NOTES = [
  { texto: 'Las Touch 3, 4 y 5 quedaron en 4N hasta el viernes (proyecto de robótica).', categoria: 'Préstamos', importante: true },
  { texto: 'El carro de Dell tiene un cargador menos: no prestar más de 6 juntas.', categoria: 'General', importante: false },
  { texto: 'Mañana viene el técnico del proyector del SUM a las 10.', categoria: 'General', importante: false }
];

const REMINDERS = [
  { title: 'Devolver Touch 3, 4 y 5 de 4N', description: 'Pasar a buscarlas por el aula.', days: 1, priority: 'Alta' },
  { title: 'Renovar licencias de Glifing', description: 'Vencen a fin de mes.', days: 6, priority: 'Media' }
];

const ARTICLES = [
  { title: 'Cómo prestar un equipo', category: 'Préstamos', tags: ['préstamos', 'inicio'], content: '<p>Entrá a <strong>Préstamos</strong>, escaneá o escribí el equipo (por ejemplo <em>Touch 7</em>), completá la persona, el rol y la ubicación y tocá <strong>Prestar</strong>.</p>' },
  { title: 'Conectar el proyector por HDMI', category: 'Proyectores', tags: ['hdmi', 'aulas'], content: '<p>Usá el cable HDMI de la mesa, elegí la entrada <strong>HDMI 1</strong> con el control y, si no hay imagen, presioná Windows + P.</p>' }
];

// ── Base ────────────────────────────────────────────────────────────────────
async function prepareCopy() {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (flag('fresh')) removeDbFiles(out);
  const reused = fs.existsSync(out);
  if (!reused) {
    log(`Copiando ${path.relative(root, REAL_DB)} (solo lectura) → ${path.relative(root, out)}`);
    await snapshotDatabase(REAL_DB, out);
  } else {
    log(`Reusando ${path.relative(root, out)} (idempotente; --fresh para empezar de cero)`);
  }
  const db = new Database(out, { timeout: 10000 });
  try {
    // Nada sale afuera aunque la copia tuviera otra cosa: mail en modo prueba y sin push.
    db.prepare("INSERT INTO app_settings (key, value) VALUES ('mail.modoPrueba', 'true') ON CONFLICT(key) DO UPDATE SET value='true'").run();
    db.prepare('DELETE FROM push_subscriptions').run();
    const superadmin = db.prepare("SELECT id, email FROM users WHERE rol_global='Superadmin' AND activo=1 ORDER BY id LIMIT 1").get();
    if (!superadmin) throw new Error('La copia no tiene ningún Superadmin activo en `users` (hace falta para crear la sede).');
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date().toISOString();
    db.prepare('INSERT INTO user_sessions (token, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
      .run(token, superadmin.id, now, new Date(Date.now() + 3600000).toISOString(), now);
    let invites = {};
    try { invites = JSON.parse(db.prepare('SELECT value FROM app_settings WHERE key=?').get(INVITES_KEY)?.value || '{}'); } catch { invites = {}; }
    return { reused, superToken: token, invites };
  } finally {
    db.close();
  }
}

function finishCopy(invites) {
  const db = new Database(out, { timeout: 10000 });
  try {
    // Ni la sesión temporal del superadmin, ni las del admin de la siembra, ni las
    // que venían en la copia: cada persona arranca sin ninguna sesión viva.
    db.prepare('DELETE FROM user_sessions').run();
    db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(INVITES_KEY, JSON.stringify(invites));
    // Deja el archivo autocontenido (sin -wal) para copiarlo tal cual por persona.
    db.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }
}

// ── Pasos contra el server real ─────────────────────────────────────────────
async function seed(base, superToken, storedInvites) {
  const reader = new Database(out, { readonly: true, timeout: 10000 });
  const one = (sql, ...args) => reader.prepare(sql).get(...args);
  const counts = {};
  try {
    const sa = apiAs(base, { token: superToken, site: 'NFPT' });
    const saSession = must(await sa.get('/api/auth/session'), 'sesión superadmin');
    const saSite = saSession.sites?.[0]?.siteCode;
    if (!saSite) throw new Error('El superadmin no ve ninguna sede.');
    const superApi = apiAs(base, { token: superToken, site: saSite });

    // 1) Sede QA (POST /api/sites, solo Superadmin; también siembra la config por defecto).
    if (!one('SELECT 1 FROM sites WHERE site_code=?', QA_SITE)) {
      must(await superApi.post('/api/sites', { siteCode: QA_SITE, nombre: QA_SITE_NAME, subtitulo: 'Entorno de QA (no es producción)' }), 'crear sede QA');
      log(`Sede ${QA_SITE} creada.`);
    } else log(`Sede ${QA_SITE} ya existía.`);

    // 2) Admin de la sede: invitación de admin + registro real; si ya existe, ingreso.
    const admin = apiAs(base, { site: QA_SITE });
    let adminReady = false;
    if (one("SELECT 1 FROM allowed_users WHERE lower(email)=? AND COALESCE(deleted_at,'')=''", ADMIN.email)) {
      adminReady = await admin.login(ADMIN.email, ADMIN.password).then(() => true, () => false);
    }
    if (!adminReady) {
      const created = must(await superApi.post('/api/invites', { siteCode: QA_SITE, role: 'Jefe TIC', turno: 'Todo el día', kind: 'admin', expiresInDays: 1 }), 'invitación del admin QA');
      must(await admin.post('/api/auth/register', { code: created.invite.code, email: ADMIN.email, nombre: ADMIN.nombre, password: ADMIN.password }), 'registro del admin QA');
      await admin.login(ADMIN.email, ADMIN.password);
      log(`Admin ${ADMIN.email} registrado con su invitación.`);
    } else log(`Admin ${ADMIN.email} ya existía (ingresó).`);

    // 3) Módulos (todos, incluidos knowledge, reminders y canvas) y roles.
    must(await admin.patch('/api/site-settings', {
      settings: {
        'modules.enabled': ALL_MODULES,
        'modules.order': ALL_MODULES,
        'roles.config': ROLES_CONFIG
      }
    }), 'config de la sede');

    // 4) Equipos.
    const devices = buildDevices();
    let added = 0;
    for (const device of devices) {
      if (one('SELECT 1 FROM local_devices WHERE site_code=? AND etiqueta=?', QA_SITE, device.etiqueta)) continue;
      must(await admin.post('/api/devices/add', device), `equipo ${device.etiqueta}`);
      added += 1;
    }
    counts.equipos = `${devices.length} (${added} nuevos)`;

    // 5) Estados especiales y préstamos (solo la primera vez: si ya hay algo prestado, no).
    for (const status of STATUSES) {
      const current = one('SELECT estado FROM local_states WHERE site_code=? AND etiqueta=?', QA_SITE, status.etiqueta)?.estado;
      if (current === status.estado) continue;
      must(await admin.post('/api/devices/status', status), `estado ${status.etiqueta}`);
    }
    const anyLoaned = one("SELECT 1 FROM local_states WHERE site_code=? AND estado='Prestado'", QA_SITE);
    let lent = 0;
    if (!anyLoaned) {
      for (const loan of LOANS) {
        const result = must(await admin.post('/api/loans/lend-batch', { etiquetas: loan.etiquetas, ...loan.body }), `préstamo ${loan.etiquetas.join(',')}`);
        lent += result.done || 0;
      }
    }
    counts.prestados = anyLoaned ? 'ya estaban' : lent;

    // 6) Agenda de la semana (ids fijos QAAGnn).
    let agenda = 0;
    for (const item of buildAgenda()) {
      if (one('SELECT 1 FROM agenda WHERE site_code=? AND id=?', QA_SITE, item.id)) continue;
      must(await admin.post('/api/agenda', item), `agenda ${item.id}`);
      agenda += 1;
    }
    counts.agenda = `${buildAgenda().length} (${agenda} nuevas)`;

    // 7) Tareas (ids fijos QATKnn).
    let tasks = 0;
    for (const task of buildTasks()) {
      if (one('SELECT 1 FROM tasks WHERE site_code=? AND id=?', QA_SITE, task.id)) continue;
      must(await admin.post('/api/tasks', task), `tarea ${task.id}`);
      tasks += 1;
    }
    counts.tareas = `${buildTasks().length} (${tasks} nuevas)`;

    // 8) Tickets (por título).
    let tickets = 0;
    for (const ticket of TICKETS) {
      if (one('SELECT 1 FROM tickets WHERE site_code=? AND titulo=? AND COALESCE(activo,1)=1', QA_SITE, ticket.titulo)) continue;
      must(await admin.post('/api/tickets', { origen: 'tik', ...ticket }), `ticket ${ticket.titulo}`);
      tickets += 1;
    }
    counts.tickets = `${TICKETS.length} (${tickets} nuevos)`;

    // 9) Notas del día, recordatorios y artículos de conocimiento.
    let notes = 0;
    for (const note of NOTES) {
      if (one('SELECT 1 FROM internal_notes WHERE site_code=? AND texto=?', QA_SITE, note.texto)) continue;
      must(await admin.post('/api/internal-notes', note), 'nota');
      notes += 1;
    }
    let reminders = 0;
    for (const item of REMINDERS) {
      if (one('SELECT 1 FROM reminders WHERE site_code=? AND title=? AND active=1', QA_SITE, item.title)) continue;
      const when = new Date(Date.now() + item.days * 86400000);
      when.setHours(10, 0, 0, 0);
      must(await admin.post('/api/reminders', { title: item.title, description: item.description, priority: item.priority, remindAt: when.toISOString() }), 'recordatorio');
      reminders += 1;
    }
    let articles = 0;
    for (const article of ARTICLES) {
      if (one('SELECT 1 FROM knowledge_articles WHERE site_code=? AND title=?', QA_SITE, article.title)) continue;
      must(await admin.post('/api/knowledge/articles', article), 'artículo');
      articles += 1;
    }
    counts.notas = `${NOTES.length} (${notes} nuevas)`;
    counts.recordatorios = `${REMINDERS.length} (${reminders} nuevos)`;
    counts.conocimiento = `${ARTICLES.length} (${articles} nuevos)`;

    // 10) Invitaciones de asistente: una por persona + repuestos. Se reusan las
    // que siguen activas; las usadas, revocadas o vencidas se reemplazan.
    const invites = {};
    let newInvites = 0;
    for (const key of [...PERSONAS, ...SPARES]) {
      const code = storedInvites[key];
      const row = code ? one('SELECT * FROM invites WHERE code=? AND site_code=?', code, QA_SITE) : null;
      const alive = row && !row.used_at && !row.revoked_at && (!row.expires_at || new Date(row.expires_at).getTime() > Date.now() + 7 * 86400000);
      if (alive) { invites[key] = code; continue; }
      const created = must(await admin.post('/api/invites', { role: ASSISTANT_ROLE, turno: ASSISTANT_TURNO, expiresInDays: INVITE_DAYS }), `invitación ${key}`);
      invites[key] = created.invite.code;
      newInvites += 1;
    }
    counts.invitaciones = `${Object.keys(invites).length} (${newInvites} nuevas)`;
    return { invites, counts };
  } finally {
    reader.close();
  }
}

function writeCredentials(invites) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const persona = key => ({
    codigo: invites[key],
    registro: `/register?code=${invites[key]}`,
    mailSugerido: `${key}@qa.test`,
    rol: ASSISTANT_ROLE
  });
  const data = {
    generado: new Date().toISOString(),
    baseSembrada: path.relative(root, out).replace(/\\/g, '/'),
    sede: { codigo: QA_SITE, nombre: QA_SITE_NAME },
    admin: { ...ADMIN, rol: 'Jefe TIC' },
    personas: Object.fromEntries(PERSONAS.map(key => [key, persona(key)])),
    repuestos: Object.fromEntries(SPARES.map(key => [key, persona(key)])),
    notas: [
      'Cada persona usa su propia instancia (qa/serve-qa.mjs --name=<persona>): los códigos se gastan solo en su copia.',
      `El registro deja la cuenta ACTIVA directo (rol ${ASSISTANT_ROLE} en la sede QA): no hace falta aprobar.`,
      'Los links de "olvidé mi contraseña" quedan en qa/.out/<persona>/mails.log (node qa/mails.mjs --name=<persona>).',
      'Equipos de la sede: etiquetas D5001–D5040 (Touch 1–16, Plani 1–8, Dell 1–8, Tablet 1–6, TIC 1–2). Prestados: Touch 3/4/5, Plani 1, Dell 1/2, Tablet 1. Touch 16 en reparación, Dell 8 fuera de servicio.'
    ]
  };
  fs.writeFileSync(CREDENTIALS_FILE, `${JSON.stringify(data, null, 2)}\n`);
}

// ── Principal ───────────────────────────────────────────────────────────────
const started = Date.now();
const { superToken, invites: storedInvites } = await prepareCopy();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'techasset-qa-seed-'));
let server;
let result;
try {
  const port = await freePort();
  server = await startQaServer({ dbPath: out, port, uploadsDir: path.join(tmpDir, 'uploads'), mailFile: path.join(tmpDir, 'mails.jsonl'), tmpDir });
  log(`Server de siembra en ${server.base}`);
  result = await seed(server.base, superToken, storedInvites);
} catch (error) {
  console.error(`\nFalló la siembra: ${error instanceof Error ? error.stack || error.message : error}`);
  if (server) console.error(`\nÚltimo log del server:\n${server.getLog().slice(-3000)}`);
  process.exitCode = 1;
} finally {
  await stopQaServer(server);
  for (let i = 0; i < 20; i += 1) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); break; } catch { await new Promise(resolve => setTimeout(resolve, 150)); }
  }
}
// Las sesiones se borran siempre (también la temporal del superadmin); las invitaciones se guardan.
finishCopy(result?.invites || storedInvites);
if (result) {
  writeCredentials(result.invites);
  console.table(result.counts);
  log(`Listo en ${((Date.now() - started) / 1000).toFixed(1)} s · base ${path.relative(root, out)} · credenciales en ${path.relative(root, CREDENTIALS_FILE)}`);
}
