import type { Device, Movement } from '../types';
import { apiGet, apiSend } from './apiClient';

type DevicesResponse = { ok: true; items: Device[]; loadedAt: string; source: string; diagnostics?: Record<string, unknown> };
type DevicesDiagnosticsResponse = { ok: true; diagnostics: Record<string, unknown> };

let devicesRequest: Promise<DevicesResponse> | null = null;

export function getDevices(options: { force?: boolean; wait?: boolean } = {}) {
  const params = new URLSearchParams();
  if (options.force) params.set('refresh', '1');
  if (options.wait) params.set('wait', '1');
  const url = `/api/devices${params.size ? `?${params}` : ''}`;
  if (!options.force && devicesRequest) return devicesRequest;
  devicesRequest = apiGet<DevicesResponse>(url).finally(() => {
    devicesRequest = null;
  });
  return devicesRequest;
}

export function getDevicesDiagnostics() {
  return apiGet<DevicesDiagnosticsResponse>('/api/devices/diagnostics');
}

export function getMovements() {
  return apiGet<{ ok: true; items: Movement[] }>('/api/movements');
}

export function addDevice(payload: Partial<Device> & { operator: string }) {
  if ((payload as Record<string, unknown>).originalEtiqueta) {
    return apiSend<{ ok: true; item: Device }>(`/api/devices/${encodeURIComponent(String((payload as Record<string, unknown>).originalEtiqueta))}`, 'PATCH', payload);
  }
  return apiSend<{ ok: true; item: Device }>('/api/devices/add', 'POST', payload);
}

export function getDeviceCategories() {
  return apiGet<{ ok: true; items: Array<{ nombre: string }> }>('/api/device-categories');
}

export function updateDeviceStatus(payload: { etiqueta: string; estado: string; operator: string; comentario?: string }) {
  return apiSend<{ ok: true }>('/api/devices/status', 'POST', payload);
}

export function deleteDevice(etiqueta: string, operator: string) {
  return apiSend<{ ok: true; etiqueta: string }>(`/api/devices/${encodeURIComponent(etiqueta)}`, 'DELETE', { operator });
}
