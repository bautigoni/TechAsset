import { apiGet, apiSend } from './apiClient';

export interface PhotoPass {
  id: number;
  numero: number;
  estado: 'Disponible' | 'Prestado' | 'Perdido' | 'Fuera de uso' | string;
  prestadoA: string;
  curso: string;
  docente: string;
  rol: string;
  motivo: string;
  loanedAt: string;
  returnedAt: string;
  notas: string;
  activo: boolean;
  updatedAt: string;
}

export interface PhotoPassSummary { total: number; disponibles: number; prestados: number; fuera: number }
export interface PhotoPassEvent { id: number; tipo: string; persona: string; curso: string; docente: string; rol: string; motivo: string; operador: string; timestamp: string }
export interface PhotoPassOptions { alumnos: string[]; cursos: string[]; docentes: string[] }

export const getPhotoPasses = () => apiGet<{ ok: true; items: PhotoPass[]; summary: PhotoPassSummary }>('/api/photo-passes');
export const generatePhotoPasses = (desde: number, hasta: number) => apiSend<{ ok: true; creados: number; total: number }>('/api/photo-passes/generate', 'POST', { desde, hasta });
export const getPhotoPassOptions = () => apiGet<{ ok: true } & PhotoPassOptions>('/api/photo-passes/options');
export const lendPhotoPass = (numero: number, payload: { persona: string; curso?: string; docente?: string; rol?: string; motivo?: string }) => apiSend<{ ok: true; item: PhotoPass }>(`/api/photo-passes/${numero}/lend`, 'POST', payload);
export const returnPhotoPass = (numero: number) => apiSend<{ ok: true; item: PhotoPass }>(`/api/photo-passes/${numero}/return`, 'POST');
export const updatePhotoPass = (numero: number, payload: { estado?: string; notas?: string }) => apiSend<{ ok: true; item: PhotoPass }>(`/api/photo-passes/${numero}`, 'PATCH', payload);
export const deletePhotoPass = (numero: number) => apiSend<{ ok: true; deleted: boolean }>(`/api/photo-passes/${numero}`, 'DELETE');
export const getPhotoPassHistory = (numero: number) => apiGet<{ ok: true; items: PhotoPassEvent[] }>(`/api/photo-passes/${numero}/history`);
