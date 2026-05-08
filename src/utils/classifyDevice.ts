import type { Device, DeviceType } from '../types';
import { clean, normalizeText } from './formatters';

export function normalizeDeviceCategory(value?: string): string {
  const raw = clean(value);
  if (!raw) return '';
  const normalized = normalizeText(raw);
  if (normalized === 'plani' || normalized.includes('planificacion')) return 'Plani';
  if (normalized === 'touch') return 'Touch';
  if (normalized === 'tic') return 'TIC';
  if (normalized === 'dell') return 'Dell';
  if (normalized.includes('tablet')) return 'Tablet';
  if (normalized.includes('chromebook')) return 'Chromebook';
  if (normalized.includes('notebook')) return 'Notebook';
  return raw.slice(0, 1).toUpperCase() + raw.slice(1);
}

export function classifyDeviceType(device: Partial<Device>): DeviceType {
  const explicit = normalizeDeviceCategory(device.categoria || (device as Record<string, unknown>).tipo as string || (device as Record<string, unknown>).category as string);
  if (explicit) return explicit;
  const marca = normalizeText(device.marca);
  const modelo = normalizeText(device.modelo);
  const dispositivo = normalizeText(device.dispositivo);
  const comentarios = normalizeText(device.comentarios);
  const compact = `${modelo} ${dispositivo} ${comentarios}`.replace(/[^a-z0-9]/g, '');

  if (modelo.includes('tablet') || dispositivo.includes('tablet') || comentarios.includes('tablet')) return 'Tablet';
  if (marca.includes('dell') || modelo.includes('dell')) return 'Dell';
  if (modelo.includes('touch') || dispositivo.includes('touch')) return 'Touch';
  if (modelo.includes('tic') || dispositivo.includes('tic')) return 'TIC';
  if (compact.includes('xe500c12')) return 'Plani';
  if (modelo.includes('plani') || modelo.includes('planificacion') || dispositivo.includes('plani') || dispositivo.includes('planificacion')) return 'Plani';
  if (marca.includes('acer') && (modelo.includes('cb315-3h') || compact.includes('cb3153h'))) return 'TIC';
  if (compact.includes('r841') || compact.includes('c34011') || compact.includes('xe520qabk04us')) return 'Touch';
  return 'Otro';
}

export function getDeviceNumber(device: Partial<Device>): string {
  const direct = clean(device.numero || (device as Record<string, unknown>).number || (device as Record<string, unknown>).nro);
  const directNumber = extractOperationalNumber(direct);
  if (directNumber) return directNumber;
  const alias = clean((device as Record<string, unknown>).aliasOperativo);
  return extractOperationalNumber(alias);
}

export function operationalTypeLabel(device: Partial<Device>): string {
  return normalizeDeviceCategory(classifyDeviceType(device)) || 'Otro';
}

export function getOperationalGroup(device: Partial<Device>): string {
  return operationalTypeLabel(device);
}

export function getOperationalNumber(device: Partial<Device>): number {
  const value = Number(getDeviceNumber(device));
  return Number.isFinite(value) && value > 0 ? value : Number.MAX_SAFE_INTEGER;
}

export function getOperationalAlias(device: Partial<Device>): string {
  const explicit = clean((device as Record<string, unknown>).aliasOperativo);
  const type = operationalTypeLabel(device);
  const number = getDeviceNumber(device);
  if (explicit) {
    const first = explicit.split(',').map(item => clean(item)).find(Boolean) || explicit;
    const explicitNumber = extractOperationalNumber(first);
    if (explicitNumber && ['Plani', 'Touch', 'TIC', 'Dell'].includes(type)) return `${type} ${explicitNumber}`;
    const hasNumber = /\d/.test(first);
    if (!hasNumber && number && ['Plani', 'Touch', 'TIC', 'Dell'].includes(type)) return `${first} ${number}`;
    return first;
  }
  if (!type) return number;
  return number ? `${type} ${number}` : type;
}

export function getOperationalAliasList(device: Partial<Device>): string[] {
  const explicit = clean((device as Record<string, unknown>).aliasOperativo);
  const main = getOperationalAlias(device);
  if (explicit) {
    const items = explicit.split(',').map(item => clean(item)).filter(Boolean);
    return [...new Set([main, ...items].filter(Boolean))];
  }
  const fallback = main;
  return fallback ? [fallback] : [];
}

export function matchesOperationalAlias(device: Partial<Device>, query: string): boolean {
  const raw = clean(query);
  if (!raw) return true;
  const q = normalizeOperationalSearch(raw);
  const label = normalizeOperationalSearch(device.etiqueta);
  if (label.includes(q)) return true;

  const group = getOperationalGroup(device);
  const number = getDeviceNumber(device);
  const candidates = [
    getOperationalAlias(device),
    ...getOperationalAliasList(device),
    device.aliasOperativo,
    device.numero,
    group && number ? `${group} ${number}` : '',
    group && number ? `${group}${number}` : ''
  ];
  return candidates.some(candidate => normalizeOperationalSearch(candidate).includes(q));
}

export function sortByOperationalAlias<T extends Partial<Device>>(devices: T[]): T[] {
  return [...devices].sort((a, b) => {
    const groupCompare = getOperationalGroup(a).localeCompare(getOperationalGroup(b), 'es');
    if (groupCompare) return groupCompare;
    const numberCompare = getOperationalNumber(a) - getOperationalNumber(b);
    if (numberCompare) return numberCompare;
    return String(a.etiqueta || '').localeCompare(String(b.etiqueta || ''), 'es', { numeric: true });
  });
}

function tagSortKey(etiqueta: string): number {
  const match = String(etiqueta || '').toUpperCase().match(/D0*(\d+)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function extractOperationalNumber(value: unknown): string {
  const raw = clean(value);
  if (!raw || /^D0*\d+$/i.test(raw)) return '';
  if (/^\d{1,3}$/.test(raw)) return String(Number(raw));
  const match = raw.match(/\b(?:plani|touch|tic|dell)\s*0*(\d{1,3})\b/i)
    || raw.match(/\b0*(\d{1,3})\s*(?:plani|touch|tic|dell)\b/i);
  return match ? String(Number(match[1])) : '';
}

function normalizeOperationalSearch(value: unknown): string {
  return normalizeText(value)
    .replace(/planificacion/g, 'plani')
    .replace(/\bplano\b/g, 'plani')
    .replace(/\bplan\b/g, 'plani')
    .replace(/[^a-z0-9]/g, '');
}

export function withOperationalAliases<T extends Partial<Device> & { id?: string; etiqueta?: string }>(devices: T[]): T[] {
  const used = new Set<number>();
  for (const device of devices) {
    if (classifyDeviceType(device) !== 'Plani') continue;
    const explicit = Number(getDeviceNumber(device));
    if (Number.isFinite(explicit) && explicit > 0) used.add(explicit);
  }
  const planiNeeds = devices
    .map((device, index) => ({ device, index }))
    .filter(item => classifyDeviceType(item.device) === 'Plani' && !getDeviceNumber(item.device))
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
