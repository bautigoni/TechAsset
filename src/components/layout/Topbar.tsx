import { useState, type FocusEvent, type PointerEvent } from 'react';
import { Bell, Lock, PanelLeftClose, PanelLeftOpen, Search, Zap } from 'lucide-react';
import type { AuthUser } from '../../types';
import { Tooltip } from '../../ui/Tooltip';
import { initialsOf } from './Sidebar';
import { AnimatedNumber } from './AnimatedNumber';
import { AssistantMark } from '../assistant/AssistantMark';

export type StripKey = 'quick' | 'notif' | 'account' | 'sites' | 'palette';

/**
 * Barra superior (56 px): título de la vista y su contexto corto; a la
 * derecha Asistente, accesos rápidos (rayo), campana con el contador en mono
 * y la cuenta. Nada se abre flotando: cada botón abre una franja EN LÍNEA
 * debajo de la barra que empuja el contenido (una a la vez; Esc o el mismo
 * botón la cierran).
 *
 * Los botones que son solo un ícono dicen su nombre al pasar el mouse o con
 * foco de teclado, con el mismo tooltip que el rail del menú lateral (el
 * nombre "no entra": es la excepción de la única capa flotante permitida). En
 * touch no hay hover: el nombre queda en aria-label y la franja que abren
 * lleva el mismo título.
 */
export function Topbar({ title, context, consultationMode, user, unread, openStrip, onToggleStrip, assistantOpen, onToggleAssistant, onAssistantIntent, collapsed, canCollapse, onToggleCollapsed }: {
  title: string;
  context?: string;
  consultationMode: boolean;
  user: AuthUser;
  unread: number;
  openStrip: StripKey | null;
  onToggleStrip: (strip: StripKey, trigger: HTMLElement) => void;
  assistantOpen: boolean;
  onToggleAssistant: () => void;
  /** Puntero o foco sobre el botón: se precarga el panel (abre animado desde el primer toque). */
  onAssistantIntent?: () => void;
  collapsed: boolean;
  /** Bajo 1100 px (o con el asistente abierto en pantallas medianas) el rail es fijo. */
  canCollapse: boolean;
  onToggleCollapsed: () => void;
}) {
  const displayName = user.nombre || user.email || 'Usuario';
  const badge = unread > 9 ? '9+' : String(unread);
  const [tip, setTip] = useState<{ anchor: HTMLElement; label: string } | null>(null);
  const hideTip = () => setTip(null);
  // Nombre visible: mouse encima (no un toque) o foco de teclado. Si el botón ya
  // muestra su nombre (Asistente en pantallas anchas), no hace falta.
  const tipProps = (label: string) => {
    const show = (anchor: HTMLElement) => {
      const visible = anchor.querySelector<HTMLElement>('[data-tip-label]');
      if (visible && visible.offsetWidth > 0) return;
      setTip({ anchor, label });
    };
    return {
      onPointerEnter: (event: PointerEvent<HTMLElement>) => { if (event.pointerType === 'mouse') show(event.currentTarget); },
      onPointerLeave: hideTip,
      onPointerDown: hideTip,
      onFocus: (event: FocusEvent<HTMLElement>) => { if (event.currentTarget.matches(':focus-visible')) show(event.currentTarget); },
      onBlur: hideTip,
      // Abrir la franja (o Esc) saca el nombre: no tapa lo que se abre debajo.
      onKeyDown: hideTip
    };
  };
  const collapseLabel = collapsed ? 'Expandir menú (Ctrl B)' : 'Contraer menú (Ctrl B)';
  const bellLabel = unread ? `Notificaciones, ${unread} sin leer` : 'Notificaciones';
  return (
    <header className="shell-topbar">
      <button
        type="button"
        className="shell-icon-btn shell-collapse-btn"
        aria-label={collapseLabel}
        aria-pressed={collapsed}
        hidden={!canCollapse}
        onClick={() => { hideTip(); onToggleCollapsed(); }}
        {...tipProps(collapseLabel)}
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
          aria-label="Buscar o ir a una sección"
          aria-expanded={openStrip === 'palette'}
          aria-controls="shell-strip-palette"
          onClick={event => onToggleStrip('palette', event.currentTarget)}
          {...tipProps('Buscar o ir a una sección')}
        >
          <Search size={18} strokeWidth={1.6} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`shell-assistant-btn${assistantOpen ? ' is-on' : ''}`}
          aria-pressed={assistantOpen}
          aria-label="Asistente"
          onClick={() => { hideTip(); onToggleAssistant(); }}
          onPointerEnter={event => { onAssistantIntent?.(); tipProps('Asistente').onPointerEnter(event); }}
          onFocus={event => { onAssistantIntent?.(); tipProps('Asistente').onFocus(event); }}
          onPointerLeave={hideTip}
          onPointerDown={hideTip}
          onBlur={hideTip}
        >
          <AssistantMark size={16} />
          <span className="shell-assistant-btn-label" data-tip-label="">Asistente</span>
        </button>
        <button
          type="button"
          className="shell-icon-btn shell-desktop-only"
          aria-label="Ver accesos rápidos"
          aria-expanded={openStrip === 'quick'}
          aria-controls="shell-strip-quick"
          onClick={event => onToggleStrip('quick', event.currentTarget)}
          {...tipProps('Accesos rápidos')}
        >
          <Zap size={18} strokeWidth={1.6} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="shell-icon-btn shell-bell"
          aria-label={bellLabel}
          aria-expanded={openStrip === 'notif'}
          aria-controls="shell-strip-notif"
          onClick={event => onToggleStrip('notif', event.currentTarget)}
          {...tipProps(bellLabel)}
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
          {...tipProps(`Tu cuenta · ${displayName}`)}
        >
          <span className="shell-avatar" aria-hidden="true">{initialsOf(displayName)}</span>
        </button>
      </div>
      <Tooltip anchor={tip?.anchor || null} open={Boolean(tip)}>{tip?.label}</Tooltip>
    </header>
  );
}
