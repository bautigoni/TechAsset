import { apiGet, apiSend } from './apiClient';

export type RosterPerson = { id?: number; nombre: string; tipo: 'docente' | 'alumno'; curso: string };
export type RosterCounts = { total: number; docentes: number; alumnos: number };

export const getRoster = () => apiGet<{ ok: true; items: RosterPerson[]; counts: RosterCounts }>('/api/people-roster');

export const previewRoster = (text: string, tipo: 'docente' | 'alumno') =>
  apiSend<{ ok: true; items: RosterPerson[]; total: number }>('/api/people-roster/preview', 'POST', { text, tipo });

export const importRoster = (payload: { text: string; tipo: 'docente' | 'alumno'; mode: 'agregar' | 'reemplazar'; replaceTipo?: 'docente' | 'alumno' | 'todos' }) =>
  apiSend<{ ok: true; added: number; updated: number; removed: number; items: RosterPerson[] } & RosterCounts>('/api/people-roster/import', 'POST', payload);

export const deleteRosterPerson = (id: number) => apiSend<{ ok: true; counts: RosterCounts }>(`/api/people-roster/${id}`, 'DELETE');
