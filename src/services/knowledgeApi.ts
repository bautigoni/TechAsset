import type { KnowledgeArticle } from '../types';
import { apiGet, apiSend } from './apiClient';
export const getKnowledgeArticles=(q='')=>apiGet<{ok:true;items:KnowledgeArticle[]}>(`/api/knowledge/articles${q?`?q=${encodeURIComponent(q)}`:''}`);
export const createKnowledgeArticle=(payload:Partial<KnowledgeArticle>)=>apiSend<{ok:true;item:KnowledgeArticle}>('/api/knowledge/articles','POST',payload);
export const updateKnowledgeArticle=(id:number,payload:Partial<KnowledgeArticle>)=>apiSend<{ok:true;item:KnowledgeArticle}>(`/api/knowledge/articles/${id}`,'PATCH',payload);
export const deleteKnowledgeArticle=(id:number)=>apiSend<{ok:true;deleted:boolean}>(`/api/knowledge/articles/${id}`,'DELETE');
export const uploadKnowledgeAttachment=(payload:{name:string;mimeType:string;base64:string})=>apiSend<{ok:true;attachment:{name:string;url:string;mimeType:string}}>('/api/knowledge/upload','POST',payload);
