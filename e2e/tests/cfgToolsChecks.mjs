// Chequeos de la revisión UX 9 (Configuración y Herramientas), usados por
// tests/settings.mjs y tests/tools.mjs. Corren adentro de la página.
import { sleep } from '../lib/browser.mjs';
import { setTheme } from '../lib/ux-probe.mjs';

export const WIDTHS = [360, 390, 768, 1024, 1280, 1366, 1440, 1600, 1920];
/** Hueco máximo entre la barra superior y la primera "tinta" de la vista (el padding del sistema es 24 px). */
export const MAX_TOP_GAP = 32;

/**
 * Mide en la vista actual:
 *  - topGap: px entre el borde de arriba del área que scrollea y el primer texto,
 *    control o caja con fondo/borde de `.shell-view` (espacio muerto arriba);
 *  - clipped: cajas pintadas (fondo, borde, sombra, controles) recortadas por un
 *    ancestro con overflow (incluye el resaltado de un ítem activo);
 *  - hscroll: scroll horizontal de la página o del área de contenido;
 *  - rows: controles con caja (botón, campo, segmentado) uno al lado del otro
 *    con distinta altura o desalineados.
 */
export function layoutChecks() {
  const visible = el => (el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : el.getClientRects().length > 0);
  const name = el => `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 2).join('.')} "${String(el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30)}"`;
  const closed = el => Boolean(el.closest('.ui-collapse:not([data-state="open"]), [data-ux-ignore]'));
  const view = document.querySelector('.shell-view');
  const scroller = document.querySelector('.shell-scroll');
  const out = { topGap: 0, first: '', clipped: [], hscroll: false, rows: [] };
  if (!view || !scroller) return { ...out, error: 'sin .shell-view' };
  const painted = el => {
    const s = getComputedStyle(el);
    return (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent') || parseFloat(s.borderTopWidth) >= 1 || parseFloat(s.borderLeftWidth) >= 1 || s.boxShadow !== 'none' || el.matches('button, a, input, textarea, svg, img');
  };
  // Hueco arriba
  let best = Infinity;
  const range = document.createRange();
  const walker = document.createTreeWalker(view, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim() || !node.parentElement || !visible(node.parentElement) || closed(node.parentElement)) continue;
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) if (r.height > 1 && r.width > 1 && r.top < best) { best = r.top; out.first = name(node.parentElement); }
  }
  for (const el of view.querySelectorAll('*')) {
    if (!visible(el) || closed(el) || !painted(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 4 && r.height > 1 && r.top < best) { best = r.top; out.first = name(el); }
  }
  out.topGap = Math.round(best - scroller.getBoundingClientRect().top + scroller.scrollTop);
  out.hscroll = document.documentElement.scrollWidth > innerWidth + 1 || scroller.scrollWidth > scroller.clientWidth + 1;
  // Recortes
  for (const root of [view, document.querySelector('.shell-nav')].filter(Boolean)) {
    for (const el of root.querySelectorAll('*')) {
      if (!visible(el) || closed(el) || !painted(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const as = getComputedStyle(a);
        if (as.overflowX === 'visible' && as.overflowY === 'visible') continue;
        if (a.matches('.ui-collapse-clip, .ui-trunc')) break; // el colapso recorta a propósito mientras anima; el truncado tiene tooltip
        const ar = a.getBoundingClientRect();
        const L = ar.left + parseFloat(as.borderLeftWidth); const T = ar.top + parseFloat(as.borderTopWidth);
        const R = L + a.clientWidth; const B = T + a.clientHeight;
        const scrollY = /(auto|scroll)/.test(as.overflowY); const scrollX = /(auto|scroll)/.test(as.overflowX);
        const cut = [];
        if (r.top < T - 0.5 && (!scrollY || a.scrollTop <= 0)) cut.push(`arriba ${Math.round(T - r.top)}`);
        if (r.bottom > B + 0.5 && (!scrollY || a.scrollTop >= a.scrollHeight - a.clientHeight - 1)) cut.push(`abajo ${Math.round(r.bottom - B)}`);
        if (r.left < L - 0.5 && (!scrollX || a.scrollLeft <= 0)) cut.push(`izq ${Math.round(L - r.left)}`);
        if (r.right > R + 0.5 && (!scrollX || a.scrollLeft >= a.scrollWidth - a.clientWidth - 1)) cut.push(`der ${Math.round(r.right - R)}`);
        const outside = r.bottom <= T || r.top >= B || r.right <= L || r.left >= R;
        if (cut.length && !outside) out.clipped.push(`${name(el)} por ${name(a).slice(0, 40)}: ${cut.join(', ')}`);
        break;
      }
    }
  }
  // Vecinos con caja en una fila: misma altura y alineados
  const BOX = '.ui-btn, .ui-icon-btn, .ui-control, .ui-seg';
  for (const parent of view.querySelectorAll('*')) {
    if (!visible(parent) || closed(parent)) continue;
    const s = getComputedStyle(parent);
    if (!(s.display.includes('flex') && !s.flexDirection.startsWith('column')) && !s.display.includes('grid')) continue;
    const ctrl = [...parent.children]
      .map(k => (k.matches(BOX) ? k : (k.children.length === 1 && k.firstElementChild.matches(BOX) ? k.firstElementChild : null)))
      .filter(c => c && visible(c) && !c.closest('.ui-control > *'))
      .map(c => ({ c, r: c.getBoundingClientRect() }));
    for (let i = 0; i < ctrl.length; i += 1) {
      for (let j = i + 1; j < ctrl.length; j += 1) {
        const a = ctrl[i].r; const b = ctrl[j].r;
        if (Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) <= Math.min(a.height, b.height) * 0.5) continue; // otra línea
        if (Math.abs(a.height - b.height) > 1.5) out.rows.push(`alto ${Math.round(a.height)}≠${Math.round(b.height)}: ${name(ctrl[i].c)} | ${name(ctrl[j].c)}`);
        else if (Math.abs(a.top - b.top) > 1.5) out.rows.push(`desalineados ${Math.round(a.top - b.top)} px: ${name(ctrl[i].c)} | ${name(ctrl[j].c)}`);
      }
    }
  }
  out.clipped = [...new Set(out.clipped)].slice(0, 8);
  out.rows = [...new Set(out.rows)].slice(0, 8);
  return out;
}

/** Recorre anchos y temas en la vista abierta (sin recargar) y junta lo que falla. */
export async function sweepLayout(page, label, { widths = WIDTHS, themes = ['dark', 'light'], ready } = {}) {
  const problems = [];
  for (const width of widths) {
    await page.setViewport({ width, height: width < 768 ? 800 : 900 });
    await sleep(250);
    if (ready) await ready();
    for (const theme of themes) {
      await setTheme(page, theme);
      await sleep(60);
      const m = await page.evaluate(layoutChecks);
      const where = `${label} ${width} ${theme}`;
      if (m.error) problems.push(`${where}: ${m.error}`);
      if (m.topGap > MAX_TOP_GAP) problems.push(`${where}: ${m.topGap} px vacíos arriba (primero: ${m.first})`);
      if (m.hscroll) problems.push(`${where}: scroll horizontal`);
      for (const item of m.clipped) problems.push(`${where}: recortado ${item}`);
      for (const item of m.rows) problems.push(`${where}: ${item}`);
    }
  }
  await setTheme(page, 'dark');
  return problems;
}

/**
 * Graba, cuadro a cuadro, el alto de `target` y la posición de `anchor`
 * mientras corre `act`. Sirve para probar que nada aparece "de golpe": el alto
 * tiene que pasar por valores intermedios y el control tocado quedarse quieto.
 */
export async function recordFrames(page, { target, anchor, act, ms = 650 }) {
  await page.evaluate((t, a, dur) => {
    window.__cfgFrames = [];
    const t0 = performance.now();
    const tick = () => {
      const el = document.querySelector(t);
      const an = a ? document.querySelector(a) : null;
      window.__cfgFrames.push({ h: el ? el.getBoundingClientRect().height : 0, top: an ? an.getBoundingClientRect().top : null });
      if (performance.now() - t0 < dur) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, target, anchor || null, ms);
  await act();
  await sleep(ms + 120);
  const frames = await page.evaluate(() => window.__cfgFrames);
  const heights = frames.map(f => Math.round(f.h));
  const tops = frames.map(f => f.top).filter(v => v !== null);
  const from = heights[0];
  const to = heights[heights.length - 1];
  const steps = heights.filter((h, i) => i && h !== heights[i - 1]);
  // Cuadros con un alto entre el de antes y el de después (no el salto de un cuadro).
  const between = heights.filter(h => Math.min(from, to) + 2 < h && h < Math.max(from, to) - 2).length;
  // Mayor salto de un cuadro, como fracción del cambio total.
  const bigJump = heights.reduce((max, h, i) => (i ? Math.max(max, Math.abs(h - heights[i - 1])) : max), 0);
  return { from, to, between, steps: steps.length, bigJump, anchorMove: tops.length ? Math.round(Math.max(...tops) - Math.min(...tops)) : 0 };
}

/** El cambio de alto fue suave (o no hubo cambio) y el control no se movió. */
export function smoothEnough(rec, { label, tolerance = 2 } = {}) {
  const delta = Math.abs(rec.to - rec.from);
  const problems = [];
  if (delta > 24 && (rec.between < 3 || rec.bigJump > delta * 0.6)) problems.push(`${label}: de ${rec.from} a ${rec.to} px de golpe (cuadros intermedios ${rec.between}, mayor salto ${rec.bigJump})`);
  if (rec.anchorMove > tolerance) problems.push(`${label}: el control tocado se movió ${rec.anchorMove} px`);
  return problems;
}
