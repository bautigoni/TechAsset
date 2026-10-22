import { todayKeyAr } from './formatters';
import { formatDdMm } from './taskDate';

/**
 * Vencimiento de una tarea, UNA sola regla para toda la app (tablero, ficha
 * de la tarea e Inicio). Se compara el día (AAAA-MM-DD) contra HOY en hora
 * argentina: una tarea que vence hoy "vence hoy" hasta que termina el día.
 * Antes el Inicio comparaba `new Date('2026-10-22')` (medianoche UTC = 21 h
 * del día anterior en Argentina) contra la hora actual y decía "venció el
 * 22/10" el mismo 22 (QA ronda 1, ítem 18).
 *
 *   "Vence 21/10" · "Vence hoy" (ámbar) · "Venció 12/10" (rojo) · hecha: apagado.
 */
export type TaskDue = { text: string; tone: 'normal' | 'muted' | 'warn' | 'bad'; overdue: boolean; today: boolean };

export function taskDue(fechaVencimiento: string | null | undefined, done = false, today = todayKeyAr()): TaskDue | null {
  const raw = String(fechaVencimiento || '').trim();
  if (!raw) return null;
  const iso = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return { text: `Vence ${raw}`, tone: 'normal', overdue: false, today: false };
  const label = formatDdMm(iso);
  if (done) return { text: `Vence ${label}`, tone: 'muted', overdue: false, today: false };
  if (iso < today) return { text: `Venció ${label}`, tone: 'bad', overdue: true, today: false };
  if (iso === today) return { text: 'Vence hoy', tone: 'warn', overdue: false, today: true };
  return { text: `Vence ${label}`, tone: 'normal', overdue: false, today: false };
}
