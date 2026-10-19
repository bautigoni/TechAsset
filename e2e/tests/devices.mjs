// Pruebas de Dispositivos e Historial (etapa 5a): selección con Ctrl/Shift,
// lotes en un solo request, selección acotada a lo visible, página del equipo y
// búsqueda por alias en el Historial. Corren contra la copia de la base.
import { assert, clickButton, clickStable, findButton, gotoView, pathname, sleep, text, typeInto, until, waitStable } from '../lib/browser.mjs';

const ROW = '.dv-table [data-device-tag]';
const SEARCH = '.dv-search input';

async function showAll(page) {
  // Se vuelve a buscar si la lista se rearmó entre encontrarlo y el click (y si ya no está, ya se ve todo).
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const more = await findButton(page, /^Ver todos$/, { scope: '.dv-foot' });
    if (!more) return;
    await waitStable(more);
    try {
      await more.click();
      await sleep(150);
      return;
    } catch (error) {
      if (!/not clickable|not an Element|detached/i.test(String(error?.message || error))) throw error;
    }
  }
}

async function row(page, tag) {
  return page.waitForSelector(`.dv-table [data-device-tag="${tag}"]`, { timeout: 15000 });
}

/** Click en la fila sobre una celda de texto (no en botones ni en la casilla). */
async function clickRow(page, tag, modifier) {
  await clickStable(page, async () => {
    const handle = await row(page, tag);
    return await handle.$('.dv-c-eq') || handle;
  }, { modifier });
}

async function selCount(page) {
  const label = await text(page, '.dv-list .ui-selhead-count');
  return Number(label.match(/\d+/)?.[0] || 0);
}

/** Cuenta requests a una ruta mientras corre `fn`. */
async function countRequests(page, rx, fn) {
  const seen = [];
  const onRequest = request => { if (rx.test(new URL(request.url()).pathname)) seen.push(`${request.method()} ${new URL(request.url()).pathname}`); };
  page.on('request', onRequest);
  try { await fn(); } finally { page.off('request', onRequest); }
  return seen;
}

export async function devicesTests({ page, base, api, test, free }) {
  const [tagA, tagB, tagC] = free;
  const estado = async tag => (await api.device(tag))?.estado || '';

  await test('d', 'Dispositivos', 'Ctrl+Click marca sin abrir la ficha; "Cambiar estado" en lote es un solo request', async () => {
    assert(tagA && tagB, 'No hay dos equipos libres de sobra en la copia.');
    await gotoView(page, base, 'devices');
    await page.waitForSelector(ROW, { timeout: 20000 });
    await showAll(page);
    await clickRow(page, tagA, 'Control');
    await clickRow(page, tagB, 'Meta');
    await until(async () => (await selCount(page)) === 2, { message: 'la barra de selección con 2' });
    assert(!(await page.$('.dv-detail')), 'Ctrl/⌘+clic abrió la ficha.');
    const requests = await countRequests(page, /^\/api\/devices\/status/, async () => {
      await clickButton(page, /^Cambiar estado$/, { scope: '.dv-list .ui-selhead' });
      await clickButton(page, /^En reparación$/, { scope: '.dv-list .ui-selhead' });
      await clickButton(page, /^Cambiar 2$/, { scope: '.dv-list .ui-selhead' });
      await until(async () => (await estado(tagA)) === 'En reparación' && (await estado(tagB)) === 'En reparación', { message: 'los dos en reparación en la base' });
    });
    assert(requests.length === 1 && /status-batch/.test(requests[0]), `Requests: ${requests.join(', ') || 'ninguno'}`);
    // Vuelta atrás por la misma barra.
    await until(async () => (await selCount(page)) === 0, { message: 'que se limpie la selección' });
    await clickRow(page, tagA, 'Control');
    await clickRow(page, tagB, 'Control');
    await clickButton(page, /^Cambiar estado$/, { scope: '.dv-list .ui-selhead' });
    await clickButton(page, /^Disponible$/, { scope: '.dv-list .ui-selhead' });
    await clickButton(page, /^Cambiar 2$/, { scope: '.dv-list .ui-selhead' });
    await until(async () => (await estado(tagA)) === 'Disponible' && (await estado(tagB)) === 'Disponible', { message: 'los dos disponibles de nuevo' });
    return `${tagA}, ${tagB} → En reparación → Disponible (${requests[0]})`;
  });

  await test('d', 'Dispositivos', 'Shift+Click marca el rango visible; "Borrar N" en un request con Deshacer', async () => {
    assert(tagA && tagC, 'No hay equipos libres de sobra en la copia.');
    await gotoView(page, base, 'devices');
    await page.waitForSelector(ROW, { timeout: 20000 });
    await showAll(page);
    const order = await page.$$eval(ROW, list => list.map(item => item.getAttribute('data-device-tag')));
    const [from, to] = [order.indexOf(tagA), order.indexOf(tagC)].sort((a, b) => a - b);
    await clickRow(page, tagA, 'Control');
    await clickRow(page, tagC, 'Shift');
    const expected = to - from + 1;
    await until(async () => (await selCount(page)) === expected, { message: `el rango de ${expected}` });
    await clickButton(page, /^Limpiar$/, { scope: '.dv-list .ui-selhead' });
    await until(async () => (await selCount(page)) === 0, { message: 'Limpiar' });

    await clickRow(page, tagA, 'Control');
    await clickRow(page, tagB, 'Control');
    const deletes = await countRequests(page, /^\/api\/devices\/(delete-batch|restore-batch|[^/]+\/restore|D\d+)$/, async () => {
      await clickButton(page, /^Borrar 2$/, { scope: '.dv-list .ui-selhead' });
      await clickButton(page, /^Borrar 2$/, { scope: '.dv-list .ui-selhead .ui-confirm' });
      await until(async () => !(await api.device(tagA)) && !(await api.device(tagB)), { message: 'los dos en la papelera' });
      await clickButton(page, /^Deshacer/, { scope: '.dv-list > .ui-status' });
      await until(async () => Boolean(await api.device(tagA)) && Boolean(await api.device(tagB)), { message: 'los dos restaurados por Deshacer' });
    });
    assert(deletes.length === 2 && deletes.some(item => /delete-batch/.test(item)) && deletes.some(item => /restore-batch/.test(item)), `Requests: ${deletes.join(', ')}`);
    return `rango ${expected}; borrar y deshacer: ${deletes.join(' + ')}`;
  });

  await test('d', 'Dispositivos', 'La selección se acota a lo visible y avisa los ocultos', async () => {
    await gotoView(page, base, 'devices');
    await page.waitForSelector(ROW, { timeout: 20000 });
    await showAll(page);
    await clickRow(page, tagA, 'Control');
    // Con selección, la barra reemplaza al encabezado; los filtros siguen a mano.
    await clickButton(page, /^Prestados/, { scope: '.dv-filters' });
    await until(async () => /1 oculto por el filtro/.test(await text(page, '.dv-list .ui-selhead')), { message: 'el aviso de ocultos' });
    const bar = await text(page, '.dv-list .ui-selhead');
    assert(!/Borrar \d/.test(bar), `Con lo marcado oculto ofrece borrar: "${bar}"`);
    await clickButton(page, /^Desmarcar ocultos$/, { scope: '.dv-list .ui-selhead' });
    await until(async () => (await selCount(page)) === 0, { message: 'que se desmarquen' });
    await clickButton(page, /^Todos/, { scope: '.dv-filters' });
    await page.waitForSelector(SEARCH);
    return `"${bar}"`;
  });

  await test('d', 'Dispositivos', 'La ficha abre en línea y como página (/devices/<etiqueta>), con Atrás', async () => {
    await gotoView(page, base, 'devices');
    await page.waitForSelector(ROW, { timeout: 20000 });
    await typeInto(page, SEARCH, tagA);
    await (await row(page, tagA)).focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('.dv-table .dv-detail', { timeout: 8000 });
    await clickButton(page, /^Abrir como página$/, { scope: '.dv-detail' });
    await until(async () => (await pathname(page)).endsWith(`/devices/${tagA.toLowerCase()}`), { message: 'la URL de la página del equipo' });
    await page.waitForSelector('.dv-detail--page');
    await page.goBack();
    await until(async () => (await pathname(page)).endsWith('/devices'), { message: 'Atrás vuelve a la lista' });
    await page.waitForSelector(ROW);
    // Deep link directo.
    await page.goto(`${base}/sede/NFPT/devices/${tagB}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.dv-detail--page', { timeout: 20000 });
    const title = await text(page, '.dv-detail--page .dv-tag');
    assert(title === tagB, `La página muestra "${title}" (esperaba ${tagB}).`);
    // "Dispositivos" en el menú estando en la página del equipo: vuelve a la lista y la URL pierde la etiqueta.
    await page.click('.shell-nav-item[data-view="devices"]');
    await until(async () => (await pathname(page)).endsWith('/devices'), { message: 'el menú vuelve a /devices' });
    await page.waitForSelector(ROW);
    return `${tagA} en línea → página → Atrás; deep link ${tagB} → menú → lista`;
  });

  await test('d', 'Historial', 'Buscar por alias sin espacio (touch34) encuentra al equipo; resumen en línea; CSV de todo lo filtrado', async () => {
    const devices = await api.devices();
    const history = (await api.get('/api/history?kind=loans&limit=200')).data.items || [];
    const known = new Map(devices.map(device => [String(device.etiqueta).toUpperCase(), device]));
    const pick = history.find(item => /^(touch|plani|tic|dell)\s+\d+$/i.test(item.alias || '') && known.has(String(item.etiqueta).toUpperCase()));
    assert(pick, 'No hay préstamos con alias Touch/Plani/TIC/Dell en la copia.');
    const compact = pick.alias.replace(/\s+/g, '').toLowerCase();
    await gotoView(page, base, 'history');
    await page.waitForSelector('.hs-search input', { timeout: 20000 });
    await typeInto(page, '.hs-search input', compact);
    await until(async () => {
      const tags = await page.$$eval('.hs-item .hs-c-eq', cells => cells.map(cell => cell.textContent || ''));
      return tags.length > 0 && tags.every(value => value.toUpperCase().includes(pick.etiqueta.toUpperCase()));
    }, { timeout: 10000, message: `que "${compact}" traiga solo ${pick.etiqueta}` });
    const count = (await page.$$('.hs-item')).length;
    const csv = await api.get(`/api/history/export.csv?kind=loans&q=${encodeURIComponent(compact)}&tags=${encodeURIComponent(pick.etiqueta)}`);
    // (fetch().text() se come el BOM: acá se mira el contenido.)
    const raw = String(csv.data.raw || '');
    assert(csv.status === 200 && raw.includes('Fecha,Tipo,Etiqueta') && raw.includes(pick.etiqueta), `CSV: ${raw.slice(0, 80)}`);
    const lines = raw.trim().split('\n').length - 1;
    await (await page.waitForSelector('.hs-eq-btn')).click();
    await page.waitForSelector('.hs-mini');
    await clickButton(page, /^Abrir ficha completa$/, { scope: '.hs-mini' });
    await until(async () => (await pathname(page)).endsWith(`/devices/${pick.etiqueta.toLowerCase()}`), { message: 'la página del equipo' });
    return `"${compact}" → ${count} filas de ${pick.etiqueta}; CSV ${lines} filas; resumen → página`;
  });
}
