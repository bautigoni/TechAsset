// Smoke test contra un Postgres REAL (no SQLite): levanta el server en modo
// Postgres, siembra datos mínimos por la API y recorre los endpoints. Sirve para
// atrapar SQL que SQLite acepta y Postgres no (pg-sync traduce la API, no el SQL).
//
//   docker run -d --rm --name techasset-pgtest -e POSTGRES_PASSWORD=pgtest -e POSTGRES_DB=techasset -p 127.0.0.1:55432:5432 postgres:17-alpine
//   PG_TEST_URL="postgresql://postgres:pgtest@127.0.0.1:55432/techasset?sslmode=disable" node server/scripts/bench/pg-smoke.mjs
//
// El chat real del asistente gasta una consulta paga: solo corre con PG_SMOKE_AI=1
// (y el .env con AI_PROVIDER=anthropic + ANTHROPIC_API_KEY); sin eso el server de
// prueba arranca sin IA. Adjuntos, CSV y temporales van a un directorio propio de
// la corrida que se borra al final: nada cae en data/.
//
// NUNCA apuntarlo a producción: crea usuarios, sesiones, equipos y movimientos.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const url = process.env.PG_TEST_URL;
if (!url || /supabase|pooler|amazonaws/i.test(url)) {
  console.error('PG_TEST_URL tiene que ser un Postgres local de pruebas (nunca el de producción).');
  process.exit(2);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = Number(process.env.PG_SMOKE_PORT || 8061);
const base = `http://127.0.0.1:${PORT}`;
const results = [];
let serverLog = '';
const withAi = process.env.PG_SMOKE_AI === '1';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'techasset-pgsmoke-'));

const child = spawn(process.execPath, ['server/index.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), DATABASE_URL: url, DB_DRIVER: 'postgres', MODO_PRUEBA: 'true', SMTP_SERVER: '', SMTP_USER: '', SMTP_APP_PASSWORD: '', RESEND_API_KEY: '', GOOGLE_SHEET_CSV_URL: '', BOOTSTRAP_SITES: 'NFPT:Northfield Puertos,NFND:Northfield Nordelta', DEFAULT_SITE_CODE: 'NFPT',
    UPLOADS_DIR: path.join(tmpDir, 'uploads'), TOOLS_TEMP_DIR: path.join(tmpDir, 'tools'),
    CACHE_CSV_PATH: path.join(tmpDir, 'cache_sheet.csv'), DEVICES_APP_CSV_PATH: path.join(tmpDir, 'devices_app.csv'),
    ...(withAi ? {} : { AI_PROVIDER: 'local', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' }) },
  stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', chunk => { serverLog += chunk; });
child.stderr.on('data', chunk => { serverLog += chunk; });

const db = new pg.Client({ connectionString: url, ssl: false });
let cookie = '';
const call = async (method, route, body, headers = {}) => {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Site-Code': 'NFPT', cookie, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* no JSON */ }
  return { status: response.status, json, text };
};
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); };

try {
  for (let i = 0; i < 120; i += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* arrancando */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  check('server arranca en Postgres (migraciones)', (await fetch(`${base}/api/health`)).ok, serverLog.slice(-300));

  // Usuario superadmin + sesión, directo en la base de pruebas.
  await db.connect();
  const email = `smoke-${Date.now()}@test.local`;
  const now = new Date().toISOString();
  await db.query("INSERT INTO allowed_users (email, nombre, default_role, status, activo, created_at, updated_at) VALUES ($1,'Smoke','Superadmin','Activo',1,$2,$2)", [email, now]);
  const user = await db.query("INSERT INTO users (email, nombre, rol_global, activo, created_at, updated_at) VALUES ($1,'Smoke','Superadmin',1,$2,$2) RETURNING id", [email, now]);
  const token = crypto.randomBytes(32).toString('hex');
  await db.query('INSERT INTO user_sessions (token, user_id, created_at, expires_at, last_seen_at) VALUES ($1,$2,$3,$4,$3)', [token, user.rows[0].id, now, new Date(Date.now() + 864e5).toISOString()]);
  cookie = `${process.env.SESSION_COOKIE_NAME || 'techasset_session'}=${token}`;

  const session = await call('GET', '/api/auth/session');
  check('sesión válida (caché de sesión)', session.json?.authenticated, session.text.slice(0, 200));

  // Equipos.
  const tags = ['D9001', 'D9002', 'D9003', 'D9004'];
  for (const [index, etiqueta] of tags.entries()) {
    const added = await call('POST', '/api/devices/add', { etiqueta, filtro: 'Touch', numero: String(index + 1), dispositivo: 'Chromebook', estado: 'Disponible' });
    check(`alta ${etiqueta}`, added.status === 200, added.text.slice(0, 200));
  }
  const devices = await call('GET', '/api/devices');
  check('GET /devices (caché + vida útil)', devices.status === 200 && devices.json.items.length >= 4, devices.text.slice(0, 200));

  // Préstamo suelto y en lote.
  const lend = await call('POST', '/api/loans/lend', { etiqueta: 'D9001', person: 'Ana', role: 'Alumno', location: 'DOE' });
  check('prestar suelto', lend.json?.ok, lend.text.slice(0, 200));
  const estado = async tag => (await call('GET', '/api/devices')).json.items.find(item => item.etiqueta === tag)?.estado;
  check('se ve prestado al instante', /prest/i.test(await estado('D9001') || ''));
  const lendBatch = await call('POST', '/api/loans/lend-batch', { etiquetas: ['D9002', 'D9003', 'D9999'], person: 'Grupo 5F', role: 'Alumno', location: 'DOE' });
  check('prestar en lote', lendBatch.json?.done === 2, lendBatch.text.slice(0, 200));
  // Pasada 2: préstamo/devolución parchan el inventario cacheado en vez de
  // rearmarlo. Tiene que quedar IGUAL que un armado desde cero: se fuerza
  // invalidando con una escritura de equipos que no cambia nada visible.
  const patched = (await call('GET', '/api/devices')).json;
  await call('POST', '/api/devices/status', { etiqueta: 'D9004', estado: 'Disponible' });
  const rebuilt = (await call('GET', '/api/devices')).json;
  const pick = list => JSON.stringify((list?.items || []).filter(item => ['D9001', 'D9002', 'D9003'].includes(item.etiqueta)));
  check('inventario parchado == armado desde cero (pasada 2)', pick(patched) === pick(rebuilt) && /prest/i.test(patched.items.find(item => item.etiqueta === 'D9002')?.estado || ''), `${pick(patched).slice(0, 300)} vs ${pick(rebuilt).slice(0, 300)}`);
  const panelCounts = await call('GET', '/api/devices/panel-counts');
  check('GET /devices/panel-counts (subconsultas COUNT)', panelCounts.status === 200 && typeof panelCounts.json?.groups === 'number' && typeof panelCounts.json?.trash === 'number', panelCounts.text.slice(0, 200));
  const toolsConfig = await call('GET', '/api/tools/config');
  check('GET /tools/config (claves de mail en un IN)', toolsConfig.status === 200 && typeof toolsConfig.json?.modoPrueba === 'boolean', toolsConfig.text.slice(0, 200));
  // Directorio de personas en memoria (pasada 1): se arma con lo prestado.
  const peopleBefore = await call('GET', '/api/loans/people');
  check('GET /loans/people (directorio)', peopleBefore.status === 200 && peopleBefore.json.people.some(p => p.persona === 'Ana') && peopleBefore.json.people.find(p => p.persona === 'Grupo 5F')?.count === 2, peopleBefore.text.slice(0, 200));
  const suggest = await call('GET', '/api/loans/suggest?q=gru%205');
  check('GET /loans/suggest (palabras, sin tildes)', suggest.status === 200 && suggest.json.suggestions[0]?.persona === 'Grupo 5F', suggest.text.slice(0, 200));
  const previousDay = await call('GET', '/api/loans/previous-day');
  check('GET /loans/previous-day (consulta indexada por día)', previousDay.status === 200 && Array.isArray(previousDay.json.items) && /^\d{4}-\d{2}-\d{2}$/.test(previousDay.json.date), previousDay.text.slice(0, 200));
  const passOptions = await call('GET', '/api/photo-passes/options');
  check('GET /photo-passes/options (UNION ALL)', passOptions.status === 200 && Array.isArray(passOptions.json.cursos) && passOptions.json.docentes.includes('Grupo 5F'), passOptions.text.slice(0, 200));
  const returnBatch = await call('POST', '/api/loans/return-batch', { etiquetas: ['D9001', 'D9002', 'D9003'] });
  check('devolver en lote', returnBatch.json?.done === 3, returnBatch.text.slice(0, 200));
  // Deshacer (línea de estado de Préstamos): devolución → vuelve prestado a la misma persona; préstamo → libre.
  const undoReturn = await call('POST', '/api/loans/undo', { etiqueta: 'D9001', action: 'return' });
  const afterUndo = (await call('GET', '/api/devices')).json.items.find(item => item.etiqueta === 'D9001');
  check('deshacer devolución (re-presta con los mismos datos)', undoReturn.json?.done === 1 && /prest/i.test(afterUndo?.estado || '') && afterUndo?.prestadoA === 'Ana', undoReturn.text.slice(0, 200));
  const undoLend = await call('POST', '/api/loans/undo', { etiquetas: ['D9001'], action: 'lend' });
  check('deshacer préstamo (queda libre)', undoLend.json?.done === 1 && !/prest/i.test(await estado('D9001') || ''), undoLend.text.slice(0, 200));
  const undoAgain = await call('POST', '/api/loans/undo', { etiqueta: 'D9001', action: 'lend' });
  check('deshacer dos veces no hace nada', undoAgain.json?.done === 0, undoAgain.text.slice(0, 200));
  const peopleAfter = await call('GET', '/api/loans/people');
  check('el directorio se rearma tras el Deshacer (Ana ya no tiene préstamos)', peopleAfter.status === 200 && !peopleAfter.json.people.some(p => p.persona === 'Ana'), peopleAfter.text.slice(0, 200));
  // Recordatorios por evento (pasada 1): uno vencido avisa enseguida, sin esperar un tick.
  const reminder = await call('POST', '/api/reminders', { title: 'Smoke vencido', remindAt: new Date(Date.now() - 60000).toISOString() });
  let reminderNotified = false;
  for (let i = 0; i < 20 && !reminderNotified; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 100));
    reminderNotified = ((await call('GET', '/api/notifications')).json?.items || []).some(item => item.title === 'Recordatorio: Smoke vencido');
  }
  check('recordatorio vencido avisa al guardarlo (sin tick de 10 s)', reminder.status === 200 && reminderNotified, reminder.text.slice(0, 200));
  check('fuera de servicio no se presta', (await (async () => {
    await call('POST', '/api/devices/status', { etiqueta: 'D9004', estado: 'Fuera de servicio' });
    return (await call('POST', '/api/loans/lend', { etiqueta: 'D9004', person: 'X', role: 'Alumno', location: 'DOE' })).status;
  })()) === 409);

  // Movimientos (UNION ALL) e historial (cursor).
  const movements = await call('GET', '/api/movements');
  check('GET /movements (UNION ALL)', movements.status === 200 && movements.json.items.length > 0, movements.text.slice(0, 200));
  for (const kind of ['loans', 'all']) {
    const full = await call('GET', `/api/history?kind=${kind}&limit=200`);
    let paged = [], cursor = '', pages = 0;
    do {
      const page = await call('GET', `/api/history?kind=${kind}&limit=2${cursor ? `&before=${encodeURIComponent(cursor)}` : ''}`);
      if (page.status !== 200) { check(`historial ${kind} paginado`, false, page.text.slice(0, 200)); break; }
      paged.push(...page.json.items); cursor = page.json.nextCursor; pages += 1;
    } while (cursor && pages < 50);
    check(`historial ${kind}: paginar = sin paginar`, full.status === 200 && JSON.stringify(full.json.items.map(x => x.cursorId)) === JSON.stringify(paged.map(x => x.cursorId)), `${full.json?.items?.length} vs ${paged.length}`);
  }
  const filtered = await call('GET', '/api/history?kind=loans&q=grupo&tipo=prestamo&from=2000-01-01&to=2100-01-01');
  check('historial con filtros (LIKE, fechas, tipo)', filtered.status === 200 && filtered.json.items.length === 2 && filtered.json.items.every(x => x.tipo === 'prestamo'), filtered.text.slice(0, 200));

  // Papelera.
  await call('DELETE', '/api/devices/D9003', {});
  const trash = await call('GET', '/api/devices/deleted');
  check('papelera lista (JOIN)', trash.json?.items?.some(item => item.etiqueta === 'D9003'), trash.text.slice(0, 200));
  const restored = await call('POST', '/api/devices/D9003/restore', {});
  check('restaurar', restored.json?.ok && Boolean(await estado('D9003')), restored.text.slice(0, 200));

  // Lotes de Dispositivos (etapa 5a): estado, borrar y restaurar en un request.
  await call('POST', '/api/loans/lend', { etiqueta: 'D9001', person: 'Ana', role: 'Alumno', location: 'DOE' });
  const statusBatch = await call('POST', '/api/devices/status-batch', { etiquetas: ['D9002', 'D9003', 'D9001', 'D9998'], estado: 'En reparación' });
  check('cambiar estado en lote (multi-fila ON CONFLICT)', statusBatch.json?.done === 2 && statusBatch.json.results.filter(item => !item.ok).length === 2, statusBatch.text.slice(0, 200));
  check('lote no toca prestados', /prest/i.test(await estado('D9001') || '') && (await estado('D9002')) === 'En reparación');
  const deleteBatch = await call('POST', '/api/devices/delete-batch', { etiquetas: ['D9002', 'D9003'] });
  const afterDelete = (await call('GET', '/api/devices')).json.items.map(item => item.etiqueta);
  check('borrar en lote (IN + multi-fila)', deleteBatch.json?.done === 2 && !afterDelete.includes('D9002') && !afterDelete.includes('D9003'), deleteBatch.text.slice(0, 200));
  const restoreBatch = await call('POST', '/api/devices/restore-batch', { etiquetas: ['D9002', 'D9003', 'D9004'] });
  check('restaurar en lote', restoreBatch.json?.done === 2 && Boolean(await estado('D9002')) && Boolean(await estado('D9003')), restoreBatch.text.slice(0, 200));
  await call('POST', '/api/devices/status-batch', { etiquetas: ['D9002', 'D9003'], estado: 'Disponible' });
  await call('POST', '/api/loans/return', { etiqueta: 'D9001' });

  // Historial: alias sin espacio, etiquetas resueltas, CSV de todo y resumen del equipo.
  const aliasCompact = await call('GET', '/api/history?kind=loans&q=touch1');
  check('historial: alias sin espacio (replace/lower)', aliasCompact.status === 200 && aliasCompact.json.items.some(item => item.etiqueta === 'D9001'), aliasCompact.text.slice(0, 200));
  const byTags = await call('GET', '/api/history?kind=all&q=xyz&tags=D9001');
  check('historial: tags en movimientos (IN)', byTags.status === 200 && byTags.json.items.every(item => item.etiqueta === 'D9001') && byTags.json.items.length > 0, byTags.text.slice(0, 200));
  const csv = await call('GET', '/api/history/export.csv?kind=loans&q=grupo');
  check('historial: CSV de lo filtrado', csv.status === 200 && csv.text.includes('Fecha,Tipo,Etiqueta') && csv.text.split('\n').length >= 3, csv.text.slice(0, 200));
  // El primer préstamo de D9001 lo anula el Deshacer de /api/loans/undo (más arriba): queda el de los lotes.
  const summary = await call('GET', '/api/history/device-summary?etiqueta=D9001');
  check('historial: resumen del equipo (COUNT/MAX)', summary.json?.loans >= 1 && Boolean(summary.json.lastLoan), summary.text.slice(0, 200));

  // Agenda (subconsulta del conteo), tareas, cierre del día, notificaciones.
  const agendaNew = await call('POST', '/api/agenda', { dia: 'Sábado', turno: 'Mañana', desde: '08:00', hasta: '09:00', curso: '5F', actividad: 'Prueba', tipoDispositivo: 'Touch', cantidad: 1, estado: 'Pendiente' });
  check('alta agenda', agendaNew.status === 200, agendaNew.text.slice(0, 200));
  const agenda = await call('GET', '/api/agenda');
  check('GET /agenda (conteo en subconsulta)', agenda.status === 200 && Array.isArray(agenda.json.items) && typeof agenda.json.olderHidden === 'number', agenda.text.slice(0, 200));
  check('GET /agenda?all=1', (await call('GET', '/api/agenda?all=1')).status === 200);
  for (const titulo of ['Tarea 1', 'Tarea 2']) await call('POST', '/api/tasks', { titulo, estado: 'Pendiente', responsables: ['Smoke'] });
  const tasks = await call('GET', '/api/tasks?space=team');
  check('GET /tasks', tasks.status === 200 && tasks.json.items.length >= 2, tasks.text.slice(0, 200));
  // Analítica (etapa 8a): una lectura de loan_events, una de tickets y una de tareas (GROUP BY + SUM CASE).
  const todayKey = new Date().toISOString().slice(0, 10);
  const an = await call('GET', `/api/analytics?from=2000-01-01&to=${todayKey}`);
  const s = an.json?.summary;
  check('analítica: responde en Postgres', an.status === 200 && s && !('events' in an.json), an.text.slice(0, 200));
  check('analítica: hora × día 7×24 y tipo por hora', s?.hourWeekday?.length === 7 && s.hourWeekday.every(row => row.length === 24) && Array.isArray(s.byTypeHour), JSON.stringify(s?.byTypeHour || []).slice(0, 200));
  check('analítica: duración por préstamo (mediana, cuartiles, tramos)', s?.durations?.count >= 1 && s.durations.buckets.length === 6 && typeof s.durations.median === 'number', JSON.stringify({ ...(s?.durations || {}), hours: undefined }).slice(0, 200));
  check('analítica: operadores con préstamos y devoluciones', s?.byOperatorSplit?.length >= 1 && s.byOperatorSplit.every(op => typeof op.prestamos === 'number' && typeof op.devoluciones === 'number'), JSON.stringify(s?.byOperatorSplit || []).slice(0, 200));
  check('analítica: tareas abiertas por tipo (SUM CASE)', s?.tareasAbiertas >= 2 && Array.isArray(s.openTasksByType) && s.byTaskType.every(row => typeof row.value === 'number'), JSON.stringify({ a: s?.tareasAbiertas, t: s?.byTaskType }).slice(0, 200));
  check('analítica: evolución densa sin período anterior en "Todo"', s?.evolution?.granularity === 'month' && s.evolution.prevAvailable === false && s.ticketMetrics?.evolution?.points?.length >= 1, JSON.stringify(s?.evolution || {}).slice(0, 200));
  const anWeek = await call('GET', `/api/analytics?from=${new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)}&to=${todayKey}`);
  check('analítica: semana por día con período anterior alineado', anWeek.status === 200 && anWeek.json.summary.evolution.granularity === 'day' && anWeek.json.summary.evolution.points.every(point => typeof point.prev === 'number'), anWeek.text.slice(0, 200));
  const anEvents = await call('GET', `/api/analytics?from=2000-01-01&to=${todayKey}&events=1`);
  check('analítica: events solo con ?events=1', anEvents.status === 200 && Array.isArray(anEvents.json.events) && anEvents.json.events.length >= 1, anEvents.text.slice(0, 200));
  const parque = await call('GET', '/api/analytics/parque');
  check('analítica: parque', parque.status === 200 && Array.isArray(parque.json?.condicionTotales), parque.text.slice(0, 200));
  const analytics = await call('GET', '/api/tasks/analytics');
  check('GET /tasks/analytics (antes 500 con 2+ tareas)', analytics.status === 200, analytics.text.slice(0, 200));
  // Etapa 7a (Tareas): Deshacer de borrar tarea y de eliminar columna, actividad por tarea.
  const firstTask = tasks.json.items[0];
  const removed = await call('DELETE', `/api/tasks/${firstTask.id}`, { operator: 'Smoke' });
  const taskBack = await call('POST', `/api/tasks/${firstTask.id}/restore`, { operator: 'Smoke' });
  check('POST /tasks/:id/restore (Deshacer de borrar)', removed.status === 200 && taskBack.status === 200 && taskBack.json?.item?.id === firstTask.id, taskBack.text.slice(0, 200));
  const history = await call('GET', `/api/tasks/history?taskId=${encodeURIComponent(firstTask.id)}`);
  check('GET /tasks/history?taskId (actividad de una tarea)', history.status === 200 && history.json.items.length >= 3 && history.json.items.every(item => item.task_id === firstTask.id), history.text.slice(0, 200));
  const newColumn = await call('POST', '/api/task-columns', { name: 'Smoke col' });
  const movedTask = await call('PATCH', `/api/tasks/${firstTask.id}`, { ...firstTask, columnId: newColumn.json?.item?.id, operator: 'Smoke' });
  const colsBefore = (await call('GET', '/api/task-columns')).json.items.map(item => item.id);
  const dropped = await call('DELETE', `/api/task-columns/${newColumn.json?.item?.id}`);
  const colRestore = await call('POST', `/api/task-columns/${newColumn.json?.item?.id}/restore`, { taskIds: [firstTask.id], ids: colsBefore });
  const back = (await call('GET', '/api/tasks?space=all')).json.items.find(item => item.id === firstTask.id);
  check('POST /task-columns/:id/restore (Deshacer de eliminar columna)', movedTask.status === 200 && dropped.status === 200 && colRestore.status === 200 && colRestore.json.items.some(item => item.id === newColumn.json.item.id) && back?.columnId === newColumn.json.item.id, colRestore.text.slice(0, 200));
  await call('DELETE', `/api/task-columns/${newColumn.json?.item?.id}`);
  const reborn = await call('POST', '/api/task-columns', { name: 'Smoke col' });
  check('crear una columna con el nombre de una borrada la reactiva', reborn.status === 200 && reborn.json?.item?.id === newColumn.json.item.id, reborn.text.slice(0, 200));
  const closure = await call('GET', '/api/daily-closures/preview');
  check('GET /daily-closures/preview (antes caía con 2+ tareas)', closure.status === 200 && closure.json?.resumen, closure.text.slice(0, 200));
  const notifications = await call('GET', '/api/notifications');
  check('GET /notifications (subconsulta de no leídas)', notifications.status === 200 && typeof notifications.json.unread === 'number', notifications.text.slice(0, 200));
  check('GET /agenda/history (antes tapada por /agenda/:id)', (await call('GET', '/api/agenda/history')).status === 200);

  // Etapa 6a: capacidad por fecha y al editar, restaurar, registro con JOIN, horarios.
  const touchA = await call('POST', '/api/agenda', { dia: 'Martes', turno: 'Mañana', desde: '18:00', hasta: '18:45', curso: 'CapA', actividad: 'Prueba', tipoDispositivo: 'Touch', cantidad: 20, estado: 'Pendiente' });
  const touchB = await call('POST', '/api/agenda', { dia: 'Martes', turno: 'Mañana', desde: '18:45', hasta: '19:30', curso: 'CapB', actividad: 'Prueba', tipoDispositivo: 'Touch', cantidad: 20, estado: 'Pendiente' });
  check('agenda: dos Touch en franjas distintas', touchA.status === 200 && touchB.status === 200, touchB.text.slice(0, 200));
  const moved = await call('PATCH', `/api/agenda/${touchB.json?.item?.id}`, { desde: '18:30', hasta: '19:00' });
  check('agenda: PATCH que superpone sobre el tope da 409', moved.status === 409, moved.text.slice(0, 200));
  const badTimes = await call('POST', '/api/agenda', { dia: 'Martes', turno: 'Mañana', desde: '10:00', hasta: '09:00', curso: 'X', tipoDispositivo: 'Dell', cantidad: 1 });
  check('agenda: Hasta antes de Desde da 400', badTimes.status === 400, badTimes.text.slice(0, 200));
  await call('PATCH', `/api/agenda/${touchA.json?.item?.id}`, { estado: 'Cancelado' });
  const freed = await call('PATCH', `/api/agenda/${touchB.json?.item?.id}`, { desde: '18:30', hasta: '19:00' });
  check('agenda: una cancelada no ocupa lugar', freed.status === 200, freed.text.slice(0, 200));
  // Fecha local (no toISOString: de noche en Argentina ya es el día siguiente en UTC y caía en miércoles).
  const nextTuesday = (() => { const d = new Date(); d.setDate(d.getDate() + ((9 - d.getDay()) % 7 || 7)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const dated = await call('POST', '/api/agenda', { fecha: nextTuesday, dia: 'Lunes', turno: 'Mañana', desde: '18:40', hasta: '18:50', curso: 'CapC', tipoDispositivo: 'Touch', cantidad: 10, estado: 'Pendiente' });
  check('agenda: con fecha choca con la semanal de ese día (y el día sale de la fecha)', dated.status === 409, dated.text.slice(0, 200));
  await call('DELETE', `/api/agenda/${touchB.json?.item?.id}`, {});
  const restoredAgenda = await call('POST', `/api/agenda/${touchB.json?.item?.id}/restore`, {});
  check('agenda: restaurar borrada', restoredAgenda.status === 200 && restoredAgenda.json?.item?.id === touchB.json?.item?.id, restoredAgenda.text.slice(0, 200));
  const log = await call('GET', '/api/agenda/history?limit=5');
  check('agenda: registro con datos de la actividad (LEFT JOIN)', log.status === 200 && log.json.items.length === 5 && log.json.items.some(item => item.curso === 'CapB'), log.text.slice(0, 200));
  const ics = await call('GET', '/api/agenda/calendar-feed');
  const feed = ics.json?.token ? await fetch(`${base}/calendar/${ics.json.token}.ics`).then(response => response.text()) : '';
  check('feed ICS con RRULE semanal', /RRULE:FREQ=WEEKLY;BYDAY=TU/.test(feed), feed.slice(0, 200));
  const schedule = await call('POST', '/api/teacher-schedules', { teacher: 'Smoke', course: '1A', schoolLevel: 'primary_first', dayOfWeek: 1, startTime: '08:00', endTime: '08:45' });
  await call('DELETE', `/api/teacher-schedules/${schedule.json?.item?.id}`, {});
  const scheduleBack = await call('POST', `/api/teacher-schedules/${schedule.json?.item?.id}/restore`, {});
  check('horarios: restaurar borrado', scheduleBack.status === 200 && scheduleBack.json?.item?.teacher === 'Smoke', scheduleBack.text.slice(0, 200));
  const recessOk = await call('PUT', '/api/recess-schedules', { groups: [{ name: 'G1', slots: [{ label: 'Recreo', startTime: '10:00', endTime: '10:15' }] }, { name: 'G2', slots: [] }] });
  check('recreos: guardar y leer (franjas en un JOIN)', recessOk.status === 200 && recessOk.json?.groups?.[0]?.slots?.length === 1, recessOk.text.slice(0, 200));
  const recessBad = await call('PUT', '/api/recess-schedules', { groups: [{ name: 'G1', slots: [{ label: 'Recreo', startTime: '10:15', endTime: '10:00' }] }] });
  const recessKept = await call('GET', '/api/recess-schedules');
  check('recreos: franja inválida da 400 y no borra lo guardado', recessBad.status === 400 && recessKept.json?.groups?.length === 2, recessBad.text.slice(0, 200));
  check('ruta /api inexistente da 404 JSON', (await call('GET', '/api/no-existe')).status === 404);

  // Login y links de contraseña (tabla nueva password_tokens).
  const bad = await call('POST', '/api/auth/login', { email: 'nadie@test.local', password: 'abcdef' }, { cookie: '' });
  check('login: mensaje genérico', bad.status === 401 && /incorrectos/.test(bad.json?.error || ''), bad.text.slice(0, 200));
  const link = await call('POST', '/api/auth/password/request', { email }, { cookie: '' });
  check('pedir link de contraseña (password_tokens)', link.status === 200, link.text.slice(0, 200));
  const confirm = await call('POST', '/api/auth/password/confirm', { token: 'x', password: 'abcdef' }, { cookie: '' });
  check('token inválido se rechaza', confirm.status === 400, confirm.text.slice(0, 200));

  // Etapa 0 del rediseño: queries nuevas (COUNT(*) OVER, lower(email), ON CONFLICT).
  for (let i = 0; i < 3; i += 1) await call('POST', '/api/knowledge/articles', { title: `Artículo ${i} configuración`, content: '<p>Canon</p>', category: 'General', tags: [] });
  const knowledge = await call('GET', '/api/knowledge/articles?limit=2');
  check('conocimiento paginado (total + nextCursor)', knowledge.status === 200 && knowledge.json.items.length === 2 && knowledge.json.total >= 3 && knowledge.json.nextCursor, knowledge.text.slice(0, 200));
  const knowledgeQ = await call('GET', '/api/knowledge/articles?q=CONFIGURACION');
  check('conocimiento: búsqueda sin acentos', knowledgeQ.status === 200 && knowledgeQ.json.items.length >= 3, knowledgeQ.text.slice(0, 200));
  // Etapa 7c: categoría con conteo, filtro por categoría (vacía = General) y Deshacer del borrado.
  const kbRedes = await call('POST', '/api/knowledge/articles', { title: 'Red de alumnos', content: '<p>WiFi</p>', category: 'Redes', tags: ['wifi'] });
  await call('POST', '/api/knowledge/articles', { title: 'Sin categoría', content: '<p>x</p>', category: '', tags: [] });
  const kbFacets = await call('GET', '/api/knowledge/articles?limit=1');
  const facet = name => (kbFacets.json?.categories || []).find(item => item.name === name)?.count;
  check('conocimiento: conteo por categoría (vacía cuenta como General)', kbFacets.status === 200 && facet('Redes') === 1 && facet('General') >= 4, kbFacets.text.slice(0, 300));
  const kbCat = await call('GET', '/api/knowledge/articles?category=General&limit=50');
  check('conocimiento: filtro por categoría en SQL', kbCat.status === 200 && kbCat.json.items.length >= 4 && kbCat.json.items.every(item => !item.category || item.category === 'General'), kbCat.text.slice(0, 200));
  const kbCatQ = await call('GET', '/api/knowledge/articles?q=wifi&category=Redes');
  check('conocimiento: búsqueda + categoría', kbCatQ.status === 200 && kbCatQ.json.items.length === 1 && kbCatQ.json.categories?.length === 1, kbCatQ.text.slice(0, 200));
  const kbId = kbRedes.json?.item?.id;
  await call('DELETE', `/api/knowledge/articles/${kbId}`);
  const kbGone = await call('GET', `/api/knowledge/articles/${kbId}`);
  const kbBack = await call('POST', `/api/knowledge/articles/${kbId}/restore`);
  check('conocimiento: borrar y Deshacer (restore)', kbGone.status === 404 && kbBack.status === 200 && kbBack.json.item.title === 'Red de alumnos', `${kbGone.status} ${kbBack.text.slice(0, 120)}`);
  const v0 = await call('GET', '/api/canvas/version');
  const cvNode = await call('POST', '/api/canvas/items', { itemType: 'sticky', title: 'Smoke', content: { text: 'hola' } });
  const v1 = await call('GET', '/api/canvas/version');
  check('canvas: huella de versión cambia con un alta', v0.status === 200 && v1.status === 200 && v0.json.version !== v1.json.version, `${v0.text} → ${v1.text}`);
  const cvId = cvNode.json?.item?.id;
  const cvPatch = await call('PATCH', `/api/canvas/items/${cvId}`, { zIndex: 99, width: 300, height: 220 });
  check('canvas: traer al frente y redimensionar (PATCH zIndex/width/height)', cvPatch.status === 200 && cvPatch.json.item.zIndex === 99 && cvPatch.json.item.width === 300, cvPatch.text.slice(0, 200));
  await call('DELETE', `/api/canvas/items/${cvId}`);
  const cvAfterDel = await call('GET', '/api/canvas/items');
  const cvBack = await call('POST', `/api/canvas/items/${cvId}/restore`);
  const cvAfter = await call('GET', '/api/canvas/items');
  check('canvas: borrar y Deshacer (restore)', !cvAfterDel.json.items.some(item => item.id === cvId) && cvBack.status === 200 && cvAfter.json.items.some(item => item.id === cvId), cvBack.text.slice(0, 120));
  const prefs = await call('PATCH', '/api/user/prefs', { themeProfile: 'classic' });
  check('preferencias por mail', prefs.status === 200 && (await call('GET', '/api/user/prefs')).status === 200, prefs.text.slice(0, 200));
  const dupSite = await call('POST', '/api/sites', { siteCode: 'NFPT', nombre: 'Duplicada' });
  check('crear sede existente da 409', dupSite.status === 409, dupSite.text.slice(0, 200));
  const note = await call('POST', '/api/internal-notes', { texto: 'nota smoke', importante: false });
  check('notas con localDate', note.status === 200 && /^\d{4}-\d{2}-\d{2}$/.test(note.json?.item?.localDate || ''), note.text.slice(0, 200));
  // Inicio (etapa 3): ★ importante, borrar y Deshacer del borrado.
  const noteId = note.json?.item?.id;
  const starred = await call('PATCH', `/api/internal-notes/${noteId}`, { importante: true });
  const hiddenNote = await call('PATCH', `/api/internal-notes/${noteId}`, { visible: false });
  const noteBack = await call('PATCH', `/api/internal-notes/${noteId}`, { visible: true });
  check('nota: importante, borrar y Deshacer', starred.json?.item?.importante === true && hiddenNote.json?.item?.visible === false && noteBack.json?.item?.visible === true && noteBack.json?.item?.deletedAt === '', noteBack.text.slice(0, 200));

  // Asistente: tablas assistant_audit / ai_usage_daily en Postgres.
  const aiStatus = await call('GET', '/api/asistente/status');
  check('asistente: status', aiStatus.status === 200, aiStatus.text.slice(0, 200));
  const undoMissing = await call('POST', '/api/asistente/deshacer', { actionId: 999999 });
  check('asistente: deshacer inexistente da 404', undoMissing.status === 404, undoMissing.text.slice(0, 200));
  if (withAi && aiStatus.json?.provider === 'anthropic' && aiStatus.json?.hasApiKey) {
    const chat = await call('POST', '/api/asistente/chat', { messages: [{ role: 'user', content: '¿Cuántos equipos hay prestados?' }] });
    check('asistente: chat real (uso diario + auditoría en Postgres)', chat.status === 200 && chat.json?.reply, chat.text.slice(0, 200));
  }

  // Etapa 5b: Inventario TIC (unidades en lote, ocultos/restaurar, deshacer revisión).
  const invItem = await call('POST', '/api/inventory/items', { nombre: 'Smoke sensores', categoria: 'Sensores', cantidad: 70, minStock: 3, imagenUrl: '/uploads/inventory/NFPT/smoke.png' });
  check('alta de recurso', invItem.status === 200 && invItem.json?.item?.id, invItem.text.slice(0, 200));
  const invId = invItem.json?.item?.id;
  const batch = await call('POST', `/api/inventory/items/${invId}/units/batch`, { count: 70 });
  check('crear las N en un request (tope 60)', batch.status === 200 && batch.json.units.length === 60 && batch.json.capped === true && batch.json.item?.unidadesCargadas === 60, batch.text.slice(0, 200));
  const batch2 = await call('POST', `/api/inventory/items/${invId}/units/batch`, { count: 2 });
  check('lote siguiente sigue la numeración', batch2.status === 200 && batch2.json.units.some(unit => unit.numero === '62'), batch2.text.slice(0, 200));
  const reviewed = await call('PATCH', `/api/inventory/items/${invId}`, { condicion: 'Malo', revisado: true });
  check('calificar recurso', reviewed.json?.item?.condicion === 'Malo' && reviewed.json.item.condicionUpdatedAt, reviewed.text.slice(0, 200));
  const undoItem = await call('POST', '/api/inventory/review/undo', { kind: 'recurso', id: invId, condicion: '', reviewedAt: '', categoria: 'Sensores' });
  check('deshacer calificación de recurso', undoItem.json?.item?.condicion === '' && undoItem.json.item.condicionUpdatedAt === '', undoItem.text.slice(0, 200));
  const meta = await call('PATCH', '/api/devices/D9004/metadata', { condition: 'Bueno', assetClass: 'Chromebook', origen: 'Revisión' });
  const undoDev = await call('POST', '/api/inventory/review/undo', { kind: 'equipo', etiqueta: 'D9004', condicion: '', reviewedAt: '', assetClass: '' });
  const d9004 = (await call('GET', '/api/devices')).json.items.find(item => item.etiqueta === 'D9004');
  check('deshacer calificación de equipo (invalida la caché)', meta.status === 200 && undoDev.json?.ok && !d9004?.condition && !d9004?.lastReviewedAt, `${undoDev.text.slice(0, 120)} ${JSON.stringify({ c: d9004?.condition, r: d9004?.lastReviewedAt })}`);
  const hide = await call('DELETE', `/api/inventory/items/${invId}`);
  const hiddenList = await call('GET', '/api/inventory/items/hidden');
  check('ocultos lista el recurso', hide.json?.deleted && hiddenList.json?.items?.some(item => item.id === invId), hiddenList.text.slice(0, 200));
  const invRestore = await call('POST', `/api/inventory/items/${invId}/restore`, {});
  const visibleAgain = (await call('GET', '/api/inventory/items')).json.items.some(item => item.id === invId);
  check('restaurar recurso oculto', invRestore.json?.item?.id === invId && visibleAgain, invRestore.text.slice(0, 200));

  // Etapa 7b: Tickets (lotes en un request, Deshacer de borrado, paso de
  // checklist recuperado en su lugar, plantilla recuperada) y Sugerencias
  // (conteos de filtros, restaurar, estado en español en la notificación).
  const tk = [];
  for (const numero of ['7001', '7002', '7003']) tk.push((await call('POST', '/api/tickets', { numero, titulo: `Smoke ${numero}`, origen: 'tik', checklist: ['Uno', 'Dos', 'Tres'] })).json?.item?.id);
  check('alta de 3 tickets con checklist', tk.every(Boolean));
  const bulkEstado = await call('POST', '/api/tickets/bulk', { action: 'estado', ids: tk, estado: 'Hecho' });
  const afterBulk = (await call('GET', '/api/tickets')).json.items.filter(item => tk.includes(item.id));
  check('tickets: estado en lote (transacción)', bulkEstado.json?.changed?.length === 3 && afterBulk.every(item => item.estado === 'Hecho' && item.resolvedAt), bulkEstado.text.slice(0, 200));
  const bulkUndo = await call('POST', '/api/tickets/bulk', { action: 'estado', items: tk.map((id, index) => ({ id, estado: index ? 'En proceso' : 'No hecho' })) });
  check('tickets: deshacer lote con estado por ticket', bulkUndo.json?.changed?.length === 3, bulkUndo.text.slice(0, 200));
  const bulkDel = await call('POST', '/api/tickets/bulk', { action: 'delete', ids: tk.slice(0, 2) });
  const goneOk = !(await call('GET', '/api/tickets')).json.items.some(item => tk.slice(0, 2).includes(item.id));
  const bulkRestore = await call('POST', '/api/tickets/bulk', { action: 'restore', ids: tk.slice(0, 2) });
  const backOk = (await call('GET', '/api/tickets')).json.items.filter(item => tk.includes(item.id)).length === 3;
  check('tickets: borrar en lote y restaurar', bulkDel.json?.changed?.length === 2 && goneOk && bulkRestore.json?.changed?.length === 2 && backOk, `${bulkDel.text.slice(0, 100)} ${bulkRestore.text.slice(0, 100)}`);
  const detail = (await call('GET', `/api/tickets/${tk[2]}/detail`)).json;
  const middle = detail.checklist[1];
  await call('PATCH', `/api/tickets/${tk[2]}/checklist/${middle.id}`, { done: true });
  await call('DELETE', `/api/tickets/${tk[2]}/checklist/${middle.id}`);
  const readded = await call('POST', `/api/tickets/${tk[2]}/checklist`, { text: middle.text, position: middle.position, done: true });
  const order = (await call('GET', `/api/tickets/${tk[2]}/detail`)).json.checklist.map(item => `${item.text}${item.done ? '✓' : ''}`).join(',');
  check('tickets: deshacer "quitar paso" vuelve a su lugar y tildado', readded.json?.item?.done && order === 'Uno,Dos✓,Tres', order);
  const tpl = (await call('POST', '/api/ticket-templates', { title: 'Smoke plantilla', checklist: ['a'], tags: ['x'] })).json?.item;
  await call('DELETE', `/api/ticket-templates/${tpl?.id}`);
  const tplRestore = await call('POST', `/api/ticket-templates/${tpl?.id}/restore`, {});
  check('plantilla: eliminar y recuperar', tplRestore.json?.item?.id === tpl?.id && (await call('GET', '/api/ticket-templates')).json.items.some(item => item.id === tpl?.id), tplRestore.text.slice(0, 200));
  const sg = (await call('POST', '/api/suggestions', { title: 'Smoke idea', description: 'Probar', category: 'Smoke' })).json?.item;
  await call('POST', '/api/suggestions', { title: 'Smoke idea 2', description: 'Probar', category: 'Otra' });
  await call('PATCH', `/api/suggestions/${sg?.id}`, { status: 'Implemented' });
  const sgList = await call('GET', '/api/suggestions?category=Smoke');
  check('sugerencias: conteos de filtros', sgList.json?.counts?.status?.all === 1 && sgList.json.counts.status.Implemented === 1 && sgList.json.counts.category.all >= 2, JSON.stringify(sgList.json?.counts));
  await call('DELETE', `/api/suggestions/${sg?.id}`);
  const sgRestore = await call('POST', `/api/suggestions/${sg?.id}/restore`, {});
  check('sugerencias: eliminar y recuperar', sgRestore.json?.item?.id === sg?.id && sgRestore.json.item.status === 'Implemented', sgRestore.text.slice(0, 200));
  // Etapa 6b: Estado de aulas (último diagnóstico) y Recordatorios (deshacer, personas, push de prueba).
  const healthBefore = await call('GET', '/api/classrooms/pp_6F/health');
  check('aulas: diagnóstico guardado vacío', healthBefore.status === 200 && healthBefore.json?.report === null, healthBefore.text.slice(0, 200));
  const healthNew = await call('POST', '/api/classrooms/pp_6F/health', {});
  const healthAfter = await call('GET', '/api/classrooms/pp_6F/health');
  check('aulas: el diagnóstico se vuelve a leer', healthNew.status === 200 && typeof healthAfter.json?.report?.score === 'number' && healthAfter.json.generatedAt, healthAfter.text.slice(0, 200));
  const rem = await call('POST', '/api/reminders', { title: 'Smoke recordatorio', remindAt: new Date(Date.now() + 3600e3).toISOString(), priority: 'Alta' });
  const remId = rem.json?.item?.id;
  check('recordatorio: alta con mine/canEdit', rem.status === 200 && rem.json.item.mine === true && rem.json.item.canEdit === true, rem.text.slice(0, 200));
  const done = await call('POST', `/api/reminders/${remId}/complete`, {});
  const reopened = await call('POST', `/api/reminders/${remId}/undo`, { previous: { status: 'pending', remindAt: rem.json?.item?.remindAt, notificationSentAt: '', completedAt: '', completedBy: '' } });
  check('recordatorio: completar → deshacer', done.json?.item?.status === 'completed' && reopened.json?.item?.status === 'pending' && reopened.json.item.completedAt === '', reopened.text.slice(0, 200));
  const remRemoved = await call('DELETE', `/api/reminders/${remId}`);
  const remRestored = await call('POST', `/api/reminders/${remId}/undo`, { previous: { status: 'pending', remindAt: rem.json?.item?.remindAt } });
  const listed = (await call('GET', '/api/reminders')).json?.items?.some(item => item.id === remId);
  check('recordatorio: borrar → deshacer lo recupera', remRemoved.json?.deleted && remRestored.status === 200 && listed, remRestored.text.slice(0, 200));
  const people = await call('GET', '/api/reminders/people');
  check('recordatorio: personas de la sede', people.status === 200 && Array.isArray(people.json?.items), people.text.slice(0, 200));
  const pushTest = await call('POST', '/api/reminders/push-test', {});
  check('recordatorio: push de prueba responde', pushTest.status === 200 && typeof pushTest.json?.subscriptions === 'number', pushTest.text.slice(0, 200));
  // Etapa 8c: accesos rápidos (orden manual, deshacer borrado), herramientas, caja chica.
  const qa1 = await call('POST', '/api/quick-links', { titulo: 'Smoke B', url: 'https://b.example.org', categoria: 'SmokeCat' });
  const qa2 = await call('POST', '/api/quick-links', { titulo: 'Smoke A', url: 'https://a.example.org', categoria: 'SmokeCat' });
  const qaIds = [qa1.json?.item?.id, qa2.json?.item?.id];
  const reorder = await call('POST', '/api/quick-links/reorder', { ids: qaIds });
  const qaList = (await call('GET', '/api/quick-links')).json.items.filter(item => item.categoria === 'SmokeCat');
  check('accesos: orden manual (columna orden, ORDER BY categoria, orden)', reorder.json?.changed === 2 && qaList.map(item => item.titulo).join(',') === 'Smoke B,Smoke A', reorder.text.slice(0, 200));
  const qa3 = await call('POST', '/api/quick-links', { titulo: 'Smoke C', url: 'https://c.example.org', categoria: 'SmokeCat' });
  check('accesos: uno nuevo entra al final de la categoría ordenada', qa3.json?.item?.orden === 3, qa3.text.slice(0, 200));
  await call('DELETE', `/api/quick-links/${qaIds[0]}`);
  const qaRestore = await call('POST', `/api/quick-links/${qaIds[0]}/restore`, {});
  check('accesos: deshacer borrado', qaRestore.status === 200 && qaRestore.json?.item?.activo === true, qaRestore.text.slice(0, 200));
  const cardsCsv = 'Username,Nombre,Apellido,Grupo,Contraseña\njp,Juan,Pérez,4N,X1';
  const gen = await call('POST', '/api/tools/glifing/generate', { csv: cardsCsv, tipo: 'glifing' });
  const open1 = await call('GET', gen.json?.downloadUrl || '/api/tools/glifing/download/x');
  const open2 = await call('GET', gen.json?.downloadUrl || '/api/tools/glifing/download/x');
  check('tarjetas: el resultado se abre más de una vez', open1.status === 200 && open2.status === 200 && /Tarjetas de acceso/.test(open2.text) && gen.json?.expiresAt, `${open1.status} ${open2.status}`);
  await call('PATCH', '/api/petty-cash/config', { initialAmount: 1000, requestsEnabled: true });
  const upload = await call('POST', '/api/petty-cash/upload-receipt', { mimeType: 'image/png', base64: Buffer.from('png').toString('base64') });
  const discard = await call('POST', '/api/petty-cash/discard-receipt', { url: upload.json?.url });
  check('caja chica: descartar comprobante sin usar (UNION ALL en Postgres)', discard.status === 200 && discard.json?.removed === true, discard.text.slice(0, 200));
  const upload2 = await call('POST', '/api/petty-cash/upload-receipt', { mimeType: 'image/png', base64: Buffer.from('png').toString('base64') });
  await call('POST', '/api/petty-cash/expenses', { description: 'Smoke gasto', amount: 10, expenseDate: '2026-10-19', receiptUrl: upload2.json?.url });
  const keep = await call('POST', '/api/petty-cash/discard-receipt', { url: upload2.json?.url });
  check('caja chica: no borra un comprobante en uso', keep.status === 200 && keep.json?.removed === false, keep.text.slice(0, 200));
  const req = await call('POST', '/api/petty-cash/requests', { description: 'Smoke compra', estimatedAmount: 5 });
  const rej = await call('PATCH', `/api/petty-cash/requests/${req.json?.item?.id}`, { status: 'Rechazada', note: 'Nota editada' });
  check('caja chica: rechazar con nota', rej.json?.item?.status === 'Rechazada' && rej.json.item.resolutionNote === 'Nota editada', rej.text.slice(0, 200));
  // Etapa 8b: Configuración (usuarios en consultas fijas + último login, Deshacer, validación de claves).
  const pendMail = `smoke-pend-${Date.now()}@test.local`;
  const pendNew = await call('POST', '/api/allowed-users', { email: pendMail, nombre: 'Pend', defaultRole: 'Consulta', status: 'Pendiente', sites: ['NFPT'], defaultSiteCode: 'NFPT' });
  check('alta de usuario pendiente', pendNew.status === 200, pendNew.text.slice(0, 200));
  const allowedList = await call('GET', '/api/allowed-users');
  const pendRow = allowedList.json?.items?.find(item => item.email === pendMail);
  check('usuarios: sedes en lote + lastLoginAt (LEFT JOIN)', allowedList.status === 200 && pendRow?.sites?.some(site => site.siteCode === 'NFPT') && 'lastLoginAt' in (pendRow || {}) && allowedList.json.items.find(item => item.email === email)?.sites?.length >= 1, allowedList.text.slice(0, 200));
  const approve = await call('POST', `/api/allowed-users/${pendRow?.id}/approve`, {});
  const undoApprove = await call('POST', `/api/allowed-users/${pendRow?.id}/undo`, { status: 'Pendiente' });
  const afterUndoUser = (await call('GET', '/api/allowed-users')).json.items.find(item => item.email === pendMail);
  check('usuarios: aprobar y deshacer (cancela el mail)', approve.status === 200 && undoApprove.json?.mailCancelled === true && afterUndoUser?.status === 'Pendiente', undoApprove.text.slice(0, 200));
  await call('POST', `/api/allowed-users/${pendRow?.id}/delete`, {});
  const undoDelete = await call('POST', `/api/allowed-users/${pendRow?.id}/undo`, { status: 'Pendiente' });
  check('usuarios: deshacer un borrado', undoDelete.status === 200 && (await call('GET', '/api/allowed-users')).json.items.some(item => item.email === pendMail), undoDelete.text.slice(0, 200));
  const badRoles = await call('PATCH', '/api/site-settings', { settings: { 'roles.config': [{ name: 'Sin admin', admin: false }] } });
  const badModules = await call('PATCH', '/api/site-settings', { settings: { 'modules.enabled': 'devices' } });
  check('site-settings valida claves conocidas (400)', badRoles.status === 400 && badModules.status === 400, `${badRoles.text.slice(0, 100)} ${badModules.text.slice(0, 100)}`);
  const goodKey = await call('PATCH', '/api/site-settings', { settings: { 'shift.options': ['Sin turno', 'Mañana'] } });
  check('site-settings guarda una clave válida', goodKey.status === 200 && goodKey.json?.settings?.['shift.options']?.length === 2, goodKey.text.slice(0, 200));

  // Errores de SQL en el log del server.
  const sqlErrors = serverLog.split('\n').filter(line => /syntax error|does not exist|operator does not|invalid input|ERROR:/i.test(line));
  check('sin errores de SQL en el log', !sqlErrors.length, sqlErrors.slice(0, 5).join(' | '));
} catch (error) {
  check('excepción del smoke test', false, String(error?.stack || error));
} finally {
  await db.end().catch(() => undefined);
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill();
  await exited;
  for (let i = 0; i < 20; i += 1) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); break; } catch { await new Promise(resolve => setTimeout(resolve, 150)); }
  }
  const failed = results.filter(item => !item.ok);
  for (const item of results) console.log(`${item.ok ? 'OK  ' : 'FALLA'} ${item.name}${item.ok ? '' : `\n      ${item.detail}`}`);
  console.log(`\n${results.length - failed.length}/${results.length} OK${withAi ? '' : ' (sin el chat real del asistente: PG_SMOKE_AI=1 lo suma)'}`);
  process.exitCode = failed.length ? 1 : 0;
}
