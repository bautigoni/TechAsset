// qa-a) QA de lanzamiento, frente A (docs/redesign/qa/HALLAZGOS-1.md, ítems 5,
// 6, 7, 8, 10, 11, 12, 13, 15 y 16): ingreso, cuenta, privacidad, mails y
// endurecimiento del server. En la copia de la base, sin mails reales.
//   - sin sesión no se pide nada protegido ni se baja el Inicio; la pantalla de
//     arranque (#boot) se pinta antes del JS, en oscuro y en claro;
//   - Privacidad sin sesión (y desde landing, ingreso y Configuración › Cuenta);
//     una ruta que no existe: "Esta página no existe" (404);
//   - registro: tope de largo y formato de mail ANTES de gastar la invitación,
//     política de contraseña, sin controles invisibles en el nombre, mails con
//     el nombre de la sede, 24 h, sin "pendiente" ni "Turno";
//   - topes por campo en otras escrituras (tareas) con 400 en español;
//   - cambiar contraseña desde Cuenta (cierra las otras sesiones);
//   - Cuenta y Notificaciones sin jerga.
import fs from 'node:fs';
import path from 'node:path';
import { root, COOKIE_NAME } from '../lib/env.mjs';
import { assert, openContext, pathname, sleep, typeInto, until } from '../lib/browser.mjs';
import { formatProbe, probeView } from '../lib/ux-probe.mjs';

const outDir = path.join(root, 'e2e', '.out', 'qa-a');
const SUBMIT = '#auth-form button[type="submit"]';
const EMAIL = '#auth-form input[type="email"]';
// Controles invisibles armados por código (en el fuente no puede haber ninguno).
const RLO = String.fromCodePoint(0x202e);
const PDF = String.fromCodePoint(0x202c);
const ZWSP = String.fromCodePoint(0x200b);
const INVISIBLE = new RegExp(`[${String.fromCodePoint(0x200b)}-${String.fromCodePoint(0x200f)}${String.fromCodePoint(0x202a)}-${String.fromCodePoint(0x202e)}${String.fromCodePoint(0x2066)}-${String.fromCodePoint(0x2069)}${String.fromCodePoint(0xfeff)}]`);

const msgText = page => page.evaluate(() => (document.querySelector('.auth-msg')?.textContent || '').replace(/\s+/g, ' ').trim());
const bodyText = page => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));

async function shot(page, name) {
  fs.mkdirSync(outDir, { recursive: true });
  await sleep(250);
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true }).catch(() => {});
}

function readMails(file) {
  if (!file || !fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
}

async function clickByText(page, selector, rx) {
  await until(() => page.evaluate((sel, src, flags) => {
    const re = new RegExp(src, flags);
    const el = [...document.querySelectorAll(sel)].find(node => re.test((node.textContent || node.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()) && node.getBoundingClientRect().width && !node.disabled && !node.closest('.ui-collapse:not([data-state="open"])'));
    if (!el) return false;
    el.click();
    return true;
  }, selector, rx.source, rx.flags), { message: `${selector} ${rx}` });
}

/** POST sin sesión (registro, login) desde Node. */
async function post(base, url, body, cookie = '') {
  const response = await fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  const setCookie = response.headers.get('set-cookie') || '';
  return { status: response.status, data, setCookie };
}
const sessionCookieFrom = setCookie => setCookie.match(new RegExp(`${COOKIE_NAME}=([a-f0-9]{20,})`))?.[1] || '';

export async function qaATests({ browser, base, api, releaseVersion, test, track = () => {}, mailFile }) {
  const stamp = Date.now();
  const sites = (await api.get('/api/sites')).data?.items || [];
  const nfpt = sites.find(site => site.siteCode === 'NFPT');
  const newInvite = async (email = '') => {
    const created = await api.post('/api/invites', { role: 'Consulta', siteCode: 'NFPT', ...(email ? { email } : {}), expiresInDays: 1 });
    assert(created.status === 200 && created.data.invite?.code, `no se pudo crear la invitación (${created.status})`);
    return created.data.invite.code;
  };
  const inviteStatus = async code => ((await api.get('/api/invites')).data?.items || []).find(item => item.code === code)?.status;

  await test('qa-a', 'QA frente A', 'Sin sesión: la landing no pide nada protegido ni baja el Inicio, y no pollea (16 s)', async () => {
    const ctx = await openContext(browser, { base, token: '', releaseVersion, viewport: { width: 375, height: 812 } });
    try {
      const { page } = ctx;
      track(page);
      const api401 = [];
      const apiCalls = [];
      const chunks = [];
      page.on('response', response => {
        const url = new URL(response.url());
        if (url.pathname.startsWith('/api/')) { apiCalls.push(url.pathname); if (response.status() === 401) api401.push(url.pathname); }
        if (url.pathname.startsWith('/assets/') && url.pathname.endsWith('.js')) chunks.push(url.pathname);
      });
      await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.landing-hero h1');
      await sleep(16500);
      assert(!api401.length, `pidió APIs protegidas sin sesión: ${api401.join(', ')}`);
      assert(apiCalls.every(call => call.startsWith('/api/auth/')), `pidió algo fuera de /api/auth: ${apiCalls.join(', ')}`);
      assert(!chunks.some(name => /\/Dashboard-/.test(name)), 'la landing bajó el chunk del Inicio');
      return `APIs: ${[...new Set(apiCalls)].join(', ')} · ${chunks.length} chunks JS`;
    } finally {
      await ctx.context.close().catch(() => {});
    }
  });

  await test('qa-a', 'QA frente A', 'Arranque: la marca y "Cargando…" se pintan antes del JS (oscuro y claro) y se van solos', async () => {
    const results = [];
    for (const theme of ['dark', 'light']) {
      const ctx = await openContext(browser, { base, token: '', releaseVersion, viewport: { width: 390, height: 844 } });
      try {
        const { page } = ctx;
        track(page);
        if (theme === 'light') await page.evaluateOnNewDocument(() => { try { localStorage.setItem('techasset_theme', 'light'); } catch { /* sin storage */ } });
        // El JS de entrada se demora: lo que se ve mientras tanto es el HTML.
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        await page.setRequestInterception(true);
        page.on('request', request => {
          if (/\/assets\/index-[^/]+\.js$/.test(request.url())) gate.then(() => request.continue()).catch(() => {});
          else request.continue().catch(() => {});
        });
        // DOMContentLoaded espera al JS de entrada (módulo diferido): no se espera la navegación hasta soltarlo.
        const navigation = page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('#boot');
        await sleep(900);
        const boot = await page.evaluate(() => {
          const el = document.getElementById('boot');
          const style = getComputedStyle(el);
          return { visible: style.display !== 'none' && el.getBoundingClientRect().height > 0, text: el.innerText.replace(/\s+/g, ' ').trim(), color: style.color, bg: getComputedStyle(document.documentElement).backgroundColor };
        });
        await shot(page, `arranque-${theme}-390`);
        release();
        await navigation;
        await page.waitForSelector('.landing-hero h1');
        const hidden = await page.evaluate(() => getComputedStyle(document.getElementById('boot')).display === 'none');
        assert(boot.visible && /TechAsset/.test(boot.text) && /Cargando/.test(boot.text), `sin marca ni "Cargando…" antes del JS (${JSON.stringify(boot)})`);
        const dark = theme === 'dark';
        assert(dark ? boot.bg === 'rgb(13, 15, 18)' : boot.bg === 'rgb(246, 247, 249)', `fondo de arranque ${boot.bg} no es el del tema ${theme}`);
        assert(dark ? boot.color === 'rgb(236, 238, 241)' : boot.color === 'rgb(20, 23, 27)', `texto de arranque ${boot.color} no es el del tema ${theme}`);
        assert(hidden, 'la pantalla de arranque sigue a la vista con la landing');
        results.push(`${theme}: ${boot.text}`);
      } finally {
        await ctx.context.close().catch(() => {});
      }
    }
    return results.join(' · ');
  });

  await test('qa-a', 'QA frente A', 'Ruta inexistente: "Esta página no existe" con 404 y volver al inicio; /privacidad sin sesión', async () => {
    const missing = await fetch(`${base}/terminos-que-no-existen`);
    assert(missing.status === 404, `/terminos-que-no-existen responde ${missing.status}`);
    const privacyStatus = (await fetch(`${base}/privacidad`)).status;
    assert(privacyStatus === 200, `/privacidad responde ${privacyStatus}`);
    const ctx = await openContext(browser, { base, token: '', releaseVersion, viewport: { width: 1366, height: 900 } });
    try {
      const { page } = ctx;
      track(page);
      await page.goto(`${base}/terminos-que-no-existen`, { waitUntil: 'domcontentloaded' });
      await until(async () => /Esta página no existe/.test(await bodyText(page)), { message: '"Esta página no existe"' });
      await shot(page, 'no-existe-1366');
      await clickByText(page, 'button', /Ir al inicio/);
      await page.waitForSelector('.landing-hero h1');
      assert((await pathname(page)) === '/', 'no volvió a la landing');

      // Landing → pie "Privacidad y uso" (sin recargar) → Volver al inicio.
      await clickByText(page, '.auth-foot a', /Privacidad y uso/);
      await until(async () => (await pathname(page)) === '/privacidad', { message: '/privacidad' });
      await until(async () => /no tiene IA conectada|usa IA de/.test(await bodyText(page)), { message: 'el dato del asistente de este servidor' });
      const text = await bodyText(page);
      for (const needle of ['Quién la administra', 'Jefe TIC', 'Qué datos tuyos se guardan', 'firmado con tu nombre', 'Cuánto tiempo', 'Mails que te manda', 'inteligencia artificial', 'Cookies', 'darte de baja']) {
        assert(text.includes(needle), `Privacidad no dice "${needle}"`);
      }
      assert(!/sin seguimiento de lo que hac/i.test(text), 'sigue la promesa "sin seguimiento de lo que hacés"');
      await shot(page, 'privacidad-sin-sesion-1366');
      await page.setViewport({ width: 360, height: 800 });
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(over <= 0, `Privacidad scrollea de costado a 360 px (${over}px)`);
      await shot(page, 'privacidad-sin-sesion-360');
      await page.setViewport({ width: 1366, height: 900 });
      await clickByText(page, 'button', /Volver al inicio/);
      await page.waitForSelector('.landing-hero h1');

      // La landing ya no promete "sin seguimiento" y enlaza Privacidad; el ingreso también.
      const landing = await bodyText(page);
      assert(!/ni seguimiento de lo que hac/i.test(landing), 'la landing sigue prometiendo "sin seguimiento de lo que hacés"');
      assert(/firmado con tu nombre/.test(landing), 'la landing no aclara que lo que hacés queda firmado');
      await page.goto(`${base}/register`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#auth-form');
      await clickByText(page, '.auth-notes a', /Privacidad y uso/);
      await until(async () => (await pathname(page)) === '/privacidad', { message: 'Privacidad desde el registro' });
      await page.goBack();
      await until(async () => (await pathname(page)) === '/register', { message: 'Atrás vuelve al registro' });
      await page.waitForSelector('#auth-form');
      return '404 + pantalla propia; Privacidad desde landing y registro, Atrás vuelve';
    } finally {
      await ctx.context.close().catch(() => {});
    }
  });

  await test('qa-a', 'QA frente A', 'Sonda REGLAS-UX en Privacidad, "no existe" e ingreso con "Olvidé mi contraseña" abierto (390/1024/1440, oscuro y claro)', async () => {
    const ctx = await openContext(browser, { base, token: '', releaseVersion, viewport: { width: 1440, height: 900 } });
    try {
      const { page } = ctx;
      track(page);
      const problems = [];
      const screens = [
        { url: '/privacidad', ready: async () => until(async () => /no tiene IA conectada|usa IA de/.test(await bodyText(page)), { message: 'Privacidad' }) },
        { url: '/no-existe-esto', ready: async () => until(async () => /Esta página no existe/.test(await bodyText(page)), { message: 'no existe' }) },
        { url: '/login', ready: async () => { await page.waitForSelector('#auth-form'); await clickByText(page, '#auth-form button', /^Olvidé mi contraseña$/); await page.waitForSelector('.ui-collapse[data-state="open"] #auth-forgot'); await sleep(350); } }
      ];
      for (const width of [390, 1024, 1440]) {
        await page.setViewport({ width, height: width < 768 ? 844 : 900 });
        for (const screen of screens) {
          await page.goto(`${base}${screen.url}`, { waitUntil: 'domcontentloaded' });
          await screen.ready();
          for (const theme of ['dark', 'light']) {
            await page.evaluate(value => { document.documentElement.dataset.theme = value; document.documentElement.classList.toggle('theme-light', value === 'light'); }, theme);
            const probe = await probeView(page, { scope: '.auth', scrollSteps: 0 });
            if (probe.error || probe.total) problems.push(`${screen.url} ${width} ${theme}: ${formatProbe(probe)}`);
            const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            if (over > 0) problems.push(`${screen.url} ${width} ${theme}: scroll horizontal ${over}px`);
          }
          if (width === 390) await shot(page, `sonda${screen.url.replace(/\//g, '-')}-390`);
        }
      }
      assert(!problems.length, problems.slice(0, 5).join(' || '));
      return '3 pantallas × 3 anchos × 2 temas en 0';
    } finally {
      await ctx.context.close().catch(() => {});
    }
  });

  await test('qa-a', 'QA frente A', 'Registro (API): mail largo o inválido, contraseña débil y código raro no gastan la invitación; nombre sin controles invisibles', async () => {
    const code = await newInvite();
    const longMail = `${'a'.repeat(5000)}@qa.test`;
    const tooLong = await post(base, '/api/auth/register', { email: longMail, nombre: 'Largo', code, password: 'clave-segura-1' });
    assert(tooLong.status === 400 && /mail/i.test(tooLong.data.error || ''), `mail de 5008: ${tooLong.status} ${tooLong.data.error}`);
    const badMail = await post(base, '/api/auth/register', { email: 'sin-dominio@', nombre: 'X', code, password: 'clave-segura-1' });
    assert(badMail.status === 400, `mail inválido: ${badMail.status}`);
    for (const weak of ['123456', '12345678', 'password', 'qa-weak@qa.test']) {
      const response = await post(base, '/api/auth/register', { email: 'qa-weak@qa.test', nombre: 'Débil', code, password: weak });
      assert(response.status === 400 && response.data.field === 'password', `aceptó la contraseña "${weak}" (${response.status})`);
    }
    const oddCode = await post(base, '/api/auth/register', { email: 'qa-code@qa.test', nombre: 'X', code: `${code}-${'X'.repeat(40)}`, password: 'clave-segura-1' });
    assert(oddCode.status === 400 && oddCode.data.field === 'code', `código de 50+: ${oddCode.status}`);
    assert((await inviteStatus(code)) === 'Activa', `la invitación se gastó con datos rechazados (${await inviteStatus(code)})`);

    const email = `qa-a-bidi-${stamp}@qa.test`;
    const name = `QA ${RLO}live${PDF} Cero${ZWSP}${ZWSP}ancho`;
    const ok = await post(base, '/api/auth/register', { email, nombre: name, code, password: 'clave-segura-1' });
    assert(ok.status === 200 && ok.data.authenticated && ok.data.user?.email === email, `registro: ${ok.status} ${JSON.stringify(ok.data).slice(0, 200)}`);
    assert(sessionCookieFrom(ok.setCookie), 'el registro no abrió la sesión (sin cookie)');
    assert(!INVISIBLE.test(ok.data.user.nombre), `el nombre guardado conserva controles invisibles: ${JSON.stringify(ok.data.user.nombre)}`);
    assert((await inviteStatus(code)) === 'Usada', 'la invitación no quedó usada');
    const again = await post(base, '/api/auth/register', { email: `otro-${stamp}@qa.test`, nombre: 'Otro', code, password: 'clave-segura-1' });
    assert(again.status === 403, `segundo registro con el mismo código: ${again.status}`);
    return `nombre guardado: "${ok.data.user.nombre}"`;
  });

  await test('qa-a', 'QA frente A', 'Mails de registro: activa (sin "pendiente"), nombre de la sede, 24 h en hora del colegio, sin "Turno"', async () => {
    const email = `qa-a-mail-${stamp}@qa.test`;
    const code = await newInvite(email);
    const response = await post(base, '/api/auth/register', { email, nombre: 'QA Mails', code, password: 'clave-segura-2' });
    assert(response.status === 200, `registro ${response.status}`);
    const userMail = await until(() => readMails(mailFile).reverse().find(item => (item.to || []).includes(email)), { timeout: 8000, message: 'el mail al usuario' });
    const siteName = nfpt?.nombre || 'NFPT';
    assert(/lista/i.test(userMail.subject || '') && !/pendiente/i.test(`${userMail.subject} ${userMail.text}`), `mail al usuario: "${userMail.subject}" ${String(userMail.text).slice(0, 160)}`);
    assert(String(userMail.text).includes(siteName), `el mail al usuario no nombra la sede "${siteName}"`);
    const adminMail = readMails(mailFile).reverse().find(item => /Nueva cuenta/.test(item.subject || '') && String(item.text || '').includes(email));
    if (adminMail) {
      const text = String(adminMail.text);
      assert(!/pendiente/i.test(text) && !/Turno/.test(text), `mail al admin: ${text.slice(0, 200)}`);
      assert(text.includes(siteName), `el mail al admin no nombra la sede "${siteName}"`);
      const fecha = text.match(/Fecha: (\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/);
      assert(fecha, `la fecha no es dd/mm/aaaa hh:mm: ${text.match(/Fecha:.*/)?.[0]}`);
      const hourAr = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
      assert(Math.abs(Number(fecha[4]) - hourAr) <= 1 || Math.abs(Number(fecha[4]) - hourAr) === 23, `hora ${fecha[4]} vs hora del colegio ${hourAr}`);
    }
    return `usuario: "${userMail.subject}"${adminMail ? ` · admin: "${adminMail.subject}"` : ' · (sin admins de NFPT a quien avisar en la copia)'}`;
  });

  await test('qa-a', 'QA frente A', 'Topes por campo en escrituras: título > 200 y descripción > 10 000 → 400 en español; título sin controles invisibles', async () => {
    const longTitle = await api.post('/api/tasks', { titulo: 'T'.repeat(250), descripcion: 'x' });
    assert(longTitle.status === 400 && /El título supera el máximo de 200/.test(longTitle.data.error || ''), `título de 250: ${longTitle.status} ${longTitle.data.error}`);
    const longText = await api.post('/api/tasks', { titulo: 'QA tope', descripcion: 'x'.repeat(20000) });
    assert(longText.status === 400 && /La descripción supera el máximo de 10.000/.test(longText.data.error || ''), `descripción de 20 000: ${longText.status} ${longText.data.error}`);
    const longPerson = await api.post('/api/loans/lend', { etiqueta: 'NO-EXISTE', person: 'P'.repeat(10000) });
    assert(longPerson.status === 400 && /nombre de la persona/.test(longPerson.data.error || ''), `persona de 10 000: ${longPerson.status} ${longPerson.data.error}`);
    const clean = await api.post('/api/tasks', { titulo: `QA ${RLO}live${PDF} ${stamp}`, descripcion: 'tope ok' });
    assert(clean.status === 200, `tarea normal: ${clean.status} ${JSON.stringify(clean.data).slice(0, 160)}`);
    const saved = clean.data.item?.titulo || '';
    assert(saved && !INVISIBLE.test(saved), `el título guardado conserva controles invisibles: ${JSON.stringify(saved)}`);
    if (clean.data.item?.id) await api.del(`/api/tasks/${clean.data.item.id}`);
    return `"${longTitle.data.error}" · "${longText.data.error}"`;
  });

  await test('qa-a', 'QA frente A', 'Registro (pantalla): contraseña débil marcada en línea sin mandar; Cuenta sin jerga, cambiar contraseña cierra las otras sesiones; Notificaciones sin "Activar"', async () => {
    const email = `qa-a-ui-${stamp}@qa.test`;
    const code = await newInvite(email);
    const ctx = await openContext(browser, { base, token: '', releaseVersion, viewport: { width: 1366, height: 900 } });
    try {
      const { page } = ctx;
      track(page);
      let registerPosts = 0;
      page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/auth/register') registerPosts += 1; });
      await page.goto(`${base}/register?code=${encodeURIComponent(code)}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#auth-form');
      await typeInto(page, '#auth-form input[autocomplete="name"]', 'QA Cuenta');
      await typeInto(page, EMAIL, email);
      await typeInto(page, '#auth-form input[autocomplete="new-password"]', '12345678');
      await page.click(SUBMIT);
      await until(() => page.evaluate(() => /fácil de adivinar/.test(document.querySelector('#auth-form')?.innerText || '')), { message: 'el aviso de contraseña débil' });
      await sleep(300);
      assert(registerPosts === 0, 'mandó el registro con una contraseña débil');
      await shot(page, 'registro-debil-1366');
      await typeInto(page, '#auth-form input[autocomplete="new-password"]', 'cuenta-QA-2026');
      await page.click(SUBMIT);
      await page.waitForSelector('.shell', { timeout: 20000 });

      // Otra sesión abierta (otro dispositivo) para ver que el cambio la cierra.
      const other = await post(base, '/api/auth/login', { email, password: 'cuenta-QA-2026' });
      const otherCookie = `${COOKIE_NAME}=${sessionCookieFrom(other.setCookie)}`;
      assert(other.status === 200 && otherCookie.length > 30, `login en el otro dispositivo: ${other.status}`);

      await page.goto(`${base}/sede/nfpt/settings/cuenta`, { waitUntil: 'domcontentloaded' });
      await until(async () => /Usuario actual/.test(await bodyText(page)), { timeout: 20000, message: 'Configuración › Cuenta' });
      await until(async () => /Cambiar contraseña/.test(await bodyText(page)), { message: 'el botón Cambiar contraseña' });
      const account = await bodyText(page);
      assert(!/SQLite|Base de datos|Base local/i.test(account), 'Cuenta sigue mostrando jerga de la base');
      assert(/solo lectura/.test(account) && !/como la ve el jefe/.test(account), 'el texto de Modo consulta sigue ambiguo');
      assert(/Privacidad y uso/.test(account) && /darte de baja/.test(account), 'Cuenta no dice cómo pedir la baja ni enlaza Privacidad');
      await clickByText(page, 'button', /^Cambiar contraseña$/);
      await page.waitForSelector('#cfg-pw-current');
      await typeInto(page, '#cfg-pw-current', 'no-es-la-actual');
      await typeInto(page, '#cfg-pw-next', 'otra-clave-QA-1');
      await typeInto(page, '#cfg-pw-repeat', 'otra-clave-QA-1');
      await clickByText(page, '#cfg-pw-form button', /^Cambiar contraseña$/);
      await until(async () => /La contraseña actual no es correcta/.test(await bodyText(page)), { message: 'el error de contraseña actual' });
      assert((await page.$eval('#cfg-pw-next', input => input.value)) === 'otra-clave-QA-1', 'el error borró la contraseña nueva');
      await typeInto(page, '#cfg-pw-current', 'cuenta-QA-2026');
      await typeInto(page, '#cfg-pw-next', 'password');
      await typeInto(page, '#cfg-pw-repeat', 'password');
      await clickByText(page, '#cfg-pw-form button', /^Cambiar contraseña$/);
      await until(async () => /fácil de adivinar/.test(await bodyText(page)), { message: 'la contraseña débil en Cuenta' });
      await typeInto(page, '#cfg-pw-next', 'otra-clave-QA-1');
      await typeInto(page, '#cfg-pw-repeat', 'otra-clave-QA-1');
      await clickByText(page, '#cfg-pw-form button', /^Cambiar contraseña$/);
      await until(async () => /Contraseña cambiada/.test(await bodyText(page)), { message: '"Contraseña cambiada"' });
      await shot(page, 'cuenta-contrasena-ok-1366');
      const still = await page.evaluate(() => fetch('/api/auth/session').then(r => r.json()));
      assert(still.authenticated, 'cambiar la contraseña cerró esta sesión');
      const otherSession = await (await fetch(`${base}/api/auth/session`, { headers: { cookie: otherCookie } })).json();
      assert(!otherSession.authenticated, 'la sesión del otro dispositivo sigue abierta');
      const relogin = await post(base, '/api/auth/login', { email, password: 'otra-clave-QA-1' });
      assert(relogin.status === 200, `no entra con la contraseña nueva (${relogin.status})`);
      assert(readMails(mailFile).some(item => (item.to || []).includes(email) && /Cambiaste tu contraseña/.test(item.subject || '')), 'no salió el aviso de contraseña cambiada');

      // Privacidad desde Cuenta y vuelta a la app.
      await clickByText(page, 'a', /^Privacidad y uso$/);
      await until(async () => (await pathname(page)) === '/privacidad', { message: 'Privacidad desde Cuenta' });
      await until(async () => /Tu sede/.test(await bodyText(page)), { message: 'Privacidad muestra la sede' });
      await clickByText(page, 'button', /Volver a la app/);
      await until(async () => (await pathname(page)).startsWith('/sede/nfpt/settings'), { message: 'volver a Configuración' });
      await page.waitForSelector('.shell');

      // Notificaciones sin push en el server: sin "Activar", explica campana y mail.
      await page.goto(`${base}/sede/nfpt/settings/notificaciones`, { waitUntil: 'domcontentloaded' });
      await until(async () => /Notificaciones push/.test(await bodyText(page)), { timeout: 20000, message: 'Notificaciones' });
      await until(async () => /campana/.test(await bodyText(page)), { message: 'la explicación de la campana' });
      const notif = await bodyText(page);
      assert(!/El servidor no tiene push configurado/.test(notif), 'sigue la jerga de push');
      const activar = await page.evaluate(() => [...document.querySelectorAll('button')].some(button => /^Activar$/.test(button.textContent.trim()) && button.getBoundingClientRect().width));
      assert(!activar, 'sigue el botón "Activar" sin push en el server');
      await shot(page, 'notificaciones-sin-push-1366');
      return 'débil en línea sin request; Cuenta sin jerga; contraseña cambiada y otra sesión cerrada; Notificaciones sin Activar';
    } finally {
      await ctx.context.close().catch(() => {});
    }
  });
}
