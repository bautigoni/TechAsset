// Pruebas de línea base (i, j): se reportan con conteos pero no cortan la
// corrida ni cambian el exit code. Sirven para ver que cada etapa del rediseño
// achica los números hasta llegar a cero.
import { KnownDevices } from 'puppeteer-core';
import { SITE } from '../lib/env.mjs';
import { gotoView, openContext, pathname, sleep } from '../lib/browser.mjs';
import { layoutProbe } from '../lib/layout-probe.mjs';
import { NAV_ITEM } from './functional.mjs';

export const WIDTHS = [360, 768, 1024, 1280, 1366, 1440];

/** Vistas del menú del superadmin en la sede (las que la sede tiene prendidas). */
async function mainViews(page, base) {
  await gotoView(page, base, 'dashboard');
  await page.waitForSelector(NAV_ITEM, { timeout: 20000 });
  const keys = await page.$$eval(NAV_ITEM, buttons => buttons.map(button => button.getAttribute('data-view')));
  // Misma lista que la línea base: sin la muestra interna de componentes (ui).
  return keys.filter(key => key && key !== 'ui');
}

/** Espera a que la vista deje el skeleton y la red se calme un poco. */
async function settle(page) {
  await page.waitForFunction(() => !document.querySelector('.view-enter .skeleton-view, .view-enter [class*="skeleton"]:only-child'), { timeout: 8000 }).catch(() => {});
  // API quieta: sin pedidos en vuelo durante 300 ms (máximo 4 s). Se cuenta a
  // mano porque waitForNetworkIdle no se entera de que terminan algunos chunks precargados.
  const net = networkTracker(page);
  const started = Date.now();
  while (Date.now() - started < 4000) {
    if (net.pending.size === 0 && Date.now() - net.last >= 300) break;
    await sleep(50);
  }
  await sleep(150);
}

function networkTracker(page) {
  if (page.__e2eNet) return page.__e2eNet;
  const net = { pending: new Set(), last: Date.now() };
  const done = request => { net.pending.delete(request); net.last = Date.now(); };
  // Solo la API: los chunks que la app precarga en idle a veces nunca avisan que terminaron.
  page.on('request', request => { if (!new URL(request.url()).pathname.startsWith('/api/')) return; net.pending.add(request); net.last = Date.now(); });
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  page.__e2eNet = net;
  return net;
}

export async function layoutTests({ browser, base, admin, releaseVersion, test, track = () => {} }) {
  const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, reducedMotion: true, viewport: { width: 1440, height: 900 } });
  track(page);
  networkTracker(page);
  const report = {};
  try {
    const views = await mainViews(page, base);
    for (const view of views) {
      report[view] = {};
      await test('i', 'Layout', `${view} a ${WIDTHS.join('/')} px`, async () => {
        await gotoView(page, base, view);
        await settle(page);
        if (!(await pathname(page)).endsWith(`/${view}`)) throw new Error(`La URL quedó en ${await pathname(page)}`);
        const totals = { horizontalScroll: 0, pageScrollbar: 0, scrollbars: 0, wrappedButtons: 0, overlaps: 0 };
        const parts = [];
        for (const width of WIDTHS) {
          await page.setViewport({ width, height: width < 768 ? 800 : 900 });
          await sleep(350);
          const probe = await page.evaluate(layoutProbe, 15);
          report[view][width] = probe;
          for (const key of Object.keys(totals)) totals[key] += probe.counts[key];
          parts.push(`${width}: ${probe.counts.horizontalScroll ? 'X' : '-'}${probe.counts.pageScrollbar ? 'P' : '-'}/${probe.counts.scrollbars}/${probe.counts.wrappedButtons}/${probe.counts.overlaps}`);
        }
        const problems = totals.horizontalScroll + totals.pageScrollbar + totals.scrollbars + totals.wrappedButtons + totals.overlaps;
        const summary = `scroll X en ${totals.horizontalScroll} anchos · barra de página en ${totals.pageScrollbar} · ${totals.scrollbars} barras · ${totals.wrappedButtons} botones partidos · ${totals.overlaps} solapamientos  [${parts.join('  ')}]`;
        if (problems) throw new Error(summary);
        return summary;
      }, { baseline: true });
    }
  } finally {
    await context.close();
  }
  return report;
}

/** CDP: gesto táctil con N dedos de `from` a `to` en `steps` pasos. */
async function touchGesture(cdp, from, to, steps = 12) {
  const point = (pts, t) => pts.map((p, i) => ({ x: p.x + (to[i].x - p.x) * t, y: p.y + (to[i].y - p.y) * t, id: i, radiusX: 2, radiusY: 2, force: 1 }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(from, 0) });
  for (let step = 1; step <= steps; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(from, step / steps) });
    await sleep(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(400);
}

const viewportState = page => page.evaluate(() => ({
  scale: window.visualViewport ? Number(window.visualViewport.scale.toFixed(3)) : 1,
  offsetLeft: window.visualViewport ? Math.round(window.visualViewport.offsetLeft) : 0,
  scrollX: Math.round(window.scrollX),
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth
}));

export async function mobileTests({ browser, base, admin, releaseVersion, test, track = () => {} }) {
  const device = KnownDevices['iPhone 13'];
  const report = {};
  const views = [['dashboard', '[data-dash="afuera"] .dash-rows'], ['loans', '[data-loans-grid="devices"]'], ['devices', '.dv-table [data-device-tag]']];

  // Control del instrumento: la misma pinza sobre una página que NO bloquea el
  // zoom tiene que agrandarla. Si no, "escala 1" en la app no probaría nada.
  let calibrated = true;
  await test('j', 'Mobile fijo', 'Control: la pinza de prueba hace zoom en una página sin bloqueo', async () => {
    const { context, page } = await openContext(browser, { base: '', token: '', device });
    try {
      const html = '<meta name="viewport" content="width=device-width, initial-scale=1"><div style="height:3000px;background:#888">control</div>';
      await page.goto(`data:text/html,${encodeURIComponent(html)}`);
      const cdp = await page.createCDPSession();
      const { width, height } = device.viewport;
      const cy = Math.round(height * 0.55);
      await touchGesture(cdp, [{ x: width / 2 - 40, y: cy }, { x: width / 2 + 40, y: cy }], [{ x: 20, y: cy - 60 }, { x: width - 20, y: cy + 60 }]);
      const state = await viewportState(page);
      report.calibration = state;
      calibrated = state.scale > 1;
      if (!calibrated) throw new Error('La pinza no hizo zoom ni en la página de control: los resultados de pinza no son concluyentes.');
      return `escala ${state.scale} en la página de control`;
    } finally {
      await context.close();
    }
  }, { baseline: true });

  for (const [view, ready] of views) {
    report[view] = {};
    await test('j', 'Mobile fijo', `${view} en iPhone 13: pinza, swipe, doble toque y foco`, async () => {
      const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, device, reducedMotion: true });
      track(page);
      networkTracker(page);
      try {
        const cdp = await page.createCDPSession();
        const load = async () => {
          await gotoView(page, base, view);
          await page.waitForSelector(ready, { timeout: 20000 }).catch(() => {});
          await settle(page);
        };
        await load();
        const { width, height } = device.viewport;
        const cx = width / 2;
        const cy = Math.round(height * 0.55);
        const problems = [];

        // Pinza con dos dedos (CDP Input.dispatchTouchEvent, 2 puntos que se separan).
        await touchGesture(cdp, [{ x: cx - 40, y: cy }, { x: cx + 40, y: cy }], [{ x: 20, y: cy - 60 }, { x: width - 20, y: cy + 60 }]);
        const pinch = await viewportState(page);
        if (pinch.scale !== 1) problems.push(`pinza dejó la escala en ${pinch.scale}`);
        // Control: el gesto sintetizado del navegador (si la página no lo bloquea, hace zoom).
        if (pinch.scale === 1) {
          await cdp.send('Input.synthesizePinchGesture', { x: cx, y: cy, scaleFactor: 2.5, relativeSpeed: 800, gestureSourceType: 'touch' }).catch(() => {});
          await sleep(400);
          const synth = await viewportState(page);
          if (synth.scale !== 1) problems.push(`pinza sintetizada dejó la escala en ${synth.scale}`);
          report[view].synthesizedPinch = synth;
        }
        report[view].pinch = pinch;
        if (problems.length) await load();

        // Swipe horizontal de un dedo.
        await touchGesture(cdp, [{ x: width - 20, y: cy }], [{ x: 20, y: cy }]);
        const swipe = await viewportState(page);
        report[view].swipe = swipe;
        if (swipe.scrollX !== 0 || swipe.offsetLeft !== 0) problems.push(`swipe dejó scrollX=${swipe.scrollX}, offsetLeft=${swipe.offsetLeft}`);
        if (swipe.scrollWidth > swipe.clientWidth) problems.push(`documento más ancho que la pantalla (${swipe.scrollWidth} > ${swipe.clientWidth})`);

        // Doble toque sobre una zona sin controles.
        for (let i = 0; i < 2; i += 1) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 8, y: cy, id: 0 }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await sleep(60);
        }
        await sleep(400);
        const doubleTap = await viewportState(page);
        report[view].doubleTap = doubleTap;
        if (doubleTap.scale !== 1) problems.push(`doble toque dejó la escala en ${doubleTap.scale}`);

        // Foco en un campo: la escala no cambia y el texto mide 16 px o más (si no, iOS hace zoom).
        const input = await page.$('main input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])');
        if (input) {
          const box = await input.boundingBox();
          if (box) {
            await page.evaluate(element => element.scrollIntoView({ block: 'center' }), input);
            const fresh = await input.boundingBox();
            await page.touchscreen.tap(fresh.x + Math.min(20, fresh.width / 2), fresh.y + fresh.height / 2);
          }
          await input.focus();
          await sleep(400);
          const focus = { ...(await viewportState(page)), fontSize: await input.evaluate(element => parseFloat(getComputedStyle(element).fontSize)) };
          report[view].focus = focus;
          if (focus.scale !== 1) problems.push(`foco en un campo dejó la escala en ${focus.scale}`);
          if (focus.fontSize < 16) problems.push(`campo con texto de ${focus.fontSize}px (<16, iOS hace zoom al enfocarlo)`);
        }
        if (problems.length) throw new Error(problems.join('; '));
        return `escala 1 tras pinza${calibrated ? '' : ' (no concluyente)'}/doble toque/foco; scrollX 0 tras swipe (${(await pathname(page)).replace(`/sede/${SITE.toLowerCase()}/`, '')})`;
      } finally {
        await context.close();
      }
    }, { baseline: true });
  }
  return report;
}
