// Banco de pruebas de punta a punta de TechAsset.
//
//   npm run e2e                       # todo: funcionales (a–h) + línea base (i, j)
//   npm run e2e -- --only=prestamos   # solo los tests cuyo grupo/nombre contenga eso
//   npm run e2e -- --no-baseline      # sin layout ni mobile (más rápido)
//   npm run e2e -- --no-build         # usa dist/ como esté (no buildea aunque esté viejo)
//   npm run e2e -- --build            # buildea sí o sí
//   npm run e2e -- --headful          # con el navegador a la vista
//   npm run e2e -- --keep             # no borra la copia de la base (para inspeccionarla)
//   npm run e2e -- --ai               # el server de prueba usa la IA del .env (gasta tokens; prueba k4)
//
// Corre contra el server real (`node server/index.js`) y una COPIA descartable de
// data/techasset.db: nunca la base real ni Postgres, nunca sale un mail ni una
// push. Exit code 1 si falla alguna prueba funcional; las de línea base (layout
// y mobile) se reportan con conteos y no cambian el exit code.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import {
  apiClient, ensureBuild, findBrowser, freePort, prepareDatabase, removeTmp, root, startServer, stopServer
} from './lib/env.mjs';
import { functionalTests } from './tests/functional.mjs';
import { inventoryTests } from './tests/inventory.mjs';
import { tasksTests } from './tests/tasks.mjs';
import { assistantTests } from './tests/assistant.mjs';
import { ticketsTests } from './tests/tickets.mjs';
import { classroomsTests } from './tests/classrooms.mjs';
import { knowledgeCanvasTests } from './tests/knowledgeCanvas.mjs';
import { toolsTests } from './tests/tools.mjs';
import { settingsTests } from './tests/settings.mjs';
import { shellTests } from './tests/shell.mjs';
import { inicioTests } from './tests/inicio.mjs';
import { layoutTests, mobileTests, WIDTHS } from './tests/baseline.mjs';

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const onlyRaw = option('only');
const normalize = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const only = onlyRaw ? normalize(onlyRaw) : '';
const buildMode = flag('build') ? 'force' : flag('no-build') ? 'skip' : 'auto';
const log = message => console.log(message);

const started = Date.now();
const results = [];
const timings = {};
// Página "en uso": si una prueba falla se guarda una captura en e2e/.out/fallas/.
let currentPage = null;
const track = page => { currentPage = page; };
const shotsDir = path.join(root, 'e2e', '.out', 'fallas');
fs.rmSync(shotsDir, { recursive: true, force: true });

/** Registra una prueba: OK / FALLA (funcional) o OK / LÍNEA BASE (no corta). */
async function test(code, group, name, fn, { baseline = false } = {}) {
  if (only && !normalize(`${code} ${group} ${name}`).includes(only)) return;
  const t0 = Date.now();
  let status = 'OK';
  let detail = '';
  try {
    detail = (await fn()) || '';
  } catch (error) {
    status = baseline ? 'LÍNEA BASE' : 'FALLA';
    detail = error instanceof Error ? error.message : String(error);
    if (currentPage && !currentPage.isClosed()) {
      fs.mkdirSync(shotsDir, { recursive: true });
      const file = path.join(shotsDir, `${code}-${normalize(name).replace(/[^a-z0-9]+/g, '-').slice(0, 60)}.png`);
      await currentPage.screenshot({ path: file }).catch(() => {});
    }
  }
  const ms = Date.now() - t0;
  results.push({ code, group, name, kind: baseline ? 'línea base' : 'funcional', status, detail: String(detail), ms });
  const mark = status === 'OK' ? 'OK   ' : status === 'FALLA' ? 'FALLA' : 'BASE ';
  console.log(`  ${mark} ${code}) ${group} › ${name} (${(ms / 1000).toFixed(1)} s)${status !== 'OK' ? `\n         ${String(detail).slice(0, 400)}` : ''}`);
}

let env;
let server;
let browser;
let layout = {};
let mobile = {};
let inicio = {};
let buildInfo = {};
try {
  let t = Date.now();
  buildInfo = ensureBuild(buildMode, log);
  timings.build = Date.now() - t;

  t = Date.now();
  env = await prepareDatabase();
  const port = await freePort();
  server = await startServer({ dbCopy: env.dbCopy, tmpDir: env.tmpDir, port, ai: flag('ai') });
  timings.server = Date.now() - t;
  log(`Server de prueba en ${server.base} · copia ${env.dbCopy}`);
  log(`Superadmin: ${env.admin.email} · consulta: ${env.consulta.email}${env.consulta.created ? ' (creado en la copia)' : ''} · bloqueado: ${env.blockedTag || '-'}`);

  const api = apiClient(server.base, env.admin.token);
  const apiConsulta = apiClient(server.base, env.consulta.token);
  const session = await api.get('/api/auth/session');
  if (!session.data.authenticated) throw new Error(`La sesión de prueba no autentica: ${JSON.stringify(session.data)}`);
  const releaseVersion = (await api.get('/api/release-notes/latest')).data?.release?.version || '';

  t = Date.now();
  browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: !flag('headful'),
    // Sin --hide-scrollbars (puppeteer lo agrega por defecto): las barras de
    // scroll tienen que ocupar lugar, como en el navegador de verdad.
    ignoreDefaultArgs: ['--hide-scrollbars'],
    args: ['--no-first-run', '--disable-extensions', '--no-default-browser-check', '--window-size=1440,900']
  });
  timings.browser = Date.now() - t;
  const ctx = { browser, base: server.base, api, apiConsulta, admin: env.admin, consulta: env.consulta, releaseVersion, blockedTag: env.blockedTag, test, track };

  console.log('\nFuncionales (a–h)');
  t = Date.now();
  await functionalTests(ctx);
  await inventoryTests(ctx);
  await tasksTests(ctx);
  console.log('\nInicio: huecos, truncados y plegado (l)');
  inicio = await inicioTests(ctx);
  console.log('\nAsistente (k)');
  await assistantTests(ctx);
  await ticketsTests(ctx);
  await classroomsTests(ctx);
  await knowledgeCanvasTests(ctx);
  await toolsTests(ctx);
  await settingsTests(ctx);
  await shellTests(ctx);
  timings.functional = Date.now() - t;

  if (!flag('no-baseline')) {
    console.log('\nLínea base: layout (i) — por ancho: [X scroll horizontal][P barra de la página] / barras en contenedores / botones partidos / solapamientos');
    t = Date.now();
    layout = await layoutTests(ctx);
    timings.layout = Date.now() - t;
    console.log('\nLínea base: mobile fijo (j)');
    t = Date.now();
    mobile = await mobileTests(ctx);
    timings.mobile = Date.now() - t;
  }
} catch (error) {
  results.push({ code: '-', group: 'Entorno', name: 'Preparar y levantar', kind: 'funcional', status: 'FALLA', detail: error instanceof Error ? error.stack || error.message : String(error), ms: 0 });
  console.error(`\nNo se pudo correr el banco: ${error instanceof Error ? error.message : error}`);
  if (server) console.error(`\nLog del server:\n${server.getLog().slice(-3000)}`);
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopServer(server);
  if (env && !flag('keep')) await removeTmp(env.tmpDir);
  else if (env) log(`Copia conservada en ${env.tmpDir}`);
}

// ── Reporte ──────────────────────────────────────────────────────────────────
const functional = results.filter(item => item.kind === 'funcional');
const baseline = results.filter(item => item.kind === 'línea base');
const failed = functional.filter(item => item.status !== 'OK');
const totalMs = Date.now() - started;

console.log('\nResumen');
console.table(results.map(item => ({ '': item.code, grupo: item.group, prueba: item.name.slice(0, 70), resultado: item.status, s: Number((item.ms / 1000).toFixed(1)) })));

const layoutTotals = {};
for (const [view, widths] of Object.entries(layout)) {
  layoutTotals[view] = { scrollX: 0, barraPagina: 0, barras: 0, botonesPartidos: 0, solapamientos: 0 };
  for (const probe of Object.values(widths)) {
    layoutTotals[view].scrollX += probe.counts.horizontalScroll;
    layoutTotals[view].barraPagina += probe.counts.pageScrollbar;
    layoutTotals[view].barras += probe.counts.scrollbars;
    layoutTotals[view].botonesPartidos += probe.counts.wrappedButtons;
    layoutTotals[view].solapamientos += probe.counts.overlaps;
  }
}
if (Object.keys(layoutTotals).length) {
  console.log(`\nLínea base de layout (suma de ${WIDTHS.length} anchos: ${WIDTHS.join(', ')})`);
  console.table(layoutTotals);
}

console.log(`\nFuncionales: ${functional.length - failed.length}/${functional.length} OK · línea base: ${baseline.filter(item => item.status === 'OK').length}/${baseline.length} limpias · ${(totalMs / 1000).toFixed(0)} s`);

const out = {
  startedAt: new Date(started).toISOString(),
  totalMs,
  timings,
  build: buildInfo,
  args,
  summary: {
    functional: { total: functional.length, ok: functional.length - failed.length, failed: failed.map(item => `${item.code}) ${item.group} › ${item.name}`) },
    baseline: { total: baseline.length, clean: baseline.filter(item => item.status === 'OK').length },
    layoutTotals
  },
  results,
  layout,
  mobile,
  inicio
};
fs.writeFileSync(path.join(root, 'e2e', 'last-run.json'), JSON.stringify(out, null, 2));
console.log(`Detalle completo en e2e/last-run.json`);
process.exitCode = failed.length ? 1 : 0;
