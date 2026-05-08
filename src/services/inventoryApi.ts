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
