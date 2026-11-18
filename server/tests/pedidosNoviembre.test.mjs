// Tests de los pedidos de noviembre: devolver y prestar, préstamo con datos
// incompletos, lista de docentes y alumnos, confirmación con botón del
// Asistente y alta de tareas sin duplicados. Base SQLite temporal, sin IA real.
//   npm test
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'techasset-nov-'));
process.env.DATABASE_URL = '';
process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DB_PATH = path.join(tmpDir, 'test.db');
process.env.PRIVATE_DATA_DIR = path.join(tmpDir, 'private');
process.env.ANTHROPIC_API_KEY = '';
process.env.MODO_PRUEBA = 'true';

const { app } = await import('../app.js');
const { getDb, nowIso } = await import('../db.js');
const { config } = await import('../config.js');
const { createSession } = await import('../services/siteContext.service.js');
const { parseRosterText } = await import('../services/peopleRoster.service.js');
const { runAssistantTool } = await import('../services/assistant/chat.service.js');

let server;
let base;
const users = {};

function makeUser(email, role, site = 'NFPT') {
  const db = getDb();
  const ts = nowIso();
  db.prepare('INSERT INTO users (email, nombre, rol_global, activo, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)')
    .run(email, email.split('@')[0], 'Consulta', ts, ts);
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  db.prepare("INSERT INTO user_sites (user_id, site_code, site_role, turno, is_default, activo, created_at, updated_at) VALUES (?, ?, ?, 'Mañana', 1, 1, ?, ?)")
    .run(user.id, site, role, ts, ts);
  const { token } = createSession(user.id);
  return { id: user.id, email, nombre: user.nombre, cookie: `${config.sessionCookieName}=${token}` };
}

function addDevice(etiqueta, payload, site = 'NFPT') {
  getDb().prepare('INSERT INTO local_devices (etiqueta, payload, created_at, updated_at, site_code) VALUES (?, ?, ?, ?, ?)')
    .run(etiqueta, JSON.stringify({ etiqueta, ...payload }), nowIso(), nowIso(), site);
}

async function call(method, url, { cookie, json, site = 'NFPT' } = {}) {
  const headers = { Accept: 'application/json', 'X-Site-Code': site };
  if (cookie) headers.Cookie = cookie;
  let body;
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  const response = await fetch(base + url, { method, headers, body });
  return { status: response.status, data: await response.json() };
}

function loanEvents(etiqueta) {
  return getDb().prepare('SELECT tipo, persona, comentarios FROM loan_events WHERE etiqueta=? ORDER BY id').all(etiqueta);
}

before(async () => {
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api`;
  users.jefe = makeUser('jefe@colegio.test', 'Jefe TIC');
  users.consulta = makeUser('mira@colegio.test', 'Consulta');
  users.otraSede = makeUser('nd@colegio.test', 'Jefe TIC', 'NFND');
  addDevice('D0160', { filtro: 'Touch', numero: '14', dispositivo: 'Touch' });
  addDevice('D0161', { filtro: 'Touch', numero: '15', dispositivo: 'Touch' });
  addDevice('D0162', { filtro: 'Touch', numero: '16', dispositivo: 'Touch' });
  addDevice('D0163', { filtro: 'Touch', numero: '17', dispositivo: 'Touch' });
});

after(() => {
  server?.close();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows puede tener la base abierta */ }
});

describe('préstamo con datos incompletos', () => {
  test('sin persona ni comentario se rechaza con un mensaje claro', async () => {
    const res = await call('POST', '/loans/lend', { cookie: users.jefe.cookie, json: { etiqueta: 'D0161' } });
    assert.equal(res.status, 400);
    assert.match(res.data.error, /persona|comentario/i);
  });

  test('alcanza con un comentario: sin nombre, rol ni ubicación', async () => {
    const res = await call('POST', '/loans/lend', { cookie: users.jefe.cookie, json: { etiqueta: 'D0161', comment: 'Profe de 3.º año, notebook azul' } });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const events = loanEvents('D0161');
    assert.equal(events.at(-1).tipo, 'prestamo');
    assert.equal(events.at(-1).comentarios, 'Profe de 3.º año, notebook azul');
    const history = await call('GET', '/history/loans?etiqueta=D0161', { cookie: users.jefe.cookie });
    if (history.status === 200 && Array.isArray(history.data.items)) {
      assert.ok(history.data.items.some(item => item.comentarios === 'Profe de 3.º año, notebook azul'));
    }
  });

  test('con solo el nombre también alcanza', async () => {
    const res = await call('POST', '/loans/lend', { cookie: users.jefe.cookie, json: { etiqueta: 'D0162', person: 'Mili' } });
    assert.equal(res.status, 200, JSON.stringify(res.data));
  });
});

describe('devolver y prestar', () => {
  test('un equipo prestado a otra persona pasa al nuevo receptor en un paso, con dos movimientos', async () => {
    const lend = await call('POST', '/loans/lend', { cookie: users.jefe.cookie, json: { etiqueta: 'D0160', person: 'Asistente de la tarde', role: 'DOE' } });
    assert.equal(lend.status, 200);
    const relend = await call('POST', '/loans/relend', { cookie: users.jefe.cookie, json: { etiqueta: 'D0160', person: 'Juan Pérez', role: 'Alumno', comment: 'Lo vino a buscar al taller' } });
    assert.equal(relend.status, 200, JSON.stringify(relend.data));
    assert.match(relend.data.message, /devuelto por Asistente de la tarde y prestado a Juan Pérez/);
    const events = loanEvents('D0160');
    assert.deepEqual(events.map(event => event.tipo), ['prestamo', 'devolucion', 'prestamo']);
    assert.equal(events[1].persona, 'Asistente de la tarde');
    assert.equal(events[2].persona, 'Juan Pérez');
    const state = getDb().prepare('SELECT estado, prestado_a FROM local_states WHERE etiqueta=?').get('D0160');
    assert.equal(state.estado, 'Prestado');
    assert.equal(state.prestado_a, 'Juan Pérez');
  });

  test('si el equipo está disponible responde 409 y no registra nada', async () => {
    const before = loanEvents('D0163').length;
    const res = await call('POST', '/loans/relend', { cookie: users.jefe.cookie, json: { etiqueta: 'D0163', person: 'Ana' } });
    assert.equal(res.status, 409);
    assert.equal(loanEvents('D0163').length, before);
  });

  test('un rol de consulta no puede', async () => {
    const res = await call('POST', '/loans/relend', { cookie: users.consulta.cookie, json: { etiqueta: 'D0160', person: 'Ana' } });
    assert.equal(res.status, 403);
  });
});

describe('lista de docentes y alumnos', () => {
  test('el texto pegado se entiende con títulos, cursos al lado y viñetas', () => {
    const people = parseRosterText('Alumnos 3S:\n- Pérez, Juan\nGómez, Ana (2F)\n\nDocentes:\nLaura Fernández - 4N\n1. Carlos Ruiz', { defaultTipo: 'alumno' });
    assert.deepEqual(people, [
      { nombre: 'Pérez, Juan', tipo: 'alumno', curso: '3S' },
      { nombre: 'Gómez, Ana', tipo: 'alumno', curso: '2F' },
      { nombre: 'Laura Fernández', tipo: 'docente', curso: '4N' },
      { nombre: 'Carlos Ruiz', tipo: 'docente', curso: '' }
    ]);
  });

  test('se carga, se sugiere por apellido aunque nunca haya tenido un préstamo, y es por sede', async () => {
    const imported = await call('POST', '/people-roster/import', { cookie: users.jefe.cookie, json: { text: '3S:\nZárate, Valentina\nZabala, Tomás', tipo: 'alumno', mode: 'agregar' } });
    assert.equal(imported.status, 200, JSON.stringify(imported.data));
    assert.equal(imported.data.added, 2);
    const suggest = await call('GET', '/loans/suggest?q=zarate', { cookie: users.jefe.cookie });
    const valentina = suggest.data.suggestions.find(item => item.persona === 'Zárate, Valentina');
    assert.ok(valentina, JSON.stringify(suggest.data));
    assert.equal(valentina.source, 'lista');
    assert.equal(valentina.curso, '3S');
    assert.equal(valentina.rol, 'Alumno');
    const otherSite = await call('GET', '/loans/suggest?q=zarate', { cookie: users.otraSede.cookie, site: 'NFND' });
    assert.equal(otherSite.data.suggestions.length, 0);
    const photo = await call('GET', '/photo-passes/suggest?field=alumno&q=zab', { cookie: users.jefe.cookie });
    assert.ok(photo.data.items.some(item => item.nombre === 'Zabala, Tomás' && item.curso === '3S'), JSON.stringify(photo.data));
  });

  test('cargar dos veces la misma persona no la duplica; reemplazar borra solo ese tipo', async () => {
    await call('POST', '/people-roster/import', { cookie: users.jefe.cookie, json: { text: 'Docentes:\nLaura Fernández', tipo: 'alumno' } });
    const again = await call('POST', '/people-roster/import', { cookie: users.jefe.cookie, json: { text: 'Zárate, Valentina - 4S', tipo: 'alumno' } });
    assert.equal(again.data.added, 0);
    assert.equal(again.data.updated, 1);
    const replaced = await call('POST', '/people-roster/import', { cookie: users.jefe.cookie, json: { text: 'Nuevo, Alumno', tipo: 'alumno', mode: 'reemplazar', replaceTipo: 'alumno' } });
    assert.equal(replaced.data.alumnos, 1);
    assert.equal(replaced.data.docentes, 1);
  });

  test('un rol de consulta la lee pero no la cambia', async () => {
    assert.equal((await call('GET', '/people-roster', { cookie: users.consulta.cookie })).status, 200);
    assert.equal((await call('POST', '/people-roster/import', { cookie: users.consulta.cookie, json: { text: 'X Y' } })).status, 403);
  });
});

describe('Asistente: préstamos con botón para confirmar', () => {
  const access = () => ({ siteCode: 'NFPT', role: 'Jefe TIC', canEdit: true, user: { id: users.jefe.id, email: users.jefe.email, nombre: 'jefe' } });

  test('registrar_prestamo no escribe nada: prepara la acción para el botón', async () => {
    const before = loanEvents('D0163').length;
    const result = await runAssistantTool('registrar_prestamo', { codigo_dispositivo: 'D0163', usuario_nombre: 'Ana Gómez', rol: 'Alumno' }, access());
    assert.equal(result.ok, true);
    assert.equal(result.pendiente_confirmacion, true);
    assert.equal(result.accion.type, 'lend');
    assert.equal(loanEvents('D0163').length, before);

    const confirm = await call('POST', '/asistente/confirmar', { cookie: users.jefe.cookie, json: { action: { type: result.accion.type, payload: result.accion.payload } } });
    assert.equal(confirm.status, 200, JSON.stringify(confirm.data));
    assert.equal(loanEvents('D0163').at(-1).persona, 'Ana Gómez');
  });

  test('confirmar dos veces el mismo préstamo no lo duplica (el equipo ya no está disponible)', async () => {
    const result = await runAssistantTool('registrar_devolucion', { codigo_dispositivo: 'D0163' }, access());
    assert.equal(result.accion.type, 'return');
    const payload = { type: 'lend', payload: { codigo_dispositivo: 'D0163', usuario_nombre: 'Otra' } };
    const res = await call('POST', '/asistente/confirmar', { cookie: users.jefe.cookie, json: { action: payload } });
    assert.equal(res.status, 400);
  });

  test('un rol de consulta no puede confirmar', async () => {
    const res = await call('POST', '/asistente/confirmar', { cookie: users.consulta.cookie, json: { action: { type: 'return', payload: { codigo_dispositivo: 'D0163' } } } });
    assert.equal(res.status, 403);
  });

  test('cargar_lista_personas toma la lista del mensaje y el pedido se vuelve título', async () => {
    const message = 'cargá esta lista de alumnos de 5N:\nRomero, Lucas\nSosa, Martina\nTorres, Bruno';
    const result = await runAssistantTool('cargar_lista_personas', { tipo: 'alumno' }, access(), { lastUserMessage: message });
    assert.equal(result.entendidas, 3, JSON.stringify(result));
    assert.match(result.ejemplo, /Romero, Lucas \(5N\)/);
    const confirm = await call('POST', '/asistente/confirmar', { cookie: users.jefe.cookie, json: { action: { type: 'roster', payload: result.accion.payload } } });
    assert.equal(confirm.status, 200, JSON.stringify(confirm.data));
    const found = await call('GET', '/people-roster?q=sosa', { cookie: users.jefe.cookie });
    assert.equal(found.data.items[0].curso, '5N');
  });
});

describe('tareas', () => {
  test('dos altas iguales seguidas (doble toque en Guardar) crean una sola tarea', async () => {
    const task = { titulo: 'Revisar proyector 2S', descripcion: 'No prende', operator: 'jefe', prioridad: 'Media' };
    const [a, b] = await Promise.all([
      call('POST', '/tasks', { cookie: users.jefe.cookie, json: task }),
      call('POST', '/tasks', { cookie: users.jefe.cookie, json: task })
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(a.data.item.id, b.data.item.id);
    const count = getDb().prepare("SELECT COUNT(*) AS n FROM tasks WHERE titulo='Revisar proyector 2S' AND eliminada=0").get().n;
    assert.equal(count, 1);
  });
});
