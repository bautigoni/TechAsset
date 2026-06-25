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
