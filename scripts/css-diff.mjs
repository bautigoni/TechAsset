// Compara los estilos computados de la app con el CSS de entrada actual (dist/)
// contra otro CSS de entrada (el de antes de una purga), en todas las vistas
// del menú, páginas de detalle, login y landing, en oscuro y claro y en
// 1440/1024/768/390. Cero diferencias = la purga no cambió nada visible.
//
//   npm run build && node scripts/css-diff.mjs --before=<index-viejo.css> [--only=loans] [--widths=1440,390]
//
// Cómo: con la página cargada (CSS nuevo) toma todas las propiedades
// computadas de cada elemento (y de ::before/::after con contenido), dos veces
// para descartar lo que cambia solo (animaciones infinitas); después apaga el
// <link> del CSS de entrada, inyecta el viejo en el mismo lugar, vuelve a medir
// y compara. Mismo DOM, misma sesión: lo único que cambia es la hoja.
// Corre contra una COPIA de la base (como e2e), nunca la real.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { apiClient, findBrowser, freePort, prepareDatabase, removeTmp, root, startServer, stopServer } from '../e2e/lib/env.mjs';
import { gotoView, openContext, sleep } from '../e2e/lib/browser.mjs';
import { settle } from '../e2e/lib/ux-probe.mjs';

const args = process.argv.slice(2);
const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const beforePath = option('before');
if (!beforePath || !fs.existsSync(beforePath)) {
  console.error('Uso: node scripts/css-diff.mjs --before=<index.css de antes>');
  process.exit(2);
}
const beforeCss = fs.readFileSync(beforePath, 'utf8');
const only = option('only');
const WIDTHS = (option('widths') || '1440,1024,768,390').split(',').map(Number);
const THEMES = ['dark', 'light'];
const SETTINGS_PANELS = ['cuenta', 'apariencia', 'notificaciones', 'turnos', 'modulos', 'roles', 'usuarios', 'invitaciones', 'prestamo', 'vida-util', 'sede', 'avanzado', 'sedes', 'mail'];

/* Corre en la página. */
function pageCapture(slot) {
  const els = [document.documentElement, ...document.documentElement.querySelectorAll('*')]
    .filter(el => !(el instanceof HTMLScriptElement) && !(el instanceof HTMLStyleElement) && !(el instanceof HTMLLinkElement) && !(el instanceof HTMLMetaElement));
  const read = (el, pseudo) => {
    const cs = getComputedStyle(el, pseudo);
    if (pseudo && (cs.content === 'none' || cs.content === 'normal')) return '';
    const out = [];
    for (let i = 0; i < cs.length; i += 1) out.push(cs[i] + ':' + cs.getPropertyValue(cs[i]));
    return out.join(';');
  };
  window.__cssCap = window.__cssCap || {};
  window.__cssCap[slot] = { els, styles: els.map(el => [read(el), read(el, '::before'), read(el, '::after')]) };
  return els.length;
}

function pageCompare() {
  const { els, styles: a1 } = window.__cssCap.a1;
  const a2 = window.__cssCap.a2.styles;
  const b = window.__cssCap.b.styles;
  const where = el => {
    const parts = [];
    let node = el;
    while (node && node !== document.documentElement && parts.length < 4) {
      let label = node.tagName.toLowerCase();
      const cls = String(node.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      if (cls) label += '.' + cls;
      parts.unshift(label);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };
  const split = text => Object.fromEntries(text ? text.split(';').map(pair => { const i = pair.indexOf(':'); return [pair.slice(0, i), pair.slice(i + 1)]; }) : []);
  const diffs = [];
  let noisy = 0;
  let removedVars = 0;
  for (let i = 0; i < els.length; i += 1) {
    for (let k = 0; k < 3; k += 1) {
      if (a2[i][k] === b[i][k]) continue;
      const pa1 = split(a1[i][k]); const pa2 = split(a2[i][k]); const pb = split(b[i][k]);
      const props = new Set([...Object.keys(pa2), ...Object.keys(pb)]);
      const changed = [];
      for (const prop of props) {
        if (pa2[prop] === pb[prop]) continue;
        if (pa1[prop] !== pa2[prop]) { noisy += 1; continue; } // cambia solo (animación)
        // Custom property que ya no se define (la purga borra las que nadie lee con
        // var()): no pinta nada por sí sola; si algo la leyera, cambiaría otra propiedad.
        if (prop.startsWith('--') && pa2[prop] === undefined) { removedVars += 1; continue; }
        changed.push(`${prop}: ${pb[prop]} → ${pa2[prop]}`);
      }
      if (changed.length) diffs.push({ where: where(els[i]) + (k === 1 ? '::before' : k === 2 ? '::after' : ''), changed: changed.slice(0, 6), more: Math.max(0, changed.length - 6) });
    }
  }
  return { elements: els.length, noisy, removedVars, diffs };
}

function pageSwap(css) {
  const link = [...document.querySelectorAll('link[rel="stylesheet"]')].find(item => /\/assets\/index-[^/]+\.css/.test(item.href));
  if (!link) return false;
  let style = document.getElementById('__css-before');
  if (css) {
    if (!style) { style = document.createElement('style'); style.id = '__css-before'; link.after(style); }
    style.textContent = css;
    link.disabled = true;
  } else {
    style?.remove();
    link.disabled = false;
  }
  return true;
}

async function measure(page) {
  await page.evaluate(pageCapture, 'a1');
  await sleep(350);
  await page.evaluate(pageCapture, 'a2');
  const swapped = await page.evaluate(pageSwap, beforeCss);
  if (!swapped) throw new Error('No encontré el <link> del CSS de entrada');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await sleep(350);
  await page.evaluate(pageCapture, 'b');
  const result = await page.evaluate(pageCompare);
  await page.evaluate(pageSwap, '');
  await page.evaluate(() => { delete window.__cssCap; });
  return result;
}

const setTheme = (page, theme) => page.evaluate(value => {
  document.documentElement.dataset.theme = value;
  document.documentElement.classList.toggle('theme-light', value === 'light');
}, theme);

let env; let server; let browser;
const report = {};
let total = 0;
try {
  env = await prepareDatabase();
  server = await startServer({ dbCopy: env.dbCopy, tmpDir: env.tmpDir, port: await freePort() });
  const api = apiClient(server.base, env.admin.token);
  const releaseVersion = (await api.get('/api/release-notes/latest')).data?.release?.version || '';
  browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--no-first-run', '--disable-extensions'] });

  const { context, page } = await openContext(browser, { base: server.base, token: env.admin.token, releaseVersion, reducedMotion: true, viewport: { width: 1440, height: 900 } });
  await gotoView(page, server.base, 'dashboard');
  const menu = (await page.$$eval('[data-view]', items => [...new Set(items.map(item => item.getAttribute('data-view')))])).filter(key => key && key !== 'ui');
  const targets = menu.map(view => ({ key: view, path: view }));
  const devices = (await api.get('/api/devices')).data.items || (await api.get('/api/devices')).data.devices || [];
  if (devices[0]) targets.push({ key: 'device', path: `devices/${encodeURIComponent(devices[0].etiqueta)}` });
  const tasks = (await api.get('/api/tasks?space=team')).data.items || [];
  if (tasks[0]) targets.push({ key: 'task', path: `tasks/${tasks[0].id}` });
  const tickets = (await api.get('/api/tickets')).data.items || [];
  if (tickets[0]) targets.push({ key: 'ticket', path: `tickets/${tickets[0].id}` });
  const articles = (await api.get('/api/knowledge/articles')).data.items || [];
  if (articles[0]) targets.push({ key: 'article', path: `knowledge/${articles[0].id}` });
  for (const panel of SETTINGS_PANELS) targets.push({ key: `settings/${panel}`, path: `settings/${panel}` });

  const anon = await openContext(browser, { base: server.base, token: '', viewport: { width: 1440, height: 900 }, reducedMotion: true });
  const anonTargets = [{ key: 'landing', url: '/' }, { key: 'login', url: '/login' }, { key: 'register', url: '/register' }];

  for (const target of [...targets, ...anonTargets]) {
    if (only && !target.key.includes(only)) continue;
    const isAnon = Boolean(target.url);
    const p = isAnon ? anon.page : page;
    report[target.key] = {};
    for (const width of WIDTHS) {
      await p.setViewport({ width, height: width < 768 ? 844 : width <= 1024 ? 768 : 900 });
      if (isAnon) { await p.goto(`${server.base}${target.url}`, { waitUntil: 'networkidle0' }); await sleep(400); }
      else { await gotoView(p, server.base, target.path); await settle(p); }
      for (const theme of THEMES) {
        await setTheme(p, theme);
        await sleep(150);
        const result = await measure(p);
        report[target.key][`${theme}-${width}`] = result;
        total += result.diffs.length;
        const mark = result.diffs.length ? `${result.diffs.length} DIFERENCIAS` : 'igual';
        console.log(`${target.key.padEnd(26)} ${theme.padEnd(5)} ${String(width).padStart(4)}  ${String(result.elements).padStart(5)} elementos  ${mark}${result.noisy ? ` (${result.noisy} props animadas ignoradas)` : ''}${result.removedVars ? ` (${result.removedVars} variables sin uso que ya no se definen)` : ''}`);
        for (const diff of result.diffs.slice(0, 4)) console.log(`     ${diff.where}\n       ${diff.changed.join('\n       ')}${diff.more ? `\n       … y ${diff.more} más` : ''}`);
      }
    }
  }
  await context.close();
  await anon.context.close();
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopServer(server);
  if (env) await removeTmp(env.tmpDir);
}
const outFile = path.join(root, 'e2e', '.out', 'css-diff.json');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
console.log(`\n${total ? `${total} elementos con diferencias` : 'Cero diferencias'} · detalle en e2e/.out/css-diff.json`);
process.exitCode = total ? 1 : 0;
