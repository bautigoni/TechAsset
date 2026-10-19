// tl) Herramientas, Accesos rápidos y Caja chica (etapa 8c). Todo en línea:
// alta/edición/borrar con Deshacer/ordenar accesos; CSV de tarjetas y de
// credenciales con FileDrop; formularios de caja chica, aprobar y rechazar
// debajo de la solicitud; modo consulta. Cada prueba verifica el efecto en la
// base por API, y que abrir/cerrar un panel no mueva lo de arriba.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assert, gotoView, openContext, sleep, until } from '../lib/browser.mjs';

async function clickByText(page, selector, rx) {
  await until(() => page.evaluate((sel, src, flags) => {
    const re = new RegExp(src, flags);
    const el = [...document.querySelectorAll(sel)].find(node => re.test((node.textContent || '').replace(/\s+/g, ' ').trim()) && node.getBoundingClientRect().width && !node.disabled);
    if (!el) return false;
    el.click();
    return true;
  }, selector, rx.source, rx.flags), { message: `${selector} ${rx}` });
  await sleep(300);
}

/** Input/textarea de un campo `ui` por el texto de su label, dentro de `scope`. */
async function field(page, scope, label) {
  const handle = await until(() => page.evaluateHandle((sel, text) => {
    const root = document.querySelector(sel);
    if (!root) return null;
    const lab = [...root.querySelectorAll('label.ui-label')].find(node => (node.textContent || '').replace(/\*/g, '').trim().startsWith(text));
    return lab ? document.getElementById(lab.htmlFor) : null;
  }, scope, label).then(h => h.asElement()), { message: `campo "${label}" en ${scope}` });
  return handle;
}

async function typeField(page, scope, label, value, { clear = true } = {}) {
  const input = await field(page, scope, label);
  await input.click({ clickCount: 3 });
  if (clear) {
    await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
  }
  await input.type(value, { delay: 5 });
  return input;
}

const top = (page, selector) => page.$eval(selector, node => Math.round(node.getBoundingClientRect().top));

function tmpFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'techasset-8c-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

async function drop(page, index, file) {
  const inputs = await until(async () => { const list = await page.$$('.ui-filedrop input[type=file]'); return list.length > index && list; }, { message: 'FileDrop' });
  await inputs[index].uploadFile(file);
}

const links = async api => (await api.get('/api/quick-links')).data.items || [];

/** Botón dentro de la solicitud cuyo aria-label incluye `desc`. */
async function clickInRequest(page, desc, rx) {
  await until(() => page.evaluate((needle, src) => {
    const li = [...document.querySelectorAll('.pc-req')].find(node => (node.getAttribute('aria-label') || '').includes(needle));
    const button = li && [...li.querySelectorAll('button')].find(node => new RegExp(src).test(node.textContent.trim()) && !node.disabled);
    if (!button) return false;
    button.click();
    return true;
  }, desc, rx.source), { message: `${rx} en la solicitud "${desc}"` });
  await sleep(350);
}

export async function toolsTests({ browser, base, api, admin, consulta, releaseVersion, test, track = () => {} }) {
  const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, reducedMotion: true });
  track(page);
  const stamp = Date.now().toString(36);
  const title = `E2E acceso ${stamp}`;

  try {
    // ── Accesos rápidos ────────────────────────────────────────────────
    await test('tl', 'Accesos rápidos', 'Alta en línea: valida http(s), sugiere https:// y Enter guarda', async () => {
      await gotoView(page, base, 'quickaccess');
      await page.waitForSelector('.qa-group, .tl-empty', { timeout: 20000 });
      const before = await top(page, '.qa-head');
      await clickByText(page, '.qa-tools button', /^Nuevo acceso$/);
      await page.waitForSelector('.qa-new form');
      await typeField(page, '.qa-new', 'Nombre', title);
      await typeField(page, '.qa-new', 'Link', `e2e-${stamp}.example.org/x`);
      await page.keyboard.press('Enter');
      await page.waitForSelector('.qa-new .qa-suggest');
      assert(!(await links(api)).some(link => link.titulo === title), 'Guardó un link sin http(s).');
      await clickByText(page, '.qa-new .qa-suggest button', /^Usar$/);
      await (await field(page, '.qa-new', 'Nombre')).press('Enter');
      const saved = await until(async () => (await links(api)).find(link => link.titulo === title), { message: 'el acceso en la base' });
      assert(saved.url === `https://e2e-${stamp}.example.org/x`, `URL guardada: ${saved.url}`);
      assert((await top(page, '.qa-head')) === before, 'El encabezado se movió al abrir/cerrar el alta.');
      return `${saved.titulo} → ${saved.url}`;
    });

    await test('tl', 'Accesos rápidos', 'Editar en la fila: Esc cancela sin guardar, Enter guarda', async () => {
      await page.waitForSelector(`button[aria-label="Editar ${title}"]`);
      await page.click(`button[aria-label="Editar ${title}"]`);
      await page.waitForSelector('.qa-cell.is-active .qa-inline form');
      await typeField(page, '.qa-cell.is-active .qa-inline', 'Descripción', 'no se guarda');
      await page.keyboard.press('Escape');
      await until(async () => !(await page.$('.qa-cell.is-active .qa-inline form')), { message: 'que Esc cierre la edición' });
      assert(!((await links(api)).find(link => link.titulo === title)?.descripcion), 'Esc guardó cambios.');
      await page.click(`button[aria-label="Editar ${title}"]`);
      await page.waitForSelector('.qa-cell.is-active .qa-inline form');
      await typeField(page, '.qa-cell.is-active .qa-inline', 'Descripción', 'Editado por e2e');
      await page.keyboard.press('Enter');
      await until(async () => (await links(api)).find(link => link.titulo === title)?.descripcion === 'Editado por e2e', { message: 'descripción guardada' });
      return 'Esc no guarda · Enter guarda';
    });

    await test('tl', 'Accesos rápidos', 'Borrar con confirmación en línea → Deshacer lo restaura', async () => {
      const id = (await links(api)).find(link => link.titulo === title).id;
      await page.waitForSelector(`button[aria-label="Borrar ${title}"]`);
      await page.click(`button[aria-label="Borrar ${title}"]`);
      await page.waitForSelector('.qa-cell .ui-confirm');
      await clickByText(page, '.qa-cell .ui-confirm button', /^Borrar$/);
      await until(async () => !(await links(api)).some(link => link.id === id), { message: 'acceso borrado' });
      await clickByText(page, '.qa-ghost button', /Deshacer/);
      await until(async () => (await links(api)).some(link => link.id === id), { message: 'acceso restaurado' });
      await page.waitForSelector(`button[aria-label="Editar ${title}"]`);
      // Limpieza: queda borrado (soft) para no ensuciar las otras pruebas.
      await api.del(`/api/quick-links/${id}`);
      return `#${id} borrado y restaurado`;
    });

    await test('tl', 'Accesos rápidos', 'Ordenar: Bajar mueve el acceso y se guarda (orden manual)', async () => {
      await gotoView(page, base, 'quickaccess');
      await page.waitForSelector('.qa-group');
      const group = await page.$$eval('.qa-group', nodes => {
        const g = nodes.find(node => node.querySelectorAll('.qa-cell').length > 1);
        return g ? { name: g.getAttribute('aria-label'), first: g.querySelector('.qa-title')?.textContent?.trim() } : null;
      });
      assert(group, 'No hay una categoría con 2 o más accesos.');
      await clickByText(page, `.qa-group[aria-label="${group.name}"] .qa-group-head button`, /^Ordenar$/);
      await page.click(`button[aria-label="Bajar ${group.first}"]`);
      await until(async () => {
        const inGroup = (await links(api)).filter(link => (link.categoria || 'Sin categoría') === group.name).sort((a, b) => (a.orden || 0) - (b.orden || 0));
        return inGroup[1]?.titulo === group.first && inGroup.every(link => link.orden > 0);
      }, { message: `${group.first} segundo en ${group.name}` });
      await clickByText(page, `.qa-group[aria-label="${group.name}"] .qa-group-head button`, /^Listo$/);
      return `${group.name}: ${group.first} bajó`;
    });

    // ── Herramientas ──────────────────────────────────────────────────
    await test('tl', 'Herramientas', 'Tarjetas: columnas faltantes, vista previa de 10 con contraseña oculta, abrir resultado 2 veces', async () => {
      await gotoView(page, base, 'tools');
      await page.waitForSelector('.tl-page [role=tablist]');
      await drop(page, 0, tmpFile('malo.csv', 'Username,Nombre,Apellido,Contraseña\na,b,c,d'));
      await until(() => page.evaluate(() => /Faltan columnas obligatorias: Grupo/.test(document.querySelector('.tl-alert')?.textContent || '')), { message: 'error de columnas' });
      const rows = Array.from({ length: 14 }, (_, i) => `alumno${i},Nombre${i},Apellido${i},4N,Clave${i}`).join('\n');
      await drop(page, 0, tmpFile('alumnos.csv', `Username,Nombre,Apellido,Grupo,Contraseña\n${rows}`));
      await until(() => page.evaluate(() => document.querySelectorAll('.tl-panel:not([hidden]) .tl-table-card .ui-tbody .ui-tr').length === 10), { message: '10 filas de vista previa' });
      const shown = await page.$eval('.tl-panel:not([hidden]) .tl-table-card', node => node.textContent);
      assert(/Mostrando\s*10\s*de\s*14/.test(shown), 'No dice "Mostrando 10 de 14".');
      assert(!/Clave3/.test(shown), 'La contraseña se ve en la vista previa.');
      await clickByText(page, '.tl-panel:not([hidden]) button', /^Generar tarjetas Glifing$/);
      const href = await until(() => page.evaluate(() => [...document.querySelectorAll('.tl-result a')].find(a => /Abrir para imprimir/.test(a.textContent))?.getAttribute('href')), { message: 'link Abrir para imprimir' });
      const twice = await page.evaluate(async url => { const a = await fetch(url); const b = await fetch(url); return [a.status, b.status, (await b.text()).includes('Tarjetas de acceso')]; }, href);
      assert(twice[0] === 200 && twice[1] === 200 && twice[2], `Abrir dos veces: ${twice.join(', ')}`);
      return `${href} se abre 2 veces`;
    });

    await test('tl', 'Herramientas', 'Credenciales 365: Enviar exige validar; inválidas con motivo; envío de prueba y reporte re-descargable', async () => {
      await clickByText(page, '.tl-page [role=tab]', /^Credenciales 365$/);
      const csv = 'Nombre para mostrar,Nombre de usuario,mail,Contraseña,Sede,Licencias\n'
        + 'Uno,uno@x.edu,uno@gmail.com,A1!,NFPT,A1\nDos,dos@x.edu,sin-arroba,A2!,NFPT,A1\nTres,tres@x.edu,tres@gmail.com,,NFPT,A1';
      await drop(page, 1, tmpFile('cuentas.csv', csv));
      await until(() => page.evaluate(() => /3 filas detectadas/.test(document.querySelector('.tl-panel:not([hidden])')?.textContent || '')), { message: '3 filas detectadas' });
      const sendDisabled = await page.evaluate(() => [...document.querySelectorAll('.tl-panel:not([hidden]) button')].find(b => /^Enviar/.test(b.textContent.trim()))?.disabled);
      assert(sendDisabled, 'Enviar habilitado sin validar.');
      await clickByText(page, '.tl-panel:not([hidden]) button', /^Validar filas$/);
      await until(() => page.evaluate(() => {
        const text = document.querySelector('.tl-panel:not([hidden])')?.textContent || '';
        return /mail inválido/.test(text) && /contraseña vacía/.test(text);
      }), { message: 'motivos de las inválidas' });
      await clickByText(page, '.tl-panel:not([hidden]) button', /^Enviar \(modo prueba\)$/);
      const report = await until(() => page.evaluate(() => [...document.querySelectorAll('.tl-panel:not([hidden]) .tl-result a')].find(a => /reporte/i.test(a.textContent))?.getAttribute('href')), { message: 'link del reporte' });
      const counters = await page.$eval('.tl-panel:not([hidden]) .tl-result', node => node.textContent.replace(/\s+/g, ' '));
      assert(/Prueba ?1/.test(counters) && /Errores ?2/.test(counters), `Contadores: ${counters}`);
      const twice = await page.evaluate(async url => { const a = await fetch(url); const b = await fetch(url); return [a.status, b.status]; }, report);
      assert(twice[0] === 200 && twice[1] === 200, `Reporte dos veces: ${twice.join(', ')}`);
      return `prueba 1 · errores 2 · reporte ${twice.join('/')}`;
    });

    await test('tl', 'Herramientas', 'Configurar correo abre Configuración › Mail y SMTP (/settings/mail)', async () => {
      await gotoView(page, base, 'tools');
      await clickByText(page, '.tl-page button', /^Configurar correo en Configuración$/);
      const where = await until(() => page.evaluate(() => (/\/settings\/mail$/i.test(window.location.pathname) && /Mail y SMTP/.test(document.querySelector('main')?.textContent || '') ? window.location.pathname : null)), { message: 'Configuración › Mail y SMTP' });
      return where;
    });

    // ── Caja chica ────────────────────────────────────────────────────
    await api.patch('/api/petty-cash/config', { initialAmount: 500000, requestsEnabled: true });
    const desc = `Gasto e2e ${stamp}`;
    const expenseForm = 'form[aria-label="Registrar gasto"]';
    await test('tl', 'Caja chica', 'Registrar gasto en línea (importe 1.234,50, Enter) y control de saldo', async () => {
      await gotoView(page, base, 'pettycash');
      await page.waitForSelector('.pc-sum-acts');
      const anchor = await top(page, '.pc-sum');
      await clickByText(page, '.pc-sum-acts button', /^Registrar gasto$/);
      await page.waitForSelector(expenseForm);
      await typeField(page, expenseForm, 'Importe', '99999999');
      await until(() => page.evaluate(sel => /No alcanza el saldo/.test(document.querySelector(sel)?.textContent || ''), expenseForm), { message: 'aviso de saldo' });
      const blocked = await page.evaluate(sel => [...document.querySelectorAll(`${sel} button`)].find(b => /^Registrar gasto$/.test(b.textContent.trim()))?.disabled, expenseForm);
      assert(blocked, 'Con saldo insuficiente se puede registrar.');
      await typeField(page, expenseForm, 'Importe', '1.234,50');
      await typeField(page, expenseForm, 'Descripción', desc);
      await page.keyboard.press('Enter');
      const saved = await until(async () => ((await api.get('/api/petty-cash')).data.expenses || []).find(item => item.description === desc), { message: 'gasto en la base' });
      assert(saved.amount === 1234.5, `Importe guardado: ${saved.amount}`);
      await until(async () => !(await page.$(expenseForm)), { message: 'formulario cerrado' });
      assert((await top(page, '.pc-sum')) === anchor, 'El resumen se movió al abrir/cerrar el formulario.');
      return `${desc}: ${saved.amount}`;
    });

    const reqDesc = `Compra e2e ${stamp}`;
    const requestForm = 'form[aria-label="Solicitar compra"]';
    await test('tl', 'Caja chica', 'Solicitar compra → Resolver en línea con alta en Inventario TIC', async () => {
      await clickByText(page, '.pc-sum-acts button', /^Solicitar compra$/);
      await page.waitForSelector(requestForm);
      await typeField(page, requestForm, 'Qué necesitás comprar', reqDesc);
      await typeField(page, requestForm, 'Importe estimado', '2500');
      await (await field(page, requestForm, 'Qué necesitás comprar')).press('Enter');
      const created = await until(async () => ((await api.get('/api/petty-cash')).data.requests || []).find(item => item.description === reqDesc), { message: 'solicitud en la base' });
      await clickInRequest(page, reqDesc, /^Resolver$/);
      const form = `.pc-req[aria-label*="${reqDesc}"] form`;
      await page.waitForSelector(form);
      await typeField(page, form, 'Proveedor', 'Proveedor e2e');
      await page.click(`${form} [role=switch]`);
      await clickByText(page, `${form} button`, /^Aprobar y descontar$/);
      const done = await until(async () => ((await api.get('/api/petty-cash')).data.requests || []).find(item => item.id === created.id && item.status === 'Aprobada'), { message: 'solicitud aprobada' });
      const expense = ((await api.get('/api/petty-cash')).data.expenses || []).find(item => item.purchaseRequestId === created.id);
      assert(expense?.inventoryItemId, 'No se registró en Inventario TIC.');
      return `#${done.id} aprobada · gasto ${expense.amount} · inventario #${expense.inventoryItemId}`;
    });

    await test('tl', 'Caja chica', 'Rechazar pide confirmación en línea con la nota editable', async () => {
      const other = `Rechazo e2e ${stamp}`;
      const created = (await api.post('/api/petty-cash/requests', { description: other, estimatedAmount: 10 })).data.item;
      await gotoView(page, base, 'pettycash');
      await page.waitForSelector('.pc-req');
      await clickInRequest(page, other, /^Rechazar$/);
      const form = `.pc-req[aria-label*="${other}"] form`;
      await page.waitForSelector(form);
      assert(((await api.get('/api/petty-cash')).data.requests || []).find(item => item.id === created.id)?.status === 'Pendiente', 'Rechazó sin confirmar.');
      await typeField(page, form, 'Nota de rechazo', 'Hay en depósito');
      await clickByText(page, `${form} button`, /^Rechazar solicitud$/);
      const done = await until(async () => ((await api.get('/api/petty-cash')).data.requests || []).find(item => item.id === created.id && item.status === 'Rechazada'), { message: 'solicitud rechazada' });
      assert(done.resolutionNote === 'Hay en depósito', `Nota: ${done.resolutionNote}`);
      return `#${done.id}: ${done.resolutionNote}`;
    });
  } finally {
    await context.close().catch(() => {});
  }

  const reader = await openContext(browser, { base, token: consulta.token, releaseVersion });
  track(reader.page);
  try {
    await test('tl', 'Herramientas, Accesos y Caja chica', 'Modo consulta: sin escrituras en las tres pantallas', async () => {
      const found = [];
      await gotoView(reader.page, base, 'quickaccess');
      await reader.page.waitForSelector('.qa-page');
      await sleep(800);
      found.push(...await reader.page.$$eval('.qa-page button', buttons => buttons
        .filter(b => !b.disabled && /Nuevo acceso|Editar|Borrar|Ordenar|Agregar como acceso/.test(`${b.textContent} ${b.getAttribute('aria-label') || ''}`))
        .map(b => `accesos: ${b.textContent.trim() || b.getAttribute('aria-label')}`)));
      await gotoView(reader.page, base, 'tools');
      await reader.page.waitForSelector('.tl-page');
      await sleep(600);
      found.push(...await reader.page.$$eval('.tl-page .ui-drop, .tl-page button', nodes => nodes
        .filter(n => (n.matches('.ui-drop') && n.getAttribute('aria-disabled') !== 'true') || (n.tagName === 'BUTTON' && !n.disabled && /^(Generar|Validar|Enviar)/.test(n.textContent.trim())))
        .map(n => `herramientas: ${n.textContent.trim().slice(0, 30)}`)));
      await gotoView(reader.page, base, 'pettycash');
      await reader.page.waitForSelector('.pc-sum');
      found.push(...await reader.page.$$eval('.pc-page button', buttons => buttons
        .filter(b => !b.disabled && /Editar fondo|Registrar gasto|Solicitar compra|Resolver|Rechazar/.test(b.textContent))
        .map(b => `caja: ${b.textContent.trim()}`)));
      assert(!found.length, `Habilitados: ${found.join(', ')}`);
      return 'todo deshabilitado u oculto';
    });
  } finally {
    await reader.context.close().catch(() => {});
  }
}

