import { apiGet, siteHeaders } from './apiClient';
import { downloadBlob } from '../utils/download';

export type LoanHistoryItem = {
  cursorId: number;
  timestamp: string;
  tipo: 'prestamo' | 'devolucion' | string;
  etiqueta: string;
  alias: string;
  filtro: string;
  persona: string;
  rol: string;
  ubicacion: string;
  curso: string;
  motivo: string;
  comentarios: string;
  operador: string;
  accesorios: string[];
};

export type MovementHistoryItem = {
  cursorId: number;
  timestamp: string;
  tipo: string;
  descripcion: string;
  operador: string;
  origen: string;
  etiqueta: string;
};

/** `tags`: etiquetas resueltas en el front desde el texto (touch34 → D0170). */
export type HistoryFilters = { q?: string; from?: string; to?: string; tipo?: string; before?: string; limit?: number; tags?: string };

function params(kind: 'loans' | 'all', filters: HistoryFilters) {
  const search = new URLSearchParams({ kind });
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '') search.set(key, String(value));
  return search.toString();
}

export const getLoanHistory = (filters: HistoryFilters) =>
  apiGet<{ ok: true; items: LoanHistoryItem[]; nextCursor: string }>(`/api/history?${params('loans', filters)}`);

export const getMovementHistory = (filters: HistoryFilters) =>
  apiGet<{ ok: true; items: MovementHistoryItem[]; nextCursor: string }>(`/api/history?${params('all', filters)}`);

/** Préstamos y último préstamo de un equipo (mini ficha del Historial). */
export const getHistoryDeviceSummary = (etiqueta: string) =>
  apiGet<{ ok: true; etiqueta: string; loans: number; lastLoan: string }>(`/api/history/device-summary?etiqueta=${encodeURIComponent(etiqueta)}`);

/**
 * Descarga el CSV de TODO lo filtrado, armado en el server (antes era solo lo
 * cargado en pantalla). Devuelve el nombre y cuántas filas trajo.
 */
export async function downloadHistoryCsv(kind: 'loans' | 'all', filters: HistoryFilters) {
  const rest: HistoryFilters = { q: filters.q, from: filters.from, to: filters.to, tipo: filters.tipo, tags: filters.tags };
  const response = await fetch(`/api/history/export.csv?${params(kind, rest)}`, { cache: 'no-store', headers: siteHeaders() });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try { message = (await response.json())?.error || message; } catch { /* el CSV no es JSON */ }
    throw new Error(message);
  }
  const name = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || `historial_${kind === 'loans' ? 'prestamos' : 'movimientos'}.csv`;
  const rows = Number(response.headers.get('X-Total-Rows') || 0);
  downloadBlob(name, await response.blob());
  return { name, rows };
}
