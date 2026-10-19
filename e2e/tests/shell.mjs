// sh) Shell y colapsos (REGLAS-UX, agregado 19/10): abrir y cerrar secciones con
// alto suave sin que el encabezado tocado se mueva ni el documento salte; la
// franja de Accesos rápidos usa el ancho; ningún ítem del menú lateral queda
// cortado o tapado por el bloque de abajo.
import { assert, clickButton, gotoView, openContext, sleep, until } from '../lib/browser.mjs';

/**
 * Instala un muestreador por frame (después de pintar cada frame) que registra cuánto se movió en
 * pantalla `selector` respecto de su posición antes del click, el scroll del
 * documento y los estados del colapso que se vieron. Devuelve una función que
 * lo detiene y trae el resultado.
 */
async function watch(page, selector, collapseSelector) {
  await page.evaluate((sel, collapseSel) => {
    const el = document.querySelector(sel);
    const top0 = el.getBoundingClientRect().top;
    const out = { deltas: [], docY: [], states: new Set(), heights: [] };
    window.__e2eWatch = out;
    const tick = () => {
      if (out.stop) return;
      out.deltas.push(el.getBoundingClientRect().top - top0);
      out.docY.push(window.scrollY + document.documentElement.scrollTop);
      const collapse = collapseSel ? document.querySelector(collapseSel) : null;
      if (collapse) {
        out.states.add(collapse.getAttribute('data-state'));
        out.heights.push(Math.round(collapse.getBoundingClientRect().height));
      }
      // Se mide después de pintar (tarea posterior al frame): lo que se ve.
      requestAnimationFrame(() => setTimeout(tick));
    };
    requestAnimationFrame(() => setTimeout(tick));
  }, selector, collapseSelector || '');
  return async () => page.evaluate(() => {
    const out = window.__e2eWatch;
    out.stop = true;
    const maxDelta = Math.max(0, ...out.deltas.map(Math.abs));
    return { maxDelta: Math.round(maxDelta * 10) / 10, maxDocY: Math.max(0, ...out.docY), frames: out.deltas.length, states: [...out.states], heights: out.heights };
  });
}

/** El colapso tuvo alturas intermedias (se animó, no saltó de golpe). */
function animated(heights) {
  const first = heights[0];
  const last = heights[heights.length - 1];
  const lo = Math.min(first, last) + 4;
  const hi = Math.max(first, last) - 4;
  return heights.some(height => height > lo && height < hi);
}

export async function shellTests({ browser, base, api, admin, releaseVersion, test, track = () => {} }) {
  // ── Préstamos: grupo y "Cartelitos de fotos" ─────────────────────────────
  const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width: 1440, height: 900 } });
  track(page);
  try {
    await test('sh', 'Shell', 'Anclaje de colapso en Préstamos: el encabezado tocado no se mueve (± 2 px) al abrir y cerrar, y el documento no salta', async () => {
      await gotoView(page, base, 'loans');
      await page.waitForSelector('.lo-group-toggle', { timeout: 20000 });
      await sleep(800);
      const report = [];
      const toggles = await page.$$eval('.lo-group-toggle', els => els.map((el, index) => ({ index, text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24) })));
      const targets = [toggles.find(item => /cartelitos/i.test(item.text)), toggles[0]].filter(Boolean);
      assert(targets.length, 'No hay grupos desplegables en Préstamos.');
      for (const target of targets) {
        const selector = `[data-e2e-toggle="${target.index}"]`;
        await page.evaluate(index => {
          const el = document.querySelectorAll('.lo-group-toggle')[index];
          el.setAttribute('data-e2e-toggle', String(index));
          const body = el.closest('.lo-group, .lo-card')?.querySelector('.ui-collapse');
          body?.setAttribute('data-e2e-collapse', String(index));
        }, target.index);
        for (let round = 0; round < 2; round += 1) {
          // Peor caso: el área de contenido lo más abajo posible con el
          // encabezado todavía a la vista (cerrar acorta la página y el
          // navegador tendría que recortar el scroll).
          await page.evaluate(sel => {
            const el = document.querySelector(sel);
            const scroller = document.querySelector('.shell-scroll');
            const offset = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 60;
            scroller.scrollTop = Math.min(scroller.scrollHeight - scroller.clientHeight, scroller.scrollTop + offset);
          }, selector);
          await sleep(250);
          const before = await page.$eval(selector, el => el.getAttribute('aria-expanded'));
          const stop = await watch(page, selector, `[data-e2e-collapse="${target.index}"]`);
          await page.click(selector);
          await sleep(650);
          const result = await stop();
          const after = await page.$eval(selector, el => el.getAttribute('aria-expanded'));
          assert(after !== before, `${target.text}: el click no cambió aria-expanded (${before} → ${after}).`);
          assert(result.maxDelta <= 2, `${target.text} (${before === 'true' ? 'cerrar' : 'abrir'}): el encabezado se movió ${result.maxDelta} px.`);
          assert(result.maxDocY === 0, `${target.text}: el documento scrolleó ${result.maxDocY} px.`);
          if (result.heights.length) assert(animated(result.heights), `${target.text}: el alto no pasó por valores intermedios (${result.heights.slice(0, 8).join(', ')}…): se abrió o cerró de golpe.`);
          report.push(`${target.text} ${before === 'true' ? 'cerrar' : 'abrir'} ${result.maxDelta}px`);
        }
      }
      return report.join(' · ');
    });
  } finally {
    await context.close().catch(() => {});
  }

  // ── Inicio: franja de Accesos rápidos ──────────────────────────────────────
  const home = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width: 1440, height: 900 } });
  track(home.page);
  try {
    await test('sh', 'Shell', 'Franja de Accesos rápidos: se abre y cierra suave, el rayo y la página no saltan, usa el ancho sin truncar', async () => {
      const p = home.page;
      await gotoView(p, base, 'dashboard');
      const bolt = 'button[aria-label="Ver accesos rápidos"]';
      await p.waitForSelector(bolt, { timeout: 20000 });
      await sleep(600);
      const notes = [];

      // 1) Arriba de todo: abre; el rayo no se mueve, el documento no scrollea, el alto se anima.
      let stop = await watch(p, bolt, null);
      await p.click(bolt);
      await p.waitForSelector('#shell-strip-quick');
      const heights = [];
      const t0 = Date.now();
      while (Date.now() - t0 < 450) {
        heights.push(await p.evaluate(() => Math.round(document.querySelector('#shell-strip-quick')?.closest('.ui-collapse')?.getBoundingClientRect().height || 0)));
        await sleep(15);
      }
      let result = await stop();
      assert(result.maxDelta <= 2, `Abrir: el rayo se movió ${result.maxDelta} px.`);
      assert(result.maxDocY === 0, `Abrir: el documento scrolleó ${result.maxDocY} px.`);
      notes.push(`abrir ${result.maxDelta}px`);

      // 2) Usa el ancho: con 2+ accesos, más de una columna; títulos sin cortar a 1440.
      const layout = await p.evaluate(() => {
        const items = [...document.querySelectorAll('#shell-strip-quick .shell-quick-item')];
        const strip = document.querySelector('#shell-strip-quick').getBoundingClientRect();
        const lefts = new Set(items.map(item => Math.round(item.getBoundingClientRect().left)));
        const cut = [...document.querySelectorAll('#shell-strip-quick .shell-quick-title.is-cut')].map(el => el.textContent);
        const rightmost = Math.max(0, ...items.map(item => item.getBoundingClientRect().right));
        return { count: items.length, columns: lefts.size, cut, used: Math.round(((rightmost - strip.left) / strip.width) * 100) };
      });
      if (layout.count >= 2) assert(layout.columns >= 2, `Los ${layout.count} accesos quedaron en una sola columna.`);
      if (layout.count >= 4) assert(layout.used >= 60, `Los accesos usan solo el ${layout.used} % del ancho de la franja.`);
      assert(!layout.cut.length, `Títulos cortados con espacio de sobra: ${layout.cut.join(' | ')}`);
      notes.push(`${layout.count} accesos en ${layout.columns} columnas (${layout.used} % del ancho)`);

      // 3) Cierra con el rayo: tampoco se mueve nada arriba ni salta el documento.
      stop = await watch(p, bolt, null);
      await p.click(bolt);
      await until(() => p.$('#shell-strip-quick').then(el => !el), { timeout: 3000, message: 'que la franja termine de cerrarse' });
      result = await stop();
      assert(result.maxDelta <= 2, `Cerrar: el rayo se movió ${result.maxDelta} px.`);
      assert(result.maxDocY === 0, `Cerrar: el documento scrolleó ${result.maxDocY} px.`);
      notes.push(`cerrar ${result.maxDelta}px`);

      // 4) Scrolleado: lo que se está mirando (el elemento en el medio del área) no salta.
      const ready = await p.evaluate(() => {
        const scroller = document.querySelector('.shell-scroll');
        if (scroller.scrollHeight - scroller.clientHeight < 200) return false;
        scroller.scrollTop = Math.round((scroller.scrollHeight - scroller.clientHeight) / 2);
        const rect = scroller.getBoundingClientRect();
        const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        target?.setAttribute('data-e2e-look', '1');
        return Boolean(target);
      });
      if (ready) {
        await sleep(200);
        stop = await watch(p, '[data-e2e-look]', null);
        await p.click(bolt);
        await sleep(500);
        result = await stop();
        assert(result.maxDelta <= 2, `Scrolleado: lo que se miraba se movió ${result.maxDelta} px al abrir la franja.`);
        assert(result.maxDocY === 0, `Scrolleado: el documento scrolleó ${result.maxDocY} px.`);
        notes.push(`scrolleado ${result.maxDelta}px`);
        await p.click(bolt);
        await sleep(500);
      }

      assert(animated(heights.filter(Boolean).length ? [0, ...heights] : heights), `La franja no pasó por alturas intermedias (${heights.slice(0, 10).join(', ')}): se abrió de golpe.`);
      return notes.join(' · ');
    });
  } finally {
    await home.context.close().catch(() => {});
  }

  // ── Menú lateral: ningún ítem cortado ni tapado ─────────────────────────────
  for (const [width, height] of [[1440, 900], [1366, 768]]) {
    const ctx = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width, height } });
    track(ctx.page);
    try {
      await test('sh', 'Shell', `Menú lateral a ${width}×${height}: todos los ítems entran enteros y nada los tapa`, async () => {
        await gotoView(ctx.page, base, 'dashboard');
        await ctx.page.waitForSelector('.shell-nav-groups .shell-nav-item', { timeout: 20000 });
        await sleep(400);
        const info = await ctx.page.evaluate(() => {
          const nav = document.querySelector('.shell-nav');
          const list = nav.querySelector('.shell-nav-groups');
          const box = list.getBoundingClientRect();
          const foot = nav.querySelector('.shell-nav-foot').getBoundingClientRect();
          const items = [...list.querySelectorAll('.shell-nav-item')].map(el => ({ label: el.getAttribute('aria-label'), rect: el.getBoundingClientRect() }));
          const outside = items.filter(({ rect }) => rect.top < box.top - 0.5 || rect.bottom > box.bottom + 0.5).map(item => item.label);
          const covered = items.filter(({ rect }) => rect.bottom > foot.top + 0.5).map(item => item.label);
          const footItems = [...nav.querySelectorAll('.shell-nav-foot .shell-nav-item, .shell-nav-foot button')].filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.top < foot.top - 0.5 || rect.bottom > window.innerHeight + 0.5;
          }).length;
          return { density: nav.dataset.density, count: items.length, outside, covered, footItems, scrolls: list.scrollHeight > list.clientHeight + 1, overlap: box.bottom > foot.top + 0.5 };
        });
        assert(!info.outside.length, `Ítems cortados o fuera de la lista: ${info.outside.join(', ')}`);
        assert(!info.covered.length, `Ítems tapados por el bloque de Configuración/usuario: ${info.covered.join(', ')}`);
        assert(!info.overlap, 'La lista se superpone al pie.');
        assert(!info.footItems, 'Hay controles del pie fuera de la pantalla.');
        assert(!info.scrolls, `A ${width}×${height} la lista no entra sin scroll.`);
        return `${info.count} ítems · densidad ${info.density}`;
      });
    } finally {
      await ctx.context.close().catch(() => {});
    }
  }

  // ── Línea de estado global (pushStatus): entra y sale con alto suave ───────
  {
    const ctx = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width: 1440, height: 900 } });
    track(ctx.page);
    try {
      await test('sh', 'Shell', 'Línea de estado de la cabecera: aparece y se va con alto suave (Ctrl K → equipo → "Quitar filtro")', async () => {
        const p = ctx.page;
        const free = (await api.devices()).find(device => /^(|disponible|devuelto)$/i.test(String(device.estado || '').trim()))?.etiqueta;
        assert(free, 'No hay equipos libres.');
        await gotoView(p, base, 'loans');
        await p.waitForSelector('.shell-nav .shell-nav-item', { timeout: 20000 });
        await sleep(800); // chunk de las franjas precargado en idle
        const sample = async ms => {
          const heights = [];
          const t0 = Date.now();
          while (Date.now() - t0 < ms) {
            heights.push(await p.evaluate(() => Math.round(document.querySelector('.shell-head .shell-status')?.closest('.ui-collapse')?.getBoundingClientRect().height ?? -1)));
          }
          return heights;
        };
        await p.keyboard.down('Control'); await p.keyboard.press('KeyK'); await p.keyboard.up('Control');
        await until(() => p.evaluate(() => Boolean(document.activeElement?.matches('.shell-palette .shell-pal-input'))), { message: 'la paleta abierta' });
        await p.keyboard.type(free, { delay: 10 });
        await p.waitForSelector('.shell-pal-item.is-active');
        await p.keyboard.press('Enter');
        const opening = await sample(450);
        await p.waitForSelector('.shell-head .shell-status', { timeout: 5000 });
        const full = opening.filter(h => h >= 0);
        const max = Math.max(...full);
        assert(max > 20, `No apareció la línea de estado (${opening.slice(0, 8).join(', ')}).`);
        assert(full.some(h => h > 2 && h < max - 2), `La línea apareció de golpe (${full.slice(0, 10).join(', ')}).`);
        await clickButton(p, /^Quitar filtro$/, { scope: '.shell-head .shell-status' });
        const closing = await sample(450);
        const seen = closing.filter(h => h >= 0);
        assert(seen.some(h => h > 2 && h < max - 2), `La línea se fue de golpe (${closing.slice(0, 10).join(', ')}).`);
        await until(() => p.evaluate(() => !document.querySelector('.shell-head .shell-status')), { message: 'que la línea se desmonte al terminar' });
        return `entra ${full.slice(0, 6).join('→')}… sale ${seen.slice(0, 6).join('→')}…`;
      });
    } finally {
      await ctx.context.close().catch(() => {});
    }
  }

  // ── Mobile: con el teclado abierto la barra inferior se esconde y el campo
  //    enfocado queda a la vista; al cerrarlo, vuelve. ──────────────────────
  {
    const ctx = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width: 390, height: 844 } });
    track(ctx.page);
    try {
      await test('sh', 'Shell', 'Mobile: con el teclado abierto la barra inferior se esconde, el campo queda a la vista y al cerrar vuelve', async () => {
        const p = ctx.page;
        await gotoView(p, base, 'loans');
        await p.waitForSelector('.shell-tabbar .shell-tab', { timeout: 20000 });
        await sleep(400);
        const tabbarShown = () => p.evaluate(() => {
          const bar = document.querySelector('.shell-tabbar');
          return Boolean(bar && getComputedStyle(bar).display !== 'none' && bar.getBoundingClientRect().height > 0);
        });
        assert(await tabbarShown(), 'Sin teclado no se ve la barra inferior.');
        const field = await p.evaluateHandle(() => [...document.querySelectorAll('.shell-view input:not([type="hidden"]), .shell-view textarea')]
          .find(el => el.checkVisibility?.() && el.getBoundingClientRect().height > 0) || null);
        assert(field.asElement(), 'No hay un campo a la vista en Préstamos.');
        await field.asElement().focus();
        // El teclado achica el viewport (interactive-widget=resizes-content).
        await p.setViewport({ width: 390, height: 470 });
        await until(async () => p.evaluate(() => document.querySelector('.shell')?.classList.contains('is-kb-open')), { message: 'que la app detecte el teclado' });
        assert(!(await tabbarShown()), 'Con el teclado abierto la barra inferior sigue a la vista.');
        await sleep(200);
        const visible = await p.evaluate(() => {
          const el = document.activeElement;
          const box = document.querySelector('.shell-scroll').getBoundingClientRect();
          const r = el.getBoundingClientRect();
          return { inside: r.top >= box.top - 1 && r.bottom <= box.bottom + 1, field: [Math.round(r.top), Math.round(r.bottom)], area: [Math.round(box.top), Math.round(box.bottom)] };
        });
        assert(visible.inside, `El campo enfocado quedó fuera del área visible: ${JSON.stringify(visible)}`);
        await p.evaluate(() => document.activeElement?.blur());
        await p.setViewport({ width: 390, height: 844 });
        await until(tabbarShown, { message: 'que vuelva la barra inferior' });
        return `barra escondida con el teclado; campo en ${visible.field.join('..')} dentro de ${visible.area.join('..')}`;
      });
    } finally {
      await ctx.context.close().catch(() => {});
    }
  }

  // ── Ventanas bajas (rail a 1024, menú a 1280×640): la lista puede scrollear,
  //    pero en ninguna posición queda un ítem a medias ni tapado por el pie. ──
  for (const [width, height] of [[1024, 640], [1024, 768], [1280, 640]]) {
    const ctx = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width, height } });
    track(ctx.page);
    try {
      await test('sh', 'Shell', `Menú a ${width}×${height}: si la lista scrollea, nunca queda un ítem a medias (arriba, rueda, al fondo)`, async () => {
        const p = ctx.page;
        await gotoView(p, base, 'dashboard');
        await p.waitForSelector('.shell-nav-groups .shell-nav-item', { timeout: 20000 });
        await sleep(400);
        const measure = () => p.evaluate(() => {
          const nav = document.querySelector('.shell-nav');
          const list = nav.querySelector('.shell-nav-groups');
          const box = list.getBoundingClientRect();
          const foot = nav.querySelector('.shell-nav-foot').getBoundingClientRect();
          const half = [];
          for (const el of list.querySelectorAll('.shell-nav-item')) {
            const r = el.getBoundingClientRect();
            const inside = r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5;
            const outside = r.bottom <= box.top + 0.5 || r.top >= box.bottom - 0.5;
            if (!inside && !outside) half.push(`${el.getAttribute('aria-label')} (${Math.round(r.top - box.top)}..${Math.round(r.bottom - box.top)} de ${Math.round(box.height)})`);
          }
          return { mode: document.querySelector('.shell')?.dataset.nav, density: nav.dataset.density, scrolls: list.scrollHeight > list.clientHeight + 1, top: Math.round(list.scrollTop), half, overlap: box.bottom > foot.top + 0.5, center: [box.left + box.width / 2, box.top + box.height / 2] };
        });
        const first = await measure();
        const seen = [first];
        if (first.scrolls) {
          await p.mouse.move(first.center[0], first.center[1]);
          for (let i = 0; i < 3; i += 1) {
            await p.mouse.wheel({ deltaY: 45 });
            await sleep(450); // el snap se asienta
            seen.push(await measure());
          }
          await p.evaluate(() => { const list = document.querySelector('.shell-nav-groups'); list.scrollTop = list.scrollHeight; });
          await sleep(450);
          seen.push(await measure());
        }
        const problems = seen.flatMap(item => item.half.map(label => `scroll ${item.top}: ${label}`));
        assert(!problems.length, `Ítems a medias: ${problems.slice(0, 4).join('; ')}`);
        assert(!seen.some(item => item.overlap), 'La lista se superpone al pie.');
        return `${first.mode} · densidad ${first.density}${first.scrolls ? ` · scrollea (posiciones ${seen.map(item => item.top).join(', ')})` : ' · sin scroll'}`;
      });
    } finally {
      await ctx.context.close().catch(() => {});
    }
  }
}
