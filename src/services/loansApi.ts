import { apiGet, apiSend } from './apiClient';
import type { PreviousDayLoan } from '../types';

export interface LoanSuggestion {
  persona: string;
  count: number;
  lastAt: string;
  rol: string;
  ubicacion: string;
  curso: string;
  motivo: string;
}

export function getLoanSuggestions(q: string) {
  return apiGet<{ ok: true; suggestions: LoanSuggestion[] }>(`/api/loans/suggest?q=${encodeURIComponent(q)}`);
}

export function getPreviousDayLoans() {
  return apiGet<{ ok: true; date: string; items: PreviousDayLoan[] }>('/api/loans/previous-day');
}

export function getActiveLoanAccessories(etiqueta: string) {
  return apiGet<{ ok: true; loanSessionId: string; accessories: string[]; registered: boolean }>(`/api/loans/${encodeURIComponent(etiqueta)}/accessories`);
}

export type LoanSyncResponse = {
  ok: true;
  item?: unknown;
  synced?: boolean;
  syncing?: boolean;
  idempotent?: boolean;
  message?: string;
  pendingSyncId?: number | null;
};

export function lendDevice(payload: Record<string, unknown>) {
  return apiSend<LoanSyncResponse>('/api/loans/lend', 'POST', payload);
}

export function returnDevice(payload: Record<string, unknown>) {
  return apiSend<LoanSyncResponse>('/api/loans/return', 'POST', payload);
}

export type LoanBatchResponse = { ok: true; done: number; results: Array<{ etiqueta: string; ok: boolean; error?: string; idempotent?: boolean }> };

/** Varios equipos en un solo request (selección múltiple / escaneo continuo). */
export function lendDevicesBatch(payload: Record<string, unknown> & { etiquetas: string[] }) {
  return apiSend<LoanBatchResponse>('/api/loans/lend-batch', 'POST', payload);
}

export function returnDevicesBatch(etiquetas: string[], payload: Record<string, unknown> = {}) {
  return apiSend<LoanBatchResponse>('/api/loans/return-batch', 'POST', { ...payload, etiquetas });
}

/**
 * Deshacer inmediato (línea de estado "Deshacer"): 'return' vuelve a prestar
 * con los datos del préstamo original; 'lend' deja libre lo recién prestado.
 */
export function undoLoans(etiquetas: string[], action: 'return' | 'lend') {
  return apiSend<LoanBatchResponse>('/api/loans/undo', 'POST', { etiquetas, action });
}
