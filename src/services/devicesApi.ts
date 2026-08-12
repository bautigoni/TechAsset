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

export interface DeviceOverviewResponse {
  ok: true;
  device: Device;
  timeline: Array<{ action: string; date: string; user: string; notes: string; source: string }>;
  stats: { totalLoans: number; totalRepairs: number; incidents: number; lastMaintenance: string; lastLoan: string; lastRepair: string };
  activeLoan: null | { person: string; role: string; location: string; since: string };
  openTickets: Array<{ id: number; numero: string; titulo: string; estado: string; prioridad: string; categoria: string; updatedAt: string }>;
  recentTickets: Array<{ id: number; numero: string; titulo: string; estado: string; prioridad: string; categoria: string; updatedAt: string }>;
  maintenanceHistory: Array<{ id: number; title: string; date: string; status: string; notes: string }>;
  purchaseInformation: null;
  warrantyInformation: null;
  aiSummary: { text: string; generatedAt: string; cached: boolean };
  condition: string;
  conditionNotes: string;
  lifecycle: {
    assetClass: string;
    origen: 'equipo' | 'sede' | 'global';
    meses: number;
    fechaAlta: string;
    fechaRenovacion: string;
    mesesRestantes: number | null;
    vidaConsumidaPct: number | null;
    vencido: boolean;
    estimada: boolean;
    lastReviewedAt: string;
  };
  group: DeviceGroup | null;
}

export interface DeviceGroup { id:number; name:string; description:string; classroomKey:string; members:Device[]; createdBy?:string }

export function getDeviceOverview(etiqueta: string) {
  return apiGet<DeviceOverviewResponse>(`/api/devices/${encodeURIComponent(etiqueta)}/overview`);
}

export interface DeviceMetadataPayload {
  /** Ausente = edición parcial: el backend conserva la condición y su fecha. */
  condition?: string;
  notes?: string;
  assetClass?: string;
  expectedLifeMonths?: number | null;
  fechaAlta?: string;
  teamviewerId?: string;
  origen?: string;
}

export const updateDeviceMetadata = (etiqueta:string, payload:DeviceMetadataPayload) => apiSend<{ok:true;condition:string;notes:string;assetClass:string;lastReviewedAt:string}>(`/api/devices/${encodeURIComponent(etiqueta)}/metadata`, 'PATCH', payload);

export interface ReviewQueueItem {
  etiqueta: string;
  alias: string;
  categoria: string;
  marca: string;
  modelo: string;
  estado: string;
  assetClass: string;
  assetClassConfirmed: boolean;
  condition: string;
  conditionNotes: string;
  lastReviewedAt: string;
}

export const getDeviceReviewQueue = () => apiGet<{ ok: true; assetClasses: string[]; total: number; reviewed: number; items: ReviewQueueItem[] }>('/api/devices/review-queue');

export interface LifecycleDefault { assetClass: string; meses: number; origen: 'equipo' | 'sede' | 'global' }
export const getLifecycleDefaults = () => apiGet<{ ok: true; items: LifecycleDefault[] }>('/api/lifecycle/defaults');
export const updateLifecycleDefault = (payload: { assetClass: string; meses: number }) => apiSend<{ ok: true } & LifecycleDefault>('/api/lifecycle/defaults', 'PATCH', payload);
export const getDeviceGroups = () => apiGet<{ok:true;items:DeviceGroup[]}>('/api/device-groups');
export const createDeviceGroup = (payload:{name:string;description?:string;classroomKey?:string;deviceTags:string[]}) => apiSend<{ok:true;id:number}>('/api/device-groups','POST',payload);
export const updateDeviceGroup = (id:number,payload:{name?:string;description?:string;classroomKey?:string;deviceTags?:string[]}) => apiSend<{ok:true}>(`/api/device-groups/${id}`,'PATCH',payload);
export const deleteDeviceGroup = (id:number) => apiSend<{ok:true;deleted:boolean}>(`/api/device-groups/${id}`,'DELETE');

export function updateDeviceStatus(payload: { etiqueta: string; estado: string; operator: string; comentario?: string }) {
  return apiSend<{ ok: true }>('/api/devices/status', 'POST', payload);
}

export function deleteDevice(etiqueta: string, operator: string) {
  return apiSend<{ ok: true; etiqueta: string }>(`/api/devices/${encodeURIComponent(etiqueta)}`, 'DELETE', { operator });
}
