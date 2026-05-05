import type { Device, DeviceType } from '../types';
import { clean, normalizeText } from './formatters';

export function classifyDeviceType(device: Partial<Device>): DeviceType {
  const marca = normalizeText(device.marca);
  const modelo = normalizeText(device.modelo);
  const dispositivo = normalizeText(device.dispositivo);
  const comentarios = normalizeText(device.comentarios);
  const compact = `${modelo} ${dispositivo} ${comentarios}`.replace(/[^a-z0-9]/g, '');

  if (marca.includes('dell') || modelo.includes('dell')) return 'DELL';
  if (modelo.includes('touch') || dispositivo.includes('touch')) return 'TOUCH';
  if (modelo.includes('tic') || dispositivo.includes('tic')) return 'TIC';
  if (compact.includes('xe500c12')) return 'PLANI';
  if (modelo.includes('plani') || modelo.includes('planificacion') || dispositivo.includes('plani') || dispositivo.includes('planificacion')) return 'PLANI';
  if (marca.includes('acer') && (modelo.includes('cb315-3h') || compact.includes('cb3153h'))) return 'TIC';
  if (compact.includes('r841') || compact.includes('c34011') || compact.includes('xe520qabk04us')) return 'TOUCH';
  return 'PLANI';
}

export function getDeviceNumber(device: Partial<Device>): string {
  return clean(device.numero || (device as Record<string, unknown>).number || (device as Record<string, unknown>).nro);
}

export function operationalTypeLabel(device: Partial<Device>): string {
  return ({ PLANI: 'Plani', TOUCH: 'Touch', TIC: 'TIC', DELL: 'Dell' } as Record<DeviceType, string>)[classifyDeviceType(device)];
}

export function getOperationalAlias(device: Partial<Device>): string {
  const explicit = clean((device as Record<string, unknown>).aliasOperativo);
  if (explicit) return explicit;
  const type = operationalTypeLabel(device);
  const number = getDeviceNumber(device);
  if (!type) return number;
  return number ? `${type} ${number}` : type;
}

function tagSortKey(etiqueta: string): number {
  const match = String(etiqueta || '').toUpperCase().match(/D0*(\d+)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export function withOperationalAliases<T extends Partial<Device> & { id?: string; etiqueta?: string }>(devices: T[]): T[] {
  const used = new Set<number>();
  for (const device of devices) {
    if (classifyDeviceType(device) !== 'PLANI') continue;
    const explicit = Number(getDeviceNumber(device));
    if (Number.isFinite(explicit) && explicit > 0) used.add(explicit);
  }
  const planiNeeds = devices
    .map((device, index) => ({ device, index }))
    .filter(item => classifyDeviceType(item.device) === 'PLANI' && !getDeviceNumber(item.device))
    .sort((a, b) => tagSortKey(String(a.device.etiqueta || '')) - tagSortKey(String(b.device.etiqueta || '')));
  const assigned = new Map<number, string>();
  let next = 1;
  for (const item of planiNeeds) {
    while (used.has(next)) next += 1;
    used.add(next);
    assigned.set(item.index, String(next));
    next += 1;
  }
  return devices.map((device, index) => {
    const auto = assigned.get(index);
    if (auto) {
      return { ...device, numero: auto, aliasOperativo: `Plani ${auto}` };
    }
    return { ...device, aliasOperativo: getOperationalAlias(device) };
  });
}
