import { dayKeyAr } from '../../utils/formatters';

const ars = /* @__PURE__ */ new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 });

export function money(value: number) {
  return ars.format(Number.isFinite(value) ? value : 0);
}

/**
 * Importe tipeado en es-AR o con punto: "1.500" = 1500, "1.500,50" = 1500.5,
 * "1500.5" = 1500.5, "$ 2.000" = 2000. Vacío → null; inválido → NaN.
 */
export function parseMoney(raw: string): number | null {
  const text = String(raw || '').replace(/[\s$]/g, '');
  if (!text) return null;
  let normalized = text;
  if (text.includes(',')) normalized = text.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(text)) normalized = text.replace(/\./g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return Number.NaN;
  return Number(normalized);
}

/** Para precargar un campo de importe (sin símbolo, coma decimal). */
export function moneyDraft(value: number | null | undefined) {
  if (!value) return '';
  return String(Math.round(value * 100) / 100).replace('.', ',');
}

/** dd/mm/aaaa de un 'YYYY-MM-DD' o de un ISO con hora (en hora argentina). */
export function displayDay(value: string) {
  const key = /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? value : dayKeyAr(value || '') || '';
  return key ? key.split('-').reverse().join('/') : '—';
}

