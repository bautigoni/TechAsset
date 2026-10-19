// uxr) Barrido de REGLAS-UX (docs/redesign/BARRIDO-UX.md) sobre Conocimiento,
// Canvas, Analítica, Configuración (todos los paneles), Herramientas, Accesos
// rápidos y Caja chica.
//
// Por pantalla, en 360/768/1024/1280/1366/1440/1920 × oscuro y claro:
//   - huecos: > 48 px entre bloques consecutivos de un mismo contenedor, o una
//     franja vacía de > 48 px dentro de una tarjeta;
//   - truncados con espacio: texto cortado con elipsis que tenía lugar en su renglón;
//   - tapados: el centro de cada control visible (elementFromPoint) es el
//     control o algo de adentro;
//   - layout (lib/layout-probe): scroll horizontal, barras visibles, botones
//     partidos, hermanos que se pisan.
// Y a 1366 y 390: abrir y cerrar cada disparador visible ([aria-expanded]),
// con el disparador a media pantalla y con el área scrolleada al final: el
// disparador no se mueve más de 2 px mientras dura la transición (al abrir,
// después puede acercar lo nuevo a la vista; al cerrar, nunca).
//
// Las sondas son genéricas (corren en la página): se unifican con
// e2e/lib/ux-probe.mjs cuando el frente de infraestructura lo suba.
// Capturas en e2e/.out/barrido-recursos/.
import fs from 'node:fs';
import path from 'node:path';
import { root } from '../lib/env.mjs';
import { assert, gotoView, openContext, sleep, until } from '../lib/browser.mjs';
import { layoutProbe } from '../lib/layout-probe.mjs';

export const UX_WIDTHS = [360, 768, 1024, 1280, 1366, 1440, 1920];
const MAX_GAP = 48;
const outDir = path.join(root, 'e2e', '.out', 'barrido-recursos');

/* ── Sonda en la página: huecos, truncados con espacio y controles tapados ── */

export function uxProbe({ rootSelector, cardSelector, maxGap = 48, ignore = '' }) {
  const rootEl = document.querySelector(rootSelector);
  if (!rootEl) return { error: `No está ${rootSelector}` };
  const visible = element => (element.checkVisibility ? element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : element.getClientRects().length > 0);
  const describe = element => {
    if (!element || element.nodeType !== 1) return String(element);
    const classes = typeof element.className === 'string' ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(name => `.${name}`).join('') : '';
    const label = (element.getAttribute('aria-label') || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return `${element.tagName.toLowerCase()}${classes}${label ? ` "${label}"` : ''}`;
  };
  const ignored = element => Boolean(ignore && element.closest(ignore));
  const inert = element => Boolean(element.closest('[inert]'));
  const range = document.createRange();

  // 1. Huecos entre bloques consecutivos de un mismo contenedor (en el flujo).
  const gaps = [];
  for (const parent of [rootEl, ...rootEl.querySelectorAll('*')]) {
    if (parent.closest('svg') || ignored(parent) || inert(parent) || !visible(parent)) continue;
    const kids = [...parent.children].filter(child => {
      if (!visible(child) || child.closest('svg')) return false;
      const style = getComputedStyle(child);
      if (style.position === 'absolute' || style.position === 'fixed') return false;
      const rect = child.getBoundingClientRect();
      return rect.height > 2 && rect.width > 2;
    }).map(element => ({ element, rect: element.getBoundingClientRect() }));
    if (kids.length < 2) continue;
    for (const a of kids) {
      let below = null;
      for (const b of kids) {
        if (a === b) continue;
        const overlapX = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left) > 8;
        if (!overlapX || b.rect.top < a.rect.bottom - 1) continue;
        if (!below || b.rect.top < below.rect.top) below = b;
      }
      if (!below) continue;
      // En una grilla, el renglón termina donde termina su celda más alta (una ayuda debajo de
      // un campo vecino): el espacio hasta el renglón siguiente es el normal, no un hueco.
      let rowBottom = a.rect.bottom;
      for (const c of kids) if (c.rect.top < a.rect.bottom - 1 && c.rect.bottom > a.rect.top + 1 && c.rect.top < below.rect.top) rowBottom = Math.max(rowBottom, Math.min(c.rect.bottom, below.rect.top));
      const gap = Math.round(below.rect.top - rowBottom);
      if (gap > maxGap) gaps.push({ gap, between: `${describe(a.element)} → ${describe(below.element)}` });
    }
  }
  gaps.sort((x, y) => y.gap - x.gap);

  // 2. Franjas vacías dentro de cada tarjeta (sin texto, controles ni gráficos).
  const inner = [];
  const CONTENT = 'button, a, input, textarea, svg, img, canvas, video, iframe, hr, [role="img"], [role="checkbox"], [role="radio"], [role="switch"], [class*="skel"], [class*="bar"], [class*="ring"], [class*="hc"], code';
  for (const card of rootEl.querySelectorAll(cardSelector)) {
    if (!visible(card) || ignored(card) || inert(card)) continue;
    const box = card.getBoundingClientRect();
    if (box.height < 2) continue;
    const spans = [];
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim() || !node.parentElement || !visible(node.parentElement) || inert(node.parentElement)) continue;
      range.selectNodeContents(node);
      const holder = node.parentElement.getBoundingClientRect();
      if (holder.width <= 1 || holder.height <= 1) continue; // texto solo para lectores de pantalla (.ui-sr)
      for (const r of range.getClientRects()) if (r.height > 1 && r.width > 1) spans.push([r.top, r.bottom]);
    }
    for (const control of card.querySelectorAll(CONTENT)) {
      if (!visible(control) || inert(control)) continue;
      const r = control.getBoundingClientRect();
      if (r.height > 1 && r.width > 1) spans.push([r.top, r.bottom]);
    }
    // Cajas con borde (zona de soltar, campos, filas con línea): sus bordes son contenido visible.
    for (const box2 of card.querySelectorAll('*')) {
      if (box2.closest('svg') || inert(box2)) continue;
      const style = getComputedStyle(box2);
      const top = parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== 'none';
      const bottom = parseFloat(style.borderBottomWidth) > 0 && style.borderBottomStyle !== 'none';
      if (!top && !bottom) continue;
      if (!visible(box2)) continue;
      const r = box2.getBoundingClientRect();
      if (r.width < 2 || r.height < 1) continue;
      if (top) spans.push([r.top, r.top + 1]);
      if (bottom) spans.push([r.bottom - 1, r.bottom]);
    }
    // Solo lo que cae dentro de la tarjeta.
    for (let k = spans.length - 1; k >= 0; k -= 1) if (spans[k][1] <= box.top || spans[k][0] >= box.bottom) spans.splice(k, 1);
    spans.sort((x, y) => x[0] - y[0]);
    let cursor = box.top;
    let worst = { gap: 0, at: '' };
    for (const [top, bottom] of spans) {
      if (top - cursor > worst.gap) worst = { gap: Math.round(top - cursor), at: `${Math.round(cursor - box.top)} px desde arriba` };
      cursor = Math.max(cursor, bottom);
    }
    if (box.bottom - cursor > worst.gap) worst = { gap: Math.round(box.bottom - cursor), at: 'al pie' };
    if (worst.gap > maxGap) inner.push({ card: describe(card), ...worst });
  }
  inner.sort((x, y) => y.gap - x.gap);

  // 3. Truncados con espacio: elipsis cortando y lugar libre en el mismo renglón.
  const truncated = [];
  for (const element of rootEl.querySelectorAll('*')) {
    if (!visible(element) || ignored(element) || inert(element) || element.closest('svg')) continue;
    const style = getComputedStyle(element);
    const clamp = style.webkitLineClamp && style.webkitLineClamp !== 'none';
    if (style.textOverflow !== 'ellipsis' || clamp || /^(INPUT|TEXTAREA)$/.test(element.tagName)) continue;
    const need = element.scrollWidth - element.clientWidth;
    if (need <= 1) continue;
    const row = element.closest('li, [role="row"], [role="listitem"], tr') || element.parentElement?.parentElement || element.parentElement;
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

  // 4. Controles tapados: el centro de cada control visible es el control (o algo de adentro).
  const covered = [];
  const CONTROLS = 'button, a[href], input:not([type="hidden"]), textarea, [role="button"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"]';
  function* ancestorsOf(node) { for (let n = node; n && n !== document.body; n = n.parentElement) yield n; }
  const clippedOut = (element, x, y) => {
    for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (/(hidden|clip|auto|scroll)/.test(`${style.overflowX} ${style.overflowY}`)) {
        const r = node.getBoundingClientRect();
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) return true;
      }
    }
    return false;
  };
  for (const control of rootEl.querySelectorAll(CONTROLS)) {
    if (!visible(control) || inert(control) || ignored(control)) continue;
    const style = getComputedStyle(control);
    if (style.pointerEvents === 'none' || style.visibility === 'hidden') continue;
    const r = control.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
    if (clippedOut(control, x, y)) continue;
    const hit = document.elementFromPoint(x, y);
    if (!hit || hit === control || control.contains(hit)) continue;
    // Lo que pasa por debajo de una barra fija o pegajosa al scrollear (índice, barra inferior) no está tapado: se scrollea.
    if (hit.closest('.shell-tabbar') && !rootEl.contains(hit)) continue; // la barra inferior va en su fila: lo de abajo se scrollea
    if ([...ancestorsOf(hit)].some(node => /^(fixed|sticky)$/.test(getComputedStyle(node).position) || (!rootEl.contains(node) && getComputedStyle(node).position === 'absolute'))) continue;
    const label = hit.closest('label');
    if (label && (label.control === control || label.contains(control))) continue;
    covered.push(`${describe(control)} tapado por ${describe(hit)}`);
  }

  return { gaps: gaps.slice(0, 6), inner: inner.slice(0, 6), truncated: truncated.slice(0, 8), covered: covered.slice(0, 8) };
}

/* ── Abrir y cerrar: el disparador no se mueve ───────────────────────────── */

/** Marca los disparadores visibles de `rootSelector` (data-uxt) y devuelve cuántos. */
function markTriggers(rootSelector, max, switchSelector) {
  document.querySelectorAll('[data-uxt]').forEach(node => node.removeAttribute('data-uxt'));
  const rootEl = document.querySelector(rootSelector);
  if (!rootEl) return [];
  const seen = new Set();
  const out = [];
  for (const el of rootEl.querySelectorAll('[aria-expanded]')) {
    if (out.length >= max) break;
    if (el.closest('[inert], [aria-hidden="true"]') || el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
    if (el.getAttribute('role') === 'combobox' || el.hasAttribute('aria-haspopup') || el.closest('[data-ux-skip]')) continue;
    if (!(el.checkVisibility ? el.checkVisibility() : el.getClientRects().length)) continue;
    const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    // Uno por tipo de disparador (en una lista larga, "Editar" de la primera fila alcanza).
    const kind = `${label.replace(/\d+/g, '#')}|${el.getAttribute('aria-expanded')}`;
    if (seen.has(kind)) continue;
    seen.add(kind);
    el.setAttribute('data-uxt', String(out.length));
    out.push(label);
  }
  // Selectores que cambian lo de abajo de golpe (Gráfico/Tabla): uno por tarjeta, hasta 6.
  if (switchSelector) {
    let count = 0;
    for (const el of rootEl.querySelectorAll(switchSelector)) {
      if (count >= 6) break;
      if (el.closest('[inert]') || !(el.checkVisibility ? el.checkVisibility() : el.getClientRects().length)) continue;
      el.setAttribute('data-uxt', String(out.length));
      el.setAttribute('data-uxt-switch', '');
      out.push(`switch: ${(el.textContent || '').trim()} en ${(el.closest('section')?.querySelector('h4, h3')?.textContent || '').slice(0, 30)}`);
      count += 1;
    }
  }
  return out;
}

/**
 * Toca el disparador `index` y mide en cada frame cuánto se movió (solo
 * mientras haya un colapso animando, y al cerrar todo el tiempo). Deja el
 * disparador a `where` ('mid' = 40 % de la vista, 'end' = área al final).
 */
async function toggleOnce(page, index, where) {
  return page.evaluate(async (i, place) => {
    const el = document.querySelector(`[data-uxt="${i}"]`);
    if (!el || !el.isConnected || el.disabled) return { skipped: 'no está' };
    const scroller = document.querySelector('.shell-scroll') || document.scrollingElement;
    const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
    const settle = async () => { for (let n = 0; n < 40; n += 1) { await frame(); if (!document.querySelector('.ui-collapse:is([data-state="opening"], [data-state="closing"])')) break; } await frame(); };
    const viewTop = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
    const viewH = scroller.clientHeight;
    if (place === 'end') scroller.scrollTop = scroller.scrollHeight;
    else scroller.scrollTop += el.getBoundingClientRect().top - viewTop - viewH * 0.4;
    await frame(); await frame();
    const r0 = el.getBoundingClientRect();
    if (r0.bottom < viewTop + 4 || r0.top > viewTop + viewH - 4) return { skipped: 'fuera de vista' };
    const isSwitch = el.hasAttribute('data-uxt-switch');
    const original = isSwitch ? el.parentElement?.querySelector('[aria-checked="true"]') : null;
    const was = isSwitch ? 'switch' : el.getAttribute('aria-expanded');
    const sample = async (ms, onlyAnimating) => {
      const top0 = el.getBoundingClientRect().top;
      let max = 0;
      const until = performance.now() + ms;
      while (performance.now() < until) {
        await frame();
        if (!el.isConnected) break;
        const animating = Boolean(document.querySelector('.ui-collapse:is([data-state="opening"], [data-state="closing"])'));
        if (onlyAnimating && !animating) break;
        max = Math.max(max, Math.abs(el.getBoundingClientRect().top - top0));
      }
      return Math.round(max * 10) / 10;
    };
    // Abrir (o cambiar de estado).
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    el.click();
    const first = await sample(500, was === 'false');
    await settle();
    await new Promise(resolve => setTimeout(resolve, 350)); // deja terminar el "llevar a la vista"
    const now = isSwitch ? 'cambiado' : el.isConnected ? el.getAttribute('aria-expanded') : null;
    let second = null;
    if (isSwitch && original?.isConnected) {
      original.click();
      second = await sample(500, false);
    } else if (el.isConnected && now !== was && !el.disabled) {
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      el.click();
      second = await sample(500, false);
      await settle();
    }
    const after = el.isConnected ? el.getAttribute('aria-expanded') : null;
    return { was, now, after, first, second };
  }, index, where);
}

export async function toggleProbe(page, rootSelector, { max = 14, switches = '' } = {}) {
  const labels = await page.evaluate(markTriggers, rootSelector, max, switches);
  const problems = [];
  const done = [];
  for (let i = 0; i < labels.length; i += 1) {
    for (const where of ['mid', 'end']) {
      const result = await toggleOnce(page, i, where);
      if (result.skipped) continue;
      const opening = result.was === 'false' || result.was === 'switch';
      const tag = `"${labels[i]}" (${where === 'end' ? 'al final' : 'a media pantalla'})`;
      if (result.first > 2) problems.push(`${tag}: al ${opening ? 'abrir' : 'cerrar'} se movió ${result.first} px`);
      if (result.second !== null && result.second > 2) problems.push(`${tag}: al ${opening ? 'cerrar' : 'abrir'} se movió ${result.second} px`);
      if (result.now === result.was) problems.push(`${tag}: aria-expanded no cambió (${result.was})`);
      done.push(`${labels[i]}${where === 'end' ? '·fin' : ''}`);
    }
  }
  return { problems, toggled: done.length, labels };
}

/* ── Recorrido por pantalla ─────────────────────────────────────────────── */

const CARDS = '.kb-card, .an-card, .an-heatcard, .cfg-card, .tl-card, .qa-card, .pc-card, .cv-upload, .ui-empty';

const SCREENS = [
  { key: 'conocimiento', view: 'knowledge', root: '.kb-page', ready: '.kb-page', toggles: true },
  { key: 'conocimiento-articulo', view: 'knowledge', root: '.kb-page', ready: '.kb-page', toggles: true, open: async page => {
    await page.waitForSelector('a.kb-row', { timeout: 10000 });
    await page.evaluate(() => document.querySelector('a.kb-row')?.click());
    await page.waitForSelector('.kb-reader:not([aria-busy])', { timeout: 10000 });
  } },
  { key: 'canvas', view: 'canvas', root: '.cv-page', ready: '.cv-board', ignore: '.cv-board', toggles: true },
  { key: 'analitica', view: 'analytics', root: '.an-page', ready: '.an-heat, .an-ghost', mountAll: true, toggles: true, switches: '[aria-label="Cómo ver los datos"] [role="radio"][aria-checked="false"], .an-card [aria-label="Cuántos mostrar"] [role="radio"][aria-checked="false"]' },
  { key: 'herramientas-tarjetas', view: 'tools', root: '.tl-page', ready: '.tl-page', toggles: true },
  { key: 'herramientas-credenciales', view: 'tools', root: '.tl-page', ready: '.tl-page', tab: /Credenciales 365/, toggles: true },
  { key: 'herramientas-descargas', view: 'tools', root: '.tl-page', ready: '.tl-page', tab: /Descargas/, toggles: true },
  { key: 'accesos', view: 'quickaccess', root: '.qa-page', ready: '.qa-group, .tl-empty', toggles: true },
  { key: 'caja-chica', view: 'pettycash', root: '.pc-page', ready: '.pc-sum-row', toggles: true }
];
const PANELS = ['cuenta', 'apariencia', 'notificaciones', 'turnos', 'modulos', 'roles', 'usuarios', 'invitaciones', 'prestamo', 'vida-util', 'sede', 'avanzado', 'sedes', 'mail'];
for (const panel of PANELS) {
  SCREENS.push({ key: `config-${panel}`, path: `settings/${panel}`, root: '.cfg', ready: `[data-settings-panel="${panel}"]`, widths: [360, 768, 1024, 1440, 1920], toggles: ['roles', 'usuarios', 'invitaciones', 'sedes', 'avanzado', 'mail', 'modulos', 'sede'].includes(panel) });
}

async function openScreen(page, base, screen) {
  if (screen.path) await page.goto(`${base}/sede/NFPT/${screen.path}`, { waitUntil: 'domcontentloaded' });
  else await gotoView(page, base, screen.view);
  await page.waitForSelector('.shell', { timeout: 20000 });
  await page.waitForSelector(screen.ready, { timeout: 20000 });
  if (screen.tab) {
    await page.evaluate((src, flags) => {
      const re = new RegExp(src, flags);
      [...document.querySelectorAll('[role="tab"]')].find(tab => re.test(tab.textContent || ''))?.click();
    }, screen.tab.source, screen.tab.flags);
  }
  if (screen.open) {
    await screen.open(page);
    await page.waitForSelector(screen.ready, { timeout: 10000 });
  }
  if (screen.mountAll) {
    // Analítica: se arman todas las secciones (como al usar el índice) y se vuelve arriba.
    await page.evaluate(() => document.querySelectorAll('.an-index-link')[4]?.click());
    await until(() => page.evaluate(() => !document.querySelector('.an-sec--pending')), { timeout: 15000, message: 'todas las secciones de Analítica' });
    await page.evaluate(() => { const s = document.querySelector('.shell-scroll'); s.scrollTop = s.scrollHeight; });
    await sleep(600);
    await page.evaluate(() => { document.querySelector('.shell-scroll').scrollTop = 0; });
  }
  await sleep(500);
}

/** Recorre la pantalla de arriba abajo (en tramos de una vista) corriendo la sonda en cada tramo. */
async function probeScreen(page, screen) {
  const found = { gaps: new Set(), inner: new Set(), truncated: new Set(), covered: new Set() };
  const steps = await page.evaluate(() => { const s = document.querySelector('.shell-scroll'); s.scrollTop = 0; return Math.min(12, Math.ceil(s.scrollHeight / Math.max(1, s.clientHeight))); });
  for (let step = 0; step < steps; step += 1) {
    await page.evaluate(n => { const s = document.querySelector('.shell-scroll'); s.scrollTop = n * s.clientHeight * 0.9; }, step);
    await sleep(120);
    const probe = await page.evaluate(uxProbe, { rootSelector: screen.root, cardSelector: CARDS, maxGap: MAX_GAP, ignore: screen.ignore || '' });
    if (probe.error) throw new Error(probe.error);
    probe.gaps.forEach(item => found.gaps.add(`${item.gap}px ${item.between}`));
    probe.inner.forEach(item => found.inner.add(`${item.gap}px ${item.at} en ${item.card}`));
    probe.truncated.forEach(item => found.truncated.add(`${item.element} (faltan ${item.need}, sobran ${item.free})`));
    probe.covered.forEach(item => found.covered.add(item));
  }
  await page.evaluate(() => { document.querySelector('.shell-scroll').scrollTop = 0; });
  return Object.fromEntries(Object.entries(found).map(([key, set]) => [key, [...set]]));
}

export async function uxRecursosTests({ browser, base, admin, releaseVersion, test, track = () => {} }) {
  let outReady = false;
  const prepareOut = () => {
    if (outReady) return;
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    outReady = true;
  };
  const report = {};

  for (const screen of SCREENS) {
    const widths = screen.widths || UX_WIDTHS;
    await test('uxr', 'Barrido UX', `${screen.key}: sin huecos, truncados con espacio, tapados ni solapados (${widths.join('/')} px, oscuro y claro)`, async () => {
      const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, reducedMotion: true, viewport: { width: 1440, height: 900 } });
      track(page);
      prepareOut();
      const problems = [];
      try {
        await page.setBypassServiceWorker(true);
        await openScreen(page, base, screen);
        for (const width of widths) {
          await page.setViewport({ width, height: width < 768 ? 780 : 900 });
          await sleep(250);
          for (const theme of ['dark', 'light']) {
            await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
            await sleep(60);
            const probe = await probeScreen(page, screen);
            const layout = await page.evaluate(layoutProbe);
            const where = `${theme} ${width}`;
            (report[screen.key] ||= {})[where] = { ...probe, layout: layout.counts };
            await page.screenshot({ path: path.join(outDir, `${screen.key}-${theme}-${width}.png`), fullPage: false });
            for (const item of probe.gaps) problems.push(`${where}: hueco ${item}`);
            for (const item of probe.inner) problems.push(`${where}: hueco interno ${item}`);
            for (const item of probe.truncated) problems.push(`${where}: truncado con espacio ${item}`);
            for (const item of probe.covered) problems.push(`${where}: ${item}`);
            if (layout.counts.horizontalScroll) problems.push(`${where}: scroll horizontal`);
            for (const item of layout.wrappedButtons) problems.push(`${where}: botón partido ${item}`);
            for (const item of layout.overlaps) problems.push(`${where}: solapados ${item}`);
            for (const item of layout.scrollbars) problems.push(`${where}: barra visible ${item}`);
          }
        }
      } finally {
        await context.close();
      }
      const unique = [...new Set(problems)];
      assert(!unique.length, `${unique.length} problemas:\n${unique.slice(0, 14).join('\n')}`);
      return `${widths.length * 2} vistas limpias`;
    });

    if (!screen.toggles) continue;
    await test('uxr', 'Barrido UX', `${screen.key}: abrir y cerrar cada panel no mueve el disparador (1366 y 390, a media pantalla y al final)`, async () => {
      const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width: 1366, height: 768 } });
      track(page);
      const problems = [];
      let toggled = 0;
      try {
        await page.setBypassServiceWorker(true);
        for (const width of [1366, 390]) {
          await page.setViewport({ width, height: width < 768 ? 760 : 768 });
          await openScreen(page, base, screen);
          const result = await toggleProbe(page, screen.root, { switches: screen.switches || '' });
          toggled += result.toggled;
          for (const item of result.problems) problems.push(`${width}: ${item}`);
        }
      } finally {
        await context.close();
      }
      assert(!problems.length, `${problems.length} problemas:\n${problems.slice(0, 12).join('\n')}`);
      return `${toggled} aperturas/cierres sin mover el disparador`;
    });
  }

  /* ── Borradores: salir por el menú y volver no pierde lo tipeado ── */
  const navTo = (page, view) => page.$eval(`.shell-nav .shell-nav-item[data-view="${view}"]`, button => button.click());
  const typeIn = async (page, selector, text) => {
    const handle = await page.waitForSelector(selector, { timeout: 8000 });
    await handle.click({ clickCount: 3 });
    await handle.type(text);
  };

  await test('uxr', 'Barrido UX', 'Caja chica, Accesos y Herramientas: lo que se estaba cargando vuelve al salir por el menú y entrar de nuevo', async () => {
    const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width: 1366, height: 900 } });
    track(page);
    try {
      await page.setBypassServiceWorker(true);
      // Caja chica: gasto a medio cargar.
      await gotoView(page, base, 'pettycash');
      await page.waitForSelector('.pc-sum-row', { timeout: 20000 });
      await page.evaluate(() => [...document.querySelectorAll('.pc-sum-acts button')].find(node => /Registrar gasto/.test(node.textContent || ''))?.click());
      await typeIn(page, 'form[aria-label="Registrar gasto"] input', 'Pilas AA borrador e2e');
      await navTo(page, 'dashboard');
      await sleep(800);
      await navTo(page, 'pettycash');
      await page.waitForSelector('.pc-sum-row', { timeout: 20000 });
      const pc = await until(() => page.evaluate(() => {
        const region = document.querySelector('[aria-label="Registrar gasto"]');
        const fields = region ? [...region.querySelectorAll('input, textarea')].map(node => node.value) : [];
        return fields.some(value => value.includes('Pilas AA borrador e2e')) ? fields : null;
      }), { timeout: 8000, message: 'el gasto a medio cargar al volver' });
      // Cancelar lo descarta: al volver no está.
      await page.evaluate(() => [...document.querySelectorAll('[aria-label="Registrar gasto"] button')].find(node => /^Cancelar$/.test((node.textContent || '').trim()))?.click());
      await sleep(500);
      await navTo(page, 'dashboard');
      await sleep(600);
      await navTo(page, 'pettycash');
      await page.waitForSelector('.pc-sum-row', { timeout: 20000 });
      await sleep(500);
      const leftover = await page.evaluate(() => [...document.querySelectorAll('[aria-label="Registrar gasto"] input, [aria-label="Registrar gasto"] textarea')].some(node => node.value.includes('Pilas AA borrador e2e')));
      assert(!leftover, 'después de Cancelar el borrador volvió igual');

      // Accesos rápidos: alta a medio tipear.
      await navTo(page, 'quickaccess');
      await page.waitForSelector('.qa-page', { timeout: 20000 });
      await page.evaluate(() => [...document.querySelectorAll('.qa-tools button')].find(node => /Nuevo acceso/.test(node.textContent || ''))?.click());
      await typeIn(page, '[aria-label="Nuevo acceso"] form input', 'Acceso borrador e2e');
      await navTo(page, 'dashboard');
      await sleep(600);
      await navTo(page, 'quickaccess');
      await page.waitForSelector('.qa-page', { timeout: 20000 });
      await until(() => page.evaluate(() => [...document.querySelectorAll('[aria-label="Nuevo acceso"] input')].some(node => node.value === 'Acceso borrador e2e')), { timeout: 8000, message: 'el acceso a medio tipear al volver' });
      return `caja chica: ${pc.filter(Boolean).length} campos con valor · accesos: ok`;
    } finally {
      await context.close();
    }
  });

  await test('uxr', 'Barrido UX', 'Configuración: cerrar algo al pie y cambiar de sección no deja un hueco reservado al pie', async () => {
    const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width: 1366, height: 700 } });
    track(page);
    try {
      await page.setBypassServiceWorker(true);
      await page.goto(`${base}/sede/NFPT/settings/avanzado`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-settings-panel="avanzado"] .cfg-tk', { timeout: 20000 });
      // Abre la última clave, baja al final y la cierra: el encabezado queda quieto (con reserva al pie).
      const label = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('.cfg-tk .cfg-cell-end button')];
        const last = buttons[buttons.length - 1];
        last.click();
        return last.closest('.cfg-trow')?.textContent?.slice(0, 30) || '';
      });
      await sleep(500);
      await page.evaluate(() => { const s = document.querySelector('.shell-scroll'); s.scrollTop = s.scrollHeight; });
      await sleep(200);
      const before = await page.evaluate(() => { const b = [...document.querySelectorAll('.cfg-tk .cfg-cell-end button')].pop(); return b.getBoundingClientRect().top; });
      await page.evaluate(() => [...document.querySelectorAll('.cfg-tk .cfg-cell-end button')].pop().click());
      await sleep(600);
      const after = await page.evaluate(() => { const b = [...document.querySelectorAll('.cfg-tk .cfg-cell-end button')].pop(); return b.getBoundingClientRect().top; });
      assert(Math.abs(after - before) <= 2, `el encabezado de ${label} se movió ${Math.round(after - before)} px al cerrar`);
      // Cambiar a una sección corta: nada reservado al pie, no se puede scrollear a un hueco.
      await page.$eval('.cfg-nav-i[data-panel="turnos"]', button => button.click());
      await page.waitForSelector('[data-settings-panel="turnos"]', { timeout: 8000 });
      await sleep(400);
      const state = await page.evaluate(() => {
        const s = document.querySelector('.shell-scroll');
        return { reserve: s.classList.contains('ui-scroll-reserve'), extra: s.scrollHeight - s.clientHeight };
      });
      assert(!state.reserve, 'quedó la reserva de alto al pie después de cambiar de sección');
      return `encabezado ${Math.round(after - before)} px · sin reserva · ${state.extra} px de scroll en Turnos`;
    } finally {
      await context.close();
    }
  });

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'reporte.json'), JSON.stringify(report, null, 2));
  return report;
}
