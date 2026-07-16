import type { CanvasItem } from '../types';
import { apiGet, apiSend } from './apiClient';

export const getCanvasItems = () => apiGet<{ ok: true; items: CanvasItem[] }>('/api/canvas/items');
export const createCanvasItem = (payload: Partial<CanvasItem>) => apiSend<{ ok: true; item: CanvasItem }>('/api/canvas/items', 'POST', payload);
export const updateCanvasItem = (id: number, payload: Partial<CanvasItem>) => apiSend<{ ok: true; item: CanvasItem }>(`/api/canvas/items/${id}`, 'PATCH', payload);
export const deleteCanvasItem = (id: number) => apiSend<{ ok: true; deleted: boolean }>(`/api/canvas/items/${id}`, 'DELETE');
export const uploadCanvasFile = (payload: { name: string; mimeType: string; base64: string }) => apiSend<{ ok: true; url: string; name: string; mimeType: string; size: number }>('/api/canvas/upload', 'POST', payload);
