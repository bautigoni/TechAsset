import { useEffect, useRef, useState } from 'react';
import type { ViewKey } from '../../types';
import { useNotifications } from '../../hooks/useNotifications';
import type { AppNotification } from '../../services/notificationsApi';

function kindToView(kind: string): ViewKey | null {
  if (kind.startsWith('task')) return 'tasks';
  if (kind.startsWith('ticket')) return 'tickets';
  return null;
}

function linkToView(link: string): ViewKey | null {
  const clean = String(link || '').split('?')[0].replace(/\/+$/, '');
  const match = clean.match(/\/sede\/[^/]+\/([^/]+)$/);
  const view = match?.[1] || clean.replace(/^\//, '');
  const allowed: ViewKey[] = ['dashboard', 'devices', 'loans', 'inventory', 'analytics', 'agenda', 'tasks', 'classrooms', 'tickets', 'tools', 'quickaccess', 'assistant', 'tenants', 'settings'];
  return allowed.includes(view as ViewKey) ? view as ViewKey : null;
}

function openReleaseNotes() {
  window.dispatchEvent(new CustomEvent('techasset:open-release-notes'));
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

export function NotificationBell({ enabled, onNavigate }: { enabled: boolean; onNavigate?: (view: ViewKey) => void }) {
  const { items, unread, toast, dismissToast, markRead, markAllRead } = useNotifications(enabled);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!enabled) return null;

  const handleItem = (n: AppNotification) => {
    if (!n.read) void markRead(n.id);
    if (n.kind.startsWith('release') || n.link === '/release-notes') {
      openReleaseNotes();
      setOpen(false);
      return;
    }
    if (n.link && /^https?:\/\//i.test(n.link)) {
      window.open(n.link, '_blank', 'noopener,noreferrer');
      setOpen(false);
      return;
    }
    const view = linkToView(n.link) || kindToView(n.kind);
    if (view && onNavigate) {
      onNavigate(view);
      setOpen(false);
    }
  };

  const openFromToast = () => {
    if (!toast) return;
    handleItem(toast);
    dismissToast();
  };

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button type="button" className="notif-bell" aria-label="Notificaciones" onClick={() => setOpen(o => !o)}>
        <svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && <span className="notif-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-popover">
          <div className="notif-popover-head">
            <strong>Notificaciones</strong>
            {unread > 0 && <button type="button" className="notif-mark-all" onClick={() => void markAllRead()}>Marcar todas</button>}
          </div>
          <div className="notif-list">
            {items.length === 0 && <div className="notif-empty">No tenés notificaciones.</div>}
            {items.map(n => (
              <button type="button" key={n.id} className={`notif-item ${n.read ? '' : 'is-unread'}`} onClick={() => handleItem(n)}>
                <span className="notif-item-title">{n.title}</span>
                {n.body && <span className="notif-item-body">{n.body}</span>}
                <span className="notif-item-time">{timeAgo(n.createdAt)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {toast && (
        <div className="notif-toast" role="status">
          <div className="notif-toast-body">
            <strong>{toast.title}</strong>
            {toast.body && <span>{toast.body}</span>}
          </div>
          <div className="notif-toast-actions">
            <button type="button" className="btn btn-primary" onClick={openFromToast}>Ver</button>
            <button type="button" className="notif-toast-close" aria-label="Cerrar" onClick={dismissToast}>×</button>
          </div>
        </div>
      )}
    </div>
  );
}
