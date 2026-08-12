import type { InventoryItem, InventoryUnit } from '../types';
import { apiGet, apiSend } from './apiClient';

type UnitsResponse = { ok: true; units: InventoryUnit[]; item?: InventoryItem | null };

export function getInventoryItems() {
  return apiGet<{ ok: true; items: InventoryItem[] }>('/api/inventory/items');
}

export function createInventoryItem(payload: Partial<InventoryItem>) {
  return apiSend<{ ok: true; item: InventoryItem }>('/api/inventory/items', 'POST', payload);
}

// `revisado` marca que el cambio viene de una revisión real (el selector del
// detalle o el recorrido), y no de editar la ficha por otra cosa: solo en ese
// caso el backend refresca la fecha de última revisión aunque el valor no cambie.
export function updateInventoryItem(id: number, payload: Partial<InventoryItem> & { revisado?: boolean }) {
  return apiSend<{ ok: true; item: InventoryItem }>(`/api/inventory/items/${id}`, 'PATCH', payload);
}

export function deleteInventoryItem(id: number) {
  return apiSend<{ ok: true; deleted: boolean }>(`/api/inventory/items/${id}`, 'DELETE');
}

export function getInventoryUnits(itemId: number) {
  return apiGet<UnitsResponse>(`/api/inventory/items/${itemId}/units`);
}

export function createInventoryUnit(itemId: number, payload: Partial<InventoryUnit>) {
  return apiSend<UnitsResponse>(`/api/inventory/items/${itemId}/units`, 'POST', payload);
}

export function updateInventoryUnit(unitId: number, payload: Partial<InventoryUnit>) {
  return apiSend<UnitsResponse>(`/api/inventory/units/${unitId}`, 'PATCH', payload);
}

export function deleteInventoryUnit(unitId: number) {
  return apiSend<UnitsResponse>(`/api/inventory/units/${unitId}`, 'DELETE');
}

export function importInventoryCsv(csvText: string) {
  return apiSend<{ ok: true; read: number; created: number; updated: number; skipped: number; preservedImages?: number; preservedConditions?: number; errors: Array<{ row: number; error: string }> }>('/api/inventory/import', 'POST', { csvText });
}

export function uploadInventoryImage(payload: { fileName: string; dataUrl: string }) {
  return apiSend<{ ok: true; url: string }>('/api/inventory/upload-image', 'POST', payload);
}
