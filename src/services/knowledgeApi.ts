import type { KnowledgeArticle } from '../types';
import { apiGet, apiSend } from './apiClient';

export type KnowledgeCategoryCount = { name: string; count: number };
export type KnowledgePage = { ok: true; items: KnowledgeArticle[]; total: number; nextCursor: string; categories?: KnowledgeCategoryCount[] };

/** Listado del server: búsqueda sin tildes, filtro por categoría y paginado por cursor. */
export const getKnowledgeArticles = (options: { q?: string; category?: string; cursor?: string; limit?: number } | string = {}) => {
  const opts = typeof options === 'string' ? { q: options } : options;
  const params = new URLSearchParams();
  if (opts.q?.trim()) params.set('q', opts.q.trim());
  if (opts.category) params.set('category', opts.category);
  if (opts.cursor) params.set('cursor', opts.cursor);
  if (opts.limit) params.set('limit', String(opts.limit));
  const query = params.toString();
  return apiGet<KnowledgePage>(`/api/knowledge/articles${query ? `?${query}` : ''}`);
};
export const getKnowledgeArticle = (id: number) => apiGet<{ ok: true; item: KnowledgeArticle }>(`/api/knowledge/articles/${id}`);
export const createKnowledgeArticle = (payload: Partial<KnowledgeArticle>) => apiSend<{ ok: true; item: KnowledgeArticle }>('/api/knowledge/articles', 'POST', payload);
export const updateKnowledgeArticle = (id: number, payload: Partial<KnowledgeArticle>) => apiSend<{ ok: true; item: KnowledgeArticle }>(`/api/knowledge/articles/${id}`, 'PATCH', payload);
export const deleteKnowledgeArticle = (id: number) => apiSend<{ ok: true; deleted: boolean }>(`/api/knowledge/articles/${id}`, 'DELETE');
export const restoreKnowledgeArticle = (id: number) => apiSend<{ ok: true; item: KnowledgeArticle }>(`/api/knowledge/articles/${id}/restore`, 'POST');
export const uploadKnowledgeAttachment = (payload: { name: string; mimeType: string; base64: string }) =>
  apiSend<{ ok: true; attachment: { name: string; url: string; mimeType: string } }>('/api/knowledge/upload', 'POST', payload);
