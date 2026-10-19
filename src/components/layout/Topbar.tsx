import { Bell, Bot, Lock, PanelLeftClose, PanelLeftOpen, Search, Zap } from 'lucide-react';
import type { AuthUser } from '../../types';
import { initialsOf } from './Sidebar';
import { AnimatedNumber } from './AnimatedNumber';

export type StripKey = 'quick' | 'notif' | 'account' | 'sites' | 'palette';

/**
 * Barra superior (56 px): título de la vista y su contexto corto; a la
 * derecha Asistente, accesos rápidos (rayo), campana con el contador en mono
 * y la cuenta. Nada se abre flotando: cada botón abre una franja EN LÍNEA
 * debajo de la barra que empuja el contenido (una a la vez; Esc o el mismo
 * botón la cierran).
 */
export function Topbar({ title, context, consultationMode, user, unread, openStrip, onToggleStrip, assistantOpen, onToggleAssistant, collapsed, canCollapse, onToggleCollapsed }: {
  title: string;
  context?: string;
  consultationMode: boolean;
  user: AuthUser;
  unread: number;
  openStrip: StripKey | null;
  onToggleStrip: (strip: StripKey, trigger: HTMLElement) => void;
  assistantOpen: boolean;
  onToggleAssistant: () => void;
  collapsed: boolean;
  /** Bajo 1100 px (o con el asistente abierto en pantallas medianas) el rail es fijo. */
  canCollapse: boolean;
  onToggleCollapsed: () => void;
}) {
  const displayName = user.nombre || user.email || 'Usuario';
  const badge = unread > 9 ? '9+' : String(unread);
  return (
    <header className="shell-topbar">
      <button
        type="button"
        className="shell-icon-btn shell-collapse-btn"
        aria-label={collapsed ? 'Expandir menú (Ctrl B)' : 'Contraer menú (Ctrl B)'}
        aria-pressed={collapsed}
        hidden={!canCollapse}
        onClick={onToggleCollapsed}
      >
        {collapsed ? <PanelLeftOpen size={16} strokeWidth={1.6} aria-hidden="true" /> : <PanelLeftClose size={16} strokeWidth={1.6} aria-hidden="true" />}
      </button>
      <div className="shell-title">
        <h1 className="shell-title-main">{title}</h1>
        {context && <span className="shell-title-sep" aria-hidden="true">/</span>}
        {context && <span className="shell-title-context">{context}</span>}
      </div>
      {consultationMode && (
        <span className="shell-consulta" role="status">
          <Lock size={14} strokeWidth={1.6} aria-hidden="true" />
          <span className="shell-consulta-text">Modo consulta</span>
          <span className="shell-consulta-short">Consulta</span>
        </span>
      )}
      <div className="shell-actions">
        <button
          type="button"
          className="shell-icon-btn shell-mobile-only"
          aria-label="Buscar o ir a… (Ctrl K)"
          aria-expanded={openStrip === 'palette'}
          aria-controls="shell-strip-palette"
          onClick={event => onToggleStrip('palette', event.currentTarget)}
        >
          <Search size={18} strokeWidth={1.6} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`shell-assistant-btn${assistantOpen ? ' is-on' : ''}`}
          aria-pressed={assistantOpen}
          aria-label="Asistente"
          onClick={onToggleAssistant}
        >
          <Bot size={16} strokeWidth={1.6} aria-hidden="true" />
          <span className="shell-assistant-btn-label">Asistente</span>
        </button>
        <button
          type="button"
          className="shell-icon-btn shell-desktop-only"
          aria-label="Ver accesos rápidos"
          aria-expanded={openStrip === 'quick'}
          aria-controls="shell-strip-quick"
          onClick={event => onToggleStrip('quick', event.currentTarget)}
        >
          <Zap size={18} strokeWidth={1.6} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="shell-icon-btn shell-bell"
          aria-label={unread ? `Notificaciones, ${unread} sin leer` : 'Notificaciones'}
          aria-expanded={openStrip === 'notif'}
          aria-controls="shell-strip-notif"
          onClick={event => onToggleStrip('notif', event.currentTarget)}
        >
          <Bell size={18} strokeWidth={1.6} aria-hidden="true" />
          {unread > 0 && <span className="shell-bell-count g-num" aria-hidden="true"><AnimatedNumber value={badge} /></span>}
        </button>
        <button
          type="button"
          className="shell-icon-btn shell-account-btn"
          aria-label="Menú de cuenta"
          aria-expanded={openStrip === 'account'}
          aria-controls="shell-strip-account"
          onClick={event => onToggleStrip('account', event.currentTarget)}
        >
          <span className="shell-avatar" aria-hidden="true">{initialsOf(displayName)}</span>
        </button>
      </div>
    </header>
  );
}
