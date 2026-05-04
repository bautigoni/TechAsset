import type { Device, Movement } from '../types';
import { apiGet, apiSend } from './apiClient';

export function getDevices() {
  return apiGet<{ ok: true; items: Device[]; loadedAt: string; source: string }>('/api/devices');
}

export function getMovements() {
  return apiGet<{ ok: true; items: Movement[] }>('/api/movements');
}

export function addDevice(payload: Partial<Device> & { operator: string }) {
  return apiSend<{ ok: true; item: Device }>('/api/devices/add', 'POST', payload);
}

export function updateDeviceStatus(payload: { etiqueta: string; estado: string; operator: string; comentario?: string }) {
  return apiSend<{ ok: true }>('/api/devices/status', 'POST', payload);
}
