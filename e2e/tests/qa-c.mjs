// qa-c) QA de lanzamiento, ronda 1 — frente C: Inicio (docs/redesign/qa/HALLAZGOS-1.md).
//
//   4  Devolver desde la lista no mueve lo que está bajo el puntero ni al
//      aparecer el aviso ni al irse: la fila devuelta se queda en su lugar con
//      su aviso (y el Deshacer) hasta que el usuario deja la lista, y recién
//      ahí se pliega suave. Doble clic a 250 ms sobre "Devolver" (el
//      impaciente): un solo POST, ningún Deshacer y ninguna ficha abierta.
//      El aviso de la barra va en un renglón fijo: aparecer o irse a los 8 s
//      no corre el resto del Inicio. Mobile (375, toque): el aviso queda a la
//      vista donde se tocó.
//   17 Mientras carga no aparecen "Sin actividades hoy", "Sin movimientos",
//      "No hay tareas abiertas" ni contadores en 0 (pedidos demorados 2 s);
//      volver al Inicio desde otra vista no vuelve a esqueletos (notas y
//      recreos demorados 3 s).
//   18 Una tarea que vence hoy dice "vence hoy" en el Inicio y "Vence hoy" en
//      el tablero (nunca "venció").
//   19 El título de la lista es neutro y no cambia ni salta con la pestaña.
//   26 Textos del Inicio: ayuda para prestar o devolver UNO, sin "afuera",
//      "marca varios equipos".
// Corre contra la copia de la base; lo que presta lo devuelve. Capturas en e2e/.out/qa-c/.
import fs from 'node:fs';
import path from 'node:path';
import { root, loanState } from '../lib/env.mjs';
import { assert, gotoView, openContext, sleep, until } from '../lib/browser.mjs';

const outDir = path.join(root, 'e2e', '.out', 'qa-c');
const AR = 'America/Argentina/Buenos_Aires';
const todayAr = () => new Intl.DateTimeFormat('en-CA', { timeZone: AR, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const MOBILE = {
  viewport: { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
};

/** Demora (o reemplaza) respuestas de la API según la URL. Devuelve el mapa para cambiarlo en vivo. */
async function intercept(page) {
  const rules = { delay: [], respond: [] };
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.isInterceptResolutionHandled?.()) return;
    const url = new URL(request.url());
    const target = `${url.pathname}${url.search}`;
    const answer = rules.respond.find(rule => request.method() === 'GET' && rule.rx.test(target));
    if (answer) {
      const reply = () => request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(answer.body()) }).catch(() => {});
      const wait = rules.delay.find(rule => rule.rx.test(target))?.ms || 0;
      if (wait) setTimeout(reply, wait); else void reply();
      return;
    }
    const delay = rules.delay.find(rule => request.method() === 'GET' && rule.rx.test(target));
    if (delay) setTimeout(() => request.continue().catch(() => {}), delay.ms);
    else request.continue().catch(() => {});
  });
  return rules;
}

/** Posición en pantalla de cada fila de la lista (por etiqueta). */
const rowTops = page => page.evaluate(() => Object.fromEntries(
  [...document.querySelectorAll('[data-dash="afuera"] .dash-rows > li')].map(li => [li.dataset.deviceTag, Math.round(li.getBoundingClientRect().top * 10) / 10])
));

const maxShift = (before, after) => {
  let max = 0;
  for (const [tag, top] of Object.entries(before)) if (tag in after) max = Math.max(max, Math.abs(after[tag] - top));
  return Math.round(max * 10) / 10;
};

export async function qaCTests({ browser, base, api, admin, releaseVersion, test, track = () => {} }) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const session = async (options = {}) => {
    const ctx = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width: 1366, height: 768 }, ...options });
    track(ctx.page);
    return ctx;
  };
  const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${name}.png`) }).catch(() => {});
  // Equipos libres lejos de los que usan las otras pruebas (functional usa los primeros, operación los últimos).
  const freeTags = async count => {
    const free = (await api.devices()).filter(device => loanState(device.estado) === 'available').map(device => device.etiqueta);
    const start = Math.max(0, Math.floor(free.length / 2) - count);
    return free.slice(start, start + count);
  };
  const lend = async (tag, person) => {
    const response = await api.post('/api/loans/lend', { etiqueta: tag, person, role: 'DOE', location: 'DOE' });
    assert(response.status < 300, `No se pudo prestar ${tag} por API (${response.status}).`);
    await sleep(30);
  };
  const giveBack = async tags => {
    for (const tag of tags) if (loanState((await api.device(tag))?.estado) === 'loaned') await api.post('/api/loans/return', { etiqueta: tag });
  };
  const posts = (page, rx) => {
    const seen = [];
    const onRequest = request => { if (request.method() === 'POST' && rx.test(new URL(request.url()).pathname)) seen.push(new URL(request.url()).pathname); };
    page.on('request', onRequest);
    return { seen, stop: () => page.off('request', onRequest) };
  };
  const openList = async (page, person) => {
    await gotoView(page, base, 'dashboard');
    await page.waitForSelector('[data-dash="afuera"] .dash-rows', { timeout: 20000 });
    await page.type('[data-dash="afuera"] .dash-list-search input', person);
    await until(() => page.$$eval('[data-dash="afuera"] .dash-rows > li', list => list.length >= 2), { message: `las filas de ${person}` });
    await sleep(700);
  };

  // ── 4. Lista: doble clic impaciente, el aviso en la fila, nada se mueve ────
  await test('qa-c', 'QA ronda 1 · Inicio', '4: devolver desde la lista no mueve lo que está bajo el puntero (doble clic a 250 ms, aviso en la fila, salida suave al dejar la lista)', async () => {
    const tags = await freeTags(3);
    assert(tags.length === 3, 'No hay tres equipos libres en la copia.');
    const person = 'QA-C Lista';
    for (const tag of tags) await lend(tag, person);
    const { context, page } = await session();
    const notes = [];
    try {
      await openList(page, person);
      const order = await page.$$eval('[data-dash="afuera"] .dash-rows > li', list => list.map(li => li.dataset.deviceTag));
      const [target, second] = order;
      const button = await page.$(`[data-device-tag="${target}"] .dash-row-act .ui-btn`);
      const box = await button.boundingBox();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      const before = await rowTops(page);
      const under = () => page.evaluate((px, py) => {
        const li = document.elementFromPoint(px, py)?.closest('[data-device-tag]');
        return li ? { tag: li.dataset.deviceTag, top: li.getBoundingClientRect().top, held: li.hasAttribute('data-held') } : null;
      }, x, y);
      const underBefore = await under();
      const returns = posts(page, /^\/api\/loans\/return/);
      const undos = posts(page, /^\/api\/loans\/undo/);
      await page.mouse.move(x, y);
      await page.mouse.down(); await page.mouse.up();
      await sleep(250);
      // El segundo clic del impaciente cae donde estaba "Devolver" (ahora el aviso de esa misma fila).
      await page.mouse.down(); await page.mouse.up();
      await page.waitForSelector(`[data-held][data-device-tag="${target}"] .ui-status`, { timeout: 5000 });
      await sleep(700);
      returns.stop(); undos.stop();
      const after = await rowTops(page);
      const underAfter = await under();
      const shift = maxShift(before, after);
      const opened = await page.$$eval('[data-dash="afuera"] .dash-row.is-open', list => list.length);
      assert(returns.seen.length === 1, `El doble clic mandó ${returns.seen.length} devoluciones.`);
      assert(undos.seen.length === 0, `El segundo clic cayó en el Deshacer (${undos.seen.length} requests).`);
      assert(!opened, 'El segundo clic abrió la ficha de otra fila.');
      assert(underAfter?.tag === underBefore?.tag && underAfter?.held, `Bajo el puntero quedó ${JSON.stringify(underAfter)} (antes ${JSON.stringify(underBefore)}).`);
      assert(shift <= 1, `Las filas se movieron ${shift} px al devolver (antes ${JSON.stringify(before)}, después ${JSON.stringify(after)}).`);
      assert(loanState((await api.device(target))?.estado) === 'available', `${target} no quedó devuelto.`);
      const status = await page.$eval(`[data-held][data-device-tag="${target}"] .ui-status`, el => {
        const r = el.getBoundingClientRect();
        const view = document.querySelector('.shell-scroll').getBoundingClientRect();
        return { text: el.textContent || '', inView: r.top >= view.top && r.bottom <= Math.min(view.bottom, window.innerHeight) };
      });
      assert(/devuelto/.test(status.text) && /Deshacer/.test(status.text), `Aviso en la fila: "${status.text}".`);
      assert(status.inView, 'El aviso de la fila quedó fuera de la vista.');
      notes.push(`doble clic: 1 POST, 0 Deshacer, filas ${shift}px`);
      await shot(page, '4-lista-aviso-en-la-fila-1366');

      // Con el mouse sobre la lista, pasado el Deshacer (8 s) la fila sigue: nada se mueve.
      await sleep(8600);
      const still = await rowTops(page);
      assert(await page.$(`[data-held][data-device-tag="${target}"]`), 'La fila devuelta se fue con el mouse todavía sobre la lista.');
      const stillShift = maxShift(before, still);
      assert(stillShift <= 1, `Con el mouse sobre la lista las filas se movieron ${stillShift} px.`);
      const expiredText = await page.$eval(`[data-held][data-device-tag="${target}"] .ui-status`, el => el.textContent || '');
      assert(!/Deshacer/.test(expiredText), 'El Deshacer siguió después de su cuenta.');

      // Sale de la lista: la fila se pliega suave (pasa por altos intermedios) y la de abajo sube.
      const heights = page.evaluate(tag => new Promise(resolve => {
        const out = [];
        const t0 = performance.now();
        const tick = () => {
          const li = document.querySelector(`[data-held][data-device-tag="${tag}"]`);
          out.push(li ? Math.round(li.getBoundingClientRect().height) : 0);
          if (performance.now() - t0 < 900) requestAnimationFrame(tick); else resolve(out);
        };
        requestAnimationFrame(tick);
      }), target);
      await page.mouse.move(20, 20);
      const samples = await heights;
      const start = samples[0];
      const mid = samples.filter(h => h > 2 && h < start - 2);
      assert(start > 20, `La fila retenida medía ${start} px.`);
      assert(mid.length >= 2, `La fila se fue de golpe (altos: ${samples.slice(0, 20).join(',')}).`);
      await until(async () => !(await page.$(`[data-held][data-device-tag="${target}"]`)), { timeout: 3000, message: 'que la fila devuelta se vaya al dejar la lista' });
      notes.push(`al dejar la lista se pliega en ${mid.length} cuadros intermedios`);

      // Deshacer desde la fila (pasados 500 ms): vuelve a estar prestado, el aviso sigue en la fila.
      const undoButton = await page.$(`[data-device-tag="${second}"] .dash-row-act .ui-btn`);
      await undoButton.click();
      const undo = await page.waitForSelector(`[data-held][data-device-tag="${second}"] .ui-status-undo`, { timeout: 5000 });
      await sleep(650);
      await undo.click();
      await until(async () => loanState((await api.device(second))?.estado) === 'loaned', { message: `${second} prestado otra vez por el Deshacer de la fila` });
      await until(() => page.$eval(`[data-held][data-device-tag="${second}"] .ui-status`, el => /Deshecho/.test(el.textContent || '')).catch(() => false), { message: 'el aviso "Deshecho" en la misma fila' });
      notes.push('Deshacer en la fila OK');
    } finally {
      await context.close();
      await giveBack(tags);
    }
    return notes.join(' · ');
  });

  for (const [width, options] of [[1366, {}], [375, { device: MOBILE }]]) await test('qa-c', 'QA ronda 1 · Inicio', `4: el aviso de la barra (prestado/devuelto · Deshacer) no corre el Inicio al aparecer ni a los 8 s al irse (${width} px)`, async () => {
    const [tag] = await freeTags(1);
    assert(tag, 'No hay un equipo libre en la copia.');
    await lend(tag, 'QA-C Barra');
    const { context, page } = await session(options);
    try {
      await gotoView(page, base, 'dashboard');
      await page.waitForSelector('[data-dash="afuera"] .dash-rows', { timeout: 20000 });
      await sleep(600);
      const tilesTop = () => page.$eval('.dash-tiles', el => el.getBoundingClientRect().top);
      const t0 = await tilesTop();
      const hint = await page.$eval('.dash-bar-note', el => el.textContent || '');
      assert(/prestarlo o devolverlo/.test(hint), `El renglón de la barra dice "${hint}".`);
      await page.type('input[data-dash-bar]', tag);
      await page.waitForSelector(`[data-device-result="${tag}"]`);
      await sleep(300);
      await page.keyboard.press('Enter');
      await page.waitForSelector('.dash-bar-note .ui-status-undo', { timeout: 5000 });
      await sleep(700);
      const t1 = await tilesTop();
      await shot(page, `4-barra-aviso-${width}`);
      // Muestra cuadro a cuadro alrededor de los 8 s (cuando el aviso se va).
      const frames = await page.evaluate(() => new Promise(resolve => {
        const el = document.querySelector('.dash-tiles');
        const top0 = el.getBoundingClientRect().top;
        let max = 0;
        const t0 = performance.now();
        const tick = () => {
          max = Math.max(max, Math.abs(el.getBoundingClientRect().top - top0));
          if (performance.now() - t0 < 9000 && document.querySelector('.dash-bar-note .ui-status')) requestAnimationFrame(tick);
          else setTimeout(() => { max = Math.max(max, Math.abs(el.getBoundingClientRect().top - top0)); resolve({ max, gone: !document.querySelector('.dash-bar-note .ui-status') }); }, 600);
        };
        requestAnimationFrame(tick);
      }));
      assert(Math.abs(t1 - t0) <= 1, `Con el aviso, los contadores bajaron ${Math.round(t1 - t0)} px.`);
      assert(frames.gone, 'El aviso de la barra no se fue a los 8 s.');
      assert(frames.max <= 1, `Al irse el aviso, los contadores se movieron ${Math.round(frames.max)} px.`);
      return `aparece: ${Math.round(t1 - t0)} px · se va: ${Math.round(frames.max)} px`;
    } finally {
      await context.close();
      await giveBack([tag]);
    }
  });

  await test('qa-c', 'QA ronda 1 · Inicio', '4: mobile 375 con toque: devolver desde una fila de abajo deja el aviso a la vista, en la fila, sin mover la de abajo', async () => {
    const tags = await freeTags(2);
    assert(tags.length === 2, 'No hay dos equipos libres en la copia.');
    const person = 'QA-C Movil';
    for (const tag of tags) await lend(tag, person);
    const { context, page } = await session({ device: MOBILE });
    try {
      await openList(page, person);
      const [target, second] = await page.$$eval('[data-dash="afuera"] .dash-rows > li', list => list.map(li => li.dataset.deviceTag));
      // La fila tocada, abajo de la pantalla (el pulgar).
      await page.evaluate(tag => {
        const li = document.querySelector(`[data-device-tag="${tag}"]`);
        const box = document.querySelector('.shell-scroll');
        box.scrollTop += li.getBoundingClientRect().bottom - (window.innerHeight - 130);
      }, target);
      await sleep(400);
      const before = await rowTops(page);
      const box = await (await page.$(`[data-device-tag="${target}"] .dash-row-act .ui-btn`)).boundingBox();
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForSelector(`[data-held][data-device-tag="${target}"] .ui-status`, { timeout: 5000 });
      await sleep(600);
      const after = await rowTops(page);
      const shift = maxShift(before, after);
      const view = await page.$eval(`[data-held][data-device-tag="${target}"] .ui-status`, el => {
        const r = el.getBoundingClientRect();
        const top = document.querySelector('.shell-scroll').getBoundingClientRect().top;
        const nav = document.querySelector('.shell-tabbar');
        const bottom = nav && nav.getBoundingClientRect().height ? nav.getBoundingClientRect().top : window.innerHeight;
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { inView: r.top >= top && r.bottom <= bottom, covered: !el.contains(hit) };
      });
      await shot(page, '4-mobile-aviso-en-la-fila-375');
      assert(shift <= 1, `Las filas se movieron ${shift} px al devolver en mobile (antes ${JSON.stringify(before)}, después ${JSON.stringify(after)}).`);
      assert(view.inView && !view.covered, `El aviso no quedó a la vista (${JSON.stringify(view)}).`);
      // Sin tocar más la lista, se va solo después del Deshacer + 1,5 s.
      await until(async () => !(await page.$(`[data-held][data-device-tag="${target}"]`)), { timeout: 13000, message: 'que la fila devuelta se vaya sola en mobile' });
      assert(await page.$(`[data-device-tag="${second}"]`), 'La otra fila desapareció.');
      return `filas ${shift}px · aviso a la vista y sin tapar`;
    } finally {
      await context.close();
      await giveBack(tags);
    }
  });

  // ── 17. Falso vacío mientras carga y vuelta al Inicio sin esqueletos ──────
  await test('qa-c', 'QA ronda 1 · Inicio', '17: mientras cargan los datos no aparece "Sin actividades/movimientos/tareas" ni contadores en 0; volver al Inicio no vuelve a esqueletos', async () => {
    const { context, page } = await session();
    try {
      const rules = await intercept(page);
      rules.delay.push({ rx: /^\/api\/(agenda|tasks|movements|devices)(\?|$)/, ms: 2000 });
      const answered = {};
      page.on('response', response => {
        const match = new URL(response.url()).pathname.match(/^\/api\/(agenda|tasks|movements|devices)$/);
        if (match && !answered[match[1]]) answered[match[1]] = Date.now();
      });
      await page.evaluateOnNewDocument(() => {
        window.__qaSamples = [];
        const tick = () => {
          const dash = document.querySelector('.dash');
          if (dash) {
            const text = dash.innerText || '';
            window.__qaSamples.push({
              t: Date.now(),
              agenda: /Sin actividades hoy/.test(text),
              movements: /Sin movimientos todav/.test(text),
              tasks: /No hay tareas abiertas/.test(text),
              devices: dash.querySelectorAll('.dash-tabs .ui-seg-count, .dash-tile-num').length > 0
            });
          }
          if (window.__qaSamples.length < 2500) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await gotoView(page, base, 'dashboard');
      await page.waitForSelector('[data-dash="afuera"] .dash-rows', { timeout: 20000 });
      await until(() => answered.agenda && answered.tasks && answered.movements && answered.devices, { timeout: 15000, message: 'las cuatro respuestas demoradas' });
      await sleep(400);
      const samples = await page.evaluate(() => window.__qaSamples);
      const early = samples.filter(sample => ['agenda', 'tasks', 'movements', 'devices'].some(key => sample[key] && sample.t < answered[key] - 5));
      const before = samples.filter(sample => sample.t < Math.min(...Object.values(answered)));
      assert(before.length > 5, `Pocas muestras antes de la primera respuesta (${before.length}).`);
      assert(!early.length, `Falso vacío antes de que llegaran los datos: ${JSON.stringify(early.slice(0, 3))}`);

      // Vuelta al Inicio con notas y recreos demorados 3 s: se ve lo último visto, sin esqueletos.
      rules.delay.length = 0;
      rules.delay.push({ rx: /^\/api\/(internal-notes|recess-schedules)/, ms: 3000 });
      await page.click('.shell-nav [data-view="agenda"]');
      await page.waitForFunction(() => location.pathname.endsWith('/agenda'));
      await sleep(1200);
      await page.click('.shell-nav [data-view="dashboard"]');
      await page.waitForSelector('[data-dash="afuera"] .dash-rows', { timeout: 5000 });
      const back = await page.evaluate(() => new Promise(resolve => {
        const seen = [];
        const t0 = performance.now();
        const tick = () => {
          const dash = document.querySelector('.dash');
          const skel = dash ? dash.querySelectorAll('.ui-skel').length : -1;
          if (skel) seen.push(Math.round(performance.now() - t0));
          if (performance.now() - t0 < 1500) requestAnimationFrame(tick); else resolve(seen);
        };
        requestAnimationFrame(tick);
      }));
      assert(!back.length, `Al volver al Inicio hubo esqueletos (${back.length} cuadros, desde ${back[0]} ms).`);
      return `${before.length} cuadros antes de la primera respuesta sin falso vacío · vuelta sin esqueletos`;
    } finally {
      await context.close();
    }
  });

  // ── 18. Vencimiento: la misma regla en el Inicio y en el tablero ──────────
  await test('qa-c', 'QA ronda 1 · Inicio', '18: una tarea que vence hoy dice "vence hoy" en el Inicio y "Vence hoy" en Tareas (nunca "venció")', async () => {
    const real = (await api.get('/api/tasks?space=all')).data || {};
    const operator = admin.nombre || admin.email;
    const task = {
      id: 'qa-c-vence-hoy', titulo: 'QA-C configurar el proyector del SUM', descripcion: '', estado: 'Pendiente', prioridad: 'Urgente',
      responsable: operator, responsables: [operator], fechaVencimiento: todayAr(), fechaCreacion: new Date().toISOString(), done: false, items: []
    };
    const { context, page } = await session();
    try {
      const rules = await intercept(page);
      rules.respond.push({ rx: /^\/api\/tasks(\?|$)/, body: () => ({ ok: true, items: [task], columns: real.columns || [], loadedAt: new Date().toISOString() }) });
      await gotoView(page, base, 'dashboard');
      const home = await until(() => page.$$eval('.dash-task', list => list.map(el => el.textContent || '').find(text => /QA-C configurar/.test(text))), { message: 'la tarea en el Inicio' });
      assert(/vence hoy/.test(home) && !/venci[oó]/i.test(home), `Inicio: "${home}"`);
      await gotoView(page, base, 'tasks');
      const board = await until(() => page.evaluate(() => {
        const text = document.querySelector('.shell-view')?.innerText || '';
        return /QA-C configurar/.test(text) ? text : '';
      }), { message: 'la tarea en el tablero' });
      assert(/Vence hoy/.test(board) && !/Venci[oó]/.test(board), 'El tablero no dice "Vence hoy".');
      return `Inicio: "${home.replace(/\s+/g, ' ').trim().slice(0, 90)}" · tablero: Vence hoy`;
    } finally {
      await context.close();
    }
  });

  // ── 19 y 26. Título neutro y textos ───────────────────────────────────────
  await test('qa-c', 'QA ronda 1 · Inicio', '19 y 26: título de la lista neutro con cada pestaña (sin salto); sin "afuera"; ayuda para prestar o devolver uno; "marca varios equipos"', async () => {
    const { context, page } = await session();
    try {
      await gotoView(page, base, 'dashboard');
      await page.waitForSelector('[data-dash="afuera"] .dash-rows', { timeout: 20000 });
      await sleep(600);
      const read = () => page.$eval('[data-dash="afuera"] .dash-list-head', head => ({ title: head.querySelector('h2')?.textContent || '', height: Math.round(head.getBoundingClientRect().height) }));
      const seen = [];
      for (const label of ['Disponibles', 'Todos', 'Prestados']) {
        await page.evaluate(name => [...document.querySelectorAll('[data-dash="afuera"] .dash-tabs [role="radio"], [data-dash="afuera"] .dash-tabs button')].find(el => (el.textContent || '').trim().startsWith(name))?.click(), label);
        await sleep(450);
        seen.push({ label, ...(await read()) });
      }
      assert(seen.every(item => item.title === 'Equipos'), `Títulos: ${seen.map(item => `${item.label}→${item.title}`).join(', ')}`);
      assert(new Set(seen.map(item => item.height)).size === 1, `El encabezado cambió de alto: ${seen.map(item => item.height).join('/')}`);
      const text = await page.$eval('.dash', el => el.innerText || '');
      assert(!/afuera/i.test(text), `El Inicio todavía dice "afuera": ${text.match(/.{0,30}afuera.{0,30}/i)?.[0]}`);
      assert(/marca varios equipos/.test(text), 'El pie de la lista no dice "marca varios equipos".');
      assert(/prestarlo o devolverlo/.test(text), 'Falta la ayuda para prestar o devolver uno.');
      await shot(page, '19-26-inicio-1366');
      return seen.map(item => `${item.label}: "${item.title}" ${item.height}px`).join(' · ');
    } finally {
      await context.close();
    }
  });

  // Formulario de préstamo del Inicio: marca todo lo que falta de una vez (impaciente P2: tres rebotes).
  await test('qa-c', 'QA ronda 1 · Inicio', 'Préstamo en la barra: "Confirmar" vacío marca persona, rol y ubicación juntos; completar uno deja los demás marcados', async () => {
    const [tag] = await freeTags(1);
    assert(tag, 'No hay un equipo libre en la copia.');
    const { context, page } = await session();
    try {
      await gotoView(page, base, 'dashboard');
      await page.waitForSelector('[data-dash="afuera"] .dash-rows', { timeout: 20000 });
      await page.type('input[data-dash-bar]', tag);
      await page.waitForSelector(`[data-device-result="${tag}"]`);
      await page.keyboard.press('Enter');
      await page.waitForSelector('.dash-lend .dash-lend-person input');
      await sleep(400);
      const requests = posts(page, /^\/api\/loans\/lend/);
      const submit = () => page.evaluate(() => [...document.querySelectorAll('.dash-lend button')].find(button => /Confirmar préstamo/.test(button.textContent || ''))?.click());
      const read = () => page.evaluate(() => ({
        error: document.querySelector('.dash-lend-error')?.textContent || '',
        invalid: document.querySelectorAll('.dash-lend [aria-invalid="true"]').length
      }));
      await submit();
      await sleep(300);
      const first = await read();
      await page.type('.dash-lend .dash-lend-person input', 'QA-C Persona');
      await sleep(300);
      const second = await read();
      requests.stop();
      assert(!requests.seen.length, 'Se mandó un préstamo incompleto.');
      assert(/persona/.test(first.error) && /rol/.test(first.error) && /ubicación/.test(first.error) && first.invalid >= 3, `Primer intento: ${JSON.stringify(first)}`);
      assert(!/persona/.test(second.error) && /rol/.test(second.error) && second.invalid >= 2, `Después de la persona: ${JSON.stringify(second)}`);
      await shot(page, 'prestamo-faltantes-1366');
      return `"${first.error}" (${first.invalid} campos) → "${second.error}" (${second.invalid})`;
    } finally {
      await context.close();
    }
  });

  // Capturas de referencia a 375 y 1366 (oscuro), para el informe.
  await test('qa-c', 'QA ronda 1 · Inicio', 'Capturas del Inicio a 375 y 1366', async () => {
    for (const [name, options] of [['inicio-375', { device: MOBILE }], ['inicio-1366', {}]]) {
      const { context, page } = await session(options);
      try {
        await gotoView(page, base, 'dashboard');
        await page.waitForSelector('[data-dash="afuera"] .dash-rows', { timeout: 20000 });
        await sleep(900);
        await shot(page, name);
      } finally {
        await context.close();
      }
    }
    return outDir;
  });
}
