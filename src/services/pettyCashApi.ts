import type { PettyCashExpense, PurchaseRequest } from '../types';
import { apiGet, apiSend } from './apiClient';

export interface PettyCashResponse {
  ok: true;
  config: { initialAmount: number; requestsEnabled: boolean };
  balance: number;
  spent: number;
  expenses: PettyCashExpense[];
  requests: PurchaseRequest[];
  permissions: { manager: boolean; canRequest: boolean };
}

export const getPettyCash = () => apiGet<PettyCashResponse>('/api/petty-cash');
export const savePettyCashConfig = (payload: { initialAmount: number; requestsEnabled: boolean }) => apiSend('/api/petty-cash/config', 'PATCH', payload);
export const createPettyCashExpense = (payload: Partial<PettyCashExpense>) => apiSend('/api/petty-cash/expenses', 'POST', payload);
export const createPurchaseRequest = (payload: Record<string, unknown>) => apiSend('/api/petty-cash/requests', 'POST', payload);
export const resolvePurchaseRequest = (id: number, payload: Record<string, unknown>) => apiSend(`/api/petty-cash/requests/${id}`, 'PATCH', payload);
export const uploadPettyCashReceipt = (payload: { mimeType: string; base64: string }) => apiSend<{ ok: true; url: string }>('/api/petty-cash/upload-receipt', 'POST', payload);
