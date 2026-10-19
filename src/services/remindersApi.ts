import type { Reminder } from '../types';
import { apiGet, apiSend } from './apiClient';

type Row = Reminder & { completedBy?: string; notificationSentAt?: string; mine?: boolean; canEdit?: boolean };

export const getReminders = (filters: { status?: string; relatedType?: string; relatedId?: string } = {}) => {
  const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value).map(([key, value]) => [key, String(value)]));
  return apiGet<{ ok: true; items: Row[] }>(`/api/reminders${params.size ? `?${params}` : ''}`);
};
export const createReminder = (payload: Partial<Reminder>) => apiSend<{ ok: true; item: Row }>('/api/reminders', 'POST', payload);
export const updateReminder = (id: number, payload: Partial<Reminder>) => apiSend<{ ok: true; item: Row }>(`/api/reminders/${id}`, 'PATCH', payload);
export const completeReminder = (id: number) => apiSend<{ ok: true; item: Row }>(`/api/reminders/${id}/complete`, 'POST', {});
export const postponeReminder = (id: number, remindAt: string) => apiSend<{ ok: true; item: Row }>(`/api/reminders/${id}/postpone`, 'POST', { remindAt });
export const deleteReminder = (id: number) => apiSend<{ ok: true; deleted: boolean }>(`/api/reminders/${id}`, 'DELETE');
/** Deshacer / volver a pendiente: deja el recordatorio como estaba (estado, fecha, aviso enviado, activo). */
export const undoReminder = (id: number, previous: Pick<Row, 'status' | 'remindAt' | 'notificationSentAt' | 'completedAt' | 'completedBy'>) =>
  apiSend<{ ok: true; item: Row }>(`/api/reminders/${id}/undo`, 'POST', { previous });
export const getReminderPeople = () => apiGet<{ ok: true; items: Array<{ email: string; name: string }>; me: string }>('/api/reminders/people');
export const testReminderPush = () => apiSend<{ ok: true; available: boolean; subscriptions: number; sent: number }>('/api/reminders/push-test', 'POST', {});
