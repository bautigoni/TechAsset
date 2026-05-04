import type { Device } from '../types';

export type DeviceStateKey = 'available' | 'loaned' | 'missing' | 'out';

export function getDeviceStateKey(device: Pick<Device, 'estado'> & { prestadoA?: string }): DeviceStateKey {
  const state = normalizeState(`${device.estado || ''} ${device.prestadoA || ''}`);
  if (state.includes('fuera') || state.includes('servicio') || state.includes('mantenimiento') || state.includes('baja')) return 'out';
  if (state.includes('perd') || state.includes('lost') || state.includes('no encontrada') || state.includes('no encontrado')) return 'missing';
  if (state.includes('prest') || state.includes('retir')) return 'loaned';
  return 'available';
}

export function isDeviceState(device: Pick<Device, 'estado'> & { prestadoA?: string }, key: DeviceStateKey) {
  return getDeviceStateKey(device) === key;
}

function normalizeState(value: string) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
