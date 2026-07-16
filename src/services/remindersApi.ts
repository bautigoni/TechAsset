import type { Reminder } from '../types';
import { apiGet, apiSend } from './apiClient';

export const getReminders = (filters:{status?:string;relatedType?:string;relatedId?:string}={}) => { const params=new URLSearchParams(Object.entries(filters).filter(([,value])=>value).map(([key,value])=>[key,String(value)])); return apiGet<{ok:true;items:Reminder[]}>(`/api/reminders${params.size?`?${params}`:''}`); };
export const createReminder = (payload:Partial<Reminder>) => apiSend<{ok:true;item:Reminder}>('/api/reminders','POST',payload);
export const updateReminder = (id:number,payload:Partial<Reminder>) => apiSend<{ok:true;item:Reminder}>(`/api/reminders/${id}`,'PATCH',payload);
export const completeReminder = (id:number) => apiSend<{ok:true;item:Reminder}>(`/api/reminders/${id}/complete`,'POST',{});
export const postponeReminder = (id:number,remindAt:string) => apiSend<{ok:true;item:Reminder}>(`/api/reminders/${id}/postpone`,'POST',{remindAt});
export const deleteReminder = (id:number) => apiSend<{ok:true;deleted:boolean}>(`/api/reminders/${id}`,'DELETE');
