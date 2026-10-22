// ux8) Revisión UX 8 (docs/redesign/revision-ux/ENCARGO.md, con los agregados
// del dueño): Analítica, Sugerencias y Caja chica.
//
// Por pantalla, a 360/768/1366/1920 en oscuro y claro (Sugerencias y Caja
// chica con datos servidos interceptando los GET: cortos, largos y vacíos, sin
// escribir en la copia de la base):
//   - sin espacio muerto arriba: el primer bloque con tinta empieza a ≤ 40 px
//     del borde de arriba del área que scrollea;
//   - nada recortado por un ancestro con overflow (borde, resaltado o texto
//     fuera de la caja que lo recorta, o arriba del origen de un scroll);
//   - vecinos de una misma fila con la misma altura: controles (botones,
//     segmentados, campos) y tarjetas de una fila de Analítica;
//   - rótulos de los resúmenes enteros (nada de "Implementad…" a 360 px) y
//     los botones de Caja chica que bajan a varias filas llenan cada fila.
// Interacciones mirando cuadro a cuadro (sin movimiento reducido): nada cambia
// de alto de golpe (un salto ≥ el cambio total en un solo cuadro) y el control
// tocado queda quieto (± 2 px):
//   - Analítica: Gráfico ↔ Tabla, Top N, período (las secciones);
//   - Sugerencias: filtro de estado, "Mostrar todo", comentarios (cargando →
//     lista), categorías usadas del formulario;
//   - Caja chica: "Ver más" de gastos, ordenar, "Registrar también en
//     Inventario TIC" (cantidad).
// Además: el diagrama de puntos de duración sin banda vacía arriba de las
// pilas, y Sugerencias con el buzón vacío sin la columna de filtros (hueco).
// Capturas en e2e/.out/revision-ux-8/.
import fs from 'node:fs';
import path from 'node:path';
import { root } from '../lib/env.mjs';
import { assert, gotoView, openContext, sleep, until } from '../lib/browser.mjs';
import { setTheme, settle } from '../lib/ux-probe.mjs';

const outDir = path.join(root, 'e2e', '.out', 'revision-ux-8');
const WIDTHS = [360, 768, 1366, 1920];

/* ── Datos servidos (Sugerencias y Caja chica) ─────────────────────────── */

const LONG = 'Sería bueno que el sistema de préstamos permita reservar equipos con anticipación para una clase completa, indicando el aula, el horario y la cantidad de equipos, así el equipo TIC puede prepararlos antes y no se arma la fila en el recreo. También estaría bueno que avise si no alcanzan.';
const NOW = '2026-10-20T12:00:00.000Z';
const suggestion = (id, title, description, category, status = 'Proposed', votes = 0, comments = 0) => ({
  id, title, description, category, status, authorEmail: 'e2e@e2e.local', authorName: 'E2E Revisor', voteCount: votes, commentCount: comments,
  hasVoted: false, canEdit: true, canDelete: true, createdAt: NOW, updatedAt: NOW
});
const SUGGESTIONS = [
  suggestion(9001, 'Reservas anticipadas de carros de notebooks para las clases de los martes y jueves en el segundo piso', LONG, 'Préstamos', 'Proposed', 3, 2),
  suggestion(9002, 'Cargadores', 'Más cargadores en la sala TIC.', 'Equipamiento', 'Under Review', 1),
  suggestion(9003, 'Avisos por mail', 'Que llegue un mail cuando vence un préstamo.\nY otro cuando se devuelve.\nY uno más al final del día.', 'Notificaciones', 'Planned'),
  suggestion(9004, 'Modo oscuro en la pantalla del aula', 'Lo pide la gente de 1er año.', 'General', 'Proposed'),
  suggestion(9005, 'Etiquetas más grandes', 'Las de los Touch se borran con el uso.', 'Equipamiento', 'In Progress')
];
function suggestionsPayload(url, empty) {
  const params = new URL(url).searchParams;
  const status = params.get('status') || '';
  const category = params.get('category') || '';
  const all = empty ? [] : SUGGESTIONS;
  const items = all.filter(item => (!status || item.status === status) && (!category || item.category === category));
  const count = key => Object.fromEntries([['all', all.length], ...[...new Set(all.map(item => item[key]))].map(value => [value, all.filter(item => item[key] === value).length])]);
  return {
    ok: true, items, canManage: true,
    categories: [...new Set(all.map(item => item.category))],
    stats: { total: all.length, mostVoted: all.length ? { id: 9001, title: SUGGESTIONS[0].title, votes: 3 } : null, implemented: 0, pendingReview: all.filter(item => item.status === 'Proposed').length },
    counts: { status: count('status'), category: count('category') }
  };
}
const COMMENTS = [
  { id: 1, suggestionId: 9001, body: 'Totalmente de acuerdo, los martes es un caos.', authorEmail: 'a@e2e.local', authorName: 'Delfi', createdAt: NOW },
  { id: 2, suggestionId: 9001, body: 'Se podría usar la agenda TIC para esto, que ya tiene aulas y horarios cargados, y sumar la cantidad de equipos que hacen falta.', authorEmail: 'b@e2e.local', authorName: 'Equi', createdAt: NOW }
];

const day = n => `2026-10-${String(1 + (n % 19)).padStart(2, '0')}`;
const EXPENSES = Array.from({ length: 40 }, (_, i) => ({
  id: 8000 + i, expenseDate: day(i), description: i % 5 === 0 ? 'Cables HDMI de 3 metros para los proyectores de las aulas del segundo piso y adaptadores USB-C' : `Gasto de prueba ${i + 1}`,
  supplier: i % 3 ? 'Ferretería Central' : '', amount: 1000 + i * 350, category: i % 2 ? 'Insumos' : 'General', receiptUrl: '', inventoryItemId: null
}));
const request = (id, description, status, extra = {}) => ({
  id, description, category: 'General', estimatedAmount: 45000, requestedSupplier: 'Mercado Libre', justification: 'Los actuales tienen cable y se rompen seguido; los profes piden inalámbricos.',
  receiptUrl: '', status, requesterEmail: 'p@e2e.local', requesterName: 'Profe', finalCost: status === 'Aprobada' ? 44000 : 0, finalSupplier: status === 'Aprobada' ? 'Mercado Libre' : '',
  resolutionNote: '', resolvedBy: status === 'Pendiente' ? '' : 'admin', resolvedAt: status === 'Pendiente' ? '' : NOW, createdAt: NOW, ...extra
});
const PETTY = {
  ok: true, config: { initialAmount: 500000, requestsEnabled: true }, balance: 413500, spent: 86500, expenses: EXPENSES,
  requests: [
    request(7001, 'Mouse inalámbricos para la sala de profesores (10 unidades, con pilas)', 'Pendiente'),
    request(7002, 'Pilas AA', 'Pendiente', { justification: '' }),
    ...Array.from({ length: 10 }, (_, i) => request(7100 + i, `Compra resuelta ${i + 1}`, i % 2 ? 'Aprobada' : 'Rechazada'))
  ],
  permissions: { manager: true, canRequest: true }
};

/** Intercepta los GET de Sugerencias y Caja chica con los datos de arriba (el resto pasa). */
async function serveData(page, { emptySuggestions = false } = {}) {
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.isInterceptResolutionHandled?.()) return;
    const url = request.url();
    const { pathname } = new URL(url);
    const json = (body, delay = 0) => setTimeout(() => request.respond({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) }).catch(() => {}), delay);
    if (request.method() === 'GET' && pathname === '/api/suggestions') return json(suggestionsPayload(url, emptySuggestions), 120);
    if (request.method() === 'GET' && /^\/api\/suggestions\/\d+\/comments$/.test(pathname)) return json({ ok: true, items: COMMENTS }, 350);
    if (request.method() === 'GET' && pathname === '/api/petty-cash') return json(PETTY);
    request.continue().catch(() => {});
  });
}

/* ── Sondas en la página ──────────────────────────────────────────────── */

/** Espacio muerto arriba, recortados y vecinos de distinta altura dentro de `scope`. */
function rowProbe(scope) {
  const root = document.querySelector(scope);
  if (!root) return { error: `No está ${scope}` };
  const sc = document.querySelector('.shell-scroll');
  const visible = el => (el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : el.getClientRects().length > 0);
  const alpha = value => { const m = String(value).match(/rgba?\(([^)]+)\)/); if (!m) return 0; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return p.length > 3 ? p[3] : 1; };
  const name = el => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : ''} "${(el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28)}"`;
  const skip = el => Boolean(el.closest('[inert], .ui-collapse:not([data-state="open"]), [data-ux-ignore]'));

  // 1. Primer bloque con tinta (texto, fondo, borde o control) respecto del borde de arriba del área que scrollea.
  const top0 = sc.getBoundingClientRect().top - sc.scrollTop;
  let first = Infinity;
  const range = document.createRange();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim() || !node.parentElement || !visible(node.parentElement)) continue;
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) if (r.height > 1) first = Math.min(first, r.top);
    if (first - top0 < 200) break;
  }
  for (const el of root.querySelectorAll('*')) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    if (!(alpha(s.backgroundColor) > 0.05 || (parseFloat(s.borderTopWidth) >= 1 && alpha(s.borderTopColor) > 0.05) || el.matches('svg, img, button, input'))) continue;
    const r = el.getBoundingClientRect();
    if (r.height > 1 && r.width > 1) first = Math.min(first, r.top);
  }
  const topGap = Math.round(first - top0);

  // 2. Recortados por un ancestro con overflow (incluye el contorno de foco si lo tiene ahora).
  const clipped = [];
  for (const el of root.querySelectorAll('button, a, input, textarea, [role="radio"], [role="tab"], [tabindex], h1, h2, h3, h4, p, li, .an-card, .an-hc, .ui-seg, .pc-card, .sgx-row')) {
    if (!visible(el) || skip(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const as = getComputedStyle(a);
      if (as.overflowX === 'visible' && as.overflowY === 'visible') continue;
      if (a === sc) break;
      const ar = a.getBoundingClientRect();
      const left = ar.left + parseFloat(as.borderLeftWidth);
      const top = ar.top + parseFloat(as.borderTopWidth);
      const box = { left, top, right: left + a.clientWidth, bottom: top + a.clientHeight };
      const scrollY = /auto|scroll/.test(as.overflowY);
      const scrollX = /auto|scroll/.test(as.overflowX);
      // Lo que queda abajo/derecha de un scroll se alcanza scrolleando; arriba/izquierda del origen, no.
      const bad = [];
      if (!scrollX && (r.left < box.left - 0.5 || r.right > box.right + 0.5)) bad.push('x');
      if (!scrollY && (r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5)) bad.push('y');
      if (scrollY && r.top < top - a.scrollTop - 0.5) bad.push('antes del origen');
      // El texto con elipsis de su propia caja no es un recorte (lo mide la sonda de truncados).
      if (bad.length && !(a === el.parentElement && as.textOverflow === 'ellipsis') && !(el.matches('p, li, h1, h2, h3, h4') && as.webkitLineClamp && as.webkitLineClamp !== 'none')) {
        clipped.push(`${name(el)} recortado por ${name(a).split(' "')[0]} (${bad.join(', ')})`);
      }
      break;
    }
  }

  // 3. Vecinos en una fila con distinta altura: controles hermanos y tarjetas de una misma fila.
  const uneven = [];
  const CONTROLS = 'button.ui-btn, a.ui-btn, .ui-seg, [role="radiogroup"], .ui-field-box, kbd';
  for (const parent of [root, ...root.querySelectorAll('*')]) {
    if (!visible(parent) || skip(parent)) continue;
    const kids = [...parent.children].filter(kid => kid.matches(CONTROLS) && visible(kid)).map(kid => ({ kid, r: kid.getBoundingClientRect() })).filter(item => item.r.height > 8);
    for (let i = 0; i < kids.length; i += 1) for (let j = i + 1; j < kids.length; j += 1) {
      const a = kids[i].r; const b = kids[j].r;
      const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (overlap < Math.min(a.height, b.height) * 0.5 || Math.abs(a.height - b.height) <= 1) continue;
      uneven.push(`${name(kids[i].kid)} ${Math.round(a.height)} px junto a ${name(kids[j].kid)} ${Math.round(b.height)} px`);
    }
  }
  for (const grid of root.querySelectorAll('.an-grid')) {
    if (!visible(grid)) continue;
    const cards = [...grid.querySelectorAll(':scope > .an-cell > .an-card, :scope > .an-card, :scope > .an-stack')].filter(visible).map(card => ({ card, r: card.getBoundingClientRect() }));
    for (let i = 0; i < cards.length; i += 1) for (let j = i + 1; j < cards.length; j += 1) {
      const a = cards[i].r; const b = cards[j].r;
      if (Math.abs(a.top - b.top) > 2 || Math.abs(a.height - b.height) <= 1) continue;
      if (grid.classList.contains('is-loose')) continue; // despareja a propósito por el usuario (Top N, Tabla)
      uneven.push(`tarjetas de una fila: ${name(cards[i].card)} ${Math.round(a.height)} px y ${name(cards[j].card)} ${Math.round(b.height)} px`);
    }
  }
  // 4. Rótulos de los resúmenes (KPI) enteros: con lugar en la tarjeta, nunca "Implementad…".
  for (const label of root.querySelectorAll('.sgx-kl, .an-kpi-label, .pc-sum-label')) {
    if (visible(label) && label.scrollWidth > label.clientWidth + 1) uneven.push(`rótulo cortado: ${name(label)}`);
  }
  // 5. Botones de acción que bajan a varias filas (Caja chica en angosto): cada fila llena el ancho, sin escalones.
  for (const group of root.querySelectorAll('.pc-sum-acts')) {
    if (!visible(group)) continue;
    const box = group.getBoundingClientRect();
    const buttons = [...group.children].filter(visible).map(el => el.getBoundingClientRect());
    const rows = new Map();
    for (const r of buttons) rows.set(Math.round(r.top), [...(rows.get(Math.round(r.top)) || []), r]);
    if (rows.size < 2) continue;
    for (const row of rows.values()) {
      const left = Math.min(...row.map(r => r.left));
      const right = Math.max(...row.map(r => r.right));
      if (left - box.left > 2 || box.right - right > 2) uneven.push(`botones escalonados en ${name(group).split(' "')[0]}: una fila ocupa ${Math.round(right - left)} de ${Math.round(box.width)} px`);
    }
  }
  return { topGap, clipped: [...new Set(clipped)].slice(0, 8), uneven: [...new Set(uneven)].slice(0, 8) };
}

/**
 * Hace `act` y mide cuadro a cuadro el alto de `target` y la posición de
 * `trigger`. Devuelve el cambio total, el salto más grande en un cuadro, la
 * cantidad de cuadros intermedios y cuánto se movió el disparador.
 */
async function watchFrames(page, { target, trigger, ms = 700, click }, act) {
  // Lo que se va a tocar se lleva al centro ANTES de medir (si no, ese scroll contaría como movimiento).
  let handle = null;
  if (click) {
    handle = typeof click === 'string' ? await page.$(click) : click.asElement?.() || click;
    assert(handle, `no está ${click}`);
    await handle.evaluate(node => node.scrollIntoView({ block: 'center' }));
    await sleep(250);
  }
  await page.evaluate((targetSel, triggerSel) => {
    const rec = { h: [], y: [], t: [], stop: false };
    window.__ux8 = rec;
    const read = () => {
      const t = typeof targetSel === 'string' ? document.querySelector(targetSel) : null;
      const g = triggerSel ? document.querySelector(triggerSel) : null;
      rec.h.push(t ? t.getBoundingClientRect().height : 0); rec.t.push(Math.round(performance.now()));
      if (g?.isConnected) rec.y.push(g.getBoundingClientRect().top);
    };
    read();
    const loop = () => { if (rec.stop) return; read(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }, target, trigger || null);
  if (handle) {
    const box = await handle.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  } else await act();
  await sleep(ms);
  return page.evaluate(() => {
    const rec = window.__ux8;
    rec.stop = true;
    const h = rec.h;
    const change = Math.abs(h[h.length - 1] - h[0]);
    const steps = h.slice(1).map((value, i) => Math.abs(value - h[i]));
    const lo = Math.min(h[0], h[h.length - 1]);
    const hi = Math.max(h[0], h[h.length - 1]);
    const middle = new Set(h.filter(value => value > lo + 2 && value < hi - 2).map(Math.round)).size;
    const moved = rec.y.length ? Math.max(...rec.y.map(y => Math.abs(y - rec.y[0]))) : 0;
    return { change: Math.round(change), maxStep: Math.round(Math.max(0, ...steps)), middle, moved: Math.round(moved * 10) / 10, frames: h.length, seq: h.slice(0, 16).map((value, i) => `${Math.round(value)}@${rec.t[i] - rec.t[0]}`) };
  });
}

// Suave: el cambio se reparte en varios cuadros (la curva del sistema arranca rápido, ~30 % en el primero), nunca todo o casi todo en uno.
const smoothEnough = result => result.change < 24 || (result.maxStep <= result.change * 0.6 && result.middle >= 3);
const describe = result => `cambio ${result.change} px, salto máx. ${result.maxStep} px en un cuadro, ${result.middle} cuadros intermedios, disparador ${result.moved} px${smoothEnough(result) ? "" : ` [${result.seq.join(" ")}]`}`;

/** Click de mouse de verdad (registra el disparador para el ancla) en el centro de un elemento. */
async function clickAt(page, selectorOrHandle) {
  const handle = typeof selectorOrHandle === 'string' ? await page.$(selectorOrHandle) : selectorOrHandle;
  assert(handle, `no está ${selectorOrHandle}`);
  await handle.evaluate(node => node.scrollIntoView({ block: 'center' }));
  await sleep(150);
  const box = await handle.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function sweep(page, scope, label, problems, shots) {
  for (const width of WIDTHS) {
    await page.setViewport({ width, height: width < 768 ? 780 : 900 });
    await sleep(300);
    for (const theme of ['dark', 'light']) {
      await setTheme(page, theme);
      await page.evaluate(() => { document.querySelector('.shell-scroll').scrollTop = 0; });
      await sleep(80);
      const probe = await page.evaluate(rowProbe, scope);
      if (probe.error) { problems.push(`${label}: ${probe.error}`); return; }
      const where = `${label} ${width} ${theme}`;
      if (probe.topGap > 40) problems.push(`${where}: ${probe.topGap} px vacíos arriba del primer bloque`);
      probe.clipped.forEach(item => problems.push(`${where}: ${item}`));
      probe.uneven.forEach(item => problems.push(`${where}: ${item}`));
      if (shots && theme === 'dark' && (width === 360 || width === 1366)) await page.screenshot({ path: path.join(outDir, `${label}-${theme}-${width}.png`) });
    }
  }
  await page.setViewport({ width: 1366, height: 900 });
  await setTheme(page, 'dark');
}

export async function revisionUx8Tests({ browser, base, admin, releaseVersion, test, track = () => {} }) {
  fs.mkdirSync(outDir, { recursive: true });

  await test('ux8', 'Revisión UX 8', 'Analítica: sin espacio muerto arriba, nada recortado y vecinos de una fila con la misma altura (360–1920, oscuro y claro)', async () => {
    const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, reducedMotion: true, viewport: { width: 1366, height: 900 } });
    track(page);
    try {
      await page.setBypassServiceWorker(true);
      await gotoView(page, base, 'analytics');
      await page.waitForSelector('.an-heat, .an-ghost', { timeout: 20000 });
      await page.evaluate(() => document.querySelectorAll('.an-index-link')[4]?.click());
      await until(() => page.evaluate(() => !document.querySelector('.an-sec--pending')), { timeout: 15000, message: 'todas las secciones' });
      await page.evaluate(() => { const s = document.querySelector('.shell-scroll'); s.scrollTop = s.scrollHeight; });
      await sleep(700);
      await settle(page);
      const problems = [];
      await sweep(page, '.an-page', 'analitica', problems, true);
      // Diagrama de puntos: la mitad central va justo arriba de la pila más alta (sin banda vacía reservada).
      const dots = await page.evaluate(() => {
        const svg = document.querySelector('.an-dots svg');
        if (!svg) return null;
        const iqr = svg.querySelector('.an-dots-iqr').getBBox();
        const tops = [...svg.querySelectorAll('.an-dots-on, .an-dots-off')].map(node => node.getBBox()).filter(box => box.height > 0).map(box => box.y);
        return { gap: Math.round(Math.min(...tops) - (iqr.y + iqr.height)), height: svg.getBoundingClientRect().height };
      });
      if (dots && dots.gap > 24) problems.push(`diagrama de puntos: ${dots.gap} px vacíos entre la mitad central y la pila más alta (alto ${dots.height})`);
      assert(!problems.length, problems.slice(0, 6).join(' | '));
      return `ok${dots ? ` · puntos a ${dots.gap} px de la mitad central` : ''}`;
    } finally {
      await context.close();
    }
  });

  await test('ux8', 'Revisión UX 8', 'Analítica: Gráfico ↔ Tabla, Top N y período cambian de alto con transición, con el control quieto', async () => {
    const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width: 1366, height: 900 } });
    track(page);
    try {
      await page.setBypassServiceWorker(true);
      await gotoView(page, base, 'analytics');
      await page.waitForSelector('.an-heat, .an-ghost', { timeout: 20000 });
      await page.evaluate(() => document.querySelectorAll('.an-index-link')[4]?.click());
      await until(() => page.evaluate(() => !document.querySelector('.an-sec--pending')), { timeout: 15000, message: 'todas las secciones' });
      await sleep(1200);
      const problems = [];
      const details = [];
      // Gráfico → Tabla en la primera tarjeta que lo tenga (y vuelta).
      const marked = await page.evaluate(() => {
        const card = [...document.querySelectorAll('.an-card')].find(node => node.querySelector('[aria-label="Cómo ver los datos"]'));
        if (!card) return false;
        card.setAttribute('data-ux8-card', '');
        card.querySelector('[aria-label="Cómo ver los datos"]').setAttribute('data-ux8-seg', '');
        return true;
      });
      assert(marked, 'no hay tarjeta con Gráfico/Tabla');
      for (const label of ['Tabla', 'Gráfico']) {
        const radio = await page.evaluateHandle(text => [...document.querySelectorAll('[data-ux8-seg] [role="radio"]')].find(node => node.textContent.trim() === text), label);
        await radio.evaluate(node => node.scrollIntoView({ block: 'center' }));
        await sleep(200);
        const result = await watchFrames(page, { target: '[data-ux8-card]', trigger: '[data-ux8-seg]', click: radio });
        details.push(`${label}: ${describe(result)}`);
        if (!smoothEnough(result)) problems.push(`${label} cambia de golpe: ${describe(result)}`);
        if (result.moved > 2) problems.push(`${label}: el control se movió ${result.moved} px`);
      }
      // Top N (rankings): 10 → 25.
      const top = await page.evaluate(() => {
        const seg = document.querySelector('.an-card [aria-label="Cuántos mostrar"]');
        if (!seg) return false;
        seg.setAttribute('data-ux8-top', '');
        seg.closest('.an-card').setAttribute('data-ux8-topcard', '');
        return true;
      });
      if (top) {
        const radio = await page.evaluateHandle(() => [...document.querySelectorAll('[data-ux8-top] [role="radio"]')].find(node => node.textContent.trim() === '25'));
        const result = await watchFrames(page, { target: '[data-ux8-topcard]', trigger: '[data-ux8-top]', click: radio });
        details.push(`Top 25: ${describe(result)}`);
        if (!smoothEnough(result)) problems.push(`Top N cambia de golpe: ${describe(result)}`);
        if (result.moved > 2) problems.push(`Top N: el control se movió ${result.moved} px`);
      }
      // Período: cada sección pasa a su alto nuevo con transición (Semana suele dejar menos datos que Año).
      await page.evaluate(() => { document.querySelector('.shell-scroll').scrollTop = 0; });
      await sleep(200);
      await page.evaluate(() => document.querySelectorAll('.an-body > .an-anchor').forEach((node, index) => node.setAttribute('data-ux8-sec', String(index))));
      const week = await page.evaluateHandle(() => [...document.querySelectorAll('.an-period [role="radio"]')].find(node => node.textContent.trim() === 'Semana'));
      const result = await watchFrames(page, { target: '[data-ux8-sec="1"]', trigger: '.an-period', ms: 1800, click: week });
      details.push(`Período (Préstamos): ${describe(result)}`);
      if (!smoothEnough(result)) problems.push(`el período cambia la sección Préstamos de golpe: ${describe(result)}`);
      if (result.moved > 2) problems.push(`Período: el control se movió ${result.moved} px`);
      assert(!problems.length, `${problems.join(' | ')} · ${details.join(' · ')}`);
      return details.join(' · ');
    } finally {
      await context.close();
    }
  });

  await test('ux8', 'Revisión UX 8', 'Sugerencias: sin espacio muerto ni recortes, filtros/“Mostrar todo”/comentarios cambian de alto suave, buzón vacío sin columna de filtros', async () => {
    const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, reducedMotion: true, viewport: { width: 1366, height: 900 } });
    track(page);
    try {
      await page.setBypassServiceWorker(true);
      await serveData(page);
      await gotoView(page, base, 'suggestions');
      await page.waitForSelector('.sgx-row', { timeout: 20000 });
      await settle(page);
      const problems = [];
      await sweep(page, '.sgx', 'sugerencias', problems, true);
      // Con movimiento: filtro de estado (5 → 1 fila), "Mostrar todo", comentarios y categorías del formulario.
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
      const details = [];
      const filter = await page.evaluateHandle(() => [...document.querySelectorAll('.sgx-fi')].find(node => /En revisión/.test(node.textContent)));
      await filter.evaluate(node => node.setAttribute('data-ux8-filter', ''));
      let result = await watchFrames(page, { target: '.sgx-list', trigger: '[data-ux8-filter]', ms: 900, click: filter });
      details.push(`filtro: ${describe(result)}`);
      if (!smoothEnough(result)) problems.push(`el filtro cambia la lista de golpe: ${describe(result)}`);
      if (result.moved > 2) problems.push(`filtro: se movió ${result.moved} px`);
      const all = await page.evaluateHandle(() => [...document.querySelectorAll('.sgx-fi')].find(node => /Todos/.test(node.textContent)));
      await clickAt(page, all);
      await until(() => page.evaluate(() => document.querySelectorAll('.sgx-row').length === 5), { message: 'las 5 sugerencias' });
      await sleep(500);
      // "Mostrar todo" de la descripción larga.
      result = await watchFrames(page, { target: '#sgx-desc-9001', click: '#sgx-9001 .sgx-more' });
      details.push(`mostrar todo: ${describe(result)}`);
      if (!smoothEnough(result)) problems.push(`"Mostrar todo" despliega de golpe: ${describe(result)}`);
      // Comentarios: cargando → lista, sin saltos de alto en la fila.
      const comments = await page.evaluateHandle(() => [...document.querySelectorAll('#sgx-9001 .sgx-actions .ui-btn')].find(node => /Comentarios/.test(node.textContent)));
      result = await watchFrames(page, { target: '#sgx-9001', ms: 1200, click: comments });
      const steps = await page.evaluate(() => { const h = window.__ux8.h; return Math.max(0, ...h.slice(1).map((value, i) => Math.abs(value - h[i]))); });
      details.push(`comentarios: ${describe(result)}`);
      if (!smoothEnough(result)) problems.push(`al abrir comentarios la fila salta ${Math.round(steps)} px en un cuadro [${result.seq.join(" ")}]`);
      assert(await page.evaluate(() => document.querySelectorAll('#sgx-comments-9001 .sgx-comment').length === 2), 'no aparecieron los 2 comentarios');
      // Formulario: las categorías usadas se van y vuelven con alto suave al tipear.
      await clickAt(page, '.sgx-head .ui-btn');
      await page.waitForSelector('#sgx-new .sgx-catfield input', { timeout: 5000 });
      await sleep(400);
      const cat = await page.$('#sgx-new .sgx-catfield input');
      await cat.click({ clickCount: 3 });
      result = await watchFrames(page, { target: '#sgx-new .sgx-catfield' }, () => cat.type('zzz'));
      details.push(`categorías: ${describe(result)}`);
      if (!smoothEnough(result)) problems.push(`las categorías usadas desaparecen de golpe: ${describe(result)}`);
      assert(!problems.length, `${problems.slice(0, 6).join(' | ')} · ${details.join(' · ')}`);
      return details.join(' · ');
    } finally {
      await context.close();
    }
  });

  await test('ux8', 'Revisión UX 8', 'Sugerencias con el buzón vacío: vacío diseñado a todo el ancho, sin la columna de filtros al lado (hueco)', async () => {
    const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, reducedMotion: true, viewport: { width: 1366, height: 900 } });
    track(page);
    try {
      await page.setBypassServiceWorker(true);
      await serveData(page, { emptySuggestions: true });
      await gotoView(page, base, 'suggestions');
      await page.waitForSelector('.sgx-empty', { timeout: 20000 });
      await settle(page);
      const state = await page.evaluate(() => ({ side: Boolean(document.querySelector('.sgx-side')), list: Math.round(document.querySelector('.sgx-list').getBoundingClientRect().width), wrap: Math.round(document.querySelector('.sgx-wrap').getBoundingClientRect().width) }));
      assert(!state.side && state.list >= state.wrap - 1, `columna de filtros: ${state.side}, lista ${state.list} de ${state.wrap} px`);
      const problems = [];
      await sweep(page, '.sgx', 'sugerencias-vacio', problems, false);
      assert(!problems.length, problems.slice(0, 6).join(' | '));
      return 'ok';
    } finally {
      await context.close();
    }
  });

  await test('ux8', 'Revisión UX 8', 'Caja chica: sin espacio muerto ni recortes; “Ver más”, ordenar y la cantidad de Inventario TIC cambian de alto suave', async () => {
    const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, reducedMotion: true, viewport: { width: 1366, height: 900 } });
    track(page);
    try {
      await page.setBypassServiceWorker(true);
      await serveData(page);
      await gotoView(page, base, 'pettycash');
      await page.waitForSelector('.pc-sum-row', { timeout: 20000 });
      await settle(page);
      const problems = [];
      await sweep(page, '.pc-page', 'caja-chica', problems, true);
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
      const details = [];
      // "Ver más" de gastos: la tanda nueva entra con alto suave.
      const more = await page.evaluateHandle(() => [...document.querySelectorAll('.pc-more .ui-btn')].find(node => /Ver más/.test(node.textContent)));
      await more.evaluate(node => node.closest('.pc-section').setAttribute('data-ux8-exp', ''));
      let result = await watchFrames(page, { target: '[data-ux8-exp]', click: more });
      details.push(`ver más: ${describe(result)}`);
      if (!smoothEnough(result)) problems.push(`"Ver más" agrega los gastos de golpe: ${describe(result)}`);
      const rows = await page.evaluate(() => document.querySelectorAll('[data-ux8-exp] .ui-tbody .ui-tr').length);
      assert(rows === 40, `se ven ${rows} gastos de 40`);
      // Ordenar por importe: no se ve de golpe ningún cambio de alto (filas de 1 y 2 renglones).
      await page.evaluate(() => { document.querySelector('.shell-scroll').scrollTop = 0; });
      const header = await page.evaluateHandle(() => [...document.querySelectorAll('.pc-table .ui-th button, .pc-table [role="columnheader"] button')].find(node => /Importe/.test(node.textContent)));
      if (header?.asElement()) {
        await header.evaluate(node => node.setAttribute('data-ux8-sort', ''));
        result = await watchFrames(page, { target: '[data-ux8-exp]', trigger: '[data-ux8-sort]', click: header });
        details.push(`ordenar: ${describe(result)}`);
        if (!smoothEnough(result)) problems.push(`ordenar cambia el alto de golpe: ${describe(result)}`);
        if (result.moved > 2) problems.push(`ordenar: el encabezado se movió ${result.moved} px`);
      }
      // Resolver → "Registrar también en Inventario TIC": la cantidad aparece con alto suave.
      await clickAt(page, '[aria-controls="pc-approve-7001"]');
      await page.waitForSelector('#pc-approve-7001 .ui-switch', { timeout: 5000 });
      await sleep(500);
      result = await watchFrames(page, { target: '#pc-approve-7001 .pc-inv', click: '#pc-approve-7001 .ui-switch [role="switch"], #pc-approve-7001 .ui-switch' });
      details.push(`cantidad: ${describe(result)}`);
      if (!smoothEnough(result)) problems.push(`la cantidad aparece de golpe: ${describe(result)}`);
      assert(!problems.length, `${problems.slice(0, 6).join(' | ')} · ${details.join(' · ')}`);
      return details.join(' · ');
    } finally {
      await context.close();
    }
  });
}
