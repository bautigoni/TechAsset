// Prueba de humo del entorno de QA, en Chrome real (puppeteer-core), contra una
// instancia ya levantada con qa/serve-qa.mjs:
//   landing → "Tengo un código" → registro con un código de repuesto → Ingresar
//   → Préstamos → prestar "Touch 7" → devolverlo.
//
//   node qa/smoke-qa.mjs --name=prueba                      # usa el código de repuesto1
//   node qa/smoke-qa.mjs --name=prueba --persona=repuesto2 --headful
//
// Gasta el código en la copia de esa instancia (para repetir: serve-qa --fresh).
// Capturas en qa/.out/<name>/smoke/.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CREDENTIALS_FILE, die, findBrowser, flag, instanceDir, option, readJson, safeName } from './lib.mjs';
import { clickButton, findButton, pathname, sleep, typeInto, until } from '../e2e/lib/browser.mjs';

const name = safeName(option('name'));
const info = readJson(path.join(instanceDir(name), 'instance.json')) || die(`No hay instancia "${name}" corriendo (node qa/serve-qa.mjs --name=${name} --port=...).`);
const creds = readJson(CREDENTIALS_FILE) || die('Falta qa/.out/credenciales.json (node qa/seed-qa-tenant.mjs).');
const personaKey = option('persona') || 'repuesto1';
const persona = creds.personas?.[personaKey] || creds.repuestos?.[personaKey] || die(`No hay código para "${personaKey}" en credenciales.json.`);
const base = info.base;
const shotsDir = path.join(instanceDir(name), 'smoke');
fs.mkdirSync(shotsDir, { recursive: true });

const EMAIL = '#auth-form input[type="email"]';
const SUBMIT = '#auth-form button[type="submit"]';
const CODE_INPUT = 'input[data-loan-code]';
const LOAN_FORM = '[data-loan-form]';
const DEVICE_STACK = '[data-loans-grid="devices"]';
const NAV_ITEM = '.shell-nav .shell-nav-item[data-view]';
const DEVICE = { alias: 'Touch 7', tag: 'D5007' };
const email = `smoke-${Date.now()}@qa.test`;
const password = 'QaSmoke-2026';

const steps = [];
let n = 0;
async function step(label, fn, page) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    steps.push({ paso: label, resultado: 'OK', detalle: String(detail || ''), s: ((Date.now() - t0) / 1000).toFixed(1) });
    if (page) await page.screenshot({ path: path.join(shotsDir, `${String(++n).padStart(2, '0')}-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`) }).catch(() => {});
  } catch (error) {
    steps.push({ paso: label, resultado: 'FALLA', detalle: (error instanceof Error ? error.message : String(error)).slice(0, 300), s: ((Date.now() - t0) / 1000).toFixed(1) });
    if (page) await page.screenshot({ path: path.join(shotsDir, `FALLA-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`) }).catch(() => {});
    throw error;
  }
}

const msgText = page => page.evaluate(() => (document.querySelector('.auth-msg')?.textContent || '').replace(/\s+/g, ' ').trim());
const deviceState = page => page.evaluate(async tag => {
  const response = await fetch('/api/devices', { headers: { 'X-Site-Code': 'QA', Accept: 'application/json' } });
  const data = await response.json();
  return (data.items || []).find(item => item.etiqueta === tag) || null;
}, DEVICE.tag);

async function pickOption(page, groupLabel, pattern) {
  const ok = await page.evaluate((label, source, flags) => {
    const rx = new RegExp(source, flags);
    const group = document.querySelector(`[data-loan-form] [role="group"][aria-label="${label}"]`);
    const button = group && [...group.querySelectorAll('button')].find(node => rx.test((node.textContent || '').trim()));
    if (!button) return false;
    if (button.getAttribute('aria-pressed') !== 'true') button.click();
    return true;
  }, groupLabel, pattern.source, pattern.flags);
  if (!ok) throw new Error(`No encontré la opción ${pattern} en "${groupLabel}".`);
}

const browser = await puppeteer.launch({
  executablePath: findBrowser(),
  headless: !flag('headful'),
  args: ['--no-first-run', '--disable-extensions', '--no-default-browser-check', '--window-size=1400,950']
});
const pageErrors = [];
let failed = false;
try {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => pageErrors.push(String(error?.message || error)));

  await step('Landing', async () => {
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.landing-hero h1');
    return page.$eval('.landing-hero h1', h => h.textContent.trim());
  }, page);

  await step('Tengo un código', async () => {
    await clickButton(page, /Tengo un código/, { scope: '.landing-cta' });
    await until(async () => (await pathname(page)) === '/register', { message: '/register' });
    await page.waitForSelector('#auth-form .auth-code input');
  }, page);

  await step('Registro con código', async () => {
    await typeInto(page, '#auth-form .auth-code input', persona.codigo);
    await typeInto(page, '#auth-form input[autocomplete="name"]', 'Smoke QA');
    await typeInto(page, EMAIL, email);
    await typeInto(page, '#auth-form input[autocomplete="new-password"]', password);
    await page.click(SUBMIT);
    await until(async () => /Cuenta creada/.test(await msgText(page)), { message: 'el aviso "Cuenta creada"' });
    await until(async () => (await pathname(page)) === '/login', { message: 'pasa a Ingresar' });
    return `${personaKey} (${persona.codigo}) → ${await msgText(page)}`;
  }, page);

  await step('Ingresar', async () => {
    const kept = await page.$eval(EMAIL, input => input.value);
    if (kept !== email) await typeInto(page, EMAIL, email);
    const pwd = await page.$('#auth-form input[autocomplete="current-password"]');
    if (!(await pwd.evaluate(input => input.value))) await typeInto(page, pwd, password);
    await page.click(SUBMIT);
    await page.waitForSelector('.shell', { timeout: 20000 });
    await until(async () => (await pathname(page)).startsWith('/sede/qa/'), { message: 'entra a la sede QA' });
    const session = await page.evaluate(() => fetch('/api/auth/session').then(r => r.json()));
    const site = session.sites?.find(item => item.siteCode === 'QA');
    if (!site) throw new Error(`La sesión no tiene la sede QA: ${JSON.stringify(session.sites)}`);
    if ((session.sites || []).length !== 1) throw new Error(`Ve más sedes que QA: ${session.sites.map(item => item.siteCode).join(', ')}`);
    return `${await pathname(page)} · rol ${site.siteRole} · mail ${kept === email ? 'precargado' : 'tipeado'}`;
  }, page);

  await step('Abrir Préstamos', async () => {
    await page.waitForSelector(`${NAV_ITEM}[data-view="loans"]`);
    await page.$eval(`${NAV_ITEM}[data-view="loans"]`, button => button.click());
    await until(async () => (await pathname(page)) === '/sede/qa/loans', { message: '/sede/qa/loans' });
    await page.waitForSelector(DEVICE_STACK, { timeout: 20000 });
    await page.waitForSelector(CODE_INPUT);
  }, page);

  await step(`Prestar ${DEVICE.alias}`, async () => {
    const before = await deviceState(page);
    if (!/disponible/i.test(before?.estado || '')) throw new Error(`${DEVICE.tag} no está disponible: ${before?.estado}`);
    await typeInto(page, CODE_INPUT, DEVICE.alias);
    await until(() => findButton(page, /^Prestar\s*↵?$/, { scope: LOAN_FORM }), { message: 'el botón Prestar' });
    const person = await page.waitForSelector(`${LOAN_FORM} #lo-persona`);
    await typeInto(page, person, 'Prueba de humo QA');
    await page.keyboard.press('Tab');
    await pickOption(page, 'Rol', /^Profesor$/);
    await pickOption(page, 'Ubicación', /^DOE$/);
    await sleep(150);
    await clickButton(page, /^Prestar\s*↵?$/, { scope: LOAN_FORM });
    const device = await until(async () => { const d = await deviceState(page); return /prest/i.test(d?.estado || '') && d; }, { message: `${DEVICE.tag} prestado` });
    return `${DEVICE.tag} → ${device.estado} a ${device.prestadoA}`;
  }, page);

  await step(`Devolver ${DEVICE.alias}`, async () => {
    await page.$eval(`${NAV_ITEM}[data-view="loans"]`, button => button.click());
    await page.waitForSelector(CODE_INPUT);
    await typeInto(page, CODE_INPUT, DEVICE.alias);
    await clickButton(page, /^Devolver\s*↵?$/, { scope: LOAN_FORM });
    const device = await until(async () => { const d = await deviceState(page); return /disponible|devuelto/i.test(d?.estado || '') && d; }, { message: `${DEVICE.tag} devuelto` });
    return `${DEVICE.tag} → ${device.estado}`;
  }, page);
} catch {
  failed = true;
} finally {
  await browser.close().catch(() => {});
}

console.table(steps);
if (pageErrors.length) console.log(`Errores de la página (${pageErrors.length}):\n  ${[...new Set(pageErrors)].slice(0, 10).join('\n  ')}`);
console.log(`Capturas en ${shotsDir}`);
process.exitCode = failed ? 1 : 0;
