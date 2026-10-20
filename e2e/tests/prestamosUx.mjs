// pux) Revisión UX de Préstamos (revisor 3, 20/10): lo que el dueño marcó y
// lo que encontró la revisión, para que no vuelva.
//
//   1. Sin franja muerta arriba: el primer bloque arranca a la distancia del
//      padding de la página (en dos columnas, el formulario; la fecha y
//      "Cierre del día" encabezan la columna lateral) — 360 a 1920 px.
//   2. Nada recortado: chips, botones y campos (con su foco y el aro de
//      "Marcado") quedan adentro de todo ancestro que recorta.
//   3. Nada se abre de golpe: resultado del código, lista del escaneo continuo
//      (agregar y quitar), sugerencias de personas, "Actualmente prestados" al
//      devolver; medido cuadro a cuadro.
//   4. Cartelitos en pop up (excepción del dueño): diálogo accesible, foco
//      atrapado y devuelto al cartelito, Esc/fondo cierran (con lo escrito,
//      pregunta antes), Enter entrega, Ctrl/Meta/Shift+clic sigue marcando y
//      "Entregar N" usa el mismo diálogo. Mobile: ancho completo con márgenes.
//   5. Leyenda sobria ("Marcado" sin bloque blanco), "Cámara" responde en el acto,
//      el encabezado de un grupo no cambia en modo selección.
// Corre contra la copia de la base. Capturas en e2e/.out/revision-ux-3/.
import fs from 'node:fs';
import path from 'node:path';
import { root } from '../lib/env.mjs';
import { assert, gotoView, openContext, sleep, until } from '../lib/browser.mjs';
import { checkCollapsibles, formatProbe, probeView, setTheme, settle } from '../lib/ux-probe.mjs';

const WIDTHS = [360, 390, 768, 1024, 1280, 1366, 1440, 1600, 1920];
const outDir = path.join(root, 'e2e', '.out', 'revision-ux-3');
const PASSES = '[data-loans-grid="passes"]';
const DEVICES = '[data-loans-grid="devices"]';
const free = estado => /^(|disponible|devuelto)$/i.test(String(estado || '').trim());

async function openLoans(page, base) {
  await gotoView(page, base, 'loans');
  await page.waitForSelector(DEVICES, { timeout: 20000 });
  await settle(page);
}

async function viewportFor(page, width, height = 900) {
  const mobile = width < 768;
  await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
}

/** Distancia del borde de arriba del área que scrollea al primer bloque de Préstamos. */
function topGap() {
  const scroller = document.querySelector('.shell-scroll');
  const page = document.querySelector('.lo-page');
  const top = scroller.getBoundingClientRect().top;
  const pad = parseFloat(getComputedStyle(page).paddingTop);
  const visible = el => el.getClientRects().length > 0 && el.getBoundingClientRect().height > 2;
  const blocks = [...page.querySelectorAll('.lo-card, .lo-toolbar')].filter(visible).filter(el => !el.closest('.ui-collapse:not([data-state="open"])'));
  const first = Math.min(...blocks.map(el => el.getBoundingClientRect().top));
  const form = document.querySelector('.lo-form').getBoundingClientRect().top;
  const twoCols = getComputedStyle(document.querySelector('.lo-side')).display !== 'contents';
  const toolbar = document.querySelector('.lo-toolbar').getBoundingClientRect();
  return { pad, first: Math.round(first - top), form: Math.round(form - top), twoCols, toolbarTop: Math.round(toolbar.top - top), toolbarH: Math.round(toolbar.height) };
}

/** Controles cuya caja + 4 px (foco, aro de marcado) se sale de un ancestro que recorta. */
function clippedControls(scopeSel) {
  const scope = document.querySelector(scopeSel);
  const scroller = document.querySelector('.shell-scroll');
  const out = [];
  const visible = el => el.getClientRects().length > 0 && !el.closest('.ui-collapse:not([data-state="open"])');
  for (const el of scope.querySelectorAll('button, input, textarea, .lo-chip, [role="switch"]')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const ext = 4;
    for (let a = el.parentElement; a && a !== document.body && a !== scroller; a = a.parentElement) {
      const st = getComputedStyle(a);
      if (st.overflowX === 'visible' && st.overflowY === 'visible') continue;
      const ar = a.getBoundingClientRect();
      const left = ar.left + a.clientLeft; const top = ar.top + a.clientTop;
      const right = left + a.clientWidth; const bottom = top + a.clientHeight;
      if (!(r.bottom > top && r.top < bottom && r.right > left && r.left < right)) continue;
      const over = [left - (r.left - ext), top - (r.top - ext), (r.right + ext) - right, (r.bottom + ext) - bottom];
      // El texto de un control que recorta su propio contenido (lo-link) no cuenta: se mide el control.
      if (over.some(v => v > 0.5)) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}" en .${String(a.className).split(' ')[0]}`);
    }
  }
  return [...new Set(out)];
}

/** Muestrea el alto de `selector` cuadro a cuadro mientras corre `action`. */
async function heightsDuring(page, selector, action, ms = 700) {
  await page.evaluate(sel => {
    const out = { heights: [], stop: false };
    window.__puxH = out;
    const tick = () => {
      if (out.stop) return;
      const el = document.querySelector(sel);
      out.heights.push(el ? el.getBoundingClientRect().height : 0);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, selector);
  await action();
  await sleep(ms);
  return page.evaluate(() => { window.__puxH.stop = true; return window.__puxH.heights.map(h => Math.round(h)); });
}

/** Cambió de alto pasando por valores intermedios (ningún cuadro se lleva casi todo el cambio). */
function smooth(heights, label) {
  const first = heights[0];
  const last = heights[heights.length - 1];
  const total = Math.abs(last - first);
  let maxStep = 0;
  for (let i = 1; i < heights.length; i += 1) maxStep = Math.max(maxStep, Math.abs(heights[i] - heights[i - 1]));
  assert(total >= 12, `${label}: no cambió de alto (${first} → ${last}).`);
  assert(maxStep <= Math.max(16, total * 0.7), `${label}: saltó de golpe (${first} → ${last}, ${Math.round(maxStep)} px en un cuadro). Cuadros: ${heights.join(',')}`);
  return `${label} ${first}→${last} (máx ${maxStep}/cuadro)`;
}

export async function prestamosUxTests({ browser, base, api, admin, releaseVersion, test, track = () => {} }) {
  fs.mkdirSync(outDir, { recursive: true });
  const { context, page, consoleErrors } = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width: 1440, height: 900 } });
  track(page);
  try {
    // ── 1. Sin franja muerta arriba ────────────────────────────────────────
    await test('pux', 'Préstamos UX', `Sin franja vacía entre la barra superior y el primer bloque (${WIDTHS.join('/')} px)`, async () => {
      const notes = [];
      for (const width of WIDTHS) {
        await viewportFor(page, width);
        await openLoans(page, base);
        const m = await page.evaluate(topGap);
        assert(m.first <= m.pad + 1, `${width}: el primer bloque arranca a ${m.first} px (padding ${m.pad}).`);
        if (m.twoCols) {
          assert(m.form <= m.pad + 1, `${width}: en dos columnas el formulario arranca a ${m.form} px: hay una franja arriba.`);
          assert(Math.abs(m.toolbarTop - m.form) <= 1, `${width}: la fecha/"Cierre del día" no encabezan la columna lateral (${m.toolbarTop} vs ${m.form}).`);
        } else {
          // En una columna van primero y son un renglón de controles (no un hueco).
          assert(m.toolbarTop <= m.pad + 1 && m.toolbarH <= 48, `${width}: la fila de fecha mide ${m.toolbarH} px a ${m.toolbarTop} px.`);
        }
        notes.push(`${width}:${m.twoCols ? m.form : m.toolbarTop}`);
      }
      await viewportFor(page, 1440);
      return notes.join(' ');
    });

    // ── 2. Nada recortado (foco y aro de "Marcado") ─────────────────────────
    await test('pux', 'Préstamos UX', 'Chips, botones y campos (con foco y marcados) sin recortes de 360 a 1920 px', async () => {
      const notes = [];
      for (const width of [360, 768, 1024, 1440, 1920]) {
        await viewportFor(page, width);
        await openLoans(page, base);
        await page.$$eval(`${DEVICES} .lo-group-toggle[aria-expanded="false"]`, list => list.slice(0, 2).forEach(b => b.click()));
        await sleep(450);
        const chips = await page.$$(`${DEVICES} .lo-chip[data-device-tag]:not([disabled])`);
        assert(chips.length >= 2, `${width}: no hay chips.`);
        await page.keyboard.down('Control'); await chips[0].click(); await chips[1].click(); await page.keyboard.up('Control');
        await chips[1].focus();
        await sleep(300);
        const clipped = await page.evaluate(clippedControls, '.lo-page');
        assert(!clipped.length, `${width}: recortados: ${clipped.slice(0, 5).join(' · ')}`);
        if (width === 1440) await page.screenshot({ path: path.join(outDir, 'seleccion-1440.png') });
        notes.push(`${width}:0`);
      }
      await viewportFor(page, 1440);
      return notes.join(' ');
    });

    // ── 5a. Leyenda sobria ──────────────────────────────────────────────────
    await test('pux', 'Préstamos UX', 'Leyenda: "Marcado" sin bloque blanco (igual al chip marcado de la grilla), oscuro y claro', async () => {
      await openLoans(page, base);
      const out = [];
      for (const theme of ['dark', 'light']) {
        await setTheme(page, theme);
        await sleep(100);
        const m = await page.evaluate(sel => {
          const sample = document.querySelector(`${sel} .lo-chip--sample.is-selected`);
          const freeSample = document.querySelector(`${sel} .lo-chip--sample.is-free`);
          const surface = getComputedStyle(document.querySelector(`${sel}`)).backgroundColor;
          return { sel: getComputedStyle(sample).backgroundColor, free: getComputedStyle(freeSample).backgroundColor, surface };
        }, DEVICES);
        assert(m.sel === m.free, `${theme}: la muestra "Marcado" tiene fondo ${m.sel} (libre: ${m.free}).`);
        out.push(`${theme}: ${m.sel}`);
      }
      await setTheme(page, 'dark');
      return out.join(' · ');
    });

    // ── 3. Nada se abre de golpe ────────────────────────────────────────────
    await test('pux', 'Préstamos UX', 'Resultado del código, escaneo continuo (agregar/quitar) y sugerencias de personas se pliegan suave', async () => {
      await viewportFor(page, 1440);
      await openLoans(page, base);
      const list = (await api.devices()).filter(device => free(device.estado));
      assert(list.length >= 3, 'Faltan equipos libres en la copia.');
      const notes = [];
      // Código libre → equipo + datos del préstamo; Esc → se pliega.
      let h = await heightsDuring(page, '.lo-form', async () => {
        await page.click('input[data-loan-code]');
        await page.evaluate(tag => {
          const input = document.querySelector('input[data-loan-code]');
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(input, tag);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }, list[0].etiqueta);
      });
      notes.push(smooth(h, 'código'));
      // Sugerencias de personas (nombres de préstamos anteriores).
      const people = (await api.get('/api/loans/suggest?q=a')).data?.suggestions || [];
      const name = people[0]?.persona || '';
      if (name.length >= 2) {
        h = await heightsDuring(page, '.lo-suggest-list', async () => {
          await page.click('#lo-persona');
          await page.type('#lo-persona', name.slice(0, 2));
        });
        notes.push(smooth(h.map(v => v), 'sugerencias'));
        await page.keyboard.press('Escape');
      }
      h = await heightsDuring(page, '.lo-form', async () => {
        await page.click('input[data-loan-code]');
        await page.keyboard.press('Escape');
      });
      notes.push(smooth(h, 'Esc'));
      // Escaneo continuo: cada equipo entra plegándose y "Quitar" lo saca igual.
      await page.$$eval('.lo-form [role="switch"]', l => l[0].click());
      await sleep(500);
      await page.type('input[data-loan-code]', list[1].etiqueta);
      await page.keyboard.press('Enter');
      await sleep(500);
      h = await heightsDuring(page, '.lo-queue-list', async () => {
        await page.type('input[data-loan-code]', list[2].etiqueta);
        await page.keyboard.press('Enter');
      });
      notes.push(smooth(h, 'agregar a la lista'));
      h = await heightsDuring(page, '.lo-queue-list', async () => {
        await page.click(`[data-queue-tag="${list[2].etiqueta}"] button`);
      });
      notes.push(smooth(h, 'quitar'));
      assert(!(await page.$(`[data-queue-tag="${list[2].etiqueta}"]`)), 'Quitar no sacó el equipo de la lista.');
      // Salir del continuo (vaciando) para no dejar estado.
      await page.$$eval('.lo-form [role="switch"]', l => l[0].click());
      await sleep(300);
      const vaciar = await page.evaluateHandle(() => [...document.querySelectorAll('.lo-ask button')].find(b => /Vaciar/.test(b.textContent || '')));
      if (vaciar.asElement()) await vaciar.asElement().click();
      return notes.join(' · ');
    });

    await test('pux', 'Préstamos UX', '"Actualmente prestados": devolver saca la fila plegándose (sin salto) y queda libre en la base', async () => {
      await viewportFor(page, 1440);
      const list = (await api.devices()).filter(device => free(device.estado));
      const tag = list[list.length - 2]?.etiqueta;
      assert(tag, 'Sin equipo libre.');
      const lent = await api.post('/api/loans/lend', { etiqueta: tag, person: 'E2E Revisión UX', role: 'DOE', location: 'DOE' });
      assert(lent.status < 300, `No se pudo prestar ${tag} por API (${lent.status}).`);
      await openLoans(page, base);
      // Si quedó más allá de los 8 visibles, se piden todos.
      const all = await page.evaluateHandle(() => [...document.querySelectorAll('.lo-loaned .lo-more')].find(b => /Ver todos/.test(b.textContent || '')));
      if (all.asElement()) { await all.asElement().click(); await sleep(400); }
      await page.waitForSelector(`[data-loaned-tag="${tag}"]`);
      const h = await heightsDuring(page, '.lo-loaned-list', async () => {
        await page.click(`[data-loaned-tag="${tag}"] button[aria-label^="Devolver"]`);
      }, 900);
      const note = smooth(h, 'devolver');
      const device = await until(async () => { const x = await api.device(tag); return x && free(x.estado) && x; }, { message: 'la devolución' });
      return `${note} · ${device.etiqueta} libre`;
    });

    // ── 5b. "Cámara" responde en el acto; encabezado de grupo quieto en selección ──
    await test('pux', 'Préstamos UX', '"Cámara" abre su panel en el acto (esperando permiso) y se cierra', async () => {
      await viewportFor(page, 1440);
      await openLoans(page, base);
      const camera = await page.$('button[aria-controls="lo-camera"]');
      await camera.click();
      await sleep(60);
      const expanded = await camera.evaluate(b => b.getAttribute('aria-expanded'));
      assert(expanded === 'true', 'Tocar "Cámara" no dio ninguna respuesta mientras el navegador decide el permiso.');
      const text = await page.$eval('#lo-camera', el => el.textContent || '');
      assert(/cámara/i.test(text), `El panel no dice qué pasa: "${text}"`);
      await sleep(300);
      await camera.click();
      await sleep(400);
      assert(await camera.evaluate(b => b.getAttribute('aria-expanded')) === 'false', '"Cerrar cámara" no cerró el panel.');
      return text.slice(0, 60);
    });

    await test('pux', 'Préstamos UX', 'Modo selección: el encabezado del grupo no cambia de alto y abrir/cerrar no lo mueve (390 y 1440)', async () => {
      const notes = [];
      for (const width of [390, 1440]) {
        await viewportFor(page, width, 844);
        await openLoans(page, base);
        const toggle = await page.$(`${DEVICES} .lo-group-toggle`);
        if (await toggle.evaluate(b => b.getAttribute('aria-expanded') === 'false')) { await toggle.click(); await sleep(450); }
        const before = await toggle.evaluate(b => Math.round(b.getBoundingClientRect().height));
        const chip = await page.$(`${DEVICES} .lo-chip[data-device-tag]:not([disabled])`);
        await page.keyboard.down('Control'); await chip.click(); await page.keyboard.up('Control');
        await sleep(400);
        const after = await toggle.evaluate(b => Math.round(b.getBoundingClientRect().height));
        assert(Math.abs(after - before) <= 1, `${width}: el encabezado pasó de ${before} a ${after} px al entrar en selección.`);
        const toggles = await checkCollapsibles(page, { scope: DEVICES, max: 3 });
        assert(!toggles.problems.length, `${width}: ${formatProbe({ counts: {}, total: 0 }, toggles)}`);
        notes.push(`${width}: ${before} px`);
      }
      await viewportFor(page, 1440);
      return notes.join(' · ');
    });

    // ── 4. Cartelitos en pop up ─────────────────────────────────────────────
    const passStates = async () => Object.fromEntries(((await api.get('/api/photo-passes')).data.items || []).map(pass => [String(pass.numero), pass]));
    const openPasses = async () => {
      await openLoans(page, base);
      const toggle = await page.waitForSelector(`${PASS_STACK_TOGGLE}`);
      if (await toggle.evaluate(b => b.getAttribute('aria-expanded') === 'false')) { await toggle.click(); await sleep(450); }
      await page.waitForSelector(`${PASSES} .lo-chip[data-pass]:not(.lo-chip-skel)`);
    };
    const dialogOpen = () => page.evaluate(() => { const layer = document.querySelector('.ui-dialog-layer'); return Boolean(layer && layer.classList.contains('is-open')); });
    const waitClosed = () => until(() => page.evaluate(() => !document.querySelector('.ui-dialog-layer')), { timeout: 3000, message: 'que se cierre el diálogo' });

    await test('pux', 'Préstamos UX', 'Cartelitos: entregar en un pop up accesible con teclado (foco atrapado, Esc pregunta si hay datos, Enter entrega, el foco vuelve al cartelito) y devolver con un clic (sin diálogo)', async () => {
      await viewportFor(page, 1440);
      await openPasses();
      const states = await passStates();
      const numero = Object.keys(states).find(n => /disponible/i.test(states[n].estado || 'Disponible'));
      assert(numero, 'No hay cartelitos libres.');
      const chipSel = `${PASSES} .lo-chip[data-pass="${numero}"]`;
      await page.click(chipSel);
      await until(dialogOpen, { timeout: 2000, message: 'el diálogo' });
      const a11y = await page.evaluate(() => {
        const d = document.querySelector('[role="dialog"]');
        const label = d && document.getElementById(d.getAttribute('aria-labelledby'));
        return { modal: d?.getAttribute('aria-modal'), label: label?.textContent, active: document.activeElement?.id, inert: document.getElementById('root').hasAttribute('inert') };
      });
      assert(a11y.modal === 'true' && new RegExp(`cartelito ${numero}`, 'i').test(a11y.label || ''), `Diálogo sin rol/nombre: ${JSON.stringify(a11y)}`);
      assert(a11y.active === 'lo-pf-alumno', `El foco no entró al campo Alumno (${a11y.active}).`);
      assert(a11y.inert, 'La pantalla de atrás no quedó inerte.');
      // Tab nunca sale del diálogo.
      for (let i = 0; i < 14; i += 1) {
        await page.keyboard.press('Tab');
        const inside = await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')));
        assert(inside, `Tab ${i + 1} sacó el foco del diálogo.`);
      }
      // Vacío: Esc cierra y el foco vuelve al cartelito.
      await page.focus('#lo-pf-alumno');
      await page.keyboard.press('Escape');
      await waitClosed();
      assert(await page.evaluate(sel => document.activeElement === document.querySelector(sel), chipSel), 'El foco no volvió al cartelito.');
      // Con algo escrito: Esc pregunta; "Seguir editando" (Esc) vuelve al campo con lo escrito.
      await page.keyboard.press('Enter');
      await until(dialogOpen, { timeout: 2000, message: 'reabrir con Enter' });
      await page.type('#lo-pf-alumno', 'Zq Revisión');
      await sleep(350);
      await page.keyboard.press('Escape');
      await sleep(200);
      if (!(await page.$('.ui-dialog .ui-confirm'))) await page.keyboard.press('Escape'); // la primera cerró las sugerencias
      await page.waitForSelector('.ui-dialog .ui-confirm', { timeout: 2000 });
      await page.keyboard.press('Escape');
      await until(() => page.evaluate(() => document.activeElement?.id === 'lo-pf-alumno'), { timeout: 2000, message: 'el foco de vuelta en Alumno' });
      assert(await page.$eval('#lo-pf-alumno', el => el.value) === 'Zq Revisión', 'Se perdió lo escrito.');
      await page.screenshot({ path: path.join(outDir, 'dialogo-1440.png') });
      // Enter entrega.
      await page.keyboard.press('Enter');
      await waitClosed();
      const lent = await until(async () => { const s = await passStates(); return /prestado/i.test(s[numero]?.estado || '') && s[numero]; }, { message: 'la entrega' });
      assert(lent.prestadoA === 'Zq Revisión', `Se entregó a "${lent.prestadoA}".`);
      assert(await page.evaluate(sel => document.activeElement === document.querySelector(sel), chipSel), 'Después de entregar el foco no volvió al cartelito.');
      const status = await page.$eval(`${PASSES} .ui-status`, el => el.textContent || '').catch(() => '');
      assert(/entregado/i.test(status) && /Deshacer/.test(status), `Sin línea de estado con Deshacer: "${status}"`);
      // Clic en el entregado: lo devuelve (sin diálogo) con Deshacer.
      await page.click(chipSel);
      await until(async () => /disponible/i.test((await passStates())[numero]?.estado || ''), { message: 'la devolución' });
      assert(!(await page.$('[role="dialog"]')), 'Devolver abrió el diálogo.');
      return `cartelito ${numero}: entregado a "${lent.prestadoA}" y devuelto`;
    });

    await test('pux', 'Préstamos UX', 'Cartelitos: clic en el fondo cierra; Ctrl+clic marca sin abrir; "Entregar 2" usa el diálogo para los dos', async () => {
      await viewportFor(page, 1440);
      await openPasses();
      const states = await passStates();
      const libres = Object.keys(states).filter(n => /disponible/i.test(states[n].estado || 'Disponible')).slice(0, 2);
      assert(libres.length === 2, 'Faltan cartelitos libres.');
      await page.click(`${PASSES} .lo-chip[data-pass="${libres[0]}"]`);
      await until(dialogOpen, { timeout: 2000, message: 'el diálogo' });
      await page.mouse.click(8, 450); // el fondo atenuado
      await waitClosed();
      await page.keyboard.down('Control');
      for (const n of libres) await page.click(`${PASSES} .lo-chip[data-pass="${n}"]`);
      await page.keyboard.up('Control');
      await sleep(250);
      assert(!(await page.$('[role="dialog"]')), 'Ctrl+clic abrió el diálogo.');
      const entregar = await page.evaluateHandle(sel => [...document.querySelectorAll(`${sel} .lo-selbar button`)].find(b => /^Entregar 2/.test((b.textContent || '').trim())), PASSES);
      assert(entregar.asElement(), 'La barra no ofrece "Entregar 2".');
      await entregar.asElement().click();
      await until(dialogOpen, { timeout: 2000, message: 'el diálogo del lote' });
      const title = await page.$eval('[role="dialog"] h2', el => el.textContent || '');
      assert(/Entregar 2 cartelitos/.test(title), `Título "${title}".`);
      await page.type('#lo-pf-alumno', 'Zq Responsable');
      await sleep(300);
      // Enviar con el botón del pie (Enter podría elegir una sugerencia).
      const send = await page.evaluateHandle(() => [...document.querySelectorAll('.ui-dialog-foot button')].find(b => /^Entregar 2/.test((b.textContent || '').trim())));
      await send.asElement().click();
      await waitClosed();
      const after = await passStates();
      assert(libres.every(n => /prestado/i.test(after[n]?.estado || '')), `No se entregaron los dos: ${libres.map(n => after[n]?.estado).join(', ')}`);
      // Volver a dejarlos libres (por API, para no dejar estado).
      for (const n of libres) await api.post(`/api/photo-passes/${n}/return`, {});
      return `lote ${libres.join(', ')}`;
    });

    await test('pux', 'Préstamos UX', 'Cartelitos en mobile (390): el diálogo ocupa el ancho con márgenes, entra en la pantalla con el pie a la vista y sin recortes', async () => {
      await viewportFor(page, 390, 844);
      await openPasses();
      const states = await passStates();
      const numero = Object.keys(states).find(n => /disponible/i.test(states[n].estado || 'Disponible'));
      await page.click(`${PASSES} .lo-chip[data-pass="${numero}"]`);
      await until(dialogOpen, { timeout: 2000, message: 'el diálogo' });
      await sleep(300);
      const m = await page.evaluate(() => {
        const d = document.querySelector('.ui-dialog').getBoundingClientRect();
        const foot = document.querySelector('.ui-dialog-foot').getBoundingClientRect();
        const input = getComputedStyle(document.querySelector('#lo-pf-alumno')).fontSize;
        return { left: d.left, right: innerWidth - d.right, top: d.top, bottom: innerHeight - d.bottom, footBottom: foot.bottom, vh: innerHeight, input, sx: document.documentElement.scrollWidth - innerWidth };
      });
      assert(m.left >= 8 && m.right >= 8 && m.left <= 20 && m.right <= 20, `Márgenes laterales ${m.left}/${m.right}.`);
      assert(m.top >= 0 && m.bottom >= 0 && m.footBottom <= m.vh, `El diálogo se sale de la pantalla: ${JSON.stringify(m)}`);
      assert(parseFloat(m.input) >= 16, `Campo de ${m.input} (iPhone hace zoom).`);
      assert(m.sx <= 0, 'Scroll horizontal con el diálogo abierto.');
      const probe = await probeView(page, { scope: '.ui-dialog', scrollSteps: 0 });
      assert(!probe.counts.truncated && !probe.counts.cut && !probe.counts.covered, formatProbe(probe));
      await page.screenshot({ path: path.join(outDir, 'dialogo-390.png') });
      await page.click('.ui-dialog-x');
      await waitClosed();
      await viewportFor(page, 1440);
      return `márgenes ${Math.round(m.left)}/${Math.round(m.right)} · campo ${m.input}`;
    });

    // ── Sondas en los estados nuevos ────────────────────────────────────────
    await test('pux', 'Préstamos UX', 'Sonda UX en 0 con el cierre del día abierto (390/1024/1440, oscuro y claro)', async () => {
      const notes = [];
      for (const width of [390, 1024, 1440]) {
        await viewportFor(page, width);
        await openLoans(page, base);
        await page.click('button[aria-controls="lo-cierre"]');
        await sleep(700);
        await settle(page);
        for (const theme of ['dark', 'light']) {
          await setTheme(page, theme);
          const probe = await probeView(page, { scope: '.lo-page', scrollSteps: 3 });
          assert(!probe.total, `${width} ${theme} (cierre): ${formatProbe(probe)}`);
        }
        if (width === 1440) await page.screenshot({ path: path.join(outDir, 'cierre-1440.png') });
        await setTheme(page, 'dark');
        notes.push(`${width} ok`);
      }
      await viewportFor(page, 1440);
      return notes.join(' · ');
    });

    assert(true);
    if (consoleErrors.length) console.log(`  (pux) errores de la página: ${consoleErrors.slice(0, 3).join(' | ')}`);
  } finally {
    await context.close();
  }
}

const PASS_STACK_TOGGLE = `${PASSES} .lo-passes-head .lo-group-toggle`;
