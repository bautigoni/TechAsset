// Inicio (l): layout sin huecos ni truncados en todos los casos de datos, y
// plegado con el encabezado anclado. Los datos de cada caso se sirven
// interceptando los GET de la API desde los datos reales de la copia (equipos,
// agenda, tareas, notas, movimientos): no se escribe nada en la base.
//
// Sondas (corren adentro de la página, ver `inicioProbe`):
//   - hueco vertical máximo entre bloques consecutivos de una misma columna
//     (y dentro de cada tarjeta, entre renglones de contenido): > 48 px falla;
//   - textos truncados (elipsis) con espacio libre en su renglón: falla.
// Capturas de cada caso/ancho/tema en e2e/.out/inicio-fix/.
import fs from 'node:fs';
import path from 'node:path';
import { root } from '../lib/env.mjs';
import { assert, gotoView, openContext, sleep, until } from '../lib/browser.mjs';
import { layoutProbe } from '../lib/layout-probe.mjs';

export const INICIO_WIDTHS = [360, 768, 1024, 1280, 1366, 1440, 1920];
const MAX_GAP = 48;
const outDir = path.join(root, 'e2e', '.out', 'inicio-fix');

const AR = 'America/Argentina/Buenos_Aires';
const todayAr = () => new Intl.DateTimeFormat('en-CA', { timeZone: AR, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const nowMinutesAr = () => {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: AR, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).split(':').map(Number);
  return h * 60 + m;
};
const hhmm = minutes => {
  const value = Math.max(0, Math.min(23 * 60 + 59, minutes));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
};

const PEOPLE = ['María Fernanda Rodríguez', 'Alex Pérez', 'Juan Ignacio Gómez Alonso', 'Lucía', 'Sofía Martínez', 'Tomás Benítez', 'Valentina Sosa Castro'];
const PLACES = ['Aula 12', 'Laboratorio de ciencias', 'Biblioteca', 'SUM', 'Aula 3 (planta alta)'];

/** Equipos del caso: los reales de la copia con N prestados (el resto libres). */
function devicesFor(real, loaned) {
  const items = real.map(device => ({ ...device }));
  let count = 0;
  for (const device of items) {
    const blocked = /fuera|repar|baja|perd|no encontr/i.test(String(device.estado || ''));
    if (blocked) continue;
    if (count < loaned) {
      const days = count % 5 === 4 ? 3 : count % 7 === 6 ? 1 : 0;
      Object.assign(device, {
        estado: 'Prestado',
        prestadoA: PEOPLE[count % PEOPLE.length],
        rol: count % 3 ? 'Docente' : 'Alumno',
        ubicacion: PLACES[count % PLACES.length],
        curso: count % 2 ? '5°B' : '',
        loanedAt: new Date(Date.now() - days * 86400000 - (count + 1) * 600000).toISOString()
      });
      count += 1;
    } else {
      Object.assign(device, { estado: 'Disponible', prestadoA: '', loanedAt: '' });
    }
  }
  return items;
}

function agendaFor(kind) {
  if (kind === 'none') return [];
  const today = todayAr();
  const now = nowMinutesAr();
  const base = { dia: '', fecha: today, turno: 'Mañana', tipoDispositivo: 'Touch', ubicacion: 'Aula 12', responsableTic: '', nota: '' };
  return [
    { ...base, id: 'e2e-ag-1', desde: hhmm(now - 20), hasta: hhmm(now + 40), curso: '5°B', actividad: 'Robótica con micro:bit y sensores de distancia', cantidad: 12, estado: 'Pendiente' },
    { ...base, id: 'e2e-ag-2', desde: hhmm(now + 60), hasta: hhmm(now + 120), curso: '3°A', actividad: 'Prueba de lectura comprensiva en plataforma Santillana', cantidad: 25, estado: 'Pendiente', tipoDispositivo: 'Notebook' },
    { ...base, id: 'e2e-ag-3', desde: hhmm(now + 130), hasta: hhmm(now + 170), curso: '6°C', actividad: 'Glifing', cantidad: 8, estado: 'Pendiente' },
    { ...base, id: 'e2e-ag-4', desde: hhmm(now + 180), hasta: hhmm(now + 220), curso: 'Primaria segundo ciclo — taller de programación', actividad: 'Scratch', cantidad: 0, estado: 'Pendiente', tipoDispositivo: '' }
  ];
}

function tasksFor(kind, operator) {
  if (kind === 'none') return [];
  const today = todayAr();
  const titles = [
    'Revisar los cargadores del carro de notebooks del segundo piso antes del acto',
    'Actualizar Windows en las PC del laboratorio',
    'Etiquetar los touch nuevos',
    'Configurar el proyector del SUM que quedó sin señal HDMI desde la mudanza de aulas',
    'Pedir presupuesto de mouses'
  ];
  return titles.map((titulo, index) => ({
    id: `e2e-task-${index}`, titulo, descripcion: '', responsable: index % 2 ? operator : 'Equi', responsables: index % 2 ? [operator] : ['Equi'],
    estado: index ? 'Pendiente' : 'En proceso', prioridad: index === 0 ? 'Urgente' : index % 2 ? 'Media' : 'Baja',
    fechaVencimiento: index === 1 ? '2026-01-10' : index === 0 ? today : '', done: false
  }));
}

function notesFor(kind, operator) {
  if (kind === 'none') return [];
  const today = todayAr();
  const texts = [
    'Quedó el carro 2 cargando en dirección.',
    'Ojo: el touch 34 tiene la pantalla rajada en la esquina, no prestarlo a primaria.',
    'Llamó la seño de 3°A, pide 25 notebooks para el jueves a primera hora.',
    'Listo',
    'Se cortó internet en el ala norte a las 10:15, volvió 10:40. Avisé a sistemas y quedó registrado el ticket con el proveedor para que revisen el switch.',
    'Mañana entro tarde.',
    'Faltan dos cargadores USB-C del carro 1; los busqué en el laboratorio y no estaban.',
    'Ok, gracias!',
    'Recordatorio: cierre del día con las observaciones del acto.',
    'Revisé la impresora de preceptoría: era el papel.',
    'El proyector del SUM vuelve el lunes.',
    'Último aviso del día.'
  ];
  const count = kind === 'many' ? texts.length : 3;
  return texts.slice(0, count).map((texto, index) => ({
    id: 90000 + index, texto, operador: index % 2 ? operator : 'Equi', categoria: '', importante: index === 1 || index === 4,
    archivada: false, visible: true, createdAt: new Date(Date.now() - (count - index) * 420000).toISOString(),
    updatedAt: new Date().toISOString(), localDate: today
  }));
}

function movementsFor(kind) {
  if (kind === 'none') return [];
  const kinds = [
    ['préstamo', 'Touch 34 (D1436) prestado a María Fernanda Rodríguez · 5°B · Aula 12'],
    ['devolución', 'Notebook 7 (D2210) devuelto por Alex Pérez'],
    ['dispositivo editado', 'Dispositivo editado: Plani 5 (D3301) cambió de ubicación a Laboratorio de ciencias y se actualizó su número de serie'],
    ['importación dispositivos', 'Importación de inventario: 12 creados, 3 actualizados, 1 reactivado'],
    ['dispositivo borrado', 'Touch 9 (D1411) enviado a la papelera'],
    ['préstamo', 'Lote de 8 equipos prestado a Juan Ignacio Gómez Alonso para Robótica'],
    ['devolución', 'Touch 2 (D1404) devuelto'],
    ['dispositivo agregado', 'Nuevo equipo: Notebook 31 (D2299)']
  ];
  return Array.from({ length: 20 }, (_, index) => {
    const [tipo, descripcion] = kinds[index % kinds.length];
    return { id: `e2e-mov-${index}`, tipo, descripcion, operador: index % 3 ? 'Bauti' : 'Equi', origen: 'Local', timestamp: new Date(Date.now() - index * 47 * 60000).toISOString() };
  });
}

/** Casos de datos (pedido del dueño): cada uno combina las variantes. */
const CASES = [
  { key: 'sin-prestamos', label: 'sin préstamos (captura del dueño)', loaned: 0, agenda: 'some', tasks: 'some', notes: 'some', moves: 'some' },
  { key: 'un-prestamo', label: 'con 1 préstamo', loaned: 1, agenda: 'some', tasks: 'some', notes: 'some', moves: 'some' },
  { key: 'muchos-prestamos', label: 'con 34 préstamos', loaned: 34, agenda: 'some', tasks: 'some', notes: 'some', moves: 'some' },
  { key: 'sin-agenda', label: 'sin agenda', loaned: 3, agenda: 'none', tasks: 'some', notes: 'some', moves: 'some' },
  { key: 'sin-tareas', label: 'sin tareas', loaned: 3, agenda: 'some', tasks: 'none', notes: 'some', moves: 'some' },
  { key: 'sin-notas', label: 'sin notas', loaned: 3, agenda: 'some', tasks: 'some', notes: 'none', moves: 'some' },
  { key: 'muchas-notas', label: 'muchas notas', loaned: 0, agenda: 'some', tasks: 'some', notes: 'many', moves: 'some' },
  { key: 'todo-vacio', label: 'todo vacío', loaned: 0, agenda: 'none', tasks: 'none', notes: 'none', moves: 'none' }
];

/** Sirve los GET del Inicio con los datos del caso; el resto va al server de prueba. */
async function serveCase(page, data) {
  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.isInterceptResolutionHandled?.()) return;
    const url = new URL(request.url());
    const json = body => request.respond({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
    if (request.method() === 'GET') {
      if (url.pathname === '/api/devices') return json({ ...data.devicesResponse, items: data.devices, loadedAt: new Date().toISOString() });
      if (url.pathname === '/api/movements') return json({ ok: true, items: data.movements });
      if (url.pathname === '/api/agenda') return json({ ok: true, items: data.agenda, loadedAt: new Date().toISOString() });
      if (url.pathname === '/api/tasks') return json({ ok: true, items: data.tasks, loadedAt: new Date().toISOString() });
      if (url.pathname === '/api/internal-notes') return json({ ok: true, items: data.notes });
    }
    return request.continue();
  });
}

async function waitInicio(page) {
  await page.waitForSelector('[data-dash="afuera"] .dash-rows', { timeout: 20000 });
  await page.waitForSelector('.dash-moves', { timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector('.dash-notes-body .ui-skel, .dash-notes-body [class*="skeleton"]'), { timeout: 8000 }).catch(() => {});
  await sleep(400);
}

/**
 * Sonda del Inicio (corre en la página). Devuelve el hueco máximo entre
 * bloques de una misma columna, el hueco interno máximo de cada tarjeta y los
 * textos cortados con elipsis que tenían lugar en su renglón.
 */
export function inicioProbe(maxGap) {
  const dash = document.querySelector('.dash');
  if (!dash) return { error: 'No está el Inicio' };
  const visible = element => (element.checkVisibility ? element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : element.getClientRects().length > 0);
  const describe = element => {
    const classes = typeof element.className === 'string' ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(name => `.${name}`).join('') : '';
    const label = (element.getAttribute('aria-label') || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return `${element.tagName.toLowerCase()}${classes}${label ? ` "${label}"` : ''}`;
  };

  // 1. Bloques: tarjetas y franjas del Inicio (los de más afuera).
  const BLOCKS = '.dash-top, .dash-bar-wrap, .dash-bar, .dash-keys, .dash-tiles, .dash-types, .dash-closure, .dash-card, .dash-now-tabs';
  const all = [...dash.querySelectorAll(BLOCKS)].filter(visible).filter(element => element.getBoundingClientRect().height > 2);
  const blocks = all.filter(element => !all.some(other => other !== element && other.contains(element)));
  const rects = blocks.map(element => ({ element, rect: element.getBoundingClientRect() }));
  // En las dos direcciones: el bloque más cercano ARRIBA de cada uno y el más
  // cercano DEBAJO (si no, una lista corta con un bloque a todo el ancho más
  // abajo no se ve: el "más cercano arriba" de ese bloque es la otra columna).
  const gaps = [];
  const overlapsX = (a, b) => Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left) > 8;
  for (const b of rects) {
    let above = null;
    let below = null;
    for (const a of rects) {
      if (a === b || !overlapsX(a, b)) continue;
      if (a.rect.bottom <= b.rect.top + 1 && (!above || a.rect.bottom > above.rect.bottom)) above = a;
      if (a.rect.top >= b.rect.bottom - 1 && (!below || a.rect.top < below.rect.top)) below = a;
    }
    if (above) gaps.push({ gap: Math.round(b.rect.top - above.rect.bottom), between: `${describe(above.element)} → ${describe(b.element)}` });
    if (below) gaps.push({ gap: Math.round(below.rect.top - b.rect.bottom), between: `${describe(b.element)} → ${describe(below.element)}` });
  }
  gaps.sort((x, y) => y.gap - x.gap);

  // 2. Huecos dentro de cada tarjeta: franjas de alto sin texto ni controles.
  const inner = [];
  const range = document.createRange();
  for (const card of dash.querySelectorAll('.dash-card')) {
    if (!visible(card)) continue;
    const box = card.getBoundingClientRect();
    if (box.height < 2) continue;
    const spans = [];
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim() || !node.parentElement || !visible(node.parentElement)) continue;
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) if (r.height > 1 && r.width > 1) spans.push([r.top, r.bottom]);
    }
    for (const control of card.querySelectorAll('button, input, textarea, svg, [role="checkbox"]')) {
      if (!visible(control)) continue;
      const r = control.getBoundingClientRect();
      if (r.height > 1 && r.width > 1) spans.push([r.top, r.bottom]);
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

  // 3. Truncados con espacio: elipsis cortando y lugar libre en el mismo renglón.
  const ROW = 'li, .dash-row-line, .dash-card-head, .dash-list-head, .dash-tile, .dash-type, .dash-task, .dash-agenda-top, .dash-found-main, .dash-pick-item, .dash-qchip, .dash-note-meta, .dash-empty, .dash-list-foot, .dash-top, .ui-seg';
  const truncated = [];
  const cut = [];
  for (const element of dash.querySelectorAll('*')) {
    if (!visible(element)) continue;
    const style = getComputedStyle(element);
    const clamp = style.webkitLineClamp && style.webkitLineClamp !== 'none';
    if (style.textOverflow !== 'ellipsis' && !clamp) continue;
    const need = clamp ? 0 : element.scrollWidth - element.clientWidth;
    const clampCut = clamp && element.scrollHeight > element.clientHeight + 1;
    if (need <= 1 && !clampCut) continue;
    cut.push(describe(element));
    if (clampCut) continue; // en 2 renglones con tooltip: es el último recurso, no se cuenta
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

  return {
    maxGap: gaps[0]?.gap ?? 0,
    worstGap: gaps[0] || null,
    bigGaps: gaps.filter(item => item.gap > maxGap).slice(0, 6),
    maxInner: inner[0]?.gap ?? 0,
    worstInner: inner[0] || null,
    bigInner: inner.filter(item => item.gap > maxGap).slice(0, 6),
    truncated: truncated.slice(0, 10),
    cut: cut.slice(0, 12),
    scrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth || dash.scrollWidth > dash.clientWidth + 1
  };
}

export async function inicioTests({ browser, base, api, admin, releaseVersion, test, track = () => {} }) {
  const devicesResponse = (await api.get('/api/devices')).data;
  const realDevices = devicesResponse.items || [];
  const session = (await api.get('/api/auth/session')).data;
  const operator = session?.user?.nombre || session?.user?.name || 'Bauti';
  // Las capturas se renuevan solo si corre alguna prueba de este grupo (no con --only de otra cosa).
  let outReady = false;
  const prepareOut = () => {
    if (outReady) return;
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    outReady = true;
  };

  const dataFor = item => ({
    devicesResponse,
    devices: devicesFor(realDevices, item.loaned),
    agenda: agendaFor(item.agenda),
    tasks: tasksFor(item.tasks, operator),
    notes: notesFor(item.notes, operator),
    movements: movementsFor(item.moves)
  });

  const report = {};
  for (const item of CASES) {
    await test('l', 'Inicio', `Sin huecos ni truncados: ${item.label} (${INICIO_WIDTHS.join('/')} px, oscuro y claro)`, async () => {
      const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, reducedMotion: true, viewport: { width: 1440, height: 900 } });
      track(page);
      prepareOut();
      const problems = [];
      const summary = [];
      try {
        await serveCase(page, dataFor(item));
        await gotoView(page, base, 'dashboard');
        await waitInicio(page);
        for (const theme of ['dark', 'light']) {
          await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
          for (const width of INICIO_WIDTHS) {
            await page.setViewport({ width, height: 900 });
            await sleep(250);
            // Alto de la ventana = todo el Inicio, para que la captura lo muestre entero.
            const full = await page.evaluate(() => {
              const scroller = document.querySelector('.shell-scroll');
              const dash = document.querySelector('.dash');
              if (!scroller || !dash) return 900;
              return Math.ceil(scroller.getBoundingClientRect().top + dash.getBoundingClientRect().height + (window.innerHeight - scroller.getBoundingClientRect().bottom) + 4);
            });
            await page.setViewport({ width, height: Math.min(Math.max(full, 600), 7000) });
            await sleep(250);
            const probe = await page.evaluate(inicioProbe, MAX_GAP);
            const layout = await page.evaluate(layoutProbe, 5);
            (report[item.key] ||= {})[`${theme}-${width}`] = { ...probe, layout: layout.counts, overlaps: layout.overlaps, wrappedButtons: layout.wrappedButtons };
            await page.screenshot({ path: path.join(outDir, `${item.key}-${theme}-${width}.png`) });
            if (theme === 'dark') summary.push(`${width}: ${probe.maxGap}/${probe.maxInner}`);
            const where = `${theme} ${width}`;
            if (probe.bigGaps.length) problems.push(`${where}: hueco ${probe.bigGaps.map(gap => `${gap.gap} px (${gap.between})`).join('; ')}`);
            if (probe.bigInner.length) problems.push(`${where}: hueco dentro de ${probe.bigInner.map(gap => `${gap.card} ${gap.gap} px ${gap.at}`).join('; ')}`);
            if (probe.truncated.length) problems.push(`${where}: truncado con espacio ${probe.truncated.map(cutItem => `${cutItem.element} (faltan ${cutItem.need}, libres ${cutItem.free})`).join('; ')}`);
            if (probe.scrollX || layout.counts.horizontalScroll) problems.push(`${where}: scroll horizontal`);
            if (layout.counts.overlaps) problems.push(`${where}: solapamientos ${layout.overlaps.join('; ')}`);
            if (layout.counts.wrappedButtons) problems.push(`${where}: botones partidos ${layout.wrappedButtons.join('; ')}`);
          }
        }
      } finally {
        await context.close();
      }
      if (problems.length) throw new Error(problems.slice(0, 8).join(' | '));
      return `hueco entre bloques / dentro de tarjetas (oscuro): ${summary.join('  ')}`;
    });
  }

  // Interacción: estado vacío con la acción siguiente y sin pie de atajos.
  await test('l', 'Inicio', 'Vacío: frase + "Prestar un equipo" enfoca la barra, "Ver disponibles" cambia la lista; sin pie de atajos sin filas', async () => {
    const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width: 1440, height: 900 } });
    track(page);
    try {
      await serveCase(page, dataFor(CASES[0]));
      await gotoView(page, base, 'dashboard');
      await waitInicio(page);
      const state = await page.evaluate(() => {
        const list = document.querySelector('[data-dash="afuera"]');
        return {
          empty: list?.querySelector('.dash-empty .dash-empty-title')?.textContent || '',
          foot: Boolean(list?.querySelector('.dash-list-foot')),
          cols: Boolean(list?.querySelector('.dash-cols')),
          height: Math.round(list?.getBoundingClientRect().height || 0)
        };
      });
      assert(/Todo en casa/.test(state.empty), `El vacío no muestra la frase: "${state.empty}".`);
      assert(!state.foot && !state.cols, `Sin filas quedó el pie (${state.foot}) o los títulos de columna (${state.cols}).`);
      assert(state.height < 200, `La tarjeta vacía mide ${state.height} px (tiene que ser compacta).`);
      const lend = await until(() => page.evaluateHandle(() => [...document.querySelectorAll('[data-dash="afuera"] .dash-empty button')].find(button => /Prestar un equipo/.test(button.textContent || ''))).then(handle => handle.asElement()), { message: 'el botón Prestar un equipo' });
      await lend.click();
      await until(() => page.evaluate(() => document.activeElement?.matches('input[data-dash-bar]')), { message: 'el foco en la barra de acción' });
      const show = await page.evaluateHandle(() => [...document.querySelectorAll('[data-dash="afuera"] .dash-empty button')].find(button => /Ver disponibles/.test(button.textContent || '')));
      await show.asElement().click();
      await page.waitForFunction(() => document.querySelectorAll('[data-dash="afuera"] .dash-rows > li').length > 0 && document.querySelector('[data-dash="afuera"] .dash-list-foot'), { timeout: 5000 });
      return 'vacío compacto; Prestar un equipo → foco en la barra; Ver disponibles → filas con pie';
    } finally {
      await context.close();
    }
  });

  // Interacción: plegar con el encabezado anclado (al final de la página, que es donde el navegador recortaría el scroll).
  for (const width of [1440, 360]) {
    await test('l', 'Inicio', `Plegar "Últimos movimientos" y abrir/cerrar fichas deja quieto el encabezado tocado (${width} px)`, async () => {
      const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width, height: width < 768 ? 800 : 900 } });
      track(page);
      try {
        await serveCase(page, dataFor(CASES[2]));
        await gotoView(page, base, 'dashboard');
        await waitInicio(page);
        const topOf = selector => page.evaluate(sel => document.querySelector(sel)?.getBoundingClientRect().top ?? null, selector);
        // Lo más abajo posible con el encabezado a la vista (si la lista es más
        // alta que la ventana, el encabezado queda arriba y plegar acorta la
        // página por debajo del final: es el caso en que el navegador recorta el scroll).
        const head = '[data-dash="movimientos"] .dash-card-head';
        await page.evaluate(sel => {
          const box = document.querySelector('.shell-scroll');
          box.scrollTop = box.scrollHeight;
          const top = document.querySelector(sel).getBoundingClientRect().top;
          const boxTop = box.getBoundingClientRect().top;
          if (top < boxTop + 60) box.scrollTop -= boxTop + 80 - top;
        }, head);
        await sleep(200);
        const before = await topOf(head);
        await page.click('[data-dash="movimientos"] .dash-disclose');
        const samples = [];
        for (let i = 0; i < 8; i += 1) { await sleep(40); samples.push(await topOf(head)); }
        await sleep(300);
        const closed = await topOf(head);
        const drift = Math.max(...[...samples, closed].map(value => Math.abs(value - before)));
        assert(!(await page.$('#mov-lista')), 'La lista no se plegó.');
        assert(drift <= 2, `El encabezado se movió ${drift.toFixed(1)} px al plegar (antes ${before}, después ${closed}).`);
        await page.click('[data-dash="movimientos"] .dash-disclose');
        await sleep(450);
        const reopened = await topOf(head);
        assert(await page.$('#mov-lista'), 'La lista no se desplegó.');
        assert(Math.abs(reopened - before) <= 2, `El encabezado se movió ${Math.abs(reopened - before).toFixed(1)} px al desplegar.`);

        // Fichas: abrir la 1, después la 4 (se cierra la 1 arriba): la 4 queda quieta.
        await page.evaluate(() => { const box = document.querySelector('.shell-scroll'); const list = document.querySelector('[data-dash="afuera"]'); box.scrollTop += list.getBoundingClientRect().top - 80; });
        await sleep(150);
        await page.click('[data-dash="afuera"] .dash-rows > li:nth-child(1) .dash-row-hit');
        await sleep(400);
        const row4 = '[data-dash="afuera"] .dash-rows > li:nth-child(4) .dash-row-line';
        // La fila 4 a la vista (si no, el click de puppeteer la trae y eso no es la app).
        await page.evaluate(sel => {
          const box = document.querySelector('.shell-scroll');
          const rect = box.getBoundingClientRect();
          box.scrollTop += document.querySelector(sel).getBoundingClientRect().top - (rect.top + rect.height * 0.5);
        }, row4);
        await sleep(150);
        const row4Before = await topOf(row4);
        await page.click(`${row4} .dash-row-hit`);
        const rowSamples = [];
        for (let i = 0; i < 8; i += 1) { await sleep(40); rowSamples.push(await topOf(row4)); }
        await sleep(300);
        const rowDrift = Math.max(...[...rowSamples, await topOf(row4)].map(value => Math.abs(value - row4Before)));
        const open = await page.evaluate(() => [...document.querySelectorAll('[data-dash="afuera"] .dash-ficha')].length);
        assert(open === 1, `Quedaron ${open} fichas abiertas.`);
        assert(rowDrift <= 2, `La fila tocada se movió ${rowDrift.toFixed(1)} px mientras se cerraba la de arriba.`);
        return `encabezado: ${drift.toFixed(1)} px al plegar, ${Math.abs(reopened - before).toFixed(1)} px al desplegar; fila: ${rowDrift.toFixed(1)} px`;
      } finally {
        await context.close();
      }
    });
  }
  return report;
}
