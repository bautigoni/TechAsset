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
//                 (o un control deshabilitado con cursor:pointer);
//   clipped       (20/10) lo que se pinta de un elemento — caja, sombra exterior,
//                 anillo de foco (medido enfocando uno de cada tipo con
//                 :focus-visible, `sampleFocusRings`) y ::before/::after absolutos
//                 (la rayita del ítem activo) — cortado > 1 px por un ancestro con
//                 overflow ≠ visible; en un contenedor que scrollea (nativo o
//                 paneado con transform) solo cuenta el borde donde el scroll
//                 llegó al tope ("Inicio" cortado arriba): lo cortado del lado
//                 donde queda scroll se ve scrolleando;
//   topGap        (20/10) con el contenido arriba de todo, lo primero que se ve
//                 empieza a > 32 px de la cabecera, o la primera fila es solo algo
//                 chico a la derecha y el primer bloque de la izquierda arranca a
//                 > maxGap (el hueco de la captura del dueño en el Inicio);
//   mismatch      (20/10) vecinos de distinto tamaño: controles con caja en una
//                 misma fila de un flex/grid con alturas distintas (> 1 px), o
//                 tarjetas tipo mosaico (≤ 240 px, que no agrupan otras tarjetas:
//                 un carril del tablero no es un mosaico) de una fila con distinto alto;
//   modal         (20/10) ventanas emergentes (role=dialog, aria-modal, <dialog>)
//                 o capas fijas que tapan > 25 % de la pantalla. Excepción: el
//                 diálogo del cartelito (ALLOWED_DIALOG_NAME) y el tooltip.
// `checkCollapsibles` además marca la apertura/cierre "de golpe": lo que el
// disparador controla (aria-controls) pasa de su alto inicial al final en un
// solo cuadro, sin valores intermedios (sin Collapse), con el movimiento prendido.
// Pendientes conocidos de otras pantallas: KNOWN_PENDING + splitKnown (abajo).
//
// Elementos con `data-ux-ignore` (y lo que tengan adentro) no se miden: usalo
// solo para lienzos/planos donde el espacio vacío es el contenido (Canvas, plano
// de aulas) y explicalo en el componente.

export const MAX_GAP = 48;

/**
 * Única ventana emergente permitida (excepción del dueño, CLAUDE.md, 20/10): el
 * diálogo de entregar/devolver un cartelito (src/ui/Dialog.tsx). Se reconoce por
 * su nombre accesible (aria-label o el título de aria-labelledby) con "cartelito".
 * Cualquier otro diálogo, aria-modal o capa fija grande es un hallazgo (`modal`).
 */
export const ALLOWED_DIALOG_NAME = 'cartelito';
const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"], dialog[open], [aria-modal="true"]';

/**
 * PENDIENTES CONOCIDOS de pantallas de OTROS revisores (revisión UX 20/10).
 * Las comprobaciones nuevas de la sonda (recortes por overflow, hueco arriba,
 * vecinos de distinto tamaño, ventanas emergentes, apertura de golpe) son
 * bloqueantes en TODAS las vistas; lo que encontraron al estrenarse en
 * pantallas ajenas queda listado acá para que no rompa el e2e mientras cada
 * dueño lo arregla. Cada caso se sigue informando (ux.mjs → "pendientes
 * conocidos" en el reporte y en hallazgos.md). Cuando el dueño lo arregla,
 * BORRÁ la línea (si no, un caso nuevo con el mismo selector pasaría sin avisar).
 *
 *   view:  regex sobre la clave de la vista en ux.mjs ('dashboard', 'loans',
 *          'settings/usuarios', 'device:D1436', 'task:12', 'shell'…)
 *   kind:  clipped | topGap | mismatch | modal | gaps | innerGaps | truncated |
 *          cut | covered | fakeClickable | toggle
 *   where: regex sobre el `where` de la muestra (o "disparador: problema" en toggle)
 *   owner: quién lo arregla
 */
export const KNOWN_PENDING = [];

/** Saca de un resultado de probeView los pendientes conocidos de la vista. Devuelve { probe, known }. */
export function splitKnown(viewKey, probe) {
  if (!probe || probe.error) return { probe, known: [] };
  const known = [];
  const next = { ...probe, counts: { ...probe.counts } };
  for (const kind of Object.keys(probe.counts || {})) {
    const rules = KNOWN_PENDING.filter(rule => rule.kind === kind && rule.view.test(viewKey));
    if (!rules.length || !Array.isArray(probe[kind])) continue;
    const keep = [];
    for (const item of probe[kind]) {
      const text = `${item.where || ''}${item.by ? ` por ${item.by}` : ''}`;
      const rule = rules.find(candidate => candidate.where.test(text));
      if (rule) known.push({ kind, where: item.where, owner: rule.owner, note: rule.note || '' });
      else keep.push(item);
    }
    // La muestra puede venir recortada (samples): se descuenta lo que se sacó de ella.
    next.counts[kind] = Math.max(keep.length, probe.counts[kind] - (probe[kind].length - keep.length));
    next[kind] = keep;
  }
  next.total = countTotal(next.counts);
  return { probe: next, known };
}

/** Igual que splitKnown para el resultado de checkCollapsibles. */
export function splitKnownToggles(viewKey, toggles) {
  const rules = KNOWN_PENDING.filter(rule => rule.kind === 'toggle' && rule.view.test(viewKey));
  if (!rules.length) return { toggles, known: [] };
  const known = [];
  const problems = [];
  for (const item of toggles.problems) {
    const rule = rules.find(candidate => candidate.where.test(`${item.trigger}: ${item.problem}`));
    if (rule) known.push({ kind: 'toggle', where: `${item.trigger}: ${item.problem}`, owner: rule.owner, note: rule.note || '' });
    else problems.push(item);
  }
  return { toggles: { ...toggles, problems }, known };
}

/** Sonda (se pasa a page.evaluate). `opts`: { scope, maxGap, ignore, samples, only }. */
export function uxProbe(opts = {}) {
  const { scope = '.shell-view', maxGap = 48, ignore = [], samples = 15, only = null, dialogName = 'cartelito', dialogSel = '[role="dialog"], [role="alertdialog"], dialog[open], [aria-modal="true"]' } = opts;
  const want = key => !only || only.includes(key);
  const allowedDialog = el => {
    const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    const name = el.getAttribute('aria-label') || ids.map(id => document.getElementById(id)?.textContent || '').join(' ');
    return new RegExp(dialogName, 'i').test(name);
  };
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
  const out = { gaps: [], innerGaps: [], truncated: [], cut: [], covered: [], fakeClickable: [], clipped: [], topGap: [], mismatch: [], modal: [], underSticky: [] };
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
      // El menú lateral es una columna del alto de la ventana (lista arriba, pie abajo), no una tarjeta.
      if (card.matches('.shell-nav')) continue;
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
      // El diálogo del cartelito (la única ventana emergente permitida) tapa a propósito.
      const dialog = hit.closest(dialogSel);
      if (dialog && allowedDialog(dialog)) continue;
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

  // ── (f) Recortado por un ancestro con overflow ───────────────────────────
  // Lo que se pinta de un elemento (su caja, su sombra exterior, el anillo de
  // foco que tendría con :focus-visible y sus ::before/::after absolutos, como
  // la rayita del ítem activo) no puede quedar cortado por un ancestro con
  // overflow distinto de visible (o contain: paint). Tolerancia: 1 px. En un
  // contenedor que scrollea, cortar es normal salvo en el borde donde el scroll
  // ya llegó a su tope (arriba con scrollTop 0, al fondo con el scroll al final):
  // ahí lo cortado no se puede ver nunca (el "Inicio cortado arriba").
  if (want('clipped')) {
    const px = value => parseFloat(value) || 0;
    const rings = window.__uxFocusRings || {};
    const signature = el => `${el.tagName}|${typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(name => !/^(is-|has-)/.test(name)).sort().join('.') : ''}|${el.getAttribute('role') || ''}`;
    const FOCUSABLE = 'button, a[href], [role="tab"], [role="option"], [role="button"], [tabindex="0"]';
    const INK = 'button, input, textarea, select, img, svg, canvas, video, iframe, [role="checkbox"], [role="switch"], [role="img"], hr';
    const shadowExtent = value => {
      const ext = { top: 0, right: 0, bottom: 0, left: 0 };
      if (!value || value === 'none') return ext;
      for (const part of value.split(/,(?![^(]*\))/)) {
        if (/\binset\b/.test(part)) continue;
        const color = rgba(part);
        if (color && color.a < 0.05) continue;
        const nums = (part.replace(/[a-z-]+\([^)]*\)/gi, ' ').match(/-?[\d.]+px/g) || []).map(parseFloat);
        const [x = 0, y = 0, blur = 0, spread = 0] = nums;
        const reach = spread + blur * 0.5; // la cola de un desenfoque no se nota cortada
        ext.top = Math.max(ext.top, reach - y);
        ext.bottom = Math.max(ext.bottom, reach + y);
        ext.left = Math.max(ext.left, reach - x);
        ext.right = Math.max(ext.right, reach + x);
      }
      return ext;
    };
    const grow = (rect, ext) => ({ top: rect.top - Math.max(0, ext.top), bottom: rect.bottom + Math.max(0, ext.bottom), left: rect.left - Math.max(0, ext.left), right: rect.right + Math.max(0, ext.right) });
    const hasText = el => [...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim());
    const isPaintBox = el => {
      const s = styleOf(el);
      const bg = rgba(s.backgroundColor);
      const borders = ['Top', 'Right', 'Bottom', 'Left'].some(side => px(s[`border${side}Width`]) >= 1 && (rgba(s[`border${side}Color`])?.a ?? 0) > 0.05);
      return (bg && bg.a > 0.05) || borders || s.backgroundImage !== 'none';
    };
    // Ancestros que recortan (memo por elemento).
    const clipMemo = new Map();
    const clipList = el => {
      if (clipMemo.has(el)) return clipMemo.get(el);
      const parent = el.parentElement;
      let list = [];
      if (parent && parent !== document.documentElement && parent !== document.body) {
        list = clipList(parent);
        const s = styleOf(parent);
        const paint = /\b(paint|strict|content)\b/.test(s.contain);
        const textClip = s.textOverflow === 'ellipsis' || (s.webkitLineClamp && s.webkitLineClamp !== 'none'); // eso es "truncado"
        const x = (s.overflowX !== 'visible' || paint) && !textClip;
        const y = (s.overflowY !== 'visible' || paint) && !textClip;
        if ((x || y) && (parent.clientWidth || parent.clientHeight)) list = [...list, { el: parent, x, y }];
      }
      clipMemo.set(el, list);
      return list;
    };
    // Hasta dónde llegó el scroll de un contenedor que recorta, por eje. Un
    // recorte en un borde es defecto solo si ese borde ya está en su tope
    // (atStart arriba/izquierda, atEnd abajo/derecha): si queda scroll en esa
    // dirección, lo cortado es contenido alcanzable (se ve scrolleando), y si
    // el contenedor no scrollea en ese eje los dos bordes son tope.
    // Dos formas de scrollear: la nativa (overflow auto/scroll con contenido
    // de más) y el paneo programático (overflow hidden/clip con un hijo
    // corrido por un transform de traslación pura, como el tablero de Tareas
    // con flechas, arrastre y degradé en el borde): ahí el tope es el borde
    // del hijo contra el del contenedor.
    const scrollRange = (c, box) => {
      const cs = styleOf(c);
      const native = (axis, over, pos, size, client) => {
        const scrolls = /auto|scroll/.test(over) && c[size] > c[client] + 1;
        return scrolls ? { atStart: c[pos] <= 0, atEnd: c[pos] >= c[size] - c[client] - 1, scrolls } : null;
      };
      const pan = axis => {
        for (const child of c.children) {
          const t = styleOf(child).transform;
          const m = t && t !== 'none' ? t.match(/^matrix\(([^)]+)\)$/) : null;
          if (!m) continue;
          const [a, b, cc, d] = m[1].split(',').map(parseFloat);
          if (a !== 1 || b !== 0 || cc !== 0 || d !== 1) continue; // solo traslación (no escala ni giro)
          // El hijo puede medir lo mismo que el contenedor y desbordar con su
          // contenido (una fila flex de columnas): su largo es el de scroll.
          const r = child.getBoundingClientRect();
          const [lo, hi, start, end] = axis === 'x'
            ? [box.left, box.right, r.left, Math.max(r.right, r.left + child.scrollWidth)]
            : [box.top, box.bottom, r.top, Math.max(r.bottom, r.top + child.scrollHeight)];
          if (end - start <= hi - lo + 1) continue;
          return { atStart: start >= lo - 1, atEnd: end <= hi + 1, scrolls: true };
        }
        return null;
      };
      const none = { atStart: true, atEnd: true, scrolls: false };
      return {
        x: native('x', cs.overflowX, 'scrollLeft', 'scrollWidth', 'clientWidth') || (/hidden|clip/.test(cs.overflowX) && pan('x')) || none,
        y: native('y', cs.overflowY, 'scrollTop', 'scrollHeight', 'clientHeight') || (/hidden|clip/.test(cs.overflowY) && pan('y')) || none
      };
    };
    const flagged = new Map(); // elemento → clipper (para no repetir en los hijos)
    const check = (el, paint, what, label) => {
      const pos = styleOf(el).position;
      if (pos === 'fixed') return;
      const list = clipList(el);
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const clip = list[i];
        const c = clip.el;
        if (pos === 'absolute' && el.offsetParent && c !== el.offsetParent && !c.contains(el.offsetParent)) continue;
        const r = c.getBoundingClientRect();
        const box = { left: r.left + c.clientLeft, top: r.top + c.clientTop };
        box.right = box.left + c.clientWidth;
        box.bottom = box.top + c.clientHeight;
        // Del todo afuera: scrolleado fuera de la vista (no está "cortado", no se ve).
        if (paint.right <= box.left + 1 || paint.left >= box.right - 1 || paint.bottom <= box.top + 1 || paint.top >= box.bottom - 1) return;
        const range = scrollRange(c, box);
        const sides = [];
        if (clip.y) {
          if (box.top - paint.top > 1 && range.y.atStart) sides.push(`arriba ${Math.round(box.top - paint.top)}px`);
          if (paint.bottom - box.bottom > 1 && range.y.atEnd) sides.push(`abajo ${Math.round(paint.bottom - box.bottom)}px`);
        }
        if (clip.x) {
          if (box.left - paint.left > 1 && range.x.atStart) sides.push(`izquierda ${Math.round(box.left - paint.left)}px`);
          if (paint.right - box.right > 1 && range.x.atEnd) sides.push(`derecha ${Math.round(paint.right - box.right)}px`);
        }
        if (!sides.length) {
          // Lo que sigue (los ancestros de afuera) solo puede recortar lo que este deja ver.
          paint = { top: clip.y ? Math.max(paint.top, box.top) : paint.top, bottom: clip.y ? Math.min(paint.bottom, box.bottom) : paint.bottom, left: clip.x ? Math.max(paint.left, box.left) : paint.left, right: clip.x ? Math.min(paint.right, box.right) : paint.right };
          continue;
        }
        for (let up = el.parentElement; up && up !== c; up = up.parentElement) if (flagged.get(up) === c) return;
        flagged.set(el, c);
        out.clipped.push({ where: label || where(el), what, side: sides.join(', '), by: where(c) });
        return;
      }
    };
    for (const el of elements) {
      if (!visible(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 2 || rect.height <= 2) continue; // sr-only y similares
      const s = styleOf(el);
      const focusable = el.matches(FOCUSABLE) && !el.matches(':disabled') && !inertish(el);
      const ring = focusable ? rings[signature(el)] : null;
      const own = el.matches(INK) || hasText(el) || isPaintBox(el);
      const shadow = shadowExtent(s.boxShadow);
      const outline = s.outlineStyle !== 'none' ? px(s.outlineWidth) + px(s.outlineOffset) : 0;
      if (own) check(el, rect, 'caja');
      if (!flagged.has(el)) {
        const ext = { top: Math.max(shadow.top, outline), bottom: Math.max(shadow.bottom, outline), left: Math.max(shadow.left, outline), right: Math.max(shadow.right, outline) };
        if (ext.top > 1 || ext.bottom > 1 || ext.left > 1 || ext.right > 1) check(el, grow(rect, ext), 'sombra/borde exterior');
      }
      if (!flagged.has(el) && ring && (ring.top > 1 || ring.bottom > 1 || ring.left > 1 || ring.right > 1)) check(el, grow(rect, ring), 'anillo de foco');
      // ::before/::after absolutos (la rayita del ítem activo, un indicador).
      if (!flagged.has(el) && s.position !== 'static') {
        for (const pseudo of ['::before', '::after']) {
          const ps = getComputedStyle(el, pseudo);
          if (ps.content === 'none' || ps.display === 'none' || ps.position !== 'absolute' || ps.visibility === 'hidden') continue;
          const w = px(ps.width);
          const h = px(ps.height);
          if (w < 1 || h < 1) continue;
          const left0 = rect.left + px(s.borderLeftWidth);
          const top0 = rect.top + px(s.borderTopWidth);
          const innerW = el.clientWidth;
          const innerH = el.clientHeight;
          const left = ps.left !== 'auto' ? left0 + px(ps.left) : ps.right !== 'auto' ? left0 + innerW - px(ps.right) - w : null;
          const top = ps.top !== 'auto' ? top0 + px(ps.top) : ps.bottom !== 'auto' ? top0 + innerH - px(ps.bottom) - h : null;
          if (left === null || top === null) continue;
          check(el, { left, top, right: left + w, bottom: top + h }, pseudo, `${where(el)}${pseudo}`);
        }
      }
    }
  }

  // ── (g) Hueco entre la barra superior y el primer bloque ─────────────────
  // Con el contenido arriba de todo: lo primero que se ve (texto, control,
  // caja con fondo o borde) no puede empezar a más de TOP_GAP (32 px: el
  // relleno de la página más el espaciado del sistema) de la cabecera. Y si la
  // primera fila es solo algo chico a la derecha (un "Actualizado hace…" con un
  // botón) y el primer bloque de la izquierda arranca a más de maxGap, ese
  // espacio muerto arriba a la izquierda también es un hueco.
  if (want('topGap')) {
    const sc = root.closest('.shell-scroll');
    if (sc && sc.scrollTop <= 1) {
      const TOP_GAP = 32;
      const top0 = sc.getBoundingClientRect().top;
      const area = root.getBoundingClientRect();
      const W = Math.max(1, Math.min(area.right, window.innerWidth) - area.left);
      const limit = top0 + 320;
      const pageBg = styleOf(sc).backgroundColor;
      const INK = 'button, input, textarea, select, img, svg, canvas, video, iframe, [role="checkbox"], [role="switch"], [role="img"], hr';
      const inks = [];
      const range = document.createRange();
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (!node.textContent.trim() || !parent || ignored(parent) || !visible(parent)) continue;
        range.selectNodeContents(node);
        const r = range.getBoundingClientRect();
        if (r.height > 1 && r.width > 1 && r.top < limit && r.bottom > top0) inks.push({ r, el: parent });
      }
      for (const el of elements) {
        if (el === root) continue;
        const r = el.getBoundingClientRect();
        if (r.top >= limit || r.bottom <= top0 || r.height <= 1 || r.width <= 1) continue;
        let ink = el.matches(INK);
        if (!ink) {
          const s = styleOf(el);
          const bg = rgba(s.backgroundColor);
          const borders = ['Top', 'Right', 'Bottom', 'Left'].filter(side => parseFloat(s[`border${side}Width`]) >= 1 && (rgba(s[`border${side}Color`])?.a ?? 0) > 0.05).length;
          ink = borders >= 3 || (bg && bg.a > 0.05 && s.backgroundColor !== pageBg);
        }
        if (ink && visible(el)) inks.push({ r, el });
      }
      if (inks.length) {
        inks.sort((a, b) => a.r.top - b.r.top);
        const first = inks[0];
        const lead = Math.round(first.r.top - top0);
        if (lead > TOP_GAP) out.topGap.push({ gap: lead, at: 'arriba de todo', where: where(first.el) });
        else {
          // Primera fila: lo que se cruza en alto con lo primero (hasta 64 px).
          let rowBottom = Math.min(first.r.bottom, first.r.top + 64);
          const row = [];
          for (const item of inks) {
            if (item.r.top >= rowBottom - 1) break;
            row.push(item);
            rowBottom = Math.max(rowBottom, Math.min(item.r.bottom, first.r.top + 64));
          }
          const xs = row.map(item => [Math.max(item.r.left, area.left), Math.min(item.r.right, area.left + W)]).filter(([l, r]) => r > l).sort((a, b) => a[0] - b[0]);
          let covered = 0;
          let end = -Infinity;
          for (const [l, r] of xs) { if (l > end) { covered += r - l; end = r; } else if (r > end) { covered += r - end; end = r; } }
          const startsRight = xs.length && xs[0][0] - area.left > W * 0.4;
          if (startsRight && covered < W * 0.35) {
            const next = inks.find(item => item.r.top >= rowBottom - 1 && item.r.left - area.left < W * 0.4);
            const gap = next ? Math.round(next.r.top - top0) : 0;
            if (gap > maxGap) out.topGap.push({ gap, at: 'arriba a la izquierda (la primera fila es solo algo a la derecha)', where: `${where(row[0].el)} → ${where(next.el)}` });
          }
        }
      }
    }
  }

  // ── (i) Ventanas emergentes / capas fijas ────────────────────────────────
  // Nada de modales ni capas flotantes (CLAUDE.md), salvo el tooltip de texto
  // truncado y el diálogo del cartelito. Se mira toda la página.
  if (want('modal')) {
    const area = window.innerWidth * window.innerHeight;
    const seenModal = new Set();
    for (const el of document.querySelectorAll(dialogSel)) {
      if (!visible(el) || el.closest('[data-ux-ignore]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || allowedDialog(el)) continue;
      seenModal.add(el);
      out.modal.push({ where: where(el), what: 'diálogo' });
    }
    for (const el of document.body.querySelectorAll('*')) {
      if (seenModal.has(el)) continue;
      const pos = styleOf(el).position;
      if (pos !== 'fixed' && pos !== 'sticky') continue;
      if (pos === 'sticky' || el.matches('[role="tooltip"], .ui-tooltip') || el.closest('[role="tooltip"], .ui-tooltip')) continue;
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height < area * 0.25) continue;
      const dialog = el.closest(dialogSel) || el.querySelector(dialogSel);
      if (dialog && allowedDialog(dialog)) continue;
      out.modal.push({ where: where(el), what: 'capa fija grande' });
    }
  }

  // ── (h) Vecinos de distinto tamaño ───────────────────────────────────────
  // En una fila de un contenedor flex/grid: los controles con caja visible
  // (botones, campos, segmentados, chips, kbd) tienen la misma altura, y las
  // tarjetas de una misma fila, el mismo alto. Tolerancia: 1 px.
  if (want('mismatch')) {
    const CONTROL = 'button, [role="button"], [role="tab"], a[href], input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="hidden"]), select, textarea, kbd, .ui-kbd, [role="combobox"], [role="group"], [role="radiogroup"], [role="tablist"]';
    const SMALL = '[role="checkbox"], [role="switch"], [role="radio"], input[type="checkbox"], input[type="radio"], svg, img';
    const bgOf = el => { for (let node = el; node; node = node.parentElement) { const c = rgba(styleOf(node).backgroundColor); if (c && c.a > 0.05) return styleOf(node).backgroundColor; } return ''; };
    const boxed = el => {
      const s = styleOf(el);
      const borders = ['Top', 'Right', 'Bottom', 'Left'].filter(side => parseFloat(s[`border${side}Width`]) >= 1 && (rgba(s[`border${side}Color`])?.a ?? 0) > 0.05).length;
      if (borders >= 3) return true;
      const bg = rgba(s.backgroundColor);
      return Boolean(bg && bg.a > 0.05 && s.backgroundColor !== bgOf(el.parentElement));
    };
    // La caja visible de un hijo: él mismo o, si es un envoltorio (o un botón) sin caja, su único hijo.
    const visualOf = el => {
      let node = el;
      for (let i = 0; i < 4 && node && !boxed(node) && node.children.length === 1; i += 1) node = node.children[0];
      return node;
    };
    for (const parent of elements) {
      if (parent.children.length < 2 || !visible(parent)) continue;
      const s = styleOf(parent);
      const grid = s.display.includes('grid');
      const flexRow = s.display.includes('flex') && s.flexDirection.startsWith('row');
      if (!grid && !flexRow) continue;
      const boxes = [];
      for (const child of parent.children) {
        if (ignored(child) || !inFlow(child) || !visible(child) || child.matches(SMALL)) continue;
        const el = visualOf(child);
        if (!el || ignored(el) || el.matches(SMALL) || !visible(el) || !boxed(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        const control = r.height <= 64 && (el.matches(CONTROL) || Boolean(el.closest(CONTROL) && child.contains(el.closest(CONTROL))) || Boolean(el.querySelector('input, textarea, select, [role="combobox"]')));
        // Tarjetas tipo mosaico (KPI, resúmenes): hasta 240 px. Lo más alto en una
        // fila son columnas de layout (lista + lector, carriles, columnas que
        // fluyen): eso lo cuida la regla de huecos, no la de alturas parejas.
        // Una columna con pocas tarjetas también puede medir ≤ 240 (un carril
        // del tablero con una tarea): una caja que adentro tiene otra tarjeta
        // (caja de > 48 px de alto y ≥ 60 % de su ancho) agrupa tarjetas y su
        // alto es el de su lista, no un mosaico.
        const holdsCards = () => [...el.querySelectorAll('*')].some(inner => {
          if (!boxed(inner) || !visible(inner)) return false;
          const ir = inner.getBoundingClientRect();
          return ir.height > 48 && ir.width >= r.width * 0.6;
        });
        const card = r.height > 64 && r.height <= 240 && !holdsCards();
        if (control || card) boxes.push({ el, r, kind: control ? 'control' : 'card' });
      }
      if (boxes.length < 2) continue;
      for (const kind of ['control', 'card']) {
        const list = boxes.filter(box => box.kind === kind);
        // Filas: los controles se cruzan en su centro; las tarjetas arrancan a la misma altura.
        const rows = [];
        for (const box of list) {
          const mid = (box.r.top + box.r.bottom) / 2;
          const row = rows.find(items => items.some(other => (kind === 'control'
            ? mid > other.r.top && mid < other.r.bottom
            : Math.abs(other.r.top - box.r.top) <= 2)));
          if (row) row.push(box); else rows.push([box]);
        }
        for (const row of rows) {
          if (row.length < 2) continue;
          const heights = row.map(box => Math.round(box.r.height * 10) / 10);
          const spread = Math.max(...heights) - Math.min(...heights);
          if (spread > 1) out.mismatch.push({ spread: Math.round(spread), kind: kind === 'control' ? 'controles' : 'tarjetas', where: `${where(parent)}: ${row.slice(0, 4).map((box, i) => `${one(box.el)} ${heights[i]}px`).join(' · ')}` });
        }
      }
    }
  }

  const sortBy = (list, key) => list.sort((a, b) => (b[key] || 0) - (a[key] || 0));
  sortBy(out.gaps, 'gap');
  sortBy(out.innerGaps, 'gap');
  sortBy(out.topGap, 'gap');
  sortBy(out.mismatch, 'spread');
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
  await sampleFocusRings(page, scope);
  const base = await page.evaluate(uxProbe, { scope, maxGap, ignore, samples, only: ['gaps', 'innerGaps', 'truncated', 'fakeClickable', 'topGap', 'mismatch', 'modal'] });
  if (base.error) return base;
  const merged = { ...base, covered: [], cut: [], clipped: [], underSticky: [], counts: { ...base.counts, covered: 0, cut: 0, clipped: 0, underSticky: 0 } };
  const seen = { covered: new Set(), cut: new Set(), clipped: new Set(), underSticky: new Set() };
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
    // Recortes: en el alcance de la vista, en cada posición (el borde de arriba
    // cuenta con el scroll arriba y el de abajo con el scroll al fondo).
    const clip = await page.evaluate(uxProbe, { scope, maxGap, ignore, samples: 50, only: ['clipped'] });
    if (!clip.error) part.clipped = clip.clipped;
    if (part.error) continue;
    // `cut` sale del mismo recorrido que truncated (ver uxProbe).
    for (const key of ['covered', 'cut', 'clipped', 'underSticky']) {
      for (const item of part[key] || []) {
        const id = item.where + (item.by || '') + (item.what || '');
        if (seen[key].has(id)) continue;
        seen[key].add(id);
        merged[key].push(y ? { ...item, scrollTop: y } : item);
      }
    }
  }
  await page.evaluate(sel => { const sc = document.querySelector(sel); if (sc) sc.scrollTop = 0; }, SCROLLER);
  for (const key of ['covered', 'cut', 'clipped', 'underSticky']) {
    merged.counts[key] = merged[key].length;
    merged[key] = merged[key].slice(0, samples);
  }
  merged.total = countTotal(merged.counts);
  return merged;
}

/**
 * Anillo de foco de cada tipo de control (misma etiqueta, clases y rol) del
 * alcance: enfoca uno de cada tipo con :focus-visible (después de una tecla,
 * como alguien que navega con Tab), mide cuánto sobresale el outline o la
 * sombra que suma el foco y lo deja en `window.__uxFocusRings` para la sonda
 * de recortes. Devuelve el foco a donde estaba.
 */
export async function sampleFocusRings(page, scope = '.shell-view') {
  // Una tecla que no hace nada: desde ahí el foco por script cuenta como de teclado.
  await page.keyboard.press('Shift').catch(() => {});
  await page.evaluate(sel => {
    const root = document.querySelector(sel);
    window.__uxFocusRings = {};
    if (!root) return;
    const px = value => parseFloat(value) || 0;
    const signature = el => `${el.tagName}|${typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(name => !/^(is-|has-)/.test(name)).sort().join('.') : ''}|${el.getAttribute('role') || ''}`;
    const shadowExt = value => {
      const ext = { top: 0, right: 0, bottom: 0, left: 0 };
      if (!value || value === 'none') return ext;
      for (const part of value.split(/,(?![^(]*\))/)) {
        if (/\binset\b/.test(part)) continue;
        if (/rgba\([^)]*,\s*0\)/.test(part)) continue;
        const [x = 0, y = 0, blur = 0, spread = 0] = (part.replace(/[a-z-]+\([^)]*\)/gi, ' ').match(/-?[\d.]+px/g) || []).map(parseFloat);
        const reach = spread + blur * 0.5;
        ext.top = Math.max(ext.top, reach - y); ext.bottom = Math.max(ext.bottom, reach + y);
        ext.left = Math.max(ext.left, reach - x); ext.right = Math.max(ext.right, reach + x);
      }
      return ext;
    };
    const kinds = new Map();
    for (const el of root.querySelectorAll('button, a[href], [role="tab"], [role="option"], [role="button"], [tabindex="0"]')) {
      if (el.matches(':disabled') || el.closest('[inert], [aria-hidden="true"], .ui-collapse:not([data-state="open"])')) continue;
      if (!(el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : el.getClientRects().length)) continue;
      const key = signature(el);
      if (!kinds.has(key)) kinds.set(key, el);
    }
    const before = document.activeElement;
    for (const [key, el] of kinds) {
      const base = shadowExt(getComputedStyle(el).boxShadow);
      el.focus({ preventScroll: true });
      if (document.activeElement !== el) continue;
      const s = getComputedStyle(el);
      const outline = s.outlineStyle !== 'none' && el.matches(':focus-visible') ? px(s.outlineWidth) + px(s.outlineOffset) : 0;
      const shadow = shadowExt(s.boxShadow);
      const ring = {};
      for (const side of ['top', 'right', 'bottom', 'left']) ring[side] = Math.max(outline, shadow[side] > base[side] ? shadow[side] : 0);
      window.__uxFocusRings[key] = ring;
    }
    if (before && before !== document.body && before.isConnected) before.focus({ preventScroll: true });
    else document.activeElement?.blur?.();
  }, scope).catch(() => {});
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
          // Apertura/cierre de golpe del contenido controlado (aria-controls): su alto
          // pasa del valor de partida al final en un solo cuadro (0 → todo), sin
          // valores intermedios. Se mide con el movimiento prendido.
          const all = out.panel;
          const panelChange = Math.abs(all[all.length - 1] - all[0]);
          const panelSteps = all.slice(1).map((value, i) => Math.abs(value - all[i])).filter(step => step > 0.5);
          const panelJump = panelChange > 24 && panelSteps.length > 0 && Math.max(...panelSteps) >= panelChange - 2;
          return {
            abrupt,
            panelJump,
            panelFrom: all[0],
            panelTo: all[all.length - 1],
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
      // Abrió el diálogo del cartelito (la única ventana emergente permitida): se
      // cierra con Esc y no se mide como colapso (lo prueba su propia suite).
      const dialogOpen = await page.evaluate((sel, name) => [...document.querySelectorAll(sel)].some(el => {
        const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
        const label = el.getAttribute('aria-label') || ids.map(id => document.getElementById(id)?.textContent || '').join(' ');
        return el.getClientRects().length > 0 && new RegExp(name, 'i').test(label);
      }), DIALOG_SELECTOR, ALLOWED_DIALOG_NAME);
      if (dialogOpen) {
        await page.keyboard.press('Escape');
        await new Promise(resolve => setTimeout(resolve, settleMs));
        items.push({ ...item, note: 'abre el diálogo del cartelito (excepción del dueño)' });
        continue;
      }
      const second = first.connected && first.after !== first.before ? await once() : null;
      const opened = first.before === 'false' ? first : second;
      const closed = first.before === 'false' ? second : first;
      const pick = result => result && { maxDelta: result.maxDelta, maxShift: result.maxShift, leftView: result.leftView, maxDocY: result.maxDocY, change: result.change, abrupt: result.abrupt, panelJump: result.panelJump, panelFrom: result.panelFrom, panelTo: result.panelTo };
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
        else if (result.panelJump) problems.push(`al ${label} lo que controla pasó de ${result.panelFrom} a ${result.panelTo} px en un cuadro (de golpe, sin Collapse)`);
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
  if (c.clipped) parts.push(`${c.clipped} recortados por un overflow${first(probe.clipped, item => `${item.where} (${item.what}, ${item.side}) por ${item.by}`)}`);
  if (c.modal) parts.push(`${c.modal} ventanas emergentes o capas fijas${first(probe.modal, item => `${item.what} ${item.where}`)}`);
  if (c.mismatch) parts.push(`${c.mismatch} filas con vecinos de distinto tamaño${first(probe.mismatch, item => `${item.kind} ${item.where}`)}`);
  if (c.topGap) parts.push(`${c.topGap} huecos arriba${first(probe.topGap, item => `${item.gap}px ${item.at}: ${item.where}`)}`);
  if (toggles?.problems?.length) parts.push(`${toggles.problems.length} colapsables${first(toggles.problems, item => `${item.trigger}: ${item.problem}`)}`);
  return parts.join(' · ');
}
