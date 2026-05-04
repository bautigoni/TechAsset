import { apiGet } from './apiClient';

export const getAnalytics = () => apiGet<{ ok: true; movements: unknown[] }>('/api/analytics');
