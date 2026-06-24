import type { Ticket } from '../types';
import { apiGet, apiSend } from './apiClient';

export function getTickets() {
  return apiGet<{ ok: true; items: Ticket[] }>('/api/tickets');
}

export function createTicket(payload: Partial<Ticket>) {
  return apiSend<{ ok: true; item: Ticket }>('/api/tickets', 'POST', payload);
}

export function updateTicket(id: number, payload: Partial<Ticket>) {
  return apiSend<{ ok: true; item: Ticket }>(`/api/tickets/${id}`, 'PATCH', payload);
}

export function deleteTicket(id: number) {
  return apiSend<{ ok: true; deleted: boolean }>(`/api/tickets/${id}`, 'DELETE');
}

export function uploadTicketImage(payload: { fileName: string; dataUrl: string }) {
  return apiSend<{ ok: true; url: string }>('/api/tickets/upload-image', 'POST', payload);
}
