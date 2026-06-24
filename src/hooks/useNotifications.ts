import { useCallback, useEffect, useRef, useState } from 'react';
import { getNotifications, markAllNotificationsRead, markNotificationRead, type AppNotification } from '../services/notificationsApi';

const POLL_MS = 30000;

export function useNotifications(enabled: boolean) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [toast, setToast] = useState<AppNotification | null>(null);
  const lastMaxId = useRef<number>(0);
  const primed = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await getNotifications();
      setItems(res.items);
      setUnread(res.unread);
      const maxId = res.items.reduce((m, n) => Math.max(m, n.id), 0);
      // Toast solo para notificaciones realmente nuevas (no en la primera carga).
      if (primed.current && maxId > lastMaxId.current) {
        const fresh = res.items.find(n => n.id === maxId);
        if (fresh && !fresh.read) setToast(fresh);
      }
      lastMaxId.current = maxId;
      primed.current = true;
    } catch { /* silencioso */ }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [enabled, refresh]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const markRead = useCallback(async (id: number) => {
    setItems(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    setUnread(prev => Math.max(0, prev - 1));
    await markNotificationRead(id).catch(() => {});
  }, []);

  const markAllRead = useCallback(async () => {
    setItems(prev => prev.map(n => ({ ...n, read: true })));
    setUnread(0);
    await markAllNotificationsRead().catch(() => {});
  }, []);

  return { items, unread, toast, dismissToast: () => setToast(null), refresh, markRead, markAllRead };
}
