import type { AgendaItem } from '../types';
import { apiGet, apiSend } from './apiClient';

export const getAgenda = () => apiGet<{ ok: true; items: AgendaItem[]; loadedAt: string }>('/api/agenda');
export const getAgendaHistory = () => apiGet<{ ok: true; items: unknown[] }>('/api/agenda/history');
export const createAgenda = (payload: Partial<AgendaItem> & { operator: string }) => apiSend<{ ok: true; item: AgendaItem }>('/api/agenda', 'POST', payload);
export const updateAgenda = (id: string, payload: Partial<AgendaItem> & { operator: string }) => apiSend<{ ok: true; item: AgendaItem }>(`/api/agenda/${id}`, 'PATCH', payload);
export const deleteAgenda = (id: string, operator: string) => apiSend<{ ok: true; id: string }>(`/api/agenda/${id}`, 'DELETE', { operator });
