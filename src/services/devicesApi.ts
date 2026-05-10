import type { Device, Movement } from '../types';
import { apiGet, apiSend, siteHeaders } from './apiClient';

type DevicesResponse = { ok: true; items: Device[]; loadedAt: string; source: string; diagnostics?: Record<string, unknown> };
type DevicesDiagnosticsResponse = { ok: true; diagnostics: Record<string, unknown> };
type DevicesImportResponse = {
  ok: true;
  summary: { read: number; created: number; updated: number; reactivated?: number; skipped: number; errors: number; errorDetails?: string[] };
};

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

export function getMovements() {
  return apiGet<{ ok: true; items: Movement[] }>('/api/movements');
}

export function importDevicesFromCsv(payload: { csvUrl?: string; csvText?: string; operator?: string }) {
  return apiSend<DevicesImportResponse>('/api/devices/import', 'POST', payload);
}

export async function downloadDevicesCsv(path: string, filename: string) {
  const response = await fetch(path, { cache: 'no-store', headers: siteHeaders() });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const data = await response.json();
      message = data?.error || message;
    } catch {
      // CSV endpoints do not return JSON on success.
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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
