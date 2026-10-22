// an) Analítica (etapa 8a): índice que marca la sección, carga diferida sin
// saltos, valor exacto en línea, Gráfico/Tabla sin mover el encabezado,
// Recargar que también pide el parque (sin caché y sin duplicar), período,
// error con Reintentar y la respuesta nueva del server (sin `events`).
import { assert, gotoView, openContext, sleep, until } from '../lib/browser.mjs';
import { revisionUx8Tests } from './revisionUx8.mjs';

async function openAnalytics(page, base) {
  await gotoView(page, base, 'analytics');
  await page.waitForSelector('.an-page', { timeout: 20000 });
  await until(() => page.evaluate(() => !document.querySelector('.an-body[aria-busy="true"]') && Boolean(document.querySelector('.an-heat, .an-ghost'))), { timeout: 20000, message: 'la analítica cargada' });
}

const clickText = (page, selector, rx) => until(() => page.evaluate((sel, src, flags) => {
  const re = new RegExp(src, flags);
  const el = [...document.querySelectorAll(sel)].find(node => re.test((node.textContent || '').replace(/\s+/g, ' ').trim()) && !node.disabled);
  if (!el) return false;
  el.click();
  return true;
}, selector, rx.source, rx.flags), { message: `${selector} ${rx}` });

export async function analyticsTests({ browser, base, api, admin, releaseVersion, test, track = () => {} }) {
  const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion });
  track(page);
  await page.setBypassServiceWorker(true);
  await page.evaluateOnNewDocument(() => {
    window.__shift = 0;
    try { new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__shift += entry.value; }).observe({ type: 'layout-shift', buffered: true }); } catch { /* sin soporte */ }
  });
  const calls = [];
  page.on('request', request => { if (request.url().includes('/api/analytics')) calls.push(request.url()); });

  try {
    await test('an', 'Analítica', 'El server da los datos nuevos (duración, tipo × hora, período anterior, operadores) sin `events`', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { status, data } = await api.get(`/api/analytics?from=2000-01-01&to=${today}`);
      const s = data.summary;
      assert(status === 200 && !('events' in data), `status ${status}, events: ${'events' in data}`);
      assert(s.hourWeekday.length === 7 && s.hourWeekday.every(row => row.length === 24), 'hourWeekday no es 7×24');
      assert(Array.isArray(s.byTypeHour) && Array.isArray(s.byOperatorSplit) && Array.isArray(s.byPersonGrouped), 'faltan series nuevas');
      assert(s.durations && s.durations.buckets.length === 6, 'falta la duración por préstamo');
      assert(s.evolution && s.evolution.points.length > 0, 'falta la evolución densa');
      return `${s.totalPrestamos} préstamos · ${s.durations.count} duraciones · ${s.evolution.granularity}`;
    });

    await test('an', 'Analítica', 'Índice fijo lleva a la sección y la marca; los gráficos de abajo se dibujan al llegar sin saltos', async () => {
      await openAnalytics(page, base);
      const deferred = await page.evaluate(() => document.querySelectorAll('.an-lazy .an-skel').length);
      const shiftBefore = await page.evaluate(() => window.__shift);
      await clickText(page, '.an-index-link', /Parque/);
      // Antes de viajar se arman todas las secciones (con más datos, en una
      // corrida completa, tarda más): se espera a que el viaje termine (la
      // sección quieta) en vez de mirar a un tiempo fijo.
      await until(async () => {
        const a = await page.evaluate(() => Math.round(document.getElementById('an-par').getBoundingClientRect().top));
        await sleep(200);
        const b = await page.evaluate(() => Math.round(document.getElementById('an-par').getBoundingClientRect().top));
        return a === b && b < 400;
      }, { timeout: 6000, message: 'que el índice termine de llevar a Parque' }).catch(() => {});
      await sleep(300);
      const state = await page.evaluate(() => ({
        top: document.getElementById('an-par').getBoundingClientRect().top,
        indexBottom: document.querySelector('.an-index').getBoundingClientRect().bottom,
        current: document.querySelector('.an-index-link.is-on')?.textContent || '',
        focus: document.activeElement?.id
      }));
      assert(/Parque/.test(state.current), `el índice marca "${state.current}"`);
      assert(state.top >= state.indexBottom - 1 && state.top - state.indexBottom < 24, `la sección quedó en ${state.top} (índice hasta ${state.indexBottom})`);
      assert(state.focus === 'an-par-h', `foco en ${state.focus}`);
      await page.evaluate(() => { const scroller = document.querySelector('.shell-scroll'); scroller.scrollTop = scroller.scrollHeight; });
      await sleep(900);
      const shift = (await page.evaluate(() => window.__shift)) - shiftBefore;
      const current = await page.evaluate(() => document.querySelector('.an-index-link.is-on')?.textContent || '');
      assert(/Equipo/.test(current), `al final el índice marca "${current}"`);
      // Umbral "bueno" de Web Vitals (CLS < 0,1); en la práctica da 0 o casi 0.
      assert(shift < 0.1, `saltos de layout: ${shift.toFixed(4)}`);
      return `${deferred} gráficos diferidos · CLS ${shift.toFixed(4)}`;
    });

    await test('an', 'Analítica', 'Valor exacto en línea al pasar/enfocar y Gráfico ↔ Tabla sin mover el encabezado', async () => {
      await page.evaluate(() => { document.querySelector('.shell-scroll').scrollTop = 0; });
      await sleep(300);
      const target = (await page.$('.an-hc.is-s7')) || (await page.$('.an-legend-row')) || (await page.$('.an-col'));
      assert(target, 'no hay nada interactivo en el gráfico');
      const card = await target.evaluateHandle(node => node.closest('.an-card, .an-heatcard'));
      const before = await card.evaluate(node => node.querySelector('.an-readout')?.textContent || '');
      await target.hover();
      await sleep(150);
      const after = await card.evaluate(node => node.querySelector('.an-readout')?.textContent || '');
      assert(before !== after, 'la línea de lectura no cambió');
      const panel = await page.$('.an-card [role="radiogroup"][aria-label="Cómo ver los datos"]');
      assert(panel, 'no hay selector Gráfico/Tabla');
      const title = await panel.evaluateHandle(node => node.closest('.an-card').querySelector('.an-card-title'));
      await title.evaluate(node => node.scrollIntoView({ block: 'center' }));
      const y1 = await title.evaluate(node => node.getBoundingClientRect().top);
      await panel.evaluate(node => [...node.querySelectorAll('[role="radio"]')].find(item => item.textContent === 'Tabla').click());
      await sleep(250);
      const y2 = await title.evaluate(node => node.getBoundingClientRect().top);
      const table = await panel.evaluate(node => Boolean(node.closest('.an-card').querySelector('[role="table"]')));
      assert(table && Math.abs(y1 - y2) < 1, `tabla ${table}, encabezado ${y1} → ${y2}`);
      return after.slice(0, 80);
    });

    await test('an', 'Analítica', 'Recargar pide analítica y parque sin caché, una sola vez con doble click; cambiar período recarga', async () => {
      await page.evaluate(() => { document.querySelector('.shell-scroll').scrollTop = 0; });
      calls.length = 0;
      await page.evaluate(() => { const button = [...document.querySelectorAll('.an-head button')].find(node => /Recargar/.test(node.textContent)); button.click(); button.click(); });
      await until(() => calls.some(url => url.includes('/api/analytics/parque')) && calls.some(url => url.includes('/api/analytics?')), { message: 'los dos pedidos' });
      await sleep(600);
      const analytics = calls.filter(url => url.includes('/api/analytics?')).length;
      assert(analytics === 1, `${analytics} pedidos de analítica con doble click`);
      calls.length = 0;
      await clickText(page, '.an-period [role="radio"]', /^Semana$/);
      await until(() => calls.some(url => /\/api\/analytics\?from=/.test(url)), { message: 'el pedido del período nuevo' });
      return 'ok';
    });

    await test('an', 'Analítica', 'Si el server falla: aviso con Reintentar y los datos anteriores siguen a la vista', async () => {
      await page.setRequestInterception(true);
      let fail = true;
      const handler = request => {
        if (fail && request.url().includes('/api/analytics?')) request.respond({ status: 500, contentType: 'application/json', body: '{"ok":false,"error":"Falla de prueba"}' });
        else request.continue();
      };
      page.on('request', handler);
      try {
        await clickText(page, '.an-period [role="radio"]', /^Mes$/);
        await until(() => page.evaluate(() => /Falla de prueba/.test(document.querySelector('.an-page .ui-error')?.textContent || '')), { message: 'el aviso de error' });
        const kept = await page.evaluate(() => Boolean(document.querySelector('.an-sec')));
        assert(kept, 'las secciones desaparecieron');
        fail = false;
        await clickText(page, '.an-page .ui-error button', /Reintentar/);
        // El aviso está en un Collapse (entra y sale con alto suave) y se desmonta al terminar de cerrar.
        await until(() => page.evaluate(() => !document.querySelector('.an-top-error')), { message: 'que se recupere' });
      } finally {
        page.off('request', handler);
        await page.setRequestInterception(false);
      }
      return 'ok';
    });
  } finally {
    await context.close();
  }
  // Revisión UX 8 (Analítica, Sugerencias y Caja chica): grupo propio `ux8`.
  await revisionUx8Tests({ browser, base, admin, releaseVersion, test, track });
}
