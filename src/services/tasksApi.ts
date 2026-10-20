import type { TaskChecklistItem, TaskColumn, TaskComment, TaskItem } from '../types';
import { apiGet, apiSend } from './apiClient';

export type TaskHistoryEntry = { id: number; task_id: string; timestamp: string; titulo: string; accion: string; responsable: string; estado_anterior: string; estado_nuevo: string; comentario: string; operador: string };

export const getTasks = (space: 'all' | 'my' | 'team' = 'all') => apiGet<{ ok: true; items: TaskItem[]; loadedAt: string }>(`/api/tasks?space=${space}`);
export const getTaskColumns = () => apiGet<{ ok: true; items: TaskColumn[] }>('/api/task-columns');
export const createTaskColumn = (payload: Partial<TaskColumn>) => apiSend<{ ok: true; item: TaskColumn }>('/api/task-columns', 'POST', payload);
export const updateTaskColumn = (id: number, payload: Partial<TaskColumn>) => apiSend<{ ok: true; item: TaskColumn }>(`/api/task-columns/${id}`, 'PATCH', payload);
export const reorderTaskColumns = (ids: number[]) => apiSend<{ ok: true; items: TaskColumn[] }>('/api/task-columns/reorder', 'PATCH', { ids });
export const deleteTaskColumn = (id: number) => apiSend<{ ok: true; deleted: boolean; fallback?: TaskColumn }>(`/api/task-columns/${id}`, 'DELETE');
/** Deshacer de "Eliminar columna": la prende, le devuelve sus tareas y el orden de antes. */
export const restoreTaskColumn = (id: number, payload: { taskIds: string[]; ids: number[] }) => apiSend<{ ok: true; items: TaskColumn[] }>(`/api/task-columns/${id}/restore`, 'POST', payload);
export const getTaskComments = (taskId: string) => apiGet<{ ok: true; items: TaskComment[] }>(`/api/tasks/${taskId}/comments`);
export const createTaskComment = (taskId: string, body: string) => apiSend<{ ok: true; item: TaskComment }>(`/api/tasks/${taskId}/comments`, 'POST', { body });
export const uploadTaskAttachment = (payload: { name: string; mimeType: string; base64: string }) => apiSend<{ ok: true; attachment: { name: string; url: string; mimeType: string } }>('/api/tasks/upload', 'POST', payload);
/** Actividad: con `taskId`, la de esa tarea (últimas 50); sin él, la de la sede. */
export const getTaskHistory = (taskId?: string) => apiGet<{ ok: true; items: TaskHistoryEntry[] }>(`/api/tasks/history${taskId ? `?taskId=${encodeURIComponent(taskId)}` : ''}`);
export const createTask = (payload: Partial<TaskItem> & { operator: string }) => apiSend<{ ok: true; item: TaskItem }>('/api/tasks', 'POST', payload);
export const updateTask = (id: string, payload: Partial<TaskItem> & { operator: string }) => apiSend<{ ok: true; item: TaskItem }>(`/api/tasks/${id}`, 'PATCH', payload);
export const deleteTask = (id: string, operator: string) => apiSend<{ ok: true; id: string }>(`/api/tasks/${id}`, 'DELETE', { operator });
/** Deshacer de un borrado (el borrado es blando). */
export const restoreTask = (id: string, operator: string) => apiSend<{ ok: true; item: TaskItem }>(`/api/tasks/${id}/restore`, 'POST', { operator });
export const createTaskItem = (taskId: string, payload: { texto: string; operator: string }) =>
  apiSend<{ ok: true; item: TaskChecklistItem }>(`/api/tasks/${taskId}/items`, 'POST', payload);
export const updateTaskItem = (taskId: string, itemId: number, payload: Partial<TaskChecklistItem> & { operator: string }) =>
  apiSend<{ ok: true; item: TaskChecklistItem }>(`/api/tasks/${taskId}/items/${itemId}`, 'PATCH', payload);
export const deleteTaskItem = (taskId: string, itemId: number, operator: string) =>
  apiSend<{ ok: true; deleted: boolean }>(`/api/tasks/${taskId}/items/${itemId}`, 'DELETE', { operator });
