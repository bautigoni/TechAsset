// bop) Barrido de REGLAS-UX en las pantallas de operación: Inicio, Préstamos,
// Dispositivos, Historial e Inventario TIC.
//
//   1. Abrir y cerrar cada plegable visible (secciones, paneles, fichas debajo
//      de una fila) con el área scrolleada: el disparador no se mueve más de
//      2 px en ningún frame, el documento no scrollea y el alto pasa por valores
//      intermedios (se anima, no salta). Al abrir otra fila, la tocada queda quieta.
//   2. Sondas de layout por ancho (360–1920) y tema: huecos > 48 px entre
//      bloques consecutivos o dentro de una tarjeta, textos cortados con
//      elipsis que tenían lugar, placeholders cortados, y controles tapados
//      (elementFromPoint en el centro del control devuelve el control o un hijo).
//   3. Acciones que no se duplican ni mueven la página: doble click / doble
//      Enter en Devolver (un solo request) y el campo del código queda quieto.
//   4. Dispositivos con equipos marcados: el buscador sigue a la vista y se usa.
// Corre contra la copia de la base (nunca la real). Capturas en
// e2e/.out/barrido-operacion/.
import fs from 'node:fs';
import path from 'node:path';
import { root } from '../lib/env.mjs';
import { assert, gotoView, openContext, sleep, until } from '../lib/browser.mjs';
import { layoutProbe } from '../lib/layout-probe.mjs';

const MAX_GAP = 48;
export const OP_WIDTHS = [360, 768, 1024, 1280, 1366, 1440, 1920];
const outDir = path.join(root, 'e2e', '.out', 'barrido-operacion');

/* ── Sondas (corren adentro de la página) ─────────────────────────────── */

/**
 * Huecos, truncados con lugar, placeholders cortados y controles tapados
 * dentro de `rootSel`. `blocks`: los bloques de la pantalla (tarjetas,
 * franjas); se usan los de más afuera.
 */
export function uxProbe({ rootSel, blocks, maxGap }) {
  const rootEl = document.querySelector(rootSel);
  if (!rootEl) return { error: `No está ${rootSel}` };
  const visible = element => (element.checkVisibility ? element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : element.getClientRects().length > 0);
  const describe = element => {
    const classes = typeof element.className === 'string' ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(name => `.${name}`).join('') : '';
    const label = (element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return `${element.tagName.toLowerCase()}${classes}${label ? ` "${label}"` : ''}`;
  };
  // Dentro de un plegable cerrado o cerrándose no se mide nada.
  const settled = element => !element.closest('.ui-collapse:not([data-state="open"])');

  // 1. Huecos entre bloques (el más cercano arriba y abajo que comparte columna).
  const all = [...rootEl.querySelectorAll(blocks)].filter(visible).filter(settled).filter(element => element.getBoundingClientRect().height > 2);
  const outer = all.filter(element => !all.some(other => other !== element && other.contains(element)));
  const rects = outer.map(element => ({ element, rect: element.getBoundingClientRect() }));
  const overlapsX = (a, b) => Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left) > 8;
  const gaps = [];
  for (const b of rects) {
    let above = null;
    for (const a of rects) {
      if (a === b || !overlapsX(a, b)) continue;
      if (a.rect.bottom <= b.rect.top + 1 && (!above || a.rect.bottom > above.rect.bottom)) above = a;
    }
    if (above) gaps.push({ gap: Math.round(b.rect.top - above.rect.bottom), between: `${describe(above.element)} → ${describe(b.element)}` });
  }
  gaps.sort((x, y) => y.gap - x.gap);

  // 2. Huecos dentro de cada bloque: franjas sin texto ni controles.
  const range = document.createRange();
  const inner = [];
  for (const { element: card, rect: box } of rects) {
    const spans = [];
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim() || !node.parentElement || !visible(node.parentElement) || !settled(node.parentElement)) continue;
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) if (r.height > 1 && r.width > 1) spans.push([r.top, r.bottom]);
    }
    for (const control of card.querySelectorAll('button, input, textarea, svg, img, video, canvas, [role="checkbox"], [role="switch"], .ui-skel, .ui-ring, [class*="-photo"]')) {
      if (!visible(control) || !settled(control)) continue;
      const r = control.getBoundingClientRect();
      if (r.height > 1 && r.width > 1) spans.push([r.top, r.bottom]);
    }
    // Solo lo que cae adentro del bloque (un texto solo-lector posicionado afuera no cuenta).
    for (let i = spans.length - 1; i >= 0; i -= 1) {
      const [top, bottom] = spans[i];
      if (bottom <= box.top || top >= box.bottom) spans.splice(i, 1);
      else spans[i] = [Math.max(top, box.top), Math.min(bottom, box.bottom)];
    }
    spans.sort((x, y) => x[0] - y[0]);
    let cursor = box.top;
    let worst = { gap: 0, at: '' };
    for (const [top, bottom] of spans) {
      if (top - cursor > worst.gap) worst = { gap: Math.round(top - cursor), at: `${Math.round(cursor - box.top)} px desde arriba` };
      cursor = Math.max(cursor, bottom);
    }
    if (box.bottom - cursor > worst.gap) worst = { gap: Math.round(box.bottom - cursor), at: 'al pie' };
    inner.push({ card: describe(card), ...worst });
  }
  inner.sort((x, y) => y.gap - x.gap);

  // 3. Truncados con lugar: elipsis cortando y espacio libre en el mismo renglón.
  const ROW = '[role="row"], li, .ui-tr, [class*="-line"], [class*="-head"], [class*="-row"], [class*="-card"]';
  const truncated = [];
  for (const element of rootEl.querySelectorAll('*')) {
    if (!visible(element) || !settled(element)) continue;
    const style = getComputedStyle(element);
    const clamp = style.webkitLineClamp && style.webkitLineClamp !== 'none';
    if (style.textOverflow !== 'ellipsis' || clamp) continue;
    const need = element.scrollWidth - element.clientWidth;
    if (need <= 1 || !(element.textContent || '').trim()) continue;
    const row = element.parentElement?.closest(ROW) || element.parentElement;
    if (!row) continue;
    const rowBox = row.getBoundingClientRect();
    const rowStyle = getComputedStyle(row);
    const contentLeft = rowBox.left + parseFloat(rowStyle.paddingLeft) + parseFloat(rowStyle.borderLeftWidth);
    const contentRight = rowBox.right - parseFloat(rowStyle.paddingRight) - parseFloat(rowStyle.borderRightWidth);
    const band = element.getBoundingClientRect();
    const xs = [];
    const add = (rect, clip) => {
      if (rect.bottom <= band.top + 1 || rect.top >= band.bottom - 1) return;
      const left = Math.max(rect.left, clip ? clip.left : -Infinity, contentLeft);
      const right = Math.min(rect.right, clip ? clip.right : Infinity, contentRight);
      if (right - left > 0.5) xs.push([left, right]);
    };
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim() || !node.parentElement || !visible(node.parentElement)) continue;
      range.selectNodeContents(node);
      const clip = node.parentElement.getBoundingClientRect();
      for (const r of range.getClientRects()) add(r, clip);
    }
    for (const control of row.querySelectorAll('button, input, svg, [role="checkbox"]')) if (visible(control)) add(control.getBoundingClientRect());
    xs.sort((x, y) => x[0] - y[0]);
    let ink = 0;
    let clusters = 0;
    let end = -Infinity;
    for (const [left, right] of xs) {
      if (left > end + 0.5) { clusters += 1; ink += right - left; end = right; } else if (right > end) { ink += right - end; end = right; }
    }
    const free = (contentRight - contentLeft) - ink - 16 * Math.max(0, clusters - 1);
    if (free >= need + 4) truncated.push({ element: describe(element), need: Math.round(need), free: Math.round(free) });
  }

  // 4. Placeholders cortados (campo vacío cuyo placeholder no entra).
  const canvas = document.createElement('canvas').getContext('2d');
  const placeholders = [];
  for (const input of rootEl.querySelectorAll('input[placeholder], textarea[placeholder]')) {
    if (input.value || !visible(input) || !settled(input)) continue;
    const style = getComputedStyle(input);
    canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const width = canvas.measureText(input.placeholder).width;
    const room = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (input.tagName === 'INPUT' && width > room + 1) placeholders.push(`${describe(input)} (necesita ${Math.round(width)}, hay ${Math.round(room)})`);
  }

  // 5. Controles tapados: el centro del control (si está a la vista) es el control o un hijo.
  const scroller = document.querySelector('.shell-scroll');
  const view = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
  const covered = [];
  for (const control of rootEl.querySelectorAll('button, input, textarea, a[href], [role="checkbox"], [role="switch"], [role="tab"]')) {
    if (!visible(control) || !settled(control) || control.closest('[inert]')) continue;
    if (getComputedStyle(control).pointerEvents === 'none') continue;
    const r = control.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (y < Math.max(0, view.top) + 2 || y > Math.min(window.innerHeight, view.bottom) - 2 || x < 2 || x > window.innerWidth - 2) continue;
    const hit = document.elementFromPoint(x, y);
    if (!hit || hit === control || control.contains(hit) || hit.contains(control)) continue;
    // El rótulo de un campo o la caja propia del input también cuentan como el control.
    if (hit.closest('label')?.contains(control) || hit.closest('.ui-control')?.contains(control)) continue;
    covered.push(`${describe(control)} ⟂ ${describe(hit)}`);
  }

  return {
    maxGap: gaps[0]?.gap ?? 0,
    bigGaps: gaps.filter(item => item.gap > maxGap).slice(0, 6),
    maxInner: inner[0]?.gap ?? 0,
    bigInner: inner.filter(item => item.gap > maxGap).slice(0, 6),
    truncated: truncated.slice(0, 8),
    placeholders: placeholders.slice(0, 6),
    covered: covered.slice(0, 8)
  };
}

/* ── Anclaje de plegables ────────────────────────────────────────────────── */

/** Marca un elemento con data-e2e-op para poder volver a encontrarlo. */
async function mark(page, finder, name) {
  return page.evaluate((source, label) => {
    const element = new Function(`return (${source})`)()();
    if (!element) return false;
    element.setAttribute('data-e2e-op', label);
    return true;
  }, finder.toString(), name);
}

/**
 * Lleva el disparador `sel` a ~80 px del borde de arriba del área que
 * scrollea, lo más abajo que se pueda (el peor caso al cerrar).
 */
async function place(page, sel, offset = 80) {
  await page.evaluate((selector, off) => {
    const el = document.querySelector(selector);
    const box = document.querySelector('.shell-scroll');
    box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - off;
  }, sel, offset);
  await sleep(250);
}

/**
 * Mide cuánto se movió `sel` en lo que se PINTA de cada frame: la posición se
 * lee en un ResizeObserver creado después del click (corre en el mismo frame,
 * después de la corrección de scroll de la app y antes de pintar), más una
 * muestra por frame entre frames. También el scroll del documento y el alto
 * del plegable (para ver que se anime).
 */
async function watch(page, sel, collapseSel) {
  await page.evaluate((selector, collapseSelector) => {
    document.querySelectorAll('[data-e2e-watch]').forEach(node => node.removeAttribute('data-e2e-watch'));
    const el = document.querySelector(selector);
    el.setAttribute('data-e2e-watch', '');
    const top0 = el.getBoundingClientRect().top;
    const out = { deltas: [], docY: [], heights: [], t0: performance.now(), top0 };
    window.__opWatch = out;
    const sample = () => {
      if (out.stop || !el.isConnected) return;
      out.deltas.push([performance.now() - out.t0, el.getBoundingClientRect().top - top0]);
    };
    // Se arma después del click: así este observer corre DESPUÉS del de la app.
    const arm = () => {
      if (out.armed) return;
      out.armed = true;
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onClick, true);
      setTimeout(() => {
        const scroller = document.querySelector('.shell-scroll');
        const observer = new ResizeObserver(sample);
        for (const target of [scroller, scroller?.firstElementChild, ...document.querySelectorAll('.ui-collapse')]) if (target) observer.observe(target);
        out.observer = observer;
      });
    };
    const onClick = () => arm();
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onClick, true);
    const tick = () => {
      if (out.stop) return;
      out.docY.push(window.scrollY + document.documentElement.scrollTop);
      const collapse = collapseSelector ? document.querySelector(collapseSelector) : null;
      if (collapse) out.heights.push(Math.round(collapse.getBoundingClientRect().height));
      requestAnimationFrame(() => setTimeout(tick));
    };
    requestAnimationFrame(() => setTimeout(tick));
  }, sel, collapseSel || '');
  // `untilMs`: solo cuenta lo que pasó mientras dura la transición (después,
  // si la ficha abierta no entra, se la trae a la vista a propósito).
  return async (untilMs = Infinity) => page.evaluate(limit => {
    const out = window.__opWatch;
    out.observer?.disconnect();
    // Y dónde quedó al final (también cuenta).
    const el = document.querySelector('[data-e2e-watch]');
    if (el) out.deltas.push([performance.now() - out.t0, el.getBoundingClientRect().top - out.top0]);
    out.stop = true;
    const deltas = out.deltas.filter(([t]) => t <= limit).map(([, d]) => Math.abs(d));
    return { maxDelta: Math.round(Math.max(0, ...deltas) * 10) / 10, maxDocY: Math.max(0, ...out.docY), heights: out.heights };
  }, untilMs);
}

function animated(heights) {
  if (heights.length < 3) return false;
  const first = heights[0];
  const last = heights[heights.length - 1];
  const lo = Math.min(first, last) + 4;
  const hi = Math.max(first, last) - 4;
  return hi <= lo || heights.some(height => height > lo && height < hi);
}

/**
 * Abre y cierra el plegable de `trigger` (selector) con el área scrolleada.
 * `collapse`: selector del .ui-collapse que anima (si no, por aria-controls).
 */
async function toggleTwice(page, { trigger, collapse, label, offset }) {
  const notes = [];
  for (let round = 0; round < 2; round += 1) {
    await page.waitForSelector(trigger, { timeout: 8000 });
    await place(page, trigger, offset);
    const collapseSel = collapse || await page.evaluate(sel => {
      const el = document.querySelector(sel);
      const id = el?.getAttribute('aria-controls');
      const target = id ? document.getElementById(id)?.closest('.ui-collapse') : null;
      if (!target) return '';
      target.setAttribute('data-e2e-collapse', '1');
      return '[data-e2e-collapse="1"]';
    }, trigger);
    const before = await page.$eval(trigger, el => el.getAttribute('aria-expanded') ?? el.getAttribute('aria-checked'));
    const stop = await watch(page, trigger, collapseSel);
    await page.click(trigger);
    await sleep(700);
    const result = await stop();
    await page.evaluate(() => document.querySelectorAll('[data-e2e-collapse]').forEach(el => el.removeAttribute('data-e2e-collapse')));
    const after = await page.$eval(trigger, el => el.getAttribute('aria-expanded') ?? el.getAttribute('aria-checked'));
    const action = before === 'true' ? 'cerrar' : 'abrir';
    if (before !== null) assert(after !== before, `${label}: el click no cambió aria-expanded (${before} → ${after}).`);
    assert(result.maxDelta <= 2, `${label} (${action}): el disparador se movió ${result.maxDelta} px.`);
    assert(result.maxDocY === 0, `${label} (${action}): el documento scrolleó ${result.maxDocY} px.`);
    if (collapseSel && result.heights.length) assert(animated(result.heights), `${label} (${action}): el alto no pasó por valores intermedios (${result.heights.slice(0, 10).join(', ')}): se abrió o cerró de golpe.`);
    notes.push(`${action} ${result.maxDelta}px`);
  }
  return `${label}: ${notes.join(', ')}`;
}

/**
 * Fichas debajo de filas: abre la fila A, después la B (más abajo, se cierra
 * A arriba): B no se mueve. Después cierra B: tampoco se mueve.
 */
async function rowSwitch(page, { rowA, rowB, hitA = rowA, hitB = rowB, label }) {
  await page.waitForSelector(rowA, { timeout: 8000 });
  await place(page, rowA, 120);
  await page.click(hitA);
  await sleep(600);
  // B a la vista, más o menos en el medio (si no, el click de puppeteer la trae y eso no es la app).
  await page.evaluate(sel => {
    const box = document.querySelector('.shell-scroll');
    const rect = box.getBoundingClientRect();
    box.scrollTop += document.querySelector(sel).getBoundingClientRect().top - (rect.top + rect.height * 0.55);
  }, rowB);
  await sleep(250);
  let stop = await watch(page, rowB, '');
  await page.click(hitB);
  await sleep(700);
  // Durante el cambio (se cierra la de arriba, se abre la tocada) la fila no se mueve.
  const opened = await stop(240);
  assert(opened.maxDelta <= 2, `${label}: al abrir otra fila (y cerrarse la de arriba) la fila tocada se movió ${opened.maxDelta} px.`);
  assert(opened.maxDocY === 0, `${label}: el documento scrolleó ${opened.maxDocY} px.`);
  // Después, si la ficha no entraba, se la trae a la vista sin sacar la fila de pantalla.
  const inView = await page.evaluate(sel => {
    const box = document.querySelector('.shell-scroll').getBoundingClientRect();
    const r = document.querySelector(sel).getBoundingClientRect();
    return r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
  }, rowB);
  assert(inView, `${label}: la fila tocada quedó fuera de la vista después de abrir su ficha.`);
  await place(page, rowB, 120);
  stop = await watch(page, rowB, '');
  await page.click(hitB);
  await sleep(700);
  const closed = await stop();
  assert(closed.maxDelta <= 2, `${label}: al cerrar la ficha la fila se movió ${closed.maxDelta} px.`);
  return `${label}: cambio de fila ${opened.maxDelta}px, cerrar ${closed.maxDelta}px`;
}

/* ── Pantallas ──────────────────────────────────────────────────────────── */

const SCREENS = [
  { key: 'prestamos', view: 'loans', root: '.lo-page', ready: '[data-loans-grid="devices"]', blocks: '.lo-toolbar, .lo-card' },
  { key: 'dispositivos', view: 'devices', root: '.dv-page', ready: '.dv-table [data-device-tag]', blocks: '.ui-sechead, .dv-filters, .dv-card, .dv-panel' },
  { key: 'historial', view: 'history', root: '.hs-page', ready: '.hs-list, .hs-results .ui-empty', blocks: '.ui-sechead, .hs-card' },
  { key: 'inventario', view: 'inventory', root: '.ivt', ready: '.ivt-kpis', blocks: '.ivt-head, .ivt-kpis, .ivt-tools, .ivt-condrow, .ivt-treepick, .ivt-treewrap, .ivt-main, .ivt-panel, .ivt-note' },
  { key: 'inicio', view: 'dashboard', root: '.dash', ready: '[data-dash="afuera"]', blocks: '.dash-top, .dash-bar-wrap, .dash-tiles, .dash-card, .dash-now-tabs' }
];

export async function operacionTests({ browser, base, api, admin, releaseVersion, test, track = () => {} }) {
  let outReady = false;
  const prepareOut = () => {
    if (outReady) return;
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    outReady = true;
  };
  const session = async (viewport = { width: 1440, height: 900 }, reducedMotion = false) => {
    const ctx = await openContext(browser, { base, token: admin.token, releaseVersion, viewport, reducedMotion });
    track(ctx.page);
    return ctx;
  };
  const open = async (page, screen) => {
    await gotoView(page, base, screen.view);
    await page.waitForSelector(screen.ready, { timeout: 20000 });
    await sleep(700);
  };

  // ── 1. Plegables: el disparador no se mueve y el alto se anima ─────────────
  await test('bop', 'Operación', 'Inicio: cierre del día, tipos, atajos, últimos movimientos y fichas de "Afuera ahora" sin saltos', async () => {
    const { context, page } = await session();
    try {
      await open(page, SCREENS[4]);
      const notes = [];
      notes.push(await toggleTwice(page, { trigger: '.dash-closure-btn', label: 'Cierre del día' }));
      notes.push(await toggleTwice(page, { trigger: '.dash-tile[aria-controls="dash-types"]', label: 'Disponibles por tipo' }));
      notes.push(await toggleTwice(page, { trigger: '[data-dash="movimientos"] .dash-disclose', label: 'Últimos movimientos' }));
      // Fichas: hacen falta dos filas (Todos).
      await page.evaluate(() => [...document.querySelectorAll('[data-dash="afuera"] .ui-seg button, [data-dash="afuera"] [role="radio"]')].find(el => /Todos/.test(el.textContent || ''))?.click());
      await sleep(500);
      notes.push(await rowSwitch(page, {
        rowA: '[data-dash="afuera"] .dash-rows > li:nth-child(1) .dash-row-line',
        rowB: '[data-dash="afuera"] .dash-rows > li:nth-child(8) .dash-row-line',
        hitA: '[data-dash="afuera"] .dash-rows > li:nth-child(1) .dash-row-hit',
        hitB: '[data-dash="afuera"] .dash-rows > li:nth-child(8) .dash-row-hit',
        label: 'Fichas de Afuera ahora'
      }));
      return notes.join(' · ');
    } finally {
      await context.close();
    }
  });

  await test('bop', 'Operación', 'Préstamos: cierre del día, grupos, cartelitos, último día, escaneo continuo y accesorios sin saltos', async () => {
    const { context, page } = await session();
    try {
      await open(page, SCREENS[0]);
      const notes = [];
      notes.push(await toggleTwice(page, { trigger: 'button[aria-controls="lo-cierre"]', label: 'Cierre del día' }));
      await mark(page, () => document.querySelector('[data-loans-grid="devices"] .lo-group-toggle'), 'grupo');
      notes.push(await toggleTwice(page, { trigger: '[data-e2e-op="grupo"]', label: 'Grupo de equipos' }));
      await mark(page, () => [...document.querySelectorAll('.lo-group-toggle')].find(el => /Cartelitos/i.test(el.textContent || '')), 'cartelitos');
      if (await page.$('[data-e2e-op="cartelitos"]')) notes.push(await toggleTwice(page, { trigger: '[data-e2e-op="cartelitos"]', label: 'Cartelitos de fotos' }));
      notes.push(await toggleTwice(page, { trigger: '.lo-prev-toggle', label: 'Último día con préstamos' }));
      // Escaneo continuo: la lista aparece y se va suave; el interruptor queda quieto.
      await mark(page, () => document.querySelector('[data-loan-form] button.lo-cont-switch[role="switch"]'), 'continuo');
      await mark(page, () => document.querySelector('[data-scan-list]')?.closest('.ui-collapse') || null, 'continuo-lista');
      notes.push(await toggleTwice(page, { trigger: '[data-e2e-op="continuo"]', label: 'Escaneo continuo' }));
      // Accesorios: abre el préstamo de un equipo libre y despliega los accesorios.
      const free = (await api.devices()).find(device => /^(|disponible|devuelto)$/i.test(String(device.estado || '').trim()));
      assert(free, 'No hay un equipo libre en la copia.');
      await page.click('input[data-loan-code]');
      await page.type('input[data-loan-code]', free.etiqueta);
      await page.waitForSelector('[data-lend-form] .lo-acc-toggle', { timeout: 5000 });
      await sleep(500);
      notes.push(await toggleTwice(page, { trigger: '[data-lend-form] .lo-acc-toggle', label: 'Accesorios de entrega' }));
      return notes.join(' · ');
    } finally {
      await context.close();
    }
  });

  await test('bop', 'Operación', 'Dispositivos: paneles (importar, exportar, grupos, papelera, añadir) y fichas debajo de la fila sin saltos', async () => {
    const { context, page } = await session();
    try {
      await open(page, SCREENS[1]);
      const notes = [];
      for (const [id, label] of [['dv-panel-export', 'Exportar'], ['dv-panel-groups', 'Grupos'], ['dv-panel-trash', 'Papelera'], ['dv-panel-import', 'Importar CSV'], ['dv-create', 'Añadir dispositivo']]) {
        if (await page.$(`button[aria-controls="${id}"]`)) notes.push(await toggleTwice(page, { trigger: `button[aria-controls="${id}"]`, label }));
      }
      await mark(page, () => document.querySelectorAll('.dv-table .ui-tbody [data-device-tag]')[0], 'dvA');
      await mark(page, () => document.querySelectorAll('.dv-table .ui-tbody [data-device-tag]')[8], 'dvB');
      notes.push(await rowSwitch(page, {
        rowA: '[data-e2e-op="dvA"]',
        rowB: '[data-e2e-op="dvB"]',
        hitA: '[data-e2e-op="dvA"] .dv-c-eq',
        hitB: '[data-e2e-op="dvB"] .dv-c-eq',
        label: 'Fichas de equipos'
      }));
      return notes.join(' · ');
    } finally {
      await context.close();
    }
  });

  await test('bop', 'Operación', 'Historial e Inventario TIC: resumen del equipo, paneles y fichas sin saltos', async () => {
    const { context, page } = await session();
    try {
      const notes = [];
      await open(page, SCREENS[2]);
      const buttons = await page.$$eval('.hs-eq-btn, .hs-tag-btn', list => list.length);
      if (buttons >= 3) {
        await mark(page, () => document.querySelectorAll('.hs-eq-btn, .hs-tag-btn')[0], 'hsA');
        await mark(page, () => document.querySelectorAll('.hs-eq-btn, .hs-tag-btn')[Math.min(9, document.querySelectorAll('.hs-eq-btn, .hs-tag-btn').length - 1)], 'hsB');
        notes.push(await rowSwitch(page, { rowA: '[data-e2e-op="hsA"]', rowB: '[data-e2e-op="hsB"]', label: 'Resumen en el Historial' }));
      } else notes.push('Historial: menos de 3 movimientos con equipo');

      await open(page, SCREENS[3]);
      for (const [id, label] of [['ivt-ie', 'Importar / exportar'], ['ivt-hidden', 'Ocultos'], ['ivt-add', 'Agregar recurso'], ['ivt-review', 'Revisar condición']]) {
        const enabled = await page.$eval(`button[aria-controls="${id}"]`, el => !el.disabled).catch(() => false);
        if (enabled) notes.push(await toggleTwice(page, { trigger: `button[aria-controls="${id}"]`, label }));
      }
      // Fichas de la tabla: "Todo" y la primera categoría con varias filas.
      await page.evaluate(() => [...document.querySelectorAll('.ivt-tools .ui-seg button, .ivt-tools [role="radio"]')].find(el => /^Todo/.test((el.textContent || '').trim()))?.click());
      await sleep(300);
      // Lista larga: "Sin revisar" muestra todos los ítems sin revisar (no la portada de categorías).
      await page.evaluate(() => [...document.querySelectorAll('.ivt-condrow button')].find(el => /^Sin revisar/.test((el.textContent || '').trim()))?.click());
      await sleep(600);
      const rows = await page.$$eval('.ivt-table .ui-tbody [role="row"].is-clickable', list => list.length).catch(() => 0);
      if (rows >= 4) {
        await mark(page, () => document.querySelectorAll('.ivt-table .ui-tbody [role="row"].is-clickable')[0], 'ivA');
        await mark(page, () => document.querySelectorAll('.ivt-table .ui-tbody [role="row"].is-clickable')[Math.min(8, document.querySelectorAll('.ivt-table .ui-tbody [role="row"].is-clickable').length - 1)], 'ivB');
        notes.push(await rowSwitch(page, {
          rowA: '[data-e2e-op="ivA"]',
          rowB: '[data-e2e-op="ivB"]',
          hitA: '[data-e2e-op="ivA"] .ui-td:nth-child(2) .ui-td-value',
          hitB: '[data-e2e-op="ivB"] .ui-td:nth-child(2) .ui-td-value',
          label: 'Fichas del Inventario'
        }));
      } else notes.push(`Inventario: ${rows} filas en la tabla`);
      return notes.join(' · ');
    } finally {
      await context.close();
    }
  });

  // ── 2. Sondas de layout por ancho y tema ──────────────────────────────────
  /** Mide en cada ancho y tema; junta los problemas en `problems`. */
  const probeWidths = async (page, screen, { prefix, widths, problems, summary }) => {
    for (const theme of ['dark', 'light']) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      for (const width of widths) {
        await page.setViewport({ width, height: 900 });
        await sleep(300);
        const probe = await page.evaluate(uxProbe, { rootSel: screen.root, blocks: screen.blocks, maxGap: MAX_GAP });
        const layout = await page.evaluate(layoutProbe, 5);
        if (theme === 'dark') {
          await page.screenshot({ path: path.join(outDir, `${prefix}-${theme}-${width}.png`) });
          summary.push(`${width}: ${probe.maxGap}/${probe.maxInner}`);
        }
        const where = `${theme} ${width}`;
        if (probe.error) problems.push(`${where}: ${probe.error}`);
        if (probe.bigGaps?.length) problems.push(`${where}: hueco ${probe.bigGaps.map(gap => `${gap.gap} px (${gap.between})`).join('; ')}`);
        if (probe.bigInner?.length) problems.push(`${where}: hueco dentro de ${probe.bigInner.map(gap => `${gap.card} ${gap.gap} px ${gap.at}`).join('; ')}`);
        if (probe.truncated?.length) problems.push(`${where}: truncado con lugar ${probe.truncated.map(item => `${item.element} (faltan ${item.need}, libres ${item.free})`).join('; ')}`);
        if (probe.placeholders?.length) problems.push(`${where}: placeholder cortado ${probe.placeholders.join('; ')}`);
        if (probe.covered?.length) problems.push(`${where}: control tapado ${probe.covered.join('; ')}`);
        if (layout.counts.horizontalScroll) problems.push(`${where}: scroll horizontal`);
        if (layout.counts.overlaps) problems.push(`${where}: solapamientos ${layout.overlaps.join('; ')}`);
        if (layout.counts.wrappedButtons) problems.push(`${where}: botones partidos ${layout.wrappedButtons.join('; ')}`);
      }
    }
  };

  for (const screen of SCREENS) {
    await test('bop', 'Operación (layout)', `${screen.key}: sin huecos, truncados con lugar, placeholders cortados ni controles tapados (${OP_WIDTHS.join('/')} px, oscuro y claro)`, async () => {
      const { context, page } = await session({ width: 1440, height: 900 }, true);
      prepareOut();
      const problems = [];
      const summary = [];
      try {
        await open(page, screen);
        await probeWidths(page, screen, { prefix: screen.key, widths: OP_WIDTHS, problems, summary });
      } finally {
        await context.close();
      }
      if (problems.length) throw new Error(problems.slice(0, 8).join(' | '));
      return `hueco entre bloques / dentro (oscuro): ${summary.join('  ')}`;
    });
  }

  // Casos de datos (equipos servidos interceptando GET /api/devices) y estados
  // abiertos (cierre del día, formulario de préstamo, ficha, paneles).
  const realDevices = (await api.get('/api/devices')).data;
  const withLoans = count => {
    let n = 0;
    const people = ['María Fernanda Rodríguez Alonso', 'Alex', 'Juan Ignacio Gómez', 'Lu'];
    const places = ['Laboratorio de ciencias naturales', 'Aula', 'DOE', 'Planificación móvil'];
    return (realDevices.items || []).map(device => {
      const blocked = /fuera|repar|baja|perd|no encontr/i.test(String(device.estado || ''));
      if (blocked) return device;
      if (n < count) {
        const i = n++;
        return { ...device, estado: 'Prestado', prestadoA: people[i % people.length], rol: i % 2 ? 'Docente' : 'Alumno', ubicacion: places[i % places.length], curso: i % 3 ? '5°B' : '', loanedAt: new Date(Date.now() - (i % 4) * 86400000 - 3600000).toISOString() };
      }
      return { ...device, estado: 'Disponible', prestadoA: '', loanedAt: '' };
    });
  };
  const serveDevices = async (page, items) => {
    await page.setBypassServiceWorker(true);
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (request.isInterceptResolutionHandled?.()) return;
      const url = new URL(request.url());
      if (request.method() === 'GET' && url.pathname === '/api/devices') {
        return request.respond({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ ...realDevices, items, loadedAt: new Date().toISOString() }) });
      }
      if (request.method() === 'GET' && url.pathname === '/api/loans/previous-day') {
        return request.respond({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ ok: true, items: [], date: '' }) });
      }
      return request.continue();
    });
  };
  const VARIANTS = [
    { screen: 0, key: 'prestamos-sin-prestamos', label: 'Préstamos sin préstamos (y sin último día)', items: () => withLoans(0) },
    { screen: 0, key: 'prestamos-34-prestamos', label: 'Préstamos con 34 préstamos', items: () => withLoans(34) },
    {
      screen: 0, key: 'prestamos-abierto', label: 'Préstamos con el cierre del día y el formulario de préstamo abiertos',
      setup: async page => {
        await page.click('button[aria-controls="lo-cierre"]');
        const free = (await api.devices()).find(device => /^(|disponible|devuelto)$/i.test(String(device.estado || '').trim()));
        await page.click('input[data-loan-code]');
        await page.type('input[data-loan-code]', free.etiqueta);
        await page.waitForSelector('[data-lend-form] .lo-acc-toggle');
        await sleep(400);
        await page.click('[data-lend-form] .lo-acc-toggle');
      }
    },
    { screen: 4, key: 'inicio-34-prestamos', label: 'Inicio con 34 préstamos', items: () => withLoans(34) },
    {
      screen: 1, key: 'dispositivos-abierto', label: 'Dispositivos con la ficha de un equipo y Grupos abiertos',
      setup: async page => {
        await page.click('.dv-table .ui-tbody [data-device-tag] .dv-c-eq');
        await page.waitForSelector('.dv-table .dv-detail');
        await page.click('button[aria-controls="dv-panel-groups"]');
        await sleep(500);
      }
    },
    {
      screen: 3, key: 'inventario-abierto', label: 'Inventario con "Revisar condición" y una ficha abierta',
      setup: async page => {
        await page.click('button[aria-controls="ivt-review"]');
        await sleep(400);
        await page.evaluate(() => document.querySelector('.ivt-cat')?.click());
        await sleep(400);
        await page.evaluate(() => document.querySelector('.ivt-table .ui-tbody [role="row"].is-clickable .ui-td:nth-child(2) .ui-td-value')?.click());
        await sleep(500);
      }
    }
  ];
  for (const variant of VARIANTS) {
    await test('bop', 'Operación (layout)', `${variant.label}: sin huecos, truncados, placeholders cortados ni controles tapados (360/768/1024/1440, oscuro y claro)`, async () => {
      const screen = SCREENS[variant.screen];
      const { context, page } = await session({ width: 1440, height: 900 }, true);
      prepareOut();
      const problems = [];
      const summary = [];
      try {
        if (variant.items) await serveDevices(page, variant.items());
        await open(page, screen);
        if (variant.setup) await variant.setup(page);
        await probeWidths(page, screen, { prefix: variant.key, widths: [360, 768, 1024, 1440], problems, summary });
      } finally {
        await context.close();
      }
      if (problems.length) throw new Error(problems.slice(0, 8).join(' | '));
      return `hueco entre bloques / dentro (oscuro): ${summary.join('  ')}`;
    });
  }

  // ── 3. Acciones que no se duplican ni mueven la página ─────────────────────
  const countRequests = async (page, rx, fn) => {
    const seen = [];
    const onRequest = request => { if (request.method() === 'POST' && rx.test(new URL(request.url()).pathname)) seen.push(new URL(request.url()).pathname); };
    page.on('request', onRequest);
    try { await fn(); } finally { page.off('request', onRequest); }
    return seen;
  };
  const freeTags = async count => (await api.devices())
    .filter(device => /^(|disponible|devuelto)$/i.test(String(device.estado || '').trim()))
    .map(device => device.etiqueta)
    .slice(-count - 4, -4);
  const lendByApi = async tag => {
    const response = await api.post('/api/loans/lend', { etiqueta: tag, person: 'E2E Barrido', role: 'DOE', location: 'DOE' });
    assert(response.status < 300, `No se pudo prestar ${tag} por API (${response.status}): ${JSON.stringify(response.data).slice(0, 160)}`);
  };

  await test('bop', 'Operación', 'Préstamos: doble Enter en el código devuelve UNA vez y el campo no se mueve; doble click en "Devolver" de Actualmente prestados es un solo request', async () => {
    const [tagA, tagB] = await freeTags(2);
    assert(tagA && tagB, 'No hay dos equipos libres de sobra en la copia.');
    await lendByApi(tagA);
    await lendByApi(tagB);
    const { context, page } = await session();
    try {
      await open(page, SCREENS[0]);
      const input = 'input[data-loan-code]';
      await page.click(input);
      await page.type(input, tagA);
      await page.waitForSelector(`[data-found-tag="${tagA}"]`, { timeout: 5000 });
      const top0 = await page.$eval(input, el => el.getBoundingClientRect().top);
      const stop = await watch(page, input, '');
      const requests = await countRequests(page, /^\/api\/loans\/return/, async () => {
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        await sleep(1500);
      });
      const moved = await stop();
      assert(requests.length === 1, `Doble Enter mandó ${requests.length} devoluciones (${requests.join(', ')}).`);
      assert(moved.maxDelta <= 2, `El campo del código se movió ${moved.maxDelta} px al devolver (antes ${Math.round(top0)}).`);
      // Doble click en Devolver de "Actualmente prestados".
      const row = `[data-loaned-tag="${tagB}"]`;
      await page.waitForSelector(row, { timeout: 8000 });
      await place(page, row, 200);
      const twice = await countRequests(page, /^\/api\/loans\/return/, async () => {
        const button = await page.$(`${row} button[aria-label^="Devolver"]`);
        await button.click({ clickCount: 2 });
        await sleep(1500);
      });
      assert(twice.length === 1, `Doble click mandó ${twice.length} devoluciones (${twice.join(', ')}).`);
      return `Enter×2 → ${requests.length} request, campo ${moved.maxDelta}px; doble click → ${twice.length} request`;
    } finally {
      await context.close();
    }
  });

  await test('bop', 'Operación', 'Préstamos: doble click en "Prestar" del formulario es UN préstamo; el campo del código no se mueve y el formulario se pliega', async () => {
    const [tag] = await freeTags(1);
    assert(tag, 'No hay un equipo libre de sobra en la copia.');
    const { context, page } = await session();
    try {
      await open(page, SCREENS[0]);
      const input = 'input[data-loan-code]';
      await page.click(input);
      await page.type(input, tag);
      await page.waitForSelector('[data-lend-form] #lo-persona', { timeout: 5000 });
      await sleep(400);
      await page.type('[data-lend-form] #lo-persona', 'E2E Barrido');
      for (const [label, rx] of [['Rol', /^DOE$/], ['Ubicación', /^DOE$/]]) {
        await page.evaluate((group, source) => {
          const re = new RegExp(source);
          const button = [...document.querySelectorAll(`[data-lend-form] [role="group"][aria-label="${group}"] button`)].find(node => re.test((node.textContent || '').trim()));
          button?.click();
        }, label, rx.source);
      }
      await sleep(200);
      const stop = await watch(page, input, '');
      const requests = await countRequests(page, /^\/api\/loans\/lend/, async () => {
        const button = await page.evaluateHandle(() => [...document.querySelectorAll('[data-lend-form] button')].find(node => /^Prestar/.test((node.textContent || '').trim())));
        await button.asElement().click({ clickCount: 2 });
        await sleep(1500);
      });
      const moved = await stop();
      assert(requests.length === 1, `Doble click en Prestar mandó ${requests.length} préstamos (${requests.join(', ')}).`);
      assert(moved.maxDelta <= 2, `El campo del código se movió ${moved.maxDelta} px al prestar.`);
      const state = await page.evaluate(() => document.querySelector('[data-lend-form]')?.closest('.ui-collapse')?.getAttribute('data-state') || 'sin formulario');
      assert(state === 'closed' || state === 'sin formulario', `El formulario quedó ${state} después de prestar.`);
      const device = await api.device(tag);
      assert(/prest/i.test(String(device?.estado || '')), `${tag} no quedó prestado (${device?.estado}).`);
      return `${tag}: 1 request, campo ${moved.maxDelta}px, formulario ${state}`;
    } finally {
      await context.close();
    }
  });

  await test('bop', 'Operación', 'Inicio: doble Enter en la barra devuelve UNA vez y la barra no se mueve; Deshacer no mueve la barra', async () => {
    const [tag] = await freeTags(1);
    assert(tag, 'No hay un equipo libre de sobra en la copia.');
    await lendByApi(tag);
    const { context, page } = await session();
    try {
      await open(page, SCREENS[4]);
      const bar = 'input[data-dash-bar]';
      await page.click(bar);
      await page.type(bar, tag);
      await page.waitForSelector(`[data-device-result="${tag}"]`, { timeout: 5000 });
      await sleep(300);
      let stop = await watch(page, bar, '');
      const requests = await countRequests(page, /^\/api\/loans\/return/, async () => {
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        await sleep(1500);
      });
      let moved = await stop();
      assert(requests.length === 1, `Doble Enter mandó ${requests.length} devoluciones.`);
      assert(moved.maxDelta <= 2, `La barra se movió ${moved.maxDelta} px al devolver.`);
      stop = await watch(page, bar, '');
      const undo = await countRequests(page, /^\/api\/loans\/undo/, async () => {
        const button = await page.waitForSelector('.dash-bar-wrap .ui-status-undo:not(.ui-collapse:not([data-state="open"]) *)', { timeout: 5000 });
        await button.click({ clickCount: 2 });
        await sleep(1500);
      });
      moved = await stop();
      assert(undo.length === 1, `Doble click en Deshacer mandó ${undo.length} requests.`);
      assert(moved.maxDelta <= 2, `La barra se movió ${moved.maxDelta} px al deshacer.`);
      return `Enter×2 → 1 devolución; Deshacer×2 → 1 request; barra quieta`;
    } finally {
      await context.close();
    }
  });

  // ── 4. Marcar el primero (Ctrl+clic) no corre lo que se tocó ────────────────
  for (const width of [1440, 768, 360]) {
    await test('bop', 'Operación', `Marcar el primero con Ctrl+clic no corre la fila o el chip tocado: Inicio, Préstamos y Dispositivos (${width} px)`, async () => {
      const { context, page } = await session({ width, height: 900 });
      const notes = [];
      try {
        for (const [screen, target, prepare] of [
          [SCREENS[4], '[data-dash="afuera"] .dash-rows > li:nth-child(2) .dash-row-line .dash-c-where', async () => {
            await page.evaluate(() => [...document.querySelectorAll('[data-dash="afuera"] .ui-seg button, [data-dash="afuera"] [role="radio"]')].find(el => /Todos/.test(el.textContent || ''))?.click());
            await sleep(500);
          }],
          [SCREENS[0], '[data-loans-grid="devices"] .lo-chip[data-device-tag]', async () => {
            await page.$$eval('[data-loans-grid="devices"] .lo-group-toggle[aria-expanded="false"]', list => list.slice(0, 1).forEach(button => button.click()));
            await sleep(600);
          }],
          [SCREENS[1], '.dv-table .ui-tbody [data-device-tag]:nth-child(3) .dv-c-eq', async () => {}]
        ]) {
          await open(page, screen);
          await prepare();
          await place(page, target, 300);
          const stop = await watch(page, target, '');
          const handle = await page.$(target);
          await page.keyboard.down('Control');
          await handle.click();
          await page.keyboard.up('Control');
          await sleep(500);
          const moved = await stop();
          assert(moved.maxDelta <= 2, `${screen.key}: al marcar el primero lo tocado se movió ${moved.maxDelta} px.`);
          notes.push(`${screen.key} ${moved.maxDelta}px`);
        }
      } finally {
        await context.close();
      }
      return notes.join(' · ');
    });
  }

  // ── 5. Dispositivos con selección: el buscador sigue a la vista ─────────────
  for (const width of [1440, 768, 360]) {
    await test('bop', 'Operación', `Dispositivos con equipos marcados: el buscador y el orden siguen a la vista y se usan (${width} px)`, async () => {
      const { context, page } = await session({ width, height: 900 });
      try {
        await open(page, SCREENS[1]);
        const boxes = await page.$$('.dv-table .ui-tbody [data-device-tag] [role="checkbox"], .dv-table .ui-tbody [data-device-tag] .ui-check');
        assert(boxes.length >= 2, 'No encontré casillas en la tabla.');
        await boxes[0].click();
        await boxes[1].click();
        await page.waitForSelector('.dv-list .ui-selhead', { timeout: 5000 });
        const state = await page.evaluate(() => {
          const input = document.querySelector('.dv-search input');
          if (!input) return { found: false };
          const r = input.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return { found: true, visible: r.width > 40 && r.height > 20, reachable: Boolean(hit && (hit === input || input.contains(hit) || hit.closest('.ui-control')?.contains(input))) };
        });
        assert(state.found, 'Con equipos marcados el buscador desapareció.');
        assert(state.visible && state.reachable, `El buscador quedó oculto o tapado (visible ${state.visible}, alcanzable ${state.reachable}).`);
        await page.click('.dv-search input');
        await page.keyboard.type('zzzz-no-existe');
        await until(() => page.$eval('.dv-list', el => /No hay dispositivos/.test(el.textContent || '')), { timeout: 4000, message: 'el filtro aplicado con la selección activa' });
        const count = await page.$eval('.dv-list .ui-selhead-count', el => el.textContent || '').catch(() => '');
        assert(/2/.test(count), `La selección se perdió al buscar ("${count}").`);
        return 'buscador visible y usable con 2 marcados';
      } finally {
        await context.close();
      }
    });
  }
}
