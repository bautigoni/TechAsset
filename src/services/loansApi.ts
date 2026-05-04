import { apiSend } from './apiClient';

export function lendDevice(payload: Record<string, unknown>) {
  return apiSend<{ ok: true; item?: unknown }>('/api/loans/lend', 'POST', payload);
}

export function returnDevice(payload: Record<string, unknown>) {
  return apiSend<{ ok: true; item?: unknown }>('/api/loans/return', 'POST', payload);
}
