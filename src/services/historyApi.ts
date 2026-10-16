import { apiGet } from './apiClient';

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

export type HistoryFilters = { q?: string; from?: string; to?: string; tipo?: string; before?: string; limit?: number };

function query(kind: 'loans' | 'all', filters: HistoryFilters) {
  const params = new URLSearchParams({ kind });
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '') params.set(key, String(value));
  return `/api/history?${params.toString()}`;
}

export const getLoanHistory = (filters: HistoryFilters) =>
  apiGet<{ ok: true; items: LoanHistoryItem[]; nextCursor: string }>(query('loans', filters));

export const getMovementHistory = (filters: HistoryFilters) =>
  apiGet<{ ok: true; items: MovementHistoryItem[]; nextCursor: string }>(query('all', filters));
