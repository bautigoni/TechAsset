import { useLayoutEffect, useRef } from 'react';
import { Search, Settings } from 'lucide-react';
import type { AuthUser, SiteInfo, ViewKey } from '../../types';
import { groupNavItems, type NavItem } from './nav';
import { initialsOf, type NavCounts } from './Sidebar';
import { TenantLogo } from './TenantLogo';
import { TruncatedText } from '../../ui/Truncated';

/**
 * "Más" (mobile): todas las secciones agrupadas (con una línea de qué es cada
 * una), la sede, buscar y la cuenta. Es una vista propia, como el asistente en
 * mobile: ocupa el lugar del contenido (la vista anterior no queda debajo) y
 * tiene su entrada en el historial (`#mas`), así Atrás la cierra. Entra con un
 * fundido corto (instantáneo con movimiento reducido).
 */
export function MoreView({ open, items, active, onNavigate, onPrefetch, counts, user, roleLabel, sites, activeSite, canSwitchSites, onOpenSites, onOpenPalette, onOpenAccount }: {
  open: boolean;
  items: NavItem[];
  active: ViewKey;
  onNavigate: (view: ViewKey) => void;
  onPrefetch?: (view: ViewKey) => void;
  counts: NavCounts;
  user: AuthUser;
  roleLabel: string;
  sites: SiteInfo[];
  activeSite: string;
  canSwitchSites: boolean;
  onOpenSites: () => void;
  onOpenPalette: () => void;
  onOpenAccount: () => void;
}) {
  const site = sites.find(item => item.siteCode === activeSite);
  const groups = groupNavItems(items);
  const settings = items.find(item => item.key === 'settings');
  const displayName = user.nombre || user.email || 'Usuario';
  const ref = useRef<HTMLElement | null>(null);
  // Al abrir, el lector de pantalla y el teclado empiezan en "Más" (sin mover la página).
  useLayoutEffect(() => {
    if (open) ref.current?.focus({ preventScroll: true });
  }, [open]);
  return (
    <section
      ref={ref}
      id="shell-more"
      className="shell-more"
      aria-label="Más secciones"
      tabIndex={-1}
      hidden={!open}
      data-scanner-ignore=""
    >
      <button type="button" className="shell-more-search" onClick={onOpenPalette}>
        <Search size={16} strokeWidth={1.6} aria-hidden="true" />
        <span>Buscar equipo o sección</span>
      </button>
      {groups.map(group => (
        <div className="shell-more-group" key={group.key}>
          <h2 className="g-eyebrow">{group.label}</h2>
          <div className="shell-more-grid">
            {group.items.map(item => {
              const Icon = item.Icon;
              const isActive = item.key === active;
              const count = counts[item.key];
              // El Inicio no tiene pista en la barra (ahí va la fecha): acá sí, como las demás.
              const hint = item.hint || (item.key === 'dashboard' ? 'Resumen del día' : '');
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`shell-more-item${isActive ? ' is-active' : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                  aria-label={hint ? `${item.label}: ${hint}` : item.label}
                  onClick={() => onNavigate(item.key)}
                  onTouchStart={() => onPrefetch?.(item.key)}
                >
                  <span className="shell-more-item-top">
                    <Icon size={18} strokeWidth={1.6} aria-hidden={true} />
                    {count ? <span className="shell-more-count g-num">{count}</span> : null}
                  </span>
                  <span className="shell-more-text">
                    <TruncatedText className="shell-more-label">{item.label}</TruncatedText>
                    {hint && <TruncatedText className="shell-more-hint" lines={2}>{hint}</TruncatedText>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="shell-more-foot">
        <button type="button" className="shell-more-row" onClick={canSwitchSites ? onOpenSites : undefined} disabled={!canSwitchSites} aria-label={canSwitchSites ? 'Cambiar de sede' : `Sede ${site?.nombre || activeSite}`}>
          <TenantLogo className="shell-site-logo" site={site} />
          <span className="shell-site-text">
            <span className="shell-site-name">{site?.nombre || activeSite}</span>
            <span className="shell-site-code">{activeSite}{canSwitchSites ? ' · cambiar' : ''}</span>
          </span>
        </button>
        <div className="shell-more-row is-user">
          <button type="button" className="shell-more-user" onClick={onOpenAccount}>
            <span className="shell-avatar" aria-hidden="true">{initialsOf(displayName)}</span>
            <span className="shell-site-text">
              <span className="shell-site-name">{displayName}</span>
              <span className="shell-site-code">{roleLabel}</span>
            </span>
          </button>
          {settings && (
            <button type="button" className="shell-icon-btn" aria-label="Configuración" aria-current={active === 'settings' ? 'page' : undefined} onClick={() => onNavigate('settings')}>
              <Settings size={18} strokeWidth={1.6} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
