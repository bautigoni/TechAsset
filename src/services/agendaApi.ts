import type { AgendaItem } from '../types';
import { apiGet, apiSend } from './apiClient';

/** all=true trae también las terminadas viejas (por defecto el server las omite). */
export const getAgenda = (all = false) => apiGet<{ ok: true; items: AgendaItem[]; olderHidden?: number; loadedAt: string }>(all ? '/api/agenda?all=1' : '/api/agenda');
export const getAgendaHistory = () => apiGet<{ ok: true; items: unknown[] }>('/api/agenda/history');
export const createAgenda = (payload: Partial<AgendaItem> & { operator: string }) => apiSend<{ ok: true; item: AgendaItem }>('/api/agenda', 'POST', payload);
export const updateAgenda = (id: string, payload: Partial<AgendaItem> & { operator: string }) => apiSend<{ ok: true; item: AgendaItem }>(`/api/agenda/${id}`, 'PATCH', payload);
export const deleteAgenda = (id: string, operator: string) => apiSend<{ ok: true; id: string }>(`/api/agenda/${id}`, 'DELETE', { operator });
export const getAgendaCalendarFeed = () => apiGet<{ ok: true; siteCode: string; feedUrl: string; token: string }>('/api/agenda/calendar-feed');
export const rotateAgendaCalendarFeed = () => apiSend<{ ok: true; siteCode: string; feedUrl: string; token: string }>('/api/agenda/calendar-feed/rotate', 'POST');
