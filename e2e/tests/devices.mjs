// Pruebas de Dispositivos e Historial (etapa 5a): selección con Ctrl/Shift,
// lotes en un solo request, selección acotada a lo visible, página del equipo y
// búsqueda por alias en el Historial. Corren contra la copia de la base.
import { assert, clickButton, clickStable, findButton, gotoView, openContext, pathname, sleep, text, typeInto, until, waitStable } from '../lib/browser.mjs';
import { COOKIE_NAME } from '../lib/env.mjs';
import { settle, setTheme } from '../lib/ux-probe.mjs';

/* ── Revisión UX 4 (20/10): ayudas compartidas con tests/inventory.mjs ────── */

/**
 * Toca `handle` con el mouse y mide, cuadro a cuadro (después de pintar cada
 * frame), el alto de `watch` y la posición del control tocado. Devuelve el
 * alto inicial y final, cuántos cuadros pasaron por un alto intermedio y
 * cuánto se movió el control (drift). "De golpe" = sin intermedios.
 */
export async function traceHeight(page, handle, watch, { ms = 480 } = {}) {
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await handle.evaluate(el => { el.scrollIntoView({ block: 'center' }); el.setAttribute('data-ux4-trigger', ''); });
  await sleep(200);
  await page.evaluate((sel, dur) => {
    window.__ux4 = [];
    const t0 = performance.now();
    const measure = () => {
      const el = document.querySelector(sel);
      const trigger = document.querySelector('[data-ux4-trigger]');
      window.__ux4.push({ h: el ? el.getBoundingClientRect().height : -1, y: trigger?.isConnected ? trigger.getBoundingClientRect().top : null });
      if (performance.now() - t0 < dur) requestAnimationFrame(() => setTimeout(measure, 0));
    };
    requestAnimationFrame(() => setTimeout(measure, 0));
  }, watch, ms);
  await handle.click();
  await sleep(ms + 150);
  const frames = await page.evaluate(() => {
    document.querySelector('[data-ux4-trigger]')?.removeAttribute('data-ux4-trigger');
    return window.__ux4;
  });
  const start = frames[0].h;
  const end = frames[frames.length - 1].h;
  const mids = frames.filter(frame => Math.abs(frame.h - start) > 2 && Math.abs(frame.h - end) > 2).length;
  const ys = frames.map(frame => frame.y).filter(y => y !== null);
  const drift = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  return { start: Math.round(start), end: Math.round(end), mids, drift: Math.round(drift * 10) / 10 };
}

/** Falla si el alto pasó del inicial al final en un cuadro (sin intermedios) o si el control tocado se movió. */
export function assertSmooth(label, trace, { minDelta = 24, maxDrift = 2 } = {}) {
  const delta = Math.abs(trace.end - trace.start);
  assert(delta < minDelta || trace.mids >= 1, `${label}: el alto pasó de ${trace.start} a ${trace.end} px de golpe (${trace.mids} cuadros intermedios).`);
  assert(trace.drift <= maxDrift, `${label}: el control tocado se movió ${trace.drift} px.`);
  return `${label} ${trace.start}→${trace.end} (${trace.mids} intermedios, ${trace.drift} px)`;
}

/** Botón (o control) visible dentro de `scope` cuyo texto cumple `rx`. */
export async function handleByText(page, scope, rx) {
  return until(async () => {
    const handle = await page.evaluateHandle((sel, src, flags) => {
      const re = new RegExp(src, flags);
      return [...document.querySelectorAll(sel)].find(node => re.test((node.textContent || '').replace(/\s+/g, ' ').trim()) && node.getBoundingClientRect().width && !node.disabled) || null;
    }, scope, rx.source, rx.flags);
    return handle.asElement();
  }, { message: `${scope} ${rx}` });
}

/**
 * Cajas vecinas de una fila (hijos de `row` en la misma línea) con distinto
 * alto o desalineadas. `boxes` = selectores de las cajas que se comparan.
 */
export function rowMismatch(row, boxes) {
  const list = boxes.map(sel => document.querySelector(`${row} ${sel}`)).filter(Boolean)
    .map(el => ({ el, r: el.getBoundingClientRect() })).filter(item => item.r.width && item.r.height);
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i].r;
      const b = list[j].r;
      if (Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) < Math.min(a.height, b.height) / 2) continue; // otra línea
      if (Math.abs(a.height - b.height) > 1 || Math.abs(a.top - b.top) > 1) out.push(`${boxes[i]} ${Math.round(a.height)}px@${Math.round(a.top)} vs ${boxes[j]} ${Math.round(b.height)}px@${Math.round(b.top)}`);
    }
  }
  return out;
}

/** Textos cortados con elipsis (o line-clamp) que no se pueden leer: ni TruncatedText con tooltip ni campo. */
export function unreadableCuts(scope) {
  const root = document.querySelector(scope);
  if (!root) return [`no está ${scope}`];
  const out = [];
  for (const el of root.querySelectorAll('*')) {
    if (el.closest('.ui-collapse:not([data-state="open"])')) continue;
    const s = getComputedStyle(el);
    const clamp = s.webkitLineClamp && s.webkitLineClamp !== 'none';
    if (s.textOverflow !== 'ellipsis' && !clamp) continue;
    if (!el.textContent.trim() || !el.getClientRects().length) continue;
    const cut = clamp ? el.scrollHeight > el.clientHeight + 1 : el.scrollWidth > el.clientWidth + 1;
    if (!cut || el.closest('.ui-trunc.is-cut, input, textarea, .ui-input, .ui-th-sort')) continue;
    out.push(`${el.className || el.tagName}: "${el.textContent.trim().slice(0, 40)}"`);
  }
  return out;
}

/** Del borde de arriba del área que scrollea al primer texto o control de la vista. */
export function topGap(scope) {
  const scroller = document.querySelector('.shell-scroll');
  const view = document.querySelector(scope);
  if (!scroller || !view) return null;
  const walker = document.createTreeWalker(view, NodeFilter.SHOW_ELEMENT);
  for (let el = walker.currentNode; el; el = walker.nextNode()) {
    const r = el.getBoundingClientRect();
    if (!r.height || !r.width) continue;
    const ownText = [...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim());
    if (ownText || /^(BUTTON|INPUT|IMG|SVG)$/i.test(el.tagName)) return Math.round(r.top - scroller.getBoundingClientRect().top + scroller.scrollTop);
  }
  return null;
}

/* Datos largos para la ficha, la papelera y los grupos (se sirven interceptando los GET). */
const LONG_PERSON = 'María Fernanda Rodríguez Alonso de la Vega Etcheverry';
const LONG_PLACE = 'Laboratorio de ciencias naturales del segundo piso, ala norte';
const LONG_MODEL = 'Chromebook Lenovo 300e Gen 3 Convertible AMD Ryzen 3 3250C';
const LONG_GROUP = 'Carro de Chromebooks del segundo piso — préstamos de secundaria';

async function serveLongDevices(page, api) {
  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);
  page.on('request', async request => {
    if (request.isInterceptResolutionHandled?.()) return;
    const url = new URL(request.url());
    const json = body => request.respond({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
    try {
      if (request.method() !== 'GET' || !url.pathname.startsWith('/api/')) return request.continue();
      if (url.pathname === '/api/devices') {
        const { data } = await api.get(url.pathname + url.search);
        data.items = data.items.map((device, i) => (i === 0 ? { ...device, modelo: LONG_MODEL, sn: 'PF2SC1TRX9Q8W7E6R5T4Y3U2I1O0P', estado: 'Prestado', prestadoA: LONG_PERSON, rol: 'Docente de nivel secundario', ubicacion: LONG_PLACE, loanedAt: new Date(Date.now() - 86400000).toISOString() } : device));
        return json(data);
      }
      if (/^\/api\/devices\/[^/]+\/overview$/.test(url.pathname)) {
        const { data } = await api.get(url.pathname);
        data.timeline = [{ action: 'Préstamo registrado con un texto de acción largo', date: new Date().toISOString(), user: LONG_PERSON, notes: `${LONG_PLACE} — nota adicional larga`, source: 'Préstamos' }, ...(data.timeline || [])];
        data.recentTickets = [{ id: 1, numero: 'T-0001', titulo: 'La pantalla parpadea cuando se conecta el cargador y después se apaga sola', estado: 'En progreso', prioridad: 'Alta', categoria: 'Hardware', updatedAt: new Date().toISOString() }];
        data.maintenanceHistory = [{ id: 1, title: 'Cambio de batería y limpieza interna completa del teclado', date: new Date().toISOString(), status: 'Hecho', notes: 'Se reemplazó la batería original por una compatible de mayor capacidad' }];
        data.group = { id: 1, name: LONG_GROUP, description: 'Equipos que se guardan en el carro con llave del pasillo, ala norte, junto a la sala de profesores', classroomKey: '', members: (data.group?.members || []).slice(0, 4) };
        return json(data);
      }
      if (url.pathname === '/api/devices/deleted') {
        const { data } = await api.get(url.pathname);
        data.items = [{ etiqueta: 'D9999', deletedAt: new Date().toISOString(), deletedBy: LONG_PERSON, reason: '', alias: 'Touch 999 con un alias muy largo para la papelera', categoria: 'Chromebook', modelo: LONG_MODEL }, ...(data.items || [])];
        return json(data);
      }
      if (url.pathname === '/api/device-groups') {
        const { data } = await api.get(url.pathname);
        data.items = [{ id: 9991, name: LONG_GROUP, description: 'Equipos del carro con llave', classroomKey: '', members: [] }, ...(data.items || [])];
        return json(data);
      }
      return request.continue();
    } catch {
      return request.continue().catch(() => {});
    }
  });
}

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
      await clickButton(page, /^Deshacer/, { scope: '.dv-list > .ui-collapse .ui-status' });
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

  /* ── Revisión UX 4 (20/10): nada de golpe, vecinos parejos, textos legibles ── */

  await test('d', 'Dispositivos', 'Filtro de estado, tipo y "Ver más": la lista cambia de alto suave y el control tocado no se mueve', async () => {
    await page.setViewport({ width: 1440, height: 900 });
    await gotoView(page, base, 'devices');
    await page.waitForSelector(ROW, { timeout: 20000 });
    await settle(page);
    const results = [];
    results.push(assertSmooth('Prestados', await traceHeight(page, await handleByText(page, '.dv-filters .ui-seg-item', /^Prestados/), '.dv-list-body')));
    results.push(assertSmooth('Todos', await traceHeight(page, await handleByText(page, '.dv-filters .ui-seg-item', /^Todos/), '.dv-list-body')));
    const segs = await page.$$('.dv-filters .ui-seg');
    const type = segs[1] ? await segs[1].$$('.ui-seg-item') : [];
    if (type.length > 2) {
      results.push(assertSmooth('Tipo', await traceHeight(page, type[1], '.dv-list-body')));
      results.push(assertSmooth('Tipo: todos', await traceHeight(page, type[0], '.dv-list-body')));
    }
    const more = await findButton(page, /^Ver más$/, { scope: '.dv-foot' });
    if (more) results.push(assertSmooth('Ver más', await traceHeight(page, more, '.dv-list-body')));
    return results.join(' · ');
  });

  await test('d', 'Dispositivos', 'Marcar y confirmar un lote: el encabezado cambia de alto suave; buscador, orden y barra con el mismo alto', async () => {
    const out = [];
    for (const width of [1440, 768]) {
      await page.setViewport({ width, height: 900 });
      await gotoView(page, base, 'devices');
      await page.waitForSelector(ROW, { timeout: 20000 });
      await settle(page);
      const before = await page.evaluate(rowMismatch, '.dv-list-head', ['.dv-search .ui-control', '.ui-seg']);
      assert(!before.length, `${width}: ${before.join(' | ')}`);
      await clickRow(page, tagA, 'Control');
      await until(async () => (await selCount(page)) === 1, { message: 'un equipo marcado' });
      await sleep(350);
      const marked = await page.evaluate(rowMismatch, '.dv-list-head', ['.ui-selhead', '.dv-search .ui-control', '.ui-seg']);
      assert(!marked.length, `${width} con selección: ${marked.join(' | ')}`);
      const ask = assertSmooth(`${width} Borrar 1`, await traceHeight(page, await handleByText(page, '.dv-list-head .ui-selhead button', /^Borrar 1$/), '.dv-list-head'), { minDelta: 12 });
      const back = assertSmooth(`${width} Cancelar`, await traceHeight(page, await handleByText(page, '.dv-list-head .ui-confirm button', /^Cancelar$/), '.dv-list-head'), { minDelta: 12 });
      await clickButton(page, /^Limpiar$/, { scope: '.dv-list .ui-selhead' });
      await until(async () => (await selCount(page)) === 0, { message: 'Limpiar' });
      out.push(ask, back);
    }
    await page.setViewport({ width: 1366, height: 900 });
    return out.join(' · ');
  });

  await test('d', 'Dispositivos', 'Datos largos: ficha, papelera y grupos sin textos cortados ilegibles; sin espacio muerto arriba (390/1440, oscuro y claro)', async () => {
    const token = (await page.cookies()).find(cookie => cookie.name === COOKIE_NAME)?.value;
    assert(token, 'Sin cookie de sesión para abrir otro contexto.');
    const { context, page: long } = await openContext(page.browser(), { base, token, viewport: { width: 1440, height: 900 } });
    const out = [];
    try {
      await serveLongDevices(long, api);
      await gotoView(long, base, 'devices');
      await long.waitForSelector(ROW, { timeout: 20000 });
      await settle(long);
      await (await long.$(`${ROW} .dv-c-eq`)).click();
      await long.waitForSelector('.dv-table .dv-detail .dv-tl-body');
      await sleep(500);
      await clickButton(long, /^Papelera/, { scope: '.dv-head-actions' });
      await long.waitForSelector('.dv-trash-item');
      await clickButton(long, /^Grupos/, { scope: '.dv-head-actions' });
      await long.waitForSelector('.dv-group-item');
      await sleep(500);
      for (const width of [390, 1440]) {
        for (const theme of ['dark', 'light']) {
          await long.setViewport({ width, height: 900 });
          await setTheme(long, theme);
          await sleep(300);
          const cuts = await long.evaluate(unreadableCuts, '.dv-page');
          assert(!cuts.length, `${width} ${theme}: cortados sin tooltip: ${cuts.slice(0, 4).join(' | ')}`);
          const gap = await long.evaluate(topGap, '.dv-page');
          assert(gap !== null && gap <= 32, `${width} ${theme}: ${gap} px vacíos arriba del primer bloque.`);
          out.push(`${width}/${theme}: arriba ${gap} px`);
        }
      }
      // La página del equipo también.
      const tag = (await api.devices())[0].etiqueta;
      await long.goto(`${base}/sede/NFPT/devices/${tag}`, { waitUntil: 'domcontentloaded' });
      await long.waitForSelector('.dv-detail--page .dv-tl-body', { timeout: 20000 });
      for (const width of [390, 1440]) {
        await long.setViewport({ width, height: 900 });
        await sleep(300);
        const cuts = await long.evaluate(unreadableCuts, '.dv-page');
        assert(!cuts.length, `página ${width}: ${cuts.slice(0, 4).join(' | ')}`);
        const gap = await long.evaluate(topGap, '.dv-page');
        assert(gap !== null && gap <= 32, `página ${width}: ${gap} px vacíos arriba.`);
      }
    } finally {
      await context.close().catch(() => {});
    }
    return out.join(' · ');
  });
}
