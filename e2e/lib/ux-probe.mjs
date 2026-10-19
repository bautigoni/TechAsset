// Sonda UX compartida (REGLAS-UX): la usan la suite `tests/ux.mjs` y las
// pruebas de cada pantalla. Todo lo que mide corre ADENTRO de la página.
//
// API para los frentes:
//
//   import { probeView, checkCollapsibles, setTheme, settle, formatProbe } from '../lib/ux-probe.mjs';
//
//   const probe = await probeView(page, { scope: '.shell-view' });
//   //  probe.counts = { gaps, innerGaps, truncated, cut, covered, fakeClickable }
//   //  probe.gaps / innerGaps / truncated / cut / covered / fakeClickable = muestras
//   //  (cada una con `where` = selector legible del elemento y el detalle)
//   const toggles = await checkCollapsibles(page, { scope: '.mi-pantalla', max: 8 });
//   //  toggles.items = [{ trigger, opened: {maxDelta, maxDocY, change, abrupt}, closed: {...}, problem }]
//   //  toggles.problems = las que fallan: el disparador se movió > 2 px, el
//   //  documento scrolleó, el alto del contenido cambió de golpe (> 40 px en un
//   //  frame, sin transición: `{open && …}` en vez de Collapse), aria-expanded
//   //  no cambió, falta aria-controls o apunta a algo que no existe abierto
//   assert(!probe.total && !toggles.problems.length, formatProbe(probe, toggles));
//
// Qué mide `probeView` (opciones entre paréntesis):
//   gaps          huecos verticales > maxGap (48) entre bloques hermanos consecutivos
//                 (el más cercano arriba con solapamiento horizontal) dentro de `scope`;
//   innerGaps     franjas vacías > maxGap dentro de una tarjeta (caja con fondo o
//                 borde propio): una línea suelta en una tarjeta alta, columnas
//                 estiradas por la de al lado;
//   truncated     texto con elipsis (o `overflow:hidden` sin elipsis) cortado
//                 cuando en su renglón sobra lugar para mostrarlo entero;
//   cut           texto cortado sin elipsis (nowrap + overflow oculto): nunca vale;
//   covered       controles visibles cuyo centro, según elementFromPoint, es de
//                 otro elemento (topbar, barra inferior, algo sticky o flotante).
//                 Se recorre el área que scrollea en pasos (`scrollSteps`, 6);
//   fakeClickable cursor:pointer sin control, rol, tabindex ni handler de React
//                 (o un control deshabilitado con cursor:pointer).
//
// Elementos con `data-ux-ignore` (y lo que tengan adentro) no se miden: usalo
// solo para lienzos/planos donde el espacio vacío es el contenido (Canvas, plano
// de aulas) y explicalo en el componente.

export const MAX_GAP = 48;

/** Sonda (se pasa a page.evaluate). `opts`: { scope, maxGap, ignore, samples, only }. */
export function uxProbe(opts = {}) {
  const { scope = '.shell-view', maxGap = 48, ignore = [], samples = 15, only = null } = opts;
  const want = key => !only || only.includes(key);
  const root = document.querySelector(scope);
  if (!root) return { error: `No está ${scope}` };
  // Para medir el layout cuenta todo lo que se ve (también lo aria-hidden, como una leyenda);
  // para los controles, además se saltea lo inerte u oculto al lector.
  const IGNORE = ['[data-ux-ignore]', 'svg', 'canvas', '.ui-collapse:not([data-state="open"])', ...ignore].join(',');
  const ignored = el => Boolean(el.closest(IGNORE));
  const inertish = el => Boolean(el.closest('[inert], [aria-hidden="true"]'));
  const visible = el => (el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : el.getClientRects().length > 0);
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const one = el => {
    const id = el.id ? `#${el.id}` : '';
    const classes = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).filter(name => !/^(is-|has-)/.test(name)).slice(0, 2).map(name => `.${name}`).join('') : '';
    return `${el.tagName.toLowerCase()}${id}${classes}`;
  };
  // Selector legible: el elemento y su ancestro con clase más cercano, más un pedazo del texto.
  const where = el => {
    let parent = el.parentElement;
    while (parent && parent !== document.body && !(typeof parent.className === 'string' && parent.className.trim())) parent = parent.parentElement;
    const label = clean(el.getAttribute('aria-label') || el.textContent).slice(0, 40);
    return `${parent && parent !== document.body ? `${one(parent)} > ` : ''}${one(el)}${label ? ` "${label}"` : ''}`;
  };
  const rgba = value => {
    const match = String(value).match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const [r, g, b, a = 1] = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r, g, b, a };
  };
  const out = { gaps: [], innerGaps: [], truncated: [], cut: [], covered: [], fakeClickable: [], underSticky: [] };
  const elements = [root, ...root.querySelectorAll('*')].filter(el => !ignored(el));
  const styleCache = new Map();
  const styleOf = el => { let s = styleCache.get(el); if (!s) { s = getComputedStyle(el); styleCache.set(el, s); } return s; };
  const inFlow = el => { const pos = styleOf(el).position; return pos !== 'absolute' && pos !== 'fixed'; };

  // ── (a) Huecos entre bloques hermanos ────────────────────────────────────
  if (want('gaps')) {
    for (const parent of elements) {
      if (parent.children.length < 2 || !visible(parent)) continue;
      const display = styleOf(parent).display;
      if (display.startsWith('inline') && !display.includes('flex') && !display.includes('grid')) continue;
      const kids = [];
      for (const child of parent.children) {
        // Lo ignorado (un lienzo) igual ocupa su lugar como bloque: no se mide por dentro.
        if (!inFlow(child) || !visible(child)) continue;
        const rect = child.getBoundingClientRect();
        if (rect.height > 2 && rect.width > 2) kids.push({ el: child, rect });
      }
      if (kids.length < 2) continue;
      for (const b of kids) {
        let above = null;
        for (const a of kids) {
          if (a === b) continue;
          const overlapX = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
          if (overlapX <= 8 || a.rect.bottom > b.rect.top + 1) continue;
          if (!above || a.rect.bottom > above.rect.bottom) above = a;
        }
        if (!above) continue;
        // Algo de otra columna que ocupa la franja (un hermano que la cruza) no es hueco: es la columna de al lado.
        const gap = Math.round(b.rect.top - above.rect.bottom);
        if (gap > maxGap) out.gaps.push({ gap, where: `${where(above.el)} → ${where(b.el)}` });
      }
    }
  }

  // ── (a') Franjas vacías dentro de tarjetas ────────────────────────────────
  if (want('innerGaps')) {
    const range = document.createRange();
    const INK = 'button, input, textarea, select, img, svg, canvas, video, iframe, [role="checkbox"], [role="switch"], [role="img"], hr';
    const isBox = el => {
      const s = styleOf(el);
      const bg = rgba(s.backgroundColor);
      const borders = ['Top', 'Right', 'Bottom', 'Left'].filter(side => parseFloat(s[`border${side}Width`]) >= 1 && (rgba(s[`border${side}Color`])?.a ?? 0) > 0.05).length;
      return (bg && bg.a > 0.05) || borders >= 3 || s.backgroundImage !== 'none';
    };
    for (const card of elements) {
      if (card === root || card.matches(INK) || card.matches('a, label, li, tr, td, th, p, span, b, strong, em, small, code, pre')) continue;
      if (!visible(card)) continue;
      const box = card.getBoundingClientRect();
      if (box.height < 96 || box.width < 120 || box.height > window.innerHeight * 1.5) continue;
      if (!isBox(card)) continue;
      const s = styleOf(card);
      const top = box.top + parseFloat(s.borderTopWidth) + parseFloat(s.paddingTop);
      const bottom = box.bottom - parseFloat(s.borderBottomWidth) - parseFloat(s.paddingBottom);
      const spans = [];
      const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim() || !node.parentElement || !visible(node.parentElement)) continue;
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) if (r.height > 1 && r.width > 1) spans.push([r.top, r.bottom]);
      }
      for (const el of card.querySelectorAll('*')) {
        if (!(el.matches(INK) || isBox(el)) || !visible(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.height > 1 && r.width > 1) spans.push([r.top, r.bottom]);
      }
      if (!spans.length) continue;
      spans.sort((x, y) => x[0] - y[0]);
      let cursor = top;
      let worst = { gap: 0, at: '' };
      for (const [a, b] of spans) {
        if (a - cursor > worst.gap) worst = { gap: Math.round(a - cursor), at: cursor === top ? 'arriba' : `a ${Math.round(cursor - box.top)} px` };
        cursor = Math.max(cursor, b);
      }
      if (bottom - cursor > worst.gap) worst = { gap: Math.round(bottom - cursor), at: 'al pie' };
      if (worst.gap > maxGap) out.innerGaps.push({ gap: worst.gap, at: worst.at, where: where(card) });
    }
  }

  // ── (b) Texto truncado con lugar libre / cortado sin elipsis ─────────────
  if (want('truncated')) {
    const range = document.createRange();
    for (const el of elements) {
      if (!el.firstChild || !visible(el)) continue;
      const s = styleOf(el);
      const ellipsis = s.textOverflow === 'ellipsis';
      const hidden = s.overflowX === 'hidden' || s.overflowX === 'clip';
      const nowrap = s.whiteSpace === 'nowrap' || s.whiteSpace === 'pre';
      if (!ellipsis && !(hidden && nowrap)) continue;
      if (el.clientWidth <= 2 || el.clientHeight <= 2) continue; // sr-only y similares
      const ownText = [...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim()) || (el.children.length === 1 && el.textContent.trim());
      if (!ownText) continue;
      const need = el.scrollWidth - el.clientWidth;
      if (need <= 1) continue;
      if (!ellipsis) { out.cut.push({ need, where: where(el) }); continue; }
      // Renglón: el ancestro más cercano (hasta 4 niveles) más ancho que el elemento.
      const own = el.getBoundingClientRect();
      let row = el.parentElement;
      for (let i = 0; row && i < 4 && row.getBoundingClientRect().width <= own.width + 8; i += 1) row = row.parentElement;
      if (!row || row === document.body) continue;
      const rowBox = row.getBoundingClientRect();
      const rs = styleOf(row);
      const left = rowBox.left + parseFloat(rs.paddingLeft) + parseFloat(rs.borderLeftWidth);
      const right = rowBox.right - parseFloat(rs.paddingRight) - parseFloat(rs.borderRightWidth);
      const xs = [];
      const add = (r, clip) => {
        if (r.bottom <= own.top + 1 || r.top >= own.bottom - 1) return;
        const l = Math.max(r.left, clip ? clip.left : -Infinity, left);
        const rr = Math.min(r.right, clip ? clip.right : Infinity, right);
        if (rr - l > 0.5) xs.push([l, rr]);
      };
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim() || !node.parentElement || !visible(node.parentElement)) continue;
        range.selectNodeContents(node);
        const clip = node.parentElement.getBoundingClientRect();
        for (const r of range.getClientRects()) add(r, clip);
      }
      for (const control of row.querySelectorAll('button, input, textarea, svg, img, [role="checkbox"], [role="switch"]')) if (visible(control)) add(control.getBoundingClientRect());
      xs.sort((x, y) => x[0] - y[0]);
      let ink = 0;
      let clusters = 0;
      let end = -Infinity;
      for (const [l, r] of xs) {
        if (l > end + 0.5) { clusters += 1; ink += r - l; end = r; } else if (r > end) { ink += r - end; end = r; }
      }
      const free = (right - left) - ink - 12 * Math.max(0, clusters - 1);
      if (free >= need + 4) out.truncated.push({ need: Math.round(need), free: Math.round(free), where: where(el) });
    }
  }

  // ── (c) Controles tapados ────────────────────────────────────────────────
  if (want('covered')) {
    const CONTROLS = 'button, a[href], input:not([type="hidden"]), textarea, select, [role="button"], [role="checkbox"], [role="switch"], [role="tab"], [role="option"], [role="link"], [tabindex="0"]';
    const zone = el => (el.closest('.shell-head') ? 'barra superior' : el.closest('.shell-tabbar') ? 'barra inferior' : el.closest('.shell-nav, .shell-sidebar, aside') ? 'menú lateral' : el.closest('.asst') ? 'asistente' : '');
    for (const el of root.querySelectorAll(CONTROLS)) {
      if (ignored(el) || inertish(el) || !visible(el)) continue;
      const s = styleOf(el);
      if (s.pointerEvents === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) continue;
      // Dentro de lo que se ve de cada ancestro que recorta (lo scrolleado afuera no está tapado).
      let clipped = false;
      for (let node = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
        const ns = styleOf(node);
        if (ns.overflowX === 'visible' && ns.overflowY === 'visible') continue;
        const nr = node.getBoundingClientRect();
        // Con el centro justo en el borde (un control a medio scrollear), elementFromPoint
        // cae en lo de al lado (la barra inferior): eso es "scrolleado afuera", no tapado.
        if (cx <= nr.left + 1 || cx >= nr.right - 1 || cy <= nr.top + 1 || cy >= nr.bottom - 1) { clipped = true; break; }
      }
      if (clipped) continue;
      const hit = document.elementFromPoint(cx, cy);
      if (!hit || hit === el || el.contains(hit)) continue;
      if (hit.tagName === 'LABEL' && (hit.control === el || hit.contains(el))) continue;
      if (hit.contains(el) && styleOf(hit).pointerEvents !== 'none') {
        // El punto cae en un ancestro: el control no recibe el puntero ahí (p. ej. un hijo con pointer-events:none).
        out.covered.push({ where: where(el), by: `${where(hit)} (el control no recibe el click en su centro)` });
        continue;
      }
      const z = zone(hit);
      // Algo sticky (un índice, una cabecera de tabla) que el contenido cruza al scrollear
      // se informa aparte: el control se alcanza scrolleando un poco. Lo fijo sí cuenta.
      let sticky = null;
      for (let node = hit; node && node !== document.body; node = node.parentElement) if (styleOf(node).position === 'sticky') { sticky = node; break; }
      if (sticky && !z) { out.underSticky.push({ where: where(el), by: where(sticky) }); continue; }
      out.covered.push({ where: where(el), by: `${where(hit)}${z ? ` [${z}]` : ''}` });
    }
  }

  // ── (d) Parece clickeable y no lo es ─────────────────────────────────────
  if (want('fakeClickable')) {
    const ROLES = /^(button|link|tab|checkbox|switch|option|menuitem|menuitemcheckbox|menuitemradio|radio|treeitem|slider|combobox|gridcell|row|separator|textbox|searchbox)$/;
    const HANDLERS = ['onClick', 'onMouseDown', 'onMouseUp', 'onPointerDown', 'onPointerUp', 'onDoubleClick', 'onDragStart', 'onTouchStart'];
    const reactProps = el => { const key = Object.keys(el).find(name => name.startsWith('__reactProps$')); return key ? el[key] : null; };
    const interactive = el => {
      if (el.matches('button, a[href], input, select, textarea, label, summary, option, [contenteditable="true"], [draggable="true"]')) return true;
      if (ROLES.test(el.getAttribute('role') || '')) return true;
      if (el.hasAttribute('tabindex') && Number(el.getAttribute('tabindex')) >= 0) return true;
      if (el.hasAttribute('onclick')) return true;
      const props = reactProps(el);
      return Boolean(props && HANDLERS.some(name => typeof props[name] === 'function'));
    };
    const seen = new Set();
    for (const el of elements) {
      if (!visible(el) || styleOf(el).cursor !== 'pointer') continue;
      const parent = el.parentElement;
      if (parent && styleOf(parent).cursor === 'pointer' && !el.matches('button, a, input, [role="button"]')) continue; // heredado: se mira el de arriba
      const disabled = el.matches(':disabled, [aria-disabled="true"]');
      if (disabled) { out.fakeClickable.push({ where: `${where(el)} (deshabilitado con cursor:pointer)` }); continue; }
      let ok = false;
      // El handler puede estar en un ancestro (delegación) o el cursor venir de un control de arriba.
      for (let node = el; node && node !== document.body; node = node.parentElement) if (interactive(node)) { ok = true; break; }
      if (ok) continue;
      // Si algo de adentro es el control (una tarjeta cuyo único hijo es un botón a todo el tamaño), vale.
      const r = el.getBoundingClientRect();
      const inner = el.querySelector('button, a[href], [role="button"]');
      if (inner) { const ir = inner.getBoundingClientRect(); if (ir.width >= r.width - 4 && ir.height >= r.height - 4) continue; }
      const key = where(el);
      if (!seen.has(key)) { seen.add(key); out.fakeClickable.push({ where: key }); }
    }
  }

  const sortBy = (list, key) => list.sort((a, b) => (b[key] || 0) - (a[key] || 0));
  sortBy(out.gaps, 'gap');
  sortBy(out.innerGaps, 'gap');
  const dedupe = list => { const seen = new Set(); return list.filter(item => { const key = item.where + (item.by || ''); if (seen.has(key)) return false; seen.add(key); return true; }); };
  const result = { counts: {} };
  for (const key of Object.keys(out)) {
    const list = dedupe(out[key]);
    result.counts[key] = list.length;
    result[key] = list.slice(0, samples);
  }
  // (adentro de la página no existe countTotal: misma cuenta acá)
  result.total = Object.entries(result.counts).reduce((sum, [key, value]) => (key === 'underSticky' ? sum : sum + value), 0);
  return result;
}

/** Lo que cuenta como problema (underSticky es informativo). */
export function countTotal(counts) {
  return Object.entries(counts).reduce((sum, [key, value]) => (key === 'underSticky' ? sum : sum + value), 0);
}

/** Contenedor que scrollea el contenido (en el shell, `.shell-scroll`). */
const SCROLLER = '.shell-scroll';

/**
 * Corre la sonda en la vista actual. Huecos, tarjetas y "parece clickeable" se
 * miden una vez (no dependen del scroll); tapados y truncados se miden en cada
 * paso del recorrido del área que scrollea (`scrollSteps`, 0 = solo arriba).
 * Al terminar deja el scroll arriba.
 */
export async function probeView(page, { scope = '.shell-view', maxGap = MAX_GAP, ignore = [], samples = 15, scrollSteps = 6, coverScope = 'body' } = {}) {
  await page.mouse.move(1, 1).catch(() => {}); // sin tooltips abiertos por el puntero
  const base = await page.evaluate(uxProbe, { scope, maxGap, ignore, samples, only: ['gaps', 'innerGaps', 'truncated', 'fakeClickable'] });
  if (base.error) return base;
  const merged = { ...base, covered: [], cut: [], underSticky: [], counts: { ...base.counts, covered: 0, cut: 0, underSticky: 0 } };
  const seen = { covered: new Set(), cut: new Set(), underSticky: new Set() };
  const positions = await page.evaluate((sel, steps) => {
    const sc = document.querySelector(sel);
    if (!sc) return [0];
    const max = sc.scrollHeight - sc.clientHeight;
    if (max <= 4 || !steps) return [0];
    const step = Math.max(sc.clientHeight * 0.8, max / steps);
    const list = [];
    for (let y = 0; y < max; y += step) list.push(Math.round(y));
    list.push(max);
    return list.slice(0, steps + 1);
  }, SCROLLER, scrollSteps);
  for (const y of positions) {
    await page.evaluate((sel, top) => { const sc = document.querySelector(sel); if (sc) sc.scrollTop = top; }, SCROLLER, y);
    await new Promise(resolve => setTimeout(resolve, 60));
    const part = await page.evaluate(uxProbe, { scope: coverScope, maxGap, ignore, samples: 50, only: ['covered', 'truncated'] });
    if (part.error) continue;
    // `cut` sale del mismo recorrido que truncated (ver uxProbe).
    for (const key of ['covered', 'cut', 'underSticky']) {
      for (const item of part[key] || []) {
        const id = item.where + (item.by || '');
        if (seen[key].has(id)) continue;
        seen[key].add(id);
        merged[key].push(y ? { ...item, scrollTop: y } : item);
      }
    }
  }
  await page.evaluate(sel => { const sc = document.querySelector(sel); if (sc) sc.scrollTop = 0; }, SCROLLER);
  for (const key of ['covered', 'cut', 'underSticky']) {
    merged.counts[key] = merged[key].length;
    merged[key] = merged[key].slice(0, samples);
  }
  merged.total = countTotal(merged.counts);
  return merged;
}

/** Tema oscuro/claro sin recargar (mismo efecto que Configuración › Apariencia). */
export async function setTheme(page, theme) {
  await page.evaluate(value => {
    document.documentElement.dataset.theme = value;
    document.documentElement.classList.toggle('theme-light', value === 'light');
    document.body.classList.toggle('theme-light', value === 'light');
  }, theme);
}

/** Espera a que la vista deje los skeletons y la API se calme (máx. ~4 s). */
export async function settle(page, { quietMs = 300, maxMs = 4000 } = {}) {
  await page.waitForFunction(() => !document.querySelector('.view-enter .skeleton-view, .shell-view .ui-skel, .shell-view [class*="skeleton"]'), { timeout: 8000 }).catch(() => {});
  const net = networkTracker(page);
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    if (net.pending.size === 0 && Date.now() - net.last >= quietMs) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  await new Promise(resolve => setTimeout(resolve, 150));
}

export function networkTracker(page) {
  if (page.__uxNet) return page.__uxNet;
  const net = { pending: new Set(), last: Date.now() };
  const done = request => { net.pending.delete(request); net.last = Date.now(); };
  page.on('request', request => { if (!new URL(request.url()).pathname.startsWith('/api/')) return; net.pending.add(request); net.last = Date.now(); });
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  page.__uxNet = net;
  return net;
}

/**
 * (e) Abre y cierra cada colapsable visible de `scope` (botones con
 * aria-expanded + aria-controls) con el mouse de verdad y mide, frame a frame,
 * que el disparador no se mueva más de `tolerance` px y que el documento no
 * scrollee. Anima de verdad (desactiva reduced motion mientras mide). No toca
 * disparadores cuyo texto coincide con `skip` (destructivos o que navegan).
 */
export async function checkCollapsibles(page, { scope = '.shell-view', exclude = '', max = 8, tolerance = 2, settleMs = 520, skip = /borrar|eliminar|vaciar|cerrar sesi|salir|descartar|restablecer/i } = {}) {
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  // Al prender el movimiento arrancan las animaciones de entrada que estaban
  // apagadas (la vista entra con opacidad 0): se espera a que terminen.
  await settleAnimations(page);
  const items = [];
  try {
    const triggers = await page.evaluate((sel, source, flags, excludeSel) => {
      const rx = new RegExp(source, flags);
      const root = document.querySelector(sel);
      if (!root) return [];
      const list = [];
      // Disparadores: botones con aria-expanded (los campos combobox no: se abren tipeando).
      const all = [...root.querySelectorAll('button[aria-expanded], [role="button"][aria-expanded]')];
      all.forEach((el, index) => {
        const visible = el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : el.getClientRects().length > 0;
        if (!visible || el.closest('[inert], [aria-hidden="true"], [data-ux-ignore]') || el.matches(':disabled, [aria-disabled="true"]')) return;
        if (excludeSel && el.closest(excludeSel)) return;
        const text = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (rx.test(text)) return;
        el.setAttribute('data-ux-trigger', String(index));
        list.push({ id: String(index), text: text.slice(0, 40), controls: el.getAttribute('aria-controls') });
      });
      return list;
    }, scope, skip.source, skip.flags, exclude);
    for (const trigger of triggers.slice(0, max)) {
      const selector = `[data-ux-trigger="${trigger.id}"]`;
      const item = { trigger: `${trigger.text || '(sin texto)'}${trigger.controls ? ` [aria-controls=${trigger.controls}]` : ''}` };
      const once = async () => {
        const point = await page.evaluate(sel => {
          const el = document.querySelector(sel);
          if (!el?.isConnected) return null;
          const sc = el.closest('.shell-scroll');
          // Peor caso razonable: el disparador a un tercio de la vista, con lugar abajo.
          if (sc) {
            const r = el.getBoundingClientRect();
            const sr = sc.getBoundingClientRect();
            sc.scrollTop += r.top - sr.top - sc.clientHeight / 3;
          }
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2, expanded: el.getAttribute('aria-expanded') };
        }, selector);
        if (!point) return { missing: true };
        await new Promise(resolve => setTimeout(resolve, 120));
        await page.evaluate(sel => {
          const el = document.querySelector(sel);
          const top0 = el.getBoundingClientRect().top;
          const main = document.querySelector('.shell-main') || document.body;
          const sc = el.closest('.shell-scroll');
          const scroll0 = sc ? sc.scrollTop : 0;
          // Por frame: cuánto se movió en pantalla, cuánto de eso explica el scroll
          // (llevar lo abierto a la vista es válido) y si sigue a la vista.
          // Alto de lo que se abre/cierra (el colapso que envuelve al aria-controls), para no
          // confundir un colapso suave con un salto cuando el alto de la página tiene un piso
          // (otra columna más alta) y el primer frame de la curva ya consume todo el cambio visible.
          const panelHeight = () => {
            const id = el.getAttribute('aria-controls');
            const target = id ? document.getElementById(id) : null;
            const box = target?.closest('.ui-collapse') || target;
            return box?.isConnected ? Math.round(box.getBoundingClientRect().height) : 0;
          };
          const out = { deltas: [], shifts: [], hidden: 0, docY: [], heights: [Math.round(main.getBoundingClientRect().height)], panel: [panelHeight()] };
          window.__uxWatch = out;
          const tick = () => {
            if (out.stop) return;
            if (el.isConnected) {
              const r = el.getBoundingClientRect();
              const screen = r.top - top0;
              const scrolled = sc ? sc.scrollTop - scroll0 : 0;
              out.deltas.push(screen);
              out.shifts.push(Math.abs(screen) > 2 ? screen + scrolled : 0);
              const box = sc ? sc.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
              if (r.top < box.top - 1 || r.bottom > box.bottom + 1) out.hidden += 1;
            }
            out.docY.push(document.scrollingElement.scrollTop + window.scrollY);
            out.heights.push(Math.round(main.getBoundingClientRect().height));
            out.panel.push(panelHeight());
            requestAnimationFrame(() => setTimeout(tick));
          };
          requestAnimationFrame(() => setTimeout(tick));
        }, selector);
        const fresh = await page.evaluate(sel => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, selector);
        await page.mouse.click(fresh.x, fresh.y);
        await new Promise(resolve => setTimeout(resolve, settleMs));
        return page.evaluate(sel => {
          const out = window.__uxWatch;
          out.stop = true;
          const el = document.querySelector(sel);
          const controls = el?.getAttribute('aria-controls');
          // ¿El alto del contenido cambió de golpe? (> 40 px de un frame al otro, sin valores intermedios)
          const h = out.heights;
          const change = Math.abs(h[h.length - 1] - h[0]);
          const steps = h.slice(1).map((value, i) => Math.abs(value - h[i])).filter(step => step > 0.5);
          // …salvo que lo que se abre/cierra haya pasado por valores intermedios (se animó).
          const p = out.panel.filter(value => value > 0);
          const lo = Math.min(...p, Infinity);
          const hi = Math.max(...p, 0);
          const smoothPanel = p.length > 0 && hi - lo > 40 && new Set(p.filter(value => value > lo + 2 && value < hi - 2)).size >= 2;
          const abrupt = change > 40 && steps.length > 0 && Math.max(...steps) >= change - 2 && !smoothPanel;
          return {
            abrupt,
            change,
            maxDelta: Math.round(Math.max(0, ...out.deltas.map(Math.abs)) * 10) / 10,
            maxShift: Math.round(Math.max(0, ...out.shifts.map(Math.abs)) * 10) / 10,
            leftView: out.hidden > 0,
            maxDocY: Math.max(0, ...out.docY),
            frames: out.deltas.length,
            before: null,
            after: el?.getAttribute('aria-expanded') ?? null,
            connected: Boolean(el?.isConnected),
            controls: controls || '',
            target: controls ? Boolean(document.getElementById(controls)) : false
          };
        }, selector).then(result => ({ ...result, before: point.expanded }));
      };
      const first = await once();
      if (first.missing) continue;
      const second = first.connected && first.after !== first.before ? await once() : null;
      const opened = first.before === 'false' ? first : second;
      const closed = first.before === 'false' ? second : first;
      const pick = result => result && { maxDelta: result.maxDelta, maxShift: result.maxShift, leftView: result.leftView, maxDocY: result.maxDocY, change: result.change, abrupt: result.abrupt };
      item.opened = pick(opened);
      item.closed = pick(closed);
      const problems = [];
      if (!first.connected) problems.push('el disparador se desmontó al tocarlo');
      else if (first.after === first.before) problems.push('aria-expanded no cambió');
      for (const [label, result] of [['abrir', opened], ['cerrar', closed]]) {
        if (!result) continue;
        // Al abrir vale scrollear para mostrar lo nuevo si el disparador sigue a la vista;
        // lo que no vale es que se corra porque cambió el layout, ni que se vaya de la vista.
        if (label === 'abrir' ? result.maxShift > tolerance : result.maxDelta > tolerance) problems.push(`al ${label} el disparador se movió ${label === 'abrir' ? result.maxShift : result.maxDelta} px`);
        else if (label === 'abrir' && result.leftView) problems.push('al abrir el disparador quedó fuera de la vista');
        if (result.maxDocY > 0) problems.push(`al ${label} el documento scrolleó ${result.maxDocY} px`);
        if (result.abrupt) problems.push(`al ${label} el contenido cambió ${result.change} px de golpe (sin transición de alto)`);
      }
      if (first.connected && !trigger.controls && !first.controls && !second?.controls) problems.push('sin aria-controls');
      else if (opened && opened === first && first.controls && !first.target) problems.push(`aria-controls=${first.controls} no existe abierto`);
      if (problems.length) item.problem = problems.join('; ');
      items.push(item);
    }
  } finally {
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]).catch(() => {});
  }
  return { items, problems: items.filter(item => item.problem) };
}

/** Espera a que terminen las animaciones finitas en curso (máx. `maxMs`). */
export async function settleAnimations(page, maxMs = 1500) {
  await page.evaluate(limit => Promise.race([
    Promise.all(document.getAnimations()
      .filter(animation => Number.isFinite(animation.effect?.getComputedTiming?.().endTime ?? Infinity))
      .map(animation => animation.finished.catch(() => {}))),
    new Promise(resolve => setTimeout(resolve, limit))
  ]), maxMs).catch(() => {});
}

/** Texto corto de un resultado (para el detalle de una prueba que falla). */
export function formatProbe(probe, toggles) {
  const parts = [];
  if (probe?.error) return probe.error;
  const c = probe?.counts || {};
  const first = (list, fn) => (list?.length ? ` (${list.slice(0, 2).map(fn).join(' | ')})` : '');
  if (c.gaps) parts.push(`${c.gaps} huecos${first(probe.gaps, item => `${item.gap}px ${item.where}`)}`);
  if (c.innerGaps) parts.push(`${c.innerGaps} tarjetas con franja vacía${first(probe.innerGaps, item => `${item.gap}px ${item.at} ${item.where}`)}`);
  if (c.truncated) parts.push(`${c.truncated} truncados con lugar${first(probe.truncated, item => `${item.where} faltan ${item.need}px, sobran ${item.free}px`)}`);
  if (c.cut) parts.push(`${c.cut} cortados sin elipsis${first(probe.cut, item => item.where)}`);
  if (c.covered) parts.push(`${c.covered} controles tapados${first(probe.covered, item => `${item.where} por ${item.by}`)}`);
  if (c.fakeClickable) parts.push(`${c.fakeClickable} parecen clickeables${first(probe.fakeClickable, item => item.where)}`);
  if (toggles?.problems?.length) parts.push(`${toggles.problems.length} colapsables${first(toggles.problems, item => `${item.trigger}: ${item.problem}`)}`);
  return parts.join(' · ');
}
