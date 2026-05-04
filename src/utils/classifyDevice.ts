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
  if (modelo.includes('plani') || modelo.includes('planificacion') || dispositivo.includes('plani') || dispositivo.includes('planificacion')) return 'PLANI';
  if (marca.includes('acer') && (modelo.includes('cb315-3h') || compact.includes('cb3153h'))) return 'TIC';
  if (compact.includes('r841') || compact.includes('c34011') || compact.includes('xe520qabk04us')) return 'TOUCH';
  if (compact.includes('xe500c12')) return 'PLANI';
  return 'PLANI';
}

export function getDeviceNumber(device: Partial<Device>): string {
  return clean(device.numero || (device as Record<string, unknown>).number || (device as Record<string, unknown>).nro);
}

export function operationalTypeLabel(device: Partial<Device>): string {
  return ({ PLANI: 'Plani', TOUCH: 'Touch', TIC: 'TIC', DELL: 'Dell' } as Record<DeviceType, string>)[classifyDeviceType(device)];
}

export function getOperationalAlias(device: Partial<Device>): string {
  const type = operationalTypeLabel(device);
  const number = getDeviceNumber(device);
  if (!type) return number;
  return number ? `${type} ${number}` : type;
}
