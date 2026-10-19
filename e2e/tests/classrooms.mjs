// au) Estado de aulas y rec) Recordatorios (etapa 6b). Cada prueba verifica el
// efecto en la base por API. Incluye la prueba de IDs de los planos: los IDs
// son room_key de la base y no pueden cambiar respecto de los SVG viejos.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { KnownDevices } from 'puppeteer-core';
import { root } from '../lib/env.mjs';
import { assert, clickButton, gotoView, openContext, sleep, typeInto, until } from '../lib/browser.mjs';

const SHEET = '.cls-sheet';
/** Lo que se abre en línea crece con una transición: se espera a que termine (antes está recortado y no se puede tocar). */
const settled = selector => `.ui-collapse[data-state="open"] > .ui-collapse-clip > * > ${selector}`;

/** Tipea de verdad sin chequear el valor (los campos con máscara lo reescriben). */
async function typeRaw(page, handle, text) {
  await handle.click({ clickCount: 3 });
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text, { delay: 20 });
}

async function clickByText(page, selector, rx, { scope = 'body' } = {}) {
  await until(() => page.evaluate((sel, src, flags, scopeSel) => {
    const re = new RegExp(src, flags);
    const scopeEl = document.querySelector(scopeSel) || document.body;
    const el = [...scopeEl.querySelectorAll(sel)].find(node => re.test((node.textContent || '').replace(/\s+/g, ' ').trim()) && node.getBoundingClientRect().width && !node.disabled);
    if (!el) return false;
    el.click();
    return true;
  }, selector, rx.source, rx.flags, scope), { message: `${selector} ${rx}` });
  await sleep(350);
}

async function openFloor(page, base, label) {
  await gotoView(page, base, 'classrooms');
  await page.waitForSelector('.cls-plan-view .cls-room', { timeout: 20000 });
  await page.waitForSelector('.cls-sum', { timeout: 20000 });
  if (label) await clickByText(page, '.cls-seg-floor .ui-seg-item', new RegExp(`^${label}`));
}

async function openRoom(page, roomKey) {
  const room = await page.waitForSelector(`[data-room-key="${roomKey}"]`);
  await room.focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector(`${SHEET} .cls-eq-item`, { timeout: 15000 });
  // La ficha entra con el colapso compartido (y, si quedó afuera, se la trae): se espera a que termine antes de tocar adentro.
  await page.waitForSelector(`.ui-collapse[data-state="open"] > .ui-collapse-clip > * > ${SHEET}`, { timeout: 5000 });
  await sleep(400);
}

const classroom = async (api, key) => (await api.get(`/api/classrooms/${encodeURIComponent(key)}`)).data.item;
const stateOf = (item, key) => item?.equipment?.find(entry => entry.key === key)?.state;

async function touchGesture(cdp, from, to, steps = 12) {
  const point = (pts, t) => pts.map((p, i) => ({ x: p.x + (to[i].x - p.x) * t, y: p.y + (to[i].y - p.y) * t, id: i, radiusX: 2, radiusY: 2, force: 1 }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(from, 0) });
  for (let step = 1; step <= steps; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(from, step / steps) });
    await sleep(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(300);
}

/** 'YYYY-MM-DD' de hoy + n días en hora argentina. */
function arDay(offset) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export async function classroomsTests({ browser, base, api, apiConsulta, consulta, releaseVersion, admin, test, track = () => {} }) {
  await test('au', 'Estado de aulas', 'IDs de los planos iguales a los de los SVG anteriores (room_key de la base)', async () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(root, 'e2e/fixtures/classroom-room-ids.json'), 'utf8'));
    const { FLOOR_PLANS, roomsOf } = await import(pathToFileURL(path.join(root, 'src/components/classrooms/plan/floorPlans.js')).href);
    const diffs = [];
    let total = 0;
    for (const [site, floors] of Object.entries(fixture.clickable)) {
      for (const [key, list] of Object.entries(floors)) {
        const floor = FLOOR_PLANS[site]?.find(item => item.key === key);
        const now = roomsOf(floor).map(room => `${room.roomKey}=${room.nombre}`).sort();
        const before = list.map(room => `${room.roomKey}=${room.nombre}`).sort();
        total += before.length;
        const missing = before.filter(item => !now.includes(item));
        const extra = now.filter(item => !before.includes(item));
        if (missing.length || extra.length) diffs.push(`${site}/${key}: faltan ${missing.join(', ') || '-'} · sobran ${extra.join(', ') || '-'}`);
      }
    }
    const allNew = new Set(Object.values(FLOOR_PLANS).flat().flatMap(floor => (floor.items || []).map(item => item.id)).filter(Boolean));
    const lost = [...new Set(Object.entries(fixture.allIdsByFile).filter(([file]) => file !== 'NordeltaInicial.jsx').flatMap(([, ids]) => ids))].filter(id => !allNew.has(id));
    assert(!diffs.length, diffs.join(' | '));
    assert(!lost.length, `IDs de espacios que desaparecieron: ${lost.join(', ')}`);
    return `${total} aulas (NFPT + NFND) con el mismo room_key y nombre`;
  });

  const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion });
  track(page);
  try {
    await test('au', 'Estado de aulas', 'Teclado: Tab/Enter abre la ficha EN LÍNEA; cambio → aviso de cambios sin guardar → Guardar → Deshacer', async () => {
      await openFloor(page, base, '1er piso');
      const before = await classroom(api, 'pp_2N');
      const current = stateOf(before, 'proyector') || 'Sin revisar';
      const target = current === 'Con falla' ? 'OK' : 'Con falla';
      await openRoom(page, 'pp_2N');
      const inline = await page.evaluate(sel => {
        const sheet = document.querySelector(sel);
        return Boolean(sheet && !sheet.closest('.modal, [role="dialog"], [aria-modal="true"]') && sheet.closest('.cls-layout'));
      }, SHEET);
      assert(inline, 'La ficha no está en línea dentro de la página.');
      const focused = await page.evaluate(() => document.activeElement?.classList.contains('cls-sheet-title'));
      assert(focused, 'El foco no pasó al título de la ficha.');
      await page.evaluate((label, state) => {
        const item = [...document.querySelectorAll('.cls-sheet .cls-eq-item')].find(node => node.querySelector('.cls-eq-label')?.textContent === label);
        [...item.querySelectorAll('.ui-seg-item')].find(node => node.textContent.trim() === state).click();
      }, 'Proyector', target);
      await until(() => page.evaluate(() => /sin guardar/.test(document.querySelector('.cls-savebar-text')?.textContent || '')), { message: 'el aviso de cambios sin guardar' });
      // Elegir otra aula con cambios pendientes pide confirmación en línea.
      await (await page.$('[data-room-key="pp_2F"]')).click();
      await page.waitForSelector(`${SHEET} .ui-confirm`, { timeout: 5000 });
      await clickButton(page, /^Seguir editando$/, { scope: SHEET });
      const stillOpen = await page.$eval(SHEET, node => node.getAttribute('aria-label') || '');
      assert(/2N/.test(stillOpen), `Se cambió de aula sin confirmar (${stillOpen}).`);
      await clickButton(page, /^Guardar cambios$/, { scope: SHEET, includeDisabled: false });
      await until(async () => stateOf(await classroom(api, 'pp_2N'), 'proyector') === target, { message: `proyector ${target} en la base` });
      await clickButton(page, /Deshacer/, { scope: '.cls-sheet-status' });
      await until(async () => stateOf(await classroom(api, 'pp_2N'), 'proyector') === current, { message: `proyector vuelve a ${current}` });
      // Esc cierra la ficha y el foco vuelve al aula.
      await page.focus(`${SHEET} .cls-sheet-title`);
      await page.keyboard.press('Escape');
      await until(async () => !(await page.$(SHEET)), { message: 'la ficha cerrada' });
      const back = await page.evaluate(() => document.activeElement?.getAttribute('data-room-key'));
      assert(back === 'pp_2N', `El foco no volvió al aula (quedó en ${back}).`);
      return `proyector ${current} → ${target} → ${current}`;
    });

    await test('au', 'Estado de aulas', 'Resumen filtra; zoom con botones; diagnóstico guardado se vuelve a mostrar', async () => {
      await openFloor(page, base, '1er piso');
      await clickByText(page, '.cls-sum', /^Sin revisar/);
      const dims = await page.$$eval('.cls-room.is-dim', nodes => nodes.length);
      const listCount = await page.$$eval('.cls-list-item', nodes => nodes.length);
      const before = await page.$eval('.cls-plan-stage', node => node.getBoundingClientRect().width);
      await (await page.$('[aria-label="Acercar el plano"]')).click();
      await sleep(200);
      const after = await page.$eval('.cls-plan-stage', node => node.getBoundingClientRect().width);
      assert(after > before * 1.3, `El zoom no agrandó el plano (${before} → ${after}).`);
      const pageScrollX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(pageScrollX <= 0, 'El zoom generó scroll horizontal en la página.');
      await (await page.$('[aria-label="Encuadrar el plano completo"]')).click();
      await clickByText(page, '.cls-sum', /^Sin revisar/);
      await openRoom(page, 'pp_3N');
      await clickButton(page, /^(Generar análisis|Volver a generar)$/, { scope: SHEET });
      await page.waitForSelector(`${SHEET} .cls-health`, { timeout: 20000 });
      const saved = (await api.get('/api/classrooms/pp_3N/health')).data;
      assert(saved.report && typeof saved.report.score === 'number', 'El diagnóstico no quedó guardado.');
      await gotoView(page, base, 'classrooms');
      await page.waitForSelector('.cls-plan-view .cls-room', { timeout: 20000 });
      await clickByText(page, '.cls-seg-floor .ui-seg-item', /^1er piso/);
      await openRoom(page, 'pp_3N');
      await page.waitForSelector(`${SHEET} .cls-health`, { timeout: 10000 });
      return `filtro: ${dims} atenuadas, ${listCount} en la lista · zoom ${Math.round(before)} → ${Math.round(after)} px · score ${saved.report.score}`;
    });

    await test('au', 'Estado de aulas', 'Crear ticket en línea vinculado al aula; categorías en línea (crear y eliminar con confirmación)', async () => {
      await openFloor(page, base, '1er piso');
      await openRoom(page, 'pp_5S');
      const before = (await api.get('/api/classrooms/pp_5S/incidents')).data.summary.total;
      await clickButton(page, /^Crear ticket$/, { scope: SHEET });
      await page.waitForSelector(settled('.cls-ticket'));
      await clickButton(page, /^Crear ticket$/, { scope: `${SHEET} .cls-ticket` });
      await until(async () => (await api.get('/api/classrooms/pp_5S/incidents')).data.summary.total === before + 1, { message: 'el ticket vinculado' });
      await until(() => page.evaluate(() => /creado y vinculado/.test(document.querySelector('.cls-sheet-status')?.textContent || '')), { message: 'la línea de estado del ticket' });

      const name = `E2E categoría ${Date.now() % 10000}`;
      await clickButton(page, /^Categorías de equipamiento$/);
      await page.waitForSelector(settled('.cls-cats'));
      await typeInto(page, '.cls-cats-new input', name);
      await clickButton(page, /^Crear categoría$/, { scope: '.cls-cats' });
      await until(async () => (await api.get('/api/classroom-categories')).data.items.some(item => item.label === name), { message: 'la categoría creada' });
      await until(() => page.evaluate(label => { const button = [...document.querySelectorAll('.cls-cats-line')].find(node => node.textContent.includes(label))?.querySelector('button[aria-label^="Eliminar"]'); if (!button || button.disabled) return false; button.click(); return true; }, name), { message: 'el botón Eliminar de la categoría nueva' });
      await page.waitForSelector(`.cls-cats ${settled('.ui-confirm')}`);
      await clickButton(page, /^Eliminar$/, { scope: '.cls-cats .ui-confirm' });
      await until(async () => !(await api.get('/api/classroom-categories')).data.items.some(item => item.label === name), { message: 'la categoría eliminada' });
      return `ticket + categoría "${name}" creada y eliminada`;
    });
  } finally {
    await context.close();
  }

  await test('au', 'Estado de aulas', 'iPhone: la pinza con dos dedos acerca SOLO el plano (la página queda en escala 1) y un dedo lo mueve', async () => {
    const view = await openContext(browser, { base, token: admin.token, releaseVersion, device: KnownDevices['iPhone 13'], reducedMotion: true });
    track(view.page);
    try {
      const p = view.page;
      await openFloor(p, base, '');
      const cdp = await p.createCDPSession();
      const box = await p.$eval('.cls-plan-view', node => { node.scrollIntoView({ block: 'center' }); const r = node.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
      await sleep(300);
      const fresh = await p.$eval('.cls-plan-view', node => { const r = node.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
      void box;
      const cx = fresh.x + fresh.w / 2;
      const cy = fresh.y + fresh.h / 2;
      await touchGesture(cdp, [{ x: cx - 20, y: cy }, { x: cx + 20, y: cy }], [{ x: cx - 90, y: cy }, { x: cx + 90, y: cy }]);
      const zoom = await p.$eval('.cls-plan-zoom-value', node => parseInt(node.textContent || '100', 10));
      const scale = await p.evaluate(() => window.visualViewport?.scale ?? 1);
      assert(zoom > 120, `La pinza no acercó el plano (${zoom}%).`);
      assert(Math.abs(scale - 1) < 0.01, `La página se agrandó (escala ${scale}).`);
      const before = await p.$eval('.cls-plan-stage', node => node.style.transform);
      await touchGesture(cdp, [{ x: cx, y: cy }], [{ x: cx - 60, y: cy - 40 }]);
      const after = await p.$eval('.cls-plan-stage', node => node.style.transform);
      assert(before !== after, 'Con zoom, un dedo no movió el plano.');
      return `plano ${zoom}%, página escala ${scale}`;
    } finally {
      await view.context.close();
    }
  });

  await test('au', 'Estado de aulas', 'Modo consulta: sin escritura en la ficha', async () => {
    const view = await openContext(browser, { base, token: consulta.token, releaseVersion });
    track(view.page);
    try {
      await openFloor(view.page, base, '1er piso');
      await openRoom(view.page, 'pp_2N');
      const enabled = await view.page.evaluate(() => {
        const sheet = document.querySelector('.cls-sheet');
        return [...sheet.querySelectorAll('.cls-eq-item .ui-seg-item, .cls-savebar button, textarea')].filter(node => !node.disabled).length
          + [...sheet.querySelectorAll('button')].filter(node => /^(Crear ticket|Generar análisis|Volver a generar|Editar equipamiento)$/.test(node.textContent.trim()) && !node.disabled).length;
      });
      assert(enabled === 0, `${enabled} controles de escritura habilitados en consulta.`);
      const write = await apiConsulta.patch('/api/classrooms/pp_2N', { observaciones: 'no' });
      assert(write.status === 403, `El server respondió ${write.status} a una escritura en consulta.`);
      return 'todo deshabilitado; server 403';
    } finally {
      await view.context.close();
    }
  });

  // ── Recordatorios ─────────────────────────────────────────────────────
  const settings = (await api.get('/api/site-settings')).data.settings || {};
  const enabled = Array.isArray(settings['modules.enabled']) ? settings['modules.enabled'] : [];
  if (!enabled.includes('reminders')) await api.patch('/api/site-settings', { 'modules.enabled': [...enabled, 'reminders'] });

  await test('rec', 'Recordatorios', 'iPhone (Safari): alta con fecha y hora del selector propio, sin parsear texto del navegador', async () => {
    const view = await openContext(browser, { base, token: admin.token, releaseVersion, device: KnownDevices['iPhone 13'] });
    track(view.page);
    try {
      const page2 = view.page;
      await gotoView(page2, base, 'reminders');
      await page2.waitForSelector('.rem-head', { timeout: 20000 });
      await clickButton(page2, /Nuevo recordatorio/);
      await page2.waitForSelector('.rem-form input');
      const title = `E2E iPhone ${Date.now() % 100000}`;
      await typeInto(page2, '.rem-form input', title);
      await clickByText(page2, '.rem-chip', /^Otra fecha/);
      const day = arDay(3);
      const [y, m, d] = day.split('-');
      const dateInput = await page2.waitForSelector('.rem-when-custom .ui-datetime-date input');
      await page2.waitForSelector(settled('.rem-when-custom'));
      await typeRaw(page2, dateInput, `${d}${m}${y}`);
      await page2.keyboard.press('Tab');
      const timeInput = await page2.waitForSelector('.rem-when-custom .ui-datetime-time input');
      await typeRaw(page2, timeInput, '1530');
      await page2.keyboard.press('Tab');
      await sleep(300);
      const scale = await page2.evaluate(() => window.visualViewport?.scale ?? 1);
      await clickButton(page2, /^Guardar recordatorio$/);
      const expected = new Date(`${day}T15:30:00-03:00`).toISOString();
      const created = await until(async () => (await api.get('/api/reminders')).data.items.find(item => item.title === title), { message: 'el recordatorio creado' });
      assert(created.remindAt === expected, `Fecha guardada ${created.remindAt}, esperada ${expected}.`);
      assert(Math.abs(scale - 1) < 0.01, `La página quedó con zoom ${scale}.`);
      return `${title} → ${created.remindAt}`;
    } finally {
      await view.context.close();
    }
  });

  const { context: ctx2, page: page2 } = await openContext(browser, { base, token: admin.token, releaseVersion });
  track(page2);
  try {
    const seed = await api.post('/api/reminders', { title: `E2E acciones ${Date.now() % 100000}`, remindAt: new Date(Date.now() + 2 * 3600000).toISOString(), priority: 'Alta' });
    const id = seed.data.item.id;
    const get = async () => (await api.get('/api/reminders')).data.items.find(item => item.id === id);
    const row = () => page2.evaluateHandle(title => [...document.querySelectorAll('.rem-row')].find(node => node.querySelector('.rem-row-title')?.textContent === title) || null, seed.data.item.title).then(h => h.asElement());
    const openReminders = async () => {
      await gotoView(page2, base, 'reminders');
      await page2.waitForSelector('.rem-head', { timeout: 20000 });
      await until(row, { message: 'la fila sembrada' });
    };

    await test('rec', 'Recordatorios', 'Completar → Deshacer; posponer en línea; editar (PATCH) en línea', async () => {
      await openReminders();
      await (await (await row()).$('.rem-check')).click();
      await until(async () => (await get())?.status === 'completed', { message: 'completado en la base' });
      await page2.waitForSelector(`.rem-list-col ${settled('.ui-status')}`); // la línea de estado terminó de abrir (StatusSlot)
      await sleep(450);
      await clickButton(page2, /Deshacer/, { scope: '.rem-list-col' });
      await until(async () => (await get())?.status === 'pending', { message: 'pendiente otra vez' });
      const before = (await get()).remindAt;
      const ROW = `.rem-row[data-reminder-id="${id}"]`;
      await until(row, { message: 'la fila' });
      await clickButton(page2, /^Posponer$/, { scope: ROW });
      await page2.waitForSelector(settled('.rem-inline'));
      await clickByText(page2, '.rem-inline .rem-chip', /^Mañana/);
      await clickButton(page2, /^Posponer$/, { scope: '.rem-inline' });
      await until(async () => (await get())?.remindAt !== before, { message: 'fecha nueva' });
      const postponed = (await get()).remindAt;
      assert(new Date(postponed).getTime() > Date.now() + 3600000, 'No se pospuso a mañana.');
      // Pospuesto a mañana, la fila cambia de grupo y se vuelve a montar: se
      // espera a que el panel se cierre y quede la fila nueva (si no, el
      // "Editar" de la fila vieja se desprende del documento antes del click).
      await until(() => page2.evaluate(sel => Boolean(document.querySelector(sel)) && !document.querySelector('.rem-inline'), ROW), { message: 'la fila pospuesta, sin el panel' });
      await clickButton(page2, /^Editar$/, { scope: ROW });
      await page2.waitForSelector(settled('.rem-inline'));
      const newTitle = `${seed.data.item.title} (editado)`;
      await typeInto(page2, '.rem-inline .rem-form input', newTitle);
      await clickButton(page2, /^Guardar cambios$/, { scope: '.rem-inline' });
      await until(async () => (await get())?.title === newTitle, { message: 'título editado' });
      seed.data.item.title = newTitle;
      return `completar/deshacer, pospuesto a ${postponed}, editado`;
    });

    await test('rec', 'Recordatorios', 'Borrar con confirmación en línea → Deshacer lo recupera; modo consulta sin acciones', async () => {
      await openReminders();
      const r = await row();
      await (await r.$('button[aria-label^="Borrar recordatorio"]')).click();
      await page2.waitForSelector(settled('.rem-confirm'));
      assert(await get(), 'Se borró sin confirmar.');
      await clickButton(page2, /^Borrar$/, { scope: '.rem-row .ui-confirm' });
      await until(async () => !(await get()), { message: 'borrado' });
      await page2.waitForSelector(`.rem-list-col ${settled('.ui-status')}`); // la línea de estado terminó de abrir (StatusSlot)
      await sleep(450);
      await clickButton(page2, /Deshacer/, { scope: '.rem-list-col' });
      await until(async () => Boolean(await get()), { message: 'recuperado' });
      const view = await openContext(browser, { base, token: consulta.token, releaseVersion });
      try {
        await gotoView(view.page, base, 'reminders');
        await view.page.waitForSelector('.rem-head', { timeout: 20000 });
        await view.page.waitForSelector('.rem-row', { timeout: 10000 });
        const enabled = await view.page.evaluate(() => [...document.querySelectorAll('.rem-row button, .rem-head button')].filter(node => !node.disabled && /Posponer|Editar|Borrar|Completar|Nuevo/.test(`${node.textContent} ${node.getAttribute('aria-label') || ''}`)).length);
        assert(enabled === 0, `${enabled} acciones habilitadas en consulta.`);
      } finally {
        await view.context.close();
      }
      return 'confirmación, borrado, deshacer, consulta sin acciones';
    });
  } finally {
    await ctx2.close();
  }
}
