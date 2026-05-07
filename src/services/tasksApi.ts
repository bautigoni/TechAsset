import type { TaskChecklistItem, TaskItem } from '../types';
import { apiGet, apiSend } from './apiClient';

export const getTasks = () => apiGet<{ ok: true; items: TaskItem[]; loadedAt: string }>('/api/tasks');
export const getTaskHistory = () => apiGet<{ ok: true; items: unknown[] }>('/api/tasks/history');
export const getTaskAnalytics = () => apiGet<{ ok: true; assistants: unknown[] }>('/api/tasks/analytics');
export const createTask = (payload: Partial<TaskItem> & { operator: string }) => apiSend<{ ok: true; item: TaskItem }>('/api/tasks', 'POST', payload);
export const updateTask = (id: string, payload: Partial<TaskItem> & { operator: string }) => apiSend<{ ok: true; item: TaskItem }>(`/api/tasks/${id}`, 'PATCH', payload);
export const deleteTask = (id: string, operator: string) => apiSend<{ ok: true; id: string }>(`/api/tasks/${id}`, 'DELETE', { operator });
export const createTaskItem = (taskId: string, payload: { texto: string; operator: string }) =>
  apiSend<{ ok: true; item: TaskChecklistItem }>(`/api/tasks/${taskId}/items`, 'POST', payload);
export const updateTaskItem = (taskId: string, itemId: number, payload: Partial<TaskChecklistItem> & { operator: string }) =>
  apiSend<{ ok: true; item: TaskChecklistItem }>(`/api/tasks/${taskId}/items/${itemId}`, 'PATCH', payload);
export const deleteTaskItem = (taskId: string, itemId: number, operator: string) =>
  apiSend<{ ok: true; deleted: boolean }>(`/api/tasks/${taskId}/items/${itemId}`, 'DELETE', { operator });
