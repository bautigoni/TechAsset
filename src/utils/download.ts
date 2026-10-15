import { csvCell } from './formatters';

/**
 * Descargas generadas en el navegador. Antes había una copia de esto en cada
 * pantalla que exportaba (agenda, analítica, inventario...).
 */
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revocar en el próximo tick: algunos navegadores todavía no empezaron la descarga.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadText(filename: string, text: string, type = 'text/plain') {
  downloadBlob(filename, new Blob([text], { type }));
}

/** CSV con BOM para que Excel lea bien los acentos (si no, aparece "prÃ©stamo"). */
export function toCsv(rows: unknown[][]) {
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}

export function downloadCsv(filename: string, rows: unknown[][]) {
  downloadBlob(filename, new Blob(['﻿', toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
}
