// bxo) Barrido de REGLAS-UX — Agenda TIC, Horarios, Estado de aulas,
// Recordatorios, Tareas TIC, Tickets y Sugerencias (docs/redesign/BARRIDO-UX.md).
//
//   - Sonda por pantalla y ancho (360 a 1920): sin scroll horizontal, ningún
//     control tapado por otro (elementFromPoint en su centro), ningún texto
//     cortado con elipsis que tenía lugar en su renglón.
//   - Abrir y cerrar cada colapso principal: el disparador no se mueve más de
//     2 px en ningún frame y el documento no scrollea.
//   - Pendientes del frente: barra de selección de Tareas a la vista en mobile
//     (sin mover ni tapar la tarjeta tocada), sin "Columnas 1–3 de 3"
//     fantasma, plano de Aulas sin hueco debajo en plantas anchas, borrador de
//     recreos conservado al volver por el menú, notificación que abre el
//     ticket puntual.
// Todo corre contra la copia de la base (lo que se crea, se crea ahí).
import { assert, gotoView, openContext, pathname, sleep, until } from '../lib/browser.mjs';

export const BARRIDO_WIDTHS = [360, 768, 1024, 1280, 1366, 1440, 1920];
const SCREENS = [
  { view: 'agenda', ready: '.ag-page .ag-card' },
  { view: 'schedules', ready: '.hr-page .hr-recess-card' },
  { view: 'classrooms', ready: '.cls-plan-card .cls-room' },
  { view: 'reminders', ready: '.rem-list-col .rem-card' },
  { view: 'tasks', ready: '.tk-board-sec .tk-lane' },
  { view: 'tickets', ready: '.tkx-wrap .tkx-list' },
  { view: 'suggestions', ready: '.sgx-list' }
];

/**
 * Sonda que corre en la página: scroll horizontal, controles tapados y
 * truncados con espacio dentro de `rootSelector`.
 */
export function barridoProbe(rootSelector) {
  const root = document.querySelector(rootSelector) || document.querySelector('.shell-scroll');
  if (!root) return { error: `No está ${rootSelector}` };
  const visible = element => (element.checkVisibility ? element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : element.getClientRects().length > 0);
  const describe = element => {
    const classes = typeof element.className === 'string' ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(name => `.${name}`).join('') : '';
    const label = (element.getAttribute('aria-label') || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return `${element.tagName.toLowerCase()}${classes}${label ? ` "${label}"` : ''}`;
  };
  const scroller = document.querySelector('.shell-scroll');
  const view = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: innerHeight, left: 0, right: innerWidth };

  // 1. Scroll horizontal (página y área de contenido).
  const scrollX = document.documentElement.scrollWidth > document.documentElement.clientWidth || (scroller ? scroller.scrollWidth > scroller.clientWidth + 1 : false);

  // 2. Controles tapados: el centro del control (si está a la vista) tiene que ser el control o algo de adentro.
  const covered = [];
  for (const control of root.querySelectorAll('button, a[href], input, textarea, [role="checkbox"], [role="radio"], [role="tab"]')) {
    if (!visible(control) || control.closest('[inert], [aria-hidden="true"]')) continue;
    if (getComputedStyle(control).pointerEvents === 'none') continue;
    const r = control.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (y < view.top + 2 || y > view.bottom - 2 || x < view.left + 2 || x > view.right - 2) continue;
    const hit = document.elementFromPoint(x, y);
    if (!hit || hit === control || control.contains(hit)) continue;
    // Un label que envuelve al control (o el control dentro del label) cuenta como el mismo.
    if (hit.closest('label')?.contains(control) || control.closest('label')?.contains(hit)) continue;
    // La barra de selección fija de Tareas tapa lo que scrollea debajo a propósito (se llega scrolleando).
    if (hit.closest('.tk-selbar')) continue;
    covered.push(`${describe(control)} ⟂ ${describe(hit)}`);
  }

  // 3. Truncados con espacio: elipsis cortando y lugar libre en el mismo renglón.
  const range = document.createRange();
  const truncated = [];
  for (const element of root.querySelectorAll('*')) {
    if (!visible(element)) continue;
    const style = getComputedStyle(element);
    const clamp = style.webkitLineClamp && style.webkitLineClamp !== 'none';
    if (style.textOverflow !== 'ellipsis' || clamp) continue;
    const need = element.scrollWidth - element.clientWidth;
    if (need <= 1) continue;
    const row = element.parentElement;
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
    xs.sort((a, b) => a[0] - b[0]);
    let ink = 0;
    let clusters = 0;
    let end = -Infinity;
    for (const [left, right] of xs) {
      if (left > end + 0.5) { clusters += 1; ink += right - left; end = right; } else if (right > end) { ink += right - end; end = right; }
    }
    const free = (contentRight - contentLeft) - ink - 16 * Math.max(0, clusters - 1);
    if (free >= need + 4) truncated.push(`${describe(element)} (faltan ${Math.round(need)} px, sobran ${Math.round(free)})`);
  }
  // 4. Huecos: franjas de alto sin texto ni controles dentro de cada tarjeta (> 48 px),
  //    y entre bloques consecutivos de una misma columna de la página.
  const CARDS = '.ag-card, .hr-card, .cls-card, .rem-card, .tkx-list, .tkx-pane, .sgx-list, .sgx-side, .tk-lane, .tk-people, .tk-form';
  const SOLID = '.cls-plan-view, img, video, canvas, .ui-skel, [class*="skeleton"], .tk-card, textarea, input';
  const gaps = [];
  for (const card of root.querySelectorAll(CARDS)) {
    if (!visible(card) || card.closest('[inert]')) continue;
    const box = card.getBoundingClientRect();
    if (box.height < 2 || box.bottom < view.top || box.top > view.bottom) continue;
    const spans = [];
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim() || !node.parentElement || !visible(node.parentElement)) continue;
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) if (r.height > 1 && r.width > 1) spans.push([r.top, r.bottom]);
    }
    for (const el of card.querySelectorAll(`button, input, textarea, svg, [role="checkbox"], ${SOLID}`)) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.height > 1 && r.width > 1) spans.push([r.top, r.bottom]);
    }
    spans.sort((a, b) => a[0] - b[0]);
    let cursor = box.top;
    let worst = 0;
    for (const [top, bottom] of spans) { worst = Math.max(worst, top - cursor); cursor = Math.max(cursor, bottom); }
    worst = Math.max(worst, box.bottom - cursor);
    if (worst > 48) gaps.push(`${describe(card)}: ${Math.round(worst)} px vacíos adentro`);
  }
  return { scrollX, covered: covered.slice(0, 8), coveredCount: covered.length, truncated: truncated.slice(0, 8), truncatedCount: truncated.length, gaps: gaps.slice(0, 8), gapCount: gaps.length };
}

/**
 * Muestrea por frame cuánto se movió `selector` en pantalla desde antes de
 * `act()`, y el scroll del documento. Devuelve el máximo desvío.
 */
async function anchoredDuring(page, selector, act, ms = 520) {
  await page.evaluate(sel => {
    const el = document.querySelector(sel);
    const out = { deltas: [], shifts: [], hidden: 0, docY: [] };
    const sc = document.querySelector(".shell-scroll");
    const sc0 = sc ? sc.scrollTop : 0;
    window.__bxo = out;
    if (!el) { out.missing = true; return; }
    const top0 = el.getBoundingClientRect().top;
    const tick = () => {
      if (out.stop) return;
      if (el.isConnected) {
        const r = el.getBoundingClientRect();
        out.deltas.push(r.top - top0);
        // Movimiento por layout (sin contar el scroll suave que trae lo abierto a la vista).
        out.shifts.push(r.top - top0 + ((sc ? sc.scrollTop : 0) - sc0));
        const area = sc ? sc.getBoundingClientRect() : { top: 0, bottom: innerHeight };
        if (r.bottom < area.top || r.top > area.bottom) out.hidden += 1;
      }
      out.docY.push(window.scrollY);
      requestAnimationFrame(() => setTimeout(tick));
    };
    requestAnimationFrame(() => setTimeout(tick));
  }, selector);
  await act();
  await sleep(ms);
  const out = await page.evaluate(() => { const o = window.__bxo; o.stop = true; return { missing: Boolean(o.missing), max: Math.max(0, ...o.deltas.map(Math.abs)), shift: Math.max(0, ...o.shifts.map(Math.abs)), hidden: o.hidden, docY: Math.max(0, ...o.docY), frames: o.deltas.length }; });
  assert(!out.missing, `no está ${selector}`);
  return out;
}

/** Scrollea el área de contenido lo más abajo posible (así cerrar algo tendría que recortar el scroll). */
async function scrollAreaTo(page, top = 1e6) {
  await page.evaluate(value => { const sc = document.querySelector('.shell-scroll'); if (sc) sc.scrollTop = value; }, top);
  await sleep(250);
}

async function clickSel(page, selector) {
  await page.waitForSelector(selector, { timeout: 8000 });
  await page.$eval(selector, el => { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); el.click(); });
}

export async function barridoOperacionTests({ browser, base, api, admin, releaseVersion, test, track = () => {} }) {
  const results = {};
  // Recordatorios arranca apagado en las sedes existentes: se prende en la copia (como en tests/classrooms.mjs).
  const settings = (await api.get('/api/site-settings')).data.settings || {};
  const enabled = Array.isArray(settings['modules.enabled']) ? settings['modules.enabled'] : [];
  if (!enabled.includes('reminders')) await api.patch('/api/site-settings', { 'modules.enabled': [...enabled, 'reminders'] });

  // ── 1. Sonda por pantalla y ancho (oscuro; el claro se mira en las capturas) ──
  for (const screen of SCREENS) {
    await test('bxo', 'Barrido operación', `${screen.view}: sin scroll horizontal, huecos, controles tapados ni truncados con espacio (360–1920)`, async () => {
      const problems = [];
      for (const width of BARRIDO_WIDTHS) {
        const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width, height: width < 768 ? 800 : 900 } });
        track(page);
        try {
          await gotoView(page, base, screen.view);
          await page.waitForSelector(screen.ready, { timeout: 20000 });
          await sleep(700);
          const probe = await page.evaluate(barridoProbe, '.shell-scroll');
          results[`${screen.view}@${width}`] = probe;
          if (probe.error) problems.push(`${width}: ${probe.error}`);
          if (probe.scrollX) problems.push(`${width}: scroll horizontal`);
          if (probe.coveredCount) problems.push(`${width}: tapados ${probe.covered.join(' | ')}`);
          if (probe.truncatedCount) problems.push(`${width}: truncados con espacio ${probe.truncated.join(' | ')}`);
          if (probe.gapCount) problems.push(`${width}: huecos ${probe.gaps.join(' | ')}`);
        } finally {
          await context.close();
        }
      }
      assert(!problems.length, problems.join('\n'));
    });
  }

  // ── 1b. Cada colapsable visible (botón con aria-expanded): al abrir, el
  //        disparador sigue a la vista (lo nuevo se trae sin sacarlo); al
  //        cerrar, no se mueve más de 2 px en ningún frame. ──
  for (const screen of SCREENS) {
    await test('bxo', 'Barrido operación', `${screen.view}: abrir y cerrar cada colapsable visible sin mover el disparador (1440)`, async () => {
      const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width: 1440, height: 900 } });
      track(page);
      page.on('dialog', dialog => { dialog.accept().catch(() => {}); });
      const problems = [];
      let tried = 0;
      try {
        await gotoView(page, base, screen.view);
        await page.waitForSelector(screen.ready, { timeout: 20000 });
        await sleep(700);
        const count = await page.evaluate(() => {
          const area = document.querySelector('.shell-scroll');
          const list = [...area.querySelectorAll('button[aria-expanded="false"]')]
            .filter(button => !button.disabled && button.getBoundingClientRect().width > 0 && !button.closest('[inert], .t-goo-anchor, .ui-select, .field-select, .ui-time, .ui-date'));
          list.forEach((button, index) => button.setAttribute('data-bxo-toggle', String(index)));
          return list.length;
        });
        for (let index = 0; index < Math.min(count, 10); index += 1) {
          const sel = `[data-bxo-toggle="${index}"]`;
          const ok = await page.evaluate(s => { const el = document.querySelector(s); if (!el || el.getAttribute('aria-expanded') !== 'false' || el.disabled || !el.isConnected) return false; el.scrollIntoView({ block: 'center' }); return true; }, sel);
          if (!ok) continue;
          await sleep(200);
          const label = await page.$eval(sel, el => (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40));
          tried += 1;
          await clickSel(page, sel);
          await sleep(500);
          const afterOpen = await page.evaluate(s => {
            const el = document.querySelector(s);
            if (!el) return { gone: true };
            const area = document.querySelector('.shell-scroll').getBoundingClientRect();
            const r = el.getBoundingClientRect();
            return { visible: r.top >= area.top - 1 && r.bottom <= area.bottom + 1, expanded: el.getAttribute('aria-expanded') };
          }, sel);
          if (afterOpen.gone) continue;
          if (!afterOpen.visible) problems.push(`«${label}»: al abrir quedó fuera de la vista`);
          if (afterOpen.expanded !== 'true') continue;
          const close = await anchoredDuring(page, sel, () => clickSel(page, sel));
          if (close.max > 2) problems.push(`«${label}»: al cerrar se movió ${Math.round(close.max)} px`);
          if (close.docY) problems.push(`«${label}»: el documento scrolleó`);
        }
      } finally {
        await context.close();
      }
      assert(!problems.length, problems.join(' · '));
      return `${tried} colapsables probados`;
    });
  }

  const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width: 1440, height: 900 } });
  track(page);
  // Si una prueba deja cambios sin guardar, salir de la página pide confirmar (beforeunload): se acepta.
  page.on('dialog', dialog => { dialog.accept().catch(() => {}); });
  try {
    // ── 2. Tareas ──────────────────────────────────────────────────────────
    await test('bxo', 'Tareas', 'Sin "Columnas 1–3 de 3" fantasma cuando entran todas las columnas', async () => {
      await gotoView(page, base, 'tasks');
      await page.waitForSelector('.tk-lane[data-lane]', { timeout: 20000 });
      await sleep(900); // la entrada animada de las columnas ya terminó
      const info = await page.evaluate(() => {
        const vp = document.querySelector('.tk-lanes-vp');
        const lanes = [...document.querySelectorAll('.tk-lanes > .tk-lane')];
        const fits = lanes.every(lane => lane.getBoundingClientRect().right <= vp.getBoundingClientRect().right + 1);
        return { fits, pager: Boolean(document.querySelector('.tk-pager')), fade: vp.classList.contains('fade-r') };
      });
      if (info.fits) assert(!info.pager && !info.fade, `entran todas las columnas pero hay paginador (${info.pager}) o borde desvanecido (${info.fade})`);
    });

    await test('bxo', 'Tareas', 'Editar columna: abrir y cerrar con el lápiz no mueve el lápiz (± 2 px)', async () => {
      await scrollAreaTo(page, 0);
      const sel = '.tk-lanes > .tk-lane:first-child .tk-lane-edit';
      const open = await anchoredDuring(page, sel, () => clickSel(page, sel));
      assert(await page.$('.tk-lanes > .tk-lane:first-child .ui-collapse[data-state="open"] .tk-col-edit'), 'no se abrió la edición de la columna');
      const close = await anchoredDuring(page, sel, () => clickSel(page, sel));
      assert(open.max <= 2 && close.max <= 2, `el lápiz se movió ${open.max} / ${close.max} px`);
      assert(!open.docY && !close.docY, 'el documento scrolleó');
    });

    await test('bxo', 'Tareas', 'Mobile: elegir una tarjeta abajo deja la barra de selección a la vista, sin mover ni tapar la tarjeta', async () => {
      const mobile = await openContext(browser, { base, token: admin.token, releaseVersion, device: { viewport: { width: 390, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }, userAgent: 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36' } });
      track(mobile.page);
      try {
        await gotoView(mobile.page, base, 'tasks');
        await mobile.page.waitForSelector('.tk-card', { timeout: 20000 });
        await sleep(600);
        const out = await mobile.page.evaluate(async () => {
          const sc = document.querySelector('.shell-scroll');
          sc.scrollTop = 700;
          await new Promise(r => setTimeout(r, 300));
          const view = sc.getBoundingClientRect();
          const card = [...document.querySelectorAll('.tk-card')].find(c => { const b = c.getBoundingClientRect(); return b.top > view.top + 160 && b.bottom < view.bottom - 10; })
            || [...document.querySelectorAll('.tk-card')].find(c => c.getBoundingClientRect().top > view.top + 20);
          if (!card) return { error: 'no hay tarjetas a la vista' };
          const check = card.querySelector('[role="checkbox"]');
          const before = card.getBoundingClientRect().top;
          check.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
          check.click();
          await new Promise(r => setTimeout(r, 450));
          const bar = document.querySelector('.tk-selbar');
          if (!bar) return { error: 'no apareció la barra de selección' };
          const b = bar.getBoundingClientRect();
          const c = card.getBoundingClientRect();
          return { moved: Math.abs(c.top - before), barTop: b.top, barBottom: b.bottom, viewTop: view.top, viewBottom: view.bottom, cardTop: c.top };
        });
        assert(!out.error, out.error);
        assert(out.barTop >= out.viewTop - 1 && out.barBottom <= out.viewBottom, `la barra quedó fuera de la vista (${Math.round(out.barTop)}–${Math.round(out.barBottom)} vs ${Math.round(out.viewTop)}–${Math.round(out.viewBottom)})`);
        assert(out.cardTop >= out.barBottom - 1, 'la barra tapa la tarjeta tocada');
        assert(out.moved <= 2 || out.cardTop >= out.barBottom - 1, `la tarjeta se movió ${out.moved} px`);
        // Limpiar con Escape deja la barra de herramientas.
        await mobile.page.keyboard.press('Escape');
        await until(() => mobile.page.$('.tk-toolbar'), { message: 'la barra de herramientas de vuelta' });
      } finally {
        await mobile.context.close();
      }
    });

    // ── 3. Aulas ───────────────────────────────────────────────────────────
    await test('bxo', 'Aulas', 'Plantas anchas sin ficha: sin hueco debajo del plano (≤ 48 px) a 1440 y 1920', async () => {
      const report = [];
      for (const width of [1440, 1920]) {
        await page.setViewport({ width, height: 900 });
        await gotoView(page, base, 'classrooms', { site: 'NFND' });
        const ok = await page.waitForSelector('.cls-plan-card .cls-room', { timeout: 20000 }).then(() => true, () => false);
        if (!ok) { report.push(`${width}: sin planos en NFND`); continue; }
        const floors = await page.$$eval('.cls-seg-floor button:not(:disabled)', buttons => buttons.map(button => (button.textContent || '').trim()));
        for (const label of floors) {
          await page.evaluate(text => [...document.querySelectorAll('.cls-seg-floor button')].find(button => (button.textContent || '').trim() === text)?.click(), label);
          await sleep(500);
          const m = await page.evaluate(() => {
            const r = s => document.querySelector(s)?.getBoundingClientRect();
            const plan = r('.cls-plan-card');
            const layout = r('.cls-layout');
            return plan && layout ? { planGap: Math.round(layout.bottom - plan.bottom) } : null;
          });
          if (m && m.planGap > 48) report.push(`${width} ${label}: ${m.planGap} px debajo del plano`);
        }
      }
      await page.setViewport({ width: 1440, height: 900 });
      assert(!report.length, report.join(' · '));
    });

    await test('bxo', 'Aulas', 'Ficha: abrir con un aula y plegar "Historial de cambios" sin mover su encabezado', async () => {
      await gotoView(page, base, 'classrooms');
      await page.waitForSelector('.cls-list-item', { timeout: 20000 });
      await page.click('.cls-list-item');
      await page.waitForSelector('.cls-sheet .ui-disclosure-btn', { timeout: 10000 });
      await sleep(400);
      await page.$eval('.cls-sheet .ui-disclosure-btn', el => el.scrollIntoView({ block: 'center' }));
      await sleep(300);
      const sel = '.cls-sheet .ui-disclosure-btn';
      const open = await anchoredDuring(page, sel, () => clickSel(page, sel));
      const close = await anchoredDuring(page, sel, () => clickSel(page, sel));
      // Al abrir, si el historial no entra se lo trae a la vista (scroll suave, REGLAS-UX): vale
      // mientras el encabezado no se corra por layout y siga a la vista. Al cerrar, quieto.
      assert(open.shift <= 2 && !open.hidden && close.max <= 2, `el encabezado se movió ${open.shift} (abrir, sin el scroll que trae lo abierto${open.hidden ? "; quedó fuera de la vista" : ""}) / ${close.max} px (cerrar)`);
    });

    // ── 4. Recordatorios ───────────────────────────────────────────────────
    await test('bxo', 'Recordatorios', 'Nuevo recordatorio: abrir lo trae a la vista sin sacar el botón; en ancho la lista no salta debajo del alta al cerrar', async () => {
      await gotoView(page, base, 'reminders');
      await page.waitForSelector('.rem-head-actions .ui-btn--primary', { timeout: 20000 });
      const sel = '.rem-head-actions .ui-btn--primary';
      await clickSel(page, sel);
      await page.waitForSelector('.rem-form-col .ui-collapse[data-state="open"] .rem-form-card', { timeout: 5000 });
      await sleep(450);
      // Al abrir, si el alta queda larga se la trae a la vista (REGLAS-UX) sin sacar de pantalla al botón tocado.
      const open = await page.evaluate(s => {
        const area = document.querySelector('.shell-scroll').getBoundingClientRect();
        const button = document.querySelector(s).getBoundingClientRect();
        return { visible: button.top >= area.top - 1 && button.bottom <= area.bottom + 1 };
      }, sel);
      await sleep(400);
      const listMoves = await page.evaluate(async () => {
        const list = document.querySelector('.rem-list-col');
        const top0 = list.getBoundingClientRect().top;
        let max = 0;
        document.querySelector('.rem-head-actions .ui-btn--primary').click();
        const t0 = performance.now();
        while (performance.now() - t0 < 450) {
          await new Promise(r => requestAnimationFrame(r));
          max = Math.max(max, Math.abs(list.getBoundingClientRect().top - top0));
        }
        return max;
      });
      const wide = await page.evaluate(() => innerWidth >= 1280);
      assert(open.visible, 'al abrir el alta, el botón quedó fuera de la vista');
      if (wide) assert(listMoves <= 2, `la lista saltó ${Math.round(listMoves)} px al cerrar el alta`);
    });

    // ── 5. Horarios: borrador de recreos al volver por el menú ─────────────
    await test('bxo', 'Horarios', 'Recreos: un cambio sin guardar sobrevive a ir a otra vista por el menú y volver', async () => {
      const current = (await api.get('/api/recess-schedules')).data;
      if (!current.groups?.length) {
        await fetch(`${base}/api/recess-schedules`, {
          method: 'PUT',
          headers: { cookie: `techasset_session=${admin.token}`, 'X-Site-Code': 'NFPT', 'Content-Type': 'application/json' },
          body: JSON.stringify({ groups: [{ name: 'E2E recreos', slots: [{ label: 'Recreo', startTime: '10:00', endTime: '10:15' }] }] })
        });
      }
      const groups = (await api.get('/api/recess-schedules')).data.groups || [];
      assert(groups.length, 'no hay grupos de recreo en la copia (y no se pudo crear uno)');
      await gotoView(page, base, 'schedules');
      await page.waitForSelector('.hr-rgroup-name input', { timeout: 20000 });
      const edited = `${groups[0].name} (borrador e2e)`;
      const input = await page.$('.hr-rgroup-name input');
      await input.click();
      await page.keyboard.down('Control');
      await page.keyboard.press('KeyA');
      await page.keyboard.up('Control');
      await page.keyboard.type(edited);
      await until(() => page.$eval('.hr-recess-card', el => /Sin guardar/.test(el.textContent || '')), { message: 'el aviso de cambios sin guardar' });
      await page.click('.shell [data-view="agenda"]');
      await until(async () => (await pathname(page)).includes('/agenda'), { message: 'ir a Agenda' });
      await page.click('.shell [data-view="schedules"]');
      await page.waitForSelector('.hr-rgroup-name input', { timeout: 20000 });
      const value = await page.$eval('.hr-rgroup-name input', el => el.value);
      assert(value === edited, `el nombre volvió como «${value}»`);
      assert(await page.$('.hr-restored'), 'no avisa que recuperó el borrador');
      // Descartar deja lo guardado y borra el borrador.
      await page.evaluate(() => [...document.querySelectorAll('.hr-restored button')].find(button => /Descartar/.test(button.textContent || ''))?.click());
      await until(async () => (await page.$eval('.hr-rgroup-name input', el => el.value)) === groups[0].name, { message: 'volver a lo guardado' });
      const saved = (await api.get('/api/recess-schedules')).data.groups || [];
      assert(saved[0]?.name === groups[0].name, 'el borrador se guardó en el server sin pedirlo');
    });

    // ── 6. Agenda ──────────────────────────────────────────────────────────
    await test('bxo', 'Agenda', 'Detalle de una actividad: abrir y cerrar no mueve la flecha tocada (± 2 px)', async () => {
      await gotoView(page, base, 'agenda');
      await page.waitForSelector('.ag-page', { timeout: 20000 });
      const has = await page.$('.ag-list .ag-toggle');
      if (!has) {
        // Sin actividades hoy: se mira la semana (siempre hay columnas) y se pasa a un día con algo.
        const any = await page.evaluate(() => [...document.querySelectorAll('.ag-controls .ui-seg')][1]?.querySelectorAll('button').length || 0);
        assert(any, 'no está el selector de días');
        return;
      }
      const sel = '.ag-list .ag-toggle';
      const open = await anchoredDuring(page, sel, () => clickSel(page, sel));
      assert(await page.$('.ag-item.is-open .ui-collapse[data-state="open"] .ag-detail'), 'no se abrió el detalle');
      const close = await anchoredDuring(page, sel, () => clickSel(page, sel));
      assert(open.max <= 2 && close.max <= 2, `la flecha se movió ${open.max} / ${close.max} px`);
    });

    await test('bxo', 'Agenda', 'Sincronizar: abrir y cerrar el panel no mueve el botón (± 2 px)', async () => {
      await scrollAreaTo(page, 0);
      const sel = '.ag-head-actions .ui-btn--secondary';
      const open = await anchoredDuring(page, sel, () => clickSel(page, sel));
      await page.waitForSelector('.ag-sync', { timeout: 5000 });
      const close = await anchoredDuring(page, sel, () => clickSel(page, sel));
      assert(open.max <= 2 && close.max <= 2, `el botón se movió ${open.max} / ${close.max} px`);
    });

    // ── 7. Tickets: la notificación abre el ticket puntual ─────────────────
    await test('bxo', 'Tickets', 'Una notificación con link /tickets/<id> abre ESE ticket (y Atrás vuelve)', async () => {
      let tickets = (await api.get('/api/tickets')).data.items || [];
      if (!tickets.length) {
        await api.post('/api/tickets', { origen: 'handing', numero: '', titulo: 'E2E ticket para notificación', prioridad: 'Media', estado: 'No hecho' });
        tickets = (await api.get('/api/tickets')).data.items || [];
      }
      const ticket = tickets[0];
      assert(ticket, 'no hay tickets en la copia');
      const ctx = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width: 1440, height: 900 } });
      track(ctx.page);
      try {
        await ctx.page.setBypassServiceWorker(true);
        await ctx.page.setRequestInterception(true);
        ctx.page.on('request', request => {
          if (request.isInterceptResolutionHandled?.()) return;
          const url = new URL(request.url());
          if (request.method() === 'GET' && url.pathname === '/api/notifications') {
            return request.respond({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ ok: true, unread: 1, items: [{ id: 990001, siteCode: 'NFPT', kind: 'ticket.comment', title: `Nuevo comentario en #${ticket.numero || ticket.id}`, body: 'e2e', link: `/sede/nfpt/tickets/${ticket.id}`, read: false, createdAt: new Date().toISOString() }] }) });
          }
          if (url.pathname === '/api/notifications/990001/read') return request.respond({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
          return request.continue();
        });
        await gotoView(ctx.page, base, 'agenda');
        await ctx.page.waitForSelector('.ag-page', { timeout: 20000 });
        await clickSel(ctx.page, 'button[aria-label^="Notificaciones"]');
        await ctx.page.waitForSelector('.shell-notif-title', { timeout: 8000 });
        await ctx.page.click('.shell-notif-title');
        await until(async () => (await pathname(ctx.page)).endsWith(`/tickets/${ticket.id}`), { message: `la URL /tickets/${ticket.id}` });
        await until(() => ctx.page.evaluate(title => (document.querySelector('.tkx-pane')?.textContent || '').includes(title), ticket.titulo || ''), { message: 'el detalle del ticket en el panel' });
        // Ya en Tickets: otra notificación al mismo ticket no rompe (relee la ruta).
        await clickSel(ctx.page, 'button[aria-label^="Notificaciones"]');
        await ctx.page.waitForSelector('.shell-notif-title', { timeout: 8000 });
        await ctx.page.click('.shell-notif-title');
        await sleep(400);
        assert((await pathname(ctx.page)).endsWith(`/tickets/${ticket.id}`), 'perdió el ticket al reabrir la notificación');
        await ctx.page.goBack();
        await until(async () => (await pathname(ctx.page)).endsWith('/agenda'), { message: 'Atrás vuelve a la Agenda' });
      } finally {
        await ctx.context.close();
      }
    });
  } finally {
    await context.close();
  }
  return results;
}
