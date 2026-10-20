// Snapshot de base con volumen realista para las pasadas de rendimiento.
//
//   node perf/seed-snapshot.mjs [--src=data/techasset.db] [--out=docs/redesign/bench/snapshot.db]
//
// Copia la base local con la API de backup de SQLite (nunca escribe en el
// origen) y le siembra datos DETERMINISTAS (PRNG con semilla fija: dos corridas
// dan la misma base) para que los benchmarks midan algo parecido a un año de uso:
//
//   - ≥ 300 equipos en NFPT (+ algunos en NFND), ~40 prestados ahora.
//   - ≥ 5.000 eventos de préstamo/devolución en el último año, con su movimiento.
//   - ≥ 300 personas distintas: nombres repetidos (muchas "María", "Juan"…),
//     con y sin tilde, y la misma persona escrita de dos formas
//     ("María González" / "maria gonzalez"), con frecuencia tipo Zipf.
//   - 250 tareas (con historial), 250 tickets, 300 actividades de agenda (con
//     historial) y 150 notificaciones para el superadmin de la suite.
//
// El snapshot queda fuera de git (*.db en .gitignore); este script sí se versiona.
// Las etiquetas sembradas (D2000…) y los filtros ("Carro", "Tablet") no chocan con
// los equipos reales: "touch 34" sigue encontrando un único equipo (D1436).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { snapshotDatabase } from '../e2e/lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = (name, fallback) => {
  const found = process.argv.slice(2).find(arg => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const SRC = path.resolve(option('src', path.join(root, 'data', 'techasset.db')));
const OUT = path.resolve(option('out', path.join(root, 'docs', 'redesign', 'bench', 'snapshot.db')));

// PRNG determinista (mulberry32).
let seed = 20261019;
const rand = () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = list => list[Math.floor(rand() * list.length)];
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));

const FIRST = ['María', 'Juan', 'José', 'Lucía', 'Sofía', 'Martín', 'Julián', 'Agustín', 'Valentina', 'Camila', 'Joaquín', 'Belén',
  'Inés', 'Andrés', 'Ramón', 'Ángela', 'Álvaro', 'Iñaki', 'Mónica', 'Germán', 'Ana', 'Pedro', 'Laura', 'Pablo', 'Carolina', 'Diego',
  'Florencia', 'Tomás', 'Victoria', 'Matías', 'Paula', 'Nicolás', 'Alejandra', 'Alejandro', 'Verónica', 'Facundo', 'Rocío', 'Sebastián',
  'Natalia', 'Gonzalo', 'Micaela', 'Ezequiel', 'Daniela', 'Santiago', 'Mariana', 'Federico', 'Lorena', 'Hernán', 'Cecilia', 'Valeria'];
const LAST = ['González', 'Pérez', 'Fernández', 'Rodríguez', 'López', 'Martínez', 'Gómez', 'Díaz', 'Sánchez', 'Romero', 'Álvarez',
  'Ruiz', 'Benítez', 'Suárez', 'Acosta', 'Medina', 'Herrera', 'Aguirre', 'Giménez', 'Molina', 'Castro', 'Ortiz', 'Núñez', 'Ríos',
  'Peña', 'Ibáñez', 'Cavalli', 'Weiss', 'Montuani', 'Florez', 'Valdés', 'Muñoz', 'Domínguez', 'Quiroga', 'Sosa', 'Vázquez'];
const ROLES = ['Docente', 'Docente', 'Docente', 'Alumno', 'Preceptor', 'Directivo', 'Auxiliar'];
const PLACES = ['Aula', 'Aula', 'Aula', 'Biblioteca', 'Sala de profesores', 'Laboratorio', 'Dirección'];
const COURSES = ['EP · 1A', 'EP · 2B', 'EP · 3A', 'EP · 4C', 'EP · 5A', 'EP · 6B', 'ES · 1A', 'ES · 2B', 'ES · 3A', 'ES · 4B', 'ES · 5A'];
const REASONS = ['Clase', 'Clase', 'Evaluación', 'Proyecto', 'Reunión', 'Acto'];
const OPERATORS = ['Bauti', 'equi', 'Laura'];
const stripAccents = value => value.normalize('NFD').replace(/[̀-ͯ]/g, '');

function buildPeople() {
  const people = new Map();
  while (people.size < 340) {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    if (!people.has(name)) people.set(name, { name, rol: pick(ROLES), ubicacion: pick(PLACES), curso: pick(COURSES), motivo: pick(REASONS) });
  }
  const list = [...people.values()];
  // Variantes de escritura de la misma persona (sin tildes / minúsculas).
  for (const person of list.slice(0, 30)) person.variants = [person.name, stripAccents(person.name), stripAccents(person.name).toLowerCase()];
  return list;
}

function zipfIndex(n) {
  // Rango con peso ~1/(k+1): unas pocas personas piden mucho, la mayoría poco.
  const u = rand();
  return Math.min(n - 1, Math.floor(Math.pow(n + 1, u)) - 1);
}

function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  for (const file of [OUT, `${OUT}-wal`, `${OUT}-shm`]) fs.rmSync(file, { force: true });
  return snapshotDatabase(SRC, OUT).then(() => seedInto(OUT));
}

function seedInto(file) {
  const db = new Database(file);
  db.pragma('journal_mode = DELETE');
  const now = Date.now();
  const iso = ms => new Date(ms).toISOString();
  const yearAgo = now - 365 * 86400000;

  const insertDevice = db.prepare(`INSERT OR REPLACE INTO local_devices
    (site_code, etiqueta, payload, eliminado, deleted_at, deleted_by, created_at, updated_at, categoria, filtro, modelo, marca, serial,
     numero_operativo, alias_operativo, alias_alternativos, estado, activo)
    VALUES (?, ?, ?, 0, '', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'Disponible', 1)`);
  const devices = [];
  const addDevice = (site, etiqueta, categoria, filtro, numero, marca, modelo) => {
    const alias = `${filtro || categoria} ${numero}`;
    const payload = {
      siteCode: site, etiqueta, numero: String(numero), numeroOperativo: String(numero), categoria, filtro, dispositivo: categoria,
      marca, modelo, sn: `SN${etiqueta}${numero}`, mac: '', estado: 'Disponible', prestadoA: '', comentarios: '', rol: '', ubicacion: '',
      motivo: '', loanedAt: '', returnedAt: '', ultima: '', aliasOperativo: alias, aliasOperativoJson: JSON.stringify([alias])
    };
    insertDevice.run(site, etiqueta, JSON.stringify(payload), iso(yearAgo), iso(yearAgo), categoria, filtro, modelo, marca, payload.sn, String(numero), alias);
    devices.push({ site, etiqueta, alias, filtro });
  };

  const people = buildPeople();
  const events = [];
  db.transaction(() => {
    // Equipos: 250 Chromebooks "Carro" + 60 tablets en NFPT, 40 en NFND.
    for (let i = 1; i <= 250; i += 1) addDevice('NFPT', `D${2000 + i}`, 'Chromebook', 'Carro', i, 'Lenovo', '100e Gen 3');
    for (let i = 15; i <= 74; i += 1) addDevice('NFPT', `D${2300 + i}`, 'Tablet', '', i, 'Samsung', 'Tab A8');
    for (let i = 1; i <= 40; i += 1) addDevice('NFND', `D${2500 + i}`, 'Chromebook', 'Carro', i, 'Lenovo', '100e Gen 3');

    // Eventos: préstamo + devolución por equipo a lo largo del año, ~2.850 pares.
    const real = db.prepare("SELECT site_code AS site, etiqueta, alias_operativo AS alias, filtro FROM local_devices WHERE COALESCE(eliminado,0)=0 AND activo=1").all();
    const pool = real.filter(d => d.site === 'NFPT');
    const ndPool = real.filter(d => d.site === 'NFND');
    const pairs = 2850;
    const loanedNow = new Set();
    for (let i = 0; i < pairs; i += 1) {
      const nd = i % 9 === 0 && ndPool.length;
      const device = pick(nd ? ndPool : pool);
      const person = people[zipfIndex(people.length)];
      const persona = person.variants ? pick(person.variants) : person.name;
      const loanAt = yearAgo + Math.floor(rand() * (now - yearAgo - 6 * 3600000));
      const back = loanAt + int(20, 300) * 60000;
      const curso = person.ubicacion === 'Aula' ? person.curso : '';
      const sessionId = `seed-${i}`;
      events.push({ site: device.site, tipo: 'prestamo', device, persona, rol: person.rol, ubicacion: person.ubicacion, curso, motivo: person.motivo, ts: loanAt, sessionId });
      // Los últimos 40 préstamos de NFPT quedan abiertos (equipo prestado ahora).
      const keepOpen = i >= pairs - 60 && !nd && !loanedNow.has(device.etiqueta) && loanedNow.size < 40;
      if (keepOpen) loanedNow.add(device.etiqueta);
      else events.push({ site: device.site, tipo: 'devolucion', device, persona: '', rol: '', ubicacion: '', curso: '', motivo: '', ts: back, sessionId });
    }
    events.sort((a, b) => a.ts - b.ts);
    // Un préstamo abierto tiene que ser el último evento de su equipo.
    const lastOpen = new Map();
    for (const event of events) if (event.tipo === 'prestamo' && loanedNow.has(event.device.etiqueta)) lastOpen.set(event.device.etiqueta, event);
    const filtered = events.filter(event => !(loanedNow.has(event.device.etiqueta) && event.ts > lastOpen.get(event.device.etiqueta).ts));

    const insertEvent = db.prepare(`INSERT INTO loan_events (site_code, tipo, etiqueta, alias, filtro, persona, rol, ubicacion, ubicacion_detalle, curso, motivo,
      motivo_detalle, comentarios, operador, origen, loan_session_id, accessories_json, expected_accessories_json, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, '', '', ?, 'Local', ?, '[]', '[]', ?)`);
    const insertMovement = db.prepare('INSERT INTO local_movements (timestamp, tipo, descripcion, operador, origen, etiqueta, site_code) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const event of filtered) {
      const operador = pick(OPERATORS);
      const ts = iso(event.ts);
      insertEvent.run(event.site, event.tipo, event.device.etiqueta, event.device.alias || '', event.device.filtro || '', event.persona, event.rol,
        event.ubicacion, event.curso, event.motivo, operador, event.sessionId, ts);
      const label = `${event.device.etiqueta} · ${event.device.alias || event.device.etiqueta}`;
      insertMovement.run(ts, event.tipo === 'prestamo' ? 'préstamo' : 'devolución',
        event.tipo === 'prestamo' ? `${label} prestada a ${event.persona}` : `${label} devuelta`, operador, 'Local', event.device.etiqueta, event.site);
    }
    const upsertState = db.prepare(`INSERT OR REPLACE INTO local_states (site_code, etiqueta, estado, prestado_a, rol, ubicacion, ubicacion_detalle, curso, motivo,
      motivo_detalle, comentarios, loaned_at, returned_at, updated_at) VALUES (?, ?, 'Prestado', ?, ?, ?, '', ?, ?, '', '', ?, '', ?)`);
    for (const event of lastOpen.values()) {
      upsertState.run(event.site, event.device.etiqueta, event.persona, event.rol, event.ubicacion, event.curso, event.motivo, iso(event.ts), iso(event.ts));
    }

    // Tareas con historial.
    const columns = Object.fromEntries(db.prepare("SELECT name, id FROM task_columns WHERE site_code='NFPT'").all().map(row => [row.name, row.id]));
    const insertTask = db.prepare(`INSERT OR REPLACE INTO tasks (id, titulo, descripcion, responsable, estado, prioridad, tipo, fecha_creacion, fecha_vencimiento,
      comentario, creado_por, operador_ultimo_cambio, agenda_id, ultima_modificacion, eliminada, responsables_json, turno, site_code, visibility, owner_email,
      column_id, assignee_emails_json, attachments_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, '', ?, 0, ?, ?, 'NFPT', 'team', '', ?, '[]', '[]')`);
    const insertTaskHistory = db.prepare(`INSERT INTO task_history (task_id, timestamp, titulo, accion, responsable, estado_anterior, estado_nuevo, comentario, operador, agenda_id, site_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, '', 'NFPT')`);
    const TASK_TITLES = ['Revisar proyector', 'Cargar carro', 'Actualizar Chromebooks', 'Probar audio', 'Configurar impresora', 'Reponer cables HDMI', 'Revisar wifi', 'Instalar app'];
    for (let i = 0; i < 250; i += 1) {
      const created = yearAgo + Math.floor(rand() * (now - yearAgo));
      const estado = i < 30 ? 'Pendiente' : i < 45 ? 'En proceso' : 'Hecha';
      const who = pick(['Bauti', 'equi']);
      const titulo = `${pick(TASK_TITLES)} ${pick(COURSES)}`;
      const id = `TKSEED${String(i).padStart(4, '0')}`;
      insertTask.run(id, titulo, 'Tarea sembrada para benchmarks.', who, estado, pick(['Baja', 'Media', 'Alta']), 'Soporte', iso(created),
        new Date(created + 7 * 86400000).toISOString().slice(0, 10), who, who, iso(created + 3600000), JSON.stringify([who]), pick(['Mañana', 'Tarde']), columns[estado] ?? null);
      insertTaskHistory.run(id, iso(created), titulo, 'tarea creada', who, '', 'Pendiente', who);
      if (estado !== 'Pendiente') insertTaskHistory.run(id, iso(created + 3600000), titulo, 'estado cambiado', who, 'Pendiente', estado, who);
    }

    // Tickets.
    const insertTicket = db.prepare(`INSERT INTO tickets (site_code, numero, titulo, descripcion, estado, prioridad, responsables_json, categoria, origen, creado_por,
      operador_ultimo_cambio, activo, created_at, updated_at, resolved_at) VALUES ('NFPT', ?, ?, ?, ?, ?, ?, ?, 'tik', ?, ?, 1, ?, ?, ?)`);
    const TICKET_TITLES = ['No anda el proyector', 'Chromebook no carga', 'Sin internet en el aula', 'Pantalla rota', 'Teclado con teclas sueltas', 'No imprime'];
    for (let i = 0; i < 250; i += 1) {
      const created = yearAgo + Math.floor(rand() * (now - yearAgo));
      const estado = i < 25 ? 'No hecho' : i < 40 ? 'En proceso' : 'Hecho';
      const who = pick(['Bauti', 'equi']);
      insertTicket.run(`T-${String(i + 1).padStart(4, '0')}`, `${pick(TICKET_TITLES)} ${pick(COURSES)}`, 'Ticket sembrado para benchmarks.', estado,
        pick(['Baja', 'Media', 'Alta']), JSON.stringify([who]), pick(['Hardware', 'Red', 'Software']), who, who, iso(created), iso(created + 7200000),
        estado === 'Hecho' ? iso(created + 7200000) : '');
    }

    // Agenda con historial (fechas a lo largo del año, casi todas terminadas).
    const insertAgenda = db.prepare(`INSERT OR REPLACE INTO agenda (id, dia, fecha, turno, desde, hasta, curso, actividad, tipo_dispositivo, cantidad, ubicacion,
      responsable_tic, estado, nota, compus_retiradas, operador_ultimo_cambio, ultima_modificacion, eliminada, created_at, site_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Aula', ?, ?, '', ?, ?, ?, 0, ?, 'NFPT')`);
    const insertAgendaHistory = db.prepare(`INSERT INTO agenda_history (agenda_id, timestamp, accion, estado_anterior, estado_nuevo, nota, operador, site_code)
      VALUES (?, ?, ?, ?, ?, '', ?, 'NFPT')`);
    const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    for (let i = 0; i < 300; i += 1) {
      const at = yearAgo + Math.floor(rand() * (now - yearAgo + 14 * 86400000));
      const date = new Date(at);
      const past = at < now - 86400000;
      const estado = past ? pick(['Realizado', 'Realizado', 'Realizado', 'Cancelado']) : 'Pendiente';
      const hour = int(8, 15);
      const cantidad = int(5, 30);
      const who = pick(['Bauti', 'equi']);
      const id = `AGSEED${String(i).padStart(4, '0')}`;
      insertAgenda.run(id, DAYS[date.getDay()], date.toISOString().slice(0, 10), hour < 12 ? 'Mañana' : 'Tarde', `${String(hour).padStart(2, '0')}:15`,
        `${String(hour + 1).padStart(2, '0')}:05`, pick(COURSES), pick(['Glifing', 'Santillana', 'Proyecto', 'Evaluación']), pick(['Carro', 'Tablet']),
        cantidad, who, estado, past ? cantidad : 0, who, iso(at), iso(at - 7 * 86400000));
      insertAgendaHistory.run(id, iso(at - 7 * 86400000), 'agenda creada', '', 'Pendiente', who);
      if (past) insertAgendaHistory.run(id, iso(at), 'estado cambiado', 'Pendiente', estado, who);
    }

    // Notificaciones del superadmin que usa la suite (el primero por id).
    const admin = db.prepare("SELECT email FROM users WHERE rol_global='Superadmin' AND activo=1 ORDER BY id LIMIT 1").get();
    if (admin) {
      const insertNotification = db.prepare(`INSERT INTO notifications (site_code, user_email, kind, title, body, link, read, payload_json, created_at)
        VALUES ('NFPT', ?, ?, ?, '', '', ?, '', ?)`);
      for (let i = 0; i < 150; i += 1) {
        insertNotification.run(String(admin.email).toLowerCase(), pick(['task.created', 'ticket.created', 'reminder.due']), `Aviso sembrado ${i + 1}`,
          i < 140 ? 1 : 0, iso(now - (150 - i) * 3 * 3600000));
      }
    }
  })();

  const count = sql => db.prepare(sql).get().n;
  const summary = {
    devicesNFPT: count("SELECT COUNT(*) n FROM local_devices WHERE site_code='NFPT' AND COALESCE(eliminado,0)=0"),
    loanEventsNFPT: count("SELECT COUNT(*) n FROM loan_events WHERE site_code='NFPT'"),
    loanEventsTotal: count('SELECT COUNT(*) n FROM loan_events'),
    peopleNFPT: count("SELECT COUNT(DISTINCT persona) n FROM loan_events WHERE site_code='NFPT' AND tipo='prestamo' AND TRIM(persona)<>''"),
    loanedNow: count("SELECT COUNT(*) n FROM local_states WHERE estado='Prestado'"),
    movements: count('SELECT COUNT(*) n FROM local_movements'),
    tasks: count('SELECT COUNT(*) n FROM tasks'),
    tickets: count('SELECT COUNT(*) n FROM tickets'),
    agenda: count('SELECT COUNT(*) n FROM agenda'),
    notifications: count('SELECT COUNT(*) n FROM notifications')
  };
  db.exec('VACUUM');
  db.close();
  console.log(`Snapshot sembrado en ${file}`);
  console.log(summary);
}

main().catch(error => { console.error(error); process.exit(1); });
