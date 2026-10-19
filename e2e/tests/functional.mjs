// Pruebas funcionales (a–h). Cada una deja su resultado OK/FALLA con detalle.
// Todas corren contra la copia de la base: prestar, borrar o mover tareas acá
// no toca ningún dato real.
import { loanState, SITE } from '../lib/env.mjs';
import {
  assert, clickButton, clickWithModifier, findButton, gotoView, openContext, pathname,
  readOptions, selectOption, sleep, text, typeInto, until
} from '../lib/browser.mjs';

// Préstamos (etapa 4): selectores por data-* para no depender del estilo.
const CODE_INPUT = 'input[data-loan-code]';
const LOAN_FORM = '[data-loan-form]';
const DEVICE_STACK = '[data-loans-grid="devices"]';
const PASS_STACK = '[data-loans-grid="passes"]';
const CONT_SWITCH = `${LOAN_FORM} button.lo-cont-switch[role="switch"]`;
const escapeRx = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exact = value => new RegExp(`^${escapeRx(value)}$`);

// Mapa de la barra lateral (Sidebar.tsx): etiqueta → vista.
export const NAV_LABELS = {
  Inicio: 'dashboard', Tenants: 'tenants', Usuarios: 'adminusers', Dispositivos: 'devices', 'Préstamos': 'loans',
  Historial: 'history', 'Inventario TIC': 'inventory', 'Analítica': 'analytics', 'Agenda TIC': 'agenda', Horarios: 'schedules',
  'Tareas TIC': 'tasks', Recordatorios: 'reminders', Canvas: 'canvas', 'Caja chica': 'pettycash', 'Estado aulas': 'classrooms',
  Tickets: 'tickets', 'Base de conocimiento': 'knowledge', Sugerencias: 'suggestions', Herramientas: 'tools',
  'Accesos rápidos': 'quickaccess', 'Configuración': 'settings'
};

/** Ítems del menú lateral (etapa 2): data-view = clave de la vista; el activo lleva aria-current. */
export const NAV_ITEM = '.shell-nav .shell-nav-item[data-view]';
export const NAV_ACTIVE = '.shell-nav .shell-nav-item[aria-current="page"]';

// ── Préstamos ────────────────────────────────────────────────────────────────

async function openLoans(page, base) {
  await gotoView(page, base, 'loans');
  // La grilla de equipos solo se dibuja cuando llegó el inventario.
  await page.waitForSelector(DEVICE_STACK, { timeout: 20000 });
  await page.waitForSelector(CODE_INPUT);
}

/** Elige una opción de un grupo de botones (Rol, Ubicación, Nivel...) por texto. */
async function pickOption(page, groupLabel, pattern) {
  const ok = await page.evaluate((label, source, flags) => {
    const rx = new RegExp(source, flags);
    const group = document.querySelector(`[data-loan-form] [role="group"][aria-label="${label}"]`);
    const button = group && [...group.querySelectorAll('button')].find(node => rx.test((node.textContent || '').trim()));
    if (!button) return false;
    if (button.getAttribute('aria-pressed') !== 'true') button.click();
    return true;
  }, groupLabel, pattern.source, pattern.flags);
  assert(ok, `No encontré la opción ${pattern} en "${groupLabel}".`);
}

/** Completa persona, rol, ubicación (y nivel/curso/detalles si la ubicación los pide). */
async function fillLoanPerson(page) {
  const person = await page.waitForSelector(`${LOAN_FORM} #lo-persona`);
  await typeInto(page, person, 'E2E Prueba');
  await page.keyboard.press('Tab');
  const roles = await page.$$eval(`${LOAN_FORM} [role="group"][aria-label="Rol"] button`, nodes => nodes.map(node => node.textContent.trim()));
  await pickOption(page, 'Rol', exact(roles.includes('DOE') ? 'DOE' : roles[0]));
  const locations = await page.$$eval(`${LOAN_FORM} [role="group"][aria-label="Ubicación"] button`, nodes => nodes.map(node => node.textContent.trim()));
  await pickOption(page, 'Ubicación', exact(locations.includes('DOE') ? 'DOE' : locations[0]));
  await sleep(100);
  if (await page.$(`${LOAN_FORM} [role="group"][aria-label="Nivel"]`)) {
    await pickOption(page, 'Nivel', /^EP$/);
    await pickOption(page, 'Grado, año o curso', /./);
  }
  for (const input of await page.$$(`${LOAN_FORM} input[aria-label^="Especificar"]`)) await typeInto(page, input, 'E2E');
}

async function codeValue(page) {
  return page.$eval(CODE_INPUT, input => input.value).catch(() => '');
}

async function openAllDevicePanels(page) {
  await page.$$eval(`${DEVICE_STACK} .lo-group-toggle[aria-expanded="false"]`, buttons => buttons.forEach(button => button.click()));
  await until(() => page.$$eval(`${DEVICE_STACK} .lo-group-toggle[aria-expanded="false"]`, list => list.length === 0), { message: 'los grupos de equipos abiertos' });
  await page.waitForSelector(`${DEVICE_STACK} .lo-chip[data-device-tag]`);
  await sleep(250);
}

async function deviceChip(page, tag) {
  const element = await page.$(`${DEVICE_STACK} .lo-chip[data-device-tag="${tag}"]`);
  assert(element, `No encontré el chip de ${tag} en la grilla.`);
  return element;
}

async function chipState(handle) {
  return handle.evaluate(chip => ({
    selected: chip.classList.contains('is-selected'),
    disabled: chip.disabled,
    busy: chip.classList.contains('is-busy')
  }));
}

async function selectModeOn(page, stack) {
  return page.$eval(stack, section => section.getAttribute('data-select-mode') === 'on').catch(() => false);
}

async function exitSelectMode(page, stack) {
  if (await selectModeOn(page, stack)) {
    await page.$eval(`${stack} .lo-selbar-done`, button => button.click());
    await until(async () => !(await selectModeOn(page, stack)), { message: 'que se apague el modo selección' });
  }
}

async function barText(page, stack) {
  return text(page, `${stack} .lo-selbar`);
}

async function passChip(page, numero) {
  const element = await page.$(`${PASS_STACK} .lo-chip[data-pass="${numero}"]`);
  assert(element, `No encontré el cartelito ${numero}.`);
  return element;
}

const continuousOn = page => page.$eval(CONT_SWITCH, b => b.getAttribute('aria-checked') === 'true');

async function cancelContinuous(page) {
  if (!(await continuousOn(page).catch(() => false))) return;
  await page.$eval(CONT_SWITCH, button => button.click());
  // Si había lista, pregunta (en línea) si conservarla.
  const empty = await until(() => findButton(page, /^Vaciar lista$/, { scope: `${LOAN_FORM} .lo-ask` }), { timeout: 1500 }).catch(() => null);
  if (empty) await empty.click();
  await until(async () => !(await continuousOn(page)), { message: 'el escaneo continuo apagado' });
}

async function scanMessage(page) {
  return text(page, '[data-scan-list] .lo-scan-msg');
}

export async function functionalTests({ browser, base, api, apiConsulta, admin, consulta, releaseVersion, blockedTag, test, track = () => {} }) {
  const devicesNow = await api.devices();
  const available = devicesNow.filter(device => loanState(device.estado) === 'available' && device.etiqueta !== blockedTag).map(device => device.etiqueta);
  const loaned = devicesNow.filter(device => loanState(device.estado) === 'loaned').map(device => device.etiqueta);
  // Equipos libres repartidos por prueba, para que una no le cambie el estado a otra.
  const [tagA, tagB, tagC, tagD, tagE, tagF, tagG] = available;
  if (!loaned.length && available.length > 8) {
    // Hace falta al menos uno prestado para las pruebas de devolver.
    await api.post('/api/loans/lend', { etiqueta: available[8], person: 'E2E Prestado', role: 'DOE', location: 'DOE' });
    loaned.push(available[8]);
  }
  const [loanedTag1, loanedTag2] = loaned;

  // Cartelitos: GET los siembra (1 a 30) y uno queda entregado para probar "Devolver".
  const passes = (await api.get('/api/photo-passes')).data.items || [];
  let lentPass = passes.find(pass => /prest|entreg/i.test(pass.estado || ''))?.numero;
  if (!lentPass && passes.length) {
    const candidate = passes.find(pass => /disponible/i.test(pass.estado || '')) || passes[0];
    await api.post(`/api/photo-passes/${candidate.numero}/lend`, { persona: 'E2E Alumno', curso: '5F', docente: 'E2E Docente' });
    lentPass = candidate.numero;
  }

  const admin1 = await openContext(browser, { base, token: admin.token, releaseVersion });
  const page = admin1.page;
  track(page);

  try {
    // a) Préstamos ────────────────────────────────────────────────────────────
    await test('a', 'Préstamos', 'Prestar uno por formulario', async () => {
      assert(tagA, 'No hay equipos disponibles en la copia.');
      await openLoans(page, base);
      await typeInto(page, CODE_INPUT, tagA);
      await until(() => findButton(page, /^Prestar\s*↵?$/, { scope: LOAN_FORM }), { message: 'el botón Prestar' });
      await fillLoanPerson(page);
      await clickButton(page, /^Prestar\s*↵?$/, { scope: LOAN_FORM });
      const device = await until(async () => { const d = await api.device(tagA); return loanState(d?.estado) === 'loaned' && d; }, { message: `${tagA} prestado en la base` });
      return `${tagA} → ${device.estado} a ${device.prestadoA}`;
    });

    await test('a', 'Préstamos', 'Devolver uno por formulario', async () => {
      await openLoans(page, base);
      await typeInto(page, CODE_INPUT, tagA);
      await clickButton(page, /^Devolver\s*↵?$/, { scope: LOAN_FORM });
      const device = await until(async () => { const d = await api.device(tagA); return loanState(d?.estado) === 'available' && d; }, { message: `${tagA} devuelto en la base` });
      return `${tagA} → ${device.estado}`;
    });

    await test('a', 'Préstamos', 'Escaneo continuo con Enter: duplicado, no disponible y lote', async () => {
      assert(tagB && tagC && loanedTag1, 'Faltan equipos libres o prestados en la copia.');
      await openLoans(page, base);
      await page.$eval(CONT_SWITCH, button => button.click());
      await page.waitForSelector('[data-scan-list]');
      const messages = [];
      for (const tag of [tagB, tagC, tagB, loanedTag1]) {
        await typeInto(page, CODE_INPUT, tag);
        await page.keyboard.press('Enter');
        await sleep(150);
        messages.push(await scanMessage(page));
      }
      assert(/Agregado: /.test(messages[0]), `Primer escaneo: "${messages[0]}"`);
      assert(/ya estaba en la lista/.test(messages[2]), `Duplicado no avisado: "${messages[2]}"`);
      assert(/Agregado con error/.test(messages[3]), `No disponible no marcado: "${messages[3]}"`);
      const rows = await page.$$eval('[data-scan-list] .lo-qrow', list => list.length);
      const errorRows = await page.$$eval('[data-scan-list] .lo-qrow.is-error', list => list.length);
      assert(rows === 3 && errorRows === 1, `Lista: ${rows} filas, ${errorRows} con error (esperaba 3 y 1).`);
      assert(await findButton(page, /^Confirmar préstamo múltiple \(2\)\s*↵?$/), 'El botón no dice "Confirmar préstamo múltiple (2)".');
      assert(await codeValue(page) === '', 'Enter no limpió el campo de código.');
      await fillLoanPerson(page);
      await clickButton(page, /^Confirmar préstamo múltiple \(2\)\s*↵?$/);
      await until(async () => {
        const [b, c] = await Promise.all([api.device(tagB), api.device(tagC)]);
        return loanState(b?.estado) === 'loaned' && loanState(c?.estado) === 'loaned';
      }, { message: `${tagB} y ${tagC} prestados en la base` });
      const result = await until(async () => { const m = await scanMessage(page); return /Se prestaron/.test(m) && m; }, { message: 'el mensaje del lote' });
      await cancelContinuous(page);
      return `${messages.join(' | ')} → ${result}`;
    });

    for (const [modifier, label] of [['Control', 'Ctrl+Click'], ['Meta', 'Meta+Click (Cmd)'], ['Shift', 'Shift+Click']]) {
      await test('a', 'Préstamos', `${label} en chip de equipo marca sin prestar`, async () => {
        assert(tagD, 'No hay equipo libre para el chip.');
        await openLoans(page, base);
        await openAllDevicePanels(page);
        await exitSelectMode(page, DEVICE_STACK);
        const before = await codeValue(page);
        await clickWithModifier(page, await deviceChip(page, tagD), modifier);
        await sleep(200);
        const state = await chipState(await deviceChip(page, tagD));
        assert(await selectModeOn(page, DEVICE_STACK), 'No se prendió el modo selección.');
        assert(state.selected, 'El chip no quedó marcado.');
        const bar = await barText(page, DEVICE_STACK);
        assert(/Prestar 1/.test(bar), `Barra: "${bar}"`);
        assert(await codeValue(page) === before, 'Cargó la etiqueta en el formulario (no tenía que actuar).');
        assert(loanState((await api.device(tagD))?.estado) === 'available', `${tagD} cambió de estado.`);
        return `barra: "${bar}"`;
      });
    }

    await test('a', 'Préstamos', 'Chips: barra con Prestar N y Devolver N, sin tocar la base', async () => {
      const prestado = (await api.devices()).find(device => loanState(device.estado) === 'loaned')?.etiqueta;
      assert(tagD && tagE && prestado, 'Faltan equipos libres o prestados.');
      await openLoans(page, base);
      await openAllDevicePanels(page);
      await exitSelectMode(page, DEVICE_STACK);
      await clickWithModifier(page, await deviceChip(page, tagD), 'Control');
      await clickWithModifier(page, await deviceChip(page, tagE), 'Control');
      await clickWithModifier(page, await deviceChip(page, prestado), 'Control');
      await sleep(200);
      const bar = await barText(page, DEVICE_STACK);
      assert(/3 seleccionados/.test(bar) && /Prestar 2/.test(bar) && /Devolver 1/.test(bar), `Barra: "${bar}"`);
      assert(loanState((await api.device(prestado))?.estado) === 'loaned', `${prestado} se devolvió solo con marcarlo.`);
      // Prestar N manda el lote a la lista del escaneo continuo.
      await clickButton(page, /^Prestar 2$/, { scope: DEVICE_STACK });
      await until(() => continuousOn(page), { message: 'escaneo continuo prendido por el lote' });
      const tags = await page.$$eval('[data-scan-list] [data-queue-tag]', rows => rows.map(row => row.getAttribute('data-queue-tag')));
      assert(tags.includes(tagD) && tags.includes(tagE), `La lista del continuo tiene ${tags.join(', ')}.`);
      const focused = await until(() => page.evaluate(() => document.activeElement?.id === 'lo-persona'), { timeout: 1500 }).catch(() => false);
      await cancelContinuous(page);
      return `"${bar}" → continuo con ${tags.join(', ')}${focused ? ' (foco en Persona)' : ' (sin foco en Persona)'}`;
    });

    await test('a', 'Préstamos', 'Chip bloqueado no responde (ni click ni Ctrl+Click)', async () => {
      assert(blockedTag, 'No se pudo preparar un equipo bloqueado en la copia.');
      await openLoans(page, base);
      await openAllDevicePanels(page);
      await exitSelectMode(page, DEVICE_STACK);
      const chip = await deviceChip(page, blockedTag);
      const state = await chipState(chip);
      assert(state.disabled, 'El chip bloqueado no está deshabilitado.');
      await clickWithModifier(page, chip, 'Control');
      await clickWithModifier(page, chip, null);
      await sleep(200);
      assert(!(await selectModeOn(page, DEVICE_STACK)), 'Ctrl+Click sobre el bloqueado prendió el modo selección.');
      assert(!(await chipState(await deviceChip(page, blockedTag))).selected, 'El chip bloqueado quedó marcado.');
      assert(await codeValue(page) === '', 'El click cargó la etiqueta bloqueada en el formulario.');
      return `${blockedTag} (Fuera de servicio) deshabilitado`;
    });

    await test('a', 'Préstamos', 'Click simple en chip prestado lo devuelve', async () => {
      const prestado = loanState((await api.device(tagB))?.estado) === 'loaned' ? tagB
        : (await api.devices()).find(device => loanState(device.estado) === 'loaned')?.etiqueta;
      assert(prestado, 'No hay equipos prestados.');
      await openLoans(page, base);
      await openAllDevicePanels(page);
      await exitSelectMode(page, DEVICE_STACK);
      const before = await api.device(prestado);
      await (await deviceChip(page, prestado)).click();
      await until(async () => loanState((await api.device(prestado))?.estado) === 'available', { message: `${prestado} devuelto en la base` });
      // Deshacer (línea de estado en línea, debajo del encabezado de la grilla): vuelve a quedar prestado con los mismos datos.
      await clickButton(page, /Deshacer/, { scope: `${DEVICE_STACK} .lo-card-status` });
      const again = await until(async () => { const d = await api.device(prestado); return loanState(d?.estado) === 'loaned' && d; }, { message: `${prestado} prestado de nuevo por el Deshacer` });
      assert(again.prestadoA === before.prestadoA, `Deshacer lo prestó a "${again.prestadoA}" (antes "${before.prestadoA}").`);
      return `${prestado} devuelto → Deshacer → prestado otra vez a ${again.prestadoA}`;
    });

    await test('a', 'Préstamos', 'Shift+Click marca el rango dentro de un tipo (sin actuar)', async () => {
      await openLoans(page, base);
      await openAllDevicePanels(page);
      await exitSelectMode(page, DEVICE_STACK);
      // Primer grupo con al menos 4 equipos seleccionables seguidos.
      const range = await page.evaluate(stack => {
        for (const group of document.querySelectorAll(`${stack} .lo-group`)) {
          const chips = [...group.querySelectorAll('.lo-chip[data-device-tag]')].filter(chip => !chip.disabled);
          if (chips.length >= 4) return chips.slice(0, 4).map(chip => chip.getAttribute('data-device-tag'));
        }
        return null;
      }, DEVICE_STACK);
      assert(range, 'No hay un tipo con 4 equipos seleccionables.');
      const statesBefore = await Promise.all(range.map(tag => api.device(tag).then(d => d?.estado)));
      await clickWithModifier(page, await deviceChip(page, range[0]), 'Shift');
      await clickWithModifier(page, await deviceChip(page, range[3]), 'Shift');
      await sleep(200);
      const marked = await page.$$eval(`${DEVICE_STACK} .lo-chip.is-selected`, chips => chips.map(chip => chip.getAttribute('data-device-tag')));
      assert(range.every(tag => marked.includes(tag)), `Marcados: ${marked.join(', ')} (esperaba ${range.join(', ')}).`);
      const statesAfter = await Promise.all(range.map(tag => api.device(tag).then(d => d?.estado)));
      assert(JSON.stringify(statesBefore) === JSON.stringify(statesAfter), 'Marcar con Shift cambió estados en la base.');
      const bar = await barText(page, DEVICE_STACK);
      await exitSelectMode(page, DEVICE_STACK);
      return `${range.join(', ')} marcados · barra "${bar}"`;
    });

    await test('a', 'Préstamos', 'Enter en el código devuelve un prestado; Deshacer lo re-presta', async () => {
      const prestado = (await api.devices()).find(device => loanState(device.estado) === 'loaned');
      assert(prestado, 'No hay equipos prestados.');
      await openLoans(page, base);
      await typeInto(page, CODE_INPUT, prestado.etiqueta);
      await until(() => findButton(page, /^Devolver\s*↵?$/, { scope: LOAN_FORM }), { message: 'el resultado con Devolver' });
      await page.keyboard.press('Enter');
      await until(async () => loanState((await api.device(prestado.etiqueta))?.estado) === 'available', { message: `${prestado.etiqueta} devuelto con Enter` });
      assert(await codeValue(page) === '', 'Después de devolver no se limpió el código.');
      await clickButton(page, /Deshacer/, { scope: LOAN_FORM });
      const again = await until(async () => { const d = await api.device(prestado.etiqueta); return loanState(d?.estado) === 'loaned' && d; }, { message: 'el Deshacer' });
      assert(again.prestadoA === prestado.prestadoA, `Deshacer lo prestó a "${again.prestadoA}".`);
      return `${prestado.etiqueta}: Enter → devuelto → Deshacer → ${again.prestadoA}`;
    });

    await test('a', 'Préstamos', 'Cartelitos: Ctrl/Meta/Shift+Click marcan sin entregar ni devolver', async () => {
      assert(lentPass, 'No hay cartelitos en la copia.');
      await openLoans(page, base);
      const toggle = await page.waitForSelector(`${PASS_STACK} .lo-group-toggle`);
      if (await toggle.evaluate(button => button.getAttribute('aria-expanded') === 'false')) await toggle.click();
      await page.waitForSelector(`${PASS_STACK} .lo-chip[data-pass]`);
      await sleep(250);
      const states = async () => Object.fromEntries(((await api.get('/api/photo-passes')).data.items || []).map(pass => [pass.numero, pass.estado]));
      const before = await states();
      const free = Object.entries(before).find(([numero, estado]) => /disponible/i.test(estado) && Number(numero) !== Number(lentPass))?.[0];
      assert(free, 'No hay cartelitos libres.');
      const details = [];
      for (const modifier of ['Control', 'Meta', 'Shift']) {
        await exitSelectMode(page, PASS_STACK);
        await clickWithModifier(page, await passChip(page, free), modifier);
        await sleep(150);
        assert(await selectModeOn(page, PASS_STACK), `${modifier}: no se prendió el modo selección.`);
        assert(!(await page.$(`${PASS_STACK} .lo-pass-form`)), `${modifier}: abrió el formulario de entrega.`);
        const bar = await barText(page, PASS_STACK);
        assert(/Entregar 1/.test(bar), `${modifier}: barra "${bar}"`);
        details.push(`${modifier} ok`);
      }
      await clickWithModifier(page, await passChip(page, lentPass), 'Control');
      await sleep(150);
      const bar = await barText(page, PASS_STACK);
      assert(/Entregar 1/.test(bar) && /Devolver 1/.test(bar), `Barra con los dos: "${bar}"`);
      const after = await states();
      assert(JSON.stringify(before) === JSON.stringify(after), 'Marcar cartelitos cambió su estado en la base.');
      await exitSelectMode(page, PASS_STACK);
      return `${details.join(', ')}; barra "${bar}"`;
    });

    // b) Escáner global ───────────────────────────────────────────────────────
    await test('b', 'Escáner global', 'Tipear rápido fuera de inputs lleva a Préstamos con la etiqueta', async () => {
      const tag = tagF || tagA;
      await gotoView(page, base, 'dashboard');
      await page.waitForSelector('tr[data-device-tag]', { timeout: 20000 });
      await page.evaluate(() => { (document.activeElement instanceof HTMLElement) && document.activeElement.blur(); });
      await page.keyboard.type(tag, { delay: 15 });
      await page.keyboard.press('Enter');
      await until(async () => (await pathname(page)).endsWith(`/sede/${SITE.toLowerCase()}/loans`), { message: 'la URL de Préstamos' });
      const value = await until(async () => { const v = await codeValue(page); return v && v; }, { message: 'la etiqueta en el formulario' });
      assert(value.toUpperCase() === tag.toUpperCase(), `El formulario tiene "${value}" (esperaba ${tag}).`);
      return `${tag} → /loans con "${value}"`;
    });

    await test('b', 'Escáner global', 'Tipear dentro de un campo o de un diálogo no navega', async () => {
      await gotoView(page, base, 'devices');
      await page.waitForSelector('tr[data-device-tag]', { timeout: 20000 });
      const search = await page.waitForSelector('input.compact-search');
      await search.click();
      await page.keyboard.type('D1436', { delay: 15 });
      await page.keyboard.press('Enter');
      await sleep(500);
      assert((await pathname(page)).endsWith('/devices'), `Tipear en el buscador navegó a ${await pathname(page)}.`);
      await clickButton(page, /^Papelera$/);
      await page.waitForSelector('.modal .modal-close');
      await page.$eval('.modal .modal-close', button => button.focus());
      await page.keyboard.type('1436', { delay: 15 });
      await sleep(500);
      assert((await pathname(page)).endsWith('/devices'), `Tipear con foco en un diálogo navegó a ${await pathname(page)}.`);
      assert(await page.$('.modal'), 'El diálogo se cerró solo.');
      await page.keyboard.press('Escape');
      return 'buscador y diálogo: sin navegar';
    });

    await test('b', 'Escáner global', 'Tipeo humano fuera de campos, Ctrl K y el asistente no navegan', async () => {
      await gotoView(page, base, 'dashboard');
      await page.waitForSelector('tr[data-device-tag]', { timeout: 20000 });
      await page.evaluate(() => { (document.activeElement instanceof HTMLElement) && document.activeElement.blur(); });
      // Ritmo de persona (≈140 ms entre teclas): no es un lector.
      await page.keyboard.type('D1436', { delay: 140 });
      await page.keyboard.press('Enter');
      await sleep(500);
      assert((await pathname(page)).endsWith('/dashboard'), `El tipeo lento navegó a ${await pathname(page)}.`);
      // Ctrl K: la franja es [data-scanner-ignore] y su campo es editable.
      await page.keyboard.down('Control'); await page.keyboard.press('KeyK'); await page.keyboard.up('Control');
      await page.waitForSelector('.shell-palette .shell-pal-input');
      await page.keyboard.type('1436', { delay: 15 });
      await sleep(500);
      assert((await pathname(page)).endsWith('/dashboard'), `Tipear en Ctrl K navegó a ${await pathname(page)}.`);
      await page.keyboard.press('Escape'); // vacía la búsqueda
      await page.keyboard.press('Escape'); // cierra la franja
      await until(async () => !(await page.$('.shell-palette')), { message: 'que Esc cierre Ctrl K' });
      // Asistente (columna): tipear rápido en su campo tampoco navega.
      await page.$eval('.shell-assistant-btn', button => button.click());
      await page.waitForSelector('.asst:not([hidden]) .asst-input');
      await page.$eval('.asst-input', input => input.focus());
      await page.keyboard.type('D1436', { delay: 15 });
      await sleep(500);
      assert((await pathname(page)).endsWith('/dashboard'), `Tipear en el asistente navegó a ${await pathname(page)}.`);
      await page.keyboard.press('Escape');
      await until(async () => Boolean(await page.$('.asst[hidden]')), { message: 'que Esc cierre el asistente' });
      return 'tipeo lento, Ctrl K y asistente: sin navegar; Esc cierra';
    });

    // c) Búsqueda flexible ────────────────────────────────────────────────────
    await test('c', 'Dispositivos', 'Búsqueda flexible (touch 34, touch34, 34touch, D1436, 1436, plani 5, planificación 5)', async () => {
      await gotoView(page, base, 'devices');
      await page.waitForSelector('tr[data-device-tag]', { timeout: 20000 });
      const showAll = async () => {
        const more = await findButton(page, /^Ver todos$/, { scope: '.device-table-more' });
        if (more) { await more.click(); await sleep(150); }
      };
      await showAll();
      const rows = await page.$$eval('tr[data-device-tag]', list => list.map(row => ({ tag: row.getAttribute('data-device-tag'), alias: (row.querySelector('.operational-alias')?.textContent || '').trim() })));
      const pick = (rx, preferred) => {
        const matches = rows.map(row => ({ ...row, m: row.alias.match(rx) })).filter(row => row.m);
        return matches.find(row => Number(row.m[1]) === preferred) || matches[0];
      };
      const touch = pick(/^touch\s*(\d+)$/i, 34);
      const plani = pick(/^plani\s*(\d+)$/i, 5);
      const labelRow = rows.find(row => row.tag === 'D1436') || rows.find(row => /^D\d+$/.test(row.tag));
      const queries = [];
      if (touch) queries.push([`touch ${touch.m[1]}`, touch.tag], [`touch${touch.m[1]}`, touch.tag], [`${touch.m[1]}touch`, touch.tag]);
      if (labelRow) queries.push([labelRow.tag, labelRow.tag], [labelRow.tag.replace(/^D0*/i, ''), labelRow.tag]);
      if (plani) queries.push([`plani ${plani.m[1]}`, plani.tag], [`planificación ${plani.m[1]}`, plani.tag]);
      const missing = [];
      const results = [];
      for (const [query, expected] of queries) {
        await typeInto(page, 'input.compact-search', query);
        await sleep(250);
        await showAll();
        const visible = await page.$$eval('tr[data-device-tag]', list => list.map(row => row.getAttribute('data-device-tag')));
        results.push(`"${query}"→${visible.length}`);
        if (!visible.includes(expected)) missing.push(`"${query}" no encontró ${expected}`);
      }
      await typeInto(page, 'input.compact-search', '');
      assert(queries.length, 'No hay equipos con alias Touch/Plani ni etiquetas en la copia.');
      assert(!missing.length, missing.join('; '));
      const skipped = [!touch && 'sin Touch', !plani && 'sin Plani'].filter(Boolean);
      return `${results.join(', ')}${skipped.length ? ` (${skipped.join(', ')} en la copia)` : ''}`;
    });

    // d) Borrar → Deshacer → papelera → restaurar ─────────────────────────────
    await test('d', 'Dispositivos', 'Borrar → Deshacer; borrar → papelera → restaurar', async () => {
      const tag = tagG;
      assert(tag, 'No hay equipo libre para borrar.');
      const deleteRow = async () => {
        await typeInto(page, 'input.compact-search', tag);
        const row = await page.waitForSelector(`tr[data-device-tag="${tag}"]`, { timeout: 15000 });
        await (await row.$('.device-delete-btn')).click();
        await clickButton(page, /^Borrar$/, { scope: '.modal' });
        await until(async () => !(await api.device(tag)), { message: `${tag} oculto en la base` });
      };
      await gotoView(page, base, 'devices');
      await page.waitForSelector('tr[data-device-tag]', { timeout: 20000 });
      await deleteRow();
      const toastText = await until(() => text(page, '.app-toast'), { message: 'el aviso con Deshacer' });
      assert(toastText.includes(tag), `Aviso: "${toastText}"`);
      await page.$eval('.app-toast-action', button => button.click());
      await until(async () => Boolean(await api.device(tag)), { message: `${tag} restaurado por Deshacer` });
      await deleteRow();
      await clickButton(page, /^Papelera$/);
      const item = await until(() => page.evaluateHandle(etiqueta => [...document.querySelectorAll('.device-trash-list li')].find(li => li.textContent.includes(etiqueta)) || null, tag).then(h => h.asElement()), { message: `${tag} en la papelera` });
      await (await item.$('button')).click();
      await until(async () => Boolean(await api.device(tag)), { message: `${tag} restaurado desde la papelera` });
      await until(async () => !(await page.evaluate(etiqueta => [...document.querySelectorAll('.device-trash-list li')].some(li => li.textContent.includes(etiqueta)), tag)), { message: 'que salga de la lista de la papelera' });
      await page.keyboard.press('Escape');
      return `${tag}: Deshacer y Restaurar OK`;
    });

    // e) Tareas y tickets ─────────────────────────────────────────────────────
    await test('e', 'Tareas', 'Mover una tarea de columna (drag & drop)', async () => {
      await gotoView(page, base, 'tasks');
      await page.waitForSelector('.infinite-task-column', { timeout: 20000 });
      let card = await page.$('.infinite-task-column .task-card[data-task-id]');
      if (!card) {
        await api.post('/api/tasks', { titulo: 'Tarea E2E', responsable: 'Bauti', prioridad: 'Media', estado: 'Pendiente' });
        await gotoView(page, base, 'tasks');
        card = await page.waitForSelector('.infinite-task-column .task-card[data-task-id]', { timeout: 15000 });
      }
      const move = await page.evaluate(() => {
        const cardEl = document.querySelector('.infinite-task-column .task-card[data-task-id]');
        const columns = [...document.querySelectorAll('.infinite-task-column')];
        const from = columns.findIndex(column => column.contains(cardEl));
        const to = from === 0 ? 1 : 0;
        const target = columns[to];
        const dataTransfer = new DataTransfer();
        const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
        fire(cardEl, 'dragstart');
        fire(target, 'dragenter');
        fire(target, 'dragover');
        fire(target, 'drop');
        fire(cardEl, 'dragend');
        return { id: cardEl.getAttribute('data-task-id'), from: columns[from].querySelector('.infinite-column-head strong')?.textContent, to: target.querySelector('.infinite-column-head strong')?.textContent };
      });
      const task = await until(async () => {
        const items = (await api.get('/api/tasks?space=all')).data.items || [];
        const found = items.find(item => item.id === move.id);
        return found && found.estado === move.to && found;
      }, { message: `la tarea en "${move.to}" en la base` });
      return `"${task.titulo}": ${move.from} → ${move.to}`;
    });

    await test('e', 'Tickets', 'Cambiar el estado de un ticket', async () => {
      let tickets = (await api.get('/api/tickets')).data.items || [];
      let created = false;
      if (!tickets.length) {
        const response = await api.post('/api/tickets', { numero: '99001', titulo: 'Ticket E2E', descripcion: 'Creado por e2e/run.mjs en la copia', origen: 'tik', estado: 'No hecho', prioridad: 'Media' });
        assert(response.data.ok, `No se pudo crear el ticket: ${JSON.stringify(response.data)}`);
        tickets = (await api.get('/api/tickets')).data.items || [];
        created = true;
      }
      const ticket = tickets.find(item => item.estado !== 'En proceso') || tickets[0];
      const target = ticket.estado === 'En proceso' ? 'Hecho' : 'En proceso';
      await gotoView(page, base, 'tickets');
      await selectOption(page, `Estado del ticket ${ticket.numero}`, exact(target));
      await until(async () => ((await api.get('/api/tickets')).data.items || []).find(item => item.id === ticket.id)?.estado === target, { message: `ticket en "${target}" en la base` });
      return `#${ticket.numero}: ${ticket.estado} → ${target}${created ? ' (creado en la copia)' : ''}`;
    });

    // f) Agenda ───────────────────────────────────────────────────────────────
    await test('f', 'Agenda', 'Alta con conflicto de capacidad muestra el aviso', async () => {
      // Algo ya reservado en ese horario: con eso, 25 Touch más supera el máximo.
      await api.post('/api/agenda', { dia: 'Lunes', turno: 'Mañana', desde: '09:05', hasta: '09:55', curso: 'E2E base', actividad: 'E2E', tipoDispositivo: 'Touch', cantidad: 5, estado: 'Pendiente' });
      await gotoView(page, base, 'agenda');
      await page.waitForSelector('button.t-goo-main', { timeout: 20000 });
      await page.$eval('button.t-goo-main', button => button.click());
      await page.waitForSelector('button.t-goo-item[aria-label="Nueva actividad"]');
      await sleep(200);
      await page.$eval('button.t-goo-item[aria-label="Nueva actividad"]', button => button.click());
      await page.waitForSelector('.modal form');
      const field = async label => (await page.evaluateHandle(name => [...document.querySelectorAll('.modal label')].find(node => node.textContent.trim().startsWith(name))?.querySelector('input') || null, label)).asElement();
      await typeInto(page, await field('Curso'), 'E2E conflicto');
      await typeInto(page, await field('Cantidad'), '25');
      await clickButton(page, /^Guardar$/, { scope: '.modal' });
      const error = await until(() => text(page, '.modal .form-error'), { message: 'el aviso de conflicto' });
      assert(/conflicto/i.test(error), `Aviso: "${error}"`);
      const created = ((await api.get('/api/agenda?all=1')).data.items || []).some(item => item.curso === 'E2E conflicto');
      assert(!created, 'La actividad en conflicto se guardó igual.');
      await page.keyboard.press('Escape');
      return error;
    });
  } finally {
    await admin1.context.close();
  }

  // g) Modo consulta ──────────────────────────────────────────────────────────
  const WRITE = /^(\+\s*)?(Prestar|Devolver|Borrar|Eliminar|Editar|Guardar|Añadir|Agregar(?! a lista)|Importar|Confirmar|Generar|Enviar|Restaurar|Nueva|Nuevo|Crear|Entregar|Revisar devolución|Revisar$|Seleccionar varios|Varios)\b/i;
  const writeControls = page => page.evaluate((source, flags) => {
    const rx = new RegExp(source, flags);
    const main = document.querySelector('main') || document.body;
    const out = [];
    for (const button of main.querySelectorAll('button')) {
      const label = (button.textContent || button.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
      if (!rx.test(label) || button.disabled) continue;
      const rect = button.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      out.push(label);
    }
    const chips = [...main.querySelectorAll('.pass-chip, .lo-chip:not(.lo-chip--sample)')].filter(chip => chip.tagName === 'BUTTON' && !chip.disabled).length;
    const checkboxes = [...main.querySelectorAll('input[type="checkbox"]')].filter(box => !box.disabled).length;
    return { buttons: out, chips, checkboxes };
  }, WRITE.source, WRITE.flags);

  const reader = await openContext(browser, { base, token: consulta.token, releaseVersion });
  track(reader.page);
  try {
    for (const [view, ready, label] of [['dashboard', 'tr[data-device-tag]', 'Inicio'], ['loans', DEVICE_STACK, 'Préstamos'], ['devices', 'tr[data-device-tag]', 'Dispositivos']]) {
      await test('g', 'Modo consulta', `${label}: ninguna acción de escritura habilitada`, async () => {
        await gotoView(reader.page, base, view);
        await reader.page.waitForSelector(ready, { timeout: 20000 });
        if (view === 'loans') {
          await openAllDevicePanels(reader.page);
          const passToggle = await reader.page.$(`${PASS_STACK} .lo-group-toggle[aria-expanded="false"]`);
          if (passToggle) { await passToggle.click(); await reader.page.waitForSelector(`${PASS_STACK} .lo-chip[data-pass]`).catch(() => {}); }
          // Un equipo libre identificado: el botón Prestar tiene que estar deshabilitado.
          const free = (await apiConsulta.devices()).find(device => loanState(device.estado) === 'available')?.etiqueta;
          if (free) { await typeInto(reader.page, CODE_INPUT, free); await sleep(300); }
        }
        await sleep(300);
        const found = await writeControls(reader.page);
        const banner = await reader.page.$('.shell-consulta');
        const problems = [
          found.buttons.length && `botones habilitados: ${found.buttons.join(', ')}`,
          found.chips && `${found.chips} chips habilitados`,
          found.checkboxes && `${found.checkboxes} casillas de selección habilitadas`
        ].filter(Boolean);
        assert(!problems.length, problems.join('; '));
        return `sin escrituras habilitadas${banner ? ' · cartel "Modo consulta" visible' : ''}`;
      });
    }
    await test('g', 'Modo consulta', 'El server rechaza escrituras del rol consulta', async () => {
      const free = (await apiConsulta.devices()).find(device => loanState(device.estado) === 'available')?.etiqueta;
      const response = await apiConsulta.post('/api/loans/lend', { etiqueta: free, person: 'E2E', role: 'DOE', location: 'DOE' });
      assert(response.status === 403, `POST /api/loans/lend respondió ${response.status}.`);
      return '403 en /api/loans/lend';
    });
  } finally {
    await reader.context.close();
  }

  // h) Navegación ─────────────────────────────────────────────────────────────
  const nav = await openContext(browser, { base, token: admin.token, releaseVersion });
  track(nav.page);
  try {
    const views = await (async () => {
      await gotoView(nav.page, base, 'dashboard');
      await nav.page.waitForSelector(NAV_ITEM, { timeout: 20000 });
      const keys = await nav.page.$$eval(NAV_ITEM, buttons => buttons.map(button => button.getAttribute('data-view')));
      // 'ui' (Componentes UI, solo superadmin) no estaba en el menú de la línea base.
      return keys.filter(key => key && key !== 'ui').map(key => [key, key]);
    })();
    await test('h', 'Navegación', `/sede/${SITE}/<vista> abre la vista correcta (${views.length} vistas)`, async () => {
      const wrong = [];
      for (const [view, label] of views) {
        await gotoView(nav.page, base, view);
        try {
          await until(async () => {
            const active = await nav.page.$eval(NAV_ACTIVE, button => button.getAttribute('data-view')).catch(() => '');
            return active === label && (await pathname(nav.page)) === `/sede/${SITE.toLowerCase()}/${view}`;
          }, { timeout: 6000 });
        } catch {
          const active = await nav.page.$eval(NAV_ACTIVE, button => button.getAttribute('data-view')).catch(() => '(ninguna)');
          wrong.push(`${view}: activa "${active}", URL ${await pathname(nav.page)}`);
        }
      }
      assert(!wrong.length, wrong.join('; '));
      return views.map(([view]) => view).join(', ');
    });

    await test('h', 'Navegación', 'Atrás y Adelante del navegador recorren las vistas (misma URL /sede/<sede>/<vista>)', async () => {
      await gotoView(nav.page, base, 'dashboard');
      await nav.page.waitForSelector(NAV_ITEM, { timeout: 20000 });
      const go = async view => {
        await nav.page.$eval(`.shell-nav .shell-nav-item[data-view="${view}"]`, button => button.click());
        await until(async () => (await pathname(nav.page)) === `/sede/${SITE.toLowerCase()}/${view}`, { message: `la URL de ${view}` });
      };
      const at = async view => until(async () => {
        const active = await nav.page.$eval(NAV_ACTIVE, button => button.getAttribute('data-view')).catch(() => '');
        return active === view && (await pathname(nav.page)) === `/sede/${SITE.toLowerCase()}/${view}`;
      }, { message: `volver a ${view}` });
      await go('devices');
      await go('loans');
      await nav.page.goBack(); await at('devices');
      await nav.page.goBack(); await at('dashboard');
      await nav.page.goForward(); await at('devices');
      return 'dashboard → devices → loans, Atrás ×2, Adelante ×1';
    });

    await test('h', 'Navegación', 'Ctrl K: "prestar <etiqueta>" lleva a Préstamos con la etiqueta; un equipo salta a su fila', async () => {
      const free = (await api.devices()).find(device => loanState(device.estado) === 'available')?.etiqueta;
      assert(free, 'No hay equipos libres en la copia.');
      await gotoView(nav.page, base, 'dashboard');
      await nav.page.waitForSelector(NAV_ITEM, { timeout: 20000 });
      const openPalette = async () => {
        await nav.page.keyboard.down('Control'); await nav.page.keyboard.press('KeyK'); await nav.page.keyboard.up('Control');
        await nav.page.waitForSelector('.shell-palette .shell-pal-input');
      };
      await openPalette();
      await nav.page.keyboard.type(`prestar ${free}`, { delay: 10 });
      await nav.page.waitForSelector('.shell-pal-item.is-active');
      await nav.page.keyboard.press('Enter');
      await until(async () => (await pathname(nav.page)).endsWith('/loans'), { message: 'la URL de Préstamos' });
      const value = await until(() => nav.page.$eval(CODE_INPUT, input => input.value).catch(() => ''), { message: 'la etiqueta en el formulario' });
      assert(value.toUpperCase() === free.toUpperCase(), `El formulario tiene "${value}" (esperaba ${free}).`);
      // Un equipo (sin verbo) → Dispositivos filtrado, con la fila resaltada.
      await openPalette();
      await nav.page.keyboard.type(free, { delay: 10 });
      await nav.page.waitForSelector('.shell-pal-item.is-active');
      await nav.page.keyboard.press('Enter');
      await until(async () => (await pathname(nav.page)).endsWith('/devices'), { message: 'la URL de Dispositivos' });
      await nav.page.waitForSelector(`tr[data-device-tag="${free}"].row-highlight`, { timeout: 8000 });
      return `prestar ${free} → /loans; ${free} → fila resaltada en /devices`;
    });

    await test('h', 'Navegación', 'Una respuesta 401 vuelve al login', async () => {
      await gotoView(nav.page, base, 'dashboard');
      await nav.page.waitForSelector('.shell-nav .shell-nav-item[data-view="history"]', { timeout: 20000 });
      // Sesión inválida a partir de ahora (como si la hubieran cerrado en otro lado).
      const bogus = { name: 'techasset_session', value: 'sesion-invalida-e2e', domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' };
      if (typeof nav.context.setCookie === 'function') await nav.context.setCookie(bogus);
      else await nav.page.setCookie(bogus);
      await nav.page.$eval('.shell-nav .shell-nav-item[data-view="history"]', button => button.click());
      const where = await until(async () => { const p = await pathname(nav.page); return p.startsWith('/login') && p; }, { timeout: 10000, message: 'la pantalla de login' });
      return where;
    });
  } finally {
    await nav.context.close();
  }
}
