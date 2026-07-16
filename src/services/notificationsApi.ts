import { apiGet, apiSend } from './apiClient';

export interface AppNotification {
  id: number;
  siteCode: string;
  kind: string;
  title: string;
  body: string;
  link: string;
  payload?: unknown;
  read: boolean;
  createdAt: string;
}

export type NotificationTypePrefs = {
  releases: boolean;
  tasks: boolean;
  tickets: boolean;
  suggestions: boolean;
  reminders: boolean;
  registrations: boolean;
  system: boolean;
};

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

export const getNotificationPrefs = () =>
  apiGet<{ ok: true; email: boolean; types: NotificationTypePrefs; pushSubscribed: boolean; pushAvailable: boolean }>('/api/notifications/prefs');

export const setNotificationEmailPref = (email: boolean) =>
  apiSend<{ ok: true }>('/api/notifications/prefs', 'POST', { email });

export const setNotificationTypePrefs = (types: NotificationTypePrefs) =>
  apiSend<{ ok: true }>('/api/notifications/prefs', 'POST', { types });

export async function enableBrowserPush(): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return { ok: false, error: 'Tu navegador no soporta notificaciones push. En iPhone, primero instalá la app (Compartir → Agregar a inicio).' };
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, error: 'No diste permiso para notificaciones.' };
    const { publicKey } = await getVapidPublicKey();
    if (!publicKey) return { ok: false, error: 'El servidor no tiene push configurado.' };
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource
    });
    await subscribePush(sub.toJSON() as PushSubscriptionJSON);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo activar push.' };
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
