// pwa) App instalable y actualizable (etapa 9), contra el build de producción:
//   - instalable: el navegador no reporta errores de instalabilidad (CDP
//     Page.getInstallabilityErrors, el mismo criterio que Lighthouse) y el
//     manifest trae íconos 192/512 + maskable y los colores del tema;
//   - el service worker guarda el shell (index + JS/CSS de entrada) y sin red la
//     app abre igual, con la línea "Sin conexión" en la cabecera;
//   - deploy nuevo: un sw.js distinto queda esperando, la cabecera avisa "Hay
//     una versión nueva · Actualizar" y al tocarlo se activa y recarga.
// Toca dist/sw.js para simular el deploy y lo deja como estaba.
import fs from 'node:fs';
import path from 'node:path';
import { root } from '../lib/env.mjs';
import { assert, gotoView, openContext, sleep, until } from '../lib/browser.mjs';

const outDir = path.join(root, 'e2e', '.out', 'etapa9');
const swFile = path.join(root, 'dist', 'sw.js');

export async function pwaTests({ browser, base, admin, releaseVersion, test, track = () => {} }) {
  const { context, page } = await openContext(browser, { base, token: admin.token, releaseVersion, viewport: { width: 1440, height: 900 } });
  track(page);
  const originalSw = fs.existsSync(swFile) ? fs.readFileSync(swFile, 'utf8') : '';
  try {
    await test('pwa', 'PWA', 'Instalable: sin errores de instalabilidad, manifest con íconos 192/512/maskable y colores del tema', async () => {
      assert(originalSw && !originalSw.includes('__BUILD_ID__'), 'dist/sw.js no tiene la versión del build (falta el plugin techasset:sw-version)');
      await gotoView(page, base, 'dashboard');
      await until(() => page.evaluate(() => navigator.serviceWorker?.controller?.state === 'activated'), { timeout: 15000, message: 'el service worker controlando la página' });
      // Instalabilidad en el contexto normal del navegador: en uno aislado (incógnito)
      // Chrome siempre responde "in-incognito". Basta la landing (el SW se registra igual).
      const plain = await browser.defaultBrowserContext().newPage();
      let installabilityErrors = [];
      try {
        await plain.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
        await until(() => plain.evaluate(() => navigator.serviceWorker?.controller?.state === 'activated'), { timeout: 15000, message: 'el SW en el contexto normal' });
        const cdp = await plain.createCDPSession();
        ({ installabilityErrors } = await cdp.send('Page.getInstallabilityErrors'));
        await cdp.detach();
        await plain.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r?.unregister()));
      } finally {
        await plain.close().catch(() => {});
      }
      assert(!installabilityErrors.length, `errores de instalabilidad: ${JSON.stringify(installabilityErrors)}`);
      const manifest = await page.evaluate(() => fetch('/manifest.webmanifest').then(r => r.json()));
      const sizes = manifest.icons.map(icon => `${icon.sizes}:${icon.purpose || 'any'}`);
      for (const need of ['192x192:any', '512x512:any', '512x512:maskable']) assert(sizes.includes(need), `falta el ícono ${need} (${sizes.join(', ')})`);
      for (const icon of manifest.icons) {
        const status = await page.evaluate(src => fetch(src).then(r => r.status), icon.src);
        assert(status === 200, `${icon.src} responde ${status}`);
      }
      assert(manifest.theme_color === '#0D0F12' && manifest.background_color === '#0D0F12', 'colores del manifest fuera del tema');
      return `instalable; íconos ${sizes.join(', ')}`;
    });

    await test('pwa', 'PWA', 'Sin red: abre con el shell guardado y avisa "Sin conexión"', async () => {
      const cached = await page.evaluate(async () => {
        const keys = await caches.keys();
        const cache = await caches.open(keys.find(key => key.startsWith('techasset-')));
        const requests = await cache.keys();
        return { keys, urls: requests.map(request => new URL(request.url).pathname) };
      });
      assert(cached.keys.length === 1, `esperaba un solo caché de la versión actual (${cached.keys.join(', ')})`);
      assert(cached.urls.includes('/'), 'el shell (/) no está en el caché');
      // Lo de entrada (lo que nombra index.html); los chunks de pantalla se guardan al pedirse.
      const entry = await page.evaluate(() => fetch('/', { cache: 'no-store' }).then(r => r.text()).then(html => [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(match => match[1])));
      assert(entry.length >= 2, `index.html no nombra assets de entrada (${entry.join(', ')})`);
      for (const asset of entry) assert(cached.urls.includes(asset), `${asset} no está en el caché`);
      await page.setOfflineMode(true);
      try {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.shell', { timeout: 15000 });
        await until(() => page.evaluate(() => /Sin conexión/.test(document.querySelector('.shell-status--offline')?.textContent || '')), { timeout: 8000, message: 'la línea "Sin conexión"' });
        fs.mkdirSync(outDir, { recursive: true });
        await sleep(1200); // que terminen de entrar las líneas (Collapse) y los pedidos fallidos
        await page.screenshot({ path: path.join(outDir, 'pwa-sin-conexion-oscuro-1440.png') });
      } finally {
        await page.setOfflineMode(false);
      }
      await until(() => page.evaluate(() => !document.querySelector('.shell-status--offline')?.closest('.ui-collapse[data-state="open"]')), { timeout: 8000, message: 'que se vaya "Sin conexión" al volver la red' });
      return `${cached.urls.length} archivos en el caché; abre sin red con el aviso`;
    });

    await test('pwa', 'PWA', 'Deploy nuevo: "Hay una versión nueva · Actualizar" activa el SW nuevo y recarga', async () => {
      await gotoView(page, base, 'dashboard');
      await until(() => page.evaluate(() => navigator.serviceWorker?.controller?.state === 'activated'), { timeout: 15000, message: 'SW activo' });
      const before = await page.evaluate(() => caches.keys());
      // "Deploy": otro sw.js (la versión cambia como en un build nuevo).
      fs.writeFileSync(swFile, originalSw.replace(/const VERSION = '([^']+)'/, (_m, v) => `const VERSION = '${v}-e2e'`));
      await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r?.update()));
      await until(() => page.evaluate(() => /Hay una versión nueva/.test(document.querySelector('.shell-status--update')?.textContent || '') && Boolean(document.querySelector('.shell-status--update')?.closest('.ui-collapse[data-state="open"]'))), { timeout: 15000, message: 'el aviso de versión nueva' });
      await sleep(500);
      await page.screenshot({ path: path.join(outDir, 'pwa-version-nueva-oscuro-1440.png') });
      const navigation = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.evaluate(() => [...document.querySelectorAll('.shell-status--update button')].find(b => /Actualizar/.test(b.textContent || ''))?.click());
      await navigation;
      await page.waitForSelector('.shell', { timeout: 15000 });
      const after = await until(async () => {
        const keys = await page.evaluate(() => caches.keys());
        return keys.length === 1 && keys[0].endsWith('-e2e') ? keys : null;
      }, { timeout: 10000, message: 'el caché de la versión nueva (y el viejo borrado)' });
      return `${before.join(',')} → ${after.join(',')}`;
    });
  } finally {
    if (originalSw) fs.writeFileSync(swFile, originalSw);
    await context.close().catch(() => {});
  }
}
