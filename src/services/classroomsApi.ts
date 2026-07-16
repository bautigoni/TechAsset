import type { Classroom, ClassroomCategory, ClassroomHistoryEntry, ClassroomIncident, ClassroomIncidentSummary, ClassroomSummary } from '../types';
import { apiGet, apiSend } from './apiClient';

export const fetchClassrooms = () => apiGet<{ ok: true; items: Classroom[] }>('/api/classrooms');

export const fetchClassroomSummary = () => apiGet<{ ok: true; summary: ClassroomSummary }>('/api/classrooms/summary');

export const fetchClassroom = (roomKey: string, nombre?: string, piso = 'Planta baja'): Promise<{ ok: boolean; item: Classroom }> => {
  const params = new URLSearchParams();
  if (nombre) params.set('nombre', nombre);
  params.set('piso', piso);
  return apiGet<{ ok: true; item: Classroom }>(`/api/classrooms/${encodeURIComponent(roomKey)}?${params}`);
};

export const updateClassroom = (roomKey: string, payload: Partial<Classroom> & { operator?: string }) =>
  apiSend<{ ok: true; item: Classroom }>(`/api/classrooms/${encodeURIComponent(roomKey)}`, 'PATCH', payload);

export const fetchClassroomHistory = (roomKey: string) => apiGet<{ ok: true; items: ClassroomHistoryEntry[] }>(`/api/classrooms/${encodeURIComponent(roomKey)}/history`);

export const fetchClassroomIncidents = (roomKey: string) => apiGet<{ ok: true; summary: ClassroomIncidentSummary; items: ClassroomIncident[] }>(`/api/classrooms/${encodeURIComponent(roomKey)}/incidents`);
export interface ClassroomHealthReport { score:number; status:string; summary:string; recurringProblems:string[]; positives:string[]; risks:string[]; preventiveActions:string[] }
export const generateClassroomHealth = (roomKey:string) => apiSend<{ok:true;report:ClassroomHealthReport;generatedAt:string}>(`/api/classrooms/${encodeURIComponent(roomKey)}/health`,'POST',{});

export const fetchClassroomCategories = () => apiGet<{ ok: true; items: ClassroomCategory[]; canManage: boolean }>('/api/classroom-categories');
export const createClassroomCategory = (payload: Partial<ClassroomCategory>) => apiSend<{ ok: true; item: ClassroomCategory }>('/api/classroom-categories', 'POST', payload);
export const updateClassroomCategory = (id: number, payload: Partial<ClassroomCategory>) => apiSend<{ ok: true; item: ClassroomCategory }>(`/api/classroom-categories/${id}`, 'PATCH', payload);
export const reorderClassroomCategories = (ids: number[]) => apiSend<{ ok: true }>('/api/classroom-categories/reorder', 'PATCH', { ids });
export const deleteClassroomCategory = (id: number) => apiSend<{ ok: true; deleted: boolean }>(`/api/classroom-categories/${id}`, 'DELETE');
