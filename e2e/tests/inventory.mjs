// inv) Inventario TIC (etapa 5b): búsqueda flexible, ficha en línea, ocultar con
// Deshacer, "Crear las N" en un request, recorrido de revisión con atajos y
// Deshacer, y modo consulta. Cada prueba verifica el efecto en la base por API.
import { assert, gotoView, openContext, sleep, until } from '../lib/browser.mjs';

const ROW = '.ivt-table .ui-tbody .ui-tr.is-clickable';

async function typeSearch(page, value) {
  const input = await page.waitForSelector('.ivt-search input');
  await input.focus();
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  if (value) await input.type(value, { delay: 15 });
  await sleep(250);
}

async function clickByText(page, selector, rx) {
  await until(() => page.evaluate((sel, src, flags) => {
    const re = new RegExp(src, flags);
    const el = [...document.querySelectorAll(sel)].find(node => re.test((node.textContent || '').replace(/\s+/g, ' ').trim()) && node.getBoundingClientRect().width && !node.disabled);
    if (!el) return false;
    el.click();
    return true;
  }, selector, rx.source, rx.flags), { message: `${selector} ${rx}` });
  await sleep(250);
}

async function openInventory(page, base) {
  await gotoView(page, base, 'inventory');
  await page.waitForSelector('.ivt-kpi', { timeout: 20000 });
  await until(() => page.$('.ivt-cat, .ivt-table, .ui-empty'), { timeout: 20000, message: 'el inventario cargado' });
}

const pickSegment = (page, label) => clickByText(page, '.ivt-tools .ui-seg-item', new RegExp(`^${label}`));

async function openRowByText(page, value) {
  const row = await until(() => page.evaluateHandle((sel, needle) => [...document.querySelectorAll(sel)].find(node => node.textContent.includes(needle)) || null, ROW, value).then(h => h.asElement()), { message: `la fila de ${value}` });
  await row.click();
  await page.waitForSelector('.ivt-table .ui-tr--detail .ivt-detail');
  // En línea: la ficha es la fila que sigue a la fila abierta.
  const inline = await page.evaluate(sel => {
    const open = document.querySelector(`${sel}[aria-expanded="true"]`);
    return Boolean(open?.nextElementSibling?.classList.contains('ui-tr--detail'));
  }, ROW);
  assert(inline, 'La ficha no se abrió debajo de su fila.');
}

const getItem = async (api, id) => ((await api.get('/api/inventory/items')).data.items || []).find(item => item.id === id);

export async function inventoryTests({ browser, base, api, admin, consulta, releaseVersion, test, track = () => {} }) {
  const items = (await api.get('/api/inventory/items')).data.items || [];
  const devices = await api.devices();
  const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion });
  track(page);

  try {
    await test('inv', 'Inventario TIC', 'Búsqueda flexible de equipos (touchN, Ntouch, etiqueta, número)', async () => {
      const device = devices.find(item => /^touch\s*\d+$/i.test(item.aliasOperativo || '')) || devices.find(item => item.aliasOperativo);
      assert(device, 'La copia no tiene equipos con alias.');
      const [, word, num] = String(device.aliasOperativo).match(/^(\S+)\s*(\d+)$/) || [];
      await openInventory(page, base);
      await pickSegment(page, 'Equipos');
      const queries = [word && `${word.toLowerCase()}${num}`, word && `${num}${word.toLowerCase()}`, device.etiqueta, device.etiqueta.replace(/^D0*/, '')].filter(Boolean);
      for (const query of queries) {
        await typeSearch(page, query);
        await until(() => page.$(`${ROW}[data-device-tag="${device.etiqueta}"]`), { timeout: 5000, message: `"${query}" → ${device.etiqueta}` });
      }
      const plani = devices.find(item => /^plani\s*\d+$/i.test(item.aliasOperativo || ''));
      if (plani) {
        const n = String(plani.aliasOperativo).match(/\d+/)[0];
        for (const query of [`plani ${n}`, `planificación ${n}`]) {
          await typeSearch(page, query);
          await until(() => page.$(`${ROW}[data-device-tag="${plani.etiqueta}"]`), { timeout: 5000, message: `"${query}" → ${plani.etiqueta}` });
          queries.push(query);
        }
      }
      await typeSearch(page, '');
      return `${device.aliasOperativo}: ${queries.join(', ')}`;
    });

    const resource = items.find(item => Number(item.cantidad) > 1 && !item.unidadesCargadas) || items[0];
    await test('inv', 'Inventario TIC', 'Ficha en línea: condición de un recurso cuenta como revisión', async () => {
      assert(resource, 'La copia no tiene recursos.');
      await openInventory(page, base);
      await pickSegment(page, 'Recursos');
      await typeSearch(page, resource.nombre);
      await openRowByText(page, resource.nombre);
      await clickByText(page, '.ivt-detail .ivt-detail-side .ivt-chip', /^Regular$/);
      const saved = await until(async () => { const item = await getItem(api, resource.id); return item?.condicion === 'Regular' && item; }, { message: 'condición Regular en la base' });
      assert(saved.condicionUpdatedAt, 'No se registró la fecha de revisión.');
      return `${resource.nombre}: Regular`;
    });

    await test('inv', 'Inventario TIC', '"Crear las N" unidades en un solo request', async () => {
      assert(resource && Number(resource.cantidad) > 1, 'No hay recurso con cantidad > 1.');
      const posts = [];
      const onRequest = request => { if (request.method() === 'POST' && /\/api\/inventory\/items\/\d+\/units/.test(request.url())) posts.push(request.url()); };
      page.on('request', onRequest);
      try {
        await clickByText(page, '.ivt-detail .ivt-sec-actions button', /^Crear las \d+$/);
        const expected = Math.min(Number(resource.cantidad), 60);
        await until(async () => ((await api.get(`/api/inventory/items/${resource.id}/units`)).data.units || []).length === expected, { message: `${expected} unidades en la base` });
        assert(posts.length === 1 && /\/units\/batch$/.test(posts[0]), `Requests de alta: ${posts.length} (${posts.join(', ')})`);
        return `${expected} unidades, 1 request`;
      } finally {
        page.off('request', onRequest);
      }
    });

    await test('inv', 'Inventario TIC', 'Ocultar con confirmación en línea → Deshacer lo vuelve a mostrar', async () => {
      await clickByText(page, '.ivt-detail .ivt-actions button', /^Ocultar$/);
      await page.waitForSelector('.ivt-detail .ui-confirm');
      await clickByText(page, '.ivt-detail .ui-confirm button', /^Ocultar$/);
      await until(async () => !(await getItem(api, resource.id)), { message: 'recurso oculto en la base' });
      await clickByText(page, '.ivt-main .ui-status button', /Deshacer/);
      await until(async () => Boolean(await getItem(api, resource.id)), { message: 'recurso restaurado' });
      await page.waitForSelector('.ivt-table .ui-tr--detail .ivt-detail');
      return `${resource.nombre}: oculto y restaurado`;
    });

    await test('inv', 'Inventario TIC', 'Recorrido: Ctrl+1 no califica, 2 califica, Deshacer restaura, S salta, Esc sale', async () => {
      const queue = (await api.get('/api/devices/review-queue')).data.items || [];
      const first = queue[0];
      assert(first, 'Cola de revisión vacía.');
      const before = await api.device(first.etiqueta);
      await openInventory(page, base);
      await clickByText(page, '.ivt-head-actions button', /^Revisar condición$/);
      await page.waitForSelector('.ivt-rate-btn:not([disabled])');
      await page.keyboard.down('Control');
      await page.keyboard.press('1');
      await page.keyboard.up('Control');
      await sleep(600);
      assert(((await api.device(first.etiqueta))?.condition || '') === (before?.condition || ''), 'Ctrl+1 calificó.');
      await page.keyboard.press('2');
      await until(async () => (await api.device(first.etiqueta))?.condition === 'Bueno', { message: `${first.etiqueta} Bueno` });
      await clickByText(page, '.ivt-review-last button', /Deshacer/);
      await until(async () => {
        const now = await api.device(first.etiqueta);
        return (now?.condition || '') === (before?.condition || '') && (now?.lastReviewedAt || '') === (before?.lastReviewedAt || '');
      }, { message: 'condición y fecha anteriores restauradas' });
      const pos = () => page.$eval('.ivt-review-pos', node => node.textContent.trim());
      const p1 = await pos();
      await page.keyboard.press('s');
      await until(async () => (await pos()) !== p1, { message: 'que S salte' });
      await page.keyboard.press('Escape');
      await until(async () => !(await page.$('.ivt-review')), { message: 'que Esc cierre el recorrido' });
      return `${first.etiqueta}: Bueno → deshecho`;
    });
  } finally {
    await context.close().catch(() => {});
  }

  const reader = await openContext(browser, { base, token: consulta.token, releaseVersion });
  track(reader.page);
  try {
    await test('inv', 'Inventario TIC', 'Modo consulta: sin escrituras (revisar, agregar, condición, editar, ocultar)', async () => {
      await openInventory(reader.page, base);
      const head = await reader.page.$$eval('.ivt-head-actions button', buttons => buttons.filter(button => /Revisar|Agregar/.test(button.textContent) && !button.disabled).map(button => button.textContent.trim()));
      assert(!head.length, `Habilitados: ${head.join(', ')}`);
      await pickSegment(reader.page, 'Recursos');
      await clickByText(reader.page, '.ivt-cat', /./);
      await reader.page.click(ROW);
      await reader.page.waitForSelector('.ivt-detail');
      const enabled = await reader.page.$$eval('.ivt-detail .ivt-chip, .ivt-detail button', buttons => buttons
        .filter(button => !button.disabled && /Excelente|Bueno|Regular|Malo|Sin revisar|Editar|Ocultar|Subir foto|Cambiar foto|Crear las|Agregar unidad/.test(button.textContent))
        .map(button => button.textContent.trim()));
      assert(!enabled.length, `Habilitados en la ficha: ${enabled.join(', ')}`);
      return 'todo deshabilitado';
    });
  } finally {
    await reader.context.close().catch(() => {});
  }
}
