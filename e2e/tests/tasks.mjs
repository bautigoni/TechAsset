// Pruebas de Tareas TIC (etapa 7a). Corren contra la copia de la base: crean,
// mueven y borran tareas y columnas solo ahí. Cada una verifica el efecto en la
// base por API, no solo lo que se ve.
import { SITE } from '../lib/env.mjs';
import { assert, findButton, gotoView, openContext, pathname, sleep, until } from '../lib/browser.mjs';
import { formatProbe, probeView, setTheme, settle } from '../lib/ux-probe.mjs';

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
  // Si el campo está en un plegable que todavía se abre, el centro puede estar
  // recortado y el click caería en otra cosa (y lo tipeado, en el escáner global).
  await page.waitForFunction(node => !node.closest('.ui-collapse:not([data-state="open"])'), { timeout: 3000 }, el).catch(() => {});
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
    await gooey(page, 'Nueva tarea del grupo');
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
    await page.waitForSelector('.tk-detail .ui-collapse[data-state="open"] .ui-status', { timeout: 5000 }); // la línea de estado terminó de abrir
    await sleep(450); // y, si quedó fuera de vista, terminó de traerla
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

  await tasksUxTests({ browser, base, api, admin, releaseVersion, test, track, stamp });

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

/* ══ Revisión UX (20/10): nada recortado, alturas parejas, nada de golpe ══ */

/**
 * Mide `probe` (una función de la página, como texto) en cada cuadro mientras
 * corre `action`, y devuelve la serie. Sirve para ver que algo pasa por
 * valores intermedios (se anima) y que un control no se mueve.
 */
async function sampleFrames(page, probe, action, ms = 520) {
  await page.evaluate(src => {
    const fn = new Function(`return (${src})`)();
    window.__tkFrames = [];
    let on = true;
    window.__tkStop = () => { on = false; };
    const loop = () => { if (!on) return; try { window.__tkFrames.push(fn()); } catch { window.__tkFrames.push(null); } requestAnimationFrame(loop); };
    loop();
  }, probe);
  await action();
  await sleep(ms);
  return page.evaluate(() => { window.__tkStop(); return window.__tkFrames; });
}

/** Cambió más de `min` px y ningún cuadro se llevó más del 60 % del cambio (no fue de golpe). */
function smoothness(values, min = 24) {
  const list = values.filter(value => typeof value === 'number');
  const total = Math.max(...list) - Math.min(...list);
  let jump = 0;
  for (let i = 1; i < list.length; i += 1) jump = Math.max(jump, Math.abs(list[i] - list[i - 1]));
  return { total: Math.round(total), jump: Math.round(jump), ok: total < min || jump <= total * 0.6, frames: list.length };
}

/** Cajas vecinas en una fila (botones con marco o fondo, campos, segmentados, kbd) con distinta altura. */
function unevenRows(scope) {
  const root = document.querySelector(scope);
  if (!root) return ['sin scope'];
  const visible = el => (el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : true);
  const boxy = el => {
    const s = getComputedStyle(el);
    return el.matches('.tk-tabs, .ui-control, .ui-kbd') || parseFloat(s.borderTopWidth) > 0 || !/^(rgba\(0, 0, 0, 0\)|transparent)$/.test(s.backgroundColor);
  };
  const name = el => `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).slice(0, 2).join('.')} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24)}"`;
  // Lo de adentro de un campo o de un botón (el ✕ de la búsqueda, el Kbd de "Limpiar") es parte de esa caja.
  const boxes = [...root.querySelectorAll('button, .tk-tabs, .ui-control, .ui-kbd')]
    .filter(el => visible(el) && !el.closest('.ui-collapse:not([data-state="open"]), .t-goo-items')
      && !el.parentElement.closest('.tk-tabs, .ui-control, button') && boxy(el));
  const out = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i].getBoundingClientRect();
      const b = boxes[j].getBoundingClientRect();
      const sameRow = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0;
      const near = Math.max(a.left, b.left) - Math.min(a.right, b.right) <= 24;
      if (sameRow && near && Math.abs(a.height - b.height) > 1.5) out.push(`${name(boxes[i])} ${Math.round(a.height)} px ≠ ${name(boxes[j])} ${Math.round(b.height)} px`);
    }
  }
  return out;
}

async function openTasksAt(page, base, width, height = 900) {
  await page.setViewport({ width, height });
  await gotoView(page, base, 'tasks');
  await page.waitForSelector('.tk-board-sec .tk-lane', { timeout: 20000 });
  await settle(page);
  await sleep(400);
}

async function tasksUxTests({ browser, base, api, admin, releaseVersion, test, track, stamp }) {
  const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width: 1440, height: 900 } });
  track(page);
  try {
    await test('tk-ux', 'Tareas', 'El "+" abierto a 768, 860 y 1024 px: los tres satélites y su rótulo dentro de la pantalla', async () => {
      const out = [];
      for (const width of [768, 860, 1024]) {
        await openTasksAt(page, base, width, 800);
        await page.click('.t-goo-main');
        await sleep(800);
        const info = await page.evaluate(() => {
          const view = document.querySelector('.shell-scroll').getBoundingClientRect();
          const parts = [...document.querySelectorAll('.t-goo-item'), document.querySelector('.t-goo-caption')].filter(Boolean);
          return parts.map(el => { const r = el.getBoundingClientRect(); return { label: el.getAttribute('aria-label') || el.textContent, out: Math.round(Math.max(view.left - r.left, r.right - view.right, 0)) }; });
        });
        const bad = info.filter(item => item.out > 0);
        assert(!bad.length, `a ${width} px quedan afuera: ${bad.map(item => `${item.label} (${item.out} px)`).join(', ')}`);
        await page.keyboard.press('Escape');
        out.push(width);
      }
      return `satélites y rótulo enteros a ${out.join(', ')} px`;
    });

    await test('tk-ux', 'Tareas', 'Alturas parejas: segmentados, "+" y búsqueda de la barra, y cajas vecinas en filas (tablero, selección, página)', async () => {
      const issues = [];
      for (const width of [768, 1024, 1440]) {
        await openTasksAt(page, base, width);
        const bar = await page.evaluate(() => {
          const h = sel => [...document.querySelectorAll(sel)].map(el => Math.round(el.getBoundingClientRect().height));
          return { tabs: h('.tk-toolbar .tk-tabs'), plus: h('.tk-toolbar .t-goo-main'), search: h('.tk-toolbar .tk-tb-search .ui-control') };
        });
        const all = [...bar.tabs, ...bar.plus, ...bar.search];
        if (Math.max(...all) - Math.min(...all) > 1) issues.push(`${width}: barra ${JSON.stringify(bar)}`);
        for (const row of await page.evaluate(unevenRows, '.tk-screen')) issues.push(`${width} tablero: ${row}`);
        // La casilla de selección aparece al pasar el mouse por la tarjeta (QA de lanzamiento, frente E).
        await page.hover('.tk-card .tk-card-title');
        await page.click('.tk-card .tk-card-check');
        await page.waitForSelector('.tk-selbar');
        await sleep(300);
        for (const row of await page.evaluate(unevenRows, '.tk-selbar')) issues.push(`${width} selección: ${row}`);
        await page.keyboard.press('Escape');
      }
      const teamTasks = (await api.get('/api/tasks?space=team')).data.items || [];
      const task = teamTasks.find(item => item.items?.length) || teamTasks[0];
      await page.goto(`${base}/sede/${SITE}/tasks/${encodeURIComponent(task.id)}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.tk-detail');
      await settle(page);
      for (const row of await page.evaluate(unevenRows, '.tk-screen')) issues.push(`página: ${row}`);
      assert(!issues.length, issues.slice(0, 8).join(' | '));
      return 'barra a un solo alto, filas parejas en tablero, selección y página';
    });

    await test('tk-ux', 'Tareas', 'Prioridad a 768 px: la columna que no entra se alcanza con el paginador (no queda cortada e inalcanzable)', async () => {
      await openTasksAt(page, base, 768);
      await press(page, /^Prioridad$/, '.tk-toolbar');
      await sleep(600);
      const lastOut = () => page.evaluate(() => {
        const vp = document.querySelector('.tk-lanes-vp').getBoundingClientRect();
        const last = [...document.querySelectorAll('.tk-lanes > .tk-lane')].pop().getBoundingClientRect();
        return Math.round(last.right - vp.right);
      });
      if (await lastOut() <= 1) return 'entran las tres columnas';
      assert(await page.$('.tk-pager'), 'la última columna queda cortada y no hay paginador para llegar a ella');
      await page.click('.tk-pager button[aria-label="Columnas siguientes"]');
      await sleep(600);
      const after = await lastOut();
      assert(after <= 1, `la última columna sigue cortada ${after} px`);
      return 'paginador presente; la última columna se ve entera';
    });

    await test('tk-ux', 'Tareas', 'Nueva columna en mobile: el campo no deja una franja vacía (antes medía 256 px de alto)', async () => {
      await openTasksAt(page, base, 390, 800);
      await gooey(page, 'Nueva columna');
      await page.waitForSelector('.ui-collapse[data-state="open"] form.tk-colform', { timeout: 4000 });
      const h = await page.$eval('form.tk-colform .tk-colform-input', el => Math.round(el.getBoundingClientRect().height));
      const probe = await probeView(page, { scope: 'form.tk-colform', scrollSteps: 0 });
      assert(h <= 48 && !probe.counts.innerGaps, `campo de ${h} px; ${formatProbe(probe)}`);
      await page.keyboard.press('Escape');
      return `campo de ${h} px, sin franjas vacías`;
    });

    await test('tk-ux', 'Tareas', 'Grupo ↔ Mis tareas y Tablero ↔ Prioridad: el tablero cambia de alto suave y el segmentado no se mueve', async () => {
      await openTasksAt(page, base, 1440);
      const probe = `() => [document.querySelector('.tk-screen').getBoundingClientRect().height, document.querySelector('.tk-toolbar .tk-tabs[aria-label="Espacio de tareas"]').getBoundingClientRect().top]`;
      const out = [];
      for (const [label, rx] of [['Mis tareas', /^Mis tareas/], ['Grupo', /^Grupo/], ['Prioridad', /^Prioridad$/], ['Tablero', /^Tablero$/]]) {
        const frames = await sampleFrames(page, probe, () => press(page, rx, '.tk-toolbar'));
        const heights = smoothness(frames.map(frame => frame?.[0]));
        const tops = frames.map(frame => frame?.[1]).filter(value => typeof value === 'number');
        const moved = Math.max(...tops) - Math.min(...tops);
        assert(heights.ok, `${label}: el alto saltó ${heights.jump} px de ${heights.total} en un cuadro`);
        assert(moved <= 2, `${label}: el segmentado se movió ${Math.round(moved)} px`);
        out.push(`${label} ${heights.total} px/${heights.frames} cuadros`);
        await sleep(200);
      }
      return out.join(' · ');
    });

    // Columna con 10 tareas para "Ver más" y el arrastre debajo de una columna corta.
    const column = (await api.post('/api/task-columns', { name: `E2E UX ${stamp}` })).data.item;
    const many = [];
    for (let n = 1; n <= 10; n += 1) {
      many.push((await api.post('/api/tasks', { titulo: `E2E UX ${n} ${stamp}`, responsables: ['E2E'], prioridad: 'Media', columnId: column.id, estado: column.name })).data.item.id);
    }
    try {
      await test('tk-ux', 'Tareas', '"Ver 2 más" despliega las tarjetas suave y el botón se pliega al no quedar más', async () => {
        await openTasksAt(page, base, 1920);
        const lane = `.tk-lane[data-lane="c${column.id}"]`;
        await page.waitForSelector(lane);
        // El carril la trae si quedó fuera (paneo): foco en su primera tarjeta.
        await page.focus(`${lane} .tk-card-title`);
        await sleep(500);
        const frames = await sampleFrames(page, `() => document.querySelector('${lane}').getBoundingClientRect().height`, () => press(page, /^Ver 2 más/, lane), 700);
        const s = smoothness(frames);
        assert(s.ok && s.total > 40, `el alto de la columna: ${JSON.stringify(s)}`);
        const cards = await page.$$eval(`${lane} .tk-card`, list => list.length);
        assert(cards === 10, `se ven ${cards} tarjetas`);
        assert(await page.$(`${lane} .ui-collapse[data-state="closed"] button`), 'el botón "Ver más" no se plegó');
        return `columna +${s.total} px en ${s.frames} cuadros (salto máx. ${s.jump}); 10 tarjetas`;
      });

      await test('tk-ux', 'Tareas', 'Arrastrar: el hueco se despliega suave y soltar DEBAJO de una columna más corta también la mueve', async () => {
        await openTasksAt(page, base, 1920);
        const lanes = await page.evaluate(() => {
          const vp = document.querySelector('.tk-lanes-vp').getBoundingClientRect();
          return [...document.querySelectorAll('.tk-lanes > .tk-lane')].map(el => { const r = el.getBoundingClientRect(); return { key: el.dataset.lane, h: r.height, x: r.left + r.width / 2, bottom: r.bottom, inside: r.left >= vp.left - 1 && r.right <= vp.right + 1 }; }).filter(item => item.inside);
        });
        const source = lanes.find(item => item.key === `c${column.id}`);
        if (!source) return 'la columna de prueba no se ve entera a 1920 (hay muchas columnas): no aplica';
        const target = lanes.filter(item => item.key !== source.key).sort((a, b) => a.h - b.h)[0];
        const tallest = Math.max(...lanes.map(item => item.bottom));
        const id = await page.$eval(`.tk-lane[data-lane="${source.key}"] .tk-card`, el => el.dataset.taskId);
        const box = await (await page.$(`.tk-card[data-task-id="${id}"] .tk-card-meta`)).boundingBox();
        await page.mouse.move(box.x + 20, box.y + 4);
        await page.mouse.down();
        await page.mouse.move(box.x + 40, box.y + 20, { steps: 4 });
        // Debajo de la columna más corta (si es la más alta, dentro de ella).
        const y = target.bottom < tallest - 30 ? (target.bottom + tallest) / 2 : target.bottom - 10;
        const frames = await sampleFrames(page, `() => document.querySelector('.tk-lane[data-lane="${target.key}"]').getBoundingClientRect().height`, () => page.mouse.move(target.x, y, { steps: 6 }), 500);
        const s = smoothness(frames, 16);
        await page.mouse.up();
        assert(s.ok, `el hueco de la columna destino apareció de golpe: ${JSON.stringify(s)}`);
        const targetId = Number(target.key.slice(1));
        const moved = await until(async () => (await tasksOf(api)).find(item => item.id === id && item.columnId === targetId), { message: 'la tarea soltada debajo de la columna corta, en la base', timeout: 5000 });
        await api.patch(`/api/tasks/${id}`, { ...moved, columnId: column.id, estado: column.name });
        return `hueco +${s.total} px en ${s.frames} cuadros; soltada ${Math.round(y - target.bottom)} px debajo del pie de «${target.key}»`;
      });
    } finally {
      for (const id of many) await api.del(`/api/tasks/${id}`).catch(() => {});
      await api.del(`/api/task-columns/${column.id}`).catch(() => {});
    }

    await test('tk-ux', 'Tareas', 'Página de la tarea: subtarea y comentario nuevos entran suave; quitar la subtarea se pliega', async () => {
      const columns = await columnsOf(api);
      const created = (await api.post('/api/tasks', { titulo: `E2E UX página ${stamp}`, responsables: ['E2E'], prioridad: 'Baja', columnId: columns[0].id, estado: columns[0].name })).data.item;
      try {
        await page.setViewport({ width: 1440, height: 900 });
        await page.goto(`${base}/sede/${SITE}/tasks/${encodeURIComponent(created.id)}`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.tk-detail');
        await settle(page);
        // La fila misma (su colapso): pasa de 0 a su alto, no de golpe.
        const block = `() => { const row = document.querySelector('.tk-detail-block[aria-label="Subtareas"] .tk-sub--row'); return row ? row.closest('.ui-collapse').getBoundingClientRect().height : 0; }`;
        await press(page, /^Subtarea$/, '.tk-detail');
        await typeIn(page, '.tk-detail input[aria-label="Nueva subtarea"]', 'Paso UX');
        await sleep(400);
        const added = smoothness(await sampleFrames(page, block, () => page.keyboard.press('Enter')), 16);
        assert(added.ok, `agregar la subtarea saltó: ${JSON.stringify(added)}`);
        await until(async () => (await tasksOf(api)).find(item => item.id === created.id)?.items?.some(entry => entry.texto === 'Paso UX'), { message: 'la subtarea en la base' });
        await page.keyboard.press('Escape');
        await sleep(400);
        await page.waitForSelector('.tk-detail .tk-sub--row .tk-sub-x:not([disabled])');
        const removed = smoothness(await sampleFrames(page, block, () => page.click('.tk-detail .tk-sub--row .tk-sub-x')), 16);
        assert(removed.ok, `quitar la subtarea saltó: ${JSON.stringify(removed)}`);
        const comments = `() => document.querySelector('.tk-detail-block[aria-label="Comentarios"]').getBoundingClientRect().height`;
        await typeIn(page, '.tk-detail textarea[aria-label="Nuevo comentario"]', 'Comentario UX');
        const sent = smoothness(await sampleFrames(page, comments, async () => { await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control'); }, 900), 16);
        assert(sent.ok, `el comentario nuevo entró de golpe: ${JSON.stringify(sent)}`);
        return `subtarea +${added.total}/−${removed.total} px, comentario +${sent.total} px, sin saltos`;
      } finally {
        await api.del(`/api/tasks/${created.id}`).catch(() => {});
      }
    });

    await test('tk-ux', 'Tareas', 'Barra de selección en mobile: Borrar ↔ confirmación cambia de alto suave', async () => {
      await openTasksAt(page, base, 390, 800);
      // En el celu se elige con «Elegir» y tocando la tarjeta (la casilla no se ve en reposo).
      await press(page, /^Elegir$/, '.tk-toolbar');
      await page.click('.tk-card .tk-card-meta');
      await page.waitForSelector('.tk-selbar');
      await sleep(400);
      const probe = `() => document.querySelector('.tk-selbar').getBoundingClientRect().height`;
      const open = smoothness(await sampleFrames(page, probe, () => press(page, /^Borrar$/, '.tk-selbar')), 6);
      assert(open.ok, `abrir la confirmación saltó: ${JSON.stringify(open)}`);
      const close = smoothness(await sampleFrames(page, probe, () => press(page, /^Cancelar$/, '.tk-selbar')), 6);
      assert(close.ok, `cerrar la confirmación saltó: ${JSON.stringify(close)}`);
      await page.keyboard.press('Escape');
      return `confirmación ${open.total} px en ${open.frames} cuadros, de vuelta ${close.total} px`;
    });

    await test('tk-ux', 'Tareas', 'Espacio sin tareas: vacío diseñado con la acción; cada columna con su vacío compacto (sin huecos)', async () => {
      // La lista de tareas se sirve vacía (las columnas son las reales): el resto va al server.
      const columns = await columnsOf(api);
      const empty = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width: 1440, height: 900 } });
      track(empty.page);
      try {
        await empty.page.setBypassServiceWorker(true);
        await empty.page.setRequestInterception(true);
        empty.page.on('request', request => {
          if (request.isInterceptResolutionHandled?.()) return;
          const url = new URL(request.url());
          if (request.method() === 'GET' && url.pathname === '/api/tasks') {
            return request.respond({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ ok: true, items: [], columns, loadedAt: new Date().toISOString(), space: 'all' }) });
          }
          return request.continue();
        });
        const out = [];
        for (const width of [390, 1440]) {
          await openTasksAt(empty.page, base, width, 800);
          await press(empty.page, /^Mis tareas/, '.tk-toolbar');
          await sleep(600);
          await empty.page.waitForSelector('.ui-collapse[data-state="open"] .tk-board-empty', { timeout: 3000 });
          const probe = await probeView(empty.page, { scope: '.tk-screen', scrollSteps: 0 });
          assert(!probe.total, `${width}: ${formatProbe(probe)}`);
          const lane = await empty.page.$eval('.tk-lane-empty', el => ({ icon: Boolean(el.querySelector('.ui-empty-icon svg')), h: Math.round(el.getBoundingClientRect().height) }));
          assert(lane.icon && lane.h <= 96, `vacío de columna: ${JSON.stringify(lane)}`);
          out.push(`${width}: vacío de columna ${lane.h} px con ícono`);
        }
        await press(empty.page, /^Nueva tarea privada$/, '.tk-board-empty');
        await empty.page.waitForSelector('form.tk-form [role="radio"][aria-checked="true"]');
        const vis = await empty.page.$eval('form.tk-form [role="radio"][aria-checked="true"]', el => el.textContent);
        assert(/Mi tarea/.test(vis), `el alta abrió como ${vis}`);
        return `${out.join(' · ')}; la acción abre el alta como privada`;
      } finally {
        await empty.context.close().catch(() => {});
        track(page);
      }
    });

    await test('tk-ux', 'Tareas', 'Sonda REGLAS-UX en estados abiertos (360/768/1440, oscuro y claro): sin huecos, recortes, tapados ni alturas dispares', async () => {
      const issues = [];
      const states = {
        tablero: async () => {},
        prioridad: async () => { await press(page, /^Prioridad$/, '.tk-toolbar'); await sleep(500); },
        alta: async () => { await gooey(page, 'Nueva tarea del grupo'); await sleep(400); },
        columna: async () => { await gooey(page, 'Nueva columna'); await sleep(400); },
        editarColumna: async () => { await page.click('.tk-lane .tk-lane-edit'); await sleep(400); await press(page, /^Eliminar columna$/, '.tk-col-edit'); await sleep(400); }
      };
      let runs = 0;
      for (const width of [360, 768, 1440]) {
        for (const [name, run] of Object.entries(states)) {
          for (const theme of name === 'tablero' ? ['dark', 'light'] : ['dark']) {
            await openTasksAt(page, base, width, width < 768 ? 800 : 900);
            await setTheme(page, theme);
            await run();
            const probe = await probeView(page, { scope: '.tk-screen', scrollSteps: 3 });
            if (probe.total) issues.push(`${name} ${width} ${theme}: ${formatProbe(probe).slice(0, 300)}`);
            for (const row of await page.evaluate(unevenRows, '.tk-screen')) issues.push(`${name} ${width}: ${row}`);
            const hx = await page.evaluate(() => { const sc = document.querySelector('.shell-scroll'); return sc.scrollWidth > sc.clientWidth + 1 || document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth + 1; });
            if (hx) issues.push(`${name} ${width}: scroll horizontal`);
            runs += 1;
          }
        }
      }
      assert(!issues.length, issues.slice(0, 6).join(' | '));
      return `${runs} combinaciones en cero`;
    });
  } finally {
    await context.close().catch(() => {});
  }
}
