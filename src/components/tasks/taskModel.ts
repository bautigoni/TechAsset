import type { TaskColumn, TaskItem } from '../../types';
import { normalizeText, todayKeyAr } from '../../utils/formatters';
import { formatDdMm } from '../../utils/taskDate';

/** Cuántas tarjetas se dibujan por columna antes de "Ver N más". */
export const PAGE_SIZE = 8;
/** Subtareas visibles en la tarjeta antes de "Ver N más". */
export const CARD_ITEMS = 5;
export const PRIORITIES = ['Urgente', 'Media', 'Baja'] as const;
export const TURNOS = ['Sin turno', 'Mañana', 'Tarde', 'Todo el día'] as const;
export const TIPOS_BASE = ['Soporte', 'Aula', 'Agenda'];

export type Space = 'team' | 'my';
export type Tab = 'board' | 'priority';

/** Responsables de una tarea: `responsables_json` o el CSV legacy de `responsable`. */
export function responsablesOf(task: Pick<TaskItem, 'responsables' | 'responsable'>): string[] {
  if (task.responsables?.length) return task.responsables.filter(Boolean);
  return String(task.responsable || '').split(',').map(value => value.trim()).filter(Boolean);
}

/** En la tarjeta, la prioridad con su rótulo: "Prioridad baja" (suelto, "Baja" no se entendía). */
export function priorityText(prioridad: string | undefined): string {
  return `Prioridad ${(prioridad || 'Media').toLowerCase()}`;
}

/**
 * En la tarjeta, el turno con su rótulo ("Todo el día" suelto parecía una
 * duración): "Turno mañana", "Turno tarde", "Ambos turnos"; sin turno, nada.
 */
export function turnoText(turno: string | undefined): string {
  const value = String(turno || '').trim();
  if (!value || value === 'Sin turno') return '';
  if (value === 'Todo el día') return 'Ambos turnos';
  return `Turno ${value.toLowerCase()}`;
}

/** "Sin asignar" / "A" / "A y B" / "A, B y C". */
export function joinNames(names: string[]): string {
  const list = names.filter(name => name && name !== 'Sin asignar');
  if (!list.length) return 'Sin asignar';
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(', ')} y ${list[list.length - 1]}`;
}

/** Columna donde cae una tarea: por id; si no tiene, por nombre (estado); si no, la primera. */
export function columnOf(task: TaskItem, columns: TaskColumn[]): TaskColumn | undefined {
  return columns.find(column => column.id === task.columnId)
    || (!task.columnId ? columns.find(column => column.name === task.estado) : undefined)
    || columns.find(column => column.name === task.estado)
    || columns[0];
}

/** Hecha = está en una columna de cierre (lo que dice el server, recalculado en vivo al mover). */
export function isTaskDone(task: TaskItem, columns: TaskColumn[]): boolean {
  const column = columns.find(item => item.id === task.columnId) || (!task.columnId ? columns.find(item => item.name === task.estado) : undefined);
  if (column) return column.isDone;
  return Boolean(task.done) || task.estado === 'Hecha';
}

/**
 * Espacio "Grupo" (antes "Equipo", que en la app también es un dispositivo):
 * todo lo que no es privado. "Mis tareas": mis privadas +
 * las de equipo donde figuro como responsable (por nombre, como siempre). El
 * server ya filtra las privadas ajenas.
 */
export function inSpace(task: TaskItem, space: Space, operator: string): boolean {
  if (space === 'team') return task.visibility !== 'private';
  if (task.visibility === 'private') return true;
  return responsablesOf(task).includes(operator);
}

/** Búsqueda sin tildes: título, descripción, nota, tipo, responsables y subtareas. */
export function matchesQuery(task: TaskItem, query: string): boolean {
  const q = normalizeText(query).trim();
  if (!q) return true;
  const haystack = normalizeText([
    task.titulo, task.descripcion, task.comentario, task.tipo, task.id,
    responsablesOf(task).join(' '),
    (task.items || []).map(item => item.texto).join(' ')
  ].join(' '));
  return q.split(/\s+/).every(part => haystack.includes(part));
}

/** No hechas primero, después las más nuevas (el mismo orden del server). */
export function sortTasks(list: TaskItem[], columns: TaskColumn[]): TaskItem[] {
  return list.slice().sort((a, b) => Number(isTaskDone(a, columns)) - Number(isTaskDone(b, columns)) || String(b.fechaCreacion || '').localeCompare(String(a.fechaCreacion || '')));
}

/** Prioridad para la vista Prioridad: "Alta" (legacy) cuenta como Urgente; lo desconocido, Media. */
export function priorityLane(task: TaskItem): (typeof PRIORITIES)[number] {
  const value = String(task.prioridad || 'Media');
  if (value === 'Urgente' || value === 'Alta') return 'Urgente';
  if (value === 'Baja') return 'Baja';
  return 'Media';
}

export type DueInfo = { text: string; tone: 'normal' | 'muted' | 'warn' | 'bad'; overdue: boolean };

/** "Vence 21/10" · "Vence hoy" (ámbar) · "Venció 12/10" (rojo) · hecha: apagado. */
export function dueInfo(task: TaskItem, done: boolean): DueInfo | null {
  const iso = String(task.fechaVencimiento || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return task.fechaVencimiento ? { text: `Vence ${task.fechaVencimiento}`, tone: 'normal', overdue: false } : null;
  const label = formatDdMm(iso);
  if (done) return { text: `Vence ${label}`, tone: 'muted', overdue: false };
  const today = todayKeyAr();
  if (iso < today) return { text: `Venció ${label}`, tone: 'bad', overdue: true };
  if (iso === today) return { text: 'Vence hoy', tone: 'warn', overdue: false };
  return { text: `Vence ${label}`, tone: 'normal', overdue: false };
}

export function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/* ── URL de la página de la tarea ─────────────────────────────────────────
   /sede/<sede>/tasks            → tablero
   /sede/<sede>/tasks/<id>       → página de la tarea
   /sede/<sede>/tasks/<id>/editar → edición
   App sigue leyendo la vista del primer segmento ("tasks"), así un link de
   mail o notificación a /sede/x/tasks sigue abriendo el tablero. */

export type TaskRoute = { id: string; edit: boolean } | null;

const ROUTE_RX = /^(\/sede\/[^/]+\/tasks)(?:\/([^/]+)(\/editar)?)?\/?$/i;

export function readTaskRoute(): TaskRoute {
  const match = window.location.pathname.match(ROUTE_RX);
  if (!match || !match[2]) return null;
  return { id: decodeURIComponent(match[2]), edit: Boolean(match[3]) };
}

export function taskRouteUrl(route: TaskRoute, site: string): string {
  const base = window.location.pathname.match(ROUTE_RX)?.[1] || `/sede/${site.toLowerCase()}/tasks`;
  if (!route) return base;
  return `${base}/${encodeURIComponent(route.id)}${route.edit ? '/editar' : ''}`;
}
