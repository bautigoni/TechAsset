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
export interface PhotoPassOptions { alumnos: string[]; cursos: string[]; docentes: string[] }

export const getPhotoPasses = () => apiGet<{ ok: true; items: PhotoPass[]; summary: PhotoPassSummary }>('/api/photo-passes');
export const getPhotoPassOptions = () => apiGet<{ ok: true } & PhotoPassOptions>('/api/photo-passes/options');

/** Una persona ya agrupada: el mismo nombre escrito de diez formas es una fila. */
export interface PhotoPassSuggestion { nombre: string; veces: number; ultimoAt: string; curso: string; docente: string }

export const getPhotoPassSuggestions = (q: string, field: 'alumno' | 'docente') =>
  apiGet<{ ok: true; items: PhotoPassSuggestion[] }>(`/api/photo-passes/suggest?field=${field}&q=${encodeURIComponent(q)}`);
export const lendPhotoPass = (numero: number, payload: { persona: string; curso?: string; docente?: string; rol?: string; motivo?: string }) => apiSend<{ ok: true; item: PhotoPass }>(`/api/photo-passes/${numero}/lend`, 'POST', payload);
export const returnPhotoPass = (numero: number) => apiSend<{ ok: true; item: PhotoPass }>(`/api/photo-passes/${numero}/return`, 'POST');
