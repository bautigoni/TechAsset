// Pruebas de Tareas TIC (etapa 7a). Corren contra la copia de la base: crean,
// mueven y borran tareas y columnas solo ahí. Cada una verifica el efecto en la
// base por API, no solo lo que se ve.
import { SITE } from '../lib/env.mjs';
import { assert, findButton, gotoView, openContext, pathname, sleep, until } from '../lib/browser.mjs';

const tasksOf = async api => (await api.get('/api/tasks?space=all')).data.items || [];
const columnsOf = async api => (await api.get('/api/task-columns')).data.items || [];
const escapeRx = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function openBoard(page, base) {
  await gotoView(page, base, 'tasks');
  await page.waitForSelector('.tk-lane[data-lane]', { timeout: 20000 });
}

/** Reemplaza el texto de un campo (Ctrl+A y tipear). */
async function typeIn(page, selector, text) {
  const el = await page.waitForSelector(selector, { timeout: 8000 });
  await el.click();
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.type(text);
}

/** Click por texto que reintenta si el botón se re-renderizó entre buscarlo y tocarlo. */
async function press(page, pattern, scope) {
  await until(async () => {
    const button = await findButton(page, pattern, { scope, includeDisabled: false });
    if (!button) return false;
    await button.click();
    return true;
  }, { message: `el botón ${pattern}` });
  await sleep(150);
}

/** Abre el "+" (menú gooey) y toca un satélite. */
async function gooey(page, label) {
  await page.click('.t-goo-main');
  await sleep(450);
  await page.click(`.t-goo-item[aria-label="${label}"]`);
  await sleep(300);
}

export async function tasksTests({ browser, base, api, apiConsulta, admin, consulta, releaseVersion, test, track = () => {} }) {
  const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width: 1440, height: 900 } });
  track(page);
  const stamp = Date.now().toString(36);
  const title = `E2E alta ${stamp}`;
  let createdId = '';

  await test('e', 'Tareas', 'Alta en línea con el "+" (prioridad, sin modal)', async () => {
    await openBoard(page, base);
    await gooey(page, 'Nueva tarea de equipo');
    await page.waitForSelector('form.tk-form', { timeout: 5000 });
    assert(!(await page.$('.modal, [role="dialog"]')), 'apareció un modal');
    await typeIn(page, 'form.tk-form input[placeholder^="Ej. Revisar"]', title);
    await press(page, /^Urgente$/, 'form.tk-form');
    await press(page, /^Crear tarea$/, 'form.tk-form');
    const task = await until(async () => (await tasksOf(api)).find(item => item.titulo === title), { message: 'la tarea nueva en la base' });
    assert(task.prioridad === 'Urgente', `prioridad ${task.prioridad}`);
    createdId = task.id;
    await page.waitForSelector(`.tk-card[data-task-id="${task.id}"]`, { timeout: 5000 });
    return `${task.id} en «${task.estado}»`;
  });

  await test('e', 'Tareas', 'Página de la tarea con URL; subtarea al instante, Deshacer; comentario', async () => {
    assert(createdId, 'no hay tarea creada');
    await page.click(`.tk-card[data-task-id="${createdId}"] .tk-card-title`);
    await until(async () => (await pathname(page)).toLowerCase() === `/sede/${SITE.toLowerCase()}/tasks/${createdId.toLowerCase()}`, { message: 'la URL de la tarea' });
    await page.waitForSelector('.tk-detail', { timeout: 5000 });
    await press(page, /^Subtarea$/, '.tk-detail');
    await typeIn(page, '.tk-detail input[aria-label="Nueva subtarea"]', 'Paso E2E');
    await page.keyboard.press('Enter');
    const withItem = await until(async () => (await tasksOf(api)).find(item => item.id === createdId && item.items?.some(entry => entry.texto === 'Paso E2E')), { message: 'la subtarea en la base' });
    const itemId = withItem.items.find(entry => entry.texto === 'Paso E2E').id;
    await page.waitForSelector('.tk-detail .tk-sub--row button[role="checkbox"]:not([disabled])');
    await page.click('.tk-detail .tk-sub--row button[role="checkbox"]');
    await until(async () => (await tasksOf(api)).find(item => item.id === createdId)?.items?.find(entry => entry.id === itemId)?.completada, { message: 'la subtarea tildada en la base' });
    await page.click('.tk-detail .tk-sub--row .tk-sub-x');
    await until(async () => !(await tasksOf(api)).find(item => item.id === createdId)?.items?.length, { message: 'la subtarea quitada en la base' });
    await press(page, /Deshacer/, '.tk-detail');
    await until(async () => (await tasksOf(api)).find(item => item.id === createdId)?.items?.some(entry => entry.texto === 'Paso E2E' && entry.completada), { message: 'la subtarea restaurada (y tildada) por Deshacer' });
    await typeIn(page, '.tk-detail textarea[aria-label="Nuevo comentario"]', 'Comentario E2E');
    await page.keyboard.down('Control');
    await page.keyboard.press('Enter');
    await page.keyboard.up('Control');
    await until(async () => ((await api.get(`/api/tasks/${createdId}/comments`)).data.items || []).some(item => item.body === 'Comentario E2E'), { message: 'el comentario en la base' });
    return 'subtarea agregada, tildada, quitada y restaurada; comentario con Ctrl+Enter';
  });

  await test('e', 'Tareas', 'Borrar desde la página (confirmación en línea) → Deshacer', async () => {
    await sleep(300);
    await press(page, /^Borrar$/, '.tk-detail-head');
    await press(page, /^Borrar tarea$/, '.tk-detail-head');
    await until(async () => !(await tasksOf(api)).some(item => item.id === createdId), { message: 'la tarea borrada en la base' });
    await until(async () => (await pathname(page)).toLowerCase() === `/sede/${SITE.toLowerCase()}/tasks`, { message: 'volver al tablero' });
    await press(page, /Deshacer/, '.tk-screen');
    await until(async () => (await tasksOf(api)).some(item => item.id === createdId), { message: 'la tarea restaurada por Deshacer' });
    return `${createdId} borrada y restaurada`;
  });

  await test('e', 'Tareas', 'Inicio → "Tus tareas" abre la página de ESA tarea (/tasks/<id>); Atrás vuelve al Inicio', async () => {
    await gotoView(page, base, 'dashboard');
    const button = await page.waitForSelector('.dash-task:not([disabled])', { timeout: 20000 });
    const label = await button.evaluate(node => node.getAttribute('aria-label') || '');
    const titulo = label.replace(/^Abrir la tarea /, '');
    const task = (await tasksOf(api)).find(item => item.titulo === titulo);
    assert(task, `no encontré la tarea «${titulo}» en la base`);
    await button.click();
    const url = `/sede/${SITE.toLowerCase()}/tasks/${String(task.id).toLowerCase()}`;
    await until(async () => (await pathname(page)).toLowerCase() === url, { message: 'la URL de la tarea' });
    await page.waitForSelector('.tk-detail', { timeout: 8000 });
    const shown = await page.$eval('.tk-detail', node => node.textContent || '');
    assert(shown.includes(titulo), `la página muestra otra tarea (esperaba «${titulo}»)`);
    await page.goBack();
    await until(async () => (await pathname(page)).toLowerCase().endsWith('/dashboard'), { message: 'volver al Inicio con Atrás' });
    return `«${titulo}» → ${url} → Atrás al Inicio`;
  });

  await test('e', 'Tareas', 'Ctrl+click en dos tarjetas → Mover a (lote) → Deshacer', async () => {
    const columns = await columnsOf(api);
    const ids = [];
    for (const n of [1, 2]) {
      const created = await api.post('/api/tasks', { titulo: `E2E lote ${n} ${stamp}`, responsables: ['E2E'], prioridad: 'Media', columnId: columns[0].id, estado: columns[0].name });
      ids.push(created.data.item.id);
    }
    await openBoard(page, base);
    for (const id of ids) {
      await page.keyboard.down('Control');
      await page.click(`.tk-card[data-task-id="${id}"] .tk-card-meta`);
      await page.keyboard.up('Control');
    }
    await page.waitForSelector('.tk-selbar', { timeout: 4000 });
    const target = columns[columns.length - 1];
    await press(page, new RegExp(`^${escapeRx(target.name)}$`), '.tk-selbar');
    await until(async () => (await tasksOf(api)).filter(item => ids.includes(item.id) && item.columnId === target.id).length === 2, { message: 'las dos en la columna destino' });
    await press(page, /Deshacer/, '.tk-screen');
    await until(async () => (await tasksOf(api)).filter(item => ids.includes(item.id) && item.columnId === columns[0].id).length === 2, { message: 'las dos de vuelta por Deshacer' });
    return `2 tareas a «${target.name}» y de vuelta`;
  });

  await test('e', 'Tareas', 'Columnas: crear, renombrar (Esc cancela), eliminar con confirmación → Deshacer', async () => {
    await openBoard(page, base);
    const name = `E2E col ${stamp}`;
    await gooey(page, 'Nueva columna');
    await typeIn(page, 'form.tk-colform input', name);
    await page.keyboard.press('Enter');
    const created = await until(async () => (await columnsOf(api)).find(item => item.name === name), { message: 'la columna nueva en la base' });
    const lane = `.tk-lane[data-lane="c${created.id}"]`;
    await page.waitForSelector(lane, { timeout: 5000 });
    await sleep(500);
    await page.click(`${lane} .tk-lane-edit`);
    await typeIn(page, `${lane} .tk-col-edit input`, 'descartar');
    await page.keyboard.press('Escape');
    await until(async () => !(await page.$(`${lane} .tk-col-edit`)), { message: 'Esc cierra la edición' });
    assert((await columnsOf(api)).some(item => item.id === created.id && item.name === name), 'Esc guardó el nombre');
    await page.click(`${lane} .tk-lane-edit`);
    await typeIn(page, `${lane} .tk-col-edit input`, `${name} R`);
    await page.keyboard.press('Enter');
    await until(async () => (await columnsOf(api)).some(item => item.id === created.id && item.name === `${name} R`), { message: 'el renombre en la base' });
    await sleep(300);
    await page.click(`${lane} .tk-lane-edit`);
    await press(page, /^Eliminar columna$/, lane);
    await press(page, /^Eliminar columna$/, `${lane} .tk-col-del`);
    await until(async () => !(await columnsOf(api)).some(item => item.id === created.id), { message: 'la columna eliminada' });
    await press(page, /Deshacer/, '.tk-screen');
    await until(async () => (await columnsOf(api)).some(item => item.id === created.id), { message: 'la columna restaurada por Deshacer' });
    await api.del(`/api/task-columns/${created.id}`);
    return 'crear, Esc, renombrar, eliminar y Deshacer';
  });

  const reader = await openContext(browser, { base, token: consulta.token, releaseVersion, viewport: { width: 1440, height: 900 } });
  track(reader.page);
  try {
    await test('e', 'Tareas', 'Modo consulta: sin "+", sin selección, Editar/Borrar deshabilitados; el server rechaza', async () => {
      await openBoard(reader.page, base);
      assert(!(await reader.page.$('.t-goo-main')), 'el "+" está visible en consulta');
      assert(!(await reader.page.$('.tk-card .tk-card-check')), 'hay casillas de selección en consulta');
      const first = await reader.page.$('.tk-card[data-task-id]');
      if (first) {
        await reader.page.click('.tk-card[data-task-id] .tk-card-title');
        await reader.page.waitForSelector('.tk-detail', { timeout: 5000 });
        const enabled = await reader.page.$$eval('.tk-detail-actions button', buttons => buttons.filter(button => !button.disabled).map(button => button.textContent.trim()));
        assert(!enabled.length, `habilitados: ${enabled.join(', ')}`);
        assert(!(await reader.page.$('.tk-detail textarea[aria-label="Nuevo comentario"]')), 'se puede comentar en consulta');
      }
      const response = await apiConsulta.post('/api/tasks', { titulo: 'No debería', operator: consulta.email });
      assert(response.status === 403, `POST /api/tasks devolvió ${response.status}`);
      return 'sin escrituras; 403 del server';
    });
  } finally {
    await reader.context.close().catch(() => {});
  }
  await context.close().catch(() => {});
}
