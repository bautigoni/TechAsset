// Genera los íconos PNG de la PWA a partir de public/techasset-logo.svg
// (el logo de siempre), con Chrome headless: sin dependencias nuevas.
//
//   node scripts/generate-icons.mjs
//
// Salida en public/icons/: icon-192.png e icon-512.png (purpose "any", fondo
// transparente), icon-maskable-512.png (fondo del tema y el logo dentro de la
// zona segura del 80 %), apple-touch-icon.png (180, iOS no admite transparencia)
// y badge-96.png (silueta blanca para la barra de notificaciones de Android).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { findBrowser, root } from '../e2e/lib/env.mjs';

const BG = '#0D0F12'; // --g-bg oscuro (theme_color / background_color del manifest)
const svg = fs.readFileSync(path.join(root, 'public', 'techasset-logo.svg'), 'utf8');
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
// Badge: Android usa solo el canal alfa, así que va el monograma del logo (sin el cuadrado), en blanco.
const badgeSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="24 34 88 70"><g stroke="#fff" stroke-width="9" stroke-linecap="round" fill="none"><path d="M36 46 H92"/><path d="M64 46 V92"/><path d="M83 92 L99 60"/></g><circle cx="99" cy="60" r="6" fill="#fff"/></svg>';
const badgeUrl = `data:image/svg+xml;base64,${Buffer.from(badgeSvg).toString('base64')}`;
const outDir = path.join(root, 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const ICONS = [
  { file: 'icon-192.png', size: 192, scale: 1, bg: 'transparent' },
  { file: 'icon-512.png', size: 512, scale: 1, bg: 'transparent' },
  // Zona segura de un maskable: círculo de radio 0,4 × lado. El cuadrado del
  // logo (112/128 del dibujo) a 0,62 del lado queda adentro con margen.
  { file: 'icon-maskable-512.png', size: 512, scale: 0.62, bg: BG },
  { file: 'apple-touch-icon.png', size: 180, scale: 0.86, bg: BG },
  { file: 'badge-96.png', size: 96, scale: 0.8, bg: 'transparent', badge: true }
];

const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true });
try {
  const page = await browser.newPage();
  for (const icon of ICONS) {
    await page.setViewport({ width: icon.size, height: icon.size, deviceScaleFactor: 1 });
    const draw = Math.round(icon.size * icon.scale);
    await page.setContent(`<!doctype html><html><body style="margin:0;width:${icon.size}px;height:${icon.size}px;display:grid;place-items:center;background:${icon.bg}">
      <img src="${icon.badge ? badgeUrl : dataUrl}" width="${draw}" height="${draw}" style="display:block"></body></html>`, { waitUntil: 'load' });
    await page.screenshot({ path: path.join(outDir, icon.file), omitBackground: icon.bg === 'transparent', clip: { x: 0, y: 0, width: icon.size, height: icon.size } });
    console.log(`public/icons/${icon.file} (${icon.size}×${icon.size}) · ${fs.statSync(path.join(outDir, icon.file)).size} B`);
  }
} finally {
  await browser.close();
}
