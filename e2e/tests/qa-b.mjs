// qab) QA de lanzamiento, frente B (Préstamos y errores de red), ronda 1
// (docs/redesign/qa/HALLAZGOS-1.md, ítems 1, 2, 3, 20, 26 y 27):
//
//   1. Leyenda de chips y cartelitos: muestras vacías (sin un número que se lea
//      como cantidad) y el rótulo "Referencia".
//   2. Formulario de préstamo: Prestar sin datos marca TODO lo que falta junto
//      (en su lugar y en un resumen), lleva el foco al primero y lo deja a la
//      vista (375 y 1366); "Primaria (EP)" / "Secundaria (ES)", rótulo y ayuda
//      de los cursos; completar lo marcado presta (verificado por API).
//   3. Sin red: Prestar deshabilitado con el motivo; con el servidor caído el
//      error dice "No se pudo conectar…" (nunca "Failed to fetch") y el botón
//      ofrece Reintentar; lo escrito queda. Cámara sin permiso: aviso sin
//      jerga, cursor en el campo del código y el aviso se va al escribir.
//  20. "10" ofrece Touch 10 (número operativo antes que el serie) y los
//      formatos de siempre siguen resolviendo.
//  27. En 375 con CPU 4×, tipear "touch 10" a ritmo humano, tocar Persona y
//      escribir: nada cae en el campo del código y el formulario no se cierra.
//
// Corre contra la copia de la base (deja todo como estaba). Capturas en e2e/.out/qa-b/.
import fs from 'node:fs';
import path from 'node:path';
import { root } from '../lib/env.mjs';
import { assert, gotoView, openContext, sleep, until } from '../lib/browser.mjs';
import { settle } from '../lib/ux-probe.mjs';

const outDir = path.join(root, 'e2e', '.out', 'qa-b');
const FORM = '[data-loan-form]';
const CODE = 'input[data-loan-code]';
const LEND = '[data-lend-form]';
const free = estado => /^(|disponible|devuelto)$/i.test(String(estado || '').trim());

async function viewportFor(page, width, height = 900) {
  const mobile = width < 768;
  await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
}

async function openLoans(page, base) {
  // Al frente: una pestaña de fondo no recibe a tiempo el evento "offline" ni pinta cuadros.
  await page.bringToFront();
  await gotoView(page, base, 'loans');
  await page.waitForSelector('[data-loans-grid="devices"]', { timeout: 20000 });
  await page.waitForSelector(CODE);
  await settle(page);
}

/** Pone un código como si se pegara (un solo evento input) y espera el resultado. */
async function setCode(page, value) {
  await page.evaluate((sel, next) => {
    const input = document.querySelector(sel);
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, CODE, value);
}

async function lendFormOpen(page) {
  return page.evaluate(sel => Boolean(document.querySelector(sel)?.closest('.ui-collapse')?.matches('[data-state="open"]')), LEND);
}

/** Texto visible de toda la página (para buscar mensajes crudos en inglés). */
const pageText = page => page.evaluate(() => document.body.innerText);

/** Touch con número ≥ 10 libre (o el primero libre con número). */
function pickTouch(devices) {
  const touches = devices
    .filter(device => /^touch$/i.test(String(device.filtro || '')) && free(device.estado))
    .map(device => ({ device, n: Number(device.numeroOperativo || device.numero || String(device.aliasOperativo || '').replace(/\D+/g, '')) }))
    .filter(item => item.n > 0)
    .sort((a, b) => (a.n >= 10 ? 0 : 1) - (b.n >= 10 ? 0 : 1) || a.n - b.n);
  return touches[0];
}

export async function qaBTests({ browser, base, api, admin, releaseVersion, test, track = () => {} }) {
  fs.mkdirSync(outDir, { recursive: true });
  const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width: 1366, height: 900 } });
  track(page);
  const lent = new Set();
  try {
    // ── 1. Leyenda sin números ────────────────────────────────────────────
    await test('qab', 'QA frente B', 'Leyenda de equipos y cartelitos: muestras sin número y rótulo "Referencia"', async () => {
      await viewportFor(page, 1366);
      await openLoans(page, base);
      // Los cartelitos muestran su leyenda con el panel abierto.
      const passes = await page.$('[data-loans-grid="passes"] .lo-group-toggle[aria-expanded="false"]');
      if (passes) { await passes.click(); await sleep(400); }
      const legends = await page.$$eval('[data-legend]', list => list.map(el => ({
        title: (el.querySelector('.lo-legend-title')?.textContent || '').trim(),
        samples: [...el.querySelectorAll('.lo-chip--sample')].map(s => (s.textContent || '').trim()),
        text: (el.textContent || '').replace(/\s+/g, ' ').trim()
      })));
      assert(legends.length >= 1, 'No encontré la leyenda.');
      for (const legend of legends) {
        assert(legend.title === 'Referencia', `Leyenda sin rótulo "Referencia": "${legend.text}"`);
        assert(legend.samples.every(sample => sample === ''), `Una muestra lleva texto: ${JSON.stringify(legend.samples)}`);
        // Ningún número delante de un estado ("12 Libre"): los que quedan son parte del rótulo ("1 día afuera").
        assert(!/\d+\s*(Libre|Prestado|Entregado|Marcado|Fuera|Perdido)/.test(legend.text), `La leyenda tiene cantidades: "${legend.text}"`);
      }
      await page.screenshot({ path: path.join(outDir, 'leyenda-1366.png') });
      return legends.map(legend => legend.text).join(' | ');
    });

    // ── 2. Formulario: todo junto, foco al primero, EP/ES legibles ─────────
    for (const width of [375, 1366]) {
      await test('qab', 'QA frente B', `Prestar sin datos marca todo lo que falta, foco y vista en el primero; niveles y cursos explicados (${width} px)`, async () => {
        await viewportFor(page, width, width < 768 ? 812 : 900);
        await openLoans(page, base);
        const target = pickTouch(await api.devices());
        assert(target, 'No hay un Touch libre en la copia.');
        await setCode(page, target.device.etiqueta);
        await until(() => lendFormOpen(page), { message: 'el formulario del préstamo' });
        await sleep(400);
        // Obligatorios marcados ANTES de enviar.
        const marks = await page.$$eval(`${LEND} .lo-flabel`, labels => labels.filter(l => l.querySelector('.lo-req')).map(l => l.textContent.replace(/\*|\(obligatorio\)/g, '').trim()));
        assert(['Persona', 'Rol', 'Ubicación'].every(name => marks.includes(name)), `Obligatorios sin marcar: ${marks.join(', ')}`);
        // Prestar vacío.
        await page.evaluate(sel => [...document.querySelectorAll(`${sel} .lo-lend-actions button`)].find(b => /^Prestar/.test(b.textContent.trim())).click(), LEND);
        await sleep(500);
        const state = await page.evaluate(sel => {
          const form = document.querySelector(sel);
          const scroller = document.querySelector('.shell-scroll').getBoundingClientRect();
          const person = form.querySelector('#lo-persona');
          const box = person.getBoundingClientRect();
          return {
            invalid: [...form.querySelectorAll('[data-field]')].filter(row => row.querySelector('[aria-invalid="true"], [data-invalid]')).map(row => row.getAttribute('data-field')),
            messages: [...form.querySelectorAll('.lo-field-error')].map(el => el.textContent.trim()),
            summary: (form.querySelector('.lo-form-error')?.textContent || '').trim(),
            focus: document.activeElement?.id || '',
            visible: box.top >= scroller.top && box.bottom <= scroller.bottom
          };
        }, LEND);
        assert(['person', 'role', 'location'].every(key => state.invalid.includes(key)), `No marcó todos juntos: ${state.invalid.join(', ')}`);
        assert(state.messages.length >= 3, `Faltan mensajes en línea: ${state.messages.join(' · ')}`);
        assert(/Faltan 3 datos: persona, rol y ubicación/.test(state.summary), `Resumen: "${state.summary}"`);
        assert(state.focus === 'lo-persona', `El foco quedó en "${state.focus}", no en Persona.`);
        assert(state.visible, 'El primer campo con error quedó fuera de la vista.');
        if (width < 768) await page.screenshot({ path: path.join(outDir, `faltan-${width}.png`) });
        // Aula: aparecen nivel y curso, también marcados.
        await page.evaluate(sel => [...document.querySelectorAll(`${sel} [role="group"][aria-label="Ubicación"] button`)].find(b => /^Aula$/.test(b.textContent.trim())).click(), LEND);
        await sleep(450);
        const course = await page.evaluate(sel => {
          const form = document.querySelector(sel);
          return {
            levels: [...form.querySelectorAll('[role="group"][aria-label="Nivel"] button')].map(b => b.textContent.trim()),
            invalid: [...form.querySelectorAll('[data-field]')].filter(row => row.querySelector('[data-invalid]')).map(row => row.getAttribute('data-field')),
            help: (form.querySelector('.lo-grade-help')?.textContent || '').trim()
          };
        }, LEND);
        assert(course.levels.join('|') === 'Primaria (EP)|Secundaria (ES)', `Niveles: ${course.levels.join(', ')}`);
        assert(course.invalid.includes('schoolLevel') && course.invalid.includes('course'), `Nivel y curso no se marcaron: ${course.invalid.join(', ')}`);
        assert(/división/.test(course.help), `Sin ayuda de la nomenclatura: "${course.help}"`);
        // Nivel → el rótulo del curso dice qué es.
        await page.evaluate(sel => [...document.querySelectorAll(`${sel} [role="group"][aria-label="Nivel"] button`)].find(b => /\(ES\)/.test(b.textContent)).click(), LEND);
        await sleep(200);
        const courseLabel = await page.$eval(`${LEND} [data-field="course"] .lo-flabel`, el => el.textContent.replace(/\*|\(obligatorio\)/g, '').trim());
        assert(courseLabel === 'Año y división', `Rótulo con Secundaria: "${courseLabel}"`);
        // Completar y prestar.
        await page.type(`${LEND} #lo-persona`, 'E2E Frente B');
        await page.keyboard.press('Escape');
        await page.evaluate(sel => {
          const form = document.querySelector(sel);
          [...form.querySelectorAll('[role="group"][aria-label="Rol"] button')][0].click();
          [...form.querySelectorAll('[role="group"][aria-label="Grado, año o curso"] button')][0].click();
        }, LEND);
        const errorsLeft = () => page.$$eval(`${LEND} .lo-field-error`, list => list.filter(el => !el.closest('[inert]')).map(el => el.textContent.trim()));
        await until(async () => !(await errorsLeft()).length, { timeout: 3000, message: 'que se vayan los errores' }).catch(() => {});
        const left = await errorsLeft();
        if (left.length) await page.screenshot({ path: path.join(outDir, `errores-quedaron-${width}.png`) });
        const typed = await page.$eval(`${LEND} #lo-persona`, el => el.value);
        assert(!left.length, `Quedaron errores con todo completo: ${left.join(' · ')} (persona "${typed}")`);
        await page.evaluate(sel => [...document.querySelectorAll(`${sel} .lo-lend-actions button`)].find(b => /^Prestar/.test(b.textContent.trim())).click(), LEND);
        const device = await until(async () => { const d = await api.device(target.device.etiqueta); return d && !free(d.estado) && d; }, { timeout: 10000, message: 'el préstamo en la base' });
        lent.add(target.device.etiqueta);
        assert(/ES/.test(String(device.curso || '')), `El curso guardado no tiene el nivel: "${device.curso}"`);
        await api.post('/api/loans/return', { etiqueta: target.device.etiqueta });
        lent.delete(target.device.etiqueta);
        return `${width}: ${state.summary} → prestado ${target.device.etiqueta} (${device.curso}) y devuelto`;
      });
    }

    // ── 3a. Sin red ────────────────────────────────────────────────────────
    await test('qab', 'QA frente B', 'Sin red: Prestar deshabilitado con el motivo; servidor caído: mensaje en castellano y Reintentar, lo escrito queda', async () => {
      await viewportFor(page, 1366);
      await openLoans(page, base);
      const target = pickTouch(await api.devices());
      await setCode(page, target.device.etiqueta);
      await until(() => lendFormOpen(page), { message: 'el formulario del préstamo' });
      await page.type(`${LEND} #lo-persona`, 'E2E Sin Red');
      await page.keyboard.press('Escape');
      await page.evaluate(sel => {
        const form = document.querySelector(sel);
        [...form.querySelectorAll('[role="group"][aria-label="Rol"] button')][0].click();
        [...form.querySelectorAll('[role="group"][aria-label="Ubicación"] button')].find(b => !/^Aula$|^Otro$/.test(b.textContent.trim())).click();
      }, LEND);
      const notes = [];
      // Modo avión: el botón no se puede tocar y el motivo está a la vista.
      await page.setOfflineMode(true);
      try {
        const offAt = Date.now();
        await until(() => page.evaluate(sel => [...document.querySelectorAll(`${sel} .lo-lend-actions button`)].find(b => /^Prestar/.test(b.textContent.trim()))?.disabled, LEND), { timeout: 8000, message: 'Prestar deshabilitado sin red' }).catch(async error => {
          await page.screenshot({ path: path.join(outDir, 'sin-red-falla.png') });
          const dump = await page.evaluate(sel => ({ onLine: navigator.onLine, buttons: [...document.querySelectorAll(`${sel} .lo-lend-actions button`)].map(b => `${b.textContent.trim()}:${b.disabled}`), status: document.querySelector('.shell-status--offline')?.textContent || '' }), LEND);
          throw new Error(`${error.message} · ${JSON.stringify(dump)}`);
        });
        await until(() => page.$('[data-offline-note]'), { message: 'el aviso de sin conexión' });
        await page.screenshot({ path: path.join(outDir, 'sin-red-1366.png') });
        notes.push(`offline: deshabilitado a los ${Date.now() - offAt} ms`);
      } finally {
        await page.setOfflineMode(false);
      }
      await until(() => page.evaluate(sel => ![...document.querySelectorAll(`${sel} .lo-lend-actions button`)].find(b => /^Prestar/.test(b.textContent.trim()))?.disabled, LEND), { message: 'Prestar habilitado al volver la red' });
      // Servidor que no contesta (con red): el fetch falla como sin conexión.
      await page.setRequestInterception(true);
      const block = request => (request.url().includes('/api/loans/lend') ? request.abort('failed') : request.continue());
      page.on('request', block);
      try {
        await page.evaluate(sel => [...document.querySelectorAll(`${sel} .lo-lend-actions button`)].find(b => /^Prestar/.test(b.textContent.trim())).click(), LEND);
        await until(() => page.$(`${LEND} .lo-form-error`), { message: 'el error del préstamo' });
        await sleep(300);
        const error = await page.$eval(`${LEND} .lo-form-error`, el => el.textContent.trim());
        const text = await pageText(page);
        assert(!/failed to fetch|load failed|networkerror/i.test(text), 'Apareció el error crudo del navegador.');
        assert(/No se pudo conectar con el servidor/.test(error), `Error: "${error}"`);
        const label = await page.evaluate(sel => [...document.querySelectorAll(`${sel} .lo-lend-actions button`)][0].textContent.trim(), LEND);
        assert(/^Reintentar/.test(label), `El botón dice "${label}".`);
        const person = await page.$eval(`${LEND} #lo-persona`, el => el.value);
        assert(person === 'E2E Sin Red', `Se perdió la persona: "${person}"`);
        await page.screenshot({ path: path.join(outDir, 'servidor-caido-1366.png') });
        notes.push(`caído: "${error}" · ${label}`);
      } finally {
        page.off('request', block);
        await page.setRequestInterception(false);
      }
      // Reintentar con el servidor de vuelta: presta.
      await page.evaluate(sel => [...document.querySelectorAll(`${sel} .lo-lend-actions button`)][0].click(), LEND);
      await until(async () => { const d = await api.device(target.device.etiqueta); return d && !free(d.estado); }, { timeout: 10000, message: 'el préstamo al reintentar' });
      await api.post('/api/loans/return', { etiqueta: target.device.etiqueta });
      notes.push('reintento OK');
      return notes.join(' · ');
    });

    // ── 3b. Cámara sin permiso ─────────────────────────────────────────────
    await test('qab', 'QA frente B', 'Cámara sin permiso: aviso sin jerga, cursor en el código y el aviso se va al escribir', async () => {
      await viewportFor(page, 1366);
      await openLoans(page, base);
      await page.evaluate(() => {
        navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
      });
      await page.click('button[aria-controls="lo-camera"]');
      await until(() => page.$eval('#lo-camera', el => /permiso/i.test(el.textContent || '')), { message: 'el aviso de la cámara' });
      const message = await page.$eval('#lo-camera', el => el.textContent.trim());
      assert(!/https|localhost/i.test(message), `Aviso con jerga: "${message}"`);
      assert(/Escribí el número o la etiqueta/.test(message), `El aviso no dice qué hacer: "${message}"`);
      await until(() => page.evaluate(sel => document.activeElement === document.querySelector(sel), CODE), { message: 'el cursor en el campo del código' });
      const button = await page.$eval('button[aria-controls="lo-camera"]', el => el.textContent.trim());
      assert(button !== 'Cerrar cámara', 'Dice "Cerrar cámara" aunque la cámara nunca abrió.');
      await page.keyboard.type('touch');
      await until(() => page.$eval('button[aria-controls="lo-camera"]', el => el.getAttribute('aria-expanded') === 'false'), { message: 'que el aviso se vaya al escribir' });
      await setCode(page, '');
      return `"${message}" · botón "${button}"`;
    });

    // ── 20. Buscar "10" ────────────────────────────────────────────────────
    await test('qab', 'QA frente B', 'Buscar "10" ofrece Touch 10 (número antes que el serie) y los formatos de siempre resuelven', async () => {
      await viewportFor(page, 1366);
      await openLoans(page, base);
      const devices = await api.devices();
      const touch = devices.find(device => /^touch$/i.test(String(device.filtro || '')) && String(device.numeroOperativo || device.numero || '') === '10')
        || pickTouch(devices)?.device;
      assert(touch, 'No hay Touch con número en la copia.');
      const n = String(touch.numeroOperativo || touch.numero || '').replace(/^0+/, '');
      const resolved = async query => {
        await setCode(page, query);
        await sleep(350);
        return page.evaluate(() => {
          const found = document.querySelector('[data-found-tag]')?.getAttribute('data-found-tag');
          if (found) return { one: found, many: [] };
          return { one: '', many: [...document.querySelectorAll('.lo-multi-list button')].map(b => b.textContent.trim()) };
        });
      };
      const many = await resolved(n);
      const offered = many.one ? [many.one] : many.many;
      assert(many.one === touch.etiqueta || many.many.some(label => new RegExp(`^Touch ${n}(?!\\d)`).test(label)), `"${n}" no ofrece Touch ${n}: ${offered.join(' · ')}`);
      if (many.many.length) assert(/^Touch/.test(many.many[0]), `Touch ${n} no va primero: ${many.many.join(' · ')}`);
      const formats = [`touch ${n}`, `touch${n}`, `${n}touch`, touch.etiqueta, touch.etiqueta.replace(/^D0*/i, '')];
      const missing = [];
      for (const query of formats) {
        const result = await resolved(query);
        if (result.one !== touch.etiqueta) missing.push(`"${query}"→${result.one || result.many.join('/') || 'nada'}`);
      }
      await setCode(page, '');
      assert(!missing.length, missing.join('; '));
      return `"${n}" → ${offered.slice(0, 4).join(' · ')} · ${formats.length} formatos OK`;
    });

    // ── 27. Lo tipeado en Persona nunca cae en el código ───────────────────
    await test('qab', 'QA frente B', 'En 375 con CPU 4×: tipear "touch N" a ritmo humano, tocar Persona y escribir no cae en el código ni cierra el préstamo', async () => {
      await viewportFor(page, 375, 812);
      await openLoans(page, base);
      const target = pickTouch(await api.devices());
      const n = String(target.n);
      const cdp = await page.createCDPSession();
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const notes = [];
      try {
        // Espera entre que aparece el préstamo y el toque en Persona. Con 0 el toque
        // cae mientras el formulario todavía se despliega: puede no enfocar Persona,
        // pero NUNCA puede escribir en el código ni cerrar el préstamo.
        const waits = [1000, 300, 150, 0];
        for (const [round, wait] of waits.entries()) {
          await setCode(page, '');
          await sleep(300);
          await page.tap(CODE);
          await page.keyboard.type(`touch ${n}`, { delay: 150 });
          await until(() => page.evaluate(sel => /Prestar Touch/.test(document.querySelector(sel)?.textContent || ''), LEND), { timeout: 15000, message: 'el préstamo abierto' });
          await sleep(wait);
          const persona = await page.waitForSelector(`${LEND} #lo-persona`);
          await persona.tap();
          for (const ch of 'Pedro Sin Señal') { await page.keyboard.type(ch); await sleep(60); }
          await sleep(800);
          const final = await page.evaluate((code, lend) => ({
            code: document.querySelector(code).value,
            persona: document.querySelector(`${lend} #lo-persona`)?.value || '',
            open: Boolean(document.querySelector(lend)?.closest('.ui-collapse')?.matches('[data-state="open"]'))
          }), CODE, LEND);
          assert(final.code === `touch ${n}`, `Ronda ${round + 1} (${wait} ms): el código quedó "${final.code}".`);
          assert(final.open, `Ronda ${round + 1} (${wait} ms): el préstamo se cerró.`);
          if (wait > 0) assert(final.persona === 'Pedro Sin Señal', `Ronda ${round + 1} (${wait} ms): Persona quedó "${final.persona}".`);
          notes.push(`${wait} ms: ${final.persona ? 'Persona' : 'sin foco (código intacto)'}`);
          // Cancelar deja todo limpio para la ronda siguiente.
          await page.evaluate(sel => [...document.querySelectorAll(`${sel} .lo-lend-actions button`)].find(b => /^Cancelar$/.test(b.textContent.trim())).click(), LEND);
          await sleep(400);
        }
      } finally {
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        await cdp.detach();
      }
      await page.screenshot({ path: path.join(outDir, 'persona-375.png') });
      return `Touch ${n}: ${notes.join(', ')}`;
    });
  } finally {
    for (const tag of lent) await api.post('/api/loans/return', { etiqueta: tag }).catch(() => undefined);
    await context.close();
  }
}
