import type { Device } from '../../types';
import { getDeviceNumber, getOperationalAlias, getOperationalGroup, matchesOperationalAlias, sortByOperationalAlias } from '../../utils/classifyDevice';
import { getDeviceStateKey, getLoanState, type LoanState } from '../../utils/deviceState';
import { TIME_HM, dateFormatter, formatDate, loanAgeDays, normalizeText } from '../../utils/formatters';
import { normalizeDeviceLabel } from '../../utils/normalizeSearch';
import type { StatusTextTone } from '../../ui';

/* Lógica pura del Inicio (sin React): estado, antigüedad, filtros y textos. */

export type ListFilter = 'loaned' | 'available' | 'all' | 'overdue';

export const aliasOf = (device: Device) => device.aliasOperativo || getOperationalAlias(device) || device.etiqueta;
export const loanOf = (device: Device): LoanState => getLoanState(device.estado);
export const ageOf = (device: Device) => (device.loanedAt ? loanAgeDays(device.loanedAt) : 0);

/** "Prestado" va en tono normal; lo que pide atención, coloreado (sin fondo). */
export function stateText(device: Device): { text: string; tone: StatusTextTone } {
  const key = getDeviceStateKey(device);
  if (key === 'loaned') {
    const days = ageOf(device);
    if (days >= 2) return { text: `Prestado · ${days} días`, tone: 'bad' };
    if (days === 1) return { text: 'Prestado · hace 1 día', tone: 'warn' };
    return { text: 'Prestado', tone: 'normal' };
  }
  if (key === 'available') return { text: 'Disponible', tone: 'normal' };
  if (key === 'missing') return { text: 'No encontrado', tone: 'bad' };
  return { text: device.estado || 'Fuera de servicio', tone: 'bad' };
}

const WEEKDAY_SHORT: Intl.DateTimeFormatOptions = { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' };
const TIME_AR: Intl.DateTimeFormatOptions = { ...TIME_HM, hour12: false, timeZone: 'America/Argentina/Buenos_Aires' };

/** "recién", "hace 12 min", "hace 2 h", "hace 2 h 10 min". */
export function agoText(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 1) return 'recién';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `hace ${rest} min`;
  return rest ? `hace ${hours} h ${rest} min` : `hace ${hours} h`;
}

/** Columna "Desde": hora si salió hoy, "N días" con tono si no. */
export function sinceOf(device: Device, now = Date.now()): { main: string; sub: string; tone: StatusTextTone } {
  if (!device.loanedAt) return { main: '—', sub: '', tone: 'muted' };
  const date = new Date(device.loanedAt);
  if (Number.isNaN(date.getTime())) return { main: '—', sub: '', tone: 'muted' };
  const days = ageOf(device);
  if (days <= 0) return { main: dateFormatter(TIME_AR).format(date), sub: agoText(now - date.getTime()), tone: 'normal' };
  return { main: days === 1 ? '1 día' : `${days} días`, sub: `desde ${dateFormatter(WEEKDAY_SHORT).format(date)}`, tone: days >= 2 ? 'bad' : 'warn' };
}

export function whereOf(device: Device) {
  const place = [device.ubicacion, device.ubicacionDetalle].filter(Boolean).join(' ');
  return [device.curso, place].filter(Boolean).join(' · ');
}

export function initialOf(name?: string) {
  return String(name || '?').trim().charAt(0).toUpperCase() || '?';
}

export type Counts = { available: number; loaned: number; overdue: number; total: number; people: number; peopleCount: Map<string, number> };

export function countDevices(devices: Device[]): Counts {
  let available = 0; let loaned = 0; let overdue = 0;
  const peopleCount = new Map<string, number>();
  for (const device of devices) {
    const key = getDeviceStateKey(device);
    if (key === 'available') available += 1;
    else if (key === 'loaned') {
      loaned += 1;
      if (ageOf(device) >= 1) overdue += 1;
      const person = normalizeText(device.prestadoA);
      if (person) peopleCount.set(person, (peopleCount.get(person) || 0) + 1);
    }
  }
  return { available, loaned, overdue, total: devices.length, people: peopleCount.size, peopleCount };
}

export type TypeStat = { name: string; free: number; total: number };

/** Todos los tipos de la sede con libres/total (orden: más equipos primero). */
export function typeStats(devices: Device[]): TypeStat[] {
  const map = new Map<string, TypeStat>();
  for (const device of devices) {
    const name = getOperationalGroup(device) || 'Otro';
    const stat = map.get(name) || { name, free: 0, total: 0 };
    stat.total += 1;
    if (getDeviceStateKey(device) === 'available') stat.free += 1;
    map.set(name, stat);
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'es'));
}

/** Buscador de la lista: alias en todos sus formatos + persona/ubicación/curso. */
export function matchesListQuery(device: Device, query: string) {
  const q = query.trim();
  if (!q) return true;
  if (matchesOperationalAlias(device, q)) return true;
  const needle = normalizeText(q);
  return [device.prestadoA, device.ubicacion, device.curso, device.rol].some(value => normalizeText(value).includes(needle));
}

export function filterList(devices: Device[], filter: ListFilter, type: string, query: string) {
  const list = devices.filter(device => {
    const key = getDeviceStateKey(device);
    if (filter === 'loaned' && key !== 'loaned') return false;
    if (filter === 'overdue' && (key !== 'loaned' || ageOf(device) < 1)) return false;
    if (filter === 'available' && key !== 'available') return false;
    if (type && getOperationalGroup(device) !== type) return false;
    return matchesListQuery(device, query);
  });
  if (filter === 'loaned' || filter === 'overdue') {
    // Lo que lleva más tiempo afuera, arriba.
    return list.sort((a, b) => ageOf(b) - ageOf(a) || String(a.loanedAt || '').localeCompare(String(b.loanedAt || '')));
  }
  return sortByOperationalAlias(list);
}

/** Campos de la ficha en línea. */
export function fichaFields(device: Device): Array<[string, string]> {
  const fields: Array<[string, string]> = [
    ['Etiqueta', device.etiqueta],
    ['Tipo', getOperationalGroup(device)],
    ['Modelo', [device.marca, device.modelo].filter(Boolean).join(' ') || device.dispositivo || '—'],
    ['Estado', stateText(device).text]
  ];
  if (loanOf(device) === 'loaned') {
    fields.push(['Prestado a', [device.prestadoA, device.rol].filter(Boolean).join(' · ') || '—']);
    fields.push(['Dónde', whereOf(device) || '—']);
    fields.push(['Motivo', [device.motivo, device.motivoDetalle].filter(Boolean).join(' · ') || '—']);
    if (device.loanedAt) fields.push(['Desde', formatDate(device.loanedAt, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' })]);
  }
  if (device.comentarios) fields.push(['Comentarios', device.comentarios]);
  if (device.sn) fields.push(['SN', device.sn]);
  return fields;
}

/* ── Sugerencias cuando no hay coincidencia ─────────────────────────────── */

const TYPE_WORDS: Record<string, string> = { plani: 'Plani', planificacion: 'Plani', plano: 'Plani', plan: 'Plani', touch: 'Touch', tic: 'TIC', dell: 'Dell', tablet: 'Tablet', notebook: 'Notebook', chromebook: 'Chromebook' };

/** "touch 43" → los Touch con número más cercano; "D1499" → etiquetas vecinas. */
export function nearestDevices(devices: Device[], raw: string, limit = 4): Device[] {
  const text = normalizeText(raw);
  const typed = text.match(/\b([a-z]+)\s*0*(\d{1,3})\b/) || text.match(/\b0*(\d{1,3})\s*([a-z]+)\b/);
  if (typed) {
    const word = /^\d/.test(typed[1]) ? typed[2] : typed[1];
    const num = Number(/^\d/.test(typed[1]) ? typed[1] : typed[2]);
    const type = TYPE_WORDS[word];
    if (type) {
      return devices
        .filter(device => getOperationalGroup(device) === type && getDeviceNumber(device))
        .sort((a, b) => Math.abs(Number(getDeviceNumber(a)) - num) - Math.abs(Number(getDeviceNumber(b)) - num))
        .slice(0, limit);
    }
  }
  const label = normalizeDeviceLabel(raw);
  const target = Number(label.replace(/^D/, ''));
  if (/^D\d+$/.test(label) && Number.isFinite(target)) {
    return devices
      .map(device => ({ device, n: Number(normalizeDeviceLabel(device.etiqueta).replace(/^D/, '')) }))
      .filter(item => Number.isFinite(item.n))
      .sort((a, b) => Math.abs(a.n - target) - Math.abs(b.n - target))
      .slice(0, limit)
      .map(item => item.device);
  }
  return [];
}

/** El libre más cercano del mismo tipo (para "Fuera de servicio → prestá este"). */
export function nearestFree(devices: Device[], device: Device): Device | undefined {
  const type = getOperationalGroup(device);
  const num = Number(getDeviceNumber(device)) || 0;
  return devices
    .filter(item => item.id !== device.id && getOperationalGroup(item) === type && loanOf(item) === 'available')
    .sort((a, b) => Math.abs((Number(getDeviceNumber(a)) || 0) - num) - Math.abs((Number(getDeviceNumber(b)) || 0) - num))[0];
}
