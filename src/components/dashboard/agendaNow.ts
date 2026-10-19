import type { AgendaItem, TaskItem } from '../../types';
import { minutesFromTime } from '../../utils/dates';
import { todayKeyAr, todayWeekdayAr } from '../../utils/formatters';

/*
 * Reglas de "próxima agenda" y "tus tareas" del Inicio. Son las MISMAS que
 * tenía NowPanel (inventario 02 §2), solo separadas de la vista:
 *  - Fuera siempre: Realizado, Cancelado y "Faltaron equipos".
 *  - En curso: de hoy, desde ≤ ahora ≤ hasta, estado Entregado o Pendiente.
 *  - Si no: la próxima de hoy en Pendiente.
 *  - Si no: la próxima futura Pendiente por fecha → día de la semana (relativo
 *    a hoy) → hora.
 *  - "De hoy" = fecha === hoy (hora argentina) o, sin fecha, `dia` == hoy.
 */

const DAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

function fold(value?: string) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function isAgendaToday(item: AgendaItem, today = todayKeyAr()) {
  if (item.fecha) return item.fecha === today;
  return fold(item.dia) === DAYS[todayWeekdayAr()];
}

const isOpenAgenda = (item: AgendaItem) => item.estado !== 'Realizado' && item.estado !== 'Cancelado' && item.estado !== 'Faltaron equipos';

function weekdayRank(day?: string) {
  const idx = DAYS.indexOf(fold(day));
  return idx < 0 ? 99 : (idx - todayWeekdayAr() + 7) % 7;
}

export type AgendaNow = {
  current?: AgendaItem;
  nextToday?: AgendaItem;
  future?: AgendaItem;
  /** La que se muestra primero (en curso, si no la próxima de hoy, si no la próxima futura). */
  main?: AgendaItem;
  /** Las que siguen hoy después de `main` (Pendiente o Entregado, por hora). */
  later: AgendaItem[];
  pendingTodayCount: number;
};

export function agendaNow(agenda: AgendaItem[], nowMinutes: number): AgendaNow {
  const today = todayKeyAr();
  const valid = agenda.filter(isOpenAgenda);
  const todayItems = valid.filter(item => isAgendaToday(item, today));
  const pendingTodayCount = agenda.filter(item => isAgendaToday(item, today) && item.estado === 'Pendiente').length;
  const current = todayItems.find(item => minutesFromTime(item.desde) <= nowMinutes && minutesFromTime(item.hasta) >= nowMinutes && (item.estado === 'Entregado' || item.estado === 'Pendiente'));
  const nextToday = todayItems
    .filter(item => minutesFromTime(item.desde) > nowMinutes && item.estado === 'Pendiente')
    .sort((a, b) => minutesFromTime(a.desde) - minutesFromTime(b.desde))[0];
  const future = valid
    .filter(item => !isAgendaToday(item, today) && (item.fecha ? item.fecha >= today : true) && item.estado === 'Pendiente')
    .sort((a, b) => String(a.fecha || '9999-12-31').localeCompare(String(b.fecha || '9999-12-31')) || weekdayRank(a.dia) - weekdayRank(b.dia) || minutesFromTime(a.desde) - minutesFromTime(b.desde))[0];
  const main = current || nextToday || future;
  const later = todayItems
    .filter(item => item !== main && minutesFromTime(item.desde) > nowMinutes)
    .sort((a, b) => minutesFromTime(a.desde) - minutesFromTime(b.desde))
    .slice(0, 3);
  return { current, nextToday, future, main, later, pendingTodayCount };
}

/* ── Tareas: hasta 2, primero las tuyas ─────────────────────────────────── */

export const isOpenTask = (task: TaskItem) => !task.done && task.estado !== 'Hecha';

function taskScore(task: TaskItem) {
  const priority = task.prioridad === 'Urgente' ? 0 : task.prioridad === 'Media' ? 1 : 2;
  const due = task.fechaVencimiento ? new Date(`${task.fechaVencimiento}T00:00:00`).getTime() : Number.MAX_SAFE_INTEGER;
  return priority * 10_000_000_000 + due;
}

export function isMine(task: TaskItem, operator: string) {
  const name = String(operator || '').trim().toLowerCase();
  if (!name) return false;
  return String(task.responsable || '').toLowerCase().includes(name)
    || (task.responsables || []).some(item => String(item || '').toLowerCase().includes(name));
}

/** Hasta dos tareas tuyas; si no tenés ninguna abierta, la más urgente del equipo. */
export function topTasks(tasks: TaskItem[], operator: string) {
  const open = tasks.filter(isOpenTask);
  const mine = open.filter(task => isMine(task, operator)).sort((a, b) => taskScore(a) - taskScore(b));
  const list = (mine.length ? mine : [...open].sort((a, b) => taskScore(a) - taskScore(b))).slice(0, 2);
  return { list, mine: mine.length > 0, open: open.length };
}
