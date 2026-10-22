// qa-d) QA de lanzamiento, frente D (docs/redesign/qa/HALLAZGOS-1.md): shell,
// mobile y asistente.
//   9  Íconos de la barra superior con nombre (aria-label + tooltip al pasar el
//      mouse o con foco de teclado) y objetivos táctiles de 44 px en src/ui
//      (pointer: coarse), sin agrandar el desktop.
//   3  "Escanear" de la barra inferior sin cámara: aviso en criollo, foco en el
//      campo del código, sin panel de cámara pegado.
//   21 "Instalá TechAsset": una línea (≤ 56 px), solo en el Inicio, "Más tarde"
//      la guarda 30 días.
//   22 "Más" con su entrada en el historial (#mas): Atrás lo cierra y la vista
//      anterior no queda debajo.
//   14 Asistente: dice si usa IA (y de quién) o el modo básico, qué se manda y
//      que no recibe audio, con link a Privacidad; ejemplos con equipos reales
//      que no mandan acciones solos; avisa cuando abre otra vista; un solo
//      mensaje de "sin IA".
//   26 Textos del shell: tema con rótulo, "Como el sistema", pistas de "Más",
//      Ctrl K encuentra Privacidad y usa un equipo real de ejemplo.
// Capturas a 375 y 1366 px en e2e/.out/qa-d/.
import fs from 'node:fs';
import path from 'node:path';
import { assert, gotoView, openContext, sleep, until } from '../lib/browser.mjs';
import { root } from '../lib/env.mjs';
import { installStreamMock } from './assistant.mjs';

const OUT = path.join(root, 'e2e', '.out', 'qa-d');
const PHONE = { width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESKTOP = { width: 1366, height: 900 };

async function shot(page, name) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) }).catch(() => {});
}

/** Sin cámara (o con el permiso bloqueado) aunque el Chrome de prueba tenga una falsa. */
async function fakeCamera(page, { devices = [], permission = 'prompt' } = {}) {
  await page.evaluateOnNewDocument((list, state) => {
    const media = navigator.mediaDevices;
    if (media) {
      media.enumerateDevices = async () => list.map(kind => ({ kind, deviceId: '', groupId: '', label: '' }));
      media.getUserMedia = async () => { window.__gumCalls = (window.__gumCalls || 0) + 1; throw new DOMException('Sin cámara', 'NotFoundError'); };
    }
    if (navigator.permissions) {
      const original = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = desc => (desc && desc.name === 'camera' ? Promise.resolve({ state }) : original(desc));
    }
  }, devices, permission);
}

/** Dispara un `beforeinstallprompt` como el de Chrome en Android. */
async function offerInstall(page) {
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    event.prompt = async () => { window.__installPrompted = true; };
    event.userChoice = Promise.resolve({ outcome: 'dismissed' });
    window.dispatchEvent(event);
  });
}

const tabButton = (page, label) => page.evaluateHandle(text => [...document.querySelectorAll('.shell-tabbar .shell-tab')].find(tab => (tab.textContent || '').trim().startsWith(text)) || null, label);

async function tapTab(page, label) {
  const handle = await tabButton(page, label);
  const element = handle.asElement();
  assert(element, `No está el botón "${label}" de la barra inferior.`);
  await element.tap();
}

/**
 * Objetivos táctiles de la librería (src/ui) en la primera pantalla: desde el
 * centro, 21 px para cada lado tiene que seguir cayendo en el mismo control
 * (área de 44 × 44, aunque se vea más chico: casilla, píldora del segmentado).
 */
async function smallTargets(page) {
  return page.evaluate(() => {
    const SEL = '.ui-btn, .ui-icon-btn, .ui-seg-item, .ui-control, .ui-check, .ui-switch, .ui-tab, .ui-th-sort, .ui-input-affix > button, .ui-tag-option, .ui-disclosure-btn';
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const tabbar = document.querySelector('.shell-tabbar')?.getBoundingClientRect();
    const head = document.querySelector('.shell-head')?.getBoundingClientRect();
    const bad = [];
    let checked = 0;
    for (const el of document.querySelectorAll(SEL)) {
      if (el.closest('[inert], [hidden], .ui-collapse:not([data-state="open"])') || el.matches(':disabled, .is-disabled')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      // Lejos de los bordes y de las barras fijas (ahí lo de al lado es otra cosa).
      const top = Math.max(head?.bottom || 0, 0) + 24;
      const bottom = (tabbar?.top || vh) - 24;
      if (cx < 24 || cx > vw - 24 || cy < top || cy > bottom) continue;
      checked += 1;
      const misses = [[21, 0], [-21, 0], [0, 21], [0, -21]].filter(([dx, dy]) => {
        const hit = document.elementFromPoint(cx + dx, cy + dy);
        return !hit || !(el === hit || el.contains(hit) || hit.contains(el) && hit.matches('label'));
      });
      if (misses.length) {
        const text = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30);
        bad.push(`${el.className.split(' ')[0]} "${text}" ${Math.round(r.width)}×${Math.round(r.height)} (falla ${misses.map(m => m.join(',')).join(' ')})`);
      }
    }
    return { checked, bad };
  });
}

export async function qaDTests({ browser, base, api, admin, releaseVersion, test, track = () => {} }) {
  const devices = await api.devices();
  const tags = new Set(devices.map(device => device.etiqueta));

  // ── 9: nombre de los íconos de la barra superior (desktop 1366) ──────────
  await test('qa-d', 'Shell', '9: cada ícono de la barra superior tiene nombre (aria-label) y lo muestra al pasar el mouse y con Tab (tooltip, dentro de la pantalla)', async () => {
    const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: DESKTOP });
    track(page);
    try {
      await gotoView(page, base, 'dashboard');
      await page.waitForSelector('.shell-topbar .shell-bell');
      await sleep(400);
      const buttons = await page.$$eval('.shell-topbar button', nodes => nodes
        .filter(node => !node.hidden && node.getBoundingClientRect().width > 0)
        .map(node => ({ cls: node.className, label: node.getAttribute('aria-label') || '', text: (node.textContent || '').trim() })));
      const unnamed = buttons.filter(button => !button.label);
      assert(!unnamed.length, `Botones sin aria-label: ${JSON.stringify(unnamed)}`);
      const seen = [];
      for (const selector of ['.shell-collapse-btn', '.shell-desktop-only', '.shell-bell', '.shell-account-btn']) {
        const handle = await page.$(`.shell-topbar ${selector}`);
        if (!handle || !(await handle.evaluate(node => !node.hidden && node.getBoundingClientRect().width > 0))) continue;
        await handle.hover();
        const tip = await until(() => page.evaluate(() => {
          const node = document.querySelector('.ui-tooltip');
          if (!node) return null;
          const r = node.getBoundingClientRect();
          return { text: node.textContent.trim(), inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight };
        }), { message: `el tooltip de ${selector}` });
        assert(tip.inside, `El tooltip de ${selector} se sale de la pantalla.`);
        seen.push(tip.text);
        if (selector === '.shell-bell') await shot(page, 'qa-d-1366-tooltip-campana');
      }
      await page.mouse.move(5, 500);
      await until(() => page.evaluate(() => !document.querySelector('.ui-tooltip')), { message: 'que el tooltip se vaya al sacar el mouse' });
      // Con teclado: foco en la campana → mismo nombre.
      await page.$eval('.shell-topbar .shell-bell', node => node.focus());
      await page.keyboard.press('Tab');
      await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
      const focusTip = await until(() => page.evaluate(() => document.querySelector('.ui-tooltip')?.textContent?.trim() || ''), { message: 'el tooltip con foco de teclado' });
      assert(/Notificaciones/.test(focusTip), `Con foco: "${focusTip}"`);
      assert(seen.some(text => /Accesos rápidos/.test(text)) && seen.some(text => /Notificaciones/.test(text)) && seen.some(text => /cuenta/i.test(text)), `Tooltips vistos: ${seen.join(' | ')}`);
      return seen.join(' · ');
    } finally {
      await context.close();
    }
  });

  // ── 9: objetivos táctiles (375, touch) ───────────────────────────────────
  await test('qa-d', 'Mobile', '9: en touch (375) los controles de src/ui tienen 44 × 44 de área (Inicio, Préstamos, Dispositivos, Agenda) y el desktop no cambia', async () => {
    const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: PHONE });
    track(page);
    const out = [];
    try {
      await gotoView(page, base, 'dashboard');
      assert(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'La emulación de touch no da pointer: coarse.');
      const problems = [];
      for (const view of ['dashboard', 'loans', 'devices', 'agenda']) {
        await gotoView(page, base, view);
        await sleep(1500);
        const { checked, bad } = await smallTargets(page);
        out.push(`${view} ${checked}`);
        if (bad.length) problems.push(`${view}: ${bad.slice(0, 6).join('; ')}`);
      }
      assert(!problems.length, problems.join(' || '));
    } finally {
      await context.close();
    }
    // Desktop con mouse: el segmentado y el botón chico siguen midiendo lo de siempre.
    const desk = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: DESKTOP });
    track(desk.page);
    try {
      await gotoView(desk.page, base, 'agenda');
      await desk.page.waitForSelector('.ui-seg-item', { timeout: 20000 });
      const seg = await desk.page.$eval('.ui-seg-item', node => Math.round(node.getBoundingClientRect().height));
      assert(seg <= 32, `En desktop el segmentado mide ${seg} px de alto (antes 30).`);
      out.push(`desktop seg ${seg} px`);
    } finally {
      await desk.context.close();
    }
    return out.join(' · ');
  });

  // ── 3: Escanear sin cámara ───────────────────────────────────────────────
  for (const scenario of [
    { name: 'sin cámara', devices: [], permission: 'prompt', text: /No encontramos una cámara/ },
    { name: 'cámara bloqueada', devices: ['videoinput'], permission: 'denied', text: /tiene bloqueada la cámara/ }
  ]) {
    await test('qa-d', 'Mobile', `3: "Escanear" de la barra inferior ${scenario.name}: va a Préstamos con el foco en el campo y un aviso en criollo que se va solo`, async () => {
      const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: PHONE });
      track(page);
      try {
        await fakeCamera(page, scenario);
        await gotoView(page, base, 'dashboard');
        await page.waitForSelector('.shell-tabbar .shell-tab-scan', { timeout: 20000 });
        await (await page.$('.shell-tabbar .shell-tab-scan')).tap();
        await until(async () => (await page.evaluate(() => location.pathname.toLowerCase())).endsWith('/loans'), { message: 'ir a Préstamos' });
        await until(() => page.evaluate(() => document.activeElement?.id === 'lo-code'), { timeout: 8000, message: 'el foco en el campo del código' });
        const line = await until(() => page.evaluate(() => [...document.querySelectorAll('.shell-head .ui-status-msg')].map(node => node.textContent || '').join(' | ')), { message: 'la línea de estado' });
        assert(scenario.text.test(line), `Aviso: "${line}"`);
        assert(/escribí el número del equipo/i.test(line), `El aviso no dice qué hacer: "${line}"`);
        assert(!/HTTPS|localhost|permisos del navegador/i.test(line), `Jerga técnica: "${line}"`);
        const example = line.match(/por ejemplo, ([^)]+)\)/)?.[1] || '';
        assert(!example || devices.some(device => device.aliasOperativo === example || device.etiqueta === example), `El ejemplo "${example}" no es un equipo de la sede.`);
        const camera = await page.evaluate(() => ({
          gum: window.__gumCalls || 0,
          panel: Boolean(document.querySelector('#lo-camera')?.closest('.ui-collapse[data-state="open"], .ui-collapse[data-state="opening"]')),
          close: [...document.querySelectorAll('button')].some(button => /Cerrar cámara/.test(button.textContent || ''))
        }));
        assert(!camera.gum && !camera.panel && !camera.close, `Se intentó la cámara igual: ${JSON.stringify(camera)}`);
        await shot(page, `qa-d-375-escanear-${scenario.name.replace(/\s+/g, '-')}`);
        // No queda pegado: se va solo.
        await until(() => page.evaluate(() => !document.querySelector('.shell-head .ui-status-msg')), { timeout: 14000, message: 'que el aviso se vaya solo' });
        return line.slice(0, 120);
      } finally {
        await context.close();
      }
    });
  }

  // ── 21: franja de instalar ───────────────────────────────────────────────
  await test('qa-d', 'Mobile', '21: "Instalá TechAsset" es una línea (≤ 56 px), solo en el Inicio, y "Más tarde" la guarda 30 días', async () => {
    const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: PHONE });
    track(page);
    try {
      await gotoView(page, base, 'dashboard');
      await page.waitForSelector('.shell-tabbar .shell-tab');
      await sleep(600);
      await offerInstall(page);
      const box = await until(() => page.evaluate(() => {
        const line = document.querySelector('.shell-install');
        const wrap = line?.closest('.ui-collapse');
        if (!line || wrap?.getAttribute('data-state') !== 'open') return null;
        const r = line.getBoundingClientRect();
        const buttons = [...line.querySelectorAll('button')].map(button => button.getBoundingClientRect());
        return { h: Math.round(r.height), oneRow: buttons.every(b => Math.abs(b.top - buttons[0].top) < 2), text: line.textContent, w: Math.round(r.width), right: Math.max(...buttons.map(b => b.right)) };
      }), { message: 'la línea de instalar' });
      assert(box.h <= 56, `La línea de instalar mide ${box.h} px (antes ~128).`);
      assert(box.oneRow, 'Los botones no quedaron en una sola fila.');
      assert(box.right <= 375, 'Un botón se sale de la pantalla.');
      await shot(page, 'qa-d-375-instalar');
      // En otra vista no ocupa lugar.
      await tapTab(page, 'Préstamos');
      await until(async () => (await page.evaluate(() => location.pathname.toLowerCase())).endsWith('/loans'), { message: 'ir a Préstamos' });
      await until(() => page.evaluate(() => {
        const wrap = document.querySelector('.shell-install')?.closest('.ui-collapse');
        return !wrap || wrap.getAttribute('data-state') === 'closed';
      }), { message: 'que la línea no esté en Préstamos' });
      await tapTab(page, 'Inicio');
      await until(() => page.evaluate(() => document.querySelector('.shell-install')?.closest('.ui-collapse')?.getAttribute('data-state') === 'open'), { message: 'que vuelva en el Inicio' });
      // "Más tarde": se va y no vuelve al recargar aunque el navegador la ofrezca de nuevo.
      await page.evaluate(() => [...document.querySelectorAll('.shell-install button')].find(button => /Más tarde/.test(button.textContent || ''))?.click());
      await until(() => page.evaluate(() => !document.querySelector('.shell-install')), { message: 'que "Más tarde" la saque' });
      const stamp = await page.evaluate(() => Number(localStorage.getItem('techasset_install_dismissed')));
      assert(Date.now() - stamp < 60000, `"Más tarde" guardó ${stamp}.`);
      await gotoView(page, base, 'dashboard');
      await sleep(600);
      await offerInstall(page);
      await sleep(700);
      assert(!(await page.$('.shell-install')), 'Volvió a aparecer después de "Más tarde".');
      // A los 31 días se vuelve a ofrecer.
      await page.evaluate(() => localStorage.setItem('techasset_install_dismissed', String(Date.now() - 31 * 24 * 3600 * 1000)));
      await gotoView(page, base, 'dashboard');
      await sleep(600);
      await offerInstall(page);
      await until(() => page.$('.shell-install'), { message: 'que vuelva a ofrecerse a los 31 días' });
      return `${box.h} px, una fila; solo en el Inicio; 30 días`;
    } finally {
      await context.close();
    }
  });

  // ── 22: "Más" con historial ──────────────────────────────────────────────
  await test('qa-d', 'Mobile', '22: "Más" suma #mas al historial, tapa la vista anterior y Atrás lo cierra (y vuelve a donde estabas)', async () => {
    const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: PHONE });
    track(page);
    try {
      await gotoView(page, base, 'dashboard');
      await page.waitForSelector('.shell-tabbar .shell-tab');
      await tapTab(page, 'Préstamos');
      await until(async () => (await page.evaluate(() => location.pathname.toLowerCase())).endsWith('/loans'), { message: 'ir a Préstamos' });
      await page.waitForSelector('#lo-code', { timeout: 20000 });
      await sleep(800);
      await page.evaluate(() => { document.querySelector('.shell-scroll').scrollTop = 300; });
      const before = await page.evaluate(() => ({ len: history.length, top: document.querySelector('.shell-scroll').scrollTop }));
      await tapTab(page, 'Más');
      await until(() => page.evaluate(() => location.hash === '#mas' && !document.querySelector('#shell-more')?.hidden), { message: 'Más abierto con #mas' });
      await sleep(400);
      const open = await page.evaluate(() => {
        const view = document.querySelector('.shell-view');
        const more = document.querySelector('#shell-more');
        const scroller = document.querySelector('.shell-scroll');
        return {
          viewHidden: view.hidden && getComputedStyle(view).display === 'none',
          title: document.querySelector('.shell-title-main')?.textContent,
          // Debajo de "Más" no hay nada más: lo que scrollea es solo "Más".
          tail: Math.round(scroller.scrollHeight - (more.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top + scroller.scrollTop)),
          hints: document.querySelectorAll('.shell-more-hint').length,
          top: scroller.scrollTop
        };
      });
      assert(open.viewHidden, 'La vista anterior sigue dibujada debajo de "Más".');
      assert(open.title === 'Más', `Título: ${open.title}`);
      assert(open.tail <= 40, `Debajo de "Más" quedan ${open.tail} px de otra cosa.`);
      assert(open.hints > 3, 'Las secciones de "Más" no dicen qué son.');
      assert(open.top === 0, '"Más" no arrancó arriba.');
      await shot(page, 'qa-d-375-mas');
      // Atrás del celu: se cierra "Más" y quedás en Préstamos donde estabas.
      await page.goBack();
      await until(() => page.evaluate(() => location.hash === '' && document.querySelector('#shell-more')?.hidden && !document.querySelector('.shell-view').hidden), { message: 'que Atrás cierre "Más"' });
      const back = await page.evaluate(() => ({ path: location.pathname.toLowerCase(), len: history.length, top: document.querySelector('.shell-scroll').scrollTop }));
      assert(back.path.endsWith('/loans'), `Atrás salió de Préstamos: ${back.path}`);
      assert(Math.abs(back.top - before.top) <= 2, `La posición no volvió: ${back.top} (antes ${before.top}).`);
      // Tocar "Más" otra vez lo cierra sin dejar una entrada de más: Atrás va a la vista anterior.
      await tapTab(page, 'Más');
      await until(() => page.evaluate(() => location.hash === '#mas'), { message: 'Más otra vez' });
      await tapTab(page, 'Más');
      await until(() => page.evaluate(() => location.hash === '' && document.querySelector('#shell-more')?.hidden), { message: 'cerrar con el mismo botón' });
      // Esc también lo cierra.
      await tapTab(page, 'Más');
      await until(() => page.evaluate(() => location.hash === '#mas'), { message: 'Más otra vez' });
      await page.keyboard.press('Escape');
      await until(() => page.evaluate(() => location.hash === '' && document.querySelector('#shell-more')?.hidden), { message: 'cerrar con Esc' });
      // Desde "Más" a una sección: Atrás vuelve a Préstamos (no a "Más").
      await tapTab(page, 'Más');
      await until(() => page.evaluate(() => location.hash === '#mas'), { message: 'Más otra vez' });
      await page.evaluate(() => [...document.querySelectorAll('#shell-more .shell-more-item')].find(item => /Dispositivos/.test(item.textContent || ''))?.click());
      await until(async () => (await page.evaluate(() => location.pathname.toLowerCase())).endsWith('/devices'), { message: 'ir a Dispositivos desde Más' });
      await until(() => page.evaluate(() => document.querySelector('#shell-more')?.hidden && location.hash === ''), { message: 'Más cerrado en Dispositivos' });
      await page.goBack();
      await until(async () => (await page.evaluate(() => location.pathname.toLowerCase())).endsWith('/loans'), { message: 'Atrás desde Dispositivos vuelve a Préstamos' });
      assert(await page.evaluate(() => document.querySelector('#shell-more')?.hidden), 'Atrás reabrió "Más".');
      await page.goBack();
      await until(async () => (await page.evaluate(() => location.pathname.toLowerCase())).endsWith('/dashboard'), { message: 'Atrás de nuevo vuelve al Inicio (sin entradas de más)' });
      return `#mas, vista oculta, Atrás/Esc/Más cierran, scroll ${before.top}→${back.top}`;
    } finally {
      await context.close();
    }
  });

  // ── 14: asistente en modo básico (el banco no usa IA) ────────────────────
  await test('qa-d', 'Asistente', '14: modo básico: lo dice arriba, explica qué pasa con lo que escribís (link a Privacidad) y los ejemplos son equipos reales que contesta', async () => {
    const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: DESKTOP });
    track(page);
    try {
      const status = (await api.get('/api/asistente/status')).data || {};
      await gotoView(page, base, 'dashboard');
      await page.$eval('.shell-assistant-btn', button => button.click());
      await page.waitForSelector('.asst:not([hidden]) .asst-privacy', { timeout: 15000 });
      const info = await page.evaluate(() => ({
        sub: document.querySelector('.asst:not([hidden]) .asst-title span')?.textContent || '',
        privacy: document.querySelector('.asst:not([hidden]) .asst-privacy')?.textContent || '',
        link: (() => { const a = document.querySelector('.asst:not([hidden]) .asst-privacy a'); return a ? { href: a.getAttribute('href'), target: a.target } : null; })(),
        chips: [...document.querySelectorAll('.asst:not([hidden]) .asst-suggestion')].map(chip => chip.textContent.trim())
      }));
      if (status.provider === 'local') {
        assert(/Modo básico, sin IA/.test(info.sub), `Subtítulo: "${info.sub}"`);
        assert(/No usa IA/.test(info.privacy) && /no se guarda/.test(info.privacy), `Privacidad: "${info.privacy}"`);
      }
      assert(info.link?.href === '/privacidad' && info.link.target === '_blank', `Link: ${JSON.stringify(info.link)}`);
      for (const chip of info.chips) {
        const tag = chip.match(/\bD\d+\b/)?.[0];
        assert(!tag || tags.has(tag), `El ejemplo "${chip}" nombra un equipo que no existe en la sede.`);
        assert(!/Mili|Equi|D1436|D1432|Touch 34/.test(chip) || tags.has('D1436'), `Ejemplo inventado: "${chip}"`);
      }
      await shot(page, 'qa-d-1366-asistente-basico');
      if (info.chips.length) {
        await page.evaluate(() => document.querySelector('.asst:not([hidden]) .asst-suggestion')?.click());
        const reply = await until(() => page.evaluate(() => {
          const turn = [...document.querySelectorAll('.asst:not([hidden]) .asst-turn')].pop();
          return turn?.getAttribute('data-state') === 'done' ? turn.textContent : null;
        }), { timeout: 15000, message: 'la respuesta al ejemplo' });
        const asked = info.chips[0].match(/\bD\d+\b/)?.[0];
        assert(!asked || reply.includes(asked), `El ejemplo no contestó sobre ${asked}: "${reply.slice(0, 120)}"`);
        assert(!/No encontré/.test(reply), `El ejemplo no existe: "${reply.slice(0, 120)}"`);
      }
      // Un solo mensaje para "sin IA", con una etiqueta real de ejemplo.
      const replies = [];
      for (const content of ['prestá la touch 8 a Ana Profe', '¿Qué hacés con lo que te escribo? ¿Lo mandás a una IA? ¿Se guarda?', 'hola', 'contame un chiste']) {
        const { data } = await api.post('/api/asistente/chat', { messages: [{ role: 'user', content }] });
        replies.push(data.reply || '');
      }
      if (status.provider === 'local') {
        assert(replies.every(text => /^(Hola\. )?Estoy en modo básico, sin IA/.test(text)), `Mensajes de modo básico distintos: ${replies.join(' | ')}`);
        assert(!replies.some(text => /no está configurado|no está disponible/.test(text)), 'Quedó un mensaje viejo de "sin IA".');
        for (const text of replies) {
          const tag = text.match(/por ejemplo (D?\w+)\)/)?.[1];
          assert(!tag || tags.has(tag), `Ejemplo inexistente en "${text}"`);
        }
        assert(/no sale del servidor/.test(replies[1]), `La pregunta de privacidad no se contestó: "${replies[1]}"`);
      }
      return `${info.sub} · ${info.chips.join(' / ') || 'sin ejemplos'}`;
    } finally {
      await context.close();
    }
  });

  await test('qa-d', 'Asistente', '14: con IA (status simulado): dice quién procesa, los ejemplos que harían algo solo completan el campo, y abrir otra vista se avisa', async () => {
    const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: DESKTOP });
    track(page);
    try {
      await page.setRequestInterception(true);
      page.on('request', request => {
        if (request.url().includes('/api/asistente/status')) {
          request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, provider: 'anthropic', model: 'claude-haiku-5-5', mode: 'anthropic' }) });
        } else request.continue();
      });
      await gotoView(page, base, 'dashboard');
      await page.$eval('.shell-assistant-btn', button => button.click());
      await page.waitForSelector('.asst:not([hidden]) .asst-privacy', { timeout: 15000 });
      await until(() => page.evaluate(() => /Anthropic/.test(document.querySelector('.asst:not([hidden]) .asst-title span')?.textContent || '')), { message: 'el subtítulo con el proveedor' });
      const privacy = await page.$eval('.asst:not([hidden]) .asst-privacy', node => node.textContent || '');
      assert(/Usa IA de Anthropic/.test(privacy) && /no guarda la conversación/.test(privacy), `Privacidad: "${privacy}"`);
      await shot(page, 'qa-d-1366-asistente-ia');
      await installStreamMock(page, { route: 'loans' });
      // Ejemplo que haría algo: completa el campo, no manda.
      const fill = await page.$('.asst:not([hidden]) .asst-suggestion.is-fill');
      assert(fill, 'No hay ejemplos que solo completen el campo.');
      const fillText = await fill.evaluate(node => node.textContent.trim());
      await fill.click();
      await sleep(300);
      const field = await page.$eval('.asst:not([hidden]) .asst-input', input => ({ value: input.value, focused: document.activeElement === input, caret: input.selectionStart }));
      assert(/^(Prestale el .+ a |Creá una tarea para )$/.test(field.value) && field.focused && field.caret === field.value.length, `Campo después del ejemplo: ${JSON.stringify(field)}`);
      assert((await page.evaluate(() => window.__asstMock.requests.length)) === 0, `"${fillText}" mandó el pedido solo.`);
      const named = field.value.match(/^Prestale el (.+) a $/)?.[1];
      assert(!named || devices.some(device => device.aliasOperativo === named || device.etiqueta === named), `El ejemplo "${named}" no es un equipo de la sede.`);
      // Una respuesta que sugiere Préstamos sin que se haya pedido ir: no cambia la pantalla, ofrece el enlace.
      await page.$eval('.asst:not([hidden]) .asst-input', input => input.focus());
      await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
      await page.keyboard.type('Prestale los equipos del lote a Máximo');
      await page.keyboard.press('Enter');
      await page.evaluate(() => window.__asstGate());
      await until(() => page.evaluate(() => [...document.querySelectorAll('.asst:not([hidden]) .asst-turn')].pop()?.getAttribute('data-state') === 'done'), { message: 'el final del stream' });
      await sleep(300);
      assert((await page.evaluate(() => location.pathname.toLowerCase())).endsWith('/dashboard'), 'Cambió la vista sin que se pidiera.');
      assert(await page.evaluate(() => [...document.querySelectorAll('.asst:not([hidden]) .asst-listen')].some(button => /Abrir Préstamos/.test(button.textContent || ''))), 'No ofreció el enlace a Préstamos.');
      // "Abrí Préstamos": ahí sí cambia, y lo dice en la respuesta y en la línea de estado.
      await page.$eval('.asst:not([hidden]) .asst-input', input => input.focus());
      await page.keyboard.type('abrí préstamos');
      await page.keyboard.press('Enter');
      await until(async () => (await page.evaluate(() => location.pathname.toLowerCase())).endsWith('/loans'), { message: 'que abra Préstamos' });
      const note = await until(() => page.evaluate(() => document.querySelector('.asst:not([hidden]) .asst-nav-note')?.textContent || ''), { message: 'la nota en la respuesta' });
      assert(/Abrí Préstamos/.test(note), `Nota: "${note}"`);
      const line = await until(() => page.evaluate(() => [...document.querySelectorAll('.shell-head .ui-status-msg')].map(node => node.textContent).join(' ')), { message: 'la línea de estado' });
      assert(/El asistente abrió Préstamos/.test(line), `Línea: "${line}"`);
      await shot(page, 'qa-d-1366-asistente-abrio');
      return `${fillText} completa sin mandar · enlace sin pedir · "${note}"`;
    } finally {
      await context.close();
    }
  });

  // ── 26: textos del shell ─────────────────────────────────────────────────
  await test('qa-d', 'Shell', '26: tema con rótulo y "Como el sistema"; Ctrl K encuentra Privacidad y su ejemplo es un equipo real', async () => {
    const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: DESKTOP });
    track(page);
    try {
      await gotoView(page, base, 'dashboard');
      await page.click('.shell-topbar .shell-account-btn');
      await page.waitForSelector('#shell-strip-account .shell-seg');
      const theme = await page.evaluate(() => ({
        label: document.querySelector('#shell-theme-label')?.textContent,
        options: [...document.querySelectorAll('#shell-strip-account .shell-seg button')].map(button => button.textContent.trim())
      }));
      assert(theme.label === 'Tema de la pantalla' && theme.options.includes('Como el sistema'), JSON.stringify(theme));
      await page.keyboard.press('Escape');
      await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
      await page.waitForSelector('.shell-pal-input');
      const placeholder = await page.$eval('.shell-pal-input', input => input.placeholder);
      const sample = placeholder.match(/prestar (\S+)”/)?.[1];
      assert(sample && tags.has(sample), `Ejemplo del buscador: "${placeholder}"`);
      await page.type('.shell-pal-input', 'privacidad');
      await until(() => page.evaluate(() => [...document.querySelectorAll('.shell-pal-item')].some(item => /Privacidad y datos/.test(item.textContent || ''))), { message: 'Privacidad en Ctrl K' });
      return `${theme.options.join(' / ')} · "${placeholder}"`;
    } finally {
      await context.close();
    }
  });

  // ── Capturas a 375 y 1366 (oscuro), estados principales ──────────────────
  await test('qa-d', 'Capturas', 'Capturas 375 y 1366: Inicio, Más, asistente (vista propia y columna), Ctrl K', async () => {
    const files = [];
    for (const [label, viewport] of [['375', PHONE], ['1366', DESKTOP]]) {
      const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, viewport });
      track(page);
      try {
        await gotoView(page, base, 'dashboard');
        await sleep(1500);
        await shot(page, `qa-d-${label}-inicio`); files.push(`${label}-inicio`);
        await page.$eval('.shell-assistant-btn', button => button.click());
        await page.waitForSelector('.asst:not([hidden]) .asst-privacy', { timeout: 15000 });
        await sleep(600);
        await shot(page, `qa-d-${label}-asistente`); files.push(`${label}-asistente`);
        await page.keyboard.press('Escape');
        await sleep(400);
        const horizontal = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
        assert(!horizontal, `${label}: scroll horizontal.`);
      } finally {
        await context.close();
      }
    }
    return `${files.length} capturas en e2e/.out/qa-d/`;
  });
}
