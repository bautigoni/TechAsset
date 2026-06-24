import { apiGet, apiSend } from './apiClient';

export interface AppNotification {
  id: number;
  siteCode: string;
  kind: string;
  title: string;
  body: string;
  link: string;
  read: boolean;
  createdAt: string;
}

export const getNotifications = () =>
  apiGet<{ ok: true; items: AppNotification[]; unread: number }>('/api/notifications');

export const markNotificationRead = (id: number) =>
  apiSend<{ ok: true }>(`/api/notifications/${id}/read`, 'PATCH');

export const markAllNotificationsRead = () =>
  apiSend<{ ok: true }>('/api/notifications/read-all', 'POST');

export const getVapidPublicKey = () =>
  apiGet<{ ok: true; publicKey: string }>('/api/push/vapid-public-key');

export const subscribePush = (subscription: PushSubscriptionJSON) =>
  apiSend<{ ok: true }>('/api/push/subscribe', 'POST', { subscription });

export const sendReleaseBroadcast = (payload: { version: string; title: string; body: string }) =>
  apiSend<{ ok: true; recipients: number; mailsSent: number }>('/api/admin/release-notes', 'POST', payload);

export const getLatestRelease = () =>
  apiGet<{ ok: true; release: { version: string; title: string; bodyMd: string } | null }>('/api/release-notes/latest');
