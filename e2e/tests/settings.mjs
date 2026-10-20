// cfg) Configuración (etapa 8b): Usuarios con Deshacer y borrado confirmado,
// Módulos (conteo, aviso de cambios sin guardar, orden y menú), Roles (Editar
// marca Ver), Invitaciones (link y revocar en línea), Sedes (409), Avanzado
// (JSON inválido), links viejos, gate de administración y que el encabezado no
// salte al cerrar un panel en línea. Cada prueba verifica el efecto por API.
import { assert, openContext, sleep, until } from '../lib/browser.mjs';
import { settle } from '../lib/ux-probe.mjs';
import { WIDTHS, recordFrames, smoothEnough, sweepLayout } from './cfgToolsChecks.mjs';

const PANELS = ['cuenta', 'apariencia', 'notificaciones', 'turnos', 'modulos', 'roles', 'usuarios', 'invitaciones', 'prestamo', 'vida-util', 'sede', 'avanzado', 'sedes', 'mail'];

async function openPanel(page, base, panel) {
  await page.goto(`${base}/sede/NFPT/settings/${panel}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.shell', { timeout: 20000 });
  await page.waitForSelector(`[data-settings-panel="${panel}"]`, { timeout: 20000 });
  await sleep(500);
}

async function clickText(page, selector, rx) {
  await until(() => page.evaluate((sel, src, flags) => {
    const re = new RegExp(src, flags);
    const el = [...document.querySelectorAll(sel)].find(node => re.test((node.textContent || node.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()) && node.getBoundingClientRect().width && !node.disabled);
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return true;
  }, selector, rx.source, rx.flags), { message: `${selector} ${rx}` });
  await sleep(300);
}

const textOf = (page, selector) => page.evaluate(sel => [...document.querySelectorAll(sel)].map(node => node.textContent.replace(/\s+/g, ' ').trim()).join(' | '), selector);

export async function settingsTests({ browser, base, api, consulta, admin, releaseVersion, test, track = () => {} }) {
  const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion });
  page.on('dialog', dialog => { void dialog.accept(); });
  track(page);
  const email = `e2e-pendiente-${Date.now()}@e2e.local`;
  const row = `[data-user-row="${email}"]`;
  const findUser = async () => ((await api.get('/api/allowed-users')).data.items || []).find(user => user.email === email);

  try {
    await test('cfg', 'Configuración', 'Usuarios: aprobar → Deshacer (sin mail) y borrar con confirmación → Deshacer', async () => {
      const created = await api.post('/api/allowed-users', { email, nombre: 'E2E Pendiente', defaultRole: 'Consulta', status: 'Pendiente', sites: ['NFPT'], defaultSiteCode: 'NFPT' });
      assert(created.status === 200, `no se pudo crear el pendiente (${created.status})`);
      await openPanel(page, base, 'usuarios');
      await clickText(page, `${row} button`, /^Aprobar$/);
      await until(async () => (await findUser())?.status === 'Activo', { message: 'aprobado en el server' });
      await clickText(page, `${row} .ui-status button`, /Deshacer/);
      await until(async () => (await findUser())?.status === 'Pendiente', { message: 'Deshacer devuelve a Pendiente' });
      await until(async () => /No se mandó ningún mail/.test(await textOf(page, `${row} .ui-status`)), { message: 'el mail en espera se canceló' });
      await clickText(page, `${row} button`, /^Borrar$/);
      await until(() => page.$(`${row} .ui-confirm`), { message: 'confirmación en línea' });
      await clickText(page, `${row} .ui-confirm button`, /^Borrar$/);
      await until(async () => !(await findUser()), { message: 'borrado (oculto) en el server' });
      await clickText(page, `${row} .ui-status button`, /Deshacer/);
      await until(async () => (await findUser())?.status === 'Pendiente', { message: 'Deshacer restaura el borrado' });
      await api.post(`/api/allowed-users/${(await findUser()).id}/delete`);
      return 'aprobar, deshacer, borrar confirmado y deshacer';
    });

    await test('cfg', 'Configuración', 'Módulos: conteo de cambios, aviso al salir, Descartar; reordenar y el menú se actualiza', async () => {
      await openPanel(page, base, 'modulos');
      await page.evaluate(() => document.querySelector('.cfg-mod [role=switch]').click());
      await sleep(200);
      assert(/1 cambio sin guardar/.test(await textOf(page, '.cfg-card-fs')), 'no cuenta el cambio');
      await clickText(page, '.cfg-nav-i', /^Roles y permisos/);
      await until(() => page.$('.cfg-leave'), { message: 'aviso de cambios sin guardar' });
      await clickText(page, '.cfg-leave button', /Seguir editando/);
      await clickText(page, '.cfg-card-fa button', /^Descartar$/);
      assert(/Sin cambios/.test(await textOf(page, '.cfg-card-fs')), 'Descartar no volvió atrás');
      const first = await page.$eval('.cfg-mod', node => node.dataset.moduleRow);
      await clickText(page, '.cfg-mod button', new RegExp(`^Bajar `));
      await clickText(page, '.cfg-card-fa button', /^Guardar módulos$/);
      await until(async () => (await api.get('/api/site-settings')).data.settings['modules.order'][1] === first, { message: 'orden guardado' });
      const nav = await page.$$eval('.shell-nav .shell-nav-item[data-view]', list => list.map(node => node.dataset.view));
      const second = (await api.get('/api/site-settings')).data.settings['modules.order'][0];
      assert(nav.indexOf(second) < nav.indexOf(first) || !nav.includes(first), `el menú no se reordenó (${nav.join(',')})`);
      const firstLabel = await page.$eval(`.cfg-mod[data-module-row="${first}"] .cfg-mod-t .cfg-strong`, node => node.textContent);
      await clickText(page, '.cfg-mod button', new RegExp(`^Subir ${firstLabel}$`));
      await clickText(page, '.cfg-card-fa button', /^Guardar módulos$/);
      await until(async () => (await api.get('/api/site-settings')).data.settings['modules.order'][0] === first, { message: 'orden restaurado' });
      return `${first} bajó y volvió`;
    });

    await test('cfg', 'Configuración', 'Roles: marcar Editar marca Ver y se guarda; eliminar pide confirmación', async () => {
      const before = (await api.get('/api/site-settings')).data.settings['roles.config'];
      const target = before.find(role => !role.admin);
      assert(target, 'no hay un rol no administrador');
      await openPanel(page, base, 'roles');
      await clickText(page, '.cfg-acc-h button', new RegExp(`Abrir el rol ${target.name}$`));
      const viewEdit = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.ui-collapse:is([data-state="open"], [data-state="opening"]) .cfg-perm-r')];
        const row = rows.find(r => r.querySelectorAll('[role=checkbox]')[1]?.getAttribute('aria-checked') === 'false');
        return row ? row.querySelector('.cfg-wrap').textContent : '';
      });
      assert(viewEdit, 'no hay un módulo sin Editar');
      // Ver apagado primero, así se ve que Editar lo prende.
      await page.evaluate(label => {
        const ver = document.querySelector(`[role=checkbox][aria-label="Ver ${label}"]`);
        if (ver.getAttribute('aria-checked') === 'true') ver.click();
      }, viewEdit);
      await sleep(150);
      await page.evaluate(label => { document.querySelector(`[role=checkbox][aria-label="Editar ${label}"]`).click(); }, viewEdit);
      await sleep(150);
      const ver = await page.$eval(`[role=checkbox][aria-label="Ver ${viewEdit}"]`, node => node.getAttribute('aria-checked'));
      assert(ver === 'true', 'Editar no marcó Ver');
      await clickText(page, '.cfg-card-fa button', /^Guardar roles$/);
      await until(async () => JSON.stringify((await api.get('/api/site-settings')).data.settings['roles.config']) !== JSON.stringify(before), { message: 'roles guardados' });
      const restored = await api.patch('/api/site-settings', { settings: { 'roles.config': before } });
      assert(restored.status === 200, 'no se pudo restaurar roles.config');
      await openPanel(page, base, 'roles');
      await clickText(page, '.cfg-card-fa button', /^Agregar rol$/);
      await clickText(page, '.cfg-acc-f button', /^Eliminar rol$/);
      await until(() => page.$('.cfg-acc-f .ui-confirm'), { message: 'confirmación en línea' });
      await clickText(page, '.cfg-acc-f .ui-confirm button', /^Eliminar rol$/);
      return `${target.name}: Editar ${viewEdit} marcó Ver`;
    });

    await test('cfg', 'Configuración', 'Invitaciones: generar link; revocar con confirmación en línea', async () => {
      await openPanel(page, base, 'invitaciones');
      await clickText(page, '.cfg-card-fa button', /^Generar invitación$/);
      await until(() => page.$('.cfg-result .cfg-link'), { message: 'link generado' });
      const link = await textOf(page, '.cfg-result .cfg-link');
      const code = decodeURIComponent(link.split('code=')[1] || '');
      assert(code, `link sin código: ${link}`);
      await clickText(page, '.cfg-ti-act button', /^Revocar$/);
      await clickText(page, '.cfg-tgroup .ui-confirm button', /^Revocar$/);
      await until(async () => ((await api.get('/api/invites')).data.items || []).some(invite => invite.code === code && invite.status === 'Revocada'), { message: 'revocada en el server' });
      return code;
    });

    await test('cfg', 'Configuración', 'Sedes: crear con un código existente avisa (409) y no pisa nada', async () => {
      const sites = (await api.get('/api/sites')).data.items;
      const existing = sites[0];
      await openPanel(page, base, 'sedes');
      await clickText(page, '.cfg-ph-a button', /Crear sede/);
      const input = await page.waitForSelector('.cfg-siteform input[placeholder="NFXX"]');
      await input.type(existing.siteCode);
      await clickText(page, '.cfg-siteform button', /^Crear sede$/);
      await until(async () => /Ya existe una sede/.test(await textOf(page, '.cfg-siteform .ui-help--bad')), { message: 'error 409 visible' });
      const after = (await api.get('/api/sites')).data.items.find(site => site.siteCode === existing.siteCode);
      assert(after.nombre === existing.nombre, 'pisó el nombre de la sede');
      return existing.siteCode;
    });

    await test('cfg', 'Configuración', 'Avanzado: JSON inválido muestra el error y no deja guardar', async () => {
      await openPanel(page, base, 'avanzado');
      await clickText(page, '.cfg-tk .cfg-trow button', /^Editar$/);
      const area = await page.waitForSelector('.cfg-tk textarea');
      await area.type('xx');
      const disabled = await page.evaluate(() => [...document.querySelectorAll('.cfg-tk button')].find(b => /Guardar clave/.test(b.textContent)).disabled);
      assert(disabled, 'Guardar clave habilitado con JSON inválido');
      assert(/JSON inválido/.test(await textOf(page, '.cfg-tk .ui-help--bad')), 'sin mensaje de error');
      const bad = await api.patch('/api/site-settings', { settings: { 'roles.config': [] } });
      assert(bad.status === 400, `el server aceptó roles.config vacío (${bad.status})`);
      return 'cliente y server validan';
    });

    await test('cfg', 'Configuración', 'Links viejos (/tenants, /adminusers, /configuracion/usuarios) y Atrás entre paneles', async () => {
      for (const [url, panel] of [['/sede/NFPT/tenants', 'sedes'], ['/sede/NFPT/adminusers', 'usuarios'], ['/sede/nfpt/configuracion/usuarios', 'usuarios']]) {
        await page.goto(`${base}${url}`, { waitUntil: 'domcontentloaded' });
        await until(() => page.$(`[data-settings-panel="${panel}"]`), { timeout: 20000, message: `${url} → ${panel}` });
      }
      await clickText(page, '.cfg-nav-i', /^Roles y permisos/);
      await until(() => page.$('[data-settings-panel="roles"]'), { message: 'roles' });
      assert((await page.evaluate(() => location.pathname)).endsWith('/settings/roles'), 'la URL no lleva el panel');
      await page.goBack();
      await until(() => page.$('[data-settings-panel="usuarios"]'), { message: 'Atrás vuelve a Usuarios' });
      return 'ok';
    });

    await test('cfg', 'Configuración', 'Cerrar un panel en línea no mueve el encabezado tocado', async () => {
      await openPanel(page, base, 'usuarios');
      const last = await page.$$eval('[data-user-row]', list => list[list.length - 1].dataset.userRow);
      const sel = `[data-user-row="${last}"]`;
      await page.evaluate(() => { const s = document.querySelector('.shell-scroll'); s.scrollTop = s.scrollHeight; });
      await sleep(200);
      await clickText(page, `${sel} .cfg-urow-act button`, /^Editar$/);
      await sleep(500);
      const top = () => page.$eval(`${sel} .cfg-urow`, node => Math.round(node.getBoundingClientRect().top));
      const before = await top();
      await page.evaluate(s => [...document.querySelectorAll(`${s} .cfg-urow-act button`)].find(b => b.textContent.trim() === 'Cerrar').click(), sel);
      await sleep(400);
      const after = await top();
      assert(Math.abs(after - before) <= 1, `el encabezado se movió ${after - before} px`);
      return `${before} → ${after}`;
    });
    // ── Revisión UX 9 (20/10): huecos, recortes, alturas, aperturas suaves, borradores ──
    await test('cfg', 'Configuración', 'Todos los paneles 360–1920 (oscuro y claro): sin hueco arriba, nada recortado, vecinos de igual alto, sin scroll horizontal', async () => {
      const problems = [];
      for (const panel of PANELS) {
        await openPanel(page, base, panel);
        await settle(page);
        problems.push(...await sweepLayout(page, panel));
      }
      // La lista de secciones (angosto) es su propia página.
      await page.setViewport({ width: 390, height: 800 });
      await page.goto(`${base}/sede/NFPT/settings`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.cfg-list', { timeout: 20000 });
      problems.push(...await sweepLayout(page, 'lista', { widths: [360, 390, 600] }));
      await page.setViewport({ width: 1366, height: 900 });
      assert(!problems.length, problems.slice(0, 12).join('\n'));
      return `${PANELS.length} paneles × ${WIDTHS.length} anchos × 2 temas`;
    });

    await test('cfg', 'Configuración', 'Nada aparece de golpe: filtro de Usuarios, Administrador en Roles y Eliminar rol (alto con transición, control quieto)', async () => {
      const problems = [];
      await page.setViewport({ width: 1440, height: 900 });
      await openPanel(page, base, 'usuarios');
      await settle(page);
      const seg = label => () => page.evaluate(text => [...document.querySelectorAll('.cfg-toolbar [role=radio], .cfg-toolbar button')].find(node => node.textContent.trim().startsWith(text))?.click(), label);
      for (const label of ['Admins', 'Todos']) {
        const rec = await recordFrames(page, { target: '.cfg-tu', anchor: '.cfg-toolbar', act: seg(label) });
        problems.push(...smoothEnough(rec, { label: `Usuarios › ${label}` }));
      }
      await openPanel(page, base, 'roles');
      await page.evaluate(() => [...document.querySelectorAll('.cfg-acc-h button[aria-expanded="false"]')][0].click());
      await sleep(600);
      const body = '.ui-collapse[data-state="open"] .cfg-acc-b';
      const admin = () => page.evaluate(sel => document.querySelector(`${sel} .cfg-checkf [role=checkbox]`).click(), body);
      problems.push(...smoothEnough(await recordFrames(page, { target: body, anchor: `${body} .cfg-grid`, act: admin }), { label: 'Roles › Administrador' }));
      problems.push(...smoothEnough(await recordFrames(page, { target: body, anchor: `${body} .cfg-grid`, act: admin }), { label: 'Roles › Administrador (vuelta)' }));
      const del = () => page.evaluate(sel => [...document.querySelectorAll(`${sel} .cfg-acc-f button`)].find(node => node.textContent.trim() === 'Eliminar rol').click(), body);
      const trigger = `${body} .cfg-acc-f > .ui-btn`;
      problems.push(...smoothEnough(await recordFrames(page, { target: body, anchor: trigger, act: del }), { label: 'Roles › Eliminar rol' }));
      const confirm = await page.$(`${body} .cfg-acc-f .ui-confirm`);
      assert(confirm, 'Eliminar rol no abrió la confirmación en línea');
      await page.evaluate(sel => [...document.querySelectorAll(`${sel} .ui-confirm button`)].find(node => /Cancelar/.test(node.textContent))?.click(), body);
      assert(!problems.length, problems.join('\n'));
      return 'filtro, administrador y eliminar: suaves y quietos';
    });

    await test('cfg', 'Configuración', 'Usuarios: pasar a editar otro no borra lo tipeado (avisa sin guardar); Cancelar lo reinicia', async () => {
      await openPanel(page, base, 'usuarios');
      await settle(page);
      const [a, b] = await page.$$eval('[data-user-row]', list => list.slice(0, 2).map(node => node.dataset.userRow));
      assert(a && b, 'hacen falta dos usuarios');
      const rowA = `[data-user-row="${a}"]`;
      const nameInput = () => page.evaluateHandle(sel => {
        const form = document.querySelector(`${sel} .cfg-uform`);
        const label = form && [...form.querySelectorAll('label.ui-label')].find(node => node.textContent.trim().startsWith('Nombre'));
        return label ? document.getElementById(label.htmlFor) : null;
      }, rowA).then(handle => handle.asElement());
      await clickText(page, `${rowA} .cfg-urow-act button`, /^Editar$/);
      await sleep(400);
      const input = await until(nameInput, { message: 'campo Nombre del usuario A' });
      const original = await input.evaluate(node => node.value);
      await input.click({ clickCount: 3 });
      await input.type(' e2e borrador');
      await clickText(page, `[data-user-row="${b}"] .cfg-urow-act button`, /^Editar$/);
      await sleep(500);
      assert(/sin guardar/.test(await textOf(page, '.cfg-nav-i[data-panel="usuarios"]')), 'el menú de Configuración no marca Usuarios como sin guardar');
      await clickText(page, `${rowA} .cfg-urow-act button`, /^Editar$/);
      await sleep(500);
      const kept = await (await nameInput()).evaluate(node => node.value);
      assert(kept.endsWith('e2e borrador'), `se perdió lo tipeado: "${kept}"`);
      await clickText(page, `${rowA} .cfg-uform button`, /^Cancelar$/);
      await sleep(500);
      await clickText(page, `${rowA} .cfg-urow-act button`, /^Editar$/);
      await sleep(500);
      const reset = await (await nameInput()).evaluate(node => node.value);
      assert(reset === original, `Cancelar no reinició el formulario: "${reset}"`);
      await clickText(page, `${rowA} .cfg-uform button`, /^Cancelar$/);
      return `${a}: "${kept}" sobrevivió; Cancelar volvió a "${original}"`;
    });
  } finally {
    await context.close();
  }

  const view = await openContext(browser, { base, token: consulta.token, releaseVersion });
  track(view.page);
  try {
    await test('cfg', 'Configuración', 'Rol sin admin: solo Tu cuenta y Turnos; Turnos de solo lectura; Usuarios explica que es de admin', async () => {
      await openPanel(view.page, base, 'turnos');
      const panels = await view.page.$$eval('.cfg-nav-i', list => list.map(node => node.dataset.panel));
      assert(!panels.includes('usuarios') && !panels.includes('modulos'), `ve administración: ${panels.join(',')}`);
      const disabled = await view.page.$$eval('[data-settings-panel="turnos"] input', list => list.length > 0 && list.every(input => input.disabled));
      assert(disabled, 'Turnos editable en solo consulta');
      await openPanel(view.page, base, 'usuarios');
      assert(/para administradores/.test(await textOf(view.page, '[data-settings-panel="usuarios"]')), 'no explica el acceso');
      return panels.join(',');
    });
  } finally {
    await view.context.close();
  }
}
