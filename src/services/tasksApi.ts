import type { TaskItem } from '../types';
import { apiGet, apiSend } from './apiClient';

export const getTasks = () => apiGet<{ ok: true; items: TaskItem[]; loadedAt: string }>('/api/tasks');
export const getTaskHistory = () => apiGet<{ ok: true; items: unknown[] }>('/api/tasks/history');
export const getTaskAnalytics = () => apiGet<{ ok: true; assistants: unknown[] }>('/api/tasks/analytics');
export const createTask = (payload: Partial<TaskItem> & { operator: string }) => apiSend<{ ok: true; item: TaskItem }>('/api/tasks', 'POST', payload);
export const updateTask = (id: string, payload: Partial<TaskItem> & { operator: string }) => apiSend<{ ok: true; item: TaskItem }>(`/api/tasks/${id}`, 'PATCH', payload);
export const deleteTask = (id: string, operator: string) => apiSend<{ ok: true; id: string }>(`/api/tasks/${id}`, 'DELETE', { operator });
