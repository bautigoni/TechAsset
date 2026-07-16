import type { Suggestion, SuggestionComment, SuggestionStats, SuggestionStatus } from '../types';
import { apiGet, apiSend } from './apiClient';

export function getSuggestions(filters: { status?: string; category?: string; sort?: string } = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.category) params.set('category', filters.category);
  if (filters.sort) params.set('sort', filters.sort);
  const query = params.toString();
  return apiGet<{ ok:true; items:Suggestion[]; stats:SuggestionStats; categories:string[]; canManage:boolean }>(`/api/suggestions${query ? `?${query}` : ''}`);
}
export const createSuggestion = (payload:{title:string;description:string;category:string}) => apiSend<{ok:true;item:Suggestion}>('/api/suggestions','POST',payload);
export const updateSuggestion = (id:number,payload:Partial<{title:string;description:string;category:string;status:SuggestionStatus}>) => apiSend<{ok:true;item:Suggestion}>(`/api/suggestions/${id}`,'PATCH',payload);
export const deleteSuggestion = (id:number) => apiSend<{ok:true;deleted:boolean}>(`/api/suggestions/${id}`,'DELETE');
export const toggleSuggestionVote = (id:number) => apiSend<{ok:true;voted:boolean;votes:number}>(`/api/suggestions/${id}/vote`,'POST',{});
export const getSuggestionComments = (id:number) => apiGet<{ok:true;items:SuggestionComment[]}>(`/api/suggestions/${id}/comments`);
export const addSuggestionComment = (id:number,body:string) => apiSend<{ok:true;item:SuggestionComment}>(`/api/suggestions/${id}/comments`,'POST',{body});
