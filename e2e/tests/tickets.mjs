// tk) Tickets y Sugerencias (etapa 7b): bandeja maestro-detalle con URL propia,
// alta en el lugar (número solo dígitos, tags y checklist de corrido, sin
// duplicar con doble click), estado al instante con Deshacer, quitar paso con
// Deshacer en su lugar, selección con Ctrl+click y borrado en lote con
// confirmación y Deshacer, plantillas, cambios sin guardar, modo consulta y
// Sugerencias (validación en el lugar, votar, eliminar con Deshacer).
// Cada prueba verifica el efecto en la base por API.
import { assert, gotoView, openContext, pathname, sleep, until } from '../lib/browser.mjs';

const visibleClick = (page, selector, rx) => until(() => page.evaluate((sel, src, flags) => {
  const re = new RegExp(src, flags);
  const text = node => (node.textContent || '').replace(/\s+/g, ' ').trim();
  const el = [...document.querySelectorAll(sel)].find(node => (re.test(text(node)) || re.test(node.getAttribute('aria-label') || '')) && node.getBoundingClientRect().width && !node.disabled);
  if (!el) return false;
  el.click();
  return true;
}, selector, rx.source, rx.flags), { message: `${selector} ${rx}` });

/** Input de un campo por el texto de su label (FieldShell: <label for=id>). */
async function fieldByLabel(page, scope, label) {
  return until(async () => (await page.evaluateHandle((sc, text) => {
    const lab = [...document.querySelectorAll(`${sc} label.ui-label`)].find(node => node.textContent.trim().replace(/\*$/, '').trim().startsWith(text));
    return lab ? document.getElementById(lab.htmlFor) : null;
  }, scope, label)).asElement(), { message: `el campo "${label}"` });
}

async function typeIn(page, handle, text) {
  await handle.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await handle.type(text, { delay: 12 });
}

const listTickets = async api => (await api.get('/api/tickets')).data.items || [];

export async function ticketsTests({ browser, base, api, apiConsulta, admin, consulta, releaseVersion, test, track = () => {} }) {
  const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion });
  track(page);
  const numero = String(70000 + Math.floor(Math.random() * 9000));
  try {
    // Datos propios en la copia: dos tickets con checklist para las pruebas.
    const seed = [];
    for (const n of ['1', '2', '3']) seed.push((await api.post('/api/tickets', { numero: `${numero}${n}`, titulo: `E2E bandeja ${n}`, origen: 'tik', estado: 'No hecho', prioridad: n === '1' ? 'Urgente' : 'Media', checklist: ['Paso A', 'Paso B', 'Paso C'] })).data.item);

    await test('tk', 'Tickets', 'Abrir la ficha desde la lista (URL propia) y volver con Atrás', async () => {
      await gotoView(page, base, 'tickets');
      await page.waitForSelector('.tkx-row', { timeout: 20000 });
      await visibleClick(page, `.tkx-row[data-ticket-id="${seed[0].id}"] .tkx-row-open`, /E2E bandeja 1/);
      await page.waitForSelector('.tkx-detail .tkx-detail-title');
      assert((await pathname(page)).endsWith(`/tickets/${seed[0].id}`), `URL de la ficha: ${await pathname(page)}`);
      const inline = await page.evaluate(() => Boolean(document.querySelector('.tkx-wrap .tkx-pane .tkx-detail')) && !document.querySelector('.modal'));
      assert(inline, 'La ficha no está en línea al lado de la lista.');
      await page.goBack();
      await until(async () => (await pathname(page)).endsWith('/tickets'), { message: 'Atrás vuelve a la lista' });
      await until(() => page.evaluate(() => !document.querySelector('.tkx-pane .tkx-detail')), { message: 'la ficha se cierra con Atrás' });
      // En angosto: una sola de las dos, con "Volver a la lista".
      await page.setViewport({ width: 390, height: 844 });
      await gotoView(page, base, `tickets/${seed[0].id}`);
      await page.waitForSelector('.tkx-detail');
      // El modo angosto se decide al medir el ancho: se espera a que se aplique.
      const readNarrow = () => page.evaluate(() => ({ list: getComputedStyle(document.querySelector('.tkx-list')).display, back: Boolean([...document.querySelectorAll('.tkx-pane button')].find(b => /Volver a la lista/.test(b.textContent))) }));
      try {
        const narrow = await until(async () => { const value = await readNarrow(); return value.list === 'none' && value.back && value; }, { timeout: 5000, message: 'la vista angosta' }).catch(async () => readNarrow());
        assert(narrow.list === 'none' && narrow.back, `En angosto: lista ${narrow.list}, volver ${narrow.back}`);
        await visibleClick(page, '.tkx-pane button', /Volver a la lista/);
        await until(async () => (await pathname(page)).endsWith('/tickets'), { message: 'Volver lleva a la lista' });
      } finally {
        // Aunque falle, las pruebas siguientes no quedan en 390 px.
        await page.setViewport({ width: 1366, height: 900 });
      }
      return `#${seed[0].numero}: ficha en /tickets/${seed[0].id}, Atrás y Volver OK`;
    });

    await test('tk', 'Tickets', 'Alta en el lugar: número solo dígitos, tags y checklist de corrido, sin duplicar', async () => {
      await gotoView(page, base, 'tickets/nuevo');
      await page.waitForSelector('.tkx-form');
      // Guardar sin número: error en el campo y no se manda nada.
      const before = (await listTickets(api)).length;
      await visibleClick(page, '.tkx-form button[type="submit"]', /Guardar ticket/);
      await page.waitForSelector('.tkx-form .ui-help--bad');
      assert((await listTickets(api)).length === before, 'Guardó sin número.');
      const num = await fieldByLabel(page, '.tkx-form', 'Número de ticket');
      await typeIn(page, num, `#${numero}9a`);
      const typed = await page.evaluate(el => el.value, num);
      assert(typed === `${numero}9`, `El número quedó "${typed}" (solo dígitos).`);
      await typeIn(page, await fieldByLabel(page, '.tkx-form', 'Título'), 'E2E alta en línea');
      const tags = await fieldByLabel(page, '.tkx-form', 'Tags');
      await tags.click();
      await page.keyboard.type('proyector,hdmi,', { delay: 15 });
      const step = await page.$('.tkx-form input[aria-label="Agregar paso a checklist inicial"]');
      await step.click();
      await page.keyboard.type('Probar cable', { delay: 10 });
      await page.keyboard.press('Enter');
      await page.keyboard.type('Pedir reemplazo, con coma', { delay: 10 });
      await page.keyboard.press('Enter');
      // Doble click en Guardar: un solo ticket.
      await page.$eval('.tkx-form button[type="submit"]', button => { button.click(); button.click(); });
      await page.waitForSelector('.tkx-detail .tkx-detail-title', { timeout: 15000 });
      const created = (await listTickets(api)).filter(item => item.numero === `${numero}9`);
      assert(created.length === 1, `Se crearon ${created.length} tickets.`);
      assert(JSON.stringify(created[0].tags) === JSON.stringify(['proyector', 'hdmi']), `Tags: ${JSON.stringify(created[0].tags)}`);
      const checklist = (await api.get(`/api/tickets/${created[0].id}/detail`)).data.checklist.map(item => item.text);
      assert(checklist.join('|') === 'Probar cable|Pedir reemplazo, con coma', `Checklist: ${checklist.join('|')}`);
      assert((await pathname(page)).endsWith(`/tickets/${created[0].id}`), 'Después de guardar no quedó en la ficha.');
      return `#${numero}9 con 2 tags y 2 pasos, uno solo`;
    });

    await test('tk', 'Tickets', 'Cambios sin guardar: avisa en línea y no navega', async () => {
      await gotoView(page, base, 'tickets/nuevo');
      await page.waitForSelector('.tkx-form');
      await typeIn(page, await fieldByLabel(page, '.tkx-form', 'Título'), 'Borrador que no se pierde');
      await visibleClick(page, `.tkx-row[data-ticket-id="${seed[1].id}"] .tkx-row-open`, /E2E bandeja 2/);
      await page.waitForSelector('.tkx-pane .ui-confirm');
      assert((await pathname(page)).endsWith('/tickets/nuevo'), 'Navegó con cambios sin guardar.');
      await visibleClick(page, '.tkx-pane .ui-confirm button', /Seguir editando/);
      const kept = await page.evaluate(() => [...document.querySelectorAll('.tkx-form input')].some(input => input.value === 'Borrador que no se pierde'));
      assert(kept, 'Se perdió lo escrito.');
      await visibleClick(page, `.tkx-row[data-ticket-id="${seed[1].id}"] .tkx-row-open`, /E2E bandeja 2/);
      await visibleClick(page, '.tkx-pane .ui-confirm button', /Descartar y salir/);
      await until(async () => (await pathname(page)).endsWith(`/tickets/${seed[1].id}`), { message: 'descartar navega a la ficha' });
      return 'aviso en línea, Seguir editando conserva, Descartar navega';
    });

    await test('tk', 'Tickets', 'Estado al instante con Deshacer', async () => {
      await gotoView(page, base, `tickets/${seed[1].id}`);
      await page.waitForSelector('.tkx-detail .tkx-estado [role="radio"]:not([disabled])', { timeout: 20000 });
      await page.evaluate(() => [...document.querySelectorAll('.tkx-detail .tkx-estado [role="radio"]')].find(b => b.textContent.trim() === 'Hecho').click());
      await until(async () => (await listTickets(api)).find(item => item.id === seed[1].id)?.estado === 'Hecho', { message: 'Hecho en la base' });
      await visibleClick(page, '.tkx-detail .ui-status button', /Deshacer/);
      await until(async () => (await listTickets(api)).find(item => item.id === seed[1].id)?.estado === 'No hecho', { message: 'Deshacer vuelve a No hecho' });
      return `#${seed[1].numero}: No hecho → Hecho → Deshacer`;
    });

    await test('tk', 'Tickets', 'Quitar un paso del checklist y Deshacer lo devuelve a su lugar', async () => {
      await gotoView(page, base, `tickets/${seed[1].id}`);
      await page.waitForSelector('.tkx-checklist');
      await visibleClick(page, '.tkx-checklist button', /Quitar el paso Paso B/);
      await until(async () => (await api.get(`/api/tickets/${seed[1].id}/detail`)).data.checklist.length === 2, { message: 'paso quitado en la base' });
      await visibleClick(page, '.tkx-detail .ui-status button', /Deshacer/);
      const order = await until(async () => {
        const list = (await api.get(`/api/tickets/${seed[1].id}/detail`)).data.checklist.map(item => item.text).join(',');
        return list === 'Paso A,Paso B,Paso C' && list;
      }, { message: 'paso devuelto a su lugar' });
      return order;
    });

    await test('tk', 'Tickets', 'Ctrl+click marca filas; borrar en lote con confirmación en línea y Deshacer', async () => {
      await gotoView(page, base, 'tickets');
      await page.waitForSelector(`.tkx-row[data-ticket-id="${seed[2].id}"]`);
      for (const ticket of [seed[0], seed[2]]) {
        const row = await page.$(`.tkx-row[data-ticket-id="${ticket.id}"] .tkx-row-open`);
        await page.keyboard.down('Control');
        await row.click();
        await page.keyboard.up('Control');
      }
      await page.waitForSelector('.tkx-list .ui-selhead');
      assert(!(await pathname(page)).match(/tickets\/\d+/), 'Ctrl+click abrió la ficha.');
      const count = await page.$eval('.tkx-list .ui-selhead-count', el => el.textContent.trim());
      assert(/^2/.test(count), `Selección: ${count}`);
      await visibleClick(page, '.tkx-list .ui-selhead button', /^Borrar$/);
      await page.waitForSelector('.tkx-list .ui-selhead .ui-confirm');
      assert((await listTickets(api)).some(item => item.id === seed[0].id), 'Borró sin confirmar.');
      await visibleClick(page, '.tkx-list .ui-selhead .ui-confirm button', /^Borrar 2$/);
      await until(async () => !(await listTickets(api)).some(item => item.id === seed[0].id || item.id === seed[2].id), { message: 'borrados en la base' });
      await visibleClick(page, '.tkx-list-status button', /Deshacer/);
      await until(async () => (await listTickets(api)).filter(item => item.id === seed[0].id || item.id === seed[2].id).length === 2, { message: 'Deshacer los recupera' });
      return '2 marcados, confirmación en la barra, borrados y recuperados';
    });

    await test('tk', 'Tickets', 'Plantillas: crear y eliminar con confirmación y Deshacer', async () => {
      await gotoView(page, base, 'tickets/plantillas');
      await page.waitForSelector('.tkx-templates');
      await visibleClick(page, '.tkx-templates button', /Nueva plantilla/);
      await page.waitForSelector('.tkx-tpl-form');
      await typeIn(page, await fieldByLabel(page, '.tkx-tpl-form', 'Título'), `E2E plantilla ${numero}`);
      await visibleClick(page, '.tkx-tpl-form button[type="submit"]', /Guardar plantilla/);
      const tpl = await until(async () => ((await api.get('/api/ticket-templates')).data.items || []).find(item => item.title === `E2E plantilla ${numero}`), { message: 'plantilla creada' });
      await until(() => page.evaluate(title => {
        const card = [...document.querySelectorAll('.tkx-tpl')].find(node => node.querySelector('.tkx-tpl-head')?.textContent.includes(title));
        const button = card && [...card.querySelectorAll('button')].find(item => item.textContent.trim() === 'Eliminar');
        if (button) button.click();
        return Boolean(button);
      }, tpl.title), { message: 'la tarjeta de la plantilla' });
      await page.waitForSelector('.tkx-tpl .ui-confirm');
      await visibleClick(page, '.tkx-tpl .ui-confirm button', /^Eliminar$/);
      await until(async () => !((await api.get('/api/ticket-templates')).data.items || []).some(item => item.id === tpl.id), { message: 'plantilla eliminada' });
      await visibleClick(page, '.tkx-templates .ui-status button', /Deshacer/);
      await until(async () => ((await api.get('/api/ticket-templates')).data.items || []).some(item => item.id === tpl.id), { message: 'plantilla recuperada' });
      return tpl.title;
    });

    await test('tk', 'Sugerencias', 'Alta con validación en el lugar, votar y eliminar con Deshacer', async () => {
      await gotoView(page, base, 'suggestions');
      await page.waitForSelector('.sgx-head');
      await visibleClick(page, '.sgx-head button', /Nueva sugerencia/);
      await page.waitForSelector('.sgx-form');
      await visibleClick(page, '.sgx-form button[type="submit"]', /Publicar/);
      // El error se ve DENTRO del formulario (antes quedaba detrás del modal).
      await page.waitForSelector('.sgx-form .ui-help--bad, .sgx-form .ui-error');
      const title = `E2E idea ${numero}`;
      await typeIn(page, await fieldByLabel(page, '.sgx-form', 'Título'), title);
      await (await fieldByLabel(page, '.sgx-form', 'Descripción')).type('Creada por e2e', { delay: 5 });
      await visibleClick(page, '.sgx-form button[type="submit"]', /Publicar/);
      const created = await until(async () => ((await api.get('/api/suggestions')).data.items || []).find(item => item.title === title), { message: 'sugerencia creada' });
      await page.waitForSelector(`#sgx-${created.id}`);
      await visibleClick(page, `#sgx-${created.id} .sgx-vote`, /Votar/);
      await until(async () => ((await api.get('/api/suggestions')).data.items || []).find(item => item.id === created.id)?.voteCount === 1, { message: 'voto en la base' });
      await visibleClick(page, `#sgx-${created.id} button`, /^Eliminar$/);
      await page.waitForSelector(`#sgx-${created.id} .ui-confirm`);
      await visibleClick(page, `#sgx-${created.id} .ui-confirm button`, /^Eliminar$/);
      await until(async () => !((await api.get('/api/suggestions')).data.items || []).some(item => item.id === created.id), { message: 'eliminada' });
      await visibleClick(page, '.sgx-main > .ui-status button', /Deshacer/);
      const back = await until(async () => ((await api.get('/api/suggestions')).data.items || []).find(item => item.id === created.id), { message: 'recuperada' });
      assert(back.voteCount === 1, 'Al recuperarla perdió el voto.');
      return `${title}: validación en el lugar, voto, eliminar y Deshacer (conserva el voto)`;
    });
  } finally {
    await context.close();
  }

  const ro = await openContext(browser, { base, token: consulta.token, releaseVersion });
  track(ro.page);
  try {
    await test('tk', 'Tickets', 'Modo consulta: sin alta ni selección, estado deshabilitado y el server responde 403', async () => {
      const any = (await listTickets(api))[0];
      await gotoView(ro.page, base, `tickets/${any.id}`);
      await ro.page.waitForSelector('.tkx-detail .tkx-estado', { timeout: 20000 });
      const state = await ro.page.evaluate(() => ({
        alta: [...document.querySelectorAll('.tkx button')].some(b => /Cargar ticket|Plantillas/.test(b.textContent)),
        checks: document.querySelectorAll('.tkx-row-check').length,
        estado: [...document.querySelectorAll('.tkx-estado [role="radio"]')].every(b => b.disabled),
        nota: /Modo consulta/.test(document.querySelector('.tkx-toolbar')?.textContent || '')
      }));
      assert(!state.alta && !state.checks && state.estado && state.nota, JSON.stringify(state));
      const denied = await apiConsulta.post('/api/tickets/bulk', { action: 'delete', ids: [any.id] });
      assert(denied.status === 403, `bulk en consulta: ${denied.status}`);
      return 'sin acciones de escritura; bulk 403';
    });
  } finally {
    await ro.context.close();
  }
  await sleep(0);
}
