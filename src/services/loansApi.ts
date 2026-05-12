import { apiSend } from './apiClient';

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
