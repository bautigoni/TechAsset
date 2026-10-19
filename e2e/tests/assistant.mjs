// Pruebas del asistente (k): dictado del navegador, pedido real de solo lectura
// (IA si el server tiene proveedor, si no el modo local) y la UI del stream
// (texto en vivo, línea de herramienta, acciones con Deshacer, confirmación en
// línea del lote) con un stream simulado en la página, sin gastar IA.
import { assert, clickButton, findButton, gotoView, openContext, sleep, until } from '../lib/browser.mjs';

const PANEL = '.asst:not([hidden])';
const INPUT = `${PANEL} .asst-input`;

export async function openAssistant(page, base) {
  await gotoView(page, base, 'dashboard');
  await page.waitForSelector('.shell-assistant-btn', { timeout: 20000 });
  await page.$eval('.shell-assistant-btn', button => button.click());
  await page.waitForSelector(INPUT, { timeout: 15000 });
}

export async function ask(page, question) {
  await page.$eval(INPUT, input => input.focus());
  await page.keyboard.type(question, { delay: 5 });
  await page.keyboard.press('Enter');
}

/** Texto del último turno del asistente terminado. */
async function lastReply(page) {
  return page.evaluate(() => {
    const turns = [...document.querySelectorAll('.asst:not([hidden]) .asst-turn')];
    const turn = turns[turns.length - 1];
    if (!turn) return null;
    return {
      state: turn.getAttribute('data-state'),
      text: (turn.querySelector('.asst-msg--assistant > p:not(.asst-tool)')?.textContent || '').trim(),
      tool: (turn.querySelector('.asst-tool')?.textContent || '').trim(),
      actions: [...turn.querySelectorAll('.asst-action')].map(node => (node.textContent || '').replace(/\s+/g, ' ').trim()),
      confirm: Boolean(turn.querySelector('.asst-confirm')),
      error: (turn.querySelector('.ui-status--bad .ui-status-msg')?.textContent || '').trim()
    };
  });
}

/**
 * Reemplaza fetch en la página para /api/asistente/chat/stream y /deshacer.
 * El primer stream manda texto y una herramienta, espera a que la prueba abra
 * la compuerta (__asstGate()) y recién ahí manda las acciones y `done`.
 */
export async function installStreamMock(page, { route = null, failFirst = false, long = false } = {}) {
  await page.evaluate((suggestedRoute, failFirstRequest, longReply) => {
    const original = window.fetch.bind(window);
    const enc = new TextEncoder();
    const sse = (event, data) => enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const actions = [
      { id: 901, tool: 'registrar_prestamo', label: 'Touch 34 (D1436) prestado a Máximo', undo: { actionId: 901, tipo: 'prestamo' } },
      { id: 902, tool: 'registrar_prestamo', label: 'Touch 35 (D1437) prestado a Máximo', undo: { actionId: 902, tipo: 'prestamo' } }
    ];
    const state = { requests: [], undos: [] };
    let openGate;
    const gate = new Promise(resolve => { openGate = resolve; });
    window.__asstMock = state;
    window.__asstGate = () => openGate();
    window.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/api/asistente/chat/stream')) {
        const body = JSON.parse(init.body || '{}');
        state.requests.push(body);
        const n = state.requests.length;
        if (failFirstRequest && n === 1) {
          return new Response(JSON.stringify({ ok: false, error: 'Falla simulada del servidor.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }
        const stream = new ReadableStream({
          async start(controller) {
            controller.enqueue(sse('start', { provider: 'mock', model: 'mock' }));
            if (longReply) {
              // Respuesta larga que llega de a poco (para probar el scroll del hilo).
              let text = '';
              for (let i = 1; i <= 60; i += 1) {
                const line = `Línea ${i} de una respuesta larga que sigue llegando.\n`;
                text += line;
                controller.enqueue(sse('delta', { text: line }));
                await new Promise(resolve => setTimeout(resolve, 40));
              }
              controller.enqueue(sse('done', { reply: text.trim(), actions: [] }));
            } else if (n === 1) {
              controller.enqueue(sse('delta', { text: 'Ya **presté** dos' }));
              controller.enqueue(sse('tool', { name: 'registrar_prestamo' }));
              await gate;
              for (const action of actions) controller.enqueue(sse('action', action));
              controller.enqueue(sse('done', {
                reply: 'Ya presté dos equipos a Máximo. Faltan 7 del lote: ¿confirmás?',
                suggestedRoute,
                actions,
                pendingConfirmation: { tipo: 'lote', cantidad: 7, equipos: ['D1501', 'D1502', 'D1503', 'D1504', 'D1505', 'D1506', 'D1507'] }
              }));
            } else {
              controller.enqueue(sse('delta', { text: 'Listo, ' }));
              controller.enqueue(sse('done', { reply: 'Listo, presté los 7 equipos del lote.', actions: [], suggestedRoute }));
            }
            controller.close();
          }
        });
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (url.includes('/api/asistente/deshacer')) {
        const { actionId } = JSON.parse(init.body || '{}');
        state.undos.push(actionId);
        const ok = actionId === 901;
        const payload = ok
          ? { ok: true, actionId, tipo: 'prestamo', mensaje: 'Listo, deshice el préstamo: Touch 34 (D1436) vuelve a estar disponible.' }
          : { ok: false, error: 'El equipo cambió desde entonces: no se puede deshacer.' };
        return new Response(JSON.stringify(payload), { status: ok ? 200 : 409, headers: { 'Content-Type': 'application/json' } });
      }
      return original(input, init);
    };
  }, route, failFirst, long);
}

export async function assistantTests({ browser, base, api, admin, releaseVersion, test, track = () => {} }) {
  const status = (await api.get('/api/asistente/status')).data || {};
  const provider = status.provider || 'local';

  // k1) Sin Web Speech API (Firefox) el micrófono no aparece; con ella, sí.
  await test('k', 'Asistente', 'Micrófono: se oculta sin SpeechRecognition y aparece con ella', async () => {
    const without = await openContext(browser, { base, token: admin.token, releaseVersion });
    track(without.page);
    try {
      await without.page.evaluateOnNewDocument(() => {
        delete window.SpeechRecognition;
        delete window.webkitSpeechRecognition;
        Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true });
        Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });
      });
      await openAssistant(without.page, base);
      assert(!(await without.page.$(`${PANEL} .asst-mic`)), 'El micrófono se ve aunque el navegador no tiene SpeechRecognition.');
    } finally {
      await without.context.close();
    }
    const withApi = await openContext(browser, { base, token: admin.token, releaseVersion });
    track(withApi.page);
    try {
      await withApi.page.evaluateOnNewDocument(() => {
        // Reconocimiento falso: la prueba no depende de que el Chrome headless lo tenga.
        class FakeRecognition {
          start() {
            window.__dictation = this;
            setTimeout(() => this.onresult?.({ resultIndex: 0, results: { length: 1, 0: { isFinal: false, length: 1, 0: { transcript: 'cuántos equipos' } } } }), 30);
          }
          stop() {
            this.onresult?.({ resultIndex: 0, results: { length: 1, 0: { isFinal: true, length: 1, 0: { transcript: 'cuántos equipos hay prestados' } } } });
            setTimeout(() => this.onend?.(), 10);
          }
          abort() { this.onend?.(); }
        }
        Object.defineProperty(window, 'SpeechRecognition', { value: FakeRecognition, configurable: true });
      });
      await openAssistant(withApi.page, base);
      const mic = await withApi.page.waitForSelector(`${PANEL} .asst-mic`, { timeout: 5000 });
      await mic.click();
      // Resultado intermedio en el campo mientras habla.
      await until(() => withApi.page.$eval(INPUT, input => input.value === 'cuántos equipos'), { message: 'el resultado intermedio en el campo' });
      await withApi.page.$eval(`${PANEL} .asst-mic`, button => button.click());
      await until(() => withApi.page.$eval(INPUT, input => input.value === 'cuántos equipos hay prestados' && !input.readOnly), { message: 'el texto final en el campo' });
      return 'sin API: oculto; con API: intermedio y final en el campo (no envía solo)';
    } finally {
      await withApi.context.close();
    }
  });

  // k2) Pedido real de solo lectura: con proveedor, respuesta de la IA; sin, el modo local.
  await test('k', 'Asistente', `Pedido de solo lectura con respuesta (${provider === 'local' ? 'modo local' : `IA: ${provider}`})`, async () => {
    const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion });
    track(page);
    try {
      const streamed = [];
      page.on('request', request => { if (request.url().includes('/api/asistente/chat/stream')) streamed.push(request.method()); });
      await openAssistant(page, base);
      await ask(page, '¿cuántos equipos hay prestados?');
      let sawStreaming = false;
      const reply = await until(async () => {
        const current = await lastReply(page);
        if (current?.state === 'streaming' && (current.text || current.tool)) sawStreaming = true;
        return current && current.state !== 'streaming' ? current : null;
      }, { timeout: provider === 'local' ? 15000 : 90000, interval: 80, message: 'la respuesta del asistente' });
      assert(streamed.length === 1, `Se esperaba un pedido al stream y hubo ${streamed.length}.`);
      assert(reply.state === 'done', `El turno terminó en "${reply.state}": ${reply.error}`);
      assert(reply.text.length > 0, 'La respuesta llegó vacía.');
      assert(!/\*\*|^#+\s/m.test(reply.text), `La respuesta trae markdown: ${reply.text.slice(0, 120)}`);
      assert(reply.actions.length === 0, `Un pedido de solo lectura dejó acciones: ${reply.actions.join(' | ')}`);
      if (provider === 'local') {
        assert(/no está configurado|no está disponible|etiqueta/i.test(reply.text), `Respuesta inesperada del modo local: ${reply.text.slice(0, 160)}`);
      } else {
        assert(/\d/.test(reply.text), `La IA no dio un número: ${reply.text.slice(0, 160)}`);
      }
      return `${provider}${sawStreaming ? ' · se vio en vivo' : ''}: "${reply.text.slice(0, 90)}"`;
    } finally {
      await context.close();
    }
  });

  // k3) UI del stream con un stream simulado (no gasta IA ni toca la base).
  await test('k', 'Asistente', 'Stream en vivo, línea de herramienta, Deshacer (ok y 409) y confirmación del lote', async () => {
    const { context, page, consoleErrors } = await openContext(browser, { base, token: admin.token, releaseVersion });
    track(page);
    try {
      await openAssistant(page, base);
      await installStreamMock(page);
      await ask(page, 'Prestale los equipos del lote a Máximo');
      // Antes de la compuerta: texto parcial + "Prestando…".
      const partial = await until(async () => {
        const current = await lastReply(page);
        return current?.state === 'streaming' && current.tool ? current : null;
      }, { message: 'el texto parcial y la línea de herramienta' });
      assert(partial.text === 'Ya presté dos', `Texto parcial inesperado (¿markdown en vivo?): "${partial.text}"`);
      assert(/Prestando/.test(partial.tool), `Línea de herramienta inesperada: "${partial.tool}"`);
      assert(await page.$eval(INPUT, input => input.disabled), 'El campo no se bloquea mientras responde.');
      await page.evaluate(() => window.__asstGate());
      const done = await until(async () => {
        const current = await lastReply(page);
        return current?.state === 'done' ? current : null;
      }, { message: 'el final del stream' });
      assert(done.text === 'Ya presté dos equipos a Máximo. Faltan 7 del lote: ¿confirmás?', `No se reemplazó por done.reply: "${done.text}"`);
      assert(!done.tool, 'La línea de herramienta quedó después del final.');
      assert(done.actions.length === 2 && done.actions.every(line => /Deshacer/.test(line)), `Acciones: ${done.actions.join(' | ')}`);
      assert(done.actions[0].includes('Touch 34 (D1436) prestado a Máximo'), `Etiqueta de la acción: ${done.actions[0]}`);
      assert(done.confirm, 'No apareció la confirmación en línea del lote.');

      // Deshacer ok → línea con el resultado; un doble click no lo ejecuta dos veces.
      await page.evaluate(() => {
        const button = [...document.querySelectorAll('.asst:not([hidden]) .asst-action button')].find(node => /^Deshacer$/.test((node.textContent || '').trim()));
        button.click();
        button.click();
      });
      await until(() => page.evaluate(() => [...document.querySelectorAll('.asst:not([hidden]) .asst-action')].some(node => /deshice el préstamo/.test(node.textContent || ''))), { message: 'el resultado del Deshacer' });
      // Deshacer 409 → error en línea, sin Reintentar.
      await clickButton(page, /^Deshacer$/, { scope: PANEL });
      const errorLine = await until(() => page.evaluate(() => {
        const bad = document.querySelector('.asst:not([hidden]) .asst-action.ui-status--bad');
        return bad ? (bad.textContent || '').replace(/\s+/g, ' ').trim() : '';
      }), { message: 'el error del Deshacer en línea' });
      assert(/no se puede deshacer/.test(errorLine) && !/Reintentar/.test(errorLine), `Error del Deshacer: ${errorLine}`);
      const undos = await page.evaluate(() => window.__asstMock.undos);
      assert(JSON.stringify(undos) === '[901,902]', `Deshacer llamó con ${JSON.stringify(undos)} (¿el doble click lo ejecutó dos veces?)`);

      // Confirmar el lote manda "sí, confirmo" y la confirmación se va.
      await clickButton(page, /^Sí, confirmo$/, { scope: PANEL });
      await until(async () => (await page.evaluate(() => window.__asstMock.requests.length)) === 2, { message: 'el segundo pedido' });
      const second = await page.evaluate(() => window.__asstMock.requests[1].messages);
      const lastMessage = second[second.length - 1];
      assert(lastMessage.role === 'user' && lastMessage.content === 'sí, confirmo', `Último mensaje enviado: ${JSON.stringify(lastMessage)}`);
      await until(async () => (await lastReply(page))?.text === 'Listo, presté los 7 equipos del lote.', { message: 'la respuesta a la confirmación' });
      assert(!(await page.$(`${PANEL} .asst-confirm`)), 'La confirmación sigue a la vista después de contestarla.');
      assert(!(await findButton(page, /^Sí, confirmo$/, { scope: PANEL })), 'Quedó un botón de confirmar.');
      await sleep(100);
      assert(!consoleErrors.length, `Errores de la página: ${consoleErrors.join(' | ')}`);
      return 'texto parcial + "Prestando…", done.reply, 2 acciones, Deshacer ok/409, "sí, confirmo"';
    } finally {
      await context.close();
    }
  });

  // k) Vista propia (mobile): la sección sugerida no cierra la conversación; va como enlace.
  await test('k', 'Asistente', 'Mobile: la respuesta queda a la vista y la sección sugerida va como enlace', async () => {
    const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width: 390, height: 844, isMobile: true, hasTouch: true } });
    track(page);
    try {
      await openAssistant(page, base);
      assert(await page.$('.asst--view:not([hidden])'), 'A 390 px el asistente no abrió como vista propia.');
      await installStreamMock(page, { route: 'loans' });
      await ask(page, 'Prestale los equipos del lote a Máximo');
      await page.evaluate(() => window.__asstGate());
      await until(async () => (await lastReply(page))?.state === 'done', { message: 'el final del stream' });
      await sleep(300);
      assert(await page.$('.asst--view:not([hidden])'), 'La sección sugerida cerró la conversación.');
      assert(!(await page.evaluate(() => location.pathname.toLowerCase())).endsWith('/loans'), 'Navegó solo a Préstamos.');
      await clickButton(page, /^Abrir Préstamos$/, { scope: PANEL });
      await until(async () => (await page.evaluate(() => location.pathname.toLowerCase())).endsWith('/loans'), { message: 'ir a Préstamos con el enlace' });
      await until(async () => Boolean(await page.$('.asst[hidden]')), { message: 'que el enlace cierre la vista del asistente' });
      return 'queda la respuesta + "Abrir Préstamos" → /loans';
    } finally {
      await context.close();
    }
  });

  // k) Doble Enter no manda dos veces; si falla, lo escrito vuelve al campo y Reintentar lo manda.
  await test('k', 'Asistente', 'Doble Enter no duplica; un error no pierde lo escrito y Reintentar funciona', async () => {
    const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion });
    track(page);
    try {
      await openAssistant(page, base);
      await installStreamMock(page, { failFirst: true });
      const question = '¿Quién tiene el D1436?';
      await page.$eval(INPUT, input => input.focus());
      await page.keyboard.type(question, { delay: 5 });
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      const failed = await until(async () => {
        const current = await lastReply(page);
        return current?.state === 'error' ? current : null;
      }, { message: 'el error en línea' });
      assert(/Falla simulada/.test(failed.error), `Error mostrado: "${failed.error}"`);
      assert((await page.evaluate(() => window.__asstMock.requests.length)) === 1, 'El doble Enter mandó dos pedidos.');
      assert((await page.$$(`${PANEL} .asst-msg--user`)).length === 1, 'El doble Enter dejó dos mensajes del usuario.');
      assert((await page.$eval(INPUT, input => input.value)) === question, 'Lo escrito no volvió al campo después del error.');
      await clickButton(page, /^Reintentar$/, { scope: PANEL });
      await until(async () => (await lastReply(page))?.text === 'Listo, presté los 7 equipos del lote.', { message: 'la respuesta del reintento' });
      assert((await page.$$(`${PANEL} .asst-msg--user`)).length === 1, 'Reintentar duplicó el mensaje del usuario.');
      assert(!(await page.$(`${PANEL} .ui-status--bad`)), 'El error quedó a la vista después del reintento.');
      assert((await page.$eval(INPUT, input => input.value)) === '', 'El campo quedó con el texto después de enviarlo bien.');
      return '1 pedido con doble Enter; error con Reintentar; texto conservado';
    } finally {
      await context.close();
    }
  });

  // k) Abrir y cerrar no mueve la página, conserva la posición y devuelve el foco.
  for (const [width, label] of [[1366, 'columna'], [390, 'vista propia']]) {
    await test('k', 'Asistente', `Abrir/cerrar (${label}, ${width} px): misma posición y foco al botón Asistente`, async () => {
      const viewport = width < 768 ? { width, height: 844, isMobile: true, hasTouch: true } : { width, height: 900 };
      const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, viewport });
      track(page);
      try {
        await gotoView(page, base, 'dashboard');
        await page.waitForSelector('tr[data-device-tag], .shell-scroll', { timeout: 20000 });
        await sleep(400);
        const before = await page.evaluate(() => {
          const scroller = document.querySelector('.shell-scroll');
          scroller.scrollTop = Math.min(400, scroller.scrollHeight - scroller.clientHeight);
          return scroller.scrollTop;
        });
        assert(before > 0, 'El Inicio no tiene scroll para probar la posición.');
        await page.$eval('.shell-assistant-btn', button => button.click());
        await page.waitForSelector(INPUT);
        await sleep(200);
        const whileOpen = await page.evaluate(() => ({ top: document.querySelector('.shell-scroll').scrollTop, window: window.scrollY, focused: document.activeElement?.classList.contains('asst-input') }));
        assert(whileOpen.window === 0, `Abrir movió la ventana (${whileOpen.window}).`);
        assert(whileOpen.focused, 'Al abrir, el foco no quedó en el campo del asistente.');
        if (width >= 1024) assert(Math.abs(whileOpen.top - before) <= 1, `Abrir movió el contenido de ${before} a ${whileOpen.top}.`);
        await page.keyboard.press('Escape');
        await until(async () => Boolean(await page.$('.asst[hidden]')), { message: 'que Esc cierre el asistente' });
        await sleep(150);
        const after = await page.evaluate(() => ({ top: document.querySelector('.shell-scroll').scrollTop, focused: document.activeElement?.classList.contains('shell-assistant-btn') }));
        assert(Math.abs(after.top - before) <= 1, `Al cerrar, la posición pasó de ${before} a ${after.top}.`);
        assert(after.focused, 'Al cerrar, el foco no volvió al botón Asistente.');
        return `posición ${before} → ${after.top}; foco en Asistente`;
      } finally {
        await context.close();
      }
    });
  }

  // k) Hilo: sigue al último mensaje mientras llega el stream; si el usuario subió a leer, no lo arrastra.
  await test('k', 'Asistente', 'Stream largo: el hilo sigue al final y no arrastra a quien subió a leer', async () => {
    const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion });
    track(page);
    try {
      await openAssistant(page, base);
      await installStreamMock(page, { long: true });
      await ask(page, 'Contame todo');
      const feedState = () => page.$eval(`${PANEL} .asst-feed`, feed => ({ top: feed.scrollTop, gap: feed.scrollHeight - feed.scrollTop - feed.clientHeight, overflow: feed.scrollHeight > feed.clientHeight + 200 }));
      await until(async () => (await feedState()).overflow, { message: 'que la respuesta desborde el hilo' });
      const following = await feedState();
      assert(following.gap < 4, `Mientras llega el stream el hilo no está al final (faltan ${following.gap} px).`);
      // El usuario sube a leer.
      await page.$eval(`${PANEL} .asst-feed`, feed => { feed.scrollTop = 100; feed.dispatchEvent(new Event('scroll')); });
      await sleep(600);
      const reading = await feedState();
      assert(Math.abs(reading.top - 100) <= 1, `El stream arrastró la lectura de 100 a ${reading.top}.`);
      await until(async () => (await lastReply(page))?.state === 'done', { timeout: 15000, message: 'el final del stream largo' });
      assert(Math.abs((await feedState()).top - 100) <= 1, 'Al terminar, el hilo saltó aunque el usuario estaba leyendo arriba.');
      assert(!(await page.$eval('.shell-scroll', node => node.scrollTop)), 'El stream movió el contenido de la página.');
      return 'sigue al final; respeta la lectura arriba';
    } finally {
      await context.close();
    }
  });

  // k4) Con proveedor: una acción real (préstamo) y su Deshacer contra la copia de la base.
  await test('k', 'Asistente', 'Préstamo real por el asistente y Deshacer (solo con proveedor de IA)', async () => {
    if (provider === 'local') return 'omitida: el server de prueba corre sin proveedor (npm run e2e -- --ai para probarla)';
    const devices = await api.devices();
    const target = devices.find(device => /disponible/i.test(device.estado || '') && /^D\d+$/.test(device.etiqueta || ''));
    assert(target, 'No hay un equipo D#### disponible en la copia.');
    const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion });
    track(page);
    try {
      await openAssistant(page, base);
      await ask(page, `Prestale el ${target.etiqueta} a E2E Asistente, rol DOE, ubicación DOE`);
      const reply = await until(async () => {
        const current = await lastReply(page);
        return current && current.state !== 'streaming' ? current : null;
      }, { timeout: 90000, interval: 150, message: 'la respuesta del préstamo' });
      assert(reply.actions.length === 1, `Se esperaba una acción y hubo ${reply.actions.length}: "${reply.text.slice(0, 160)}"`);
      const lent = await api.device(target.etiqueta);
      assert(/prest/i.test(lent?.estado || ''), `${target.etiqueta} quedó "${lent?.estado}" después del préstamo.`);
      await clickButton(page, /^Deshacer$/, { scope: PANEL });
      await until(() => page.evaluate(() => Boolean(document.querySelector('.asst:not([hidden]) .asst-action.ui-status--info'))), { timeout: 15000, message: 'el resultado del Deshacer' });
      const back = await api.device(target.etiqueta);
      assert(/disponible/i.test(back?.estado || ''), `${target.etiqueta} quedó "${back?.estado}" después de Deshacer.`);
      return `${target.etiqueta}: prestado y deshecho · "${reply.actions[0].slice(0, 80)}"`;
    } finally {
      await context.close();
    }
  });
}
