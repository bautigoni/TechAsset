import type { InventoryItem } from '../types';
import { apiGet, apiSend } from './apiClient';

export function getInventoryItems() {
  return apiGet<{ ok: true; items: InventoryItem[] }>('/api/inventory/items');
}

export function createInventoryItem(payload: Partial<InventoryItem>) {
  return apiSend<{ ok: true; item: InventoryItem }>('/api/inventory/items', 'POST', payload);
}

export function updateInventoryItem(id: number, payload: Partial<InventoryItem>) {
  return apiSend<{ ok: true; item: InventoryItem }>(`/api/inventory/items/${id}`, 'PATCH', payload);
}

export function deleteInventoryItem(id: number) {
  return apiSend<{ ok: true; deleted: boolean }>(`/api/inventory/items/${id}`, 'DELETE');
}

export function importInventoryCsv(csvText: string) {
  return apiSend<{ ok: true; read: number; created: number; updated: number; skipped: number; errors: Array<{ row: number; error: string }> }>('/api/inventory/import', 'POST', { csvText });
}

export function uploadInventoryImage(payload: { fileName: string; dataUrl: string }) {
  return apiSend<{ ok: true; url: string }>('/api/inventory/upload-image', 'POST', payload);
}
