// Ayudas de la revisión UX 7 (Aulas e Historial): medir cuadro a cuadro que
// nada cambie de alto de golpe y que los vecinos de una fila tengan la misma
// altura. Son locales a estas pantallas; si sirven en otras, van a lib/.
import { sleep } from '../lib/browser.mjs';

/**
 * Graba el alto de `selector` en cada cuadro (requestAnimationFrame) mientras
 * corre `action` y `ms` después. Devuelve la lista de altos.
 */
export async function recordHeights(page, selector, action, ms = 700) {
  await page.evaluate(sel => {
    window.__uxRec = [];
    window.__uxRecOn = true;
    const tick = () => {
      const el = document.querySelector(sel);
      window.__uxRec.push(el ? Math.round(el.getBoundingClientRect().height * 10) / 10 : -1);
      if (window.__uxRecOn) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, selector);
  await sleep(50);
  await action();
  await sleep(ms);
  return page.evaluate(() => { window.__uxRecOn = false; return window.__uxRec; });
}

/**
 * ¿Cambió de alto "de golpe"? Si el cambio total es grande (> min px) y un
 * solo cuadro se lleva más del 85 % o no hay al menos 3 altos intermedios, es
 * un salto. (La curva del sistema, var(--g-ease), arranca rápido y en un cuadro
 * pesado —50 filas nuevas— el primero puede llevarse ~2/3: eso sigue siendo
 * una transición; un salto es pasar del alto inicial al final de una.)
 * Devuelve null si está bien, o el detalle.
 */
export function abruptChange(heights, { min = 40, share = 0.85 } = {}) {
  const list = heights.filter(value => value >= 0);
  if (list.length < 2) return null;
  const first = list[0];
  const last = list[list.length - 1];
  const total = Math.abs(last - first);
  if (total < min) return null;
  let maxStep = 0;
  for (let i = 1; i < list.length; i += 1) maxStep = Math.max(maxStep, Math.abs(list[i] - list[i - 1]));
  const lo = Math.min(first, last) + 2;
  const hi = Math.max(first, last) - 2;
  const between = new Set(list.filter(value => value > lo && value < hi)).size;
  return maxStep > total * share || between < 3 ? { first, last, maxStep: Math.round(maxStep), between, frames: list.length } : null;
}

/**
 * Vecinos de una fila con la misma altura y alineados (agregado 2 del dueño):
 * dentro de cada `row` (selector), los elementos que matchean `items` y están
 * en el mismo renglón (se solapan en Y) tienen que medir lo mismo (± tol) y
 * tener el mismo centro vertical. Devuelve la lista de problemas.
 */
export async function unevenNeighbors(page, rows, { tol = 1 } = {}) {
  return page.evaluate((specs, tolerance) => {
    const problems = [];
    const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.closest('.ui-collapse:not([data-state="open"])'); };
    for (const { row, items } of specs) {
      for (const container of document.querySelectorAll(row)) {
        const els = [...container.querySelectorAll(items)].filter(visible).map(el => ({ el, r: el.getBoundingClientRect() }));
        // Agrupa por renglón (centro vertical dentro del alto del otro).
        const lines = [];
        for (const item of els) {
          const cy = item.r.top + item.r.height / 2;
          const line = lines.find(group => group.some(other => cy > other.r.top && cy < other.r.bottom));
          if (line) line.push(item); else lines.push([item]);
        }
        for (const line of lines) {
          if (line.length < 2) continue;
          const hs = line.map(item => item.r.height);
          const cs = line.map(item => item.r.top + item.r.height / 2);
          const name = item => `${item.el.tagName.toLowerCase()}.${String(item.el.className).split(' ').slice(0, 2).join('.')} "${(item.el.textContent || '').trim().slice(0, 18)}"`;
          if (Math.max(...hs) - Math.min(...hs) > tolerance) problems.push(`${row}: altos ${line.map(item => `${name(item)}=${Math.round(item.r.height)}`).join(', ')}`);
          else if (Math.max(...cs) - Math.min(...cs) > tolerance) problems.push(`${row}: desalineados ${line.map(item => `${name(item)}@${Math.round(item.r.top)}`).join(', ')}`);
        }
      }
    }
    return problems;
  }, rows, tol);
}
