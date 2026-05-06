import type { Classroom, ClassroomHistoryEntry, ClassroomSummary } from '../types';

export const fetchClassrooms = (): Promise<{ ok: boolean; items: Classroom[] }> =>
  fetch('/api/classrooms').then(r => r.json());

export const fetchClassroomSummary = (): Promise<{ ok: boolean; summary: ClassroomSummary }> =>
  fetch('/api/classrooms/summary').then(r => r.json());

export const fetchClassroom = (roomKey: string, nombre?: string): Promise<{ ok: boolean; item: Classroom }> => {
  const params = new URLSearchParams();
  if (nombre) params.set('nombre', nombre);
  params.set('piso', 'Planta baja');
  return fetch(`/api/classrooms/${encodeURIComponent(roomKey)}?${params}`).then(r => r.json());
};

export const updateClassroom = (roomKey: string, payload: Partial<Classroom> & { operator?: string }): Promise<{ ok: boolean; item: Classroom }> =>
  fetch(`/api/classrooms/${encodeURIComponent(roomKey)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(r => r.json());

export const fetchClassroomHistory = (roomKey: string): Promise<{ ok: boolean; items: ClassroomHistoryEntry[] }> =>
  fetch(`/api/classrooms/${encodeURIComponent(roomKey)}/history`).then(r => r.json());
