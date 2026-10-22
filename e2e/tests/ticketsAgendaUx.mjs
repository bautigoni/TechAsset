// rv6) Revisión UX 6 — Tickets, Agenda y Horarios (docs/redesign/revision-ux/ENCARGO.md).
//
//   - Nada se abre "de golpe": "Ver más", filtros y segmentados, pasos del
//     checklist, confirmaciones del detalle de agenda, "Una sola fecha" y las
//     franjas de recreo cambian de alto pasando por valores intermedios, con el
//     control tocado quieto (± 2 px).
//   - Vecinos parejos: en una misma fila, botones, campos, segmentados y
//     conteos tienen la misma altura (conteos de la agenda = segmentado de
//     turno, "Eliminar" = nombre del grupo, "Probar link" = número de ticket).
//   - Sin columnas pisadas: la lista de la agenda en una tarjeta angosta pasa a
//     filas-tarjeta (antes "Curso y actividad" quedaba en 0 px a 768).
//   - Sonda por ancho y tema: sin hueco entre la barra y el primer bloque, nada
//     recortado por un overflow, vecinos con la misma altura.
// Todo contra la copia de la base (lo que se crea, se crea ahí).
import { assert, gotoView, openContext, sleep, until } from '../lib/browser.mjs';
import { COOKIE_NAME, SITE } from '../lib/env.mjs';
import { setTheme, settle } from '../lib/ux-probe.mjs';

const WIDTHS = [360, 768, 1440];

/** Corre `action` y devuelve, cuadro a cuadro, lo que mide `measure` (fuente de una función de página). */
async function frames(page, measure, action, ms = 520) {
  await page.evaluate(src => {
    const fn = new Function(`return (${src})()`);
    // Cada muestreo con su propia ficha: el bucle de una medición anterior no escribe en esta.
    const run = { list: [], on: true };
    window.__rv6 = run;
    const tick = () => { if (!run.on || window.__rv6 !== run) return; try { run.list.push(fn()); } catch { run.list.push(null); } requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }, measure.toString());
  await sleep(40);
  await action();
  await sleep(ms);
  return page.evaluate(() => { window.__rv6.on = false; return window.__rv6.list; });
}

/** El alto pasó por valores intermedios (no saltó de un valor al otro en un cuadro). */
function animated(values, key = 'h') {
  const list = values.filter(Boolean).map(v => (typeof v === 'number' ? v : v[key]));
  if (list.length < 3) return { ok: false, detail: `pocos cuadros (${list.length})` };
  const first = list[0];
  const last = list[list.length - 1];
  if (Math.abs(last - first) < 4) return { ok: true, detail: `sin cambio de alto (${Math.round(first)})` };
  const lo = Math.min(first, last) + 2;
  const hi = Math.max(first, last) - 2;
  const between = list.filter(v => v > lo && v < hi).length;
  return { ok: between >= 2, detail: `${Math.round(first)} → ${Math.round(last)} px, ${between} cuadros intermedios` };
}

/** El control no se movió más de 2 px en ningún cuadro. */
function still(values, key = 'top') {
  const list = values.filter(Boolean).map(v => v[key]);
  const moved = Math.max(...list) - Math.min(...list);
  return { ok: moved <= 2, moved: Math.round(moved) };
}

const clickText = (page, selector, rx) => until(() => page.evaluate((sel, src, flags) => {
  const re = new RegExp(src, flags);
  const el = [...document.querySelectorAll(sel)].find(node => re.test((node.textContent || '').replace(/\s+/g, ' ').trim()) && node.getBoundingClientRect().width && !node.disabled && !node.closest('[inert]'));
  if (!el) return false;
  el.click();
  return true;
}, selector, rx.source, rx.flags), { message: `${selector} ${rx}` });

/** Sonda de la revisión: hueco arriba, recortes por overflow y vecinos de distinta altura. */
function rv6Probe(scope) {
  const root = document.querySelector(scope);
  const scroller = document.querySelector('.shell-scroll');
  if (!root || !scroller) return { error: `No está ${scope}` };
  const visible = el => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const one = el => `${el.tagName.toLowerCase()}${typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(c => `.${c}`).join('') : ''}`;
  const out = { topGap: 0, clipped: [], rows: [] };
  // 1) Hueco entre la barra superior y el primer bloque.
  let min = Infinity;
  const range = document.createRange();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim() || !n.parentElement || !visible(n.parentElement)) continue;
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) if (r.height > 1) min = Math.min(min, r.top);
  }
  for (const el of root.querySelectorAll('*')) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    const boxed = (parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none') || !/^(rgba\(0, 0, 0, 0\)|transparent)$/.test(s.backgroundColor) || el.matches('input, button, svg');
    if (boxed) min = Math.min(min, el.getBoundingClientRect().top);
  }
  out.topGap = Math.round(min - scroller.getBoundingClientRect().top);
  // 2) Recortado por un ancestro que no puede scrollear para mostrarlo (incluye sombra y outline).
  for (const el of root.querySelectorAll('*')) {
    if (!visible(el) || el.closest('.ui-collapse:not([data-state="open"])')) continue;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const o = s.outlineStyle !== 'none' ? (parseFloat(s.outlineWidth) || 0) + (parseFloat(s.outlineOffset) || 0) : 0;
    const e = { l: r.left - o, t: r.top - o, r: r.right + o, b: r.bottom + o };
    for (let p = el.parentElement; p && p !== scroller; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (ps.overflowX === 'visible' && ps.overflowY === 'visible') continue;
      if (ps.textOverflow === 'ellipsis' || (ps.webkitLineClamp && ps.webkitLineClamp !== 'none') || p.classList.contains('ui-collapse-clip')) break;
      const pr = p.getBoundingClientRect();
      const scrollY = /auto|scroll/.test(ps.overflowY) && p.scrollHeight > p.clientHeight + 1;
      const scrollX = /auto|scroll/.test(ps.overflowX) && p.scrollWidth > p.clientWidth + 1;
      const cut = (!scrollY && (e.t < pr.top - 0.5 || e.b > pr.bottom + 0.5)) || (!scrollX && (e.l < pr.left - 0.5 || e.r > pr.right + 0.5));
      if (cut) out.clipped.push(`${one(el)} ⟂ ${one(p)}`);
      break;
    }
  }
  // 3) Vecinos en una fila con distinta altura.
  const BOX = '.ui-btn, .ui-icon-btn, .ui-control, .ui-seg, .ag-kpi, .ag-chip, .hr-chip, kbd, .ui-select-trigger';
  for (const parent of root.querySelectorAll('*')) {
    if (!visible(parent) || parent.closest('.ui-collapse:not([data-state="open"])')) continue;
    const ds = getComputedStyle(parent);
    if (!(/flex/.test(ds.display) && !ds.flexDirection.startsWith('column')) && !/grid/.test(ds.display)) continue;
    const kids = [...parent.children].filter(k => visible(k) && k.matches(BOX)).map(k => ({ k, r: k.getBoundingClientRect() })).filter(x => x.r.height > 4);
    for (let i = 0; i < kids.length; i += 1) {
      for (let j = i + 1; j < kids.length; j += 1) {
        const a = kids[i];
        const b = kids[j];
        const overlap = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (overlap < Math.min(a.r.height, b.r.height) * 0.5) continue;
        if (Math.abs(a.r.height - b.r.height) > 1.5) out.rows.push(`${one(parent)}: ${one(a.k)} ${Math.round(a.r.height)} px vs ${one(b.k)} ${Math.round(b.r.height)} px`);
      }
    }
  }
  out.clipped = [...new Set(out.clipped)].slice(0, 8);
  out.rows = [...new Set(out.rows)].slice(0, 8);
  return out;
}

export async function ticketsAgendaUxTests({ browser, base, api, admin, releaseVersion, test, track = () => {} }) {
  const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion });
  track(page);
  // El alta con cambios sin guardar pide confirmación del navegador al salir (beforeunload): se acepta.
  page.on('dialog', dialog => { void dialog.accept().catch(() => {}); });
  const tag = String(Date.now()).slice(-5);
  try {
    // Datos propios: tickets de sobra para "Ver más", uno con checklist, una actividad de hoy y recreos.
    const have = ((await api.get('/api/tickets')).data.items || []).length;
    for (let i = have; i < 36; i += 1) await api.post('/api/tickets', { numero: `6${tag}${String(i).padStart(2, '0')}`, titulo: `RV6 ticket ${i}`, origen: 'tik', estado: i % 2 ? 'No hecho' : 'Hecho', prioridad: 'Media' });
    const withSteps = (await api.post('/api/tickets', { numero: `6${tag}99`, titulo: 'RV6 checklist', origen: 'tik', estado: 'No hecho', prioridad: 'Media', checklist: ['Uno', 'Dos'] })).data.item;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
    await api.post('/api/agenda', { fecha: today, dia: '', turno: 'Mañana', desde: '07:30', hasta: '07:50', curso: `RV6 ${tag}`, actividad: 'Robótica educativa con kits y proyección de videos tutoriales', tipoDispositivo: 'TIC', cantidad: 1, ubicacion: 'Laboratorio', estado: 'Pendiente' });
    const recessBefore = (await api.get('/api/recess-schedules')).data.groups || [];
    const putRecess = groups => fetch(`${base}/api/recess-schedules`, { method: 'PUT', headers: { cookie: `${COOKIE_NAME}=${admin.token}`, 'X-Site-Code': SITE, 'Content-Type': 'application/json' }, body: JSON.stringify({ groups }) });
    if (!recessBefore.length) await putRecess([{ name: 'RV6 grupo', slots: [{ label: 'Recreo', startTime: '10:00', endTime: '10:20' }] }]);

    await test('rv6', 'Tickets', '"Ver más" suma la tanda creciendo (sin golpe) y filtrar cambia el alto de la lista suave con el segmentado quieto', async () => {
      await page.setViewport({ width: 1366, height: 900 });
      await gotoView(page, base, 'tickets');
      await page.waitForSelector('.tkx-more button', { timeout: 20000 });
      await settle(page);
      const more = await frames(page, () => {
        const extra = document.querySelector('.tkx-rows > .ui-collapse');
        const button = document.querySelector('.tkx-list');
        return { h: extra ? extra.getBoundingClientRect().height : 0, list: button.getBoundingClientRect().height };
      }, () => clickText(page, '.tkx-more button', /^Ver \d+ más/));
      const grow = animated(more);
      assert(grow.ok, `"Ver más" entra de golpe: ${grow.detail}`);
      // Filtro de estado: la lista pasa de un alto al otro en varios cuadros y el segmentado no se mueve.
      const seg = await frames(page, () => {
        const list = document.querySelector('.tkx-list').getBoundingClientRect();
        const control = document.querySelector('.tkx-filters .ui-seg').getBoundingClientRect();
        return { h: list.height, top: control.top };
      }, () => clickText(page, '.tkx-filters .ui-seg [role="radio"], .tkx-filters .ui-seg button', /^Hecho/));
      const smooth = animated(seg);
      const quiet = still(seg);
      assert(smooth.ok, `El filtro cambia el alto de golpe: ${smooth.detail}`);
      assert(quiet.ok, `El segmentado se movió ${quiet.moved} px`);
      await clickText(page, '.tkx-filters .ui-seg [role="radio"], .tkx-filters .ui-seg button', /^Todos\s*\d/);
      return `Ver más: ${grow.detail}; filtro: ${smooth.detail}`;
    });

    await test('rv6', 'Tickets', 'Checklist: el paso nuevo entra creciendo y el quitado se pliega antes de irse', async () => {
      await gotoView(page, base, `tickets/${withSteps.id}`);
      await page.waitForSelector('.tkx-checklist .tkx-check-row', { timeout: 20000 });
      await settle(page);
      const input = await page.$('.tkx-inline-add input');
      await input.click();
      await page.keyboard.type('Tres', { delay: 10 });
      const added = await frames(page, () => {
        const rows = document.querySelectorAll('.tkx-checklist > li');
        const last = rows[rows.length - 1];
        return { h: last ? last.getBoundingClientRect().height : 0, n: rows.length };
      }, () => page.keyboard.press('Enter'), 700);
      const grew = animated(added.filter(frame => frame && frame.n === 3));
      assert(grew.ok, `El paso nuevo aparece de golpe: ${grew.detail}`);
      const removed = await frames(page, () => {
        const rows = [...document.querySelectorAll('.tkx-checklist > li')];
        const row = rows.find(li => /Dos/.test(li.textContent));
        return row ? { h: row.getBoundingClientRect().height } : { h: 0 };
      }, () => page.evaluate(() => [...document.querySelectorAll('.tkx-checklist button')].find(b => /Quitar el paso Dos/.test(b.getAttribute('aria-label') || ''))?.click()), 700);
      const folded = animated(removed);
      assert(folded.ok, `El paso quitado desaparece de golpe: ${folded.detail}`);
      return `alta ${grew.detail}; baja ${folded.detail}`;
    });

    await test('rv6', 'Tickets', 'Alta: "Probar link" con la misma altura que el número (sin hueco) y sin cambiar de alto al tipear', async () => {
      await gotoView(page, base, 'tickets/nuevo');
      await page.waitForSelector('.tkx-form .tkx-fgrid');
      const read = () => page.evaluate(() => {
        const [num, link] = document.querySelectorAll('.tkx-form .tkx-fgrid > *');
        const a = num.getBoundingClientRect();
        const b = link.getBoundingClientRect();
        const ctlA = num.querySelector('.ui-control').getBoundingClientRect();
        const ctlB = link.querySelector('.ui-btn').getBoundingClientRect();
        return { numH: Math.round(a.height), linkH: Math.round(b.height), ctl: Math.round(ctlA.height - ctlB.height), top: Math.round(ctlA.top - ctlB.top) };
      });
      const before = await read();
      assert(Math.abs(before.numH - before.linkH) <= 2 && Math.abs(before.ctl) <= 1 && Math.abs(before.top) <= 1, `Número y Probar link desparejos: ${JSON.stringify(before)}`);
      await page.type('.tkx-form .tkx-mono-field input', '2103', { delay: 10 });
      const after = await read();
      assert(Math.abs(after.linkH - before.linkH) <= 1, `Probar link cambió de alto al tipear: ${before.linkH} → ${after.linkH}`);
      return JSON.stringify(after);
    });

    await test('rv6', 'Agenda', 'Conteos del mismo alto que el segmentado de turno; a 768 la lista no pisa columnas', async () => {
      await page.setViewport({ width: 1440, height: 900 });
      await gotoView(page, base, 'agenda');
      await page.waitForSelector('.ag-kpi', { timeout: 20000 });
      const heights = await page.evaluate(() => ({ seg: Math.round(document.querySelector('.ag-filters-body .ui-seg').getBoundingClientRect().height), kpi: Math.round(document.querySelector('.ag-kpi').getBoundingClientRect().height) }));
      assert(heights.seg === heights.kpi, `Turno ${heights.seg} px y conteos ${heights.kpi} px`);
      await page.setViewport({ width: 768, height: 900 });
      await sleep(400);
      const cols = await page.evaluate(() => {
        const row = document.querySelector('.ag-list .ag-row-main');
        const what = row.querySelector('.ag-c-what').getBoundingClientRect();
        const eq = row.querySelector('.ag-c-eq').getBoundingClientRect();
        const head = document.querySelector('.ag-colhead');
        return { what: Math.round(what.width), overlap: what.right > eq.left + 1 && what.bottom > eq.top + 1 && what.top < eq.bottom - 1, head: head ? getComputedStyle(head).display : 'none' };
      });
      assert(cols.what >= 120 && !cols.overlap && cols.head === 'none', `Lista a 768: ${JSON.stringify(cols)}`);
      await page.setViewport({ width: 1366, height: 900 });
      return `alto ${heights.kpi} px; a 768 "Curso y actividad" ${cols.what} px`;
    });

    await test('rv6', 'Agenda', 'Día → Semana → Día y los conteos cambian el alto suave con el control quieto', async () => {
      await gotoView(page, base, 'agenda');
      await page.waitForSelector('.ag-controls .ui-seg', { timeout: 20000 });
      await settle(page);
      const measure = () => ({ h: document.querySelector('.ag-body').getBoundingClientRect().height, top: document.querySelector('.ag-controls .ui-seg').getBoundingClientRect().top });
      const week = await frames(page, measure, () => clickText(page, '.ag-controls .ui-seg [role="radio"], .ag-controls .ui-seg button', /^Semana$/));
      const back = await frames(page, measure, () => clickText(page, '.ag-controls .ui-seg [role="radio"], .ag-controls .ui-seg button', /^Día$/));
      for (const [name, list] of [['Semana', week], ['Día', back]]) {
        const a = animated(list);
        const q = still(list);
        assert(a.ok, `${name}: el cuerpo cambia de alto de golpe (${a.detail})`);
        assert(q.ok, `${name}: el segmentado se movió ${q.moved} px`);
      }
      const kpi = await frames(page, () => ({ h: document.querySelector('.ag-body').getBoundingClientRect().height, top: document.querySelector('.ag-kpis').getBoundingClientRect().top }), () => clickText(page, '.ag-kpi', /^Vencidas|^Realizadas/));
      assert(animated(kpi).ok, `El conteo cambia la lista de golpe (${animated(kpi).detail})`);
      return `semana ${animated(week).detail}; día ${animated(back).detail}`;
    });

    await test('rv6', 'Agenda', 'Detalle: Borrar abre la confirmación suave y "Una sola fecha" abre el calendario sin golpe', async () => {
      await gotoView(page, base, 'agenda');
      await page.waitForSelector('.ag-list .ag-toggle', { timeout: 20000 });
      await settle(page);
      await page.evaluate(curso => [...document.querySelectorAll('.ag-list .ag-item')].find(item => item.textContent.includes(curso))?.querySelector('.ag-toggle')?.click(), `RV6 ${tag}`);
      await page.waitForSelector('.ag-item.is-open .ag-detail-actions');
      await sleep(400);
      const ask = await frames(page, () => {
        const confirm = document.querySelector('.ag-item.is-open .ui-confirm');
        return { h: confirm ? confirm.closest('.ui-collapse').getBoundingClientRect().height : 0 };
      }, () => clickText(page, '.ag-item.is-open .ag-detail-actions button', /^Borrar$/));
      const opened = animated(ask);
      assert(opened.ok, `La confirmación aparece de golpe: ${opened.detail}`);
      await clickText(page, '.ag-item.is-open .ui-confirm button', /^No$/);
      await sleep(400);
      // Alta con "Una sola fecha": el cuerpo del formulario crece en varios cuadros.
      await clickText(page, '.ag-head-actions button', /Nueva actividad/);
      await page.waitForSelector('.ag-form .ag-form-body');
      await sleep(500);
      const date = await frames(page, () => ({ h: document.querySelector('#ag-new .ag-form-body').getBoundingClientRect().height }), () => clickText(page, '#ag-new .ag-form [role="radio"], #ag-new .ag-form button', /^Una sola fecha$/), 700);
      const cal = animated(date);
      assert(cal.ok, `"Una sola fecha" cambia el formulario de golpe: ${cal.detail}`);
      await clickText(page, '#ag-new .ag-form-head button', /^Cancelar$/);
      return `confirmación ${opened.detail}; fecha ${cal.detail}`;
    });

    await test('rv6', 'Horarios', 'Recreos: la franja nueva entra creciendo, "Eliminar" y quitar franja del alto de los campos', async () => {
      await page.setViewport({ width: 1440, height: 900 });
      await gotoView(page, base, 'schedules');
      await page.waitForSelector('.hr-rgroup', { timeout: 20000 });
      await settle(page);
      const sizes = await page.evaluate(() => {
        const head = document.querySelector('.hr-rgroup-head');
        const line = document.querySelector('.hr-slot-line');
        return {
          name: Math.round(head.querySelector('.ui-control').getBoundingClientRect().height),
          del: Math.round(head.querySelector('.ui-btn').getBoundingClientRect().height),
          label: line ? Math.round(line.querySelector('.ui-control').getBoundingClientRect().height) : 0,
          x: line ? Math.round(line.querySelector('.ui-icon-btn').getBoundingClientRect().height) : 0
        };
      });
      assert(sizes.name === sizes.del && sizes.label === sizes.x, `Alturas desparejas: ${JSON.stringify(sizes)}`);
      const grown = await frames(page, () => {
        const group = document.querySelector('.hr-rgroup');
        const slots = group.querySelectorAll('.hr-slot-motion');
        const last = slots[slots.length - 1];
        return { h: last ? last.getBoundingClientRect().height : 0, n: slots.length };
      }, () => clickText(page, '.hr-rgroup .hr-add-slot', /Franja/), 700);
      const n1 = Math.max(...grown.filter(Boolean).map(frame => frame.n));
      const a = animated(grown.filter(frame => frame && frame.n === n1));
      assert(a.ok, `La franja nueva aparece de golpe: ${a.detail}`);
      // Descartar devuelve lo guardado (no queda un borrador para otras pruebas).
      await clickText(page, '.hr-card-foot button', /^Descartar$/);
      return `${JSON.stringify(sizes)}; franja ${a.detail}`;
    });

    await test('rv6', 'Tickets, Agenda y Horarios', 'Sonda por ancho y tema: sin hueco arriba, nada recortado por un overflow, vecinos parejos', async () => {
      const views = [
        { view: 'tickets', ready: '.tkx-list .tkx-row' },
        { view: `tickets/${withSteps.id}`, ready: '.tkx-detail .tkx-detail-title' },
        { view: 'tickets/nuevo', ready: '.tkx-form' },
        { view: 'agenda', ready: '.ag-page .ag-card' },
        { view: 'schedules', ready: '.hr-page .hr-recess-card' }
      ];
      const problems = [];
      for (const width of WIDTHS) {
        await page.setViewport({ width, height: 860 });
        for (const { view, ready } of views) {
          await gotoView(page, base, view);
          await page.waitForSelector(ready, { timeout: 20000 });
          await settle(page);
          for (const theme of ['dark', 'light']) {
            await setTheme(page, theme);
            const result = await page.evaluate(rv6Probe, '.shell-view');
            if (result.error) { problems.push(`${view} ${width}: ${result.error}`); continue; }
            if (result.topGap > 32) problems.push(`${view} ${width} ${theme}: hueco arriba ${result.topGap} px`);
            for (const item of result.clipped) problems.push(`${view} ${width} ${theme}: recortado ${item}`);
            for (const item of result.rows) problems.push(`${view} ${width} ${theme}: ${item}`);
          }
        }
      }
      await page.setViewport({ width: 1366, height: 900 });
      assert(!problems.length, problems.slice(0, 12).join('\n'));
      return `${views.length} vistas × ${WIDTHS.join('/')} × oscuro y claro, 0 problemas`;
    });
  } finally {
    await context.close();
  }
}
