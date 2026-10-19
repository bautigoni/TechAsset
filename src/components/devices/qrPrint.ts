import type { Device } from '../../types';
import { escapeHtml } from './deviceView';

/**
 * Hoja de códigos QR de los equipos visibles, para imprimir o guardar como PDF.
 *
 * - Los QR se generan en el navegador (antes se pedían a api.qrserver.com y se
 *   mandaban etiqueta, SN y MAC de cada equipo a un tercero; sin internet no
 *   salía ninguno). La librería se baja recién al exportar.
 * - Se imprime desde un iframe oculto: sin ventana emergente (que el navegador
 *   podía bloquear) y sin document.write.
 * - El payload `TA|etiqueta|sn|mac` es el que entiende `parseScannedCode`:
 *   escanear la etiqueta impresa con el lector USB abre Préstamos.
 */
export async function printDeviceQrs(devices: Device[], siteCode: string) {
  const qrcode = (await import('qrcode-generator')).default;
  const qrImage = (payload: string) => {
    // Bytes UTF-8 como "cadena binaria": el modo Byte toma cada carácter como un
    // byte, así los acentos no se rompen.
    const binary = Array.from(new TextEncoder().encode(payload), byte => String.fromCharCode(byte)).join('');
    const qr = qrcode(0, 'M');
    qr.addData(binary, 'Byte');
    qr.make();
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true }))}`;
  };
  const cards = devices.map(device => {
    const payload = ['TA', device.etiqueta, device.sn || '', device.mac || ''].join('|');
    return `<article class="qr-card"><img src="${qrImage(payload)}" alt="QR ${escapeHtml(device.etiqueta)}" /><strong>${escapeHtml(device.etiqueta)}</strong><span>${escapeHtml(device.aliasOperativo || device.categoria || '')}</span></article>`;
  }).join('') || '<p>No hay dispositivos visibles para exportar.</p>';

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  // Fuera de la vista y sin ocupar lugar: solo existe para imprimir.
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', opacity: '0', pointerEvents: 'none' });
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    throw new Error('El navegador no dejó preparar la impresión.');
  }
  doc.documentElement.lang = 'es';
  doc.title = `QR TechAsset ${siteCode}`;
  const charset = doc.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  // Hoja de impresión: blanco y negro a propósito (es papel, no la app).
  const style = doc.createElement('style');
  style.textContent = `
    body{font-family:system-ui,Arial,sans-serif;margin:24px;color:#000}
    h1{font-size:18px;margin:0 0 16px}
    .qr-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
    .qr-card{border:1px solid #999;border-radius:8px;padding:10px;display:grid;place-items:center;gap:4px;break-inside:avoid}
    .qr-card img{width:132px;height:132px}
    .qr-card strong{font-size:16px;font-family:ui-monospace,monospace}
    .qr-card span{font-size:12px;color:#333}
    @media print{body{margin:10mm}.qr-grid{grid-template-columns:repeat(3,1fr)}}
  `;
  doc.head.append(charset, style);
  doc.body.innerHTML = `<h1>TechAsset · ${escapeHtml(siteCode)} · códigos QR</h1><section class="qr-grid">${cards}</section>`;
  // Las imágenes son data URLs: igual se espera a que estén decodificadas.
  await Promise.all(Array.from(doc.images, image => image.decode().catch(() => undefined)));
  const cleanup = () => window.setTimeout(() => frame.remove(), 1000);
  win.addEventListener('afterprint', cleanup, { once: true });
  win.focus();
  win.print();
  // Algunos navegadores no disparan afterprint: se limpia igual más tarde.
  window.setTimeout(() => { if (frame.isConnected) frame.remove(); }, 60000);
}
