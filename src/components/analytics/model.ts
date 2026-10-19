import type { Evolution } from '../../services/analyticsApi';
import type { LinePoint } from './kit';

/* Rótulos y cuentas compartidas por las secciones de la Analítica. */

export const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export const DAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
/** Orden de lectura: lunes primero. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export const hh = (hour: number) => String(hour).padStart(2, '0');
export const hourRange = (hour: number) => `${hh(hour)}:00 a ${hh(hour)}:59`;

export function foldText(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

export function monthLong(key: string) {
  const [year, month] = key.split('-').map(Number);
  return `${MONTHS[(month || 1) - 1]} ${year}`;
}

function dayParts(key: string) {
  const date = new Date(`${key}T00:00:00Z`);
  return { date, dd: hh(date.getUTCDate()), mm: hh(date.getUTCMonth() + 1), wd: date.getUTCDay(), yyyy: date.getUTCFullYear() };
}

/** Puntos de línea a partir de la evolución densa del server. */
export function evolutionPoints(evolution: Evolution | undefined): LinePoint[] {
  if (!evolution) return [];
  const { granularity, points } = evolution;
  return points.map((point, index) => {
    if (granularity === 'month') {
      const [year, month] = point.key.split('-').map(Number);
      const first = index === 0 || month === 1;
      return { key: point.key, tick: `${MONTHS_SHORT[month - 1]}${first ? ` ${String(year).slice(2)}` : ''}`, long: monthLong(point.key), value: point.value, prev: point.prev };
    }
    const { dd, mm, wd, yyyy } = dayParts(point.key);
    if (granularity === 'week') return { key: point.key, tick: `${dd}/${mm}`, long: `Semana del ${dd}/${mm}/${yyyy}`, value: point.value, prev: point.prev };
    return { key: point.key, tick: points.length <= 8 ? `${DAY_SHORT[wd]} ${dd}` : `${dd}/${mm}`, long: `${DAY_NAMES[wd]} ${dd}/${mm}/${yyyy}`, value: point.value, prev: point.prev };
  });
}

export const GRAN_LABEL: Record<Evolution['granularity'], string> = { day: 'día', week: 'semana', month: 'mes' };

export function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

const timesFormat = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
const formatTimes = (value: number) => timesFormat.format(value >= 10 ? Math.round(value) : value);

/** Cambio contra el período anterior, en palabras. */
export function versusPrevious(current: number, previous: number) {
  if (!previous) return current ? 'el período anterior no tiene registros' : 'igual que el período anterior';
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return 'igual que el período anterior';
  if (change >= 200) return `${formatTimes(current / previous)} veces lo del período anterior`;
  return `${Math.abs(change)}% ${change > 0 ? 'más' : 'menos'} que el período anterior`;
}

/** Primeras N categorías y el resto agrupado en "Otros" (para que las columnas se lean). */
export function topWithRest<T extends { label: string; value: number }>(rows: T[], limit = 7) {
  const clean = rows.filter(row => row.value > 0);
  if (clean.length <= limit + 1) return { shown: clean, rest: null as null | { count: number; value: number } };
  const shown = clean.slice(0, limit);
  const others = clean.slice(limit);
  return { shown, rest: { count: others.length, value: sum(others.map(row => row.value)) } };
}

/** Reparte el ancho de una fila de tarjetas entre las que tienen datos (sin huecos). */
export function rowSpans<K extends string>(designed: Array<[K, number]>, present: (key: K) => boolean): Array<[K, number]> {
  const kept = designed.filter(([key]) => present(key));
  if (!kept.length) return [];
  if (kept.length === 1) return [[kept[0][0], 12]];
  const total = sum(kept.map(([, span]) => span));
  let used = 0;
  return kept.map(([key, span], index) => {
    const next = index === kept.length - 1 ? 12 - used : Math.max(3, Math.round((span / total) * 12));
    used += next;
    return [key, next];
  });
}
