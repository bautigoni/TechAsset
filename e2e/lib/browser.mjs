// Ayudas de navegador para las pruebas: contexto con sesión, navegación por URL,
// búsqueda de botones por texto y los SelectField propios de la app.
import { COOKIE_NAME, SITE } from './env.mjs';

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Repite `check` hasta que devuelva algo truthy o venza el tiempo. */
export async function until(check, { timeout = 8000, interval = 120, message = 'condición' } = {}) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try {
      last = await check();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await sleep(interval);
  }
  throw new Error(`Tiempo agotado esperando ${message}${last instanceof Error ? ` (${last.message})` : ''}`);
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Contexto aislado (sin caché ni storage compartido) con la cookie de sesión,
 * la sede activa y las novedades marcadas como vistas (si no, el modal de
 * "Qué hay de nuevo" tapa la primera pantalla).
 */
export async function openContext(browser, { base, token, releaseVersion = '', device, viewport = { width: 1366, height: 900 }, reducedMotion = false }) {
  const context = await browser.createBrowserContext();
  const cookie = { name: COOKIE_NAME, value: token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' };
  if (token) {
    if (typeof context.setCookie === 'function') await context.setCookie(cookie);
  }
  const page = await context.newPage();
  if (token && typeof context.setCookie !== 'function') await page.setCookie(cookie);
  if (device) await page.emulate(device);
  else await page.setViewport(viewport);
  if (reducedMotion) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluateOnNewDocument((site, version) => {
    try {
      localStorage.setItem('techasset_active_site', site);
      sessionStorage.setItem('techasset_active_site', site);
      if (version) localStorage.setItem('techasset_last_seen_release', version);
    } catch { /* sin storage */ }
  }, SITE, releaseVersion);
  page.setDefaultTimeout(15000);
  const consoleErrors = [];
  page.on('pageerror', error => consoleErrors.push(String(error?.message || error)));
  return { context, page, consoleErrors };
}

/** Abre /sede/NFPT/<vista> con recarga completa y espera el shell. */
export async function gotoView(page, base, view, { site = SITE } = {}) {
  await page.goto(`${base}/sede/${site}/${view}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app-shell', { timeout: 20000 });
  await page.waitForSelector('.view-enter section, .view-enter .view', { timeout: 20000 }).catch(() => {});
}

/** Espera a que la vista tenga equipos cargados (la app los pide al arrancar). */
export async function waitDevicesLoaded(page, selector) {
  await page.waitForSelector(selector, { timeout: 20000 });
}

/** Botón visible cuyo texto (normalizado) cumple la regex. Devuelve el handle o null. */
export async function findButton(page, pattern, { scope = 'body', includeDisabled = true } = {}) {
  const handle = await page.evaluateHandle((source, flags, scopeSelector, withDisabled) => {
    const rx = new RegExp(source, flags);
    const roots = [...document.querySelectorAll(scopeSelector)];
    for (const rootEl of roots) {
      for (const button of rootEl.querySelectorAll('button')) {
        const text = (button.textContent || '').replace(/\s+/g, ' ').trim();
        if (!rx.test(text)) continue;
        if (!withDisabled && button.disabled) continue;
        const rect = button.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        return button;
      }
    }
    return null;
  }, pattern.source, pattern.flags, scope, includeDisabled);
  const element = handle.asElement();
  if (!element) await handle.dispose();
  return element;
}

export async function clickButton(page, pattern, options = {}) {
  const button = await until(() => findButton(page, pattern, options), { timeout: options.timeout ?? 8000, message: `el botón ${pattern}` });
  await button.click();
  return button;
}

/** Elige una opción de un SelectField (botón trigger con aria-label + lista role=option). */
export async function selectOption(page, ariaLabel, optionPattern, { scope = 'body' } = {}) {
  const trigger = await page.waitForSelector(`${scope} button.field-select-trigger[aria-label="${ariaLabel}"]`, { timeout: 8000 });
  await trigger.click();
  const option = await until(() => page.evaluateHandle((label, source, flags, scopeSelector) => {
    const rx = new RegExp(source, flags);
    const roots = [...document.querySelectorAll(scopeSelector)];
    for (const rootEl of roots) {
      const trig = rootEl.querySelector(`button.field-select-trigger[aria-label="${label}"]`);
      const field = trig?.closest('.field-select');
      if (!field) continue;
      for (const opt of field.querySelectorAll('[role="option"]')) {
        if (rx.test((opt.textContent || '').replace(/\s+/g, ' ').trim())) return opt;
      }
    }
    return null;
  }, ariaLabel, optionPattern.source, optionPattern.flags, scope).then(h => h.asElement()), { message: `la opción ${optionPattern} de "${ariaLabel}"` });
  await option.click();
}

/** Opciones disponibles de un SelectField (abre, lee y cierra con Escape). */
export async function readOptions(page, ariaLabel) {
  const trigger = await page.waitForSelector(`button.field-select-trigger[aria-label="${ariaLabel}"]`, { timeout: 8000 });
  await trigger.click();
  await page.waitForSelector('.field-select.is-open [role="option"]', { timeout: 4000 });
  const options = await page.$$eval('.field-select.is-open [role="option"]', nodes => nodes.map(node => (node.textContent || '').replace(/\s+/g, ' ').trim()));
  await trigger.click();
  return options;
}

/** Reemplaza el contenido de un input tipeando de verdad (eventos de teclado reales). */
export async function typeInto(page, selectorOrHandle, text, { delay = 0 } = {}) {
  const input = typeof selectorOrHandle === 'string' ? await page.waitForSelector(selectorOrHandle) : selectorOrHandle;
  await input.click();
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  if (text) await input.type(text, { delay });
  let value = await input.evaluate(element => element.value);
  if (value !== text) {
    // Algunos campos (type=number) no seleccionan con Ctrl+A en headless: se
    // pone el valor con el setter nativo y un evento input, que React sí escucha.
    value = await input.evaluate((element, next) => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
      setter?.call(element, next);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      return element.value;
    }, text);
  }
  if (value !== text) throw new Error(`El campo quedó con "${value}" en vez de "${text}".`);
  return input;
}

/** Ruta actual en minúsculas (la app escribe la sede en minúsculas: /sede/nfpt/...). */
export async function pathname(page) {
  return page.evaluate(() => (window.location.pathname + window.location.search).toLowerCase());
}

export async function text(page, selector) {
  return page.$eval(selector, element => (element.textContent || '').replace(/\s+/g, ' ').trim()).catch(() => '');
}

/** Click con modificadores reales (keydown → click → keyup), como un usuario. */
export async function clickWithModifier(page, handle, modifier) {
  if (modifier) await page.keyboard.down(modifier);
  try {
    await handle.click();
  } finally {
    if (modifier) await page.keyboard.up(modifier);
  }
}
