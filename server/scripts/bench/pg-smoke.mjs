// Smoke test contra un Postgres REAL (no SQLite): levanta el server en modo
// Postgres, siembra datos mínimos por la API y recorre los endpoints. Sirve para
// atrapar SQL que SQLite acepta y Postgres no (pg-sync traduce la API, no el SQL).
//
//   docker run -d --rm --name techasset-pgtest -e POSTGRES_PASSWORD=pgtest -e POSTGRES_DB=techasset -p 127.0.0.1:55432:5432 postgres:17-alpine
//   PG_TEST_URL="postgresql://postgres:pgtest@127.0.0.1:55432/techasset?sslmode=disable" node server/scripts/bench/pg-smoke.mjs
//
// NUNCA apuntarlo a producción: crea usuarios, sesiones, equipos y movimientos.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const url = process.env.PG_TEST_URL;
if (!url || /supabase|pooler|amazonaws/i.test(url)) {
  console.error('PG_TEST_URL tiene que ser un Postgres local de pruebas (nunca el de producción).');
  process.exit(2);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = 8061;
const base = `http://127.0.0.1:${PORT}`;
const results = [];
let serverLog = '';

const child = spawn(process.execPath, ['server/index.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), DATABASE_URL: url, DB_DRIVER: 'postgres', MODO_PRUEBA: 'true', SMTP_SERVER: '', SMTP_USER: '', SMTP_APP_PASSWORD: '', RESEND_API_KEY: '', GOOGLE_SHEET_CSV_URL: '', BOOTSTRAP_SITES: 'NFPT:Northfield Puertos,NFND:Northfield Nordelta', DEFAULT_SITE_CODE: 'NFPT' },
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
  const returnBatch = await call('POST', '/api/loans/return-batch', { etiquetas: ['D9001', 'D9002', 'D9003'] });
  check('devolver en lote', returnBatch.json?.done === 3, returnBatch.text.slice(0, 200));
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

  // Agenda (subconsulta del conteo), tareas, cierre del día, notificaciones.
  const agendaNew = await call('POST', '/api/agenda', { dia: 'Sábado', turno: 'Mañana', desde: '08:00', hasta: '09:00', curso: '5F', actividad: 'Prueba', tipoDispositivo: 'Touch', cantidad: 1, estado: 'Pendiente' });
  check('alta agenda', agendaNew.status === 200, agendaNew.text.slice(0, 200));
  const agenda = await call('GET', '/api/agenda');
  check('GET /agenda (conteo en subconsulta)', agenda.status === 200 && Array.isArray(agenda.json.items) && typeof agenda.json.olderHidden === 'number', agenda.text.slice(0, 200));
  check('GET /agenda?all=1', (await call('GET', '/api/agenda?all=1')).status === 200);
  for (const titulo of ['Tarea 1', 'Tarea 2']) await call('POST', '/api/tasks', { titulo, estado: 'Pendiente', responsables: ['Smoke'] });
  const tasks = await call('GET', '/api/tasks?space=team');
  check('GET /tasks', tasks.status === 200 && tasks.json.items.length >= 2, tasks.text.slice(0, 200));
  const analytics = await call('GET', '/api/tasks/analytics');
  check('GET /tasks/analytics (antes 500 con 2+ tareas)', analytics.status === 200, analytics.text.slice(0, 200));
  const closure = await call('GET', '/api/daily-closures/preview');
  check('GET /daily-closures/preview (antes caía con 2+ tareas)', closure.status === 200 && closure.json?.resumen, closure.text.slice(0, 200));
  const notifications = await call('GET', '/api/notifications');
  check('GET /notifications (subconsulta de no leídas)', notifications.status === 200 && typeof notifications.json.unread === 'number', notifications.text.slice(0, 200));
  check('GET /agenda/history (antes tapada por /agenda/:id)', (await call('GET', '/api/agenda/history')).status === 200);
  check('ruta /api inexistente da 404 JSON', (await call('GET', '/api/no-existe')).status === 404);

  // Login y links de contraseña (tabla nueva password_tokens).
  const bad = await call('POST', '/api/auth/login', { email: 'nadie@test.local', password: 'abcdef' }, { cookie: '' });
  check('login: mensaje genérico', bad.status === 401 && /incorrectos/.test(bad.json?.error || ''), bad.text.slice(0, 200));
  const link = await call('POST', '/api/auth/password/request', { email }, { cookie: '' });
  check('pedir link de contraseña (password_tokens)', link.status === 200, link.text.slice(0, 200));
  const confirm = await call('POST', '/api/auth/password/confirm', { token: 'x', password: 'abcdef' }, { cookie: '' });
  check('token inválido se rechaza', confirm.status === 400, confirm.text.slice(0, 200));

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
  const failed = results.filter(item => !item.ok);
  for (const item of results) console.log(`${item.ok ? 'OK  ' : 'FALLA'} ${item.name}${item.ok ? '' : `\n      ${item.detail}`}`);
  console.log(`\n${results.length - failed.length}/${results.length} OK`);
  process.exitCode = failed.length ? 1 : 0;
}
