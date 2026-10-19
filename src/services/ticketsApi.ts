import type { Ticket, TicketActivity, TicketChecklistItem, TicketComment, TicketRelation, TicketTemplate } from '../types';
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

export const getTicketTemplates = () => apiGet<{ ok: true; items: TicketTemplate[] }>('/api/ticket-templates');
export const createTicketTemplate = (payload: Partial<TicketTemplate>) => apiSend<{ ok: true; item: TicketTemplate }>('/api/ticket-templates','POST',payload);
export const updateTicketTemplate = (id:number,payload:Partial<TicketTemplate>) => apiSend<{ok:true;item:TicketTemplate}>(`/api/ticket-templates/${id}`,'PATCH',payload);
export const deleteTicketTemplate = (id:number) => apiSend<{ok:true;deleted:boolean}>(`/api/ticket-templates/${id}`,'DELETE');
export const getTicketDetail = (id:number) => apiGet<{ok:true;item:Ticket;comments:TicketComment[];activity:TicketActivity[];checklist:TicketChecklistItem[];related:TicketRelation[]}>(`/api/tickets/${id}/detail`);
export const addTicketRelation = (id:number,ticketId:number,relationType:'related'|'parent'='related') => apiSend<{ok:true;items:TicketRelation[]}>(`/api/tickets/${id}/relations`,'POST',{ticketId,relationType});
export const deleteTicketRelation = (id:number,relationId:number) => apiSend<{ok:true;deleted:boolean}>(`/api/tickets/${id}/relations/${relationId}`,'DELETE');
export const addTicketComment = (id:number,body:string) => apiSend<{ok:true;item:TicketComment}>(`/api/tickets/${id}/comments`,'POST',{body});
/** `restore` (Deshacer de "quitar paso"): vuelve a su posición y con su tilde. */
export const addTicketChecklistItem = (id:number,text:string,restore?:{position:number;done:boolean;completedBy?:string;completedAt?:string}) => apiSend<{ok:true;item:TicketChecklistItem}>(`/api/tickets/${id}/checklist`,'POST',{text,...(restore||{})});
export const restoreTicketTemplate = (id:number) => apiSend<{ok:true;item:TicketTemplate}>(`/api/ticket-templates/${id}/restore`,'POST',{});
/** Lotes en un request: estado (igual para todos o por ticket), borrar, restaurar. */
export type TicketBulkPayload =
  | { action: 'estado'; ids: number[]; estado: string }
  | { action: 'estado'; items: Array<{ id: number; estado: string }> }
  | { action: 'delete' | 'restore'; ids: number[] };
export const bulkTickets = (payload: TicketBulkPayload) => apiSend<{ok:true;changed:number[]}>('/api/tickets/bulk','POST',payload);
export const updateTicketChecklistItem = (id:number,itemId:number,payload:Partial<TicketChecklistItem>) => apiSend<{ok:true;item:TicketChecklistItem}>(`/api/tickets/${id}/checklist/${itemId}`,'PATCH',payload);
export const deleteTicketChecklistItem = (id:number,itemId:number) => apiSend<{ok:true;deleted:boolean}>(`/api/tickets/${id}/checklist/${itemId}`,'DELETE');
export const regenerateTicketSummary = (id:number) => apiSend<{ok:true;summary:string;updatedAt:string}>(`/api/tickets/${id}/summary`,'POST',{});
