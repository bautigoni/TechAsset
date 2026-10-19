import type { Device } from '../../types';
import type { StatusTextTone } from '../../ui';
import { classifyDeviceType, getOperationalAlias, getOperationalGroup, getOperationalNumber } from '../../utils/classifyDevice';
import { getDeviceStateKey, getLoanState, type DeviceStateKey } from '../../utils/deviceState';
import { APP_TIME_ZONE, dateFormatter, dayKeyAr, loanAgeDays, todayKeyAr } from '../../utils/formatters';

/** Estados que se pueden poner a mano (lote, formulario). "Prestado" sale de Préstamos. */
export const MANUAL_STATES = ['Disponible', 'Fuera de servicio', 'En reparación', 'No encontrada', 'Sin revisar'] as const;

export const STATE_FILTERS: Array<{ value: 'all' | DeviceStateKey; label: string; title: string }> = [
  { value: 'all', label: 'Todos', title: 'Todos los equipos' },
  { value: 'available', label: 'Disponibles', title: 'Disponibles' },
  { value: 'loaned', label: 'Prestados', title: 'Prestados' },
  { value: 'missing', label: 'No encontradas', title: 'No encontradas' },
  { value: 'out', label: 'Fuera de servicio', title: 'Fuera de servicio' }
];

/** "Perdida" se muestra como "No encontrada" (es el mismo estado). */
export function stateLabel(device: Pick<Device, 'estado'>) {
  const estado = String(device.estado || '').trim();
  if (!estado) return 'Disponible';
  return estado === 'Perdida' ? 'No encontrada' : estado;
}

/** El estado normal no se marca; lo que pide atención va en color, sin fondo. */
export function stateTone(device: Pick<Device, 'estado'>): StatusTextTone {
  const key = getDeviceStateKey(device);
  if (key === 'loaned') return 'info';
  if (key === 'missing') return 'bad';
  if (key === 'out') return 'warn';
  if (/sin revisar/i.test(String(device.estado || ''))) return 'muted';
  return 'normal';
}

/** Celdas de texto: "Disponible/Prestado/Devuelto" no son una persona ni un SN. */
export function cellValue(value?: string) {
  const text = String(value || '').trim();
  if (!text || /^(devuelto|prestado|disponible)$/i.test(text)) return '';
  return text;
}

export function deviceKind(device: Device) {
  return device.categoria || device.dispositivo || 'Chromebook';
}

export function deviceModel(device: Device) {
  return [device.marca, device.modelo].map(item => String(item || '').trim()).filter(Boolean).join(' · ');
}

export function isLoaned(device: Pick<Device, 'estado'>) {
  return getLoanState(device.estado) === 'loaned';
}

export function isLendable(device: Pick<Device, 'estado'>) {
  return getLoanState(device.estado) === 'available';
}

export function loanWhere(device: Device) {
  return [device.ubicacion, device.curso].map(item => cellValue(item)).filter(Boolean).join(' · ');
}

/** "Hoy" / "1 día" / "N días" (la antigüedad del préstamo, en días de calendario). */
export function ageText(value?: string) {
  if (!value) return '';
  const days = loanAgeDays(value);
  if (days <= 0) return 'Hoy';
  return days === 1 ? '1 día' : `${days} días`;
}

const SHORT_AR: Intl.DateTimeFormatOptions = { timeZone: APP_TIME_ZONE, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
const DAY_AR: Intl.DateTimeFormatOptions = { timeZone: APP_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' };
const TIME_AR: Intl.DateTimeFormatOptions = { timeZone: APP_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };

/** "hoy 10:42", "ayer 18:05" o "12/05 09:30", en hora argentina. */
export function shortWhen(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const key = dayKeyAr(date);
  const today = todayKeyAr();
  const time = dateFormatter(TIME_AR, 'es-AR').format(date);
  if (key === today) return `hoy ${time}`;
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (key === yesterday.toISOString().slice(0, 10)) return `ayer ${time}`;
  return dateFormatter(SHORT_AR, 'es-AR').format(date).replace(',', '');
}

/** dd/mm/aaaa en hora argentina ('' si no hay fecha). */
export function dayLabel(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10).split('-').reverse().join('/');
  return dateFormatter(DAY_AR, 'es-AR').format(date);
}

/* ── Orden ──────────────────────────────────────────────────────────────── */

const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

export type SortKey = 'equipo' | 'dispositivo' | 'sn' | 'prestado' | 'devolucion' | 'estado';

function operationalKey(device: Device) {
  const number = getOperationalNumber(device);
  return `${getOperationalGroup(device)} ${String(number === Number.MAX_SAFE_INTEGER ? 999999 : number).padStart(6, '0')} ${device.etiqueta}`;
}

const SORT_VALUE: Record<SortKey, (device: Device) => string> = {
  equipo: operationalKey,
  dispositivo: device => `${deviceKind(device)} ${deviceModel(device)}`,
  sn: device => cellValue(device.sn || device.mac),
  prestado: device => (isLoaned(device) ? cellValue(device.prestadoA) : ''),
  devolucion: device => cellValue(device.returnedAt),
  estado: device => stateLabel(device)
};

export function sortDevices(devices: Device[], key: SortKey | 'operational', dir: 'asc' | 'desc' = 'asc') {
  const value = key === 'operational' ? operationalKey : SORT_VALUE[key];
  const factor = dir === 'asc' ? 1 : -1;
  return devices
    .map(device => ({ device, value: value(device) }))
    .sort((a, b) => {
      const emptyA = !a.value;
      const emptyB = !b.value;
      if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
      return collator.compare(a.value, b.value) * factor;
    })
    .map(item => item.device);
}

export function aliasOf(device: Device) {
  return getOperationalAlias(device) || device.dispositivo || device.etiqueta;
}

export function typeOf(device: Device) {
  return classifyDeviceType(device);
}

/** Escapa texto para el HTML imprimible de los QR. */
export function escapeHtml(value: string) {
  return String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char));
}
