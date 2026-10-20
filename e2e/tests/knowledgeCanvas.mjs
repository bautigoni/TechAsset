// Etapa 7c: Base de conocimiento y Canvas. Cada prueba verifica el efecto en la
// base por API. Prende los módulos `knowledge` y `canvas` en la copia (arrancan
// apagados en las sedes existentes): así también entran en la línea base de layout.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KnownDevices } from 'puppeteer-core';
import { assert, gotoView, openContext, pathname, sleep, typeInto, until } from '../lib/browser.mjs';

const ROW = '.kb-row';

async function clickText(page, selector, rx, { enabledOnly = true } = {}) {
  await until(() => page.evaluate((sel, src, flags, onlyEnabled) => {
    const re = new RegExp(src, flags);
    const el = [...document.querySelectorAll(sel)].find(node => re.test((node.textContent || '').replace(/\s+/g, ' ').trim()) && node.getBoundingClientRect().width && (!onlyEnabled || !node.disabled));
    if (!el) return false;
    el.click();
    return true;
  }, selector, rx.source, rx.flags, enabledOnly), { message: `${selector} ${rx}` });
  await sleep(200);
}

const articles = async api => (await api.get('/api/knowledge/articles?limit=200')).data.items || [];
const canvasItems = async api => (await api.get('/api/canvas/items')).data.items || [];

async function openKnowledge(page, base, suffix = '') {
  await gotoView(page, base, `knowledge${suffix}`);
  await page.waitForSelector('.kb-page', { timeout: 20000 });
}

async function openCanvas(page, base) {
  await gotoView(page, base, 'canvas');
  await page.waitForSelector('.cv-board', { timeout: 20000 });
  await until(() => page.$eval('.cv-head .cv-count', el => el.textContent.trim().length > 0).catch(() => false), { message: 'el canvas cargado' });
}

const zoomLabel = page => page.$eval('.cv-zoom-pct', el => el.textContent.trim());

/* ── Revisión UX 10 (20/10): nada cambia de alto de golpe y vecinos parejos ── */

/**
 * Toca `trigger` (con pointerdown, como el mouse) y mide cuadro a cuadro el alto
 * de `watch` y cuánto se movió el disparador. Corre con la animación prendida.
 */
export async function watchHeight(page, { trigger, watch, ms = 900 }) {
  return page.evaluate(async (triggerSel, watchSel, duration) => {
    const el = typeof triggerSel === 'string' ? document.querySelector(triggerSel) : null;
    const box = document.querySelector(watchSel);
    if (!el || !box) return { error: `no está ${el ? watchSel : triggerSel}` };
    const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
    const top0 = el.getBoundingClientRect().top;
    const heights = [Math.round(box.getBoundingClientRect().height)];
    let moved = 0;
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    el.click();
    const until = performance.now() + duration;
    while (performance.now() < until) {
      await frame();
      const current = document.querySelector(watchSel);
      if (!current) break;
      heights.push(Math.round(current.getBoundingClientRect().height));
      if (el.isConnected) moved = Math.max(moved, Math.abs(el.getBoundingClientRect().top - top0));
    }
    return { heights, moved: Math.round(moved * 10) / 10 };
  }, trigger, watch, ms);
}

/** Pasó por valores intermedios (no saltó del alto viejo al nuevo en un cuadro). */
export function smooth(heights) {
  const start = heights[0];
  const end = heights[heights.length - 1];
  if (Math.abs(end - start) < 24) return { ok: true, start, end, steps: 0 };
  const lo = Math.min(start, end) + 4;
  const hi = Math.max(start, end) - 4;
  const steps = heights.filter(h => h > lo && h < hi).length;
  return { ok: steps >= 3, start, end, steps };
}

/**
 * Cajas vecinas de una fila (botones, campos, chips, kbd, tarjetas) con distinta
 * altura. Por cada hijo de un flex/grid en fila toma su caja visible (él o su
 * descendiente con borde o fondo más grande) y compara las que comparten renglón.
 */
export function unevenRows({ scope, ignore = '' }) {
  const root = document.querySelector(scope);
  if (!root) return [`no está ${scope}`];
  const visible = el => (el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : el.getClientRects().length > 0);
  const inert = el => el.closest('[inert], [aria-hidden="true"], .ui-collapse:not([data-state="open"]), [data-ux-ignore]') || (ignore && el.closest(ignore));
  const boxy = el => {
    const s = getComputedStyle(el);
    if (s.position === 'absolute' || s.position === 'fixed') return false;
    return (parseFloat(s.borderTopWidth) > 0 && parseFloat(s.borderBottomWidth) > 0) || s.backgroundColor !== 'rgba(0, 0, 0, 0)';
  };
  const describe = el => `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).slice(0, 2).join('.')} "${(el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24)}"`;
  const pick = start => {
    let best = null;
    const walk = (node, depth) => {
      if (!visible(node) || inert(node)) return;
      if (boxy(node)) {
        const r = node.getBoundingClientRect();
        if (!best || r.width * r.height > best.r.width * best.r.height) best = { el: node, r };
        return;
      }
      if (depth < 3) for (const child of node.children) walk(child, depth + 1);
    };
    walk(start, 0);
    return best;
  };
  const out = new Set();
  for (const parent of root.querySelectorAll('*')) {
    if (!visible(parent) || inert(parent) || parent.closest('svg')) continue;
    const s = getComputedStyle(parent);
    if (!/(flex|grid)/.test(s.display) || (s.display.includes('flex') && s.flexDirection.startsWith('column'))) continue;
    const kids = [...parent.children].map(pick).filter(item => item && item.r.height > 8 && item.r.width > 8);
    for (let i = 0; i < kids.length; i += 1) {
      for (let j = i + 1; j < kids.length; j += 1) {
        const a = kids[i];
        const b = kids[j];
        const shared = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (shared < Math.min(a.r.height, b.r.height) * 0.5) continue;
        if (Math.abs(a.r.height - b.r.height) > 2) out.add(`${describe(a.el)} ${Math.round(a.r.height)} px vs ${describe(b.el)} ${Math.round(b.r.height)} px`);
      }
    }
  }
  return [...out].slice(0, 10);
}

export async function knowledgeCanvasTests({ browser, base, api, apiConsulta, admin, consulta, releaseVersion, test, track = () => {} }) {
  // Módulos prendidos en la copia.
  const settings = (await api.get('/api/site-settings')).data.settings || {};
  const enabled = new Set([...(Array.isArray(settings['modules.enabled']) ? settings['modules.enabled'] : []), 'knowledge', 'canvas']);
  await api.patch('/api/site-settings', { settings: { 'modules.enabled': [...enabled] } });

  // Datos: artículos con tildes y categorías, y suficientes para paginar.
  const stamp = Date.now().toString(36);
  await api.post('/api/knowledge/articles', { title: `Conexión del proyector ${stamp}`, category: 'Proyectores', tags: ['hdmi'], content: '<p>Usá el cable <strong>HDMI</strong>.</p>' });
  for (let i = 0; i < 34; i += 1) {
    await api.post('/api/knowledge/articles', { title: `Relleno ${stamp} ${String(i).padStart(2, '0')}`, category: i % 2 ? 'General' : 'Redes', content: `<p>Texto ${i}</p>` });
  }

  const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width: 1366, height: 900 } });
  track(page);

  try {
    await test('kb', 'Conocimiento', 'Editor en la página: el cursor no salta al tipear, formato, tags de corrido y URL por artículo', async () => {
      await openKnowledge(page, base);
      await clickText(page, '.kb-list button', /^Nuevo artículo$/);
      await page.waitForSelector('.kb-editor');
      assert((await pathname(page)).endsWith('/knowledge/nuevo'), `URL del editor: ${await pathname(page)}`);
      const title = `Artículo e2e ${stamp}`;
      await page.type('#kb-title', title);
      await page.click('.kb-rich-body');
      const typed = 'Hola mundo, esto se escribe de corrido';
      await page.keyboard.type(typed, { delay: 8 });
      await page.keyboard.press('Enter');
      await clickText(page, '.kb-fmt', /Negrita/);
      await page.keyboard.type('fuerte', { delay: 8 });
      const bodyText = await page.$eval('.kb-rich-body', el => el.textContent);
      assert(bodyText.startsWith(typed), `El texto quedó desordenado (cursor que salta): "${bodyText}"`);
      const tagInput = await page.$('.kb-editor .ui-tags input');
      await tagInput.type('wifi,red,');
      const chips = await page.$$eval('.kb-editor .ui-tag-text', nodes => nodes.map(node => node.textContent));
      assert(chips.includes('wifi') && chips.includes('red'), `Tags: ${chips.join(', ')}`);
      // Doble click en Guardar no duplica.
      const save = await until(() => page.evaluateHandle(() => [...document.querySelectorAll('.kb-editor-foot button')].find(b => /Guardar artículo/.test(b.textContent))).then(h => h.asElement()), { message: 'Guardar' });
      await save.click({ clickCount: 2 });
      await page.waitForSelector('.kb-reader', { timeout: 10000 });
      const saved = (await articles(api)).filter(item => item.title === title);
      assert(saved.length === 1, `Se guardaron ${saved.length} artículos con ese título.`);
      assert(/<strong>fuerte<\/strong>/.test(saved[0].content) && saved[0].content.includes(typed), `Contenido guardado: ${saved[0].content}`);
      assert(saved[0].tags.includes('wifi') && saved[0].tags.includes('red'), 'Tags no guardados');
      assert((await pathname(page)).endsWith(`/knowledge/${saved[0].id}`), `URL tras guardar: ${await pathname(page)}`);
      return `id ${saved[0].id}`;
    });

    await test('kb', 'Conocimiento', 'Validación: sin título no guarda y avisa; los valores quedan', async () => {
      const before = (await articles(api)).length;
      await clickText(page, '.kb-list button', /^Nuevo artículo$/);
      await page.waitForSelector('.kb-editor');
      await page.click('.kb-rich-body');
      await page.keyboard.type('Contenido sin título');
      await clickText(page, '.kb-editor-foot button', /Guardar artículo/);
      await page.waitForSelector('.kb-editor .ui-help--bad');
      const kept = await page.$eval('.kb-rich-body', el => el.textContent);
      assert(kept.includes('Contenido sin título'), 'Se perdió lo escrito.');
      assert((await articles(api)).length === before, 'Se creó un artículo sin título.');
      // Cancelar con cambios pide confirmación en línea.
      await clickText(page, '.kb-editor-foot button', /^Cancelar$/);
      await page.waitForSelector('.kb-leave .ui-confirm');
      await clickText(page, '.kb-leave button', /Seguir editando/);
      assert(await page.$('.kb-editor'), 'El editor se cerró con "Seguir editando".');
      await clickText(page, '.kb-editor-foot button', /^Cancelar$/);
      await clickText(page, '.kb-leave button', /Descartar cambios/);
      await until(() => page.$('.kb-editor').then(el => !el), { message: 'cerrar el editor' });
      return 'error visible, sin POST, Seguir editando / Descartar';
    });

    await test('kb', 'Conocimiento', 'Búsqueda del server sin tildes, categoría con conteo y Ver más', async () => {
      await openKnowledge(page, base);
      await until(() => page.$(ROW), { message: 'filas' });
      const search = await page.$('.kb-search input');
      await search.type('conexion');
      await until(() => page.$$eval(ROW, rows => rows.length === 1 && /Conexión del proyector/.test(rows[0].textContent)), { message: '"conexion" encuentra "Conexión"' });
      await page.click('.kb-search button[aria-label="Limpiar búsqueda"]');
      await until(() => page.$$eval(ROW, rows => rows.length >= 30), { message: 'primer bloque' });
      const hasMore = await page.$$eval('.kb-list-foot button', bs => bs.some(b => /Ver más/.test(b.textContent)));
      assert(hasMore, 'No hay "Ver más" con más de 30 artículos.');
      const first = await page.$$eval(ROW, rows => rows.length);
      await clickText(page, '.kb-list-foot button', /Ver más/);
      await until(() => page.$$eval(ROW, rows => rows.length).then(n => n > first), { message: 'Ver más agrega filas' });
      const chip = await page.$$eval('.kb-cat', nodes => nodes.map(node => node.textContent.replace(/\s+/g, ' ').trim()));
      assert(chip.some(text => /^Proyectores\s*\d+$/.test(text)), `Chips: ${chip.join(' | ')}`);
      await clickText(page, '.kb-cat', /^Proyectores/);
      await until(() => page.$$eval(ROW, rows => rows.length > 0 && rows.every(row => row.querySelector('.kb-row-cat').textContent === 'Proyectores')), { message: 'filtro por categoría' });
      await clickText(page, '.kb-cat', /^Todas/);
      return `${first} + Ver más; chips: ${chip.length}`;
    });

    await test('kb', 'Conocimiento', 'Eliminar con confirmación en línea y Deshacer; deep link y Atrás', async () => {
      const target = (await articles(api)).find(item => item.title.startsWith(`Relleno ${stamp} 05`));
      await openKnowledge(page, base, `/${target.id}`);
      await until(() => page.$eval('#kb-read-title', el => el.textContent).then(t => t === target.title), { message: 'deep link al artículo' });
      await clickText(page, '.kb-actions button', /Eliminar/);
      await page.waitForSelector('.kb-confirm .ui-confirm');
      await clickText(page, '.kb-confirm button', /Eliminar artículo/);
      await until(async () => (await api.get(`/api/knowledge/articles/${target.id}`)).status === 404, { message: 'borrado en la base' });
      await clickText(page, '.kb-list .ui-status button', /Deshacer/);
      await until(async () => (await api.get(`/api/knowledge/articles/${target.id}`)).status === 200, { message: 'restaurado' });
      await until(() => page.$eval('#kb-read-title', el => el.textContent).then(t => t === target.title).catch(() => false), { message: 'vuelve al lector' });
      // Atrás del navegador vuelve al artículo anterior / la lista sin salir de la vista.
      await page.goBack();
      await sleep(300);
      assert((await pathname(page)).includes('/knowledge'), `Atrás salió de la vista: ${await pathname(page)}`);
      return `#${target.id}`;
    });

    await test('kb', 'Conocimiento', 'Adjunto con FileDrop (subiendo → listo) y guardado', async () => {
      const target = (await articles(api)).find(item => item.title.startsWith(`Relleno ${stamp} 07`));
      await openKnowledge(page, base, `/${target.id}/editar`);
      await page.waitForSelector('.kb-editor .ui-drop');
      const file = path.join(os.tmpdir(), `e2e-kb-${stamp}.txt`);
      fs.writeFileSync(file, 'adjunto de prueba');
      const input = await page.$('.kb-editor .ui-filedrop input[type="file"]');
      await input.uploadFile(file);
      await page.waitForSelector('.kb-editor .ui-file.is-done', { timeout: 10000 });
      await clickText(page, '.kb-editor-foot button', /Guardar artículo/);
      await page.waitForSelector('.kb-reader');
      const after = (await api.get(`/api/knowledge/articles/${target.id}`)).data.item;
      fs.rmSync(file, { force: true });
      assert(after.attachments.some(item => item.name === path.basename(file)), `Adjuntos: ${JSON.stringify(after.attachments)}`);
      return after.attachments.map(item => item.name).join(', ');
    });

    await test('kb', 'Conocimiento', 'Mobile: lista y lector son vistas propias con Volver', async () => {
      const mobile = await openContext(browser, { base, token: admin.token, releaseVersion, device: KnownDevices['iPhone 13'], reducedMotion: true });
      try {
        await openKnowledge(mobile.page, base);
        await until(() => mobile.page.$(ROW), { message: 'filas en mobile' });
        assert(!(await mobile.page.$('.kb-main')), 'En mobile el lector no debería verse junto a la lista.');
        await mobile.page.$eval(ROW, el => el.click());
        await mobile.page.waitForSelector('.kb-reader');
        assert(!(await mobile.page.$('.kb-list')), 'La lista sigue visible en la vista del artículo.');
        await clickText(mobile.page, '.kb-back button', /Volver/);
        await mobile.page.waitForSelector('.kb-list');
        return 'lista → artículo → Volver';
      } finally {
        await mobile.context.close();
      }
    });

    await test('kb', 'Conocimiento', 'Modo consulta: lee, no edita (y el server responde 403)', async () => {
      const ro = await openContext(browser, { base, token: consulta.token, releaseVersion });
      try {
        await openKnowledge(ro.page, base);
        await until(() => ro.page.$('.kb-reader, .kb-empty'), { message: 'lector en consulta' });
        const writes = await ro.page.$$eval('.kb-page button', bs => bs.filter(b => /Nuevo artículo|Editar|Eliminar/.test(b.textContent) && !b.disabled).length);
        assert(writes === 0, `${writes} botones de escritura habilitados en consulta.`);
        const res = await apiConsulta.post('/api/knowledge/articles', { title: 'x', content: '<p>x</p>' });
        assert(res.status === 403, `POST en consulta respondió ${res.status}`);
        return 'sin Nuevo/Editar/Eliminar; 403';
      } finally {
        await ro.context.close();
      }
    });

    /* ── Canvas ─────────────────────────────────────────────────────────── */

    await test('cv', 'Canvas', 'Alta de nota en la vista y título con guardado diferido', async () => {
      const before = await canvasItems(api);
      await openCanvas(page, base);
      await clickText(page, '.cv-add button', /^Nota$/);
      const created = await until(async () => (await canvasItems(api)).find(item => !before.some(old => old.id === item.id)), { message: 'nota creada' });
      assert(created.itemType === 'sticky', `Tipo ${created.itemType}`);
      const node = await page.waitForSelector(`.cv-node[data-node-id="${created.id}"]`);
      const box = await node.boundingBox();
      const board = await (await page.$('.cv-board')).boundingBox();
      assert(box.x >= board.x && box.y >= board.y && box.x + box.width <= board.x + board.width + 1, 'La nota nueva no quedó dentro de la vista.');
      const titleInput = await node.$('.cv-node-title');
      await typeInto(page, titleInput, `Nota e2e ${stamp}`);
      await until(async () => (await canvasItems(api)).find(item => item.id === created.id)?.title === `Nota e2e ${stamp}`, { timeout: 5000, message: 'título guardado' });
      await until(() => page.$eval('.cv-save', el => /Guardado/.test(el.textContent)), { message: 'indicador Guardado' });
      return `#${created.id} en (${Math.round(created.x)}, ${Math.round(created.y)})`;
    });

    await test('cv', 'Canvas', 'Mover con el asa (mouse y flechas), redimensionar con teclado y traer al frente', async () => {
      await openCanvas(page, base);
      const item = (await canvasItems(api)).find(entry => entry.title === `Nota e2e ${stamp}`);
      const node = await page.waitForSelector(`.cv-node[data-node-id="${item.id}"]`);
      const grip = await node.$('.cv-grip');
      const g = await grip.boundingBox();
      await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
      await page.mouse.down();
      await page.mouse.move(g.x + 60, g.y + 40, { steps: 6 });
      await page.mouse.up();
      const zoom = parseInt(await zoomLabel(page), 10) / 100;
      const moved = await until(async () => {
        const now = (await canvasItems(api)).find(entry => entry.id === item.id);
        return Math.abs(now.x - item.x) > 10 ? now : null;
      }, { timeout: 5000, message: 'posición guardada tras arrastrar' });
      assert(Math.abs((moved.x - item.x) * zoom - (60 - g.width / 2)) < 12, `Arrastre desparejo: ${moved.x - item.x} a zoom ${zoom}`);
      await grip.focus();
      await page.keyboard.press('ArrowRight');
      await until(async () => (await canvasItems(api)).find(entry => entry.id === item.id).x === moved.x + 10, { timeout: 5000, message: 'flecha mueve 10' });
      const handle = await node.$('.cv-resize');
      await handle.focus();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowDown');
      const resized = await until(async () => {
        const now = (await canvasItems(api)).find(entry => entry.id === item.id);
        return now.width === item.width + 10 && now.height === item.height + 10 ? now : null;
      }, { timeout: 5000, message: 'redimensionar con flechas' });
      const top = Math.max(...(await canvasItems(api)).map(entry => entry.zIndex));
      assert(resized.zIndex === top, `zIndex ${resized.zIndex}, máximo ${top}`);
      return `x ${item.x}→${moved.x + 10}, ${item.width}×${item.height}→${resized.width}×${resized.height}`;
    });

    await test('cv', 'Canvas', 'Rueda: zoom en el lienzo sin scrollear la página; − / + / Encuadrar', async () => {
      await openCanvas(page, base);
      const before = await zoomLabel(page);
      const scrollBefore = await page.$eval('.shell-scroll', el => el.scrollTop);
      const board = await (await page.$('.cv-board')).boundingBox();
      await page.mouse.move(board.x + board.width / 2, board.y + board.height / 2);
      await page.mouse.wheel({ deltaY: -300 });
      await sleep(200);
      const after = await zoomLabel(page);
      const scrollAfter = await page.$eval('.shell-scroll', el => el.scrollTop);
      assert(after !== before, `La rueda no cambió el zoom (${before}).`);
      assert(scrollAfter === scrollBefore, `La página scrolleó con la rueda (${scrollBefore} → ${scrollAfter}).`);
      await page.click('.cv-zoom button[aria-label="Alejar"]');
      await clickText(page, '.cv-tools button', /Encuadrar/);
      return `${before} → ${after} → ${await zoomLabel(page)}`;
    });

    await test('cv', 'Canvas', 'Borrar nodo y paso de checklist con Deshacer', async () => {
      const created = (await api.post('/api/canvas/items', { itemType: 'checklist', title: `Lista e2e ${stamp}`, content: { items: [{ text: 'uno', checked: false }, { text: 'dos', checked: false }] }, x: -420, y: -260 })).data.item;
      await openCanvas(page, base);
      await clickText(page, '.cv-tools button', /Encuadrar/);
      const node = await page.waitForSelector(`.cv-node[data-node-id="${created.id}"]`);
      await (await node.$('button[aria-label="Quitar paso: uno"]')).click();
      await until(async () => (await canvasItems(api)).find(entry => entry.id === created.id).content.items.length === 1, { timeout: 5000, message: 'paso quitado' });
      await clickText(page, '.cv-page > .ui-collapse .ui-status button', /Deshacer/);
      await until(async () => (await canvasItems(api)).find(entry => entry.id === created.id).content.items.map(step => step.text).join() === 'uno,dos', { timeout: 5000, message: 'paso devuelto en su lugar' });
      await (await node.$('.cv-node-del')).click();
      await until(async () => !(await canvasItems(api)).some(entry => entry.id === created.id), { message: 'nodo borrado' });
      await clickText(page, '.cv-page > .ui-collapse .ui-status button', /Deshacer/);
      await until(async () => (await canvasItems(api)).some(entry => entry.id === created.id), { message: 'nodo restaurado' });
      await page.waitForSelector(`.cv-node[data-node-id="${created.id}"]`);
      return `#${created.id}`;
    });

    await test('cv', 'Canvas', 'Archivo: sube y cae en el centro de la vista', async () => {
      const before = await canvasItems(api);
      await openCanvas(page, base);
      await clickText(page, '.cv-add button', /^Archivo$/);
      await page.waitForSelector('.cv-upload .ui-drop');
      const file = path.join(os.tmpdir(), `e2e-cv-${stamp}.txt`);
      fs.writeFileSync(file, 'archivo del canvas');
      await (await page.$('.cv-upload input[type="file"]')).uploadFile(file);
      const created = await until(async () => (await canvasItems(api)).find(item => !before.some(old => old.id === item.id) && item.itemType === 'file'), { timeout: 10000, message: 'nodo de archivo' });
      fs.rmSync(file, { force: true });
      const node = await page.waitForSelector(`.cv-node[data-node-id="${created.id}"]`);
      const box = await node.boundingBox();
      const board = await (await page.$('.cv-board')).boundingBox();
      assert(box.x >= board.x - 1 && box.y >= board.y - 1 && box.x + box.width <= board.x + board.width + 1 && box.y + box.height <= board.y + board.height + 1, 'El archivo no cayó dentro de la vista.');
      await clickText(page, '.cv-upload button', /^Listo$/);
      return created.title;
    });

    await test('cv', 'Canvas', 'Pinza con dos dedos: zoom solo dentro del lienzo (la página queda en escala 1)', async () => {
      const mobile = await openContext(browser, { base, token: admin.token, releaseVersion, device: KnownDevices['iPhone 13'], reducedMotion: true });
      try {
        await openCanvas(mobile.page, base);
        const before = await zoomLabel(mobile.page);
        const board = await (await mobile.page.$('.cv-board')).boundingBox();
        const cdp = await mobile.page.createCDPSession();
        const cx = board.x + board.width / 2;
        const cy = board.y + board.height / 2;
        const from = [{ x: cx - 30, y: cy }, { x: cx + 30, y: cy }];
        const to = [{ x: cx - 110, y: cy - 20 }, { x: cx + 110, y: cy + 20 }];
        const pts = t => from.map((p, i) => ({ x: p.x + (to[i].x - p.x) * t, y: p.y + (to[i].y - p.y) * t, id: i, radiusX: 2, radiusY: 2, force: 1 }));
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(0) });
        for (let step = 1; step <= 10; step += 1) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(step / 10) });
          await sleep(16);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(300);
        const after = await zoomLabel(mobile.page);
        const scale = await mobile.page.evaluate(() => (window.visualViewport ? window.visualViewport.scale : 1));
        assert(after !== before && parseInt(after, 10) > parseInt(before, 10), `La pinza no acercó el lienzo (${before} → ${after}).`);
        assert(Math.abs(scale - 1) < 0.01, `La página quedó en escala ${scale}.`);
        return `${before} → ${after}, página en escala 1`;
      } finally {
        await mobile.context.close();
      }
    });

    await test('cv', 'Canvas', 'Modo consulta: paneo y zoom sí, altas y edición no (403 en el server)', async () => {
      const ro = await openContext(browser, { base, token: consulta.token, releaseVersion });
      try {
        await openCanvas(ro.page, base);
        const writes = await ro.page.$$eval('.cv-add button', bs => bs.filter(b => !b.disabled).length);
        assert(writes === 0, `${writes} botones de alta habilitados en consulta.`);
        const editable = await ro.page.$$eval('.cv-node input, .cv-node textarea', els => els.filter(el => !el.disabled).length);
        assert(editable === 0, `${editable} campos editables en consulta.`);
        const before = await zoomLabel(ro.page);
        await ro.page.click('.cv-zoom button[aria-label="Acercar"]');
        assert((await zoomLabel(ro.page)) !== before, 'El zoom no anda en consulta.');
        const res = await apiConsulta.post('/api/canvas/items', { itemType: 'sticky' });
        assert(res.status === 403, `POST en consulta respondió ${res.status}`);
        return 'altas deshabilitadas, campos de solo lectura, zoom OK, 403';
      } finally {
        await ro.context.close();
      }
    });

    await test('cv', 'Canvas', 'El lienzo llena el área visible (sin franja al pie ni scroll de página) y al cambiar el tamaño lo del centro sigue en el centro', async () => {
      const center = () => page.evaluate(() => {
        const board = document.querySelector('.cv-board');
        const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(document.querySelector('.cv-origin').style.transform);
        const [x, y, z] = m.slice(1).map(Number);
        return { wx: (board.clientWidth / 2 - x) / z, wy: (board.clientHeight / 2 - y) / z };
      });
      const fit = () => page.evaluate(() => {
        const s = document.querySelector('.shell-scroll');
        const page = document.querySelector('.cv-page').getBoundingClientRect();
        return { overflow: s.scrollHeight - s.clientHeight, gapBelow: Math.round(s.getBoundingClientRect().bottom - page.bottom), board: document.querySelector('.cv-board').offsetHeight };
      });
      const rows = [];
      for (const [width, height] of [[1440, 900], [1920, 1080], [1024, 700], [390, 780]]) {
        await page.setViewport({ width, height });
        await openCanvas(page, base);
        await sleep(400);
        const f = await fit();
        assert(f.overflow <= 1 || f.board <= 290, `${width}×${height}: la página scrollea ${f.overflow} px con un lienzo de ${f.board} px`);
        assert(f.gapBelow <= 2, `${width}×${height}: franja vacía de ${f.gapBelow} px debajo del canvas`);
        rows.push(`${width}: ${f.board} px`);
      }
      await page.setViewport({ width: 1440, height: 900 });
      await openCanvas(page, base);
      await sleep(400);
      const before = await center();
      await page.setViewport({ width: 1024, height: 640 });
      await sleep(500);
      const after = await center();
      const drift = Math.hypot(after.wx - before.wx, after.wy - before.wy);
      assert(drift <= 2, `Al achicar la ventana el centro se corrió ${drift.toFixed(1)} px del lienzo.`);
      await page.setViewport({ width: 1366, height: 900 });
      return `${rows.join(' · ')} · centro quieto (${drift.toFixed(1)} px)`;
    });

    await test('cv', 'Canvas', 'Barra, zoom y botones del lienzo: vecinos de la misma altura (390 a 1920)', async () => {
      const problems = [];
      for (const width of [390, 1024, 1440, 1920]) {
        await page.setViewport({ width, height: 900 });
        await openCanvas(page, base);
        await sleep(300);
        for (const item of await page.evaluate(unevenRows, { scope: '.cv-page', ignore: '.cv-board' })) problems.push(`${width}: ${item}`);
      }
      await page.setViewport({ width: 1366, height: 900 });
      assert(!problems.length, problems.join('\n'));
      return 'parejos';
    });

    await test('kb', 'Conocimiento', 'Elegir categoría y otra ficha: la lista y el lector cambian de alto suave, con el control tocado quieto; vecinos parejos', async () => {
      const smoothCtx = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width: 1366, height: 900 } });
      try {
        await openKnowledge(smoothCtx.page, base);
        await until(() => smoothCtx.page.$$eval(ROW, rows => rows.length > 5), { message: 'filas' });
        // "Proyectores" tiene 1 artículo: la lista se acorta de ~30 filas a 1.
        const chip = await smoothCtx.page.evaluate(() => {
          const el = [...document.querySelectorAll('.kb-cat')].find(node => /^Proyectores/.test(node.textContent || ''));
          el?.setAttribute('data-e2e-chip', '');
          return Boolean(el);
        });
        assert(chip, 'No está la categoría Proyectores');
        const toCat = await watchHeight(smoothCtx.page, { trigger: '[data-e2e-chip]', watch: '.kb-results', ms: 1500 });
        assert(!toCat.error, toCat.error);
        const s1 = smooth(toCat.heights);
        assert(s1.ok, `La lista saltó de ${s1.start} a ${s1.end} px sin pasar por el medio (${s1.steps} cuadros intermedios).`);
        assert(toCat.moved <= 2, `El chip se movió ${toCat.moved} px.`);
        // Otra ficha (el lector cambia de alto): también suave.
        await smoothCtx.page.evaluate(() => document.querySelector('.kb-cat')?.click());
        await until(() => smoothCtx.page.$$eval(ROW, rows => rows.length > 5), { message: 'todas otra vez' });
        await sleep(400);
        await smoothCtx.page.evaluate(() => {
          const rows = [...document.querySelectorAll('a.kb-row')];
          const target = rows.find(row => /Relleno/.test(row.textContent || '') && !row.classList.contains('is-current'));
          target?.setAttribute('data-e2e-row', '');
        });
        const toRow = await watchHeight(smoothCtx.page, { trigger: '[data-e2e-row]', watch: '.kb-main-box', ms: 1500 });
        const s2 = smooth(toRow.heights);
        assert(s2.ok, `El lector saltó de ${s2.start} a ${s2.end} px de golpe.`);
        // Vecinos parejos en la lista, el lector y el editor (lista y lector son maestro/detalle: alturas propias).
        const uneven = [];
        for (const width of [390, 1440]) {
          await smoothCtx.page.setViewport({ width, height: 900 });
          await sleep(300);
          for (const item of await smoothCtx.page.evaluate(unevenRows, { scope: '.kb-page', ignore: '.kb-rich' })) {
            if (!/section\.kb-list .* vs (article|section)\.kb-card/.test(item)) uneven.push(`${width}: ${item}`);
          }
        }
        await clickText(smoothCtx.page, '.kb-list button', /^Nuevo artículo$/);
        await smoothCtx.page.waitForSelector('.kb-editor');
        const tags = await smoothCtx.page.$('.kb-editor .ui-tags input');
        await tags.type('uno,dos,tres,cuatro,cinco,seis,siete,');
        for (const item of await smoothCtx.page.evaluate(unevenRows, { scope: '.kb-editor', ignore: '.kb-rich' })) uneven.push(`editor: ${item}`);
        assert(!uneven.length, uneven.join('\n'));
        return `lista ${s1.start}→${s1.end} px en ${s1.steps} cuadros · lector ${s2.start}→${s2.end} px · chip quieto`;
      } finally {
        await smoothCtx.context.close();
      }
    });

    await test('rec', 'Recordatorios', 'Cambiar de filtro o "Solo los míos": la lista crece y se achica suave, el segmentado queda quieto (también al final de la página); vecinos parejos', async () => {
      const current = (await api.get('/api/site-settings')).data.settings || {};
      const mods = new Set([...(Array.isArray(current['modules.enabled']) ? current['modules.enabled'] : []), 'reminders']);
      await api.patch('/api/site-settings', { settings: { 'modules.enabled': [...mods] } });
      for (let i = 0; i < 6; i += 1) {
        await api.post('/api/reminders', { title: `Suave e2e ${stamp} ${i}`, remindAt: new Date(Date.now() + (i + 2) * 86400000).toISOString(), priority: 'Media' });
      }
      const remCtx = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width: 1366, height: 640 } });
      try {
        await gotoView(remCtx.page, base, 'reminders');
        await remCtx.page.waitForSelector('.rem-results .rem-group', { timeout: 20000 });
        await sleep(400);
        const mark = rx => remCtx.page.evaluate((src, flags) => {
          document.querySelectorAll('[data-e2e-seg]').forEach(node => node.removeAttribute('data-e2e-seg'));
          const el = [...document.querySelectorAll('.rem-filters .ui-seg-item')].find(node => new RegExp(src, flags).test(node.textContent || ''));
          el?.setAttribute('data-e2e-seg', '');
          return Boolean(el);
        }, rx.source, rx.flags);
        const report = [];
        // Arriba: Pendientes → Hoy (se achica) → Todos (crece).
        for (const rx of [/^Hoy/, /^Todos/, /^Pendientes/]) {
          assert(await mark(rx), `No está el filtro ${rx}`);
          const result = await watchHeight(remCtx.page, { trigger: '[data-e2e-seg]', watch: '.rem-results' });
          const s = smooth(result.heights);
          assert(s.ok, `${rx}: la lista saltó de ${s.start} a ${s.end} px de golpe (${s.steps} cuadros intermedios).`);
          assert(result.moved <= 2, `${rx}: el segmentado se movió ${result.moved} px.`);
          report.push(`${s.start}→${s.end}`);
          await sleep(200);
        }
        // Al final de la página: achicar la lista no corre el segmentado (se reserva el alto al pie).
        await remCtx.page.evaluate(() => { const s = document.querySelector('.shell-scroll'); s.scrollTop = 120; });
        await sleep(150);
        assert(await mark(/^Hoy/), 'No está Hoy');
        const scrolled = await watchHeight(remCtx.page, { trigger: '[data-e2e-seg]', watch: '.rem-results' });
        assert(scrolled.moved <= 2, `Scrolleado, el segmentado se movió ${scrolled.moved} px al achicarse la lista.`);
        const uneven = [];
        for (const width of [390, 1366]) {
          await remCtx.page.setViewport({ width, height: 800 });
          await sleep(300);
          for (const item of await remCtx.page.evaluate(unevenRows, { scope: '.rem' })) uneven.push(`${width}: ${item}`);
        }
        assert(!uneven.length, uneven.join('\n'));
        return `${report.join(' · ')} px · scrolleado ${scrolled.moved} px`;
      } finally {
        await remCtx.context.close();
      }
    });
  } finally {
    await context.close();
  }
}
