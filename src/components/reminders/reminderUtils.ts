import type { Reminder } from '../../types';
import { APP_TIME_ZONE, addDaysToKey, dateFormatter, dayKeyAr, weekdayOfKey } from '../../utils/formatters';

/** Lo que el server suma a cada recordatorio para la pantalla. */
export type ReminderRow = Reminder & {
  completedBy?: string;
  notificationSentAt?: string;
  /** Tuyo: sos el responsable (o lo creaste sin responsable). */
  mine?: boolean;
  /** Lo podés completar/posponer/editar/borrar. */
  canEdit?: boolean;
};

export const PRIORITIES = ['Baja', 'Media', 'Alta', 'Urgente'] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Mismos tipos que el server (`RELATED` en reminders.routes.js), con su nombre legible. */
export const RELATED_TYPES: Array<{ value: string; label: string; placeholder: string }> = [
  { value: 'device', label: 'Dispositivo', placeholder: 'Ej. D1436' },
  { value: 'classroom', label: 'Aula', placeholder: 'Ej. pp_6F' },
  { value: 'ticket', label: 'Ticket', placeholder: 'Ej. 1520' },
  { value: 'loan', label: 'Préstamo', placeholder: 'Ej. D1436' },
  { value: 'task', label: 'Tarea', placeholder: 'Id de la tarea' },
  { value: 'purchase', label: 'Compra', placeholder: 'Id de la compra' },
  { value: 'suggestion', label: 'Sugerencia', placeholder: 'Id de la sugerencia' },
  { value: 'group', label: 'Grupo de equipos', placeholder: 'Nombre del grupo' },
  { value: 'knowledge', label: 'Artículo', placeholder: 'Id del artículo' }
];

export function relatedTypeLabel(type: string) {
  return RELATED_TYPES.find(item => item.value === type)?.label || type;
}

export function priorityTone(priority: string): 'bad' | 'warn' | 'muted' {
  if (priority === 'Urgente') return 'bad';
  if (priority === 'Alta') return 'warn';
  return 'muted';
}

/* ── Fecha y hora: SIEMPRE hora argentina, sin parsear texto del navegador ──
   El selector trabaja con 'YYYY-MM-DDTHH:mm' (hora de Argentina). Para el
   server se arma un ISO con el offset explícito (-03:00, Argentina no tiene
   horario de verano), que Safari/iPhone parsea bien: nunca `new Date('AAAA-MM-DD HH:mm')`. */

const LOCAL_RX = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const AR_PARTS: Intl.DateTimeFormatOptions = { timeZone: APP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };

export function isValidLocal(value: string) {
  const match = LOCAL_RX.exec(value || '');
  if (!match) return false;
  const [, y, m, d, hh, mm] = match.map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d && hh < 24 && mm < 60;
}

/** 'YYYY-MM-DDTHH:mm' (Argentina) → ISO UTC, o '' si no es válido. */
export function localToIso(value: string) {
  if (!isValidLocal(value)) return '';
  const date = new Date(`${value}:00-03:00`);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

/** Instante → 'YYYY-MM-DDTHH:mm' en hora argentina. */
export function isoToLocal(value: string | number | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = Object.fromEntries(dateFormatter(AR_PARTS, 'en-CA').formatToParts(date).map(part => [part.type, part.value]));
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}`;
}

const pad = (n: number) => String(n).padStart(2, '0');
const DOW = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const DOW_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "hoy 10:30" · "mañana 08:00" · "lun 19/10 08:00" · "lun 19/10/2027 08:00". */
export function formatWhen(iso: string) {
  const local = isoToLocal(iso);
  if (!local) return '—';
  const [day, time] = local.split('T');
  const today = dayKeyAr();
  if (day === today) return `hoy ${time}`;
  if (day === addDaysToKey(today, 1)) return `mañana ${time}`;
  if (day === addDaysToKey(today, -1)) return `ayer ${time}`;
  const [y, m, d] = day.split('-');
  return `${DOW[weekdayOfKey(day)]} ${d}/${m}${y !== today.slice(0, 4) ? `/${y}` : ''} ${time}`;
}

/** "Lunes 19 de octubre · 08:00" para el valor elegido en el formulario. */
export function longWhen(local: string) {
  if (!isValidLocal(local)) return '';
  const [day, time] = local.split('T');
  const [, m, d] = day.split('-').map(Number);
  const name = DOW_LONG[weekdayOfKey(day)];
  return `${name[0].toUpperCase()}${name.slice(1)} ${d} de ${MONTHS[m - 1]} · ${time}`;
}

function span(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h >= 48) return `${Math.round(h / 24)} días`;
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}

/** "venció hace 2 h" (rojo) · "en 40 min" (ámbar si faltan ≤ 3 h hoy) · "mañana" · "en 4 días". */
export function relativeWhen(iso: string, now = Date.now()): { text: string; tone: 'bad' | 'warn' | 'muted' | 'normal' } {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return { text: '', tone: 'muted' };
  const minutes = Math.round((at - now) / 60000);
  if (minutes < 0) return { text: `venció hace ${span(-minutes)}`, tone: 'bad' };
  const day = dayKeyAr(iso);
  const today = dayKeyAr(now);
  if (day === today) return { text: minutes === 0 ? 'ahora' : `en ${span(minutes)}`, tone: minutes <= 180 ? 'warn' : 'normal' };
  if (day === addDaysToKey(today, 1)) return { text: 'mañana', tone: 'muted' };
  const days = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  return { text: `en ${days} días`, tone: 'muted' };
}

export type QuickWhen = { id: string; label: string; sub: string; value: string };

/** Atajos de fecha: en 1 hora, hoy 16:00 (si todavía no pasó), mañana 08:00, el lunes 08:00. */
export function quickWhens(now = Date.now()): QuickWhen[] {
  const out: QuickWhen[] = [];
  const inHour = isoToLocal(new Date(Math.ceil((now + 3600000) / 300000) * 300000));
  out.push({ id: 'h1', label: 'En 1 hora', sub: formatWhen(localToIso(inHour)), value: inHour });
  const today = dayKeyAr(now);
  const nowLocal = isoToLocal(now);
  if (nowLocal < `${today}T15:00`) out.push({ id: 'pm', label: 'Hoy a la tarde', sub: '16:00', value: `${today}T16:00` });
  const tomorrow = addDaysToKey(today, 1);
  out.push({ id: 'tm', label: 'Mañana', sub: `${DOW[weekdayOfKey(tomorrow)]} 08:00`, value: `${tomorrow}T08:00` });
  const wd = weekdayOfKey(today);
  const toMonday = ((8 - wd) % 7) || 7;
  const monday = addDaysToKey(today, toMonday);
  if (monday !== tomorrow) {
    const [, m, d] = monday.split('-');
    out.push({ id: 'mo', label: 'El lunes', sub: `${d}/${m} 08:00`, value: `${monday}T08:00` });
  }
  return out;
}

/** La próxima hora en punto (hora argentina): valor inicial de "Elegir fecha". */
export function nextHourLocal(now = Date.now()) {
  return isoToLocal(new Date(Math.floor(now / 3600000) * 3600000 + 3600000));
}

export { pad };
