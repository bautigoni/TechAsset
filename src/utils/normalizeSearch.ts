import type { Device } from '../types';
import { classifyDeviceType, getOperationalAlias, getOperationalAliasList } from './classifyDevice';
import { clean, normalizeText } from './formatters';

export function parseScannedCode(raw: unknown): string {
  const text = clean(raw);
  if (!text) return '';
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    return clean(data.etiqueta || data.id || data.codigo || data.code || text);
  } catch {
    const queryMatch = text.match(/(?:etiqueta|codigo|code|id)=([^&\s]+)/i);
    if (queryMatch) return clean(decodeURIComponent(queryMatch[1]));
    const oldQr = text.match(/TA\|([^|]+)/i);
    if (oldQr) return clean(oldQr[1]);
    const label = text.match(/\bD\s*0*\d{1,5}\b/i);
    if (label) return clean(label[0]);
    return text;
  }
}

export function normalizeSearchKey(value: unknown): string {
  return String(value || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

export function normalizeDeviceSearch(value: unknown): string {
  const parsed = parseScannedCode(value);
  return normalizeSearchKey(parsed || value);
}

export function normalizeAlias(value: unknown): string {
  const text = normalizeText(value)
    .replace(/planificacion/g, 'plani')
    .replace(/\bplano\b/g, 'plani')
    .replace(/\bplan\b/g, 'plani');
  return normalizeSearchKey(text);
}

type AliasType = 'PLANI' | 'TOUCH' | 'TIC' | 'DELL';

function parseOperationalAlias(value: unknown): { type: AliasType; number: string } | null {
  const text = normalizeText(value)
    .replace(/planificacion/g, 'plani')
    .replace(/\bplano\b/g, 'plani')
    .replace(/\bplan\b/g, 'plani');
  const match = text.match(/\b(plani|touch|tic|dell)\s*0*(\d{1,3})\b/);
  if (!match) return null;
  const type = ({ plani: 'PLANI', touch: 'TOUCH', tic: 'TIC', dell: 'DELL' } as Record<string, AliasType>)[match[1]];
  return { type, number: String(Number(match[2])) };
}

export function normalizeDeviceLabel(value: unknown): string {
  const key = normalizeSearchKey(value);
  const dMatch = key.match(/^D0*(\d+)$/) || key.match(/D0*(\d+)/);
  if (dMatch) return `D${String(Number(dMatch[1])).padStart(4, '0')}`;
  if (/^\d+$/.test(key)) return `D${String(Number(key)).padStart(4, '0')}`;
  return key;
}

export function flexibleDeviceKey(value: unknown): string {
  const key = normalizeSearchKey(value).toLowerCase();
  const match = key.match(/^([a-z]+)0*(\d+)$/i);
  return match ? `${match[1]}${Number(match[2])}` : key;
}

export function matchesSmartSearch(device: Device, query: string): boolean {
  const aliasQuery = parseOperationalAlias(query);
  if (aliasQuery) {
    const explicitMatch = getOperationalAliasList(device).some(alias => normalizeAlias(alias) === normalizeAlias(query));
    return explicitMatch || (classifyDeviceType(device) === aliasQuery.type && String(Number(clean(device.numero))) === aliasQuery.number);
  }

  const q = normalizeDeviceSearch(query);
  const qAlias = normalizeAlias(query);
  const qLabel = normalizeDeviceLabel(query);
  const exactLabel = normalizeDeviceLabel(device.etiqueta);
  if (qLabel && exactLabel && qLabel === exactLabel) return true;

  const values = [
    device.etiqueta,
    getOperationalAlias(device),
    ...getOperationalAliasList(device),
    device.aliasOperativo,
    device.numero,
    device.dispositivo,
    device.marca,
    device.modelo,
    device.sn,
    device.mac,
    device.prestadoA,
    device.comentarios,
    device.rol,
    device.ubicacion,
    device.motivo
  ];

  return values.some(value => {
    const key = normalizeDeviceSearch(value);
    const alias = normalizeAlias(value);
    return Boolean(key && q && key.includes(q)) || Boolean(qAlias && alias === qAlias) || Boolean(qLabel && normalizeDeviceLabel(value) === qLabel);
  });
}

export function resolveDeviceMatches(devices: Device[], raw: string): Device[] {
  const code = parseScannedCode(raw);
  const label = normalizeDeviceLabel(code);
  const key = normalizeDeviceSearch(code);
  const alias = normalizeAlias(code);
  const matches: Device[] = [];
  const add = (device?: Device) => {
    if (device && !matches.some(item => item.id === device.id)) matches.push(device);
  };

  devices.forEach(device => {
    const exact = [device.etiqueta, device.sn, device.mac];
    if (exact.some(value => normalizeDeviceSearch(value) === key || (label && normalizeDeviceLabel(value) === label))) add(device);
  });
  if (matches.length) return matches;

  devices.forEach(device => {
    if (alias && getOperationalAliasList(device).some(value => normalizeAlias(value) === alias)) add(device);
  });
  if (matches.length) return matches;

  const aliasQuery = parseOperationalAlias(code);
  if (aliasQuery) {
    devices.forEach(device => {
      if (classifyDeviceType(device) === aliasQuery.type && String(Number(clean(device.numero))) === aliasQuery.number) add(device);
    });
    return matches;
  }

  const flexible = flexibleDeviceKey(code);
  devices.forEach(device => {
    if (flexibleDeviceKey(device.etiqueta) === flexible || normalizeDeviceSearch(device.sn).includes(key) || normalizeDeviceSearch(device.mac).includes(key)) add(device);
  });
  if (matches.length) return matches;

  devices.forEach(device => {
    if (matchesSmartSearch(device, code)) add(device);
  });
  return matches;
}
