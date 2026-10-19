/**
 * Reglas de la Agenda TIC sin React: fechas en hora argentina, qué actividad
 * cae en qué día, estados, conteos que filtran, tope por tipo y exportaciones.
 * La regla de capacidad es la misma que `agendaCapacityConflict` del server
 * (server/routes/agenda.routes.js): si cambia una, cambiar la otra.
 */
import type { AgendaItem, AgendaState } from '../../types';
import type { StatusTextTone } from '../../ui';
import { APP_TIME_ZONE, addDaysToKey, dateFormatter, nowMinutesAr, todayKeyAr, weekdayOfKey } from '../../utils/formatters';

export const WEEK_DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'] as const;
/** Índice = getUTCDay (0 = domingo). */
export const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export const DAY_SHORT: Record<string, string> = { Lunes: 'Lun', Martes: 'Mar', 'Miércoles': 'Mié', Jueves: 'Jue', Viernes: 'Vie', 'Sábado': 'Sáb', Domingo: 'Dom' };
export const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const CAPACITY: Record<string, number> = { touch: 25, tic: 99, plani: 99, dell: 99 };
export const DEVICE_TYPES = ['Touch', 'Plani', 'TIC', 'Dell'];
/** Módulos horarios del colegio (los que usan las actividades cargadas). */
export const MODULES: Array<[string, string]> = [['08:15', '09:05'], ['09:05', '09:55'], ['10:10', '11:00'], ['11:00', '11:45'], ['13:30', '14:15'], ['14:35', '15:25'], ['15:25', '16:20']];
export const FREQUENT_FALLBACK = ['Glifing', 'Matific', 'Programación', 'Reserva Touch', 'TIC Grupo completo'];
const NOT_COUNTED = new Set<AgendaState>(['Cancelado', 'Realizado']);
const FINISHED = new Set<AgendaState>(['Cancelado', 'Realizado']);

const SHORT_DT: Intl.DateTimeFormatOptions = { timeZone: APP_TIME_ZONE, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
/** "11/05 16:21" en hora argentina ('' si no es una fecha). */
export function shortDateTime(value: string | undefined | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = Object.fromEntries(dateFormatter(SHORT_DT).formatToParts(date).map(part => [part.type, part.value]));
  return `${String(parts.day).padStart(2, '0')}/${String(parts.month).padStart(2, '0')} ${parts.hour}:${parts.minute}`;
}

export const cap1 =(text: string) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

export function fold(value: unknown) {
  return String(value ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

export function toMin(value: string | undefined | null) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Solapamiento estricto en minutos (igual que el server: lo inválido cuenta como 0). */
export function overlaps(a: { desde: string; hasta: string }, b: { desde: string; hasta: string }) {
  return (toMin(a.desde) ?? 0) < (toMin(b.hasta) ?? 0) && (toMin(b.desde) ?? 0) < (toMin(a.hasta) ?? 0);
}

/* ── Reloj (hora argentina) ─────────────────────────────────────────────── */

export type Clock = { today: string; now: number; weekday: number; todayName: string; time: string };

export function readClock(): Clock {
  const today = todayKeyAr();
  const now = nowMinutesAr();
  const weekday = weekdayOfKey(today);
  return { today, now, weekday, todayName: DAY_NAMES[weekday], time: `${String(Math.floor(now / 60)).padStart(2, '0')}:${String(now % 60).padStart(2, '0')}` };
}

/** 1 = lunes … 7 = domingo; 0 si el texto no es un día. */
export function weekdayIndex(dia: string) {
  const text = fold(dia);
  if (text.startsWith('lun')) return 1;
  if (text.startsWith('mar')) return 2;
  if (text.startsWith('mie')) return 3;
  if (text.startsWith('jue')) return 4;
  if (text.startsWith('vie')) return 5;
  if (text.startsWith('sab')) return 6;
  if (text.startsWith('dom')) return 7;
  return 0;
}

const isoWeekday = (iso: string) => weekdayOfKey(iso) || 7;

/**
 * Lunes de la semana que se muestra: la actual de lunes a viernes; el sábado y
 * el domingo ya se mira la que viene (antes el domingo quedaba todo vacío).
 */
export function referenceMonday(today: string) {
  const wd = weekdayOfKey(today);
  if (wd === 0) return addDaysToKey(today, 1);
  if (wd === 6) return addDaysToKey(today, 2);
  return addDaysToKey(today, 1 - wd);
}

export function dateOfWeekday(dia: string, monday: string) {
  const index = weekdayIndex(dia);
  return index ? addDaysToKey(monday, index - 1) : '';
}

export const dayNameOfDate = (iso: string) => DAY_NAMES[weekdayOfKey(iso)];

/** Fecha en la que se dibuja en el Mes: la propia o la de la semana que se muestra. */
export function itemDate(item: AgendaItem, monday: string) {
  return item.fecha || dateOfWeekday(item.dia, monday);
}

/** ¿Cae en esa fecha? Las de fecha, ese día; las semanales, todos los días de su nombre. */
export function occursOn(item: AgendaItem, iso: string) {
  if (item.fecha) return item.fecha === iso;
  return weekdayIndex(item.dia) === isoWeekday(iso);
}

/** "viernes 16 de octubre" */
export function longDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  return `${dayNameOfDate(iso).toLowerCase()} ${d} de ${MONTHS[m - 1]}`;
}

/** "Semana del 12 al 16 de octubre" */
export function weekRangeLabel(monday: string) {
  const friday = addDaysToKey(monday, 4);
  const [, m1, d1] = monday.split('-').map(Number);
  const [, m2, d2] = friday.split('-').map(Number);
  return m1 === m2 ? `Semana del ${d1} al ${d2} de ${MONTHS[m2 - 1]}` : `Semana del ${d1} de ${MONTHS[m1 - 1]} al ${d2} de ${MONTHS[m2 - 1]}`;
}

/* ── Turno, orden, estado ───────────────────────────────────────────────── */

export type TurnoFilter = 'Completo' | 'Mañana' | 'Tarde';

export function displayTurno(value: string) {
  const text = fold(value);
  if (text === 'manana') return 'Mañana';
  if (text === 'tarde') return 'Tarde';
  return value || 'Sin turno';
}

export function matchesTurno(item: AgendaItem, turno: TurnoFilter) {
  return turno === 'Completo' || fold(item.turno) === fold(turno);
}

export const byTime = (a: AgendaItem, b: AgendaItem) => `${a.desde}${a.curso}`.localeCompare(`${b.desde}${b.curso}`);

export const isFinished = (item: AgendaItem) => FINISHED.has(item.estado);

export function isVencida(item: AgendaItem, clock: Clock) {
  if (item.estado !== 'Pendiente' || !item.fecha) return false;
  if (item.fecha < clock.today) return true;
  return item.fecha === clock.today && (toMin(item.hasta) ?? 1440) < clock.now;
}

export function isEnCurso(item: AgendaItem, clock: Clock) {
  if (isFinished(item) || !occursOn(item, clock.today)) return false;
  const from = toMin(item.desde);
  const to = toMin(item.hasta);
  return from !== null && to !== null && clock.now >= from && clock.now < to;
}

export function statusOf(item: AgendaItem, clock: Clock): { label: string; tone: StatusTextTone } {
  if (isVencida(item, clock)) return { label: 'Vencida', tone: 'bad' };
  if (item.estado === 'Entregado') return { label: 'Entregado', tone: 'info' };
  if (item.estado === 'Faltaron equipos') return { label: 'Faltaron equipos', tone: 'warn' };
  if (item.estado === 'Realizado') return { label: 'Realizada', tone: 'muted' };
  if (item.estado === 'Cancelado') return { label: 'Cancelada', tone: 'muted' };
  return { label: 'Pendiente', tone: 'normal' };
}

export function retiredInfo(item: AgendaItem) {
  const retired = Number(item.compusRetiradas || 0);
  const expected = Number(item.cantidad || 0);
  const canRetire = item.estado === 'Entregado' || item.estado === 'Realizado';
  const all = retired > 0 && retired >= expected;
  const text = retired > 0 ? `Retiradas ${retired}/${expected}` : canRetire ? 'Sin retirar' : '';
  const tone: StatusTextTone = retired > 0 && !all ? 'warn' : retired > 0 ? 'normal' : 'muted';
  return { retired, expected, canRetire, all, text, tone };
}

export const shortLabel = (item: AgendaItem) => `${item.curso || 'Sin curso'} · ${item.actividad || 'Actividad'} (${item.fecha ? item.fecha.split('-').reverse().slice(0, 2).join('/') : DAY_SHORT[item.dia] || item.dia} ${item.desde})`;

/* ── Conteos que filtran ────────────────────────────────────────────────── */

export type KpiKey = 'total' | 'pend' | 'ent' | 'real' | 'venc' | 'plani' | 'tic';

export const KPI_DEFS: Array<{ key: KpiKey; label: string; sum?: boolean; test: (item: AgendaItem, clock: Clock) => boolean }> = [
  { key: 'total', label: 'Actividades', test: () => true },
  { key: 'pend', label: 'Pendientes', test: item => item.estado === 'Pendiente' },
  { key: 'ent', label: 'Entregadas', test: item => item.estado === 'Entregado' },
  { key: 'real', label: 'Realizadas', test: item => item.estado === 'Realizado' },
  { key: 'venc', label: 'Vencidas', test: isVencida },
  // Por tipo de equipo (antes el filtro miraba también el nombre de la
  // actividad y "Matific" caía en TIC).
  { key: 'plani', label: 'Plani requeridas', sum: true, test: item => /plani/i.test(item.tipoDispositivo) },
  { key: 'tic', label: 'TIC requeridas', sum: true, test: item => /tic/i.test(item.tipoDispositivo) }
];

export function kpiCounts(items: AgendaItem[], clock: Clock) {
  const out = {} as Record<KpiKey, number>;
  for (const def of KPI_DEFS) {
    const list = items.filter(item => def.test(item, clock));
    out[def.key] = def.sum ? list.reduce((sum, item) => sum + Number(item.cantidad || 0), 0) : list.length;
  }
  return out;
}

export function applyKpi(items: AgendaItem[], kpi: KpiKey | null, clock: Clock) {
  if (!kpi || kpi === 'total') return items;
  const def = KPI_DEFS.find(entry => entry.key === kpi);
  return def ? items.filter(item => def.test(item, clock)) : items;
}

/* ── Capacidad por tipo ─────────────────────────────────────────────────── */

export const capacityFor = (tipo: string) => CAPACITY[fold(tipo)] ?? null;

export type CapacityDraft = Pick<AgendaItem, 'dia' | 'desde' | 'hasta' | 'tipoDispositivo' | 'cantidad'> & { id?: string; fecha?: string; estado?: AgendaState };

/** Lo que ya ocupa ese tipo en esa franja (sin contar la propia actividad). */
export function capacityUsage(items: AgendaItem[], draft: CapacityDraft, today: string) {
  const max = capacityFor(draft.tipoDispositivo);
  const day = draft.fecha ? isoWeekday(draft.fecha) : weekdayIndex(draft.dia);
  const sameDay = (row: AgendaItem) => {
    if (draft.fecha) return row.fecha ? row.fecha === draft.fecha : weekdayIndex(row.dia) === day;
    if (!row.fecha) return weekdayIndex(row.dia) === day;
    return row.fecha >= today && isoWeekday(row.fecha) === day;
  };
  const users = items.filter(row => row.id !== draft.id
    && fold(row.tipoDispositivo) === fold(draft.tipoDispositivo)
    && !NOT_COUNTED.has(row.estado)
    && sameDay(row)
    && overlaps(row, draft));
  const used = users.reduce((sum, row) => sum + Number(row.cantidad || 0), 0);
  const counted = draft.estado && NOT_COUNTED.has(draft.estado) ? 0 : Number(draft.cantidad || 0);
  return { max, used, users, libres: max === null ? null : max - used, conflict: max !== null && used + counted > max };
}

/** Franjas de un tipo en una fecha: cuántas quedan libres en cada una. */
export function slotsOfDay(items: AgendaItem[], iso: string, tipo = 'Touch') {
  const max = capacityFor(tipo) ?? 0;
  const day = items.filter(item => fold(item.tipoDispositivo) === fold(tipo) && !NOT_COUNTED.has(item.estado) && occursOn(item, iso)).sort(byTime);
  const seen = new Set<string>();
  const out: Array<{ key: string; libres: number; max: number; users: AgendaItem[] }> = [];
  for (const item of day) {
    const key = `${item.desde}–${item.hasta}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const users = day.filter(other => overlaps(other, item));
    const used = users.reduce((sum, other) => sum + Number(other.cantidad || 0), 0);
    out.push({ key, libres: max - used, max, users });
  }
  return out;
}

/** Las actividades más cargadas (para los atajos del alta). */
export function frequentActivities(items: AgendaItem[], count = 5) {
  const tally = new Map<string, number>();
  for (const item of items) {
    const name = String(item.actividad || '').trim();
    if (name) tally.set(name, (tally.get(name) || 0) + 1);
  }
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es')).map(([name]) => name).slice(0, count);
  return top.length ? top : FREQUENT_FALLBACK;
}

/* ── Exportar ───────────────────────────────────────────────────────────── */

/** Mismo formato de siempre: "dia desde-hasta | curso | actividad | cantidad tipo | estado". */
export function summaryText(items: AgendaItem[]) {
  return items.map(item => `${item.dia} ${item.desde}-${item.hasta} | ${item.curso} | ${item.actividad} | ${item.cantidad} ${item.tipoDispositivo} | ${item.estado}`).join('\n');
}

/** Mismas columnas de siempre; `fecha` se suma al final (vacía en las semanales). */
export function csvRows(items: AgendaItem[]) {
  const headers = ['dia', 'turno', 'desde', 'hasta', 'curso', 'actividad', 'tipo', 'cantidad', 'ubicacion', 'estado', 'nota', 'fecha'];
  return [headers, ...items.map(item => [item.dia, item.turno, item.desde, item.hasta, item.curso, item.actividad, item.tipoDispositivo, item.cantidad, item.ubicacion, item.estado, item.nota || '', item.fecha || ''])];
}
