import type { Device, Movement } from '../types';
import { apiGet, apiSend } from './apiClient';

type DevicesResponse = { ok: true; items: Device[]; loadedAt: string; source: string; diagnostics?: Record<string, unknown> };
type DevicesDiagnosticsResponse = { ok: true; diagnostics: Record<string, unknown> };
type DevicesDebugResponse = { ok: boolean; siteCode: string; debug?: Record<string, unknown>; error?: string };

const devicesRequests = new Map<string, Promise<DevicesResponse>>();

function activeSiteKey() {
  return localStorage.getItem('techasset_active_site') || 'NFPT';
}

export function getDevices(options: { force?: boolean; wait?: boolean } = {}) {
  const params = new URLSearchParams();
  if (options.force) params.set('refresh', '1');
  if (options.wait) params.set('wait', '1');
  if (options.force) params.set('_ts', String(Date.now()));
  const url = `/api/devices${params.size ? `?${params}` : ''}`;
  const key = `${activeSiteKey()}|${url}`;
  if (options.force) devicesRequests.delete(key);
  const current = devicesRequests.get(key);
  if (!options.force && current) return current;
  const request = apiGet<DevicesResponse>(url).finally(() => {
    devicesRequests.delete(key);
  });
  devicesRequests.set(key, request);
  return request;
}

export function getDevicesDiagnostics() {
  return apiGet<DevicesDiagnosticsResponse>('/api/devices/diagnostics');
}

export function getDevicesDebug() {
  return apiGet<DevicesDebugResponse>('/api/devices/debug');
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
