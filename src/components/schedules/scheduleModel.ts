import type { RecessGroup, RecessSlot, SchoolLevel, TeacherScheduleEntry } from '../../types';
import { nowMinutesAr, todayKeyAr, weekdayOfKey } from '../../utils/formatters';

export const DAY_NAMES = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const DAY_SHORT = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
export const LEVELS: Array<{ value: SchoolLevel; label: string; short: string }> = [
  { value: 'primary_first', label: 'Primaria · 1er ciclo', short: '1er ciclo' },
  { value: 'primary_second', label: 'Primaria · 2do ciclo', short: '2do ciclo' },
  { value: 'secondary', label: 'Secundaria', short: 'Secundaria' }
];
/** Módulos del colegio (mismos que en la Agenda). */
export const MODULES: Array<[string, string]> = [['08:15', '09:05'], ['09:05', '09:55'], ['10:10', '11:00'], ['11:00', '11:45'], ['13:30', '14:15'], ['14:35', '15:25'], ['15:25', '16:20']];

export const levelLabel = (level: SchoolLevel) => LEVELS.find(entry => entry.value === level)?.label || LEVELS[0].label;

export function fold(value: unknown) {
  return String(value ?? '').toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

export function toMin(value: string | undefined) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Hora del colegio (Argentina): 1 = lunes … 7 = domingo y minutos desde la medianoche. */
export type SchoolClock = { day: number; now: number; time: string };
export function readSchoolClock(): SchoolClock {
  const now = nowMinutesAr();
  return { day: weekdayOfKey(todayKeyAr()) || 7, now, time: `${String(Math.floor(now / 60)).padStart(2, '0')}:${String(now % 60).padStart(2, '0')}` };
}

/** Misma regla que el server (`current` de GET /teacher-schedules): día y franja [inicio, fin). */
export function isNow(entry: TeacherScheduleEntry, clock: SchoolClock) {
  const from = toMin(entry.startTime);
  const to = toMin(entry.endTime);
  return entry.dayOfWeek === clock.day && from !== null && to !== null && clock.now >= from && clock.now < to;
}

export function scheduleShort(entry: Pick<TeacherScheduleEntry, 'teacher' | 'course' | 'dayOfWeek' | 'startTime'>) {
  return `${entry.teacher} · ${entry.course} (${DAY_SHORT[entry.dayOfWeek] || ''} ${entry.startTime})`;
}

export function matchesSearch(entry: TeacherScheduleEntry, needle: string) {
  if (!needle) return true;
  return [entry.teacher, entry.course, entry.subject, entry.room, DAY_NAMES[entry.dayOfWeek]].some(value => fold(value).includes(needle));
}

/** "1 h 5 min", "12 min". */
export function durationText(minutes: number) {
  if (minutes >= 60) {
    const rest = minutes % 60;
    return `${Math.floor(minutes / 60)} h${rest ? ` ${rest} min` : ''}`;
  }
  return `${minutes} min`;
}

export const slotValid = (slot: Pick<RecessSlot, 'startTime' | 'endTime'>) => {
  const from = toMin(slot.startTime);
  const to = toMin(slot.endTime);
  return /^\d{2}:\d{2}$/.test(slot.startTime) && /^\d{2}:\d{2}$/.test(slot.endTime) && from !== null && to !== null && from < to;
};

/** Recreo en curso o el próximo de hoy (de lunes a viernes), con lo guardado. */
export function recessNow(groups: RecessGroup[], clock: SchoolClock) {
  if (clock.day > 5) return { weekend: true, active: [], next: null };
  const slots = groups.flatMap(group => group.slots.filter(slotValid).map(slot => ({ group: group.name || 'Sin nombre', slot, from: toMin(slot.startTime)!, to: toMin(slot.endTime)! })));
  const active = slots.filter(entry => clock.now >= entry.from && clock.now < entry.to);
  const next = slots.filter(entry => entry.from > clock.now).sort((a, b) => a.from - b.from)[0] || null;
  return { weekend: false, active, next };
}
