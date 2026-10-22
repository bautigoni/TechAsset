// qae) QA de lanzamiento, frente E (docs/redesign/qa/HALLAZGOS-1.md, ítems 23,
// 24, 25 y textos del 26): Agenda, Tareas y Estado de aulas.
//
//   - Agenda: turnos sin ambigüedad ("Turno mañana", nunca "Mañana" suelto),
//     la cabecera cuenta lo mismo que los filtros (Día y Semana), entregar y
//     retirar son acciones explícitas con Deshacer en la línea de estado de la
//     cabecera (verificado por API), un doble toque no encadena "entregar" con
//     "retirar", y en el celu la Semana muestra actividades en el primer
//     pantallazo.
//   - Tareas: el "+" dice "Tarea del grupo · Tarea privada · Columna nueva"
//     ("equipo" en la app es un dispositivo), la casilla de la tarjeta es de
//     SELECCIÓN (oculta hasta "Elegir", hover o foco; tocar en modo elegir
//     marca sin abrir), rótulos en la tarjeta y hora de 24 h en la ficha.
//   - Estado de aulas en una sede sin plano: vacío diseñado (qué falta, quién
//     lo carga, qué hacer), sin scroll horizontal ni problemas de la sonda.
// Todo corre contra la copia de la base (lo que se crea, se crea ahí).
import { SITE } from '../lib/env.mjs';
import { assert, findButton, gotoView, openContext, pathname, sleep, until } from '../lib/browser.mjs';
import { formatProbe, probeView, settle } from '../lib/ux-probe.mjs';

const todayAr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });

async function press(page, pattern, scope) {
  await until(async () => {
    const button = await findButton(page, pattern, { scope, includeDisabled: false });
    if (!button) return false;
    await button.click();
    return true;
  }, { message: `el botón ${pattern}` });
}

/** Los números de la cabecera y de los conteos que filtran ("Actividades N", "Pendientes N"). */
const readCounts = page => page.evaluate(() => {
  const head = document.querySelector('.ag-head-text .ag-head-sub')?.textContent.replace(/\s+/g, ' ').trim() || '';
  const kpi = label => {
    const chip = [...document.querySelectorAll('.ag-kpi')].find(node => node.querySelector('.ag-kpi-label')?.textContent.trim() === label);
    return chip ? Number(chip.querySelector('.ag-kpi-n').textContent) : NaN;
  };
  const m = /^(\d+) actividad(?:es)? .*· (\d+) pendientes?$/.exec(head);
  return { head, total: m ? Number(m[1]) : NaN, pend: m ? Number(m[2]) : NaN, kpiTotal: kpi('Actividades'), kpiPend: kpi('Pendientes') };
});

export async function qaETests({ browser, base, api, admin, releaseVersion, test, track = () => {} }) {
  const tag = String(Date.now()).slice(-5);
  const today = todayAr();
  const created = { agenda: [], tasks: [] };

  // ── Agenda ───────────────────────────────────────────────────────────────
  const desk = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width: 1366, height: 900 } });
  track(desk.page);
  const page = desk.page;
  try {
    const mk = async body => {
      const response = await api.post('/api/agenda', { tipoDispositivo: 'Dell', cantidad: 2, ubicacion: 'Laboratorio', estado: 'Pendiente', actividad: 'QAE', ...body });
      const item = response.data.item || response.data;
      assert(item?.id, `no se pudo crear la actividad: ${JSON.stringify(response.data).slice(0, 200)}`);
      created.agenda.push(item.id);
      return item;
    };
    const today1 = await mk({ fecha: today, dia: '', turno: 'Mañana', desde: '07:00', hasta: '07:20', curso: `QAE ${tag} A` });
    await mk({ dia: 'Lunes', turno: 'Tarde', desde: '13:00', hasta: '13:20', curso: `QAE ${tag} L` });
    const read = async id => ((await api.get('/api/agenda?all=1')).data.items || []).find(item => item.id === id);

    await test('qae', 'Agenda', 'Turnos sin ambigüedad y la cabecera cuenta lo mismo que los filtros (Día y Semana)', async () => {
      await gotoView(page, base, 'agenda');
      await page.waitForSelector('.ag-list .ag-row', { timeout: 20000 });
      await settle(page);
      const labels = await page.evaluate(() => ({
        turnos: [...document.querySelectorAll('.ag-filters-body .ui-seg-item')].map(node => node.textContent.trim()),
        groups: [...document.querySelectorAll('.ag-group .ui-eyebrow')].map(node => node.textContent.trim()),
        toggles: [...document.querySelectorAll('.ag-list .ag-row-act button')].map(node => node.textContent.trim())
      }));
      assert(labels.turnos.join('|') === 'Todo el día|Turno mañana|Turno tarde', `turnos: ${labels.turnos.join(', ')}`);
      assert(labels.groups.every(label => !/^(mañana|tarde)$/i.test(label)), `grupo con "Mañana" suelto: ${labels.groups.join(', ')}`);
      assert(!labels.toggles.some(text => /^(Entregado|Entregar|Retirar|Retiradas)$/.test(text)), `botones de la fila ambiguos: ${labels.toggles.join(', ')}`);
      const day = await readCounts(page);
      assert(day.total === day.kpiTotal && day.pend === day.kpiPend, `Día: cabecera «${day.head}» vs filtros ${day.kpiTotal}/${day.kpiPend}`);
      await press(page, /^Semana$/, '.ag-controls');
      await page.waitForSelector('.ag-week .ag-wk-item', { timeout: 5000 });
      await sleep(400);
      const week = await readCounts(page);
      assert(/en la semana/.test(week.head), `la cabecera no dice que cuenta la semana: «${week.head}»`);
      assert(week.total === week.kpiTotal && week.pend === week.kpiPend, `Semana: cabecera «${week.head}» vs filtros ${week.kpiTotal}/${week.kpiPend}`);
      const sync = await page.evaluate(() => [...document.querySelectorAll('.ag-head-actions button')].map(node => node.textContent.trim()));
      assert(!sync.includes('Sincronizar'), `sigue "Sincronizar" junto a "Actualizar": ${sync.join(', ')}`);
      return `Día «${day.head}» · Semana «${week.head}»`;
    });

    await test('qae', 'Agenda', 'Entregar y retirar: acción explícita con Deshacer en la línea de estado; doble toque = una sola acción', async () => {
      await gotoView(page, base, 'agenda');
      const row = `.ag-list [data-agenda-id="${today1.id}"]`;
      await page.waitForSelector(`${row} .ag-quick`, { timeout: 20000 });
      await settle(page);
      const label = await page.$eval(`${row} .ag-quick`, node => node.textContent.trim());
      assert(label === 'Marcar entregados', `botón de la fila: «${label}»`);
      // Doble click: la primera entrega; la segunda (ya es "Marcar retirados" en el mismo lugar) no tiene que retirar.
      await page.$eval(`${row} .ag-quick`, node => node.click());
      await sleep(60);
      await page.evaluate(sel => document.querySelector(sel)?.click(), `${row} .ag-quick`);
      const delivered = await until(async () => { const item = await read(today1.id); return item?.estado === 'Entregado' ? item : null; }, { message: 'la actividad entregada en la base' });
      await sleep(600);
      const again = await read(today1.id);
      assert(Number(again.compusRetiradas || 0) === 0, `el doble toque también retiró los equipos (${again.compusRetiradas})`);
      const line = await until(() => page.evaluate(() => document.querySelector('.shell-status')?.textContent || ''), { message: 'la línea de estado de la cabecera' });
      assert(/entregados/.test(line) && /Deshacer/.test(line), `línea de estado: «${line}»`);
      const rowText = await page.$eval(row, node => node.textContent.replace(/\s+/g, ' '));
      assert(/Falta retirar/.test(rowText) && /Marcar retirados/.test(rowText), `la fila no dice qué falta: «${rowText}»`);
      await press(page, /^Deshacer$/, '.shell-status');
      await until(async () => (await read(today1.id))?.estado === 'Pendiente', { message: 'Deshacer vuelve a pendiente' });
      // Retirar: entregar, retirar, Deshacer.
      await page.waitForSelector(`${row} .ag-quick`);
      await sleep(1000);
      await page.$eval(`${row} .ag-quick`, node => node.click());
      await until(async () => (await read(today1.id))?.estado === 'Entregado', { message: 'entregada de nuevo' });
      await sleep(1000);
      await until(async () => (await page.$eval(`${row} .ag-quick`, node => node.textContent.trim()).catch(() => '')) === 'Marcar retirados', { message: 'el botón Marcar retirados' });
      await page.$eval(`${row} .ag-quick`, node => node.click());
      await until(async () => Number((await read(today1.id))?.compusRetiradas || 0) === 2, { message: 'retirados en la base' });
      await until(async () => /retirados del aula/.test(await page.evaluate(() => document.querySelector('.shell-status')?.textContent || '')), { message: 'la línea de retirados' });
      await until(async () => !(await page.$(`${row} .ag-quick`)), { message: 'sin botón cuando ya está todo retirado' });
      await press(page, /^Deshacer$/, '.shell-status');
      await until(async () => Number((await read(today1.id))?.compusRetiradas || 0) === 0, { message: 'Deshacer el retiro' });
      return `entregada ${delivered.estado}, retiro deshecho`;
    });
  } finally {
    await desk.context.close();
  }

  await test('qae', 'Agenda', 'Celu (375 px): la Semana muestra actividades en el primer pantallazo, sin scroll horizontal', async () => {
    const mobile = await openContext(browser, { base, token: admin.token, releaseVersion, device: { viewport: { width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }, userAgent: 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36' } });
    track(mobile.page);
    try {
      await gotoView(mobile.page, base, 'agenda');
      await mobile.page.waitForSelector('.ag-controls .ui-seg', { timeout: 20000 });
      await settle(mobile.page);
      await press(mobile.page, /^Semana$/, '.ag-controls');
      await mobile.page.waitForSelector('.ag-week .ag-wk-item', { timeout: 5000 });
      await sleep(500);
      const out = await mobile.page.evaluate(() => {
        const nav = document.querySelector('.shell-tabbar');
        const bottom = nav ? nav.getBoundingClientRect().top : innerHeight;
        const card = document.querySelector('.ag-week .ag-wk-item .ag-wk-card').getBoundingClientRect();
        return { top: Math.round(card.top), bottom: Math.round(card.bottom), limit: Math.round(bottom), sx: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      assert(out.bottom <= out.limit, `la primera actividad recién empieza en ${out.top}–${out.bottom} px (se ve hasta ${out.limit})`);
      assert(out.sx <= 0, `scroll horizontal de ${out.sx} px`);
      return `primera actividad ${out.top}–${out.bottom} px de ${out.limit}`;
    } finally {
      await mobile.context.close();
    }
  });

  // ── Tareas ───────────────────────────────────────────────────────────────
  const tctx = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width: 1366, height: 900 } });
  track(tctx.page);
  const tp = tctx.page;
  try {
    const columns = (await api.get('/api/task-columns')).data.items || [];
    const first = columns[0];
    for (const n of [1, 2]) {
      const response = await api.post('/api/tasks', { titulo: `QAE ${tag} tarea ${n}`, responsables: ['QAE'], prioridad: 'Baja', turno: 'Todo el día', tipo: 'Soporte', columnId: first?.id, estado: first?.name });
      const id = response.data.item?.id || response.data.id;
      if (id) created.tasks.push(id);
    }
    assert(created.tasks.length === 2, 'no se pudieron crear las tareas de prueba');

    await test('qae', 'Tareas', '"+" sin "Equipo" (Tarea del grupo · privada · columna) y la tarjeta con rótulos', async () => {
      await gotoView(tp, base, 'tasks');
      await tp.waitForSelector(`.tk-card[data-task-id="${created.tasks[0]}"]`, { timeout: 20000 });
      await settle(tp);
      const tabs = await tp.evaluate(() => [...document.querySelectorAll('.tk-tb-segs button')].map(node => node.textContent.replace(/\d+/g, '').trim()));
      assert(tabs.includes('Grupo') && !tabs.includes('Equipo'), `espacios: ${tabs.join(', ')}`);
      await tp.click('.t-goo-main');
      await sleep(600);
      const goo = await tp.evaluate(() => ({ items: [...document.querySelectorAll('.t-goo-item')].map(node => node.getAttribute('aria-label')), caption: document.querySelector('.t-goo-caption')?.textContent || '' }));
      assert(goo.items.join('|') === 'Nueva tarea del grupo|Nueva tarea privada|Nueva columna', `satélites: ${goo.items.join(', ')}`);
      assert(/Tarea del grupo/.test(goo.caption) && !/Equipo/.test(goo.caption), `rótulo: «${goo.caption}»`);
      await tp.keyboard.press('Escape');
      await sleep(400);
      const meta = await tp.$eval(`.tk-card[data-task-id="${created.tasks[0]}"] .tk-card-meta`, node => node.textContent.replace(/\s+/g, ' '));
      assert(/Prioridad baja/.test(meta) && /Ambos turnos/.test(meta) && !/Todo el día/.test(meta), `meta: «${meta}»`);
      return `${goo.caption} · ${meta.trim()}`;
    });

    await test('qae', 'Tareas', 'La casilla es de selección: oculta en reposo, "Elegir" la muestra y tocar la tarjeta marca sin abrir', async () => {
      await gotoView(tp, base, 'tasks');
      const card = `.tk-card[data-task-id="${created.tasks[0]}"]`;
      await tp.waitForSelector(card, { timeout: 20000 });
      await settle(tp);
      await tp.mouse.move(2, 2);
      await sleep(300);
      const rest = await tp.$eval(`${card} .tk-card-check`, node => ({ vis: getComputedStyle(node).visibility, label: node.getAttribute('aria-label') }));
      assert(rest.vis === 'hidden', `en reposo la casilla se ve (${rest.vis}) y parece "completar"`);
      assert(/^Seleccionar /.test(rest.label || ''), `nombre accesible: «${rest.label}»`);
      const box = await (await tp.$(card)).boundingBox();
      await tp.mouse.move(box.x + box.width / 2, box.y + box.height - 8);
      await sleep(300);
      const hover = await tp.$eval(`${card} .tk-card-check`, node => getComputedStyle(node).visibility);
      assert(hover === 'visible', 'con el mouse encima la casilla no aparece');
      const titleBefore = await tp.$eval(`${card} .tk-card-title`, node => node.getBoundingClientRect().left);
      await press(tp, /^Elegir$/, '.tk-board-head');
      await tp.waitForSelector('.tk-selbar', { timeout: 4000 });
      const bar = await tp.$eval('.tk-selbar', node => node.textContent);
      assert(/Tocá las tareas/.test(bar) && /Cancelar/.test(bar), `barra al elegir: «${bar}»`);
      await tp.click(`${card} .tk-card-desc, ${card} .tk-card-meta`);
      await sleep(400);
      assert((await pathname(tp)).toLowerCase().endsWith('/tasks'), 'tocar la tarjeta eligiendo la abrió');
      const after = await tp.evaluate(sel => ({ checked: document.querySelector(`${sel} .tk-card-check`).getAttribute('aria-checked'), bar: document.querySelector('.tk-selbar')?.textContent || '', left: document.querySelector(`${sel} .tk-card-title`).getBoundingClientRect().left }), card);
      assert(after.checked === 'true' && /1 seleccionada/.test(after.bar) && /Quitar selección/.test(after.bar), `después de tocar: ${JSON.stringify(after)}`);
      assert(Math.abs(after.left - titleBefore) < 1, 'el título se corrió al aparecer la casilla');
      await tp.keyboard.press('Escape');
      await until(() => tp.$('.tk-toolbar'), { message: 'Esc sale de elegir' });
      const back = await tp.$eval(`${card} .tk-card-check`, node => node.getAttribute('aria-checked'));
      assert(back === 'false', 'Esc no quitó la selección');
      return 'oculta → Elegir → marcada sin abrir → Esc';
    });

    await test('qae', 'Tareas', 'Celu (375 px): "Elegir" a la vista en la barra; tocar una tarjeta la marca sin abrirla', async () => {
      const mobile = await openContext(browser, { base, token: admin.token, releaseVersion, device: { viewport: { width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }, userAgent: 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36' } });
      track(mobile.page);
      try {
        const mp = mobile.page;
        await gotoView(mp, base, 'tasks');
        await mp.waitForSelector('.tk-card', { timeout: 20000 });
        await settle(mp);
        const pick = await mp.evaluate(() => {
          const button = [...document.querySelectorAll('.tk-toolbar button')].find(node => node.textContent.trim() === 'Elegir');
          if (!button) return null;
          const r = button.getBoundingClientRect();
          return { w: r.width, h: r.height, right: r.right, vw: innerWidth };
        });
        assert(pick && pick.w > 0 && pick.h >= 32 && pick.right <= pick.vw, `"Elegir" no está a la vista en el celu: ${JSON.stringify(pick)}`);
        const rest = await mp.$eval('.tk-card .tk-card-check', node => getComputedStyle(node).visibility);
        assert(rest === 'hidden', 'en el celu la casilla se ve en reposo');
        await press(mp, /^Elegir$/, '.tk-toolbar');
        await mp.waitForSelector('.tk-selbar', { timeout: 4000 });
        await mp.tap('.tk-card .tk-card-meta');
        await sleep(400);
        assert((await pathname(mp)).toLowerCase().endsWith('/tasks'), 'tocar la tarjeta eligiendo la abrió');
        const bar = await mp.$eval('.tk-selbar', node => node.textContent);
        assert(/1 seleccionada/.test(bar) && /Quitar selección/.test(bar), `barra: «${bar}»`);
        const sx = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert(sx <= 0, `scroll horizontal de ${sx} px`);
        await press(mp, /^Quitar selección$/, '.tk-selbar');
        await until(() => mp.$('.tk-toolbar'), { message: 'Quitar selección vuelve a la barra' });
        return `Elegir ${Math.round(pick.w)}×${Math.round(pick.h)} px`;
      } finally {
        await mobile.context.close();
      }
    });

    await test('qae', 'Tareas', 'Ficha de la tarea con hora de 24 h (nunca "a. m." / "p. m.")', async () => {
      await gotoView(tp, base, `tasks/${created.tasks[0]}`);
      await tp.waitForSelector('.tk-detail', { timeout: 20000 });
      await settle(tp);
      const text = await tp.$eval('.tk-detail', node => node.textContent.replace(/\s+/g, ' '));
      assert(!/[ap]\.\s?m\./i.test(text), `la ficha tiene hora de 12 h: «${(/.{20}[ap]\.\s?m\..{0,4}/i.exec(text) || [''])[0]}»`);
      assert(/\d{2}:\d{2}/.test(text), 'la ficha no muestra la hora');
      return (/\d{1,2}\/\d{1,2}\/\d{2}, \d{2}:\d{2}/.exec(text) || [''])[0];
    });
  } finally {
    await tctx.context.close();
  }

  // ── Estado de aulas en una sede sin plano ────────────────────────────────
  await test('qae', 'Aulas', 'Sede sin plano: vacío que explica qué falta y quién lo carga (375 y 1366, sonda UX en 0)', async () => {
    const code = `QE${tag.slice(-3)}`;
    const site = await api.post('/api/sites', { siteCode: code, nombre: `Sede QAE ${tag}` });
    assert(site.status === 200, `no se pudo crear la sede: ${JSON.stringify(site.data).slice(0, 200)}`);
    const out = [];
    for (const viewport of [{ width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }, { width: 1366, height: 900 }]) {
      const ctx = await openContext(browser, { base, token: admin.token, releaseVersion, viewport });
      track(ctx.page);
      try {
        await ctx.page.evaluateOnNewDocument(siteCode => { try { localStorage.setItem('techasset_active_site', siteCode); sessionStorage.setItem('techasset_active_site', siteCode); } catch { /* sin storage */ } }, code);
        await gotoView(ctx.page, base, 'classrooms', { site: code });
        await ctx.page.waitForSelector('.cls-noplan', { timeout: 20000 });
        await settle(ctx.page);
        const info = await ctx.page.evaluate(() => ({
          title: document.querySelector('.cls-noplan-title')?.textContent || '',
          text: document.querySelector('.cls-noplan')?.textContent || '',
          buttons: [...document.querySelectorAll('.cls-noplan-actions button')].map(node => node.textContent.trim()),
          sx: document.documentElement.scrollWidth - document.documentElement.clientWidth
        }));
        assert(/todavía no tiene el plano/.test(info.title), `título: «${info.title}»`);
        assert(/Quién lo carga/.test(info.text) && /Jefe TIC/.test(info.text), 'no dice quién carga el plano');
        assert(info.buttons.includes('Ir a Tickets'), `acciones: ${info.buttons.join(', ')}`);
        assert(info.sx <= 0, `scroll horizontal de ${info.sx} px`);
        const probe = await probeView(ctx.page, { scope: '.cls' });
        assert(!probe.total, formatProbe(probe));
        out.push(`${viewport.width}: ${info.buttons.length} acciones`);
      } finally {
        await ctx.context.close();
      }
    }
    // Sin dejar la sede activa para el resto de las pruebas.
    await api.patch(`/api/sites/${code}`, { activo: false });
    return out.join(' · ');
  });

  // Limpieza en la copia.
  for (const id of created.agenda) await api.del(`/api/agenda/${id}`);
  for (const id of created.tasks) await api.del(`/api/tasks/${id}`);
  return { site: SITE };
}
