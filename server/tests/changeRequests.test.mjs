// Tests de integración de «Pedidos de cambios», con la IA simulada.
// Corren contra la app real (server/app.js) sobre una base SQLite temporal:
//   npm test
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Antes de importar la app: base temporal, nada de Postgres ni IA real.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'techasset-requests-'));
process.env.DATABASE_URL = '';
process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DB_PATH = path.join(tmpDir, 'test.db');
process.env.PRIVATE_DATA_DIR = path.join(tmpDir, 'private');
process.env.ANTHROPIC_API_KEY = '';
process.env.REQUESTS_ADMIN_PASSWORD = 'clave-de-prueba';
process.env.MODO_PRUEBA = 'true';

const { app } = await import('../app.js');
const { getDb, nowIso } = await import('../db.js');
const { config } = await import('../config.js');
const { createSession, invalidateSessionCache } = await import('../services/siteContext.service.js');
const { interviewer } = await import('../services/requestInterviewer.service.js');
const { resetRequestRateLimits } = await import('../routes/changeRequests.routes.js');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4d60000000049454e44ae426082', 'hex');

let server;
let base;
let adminCookie = '';
const users = {};

function makeUser(email) {
  const db = getDb();
  const ts = nowIso();
  db.prepare('INSERT INTO users (email, nombre, rol_global, activo, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)')
    .run(email, email.split('@')[0], 'Consulta', ts, ts);
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  db.prepare("INSERT INTO user_sites (user_id, site_code, site_role, turno, is_default, activo, created_at, updated_at) VALUES (?, 'NFPT', 'Consulta', 'Mañana', 1, 1, ?, ?)")
    .run(user.id, ts, ts);
  const { token } = createSession(user.id);
  return { id: user.id, email, cookie: `${config.sessionCookieName}=${token}` };
}

async function call(method, url, { cookie, json, form } = {}) {
  const headers = { Accept: 'application/json', 'X-Site-Code': 'NFPT' };
  if (cookie) headers.Cookie = cookie;
  let body;
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  const response = await fetch(base + url, { method, headers, body });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  return { status: response.status, data, headers: response.headers };
}

function messageForm(text, files = []) {
  const form = new FormData();
  if (text !== undefined) form.append('text', text);
  for (const file of files) form.append('file', new Blob([file.buffer], { type: file.type || 'image/png' }), file.name || 'captura.png');
  return form;
}

function fakeReply(overrides = {}) {
  return {
    reply: '¿En qué pantalla te pasa?',
    ready: false,
    summary: { kind: 'fix', title: 'El buscador no encuentra Touch 34', screen: 'Dispositivos → Buscador', today: 'No aparece', desired: 'Que aparezca', details: ['Probar con "touch34"'] },
    ...overrides
  };
}

before(async () => {
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api`;
  users.ana = makeUser('ana@colegio.test');
  users.beto = makeUser('beto@colegio.test');
  users.caro = makeUser('caro@colegio.test');
  const login = await call('POST', '/admin/login', { json: { password: 'clave-de-prueba' } });
  assert.equal(login.status, 200);
  adminCookie = login.headers.get('set-cookie').split(';')[0];
});

after(() => {
  server?.close();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows puede tener la base abierta */ }
});

beforeEach(() => {
  resetRequestRateLimits();
  interviewer.run = async () => fakeReply();
});

async function newRequestWithMessage(user, text = 'El buscador no encuentra la Touch 34') {
  const created = await call('POST', '/requests', { cookie: user.cookie });
  const id = created.data.item.id;
  const sent = await call('POST', `/requests/${id}/messages`, { cookie: user.cookie, form: messageForm(text) });
  assert.equal(sent.status, 200);
  return id;
}

describe('permiso', () => {
  test('cualquier cuenta con sesión entra, aunque su rol sea de consulta', async () => {
    const res = await call('GET', '/requests', { cookie: users.caro.cookie });
    assert.equal(res.status, 200);
  });

  test('sin sesión responde 401', async () => {
    const res = await call('GET', '/requests');
    assert.equal(res.status, 401);
  });

  test('contraseña de admin incorrecta', async () => {
    const res = await call('POST', '/admin/login', { json: { password: 'otra' } });
    assert.equal(res.status, 401);
  });
});

describe('borrador', () => {
  test('abrir dos veces devuelve el mismo borrador vacío con el saludo', async () => {
    const first = await call('POST', '/requests', { cookie: users.beto.cookie });
    const second = await call('POST', '/requests', { cookie: users.beto.cookie });
    assert.equal(first.data.item.id, second.data.item.id);
    assert.equal(first.data.item.status, 'draft');
    assert.equal(first.data.item.messages.length, 1);
    assert.equal(first.data.item.messages[0].role, 'assistant');
    assert.match(first.data.item.messages[0].text, /^¡Hola! Contame/);
    // El borrador sin escribir no aparece en la lista.
    const list = await call('GET', '/requests', { cookie: users.beto.cookie });
    assert.ok(!list.data.items.some(item => item.id === first.data.item.id));
  });
});

describe('mensajes y capturas', () => {
  test('guarda el mensaje con capturas sin esperar a la IA, y la captura se sirve al dueño', async () => {
    let calls = 0;
    interviewer.run = async () => { calls += 1; return fakeReply(); };
    const { data } = await call('POST', '/requests', { cookie: users.ana.cookie });
    const id = data.item.id;
    const res = await call('POST', `/requests/${id}/messages`, { cookie: users.ana.cookie, form: messageForm('Mirá esto', [{ buffer: PNG, name: '../../pantalla<1>.png' }]) });
    assert.equal(res.status, 200);
    assert.equal(calls, 0);
    assert.equal(res.data.item.awaitingReply, true);
    const [image] = res.data.item.images;
    assert.equal(image.mime, 'image/png');
    assert.equal(image.name, 'pantalla1.png');
    assert.equal(res.data.item.messages.at(-1).imageIds[0], image.id);
    assert.equal(res.data.item.images[0].key, undefined);

    const img = await call('GET', `/requests/${id}/images/${image.id}`, { cookie: users.ana.cookie });
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.match(img.headers.get('cache-control'), /private/);
    assert.ok(img.data.equals(PNG));
  });

  test('rechaza lo que no es imagen aunque diga image/png', async () => {
    const { data } = await call('POST', '/requests', { cookie: users.ana.cookie });
    const res = await call('POST', `/requests/${data.item.id}/messages`, { cookie: users.ana.cookie, form: messageForm('hola', [{ buffer: Buffer.from('<script>alert(1)</script>xxxxxxxx'), name: 'x.png' }]) });
    assert.equal(res.status, 400);
    assert.match(res.data.error, /JPG, PNG o WEBP/);
  });

  test('límites: texto, capturas por mensaje, por pedido y mensaje vacío', async () => {
    const { data } = await call('POST', '/requests', { cookie: users.ana.cookie });
    const id = data.item.id;
    const png = { buffer: PNG };
    assert.equal((await call('POST', `/requests/${id}/messages`, { cookie: users.ana.cookie, form: messageForm('x'.repeat(4001)) })).status, 400);
    assert.equal((await call('POST', `/requests/${id}/messages`, { cookie: users.ana.cookie, form: messageForm('') })).status, 400);
    assert.equal((await call('POST', `/requests/${id}/messages`, { cookie: users.ana.cookie, form: messageForm('cuatro', [png, png, png, png]) })).status, 400);
    assert.equal((await call('POST', `/requests/${id}/messages`, { cookie: users.ana.cookie, form: messageForm('tres', [png, png, png]) })).status, 200);
    assert.equal((await call('POST', `/requests/${id}/messages`, { cookie: users.ana.cookie, form: messageForm('tres más', [png, png, png]) })).status, 200);
    const seventh = await call('POST', `/requests/${id}/messages`, { cookie: users.ana.cookie, form: messageForm('una más', [png]) });
    assert.equal(seventh.status, 400);
    assert.match(seventh.data.error, /hasta 6 capturas/);
  });

  test('tope de 40 mensajes por conversación', async () => {
    const { data } = await call('POST', '/requests', { cookie: users.beto.cookie });
    const id = data.item.id;
    const messages = [{ role: 'assistant', text: 'hola', imageIds: [], at: nowIso() }];
    for (let i = 1; i < 40; i++) messages.push({ role: i % 2 ? 'user' : 'assistant', text: `m${i}`, imageIds: [], at: nowIso() });
    getDb().prepare('UPDATE change_requests SET messages_json=? WHERE id=?').run(JSON.stringify(messages), id);
    const res = await call('POST', `/requests/${id}/messages`, { cookie: users.beto.cookie, form: messageForm('otra') });
    assert.equal(res.status, 409);
    assert.match(res.data.error, /enviá el pedido como está/);
  });

  test('límite de frecuencia de mensajes', async () => {
    const id = await newRequestWithMessage(users.beto);
    let last;
    for (let i = 0; i < 60; i++) last = await call('POST', `/requests/${id}/messages`, { cookie: users.beto.cookie, form: messageForm(`m${i}`) });
    assert.equal(last.status, 429);
  });
});

describe('respuesta de la IA', () => {
  test('responde, actualiza resumen, título y ready; si el último ya es de la IA no hace nada', async () => {
    let calls = 0;
    let seen;
    interviewer.run = async input => { calls += 1; seen = input; return fakeReply({ ready: true, reply: 'Listo, revisá el resumen.' }); };
    const id = await newRequestWithMessage(users.ana);
    const res = await call('POST', `/requests/${id}/reply`, { cookie: users.ana.cookie });
    assert.equal(res.status, 200);
    assert.equal(res.data.item.messages.at(-1).text, 'Listo, revisá el resumen.');
    assert.equal(res.data.item.ready, true);
    assert.equal(res.data.item.title, 'El buscador no encuentra Touch 34');
    assert.equal(res.data.item.summary.screen, 'Dispositivos → Buscador');
    assert.equal(res.data.item.awaitingReply, false);
    assert.equal(seen.messages.at(-1).text, 'El buscador no encuentra la Touch 34');
    const again = await call('POST', `/requests/${id}/reply`, { cookie: users.ana.cookie });
    assert.equal(again.status, 200);
    assert.equal(calls, 1);
  });

  test('si la IA falla el mensaje queda y se puede reintentar', async () => {
    interviewer.run = async () => { throw new Error('timeout'); };
    const id = await newRequestWithMessage(users.ana);
    const failed = await call('POST', `/requests/${id}/reply`, { cookie: users.ana.cookie });
    assert.equal(failed.status, 502);
    assert.match(failed.data.error, /Reintentar/);
    const view = await call('GET', `/requests/${id}`, { cookie: users.ana.cookie });
    assert.equal(view.data.item.awaitingReply, true);
    assert.equal(view.data.item.messages.at(-1).role, 'user');

    interviewer.run = async () => fakeReply();
    const retried = await call('POST', `/requests/${id}/reply`, { cookie: users.ana.cookie });
    assert.equal(retried.status, 200);
    assert.equal(retried.data.item.messages.at(-1).role, 'assistant');
  });

  test('dos respuestas a la vez llaman a la IA una sola vez', async () => {
    let calls = 0;
    interviewer.run = async () => { calls += 1; await new Promise(resolve => setTimeout(resolve, 50)); return fakeReply(); };
    const id = await newRequestWithMessage(users.ana);
    const [a, b] = await Promise.all([
      call('POST', `/requests/${id}/reply`, { cookie: users.ana.cookie }),
      call('POST', `/requests/${id}/reply`, { cookie: users.ana.cookie })
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(calls, 1);
    assert.equal(a.data.item.messages.filter(m => m.role === 'assistant').length, 2);
  });

  test('la IA de verdad limpia la salida: tipo raro, título vacío, largos', async () => {
    const { cleanInterview } = await import('../services/requestInterviewer.service.js');
    const clean = cleanInterview({ reply: 'ok', ready: 1, summary: { kind: 'otro', title: '', details: Array(9).fill('punto') , screen: 'x'.repeat(500) } });
    assert.equal(clean.summary.kind, 'change');
    assert.equal(clean.summary.title, 'Pedido sin título');
    assert.equal(clean.summary.details.length, 6);
    assert.equal(clean.summary.screen.length, 200);
    assert.equal(clean.ready, true);
  });

  test('la conversación va como bloques con las capturas en su lugar', async () => {
    const { buildInterviewContent } = await import('../services/requestInterviewer.service.js');
    const content = buildInterviewContent([
      { role: 'assistant', text: 'Hola', imageIds: [] },
      { role: 'user', text: 'Mirá', imageIds: ['falta'] }
    ], []);
    assert.equal(content[1].text, 'VOS (asistente): Hola');
    assert.equal(content[2].text, 'USUARIO: Mirá');
    assert.equal(content[3].text, '(adjuntó una captura que no se incluye acá)');
    assert.equal(content.at(-1).text, 'Respondé al último mensaje y actualizá el resumen.');
  });
});

describe('enviar, cancelar y borrar', () => {
  test('no se puede enviar sin haber escrito', async () => {
    const { data } = await call('POST', '/requests', { cookie: users.beto.cookie });
    const res = await call('POST', `/requests/${data.item.id}/submit`, { cookie: users.beto.cookie });
    assert.equal(res.status, 400);
  });

  test('enviar pasa a pending, se puede seguir charlando, y cancelar lo descarta', async () => {
    const id = await newRequestWithMessage(users.ana);
    const sent = await call('POST', `/requests/${id}/submit`, { cookie: users.ana.cookie });
    assert.equal(sent.status, 200);
    assert.equal(sent.data.item.status, 'pending');
    assert.ok(sent.data.item.submittedAt);
    assert.equal((await call('POST', `/requests/${id}/submit`, { cookie: users.ana.cookie })).status, 409);
    assert.equal((await call('POST', `/requests/${id}/messages`, { cookie: users.ana.cookie, form: messageForm('me olvidé algo') })).status, 200);
    assert.equal((await call('POST', `/requests/${id}/reply`, { cookie: users.ana.cookie })).status, 200);
    // Un enviado no se borra: se cancela.
    assert.equal((await call('DELETE', `/requests/${id}`, { cookie: users.ana.cookie })).status, 409);
    const withdrawn = await call('POST', `/requests/${id}/withdraw`, { cookie: users.ana.cookie });
    assert.equal(withdrawn.data.item.status, 'discarded');
    assert.equal(withdrawn.data.item.note, 'Cancelado por el usuario');
    assert.ok(withdrawn.data.item.resolvedAt);
    const closed = await call('POST', `/requests/${id}/messages`, { cookie: users.ana.cookie, form: messageForm('hola?') });
    assert.equal(closed.status, 409);
    assert.equal(closed.data.error, 'Este pedido ya está cerrado. Si querés sumar algo, empezá uno nuevo.');
    const audit = getDb().prepare("SELECT COUNT(*) AS n FROM local_movements WHERE tipo='pedido' AND descripcion LIKE 'Pedido de cambios enviado%'").get();
    assert.ok(audit.n >= 1);
  });

  test('borrar un borrador borra también sus capturas', async () => {
    const { data } = await call('POST', '/requests', { cookie: users.beto.cookie });
    const id = data.item.id;
    await call('POST', `/requests/${id}/messages`, { cookie: users.beto.cookie, form: messageForm('con foto', [{ buffer: PNG }]) });
    const row = getDb().prepare('SELECT images_json FROM change_requests WHERE id=?').get(id);
    const [image] = JSON.parse(row.images_json);
    const file = path.join(config.privateDataDir, image.key);
    assert.ok(fs.existsSync(file));
    const res = await call('DELETE', `/requests/${id}`, { cookie: users.beto.cookie });
    assert.equal(res.status, 200);
    assert.ok(!fs.existsSync(file));
    assert.equal((await call('GET', `/requests/${id}`, { cookie: users.beto.cookie })).status, 404);
  });
});

describe('admin', () => {
  test('lista pendientes y en curso con quién lo pidió, cambia estado y nota, sirve la captura', async () => {
    const { data } = await call('POST', '/requests', { cookie: users.ana.cookie });
    const id = data.item.id;
    const withImage = await call('POST', `/requests/${id}/messages`, { cookie: users.ana.cookie, form: messageForm('Mirá', [{ buffer: PNG }]) });
    const imageId = withImage.data.item.images[0].id;
    // Un borrador no se ve nunca.
    assert.equal((await call('GET', `/admin/requests/${id}`, { cookie: adminCookie })).status, 404);
    assert.equal((await call('PATCH', `/admin/requests/${id}`, { cookie: adminCookie, json: { status: 'done' } })).status, 404);
    await call('POST', `/requests/${id}/submit`, { cookie: users.ana.cookie });

    const list = await call('GET', '/admin/requests', { cookie: adminCookie });
    assert.equal(list.status, 200);
    const item = list.data.items.find(entry => entry.id === id);
    assert.equal(item.requester.email, 'ana@colegio.test');
    assert.ok(list.data.items.every(entry => ['pending', 'in_progress'].includes(entry.status)));

    const progress = await call('PATCH', `/admin/requests/${id}`, { cookie: adminCookie, json: { status: 'in_progress' } });
    assert.equal(progress.data.item.status, 'in_progress');
    assert.equal(progress.data.item.resolvedAt, '');
    // En curso ya no se charla.
    assert.equal((await call('POST', `/requests/${id}/messages`, { cookie: users.ana.cookie, form: messageForm('?') })).status, 409);
    assert.equal((await call('POST', `/requests/${id}/withdraw`, { cookie: users.ana.cookie })).status, 409);

    const done = await call('PATCH', `/admin/requests/${id}`, { cookie: adminCookie, json: { status: 'done', note: 'Listo: ahora lo encontrás en Dispositivos.' } });
    assert.equal(done.data.item.status, 'done');
    assert.ok(done.data.item.resolvedAt);
    const mine = await call('GET', `/requests/${id}`, { cookie: users.ana.cookie });
    assert.equal(mine.data.item.note, 'Listo: ahora lo encontrás en Dispositivos.');

    assert.ok(!(await call('GET', '/admin/requests', { cookie: adminCookie })).data.items.some(entry => entry.id === id));
    assert.ok((await call('GET', '/admin/requests?status=all', { cookie: adminCookie })).data.items.some(entry => entry.id === id));
    assert.equal((await call('PATCH', `/admin/requests/${id}`, { cookie: adminCookie, json: { status: 'draft' } })).status, 400);

    const img = await call('GET', `/admin/requests/${id}/images/${imageId}`, { cookie: adminCookie });
    assert.equal(img.status, 200);
    assert.ok(img.data.equals(PNG));
    assert.equal((await call('GET', `/admin/requests/${id}/images/${imageId}`)).status, 401);
  });

  test('un Superadmin logueado también entra a la API de admin', async () => {
    const boss = makeUser('jefa@colegio.test');
    getDb().prepare("UPDATE users SET rol_global='Superadmin' WHERE id=?").run(boss.id);
    invalidateSessionCache();
    assert.equal((await call('GET', '/admin/requests', { cookie: boss.cookie })).status, 200);
  });
});

describe('aislamiento entre usuarios', () => {
  test('un usuario no ve, no escribe ni baja capturas de pedidos de otro (404 igual que inexistente)', async () => {
    const { data } = await call('POST', '/requests', { cookie: users.ana.cookie });
    const id = data.item.id;
    const sent = await call('POST', `/requests/${id}/messages`, { cookie: users.ana.cookie, form: messageForm('privado', [{ buffer: PNG }]) });
    const imageId = sent.data.item.images[0].id;

    const missing = await call('GET', '/requests/no-existe', { cookie: users.beto.cookie });
    const foreign = await call('GET', `/requests/${id}`, { cookie: users.beto.cookie });
    assert.equal(foreign.status, 404);
    assert.deepEqual(foreign.data, missing.data);
    for (const [method, url, opts] of [
      ['POST', `/requests/${id}/messages`, { form: messageForm('hack') }],
      ['POST', `/requests/${id}/reply`, {}],
      ['POST', `/requests/${id}/submit`, {}],
      ['POST', `/requests/${id}/withdraw`, {}],
      ['DELETE', `/requests/${id}`, {}],
      ['GET', `/requests/${id}/images/${imageId}`, {}]
    ]) {
      const res = await call(method, url, { cookie: users.beto.cookie, ...opts });
      assert.equal(res.status, 404, `${method} ${url}`);
    }
    const list = await call('GET', '/requests', { cookie: users.beto.cookie });
    assert.ok(!list.data.items.some(item => item.id === id));
    // Y la captura tampoco sale por el estático de /uploads.
    const statico = await fetch(`${base.replace('/api', '')}/uploads/requests/${users.ana.id}/${imageId}.png`, { headers: { Cookie: users.beto.cookie } });
    assert.notEqual(statico.status, 200);
  });
});
