// Compara builds del banco de pruebas A/B INTERCALADOS (A, B, A, B...), para que
// el ruido de la máquina caiga parejo sobre todos. Reporta medianas.
//
//   PERF_FIXTURES=perf/.out/perf-fixtures.json node perf/compare.mjs <distA> <distB> [...] -- [rondas=7] [cpu=4]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const sep = args.indexOf('--');
const dists = (sep >= 0 ? args.slice(0, sep) : args).map(dir => path.resolve(dir));
const [rounds = 7, throttle = 4] = (sep >= 0 ? args.slice(sep + 1) : []).map(Number);
const fixtures = path.resolve(process.env.PERF_FIXTURES || 'perf/.out/perf-fixtures.json');
const VIEWS = ['Dispositivos', 'Préstamos', 'Inventario TIC', 'Analítica', 'Agenda TIC', 'Horarios', 'Tareas TIC', 'Estado aulas', 'Tickets', 'Configuración', 'Dashboard'];
const BROWSERS = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

async function serve(dist) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    let file = url === '/perf-fixtures.json' ? fixtures : path.join(dist, url);
    if (!file.startsWith(dist) && file !== fixtures) { res.statusCode = 403; return res.end(); }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const median = values => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const browser = await puppeteer.launch({ executablePath: BROWSERS.find(candidate => fs.existsSync(candidate)), headless: true, args: ['--no-first-run', '--disable-extensions'] });
const targets = await Promise.all(dists.map(serve));

async function openApp(base) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1366, height: 800 });
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => performance.getEntriesByName('perf-app-ready').length > 0, { timeout: 60000 });
  await new Promise(resolve => setTimeout(resolve, 1500));
  return { context, page };
}

const samples = dists.map(() => ({ startup: [], first: [], again: [], perView: VIEWS.map(() => ({ first: [], again: [] })) }));
try {
  for (let round = 0; round < rounds; round += 1) {
    // El orden también rota entre rondas.
    const order = dists.map((_, index) => (index + round) % dists.length);
    for (const index of order) {
      const { context, page } = await openApp(targets[index].base);
      samples[index].startup.push(await page.evaluate(() => window.__perf.startup()));
      const first = await page.evaluate(labels => window.__perf.views(labels), VIEWS);
      const again = await page.evaluate(labels => window.__perf.views(labels), VIEWS);
      samples[index].first.push(first.reduce((acc, item) => acc + item.ms, 0) / first.length);
      samples[index].again.push(again.reduce((acc, item) => acc + item.ms, 0) / again.length);
      first.forEach((item, view) => samples[index].perView[view].first.push(item.ms));
      again.forEach((item, view) => samples[index].perView[view].again.push(item.ms));
      await context.close();
    }
  }
  const names = dists.map(dir => path.basename(dir));
  const row = (label, values) => console.log(label.padEnd(26) + values.map(value => String(Math.round(value)).padStart(14)).join(''));
  console.log(`CPU ${throttle}x · ${rounds} rondas intercaladas · medianas`);
  console.log(''.padEnd(26) + names.map(name => name.padStart(14)).join(''));
  row('arranque: app lista', samples.map(s => median(s.startup.map(x => x.appReady))));
  row('arranque: FCP', samples.map(s => median(s.startup.map(x => x.firstContentfulPaint))));
  row('arranque: tareas largas', samples.map(s => median(s.startup.map(x => x.longTasks.total))));
  row('arranque: bloqueo (TBT)', samples.map(s => median(s.startup.map(x => x.longTasks.blocking))));
  row('pantalla 1ra vez (prom)', samples.map(s => median(s.first)));
  row('pantalla otra vez (prom)', samples.map(s => median(s.again)));
  VIEWS.forEach((view, index) => row(`  ${view}`, samples.flatMap(s => [median(s.perView[index].first)])));
} finally {
  await browser.close();
  targets.forEach(target => target.server.close());
}
