// lg) Login y landing (etapa 9), de punta a punta en la copia de la base:
//   invitación (API del admin) → /register?code= (código precargado, URL limpia,
//   un solo request aunque se toque dos veces) → "olvidé mi contraseña" (mensaje
//   neutro; el link sale del archivo de mails de prueba, NODE_ENV=test) →
//   "Elegí tu contraseña" (no coinciden: no se pierde lo escrito) → contraseña
//   mala (error en línea, el mail queda) → ingreso → sesión vencida (vuelve a la
//   misma vista, con "Entrás a la sede") → cerrar sesión → link de sede sin
//   sesión ("Usar mi sede por defecto"). Además: Google oculto sin config,
//   errores de la URL traducidos, landing → "Tengo un código", tema.
// Capturas en e2e/.out/etapa9/.
import fs from 'node:fs';
import path from 'node:path';
import { root, COOKIE_NAME } from '../lib/env.mjs';
import { assert, openContext, pathname, sleep, typeInto, until } from '../lib/browser.mjs';
import { NAV_ITEM } from './functional.mjs';
import { formatProbe, probeView } from '../lib/ux-probe.mjs';
import { smooth, unevenRows, watchHeight } from './knowledgeCanvas.mjs';

const outDir = path.join(root, 'e2e', '.out', 'etapa9');
const SUBMIT = '#auth-form button[type="submit"]';
const EMAIL = '#auth-form input[type="email"]';
const msgText = page => page.evaluate(() => (document.querySelector('.auth-msg')?.textContent || '').replace(/\s+/g, ' ').trim());
const visible = (page, selector) => page.evaluate(sel => {
  const el = document.querySelector(sel);
  if (!el) return false;
  const closed = el.closest('.ui-collapse[data-state="closed"]');
  const r = el.getBoundingClientRect();
  return !closed && r.width > 0 && r.height > 0;
}, selector);

async function shot(page, name) {
  fs.mkdirSync(outDir, { recursive: true });
  await sleep(320);
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true }).catch(() => {});
}

async function setTheme(page, theme) {
  await page.evaluate(value => {
    document.documentElement.dataset.theme = value;
    document.documentElement.classList.toggle('theme-light', value === 'light');
  }, theme);
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

export async function authTests({ browser, base, api, releaseVersion, test, track = () => {}, mailFile }) {
  const email = `e2e-login-${Date.now()}@e2e.local`;
  const firstPassword = 'inicial123';
  const newPassword = 'nueva456';
  const anon = await openContext(browser, { base, token: '', releaseVersion, viewport: { width: 1440, height: 900 } });
  const { page } = anon;
  track(page);
  let registerPosts = 0;
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/auth/register') registerPosts += 1; });
  let otherView = '';

  try {
    await test('lg', 'Login', 'Invitación → registro (código del link, sin doble envío) → link de contraseña → ingreso', async () => {
      const created = await api.post('/api/invites', { role: 'Consulta', siteCode: 'NFPT', email, expiresInDays: 1 });
      assert(created.status === 200 && created.data.invite?.code, `no se pudo crear la invitación (${created.status} ${JSON.stringify(created.data).slice(0, 200)})`);
      const code = created.data.invite.code;

      // Landing → "Tengo un código" abre el registro.
      await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.landing-hero h1');
      await shot(page, 'landing-oscuro-1440');
      await setTheme(page, 'light');
      await shot(page, 'landing-claro-1440');
      await setTheme(page, 'dark');
      await clickByText(page, '.landing-cta button', /Tengo un código/);
      await until(async () => (await pathname(page)) === '/register', { message: '/register desde la landing' });

      // El link de la invitación: código precargado y la URL sin el código.
      await page.goto(`${base}/register?code=${encodeURIComponent(code)}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#auth-form');
      await until(async () => (await pathname(page)) === '/register', { message: 'la URL sin ?code=' });
      const codeValue = await page.$eval('.auth-code input', input => input.value);
      assert(codeValue === code, `el código quedó "${codeValue}" (esperaba ${code})`);
      assert(/Lo tomamos del link/.test(await page.evaluate(() => document.querySelector('.auth-code')?.textContent || '')), 'falta la ayuda "Lo tomamos del link"');
      // Google: sin configuración no aparece.
      assert(!(await visible(page, '#auth-form .ui-btn img, #auth-form button svg[viewBox="0 0 48 48"]')), 'el botón de Google se ve sin estar configurado');

      await typeInto(page, '#auth-form input[autocomplete="name"]', 'E2E Login');
      await typeInto(page, EMAIL, email);
      await typeInto(page, '#auth-form input[autocomplete="new-password"]', firstPassword);
      await shot(page, 'registro-oscuro-1440');
      // Doble toque: un solo registro.
      await page.click(SUBMIT, { clickCount: 1 });
      await page.click(SUBMIT, { clickCount: 1 }).catch(() => {});
      await until(async () => /Cuenta creada/.test(await msgText(page)), { message: 'el aviso "Cuenta creada"' });
      await sleep(400);
      assert(registerPosts === 1, `se mandaron ${registerPosts} registros (esperaba 1)`);
      await until(async () => (await pathname(page)) === '/login', { message: 'pasa a Ingresar' });
      const kept = await page.$eval(EMAIL, input => input.value);
      assert(kept === email, `el mail no quedó puesto en Ingresar ("${kept}")`);
      await shot(page, 'registro-ok-oscuro-1440');

      // "Olvidé mi contraseña": mensaje neutro y el link en el mail de prueba.
      await clickByText(page, '#auth-form button', /Olvidé mi contraseña/);
      await until(async () => /Si el mail tiene acceso a TechAsset/.test(await msgText(page)), { message: 'el mensaje neutro del link' });
      const mail = await until(() => readMails(mailFile).reverse().find(item => (item.to || []).includes(email) && /login\?password=/.test(item.text || '')), { timeout: 8000, message: 'el mail con el link de contraseña' });
      const link = mail.text.match(/https?:\/\/\S*login\?password=([a-f0-9]+)/);
      assert(link, 'el mail no trae el link');

      // "Elegí tu contraseña": si no coinciden, lo escrito queda.
      await page.goto(`${base}/login?password=${link[1]}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#auth-form');
      await until(async () => /Elegí tu contraseña/.test(await page.$eval('h1', h => h.textContent)), { message: 'la pantalla "Elegí tu contraseña"' });
      assert((await pathname(page)) === '/login', 'el token quedó en la URL');
      const pwInputs = await page.$$('#auth-form input[autocomplete="new-password"]');
      assert(pwInputs.length === 2, `esperaba 2 campos de contraseña (hay ${pwInputs.length})`);
      await typeInto(page, pwInputs[0], newPassword);
      await typeInto(page, pwInputs[1], 'otra000');
      await page.click(SUBMIT);
      await until(async () => /no coinciden/.test(await msgText(page)), { message: 'el error "no coinciden"' });
      assert((await pwInputs[0].evaluate(input => input.value)) === newPassword, 'se perdió la contraseña escrita');
      await shot(page, 'contrasena-error-oscuro-1440');
      await typeInto(page, pwInputs[1], newPassword);
      await page.click(SUBMIT);
      await until(async () => /ya podés entrar/.test(await msgText(page)), { message: 'el OK de la contraseña nueva' });
      assert((await page.$eval(EMAIL, input => input.value)) === email, 'no volvió a Ingresar con el mail puesto');

      // Contraseña vieja: error en línea y el mail no se borra.
      await typeInto(page, '#auth-form input[autocomplete="current-password"]', firstPassword);
      await page.click(SUBMIT);
      await until(async () => /incorrectos/.test(await msgText(page)), { message: 'el error de credenciales' });
      assert((await page.$eval(EMAIL, input => input.value)) === email, 'el error borró el mail');
      await shot(page, 'login-error-oscuro-1440');

      await typeInto(page, '#auth-form input[autocomplete="current-password"]', newPassword);
      await page.click(SUBMIT);
      await page.waitForSelector('.shell', { timeout: 20000 });
      await until(async () => (await pathname(page)).startsWith('/sede/nfpt/'), { message: 'entra a su sede' });
      return `${email}: registro (1 request), link, contraseña nueva, ingreso`;
    });

    await test('lg', 'Login', 'Sesión vencida → vuelve a la misma vista; cerrar sesión; link de sede sin sesión', async () => {
      await page.waitForSelector(NAV_ITEM, { timeout: 20000 });
      const views = await page.$$eval(NAV_ITEM, items => items.map(item => item.getAttribute('data-view')).filter(Boolean));
      otherView = views.find(view => view !== 'dashboard' && view !== 'ui') || '';
      assert(otherView, `no hay otra vista en el menú (${views.join(', ')})`);
      // Sesión inválida desde ahora; la próxima pantalla pide datos → 401.
      await page.setCookie({ name: COOKIE_NAME, value: 'vencida-e2e', domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' });
      await page.$eval(`${NAV_ITEM}[data-view="${otherView}"]`, button => button.click());
      await until(async () => (await pathname(page)).startsWith('/login'), { timeout: 12000, message: 'el login por sesión vencida' });
      await until(async () => /Tu sesión venció/.test(await msgText(page)), { message: 'el aviso de sesión vencida' });
      assert(await visible(page, '.auth-site'), 'falta "Entrás a la sede"');
      await shot(page, 'sesion-vencida-oscuro-1440');
      await typeInto(page, EMAIL, email);
      await typeInto(page, '#auth-form input[autocomplete="current-password"]', newPassword);
      await page.click(SUBMIT);
      await page.waitForSelector('.shell', { timeout: 20000 });
      await until(async () => (await pathname(page)) === `/sede/nfpt/${otherView}`, { message: `volver a /${otherView}` });

      // Cerrar sesión: a la landing.
      await page.click('button[aria-label="Menú de cuenta"]');
      await clickByText(page, 'button', /^Cerrar sesión$/);
      await until(async () => (await pathname(page)) === '/', { message: 'la landing después de cerrar sesión' });
      await page.waitForSelector('.landing-hero');
      const session = await page.evaluate(() => fetch('/api/auth/session').then(r => r.json()));
      assert(!session.authenticated, 'la sesión sigue viva después de cerrar');

      // Link a una pantalla sin sesión: ingreso con la sede del link; "Usar mi sede por defecto".
      await page.goto(`${base}/sede/nfpt/${otherView}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#auth-form');
      assert(await visible(page, '.auth-site'), 'el link de sede no muestra "Entrás a"');
      await page.setViewport({ width: 390, height: 844 });
      await shot(page, 'login-link-sede-oscuro-390');
      await setTheme(page, 'light');
      await shot(page, 'login-link-sede-claro-390');
      await setTheme(page, 'dark');
      await page.setViewport({ width: 1440, height: 900 });
      await clickByText(page, '.auth-site button', /Usar mi sede por defecto/);
      await until(async () => !(await visible(page, '.auth-site')), { message: 'se va "Entrás a"' });
      await typeInto(page, EMAIL, email);
      await typeInto(page, '#auth-form input[autocomplete="current-password"]', newPassword);
      await page.click(SUBMIT);
      await page.waitForSelector('.shell', { timeout: 20000 });
      await until(async () => (await pathname(page)) === '/sede/nfpt/dashboard', { message: 'su sede por defecto (Inicio)' });
      return `vencida → /${otherView}; logout → /; link sin sesión con "Usar mi sede por defecto" → Inicio`;
    });

    await test('lg', 'Login', 'Errores de la URL traducidos, tema desde el ingreso y capturas', async () => {
      const ctx = await openContext(browser, { base, token: '', releaseVersion, viewport: { width: 1440, height: 900 } });
      try {
        const p = ctx.page;
        await p.goto(`${base}/login?error=not_authorized`, { waitUntil: 'domcontentloaded' });
        await p.waitForSelector('#auth-form');
        await until(async () => /no está autorizado/.test(await msgText(p)), { message: 'error not_authorized traducido' });
        assert((await pathname(p)) === '/login', 'la URL no se limpió (sigue ?error=)');
        // Tema desde el ingreso: Claro cambia data-theme y theme-color; solo local.
        await clickByText(p, '.auth-theme button', /Claro/);
        await until(() => p.evaluate(() => document.documentElement.dataset.theme === 'light'), { message: 'tema claro' });
        const meta = await p.$eval('meta[name="theme-color"]', m => m.getAttribute('content'));
        assert(/^#F6F7F9$/i.test(meta), `theme-color no sigue al tema (${meta})`);
        await shot(p, 'login-error-claro-1440');
        for (const width of [1024, 768, 390]) {
          await p.setViewport({ width, height: width < 768 ? 844 : 900 });
          await shot(p, `login-claro-${width}`);
        }
        await clickByText(p, '.auth-theme button', /Oscuro/);
        for (const width of [1024, 768, 390]) {
          await p.setViewport({ width, height: width < 768 ? 844 : 900 });
          await shot(p, `login-oscuro-${width}`);
        }
        await p.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
        await p.waitForSelector('.landing-hero');
        await shot(p, 'landing-oscuro-390');
        // Sin scroll horizontal en ningún ancho.
        for (const width of [360, 390, 768, 1024, 1440, 1920]) {
          await p.setViewport({ width, height: 900 });
          for (const url of ['/', '/login', '/register']) {
            await p.goto(`${base}${url}`, { waitUntil: 'domcontentloaded' });
            await p.waitForSelector('.auth');
            const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            assert(over <= 0, `${url} a ${width}px scrollea de costado (${over}px)`);
          }
        }
        // Sonda REGLAS-UX (huecos, truncados con lugar, tapados, falsos clickeables) en las tres pantallas.
        const problems = [];
        for (const width of [390, 1024, 1440]) {
          await p.setViewport({ width, height: width < 768 ? 844 : 900 });
          for (const url of ['/', '/login', '/register']) {
            await p.goto(`${base}${url}`, { waitUntil: 'domcontentloaded' });
            await p.waitForSelector('.auth');
            await sleep(300);
            for (const theme of ['dark', 'light']) {
              await setTheme(p, theme);
              const probe = await probeView(p, { scope: '.auth', scrollSteps: 0 });
              if (probe.error || probe.total) problems.push(`${url} ${width} ${theme}: ${formatProbe(probe)}`);
            }
          }
        }
        assert(!problems.length, problems.slice(0, 4).join(' || '));
        // Cambiar de pestaña no mueve las pestañas (la columna arranca arriba, no centrada).
        await p.setViewport({ width: 1440, height: 900 });
        await p.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
        await p.waitForSelector('.auth-tabs');
        await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
        const tabTop = () => p.$eval('#auth-tab-register', el => el.getBoundingClientRect().top);
        const before = await tabTop();
        let drift = 0;
        await p.click('#auth-tab-register');
        for (let i = 0; i < 12; i += 1) { await sleep(30); drift = Math.max(drift, Math.abs((await tabTop()) - before)); }
        await p.click('#auth-tab-login');
        for (let i = 0; i < 12; i += 1) { await sleep(30); drift = Math.max(drift, Math.abs((await tabTop()) - before)); }
        assert(drift <= 2, `las pestañas se movieron ${drift.toFixed(1)} px al cambiar de modo`);
        return 'not_authorized, tema y theme-color, sin scroll horizontal 360–1920, sonda UX en 0, pestañas quietas';
      } finally {
        await ctx.context.close().catch(() => {});
      }
    });

    // Revisión UX 10 (20/10): sin franja vacía bajo la barra, vecinos parejos y nada que aparezca de golpe.
    await test('lg', 'Login', 'Sin franja vacía arriba (≤ 32 px de la barra al primer bloque) y vecinos parejos: landing, ingreso, registro, contraseña y sede (360–1920, oscuro y claro)', async () => {
      const ctx = await openContext(browser, { base, token: '', releaseVersion, viewport: { width: 1440, height: 900 } });
      try {
        const p = ctx.page;
        const problems = [];
        const firstInk = () => p.evaluate(() => {
          const bar = document.querySelector('.auth-top').getBoundingClientRect().bottom;
          const main = document.querySelector('.auth-main');
          const range = document.createRange();
          let first = Infinity;
          const walker = document.createTreeWalker(main, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (n.nodeType === 3) {
              if (!n.textContent.trim() || n.parentElement.closest('.ui-collapse:not([data-state="open"]), [aria-hidden="true"]')) continue;
              range.selectNodeContents(n);
              const r = range.getBoundingClientRect();
              if (r.height) first = Math.min(first, r.top);
            } else if (!n.closest('.ui-collapse:not([data-state="open"])')) {
              const s = getComputedStyle(n);
              if (parseFloat(s.borderTopWidth) > 0 || s.backgroundColor !== 'rgba(0, 0, 0, 0)') { const r = n.getBoundingClientRect(); if (r.height) first = Math.min(first, r.top); }
            }
          }
          return Math.round(first - bar);
        });
        for (const url of ['/', '/login', '/register?code=TA-E2E-0001', '/login?password=token-de-prueba', '/sede/NFPT/tasks/1']) {
          await p.goto(`${base}${url}`, { waitUntil: 'domcontentloaded' });
          await p.waitForSelector('.auth-main');
          await sleep(300);
          for (const width of [360, 768, 1024, 1440, 1920]) {
            await p.setViewport({ width, height: width < 768 ? 800 : width >= 1600 ? 1080 : 900 });
            await sleep(120);
            for (const theme of ['dark', 'light']) {
              await setTheme(p, theme);
              const gap = await firstInk();
              if (gap > 32) problems.push(`${url} ${width} ${theme}: ${gap} px vacíos bajo la barra`);
              for (const item of await p.evaluate(unevenRows, { scope: '.auth' })) problems.push(`${url} ${width} ${theme}: ${item}`);
            }
          }
        }
        assert(!problems.length, `${problems.length} problemas:\n${[...new Set(problems)].slice(0, 10).join('\n')}`);
        return '5 pantallas × 5 anchos × 2 temas';
      } finally {
        await ctx.context.close().catch(() => {});
      }
    });

    await test('lg', 'Login', '"Volver a ingresar" desde "Elegí tu contraseña": las pestañas y el link entran y salen con alto suave', async () => {
      const ctx = await openContext(browser, { base, token: '', releaseVersion, viewport: { width: 1366, height: 900 } });
      try {
        const p = ctx.page;
        await p.goto(`${base}/login?password=token-de-prueba`, { waitUntil: 'domcontentloaded' });
        await p.waitForSelector('.auth-back');
        await sleep(300);
        const tabs = await watchHeight(p, { trigger: '.auth-back', watch: '.auth-column > .ui-collapse:has(.auth-tabs)', ms: 700 });
        assert(!tabs.error, tabs.error);
        const s = smooth(tabs.heights);
        assert(s.end > 20, `Las pestañas no volvieron (${s.end} px).`);
        assert(s.ok, `Las pestañas aparecieron de golpe: ${s.start} → ${s.end} px sin cuadros intermedios.`);
        assert(await visible(p, '#auth-tab-login'), 'No se ven las pestañas después de volver.');
        assert(!(await visible(p, '.auth-back')), '"Volver a ingresar" sigue a la vista en Ingresar.');
        return `pestañas ${s.start} → ${s.end} px en ${s.steps} cuadros`;
      } finally {
        await ctx.context.close().catch(() => {});
      }
    });
  } finally {
    await anon.context.close().catch(() => {});
  }
}
