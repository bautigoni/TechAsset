import type { AgendaItem } from '../types';
import { apiGet, apiSend } from './apiClient';

/** Una fila de `agenda_history` con los datos de su actividad (aunque esté borrada). */
export interface AgendaHistoryEntry {
  id: number;
  agenda_id: string;
  timestamp: string;
  accion: string;
  estado_anterior: string;
  estado_nuevo: string;
  nota: string;
  operador: string;
  curso?: string | null;
  actividad?: string | null;
  dia?: string | null;
  fecha?: string | null;
  desde?: string | null;
  hasta?: string | null;
}

/** all=true trae también las terminadas viejas (por defecto el server las omite). */
export const getAgenda = (all = false) => apiGet<{ ok: true; items: AgendaItem[]; olderHidden?: number; loadedAt: string }>(all ? '/api/agenda?all=1' : '/api/agenda');
export const getAgendaHistory = (limit = 200) => apiGet<{ ok: true; items: AgendaHistoryEntry[] }>(`/api/agenda/history?limit=${limit}`);
export const createAgenda = (payload: Partial<AgendaItem> & { operator: string }) => apiSend<{ ok: true; item: AgendaItem }>('/api/agenda', 'POST', payload);
export const updateAgenda = (id: string, payload: Partial<AgendaItem> & { operator: string }) => apiSend<{ ok: true; item: AgendaItem }>(`/api/agenda/${id}`, 'PATCH', payload);
export const deleteAgenda = (id: string, operator: string) => apiSend<{ ok: true; id: string }>(`/api/agenda/${id}`, 'DELETE', { operator });
/** Deshacer de Borrar (el borrado es lógico). */
export const restoreAgenda = (id: string, operator: string) => apiSend<{ ok: true; item: AgendaItem }>(`/api/agenda/${id}/restore`, 'POST', { operator });
export const getAgendaCalendarFeed = () => apiGet<{ ok: true; siteCode: string; feedUrl: string; token: string }>('/api/agenda/calendar-feed');
export const rotateAgendaCalendarFeed = () => apiSend<{ ok: true; siteCode: string; feedUrl: string; token: string }>('/api/agenda/calendar-feed/rotate', 'POST');
