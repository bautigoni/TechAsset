import type { InternalNote, QuickLink } from '../types';
import { apiGet, apiSend } from './apiClient';

export const fetchInternalNotes = (filter = 'active') =>
  apiGet<{ ok: true; items: InternalNote[] }>(`/api/internal-notes?filter=${encodeURIComponent(filter)}`);

export const createInternalNote = (payload: Partial<InternalNote> & { operator: string }) =>
  apiSend<{ ok: true; item: InternalNote }>('/api/internal-notes', 'POST', payload);

export const updateInternalNote = (id: number, payload: Partial<InternalNote> & { operator?: string }) =>
  apiSend<{ ok: true; item: InternalNote }>(`/api/internal-notes/${id}`, 'PATCH', payload);

export const deleteInternalNote = (id: number, operator: string) =>
  apiSend<{ ok: true; deleted: boolean }>(`/api/internal-notes/${id}`, 'DELETE', { operator });

export const fetchDailyClosurePreview = () =>
  apiGet<{ ok: true; resumen: Record<string, unknown> }>('/api/daily-closures/preview');

export const fetchDailyClosures = () =>
  apiGet<{ ok: true; items: Array<Record<string, unknown>> }>('/api/daily-closures');

export const createDailyClosure = (payload: { operator: string; observaciones: string; resumen?: Record<string, unknown> }) =>
  apiSend<{ ok: true; item: Record<string, unknown> }>('/api/daily-closures', 'POST', payload);

export const fetchQuickLinks = () =>
  apiGet<{ ok: true; items: QuickLink[] }>('/api/quick-links');

export const createQuickLink = (payload: Partial<QuickLink> & { operator: string }) =>
  apiSend<{ ok: true; item: QuickLink }>('/api/quick-links', 'POST', payload);

export const updateQuickLink = (id: number, payload: Partial<QuickLink> & { operator?: string }) =>
  apiSend<{ ok: true; item: QuickLink }>(`/api/quick-links/${id}`, 'PATCH', payload);

export const deleteQuickLink = (id: number, operator: string) =>
  apiSend<{ ok: true; deleted: boolean }>(`/api/quick-links/${id}`, 'DELETE', { operator });

export const fetchShiftSettings = () =>
  apiGet<{ ok: true; settings: { morningOperator: string; afternoonOperator: string } }>('/api/settings/shifts');

export const updateShiftSettings = (payload: { morningOperator: string; afternoonOperator: string }) =>
  apiSend<{ ok: true; settings: { morningOperator: string; afternoonOperator: string } }>('/api/settings/shifts', 'PATCH', payload);
