// hs) Historial — revisión UX 7 (20/10): nada cambia de alto de golpe al
// filtrar ni con "Cargar más", vecinos de la fila de filtros con la misma
// altura y alineados, filas-tarjeta sin renglones de "—", sonda UX en cero.
// Lo funcional del Historial (alias, CSV, resumen en línea) está en devices.mjs.
import { KnownDevices } from 'puppeteer-core';
import { assert, gotoView, openContext, sleep, until } from '../lib/browser.mjs';
import { formatProbe, probeView, setTheme, settle } from '../lib/ux-probe.mjs';
import { abruptChange, recordHeights, unevenNeighbors } from './uxFrames.mjs';

const BODY = '.hs-results-body';

async function openHistory(page, base) {
  await gotoView(page, base, 'history');
  await page.waitForSelector('.hs-list, .hs-results .ui-empty', { timeout: 20000 });
  await settle(page);
}

export async function historyTests({ browser, base, admin, releaseVersion, test, track = () => {} }) {
  const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width: 1440, height: 900 } });
  track(page);
  try {
    await test('hs', 'Historial', 'Filtrar (sin resultados y de vuelta), cambiar de pestaña y "Cargar más": el alto pasa suave, nunca en un cuadro', async () => {
      await openHistory(page, base);
      const search = await page.waitForSelector('.hs-search input');
      // Sin resultados: la lista larga se achica hasta el vacío, suave.
      const shrink = await recordHeights(page, BODY, async () => { await search.click(); await page.keyboard.type('zzzz-no-existe-e2e', { delay: 5 }); }, 1400);
      await page.waitForSelector(`${BODY} .ui-empty`);
      const bad1 = abruptChange(shrink);
      // Y de vuelta (Escape borra): crece suave.
      const grow = await recordHeights(page, BODY, async () => { await page.keyboard.press('Escape'); }, 1400);
      await page.waitForSelector(`${BODY} .hs-list`);
      const bad2 = abruptChange(grow);
      // Mientras carga no se cambia la lista por un esqueleto (queda lo anterior atenuado).
      const skeletonWhileStale = await page.$(`${BODY} .hs-skeleton`);
      // Pestaña: los filtros (sin "Tipo") y los resultados cambian de alto suave.
      const tab = await recordHeights(page, '.hs-results', async () => {
        await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].find(node => /Todos los movimientos/.test(node.textContent || ''))?.click());
      }, 1200);
      const bad3 = abruptChange(tab);
      await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].find(node => /^Préstamos$/.test((node.textContent || '').trim()))?.click());
      await page.waitForSelector(`${BODY} .hs-list--loans`, { timeout: 10000 });
      await settle(page);
      let more = '';
      const button = await page.evaluateHandle(() => [...document.querySelectorAll('.hs-foot button')].find(node => /Cargar más/.test(node.textContent || '')) || null);
      if (button.asElement()) {
        const before = await page.$$eval('.hs-item', nodes => nodes.length);
        const load = await recordHeights(page, BODY, async () => { await button.asElement().click(); }, 1200);
        await until(async () => (await page.$$eval('.hs-item', nodes => nodes.length)) > before, { message: 'más filas' });
        const bad4 = abruptChange(load, { min: 80 });
        assert(!bad4, `"Cargar más" creció de golpe: ${JSON.stringify(bad4)}`);
        more = ` · cargar más ${before} → ${await page.$$eval('.hs-item', nodes => nodes.length)} filas`;
      }
      assert(!bad1, `Filtrar sin resultados achicó de golpe: ${JSON.stringify(bad1)}`);
      assert(!bad2, `Volver a los resultados creció de golpe: ${JSON.stringify(bad2)}`);
      assert(!skeletonWhileStale, 'Al filtrar con resultados en pantalla apareció el esqueleto (la lista se achica y vuelve a crecer).');
      assert(!bad3, `Cambiar de pestaña cambió el alto de golpe: ${JSON.stringify(bad3)}`);
      return `achicar ${shrink[0]} → ${shrink[shrink.length - 1]} px en ${shrink.length} cuadros${more}`;
    });

    await test('hs', 'Historial', 'Fila de filtros: buscador, Tipo y botones con la misma altura y alineados; "Limpiar" siempre en su lugar (360–1920)', async () => {
      await openHistory(page, base);
      const problems = [];
      for (const width of [360, 768, 1024, 1440, 1920]) {
        await page.setViewport({ width, height: 900 });
        await sleep(250);
        const uneven = await unevenNeighbors(page, [{ row: '.hs-filter-row', items: '.ui-control, .ui-seg, .hs-filter-actions .ui-btn' }]);
        problems.push(...uneven.map(item => `${width}: ${item}`));
        // Las etiquetas de la fila (Buscar, Tipo) a la misma altura.
        const labels = await page.$$eval('.hs-filter-row .ui-label', nodes => nodes.filter(node => node.getBoundingClientRect().height).map(node => Math.round(node.getBoundingClientRect().top)));
        if (width >= 1024 && labels.length > 1 && Math.max(...labels) - Math.min(...labels) > 1) problems.push(`${width}: etiquetas desalineadas ${labels.join('/')}`);
      }
      await page.setViewport({ width: 1440, height: 900 });
      const limpiar = await page.$$eval('.hs-filter-actions button', nodes => nodes.map(node => `${node.textContent.trim()}${node.disabled ? ' (deshabilitado)' : ''}`));
      assert(limpiar.some(text => /^Limpiar \(deshabilitado\)$/.test(text)), `"Limpiar" no está en su lugar sin filtros: ${limpiar.join(', ')}`);
      assert(!problems.length, problems.slice(0, 6).join(' | '));
      return 'alturas y etiquetas parejas en 5 anchos';
    });
  } finally {
    await context.close();
  }

  await test('hs', 'Historial', 'Celular: filas-tarjeta sin renglones de "—"; sonda UX en cero a 360 y 1440, oscuro y claro', async () => {
    const view = await openContext(browser, { base, token: admin.token, releaseVersion, device: KnownDevices['iPhone 13'] });
    track(view.page);
    const failures = [];
    try {
      await openHistory(view.page, base);
      const dashes = await view.page.$$eval('.hs-item .hs-cell', nodes => nodes.filter(node => node.getBoundingClientRect().height > 0 && node.querySelector('.hs-cell-value')?.textContent?.trim() === '—').length);
      assert(dashes === 0, `${dashes} renglones con "—" visibles en las filas-tarjeta.`);
      for (const theme of ['dark', 'light']) {
        await setTheme(view.page, theme);
        const probe = await probeView(view.page, { scope: '.hs-page', scrollSteps: 3 });
        if (probe.total) failures.push(`390 ${theme}: ${formatProbe(probe)}`);
      }
    } finally {
      await view.context.close();
    }
    const wide = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width: 1440, height: 900 } });
    track(wide.page);
    try {
      await openHistory(wide.page, base);
      for (const theme of ['dark', 'light']) {
        await setTheme(wide.page, theme);
        const probe = await probeView(wide.page, { scope: '.hs-page', scrollSteps: 3 });
        if (probe.total) failures.push(`1440 ${theme}: ${formatProbe(probe)}`);
      }
    } finally {
      await wide.context.close();
    }
    assert(!failures.length, failures.join(' | '));
    return 'sin "—" en tarjetas; sonda 0';
  });
}
