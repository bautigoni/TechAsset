import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Check, ChevronDown, Menu } from 'lucide-react';
import type { AuthUser, SiteInfo, ViewKey } from '../../types';
import { hasVariantNav, isSmartProfile, type ThemeProfile } from '../../utils/themeProfile';
import { NotificationBell } from './NotificationBell';
import { QuickAccessPopover } from '../tools/QuickAccessPopover';
import { TenantLogo } from './TenantLogo';
import { useMountTransition } from '../../hooks/useMountTransition';

/**
 * Barra superior mínima.
 *
 * Antes repetía el nombre de la app y de la sede —que ya están en el sidebar y
 * en el selector de sede— y juntaba cinco controles sueltos: recargar, cambiar
 * tema, el punto de sincronización y un buscador. Quedó lo que se usa: sede,
 * accesos rápidos, notificaciones y la cuenta. El tema pasó adentro del menú de
 * la cuenta, que es donde se lo busca.
 */
export function Topbar({ consultationMode, onMenu, onToggleTheme, activeSite = 'NFPT', sites = [], onSiteChange, user, onLogout, onNavigate, themeProfile = 'classic', impersonating = false, onExitImpersonation }: {
  consultationMode: boolean;
  onMenu: () => void;
  onToggleTheme: () => void;
  activeSite?: string;
  sites?: SiteInfo[];
  onSiteChange?: (siteCode: string) => void;
  user?: AuthUser | null;
  onLogout?: () => void | Promise<void>;
  onNavigate?: (view: ViewKey) => void;
  themeProfile?: ThemeProfile;
  impersonating?: boolean;
  onExitImpersonation?: () => void;
}) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [siteMenuOpen, setSiteMenuOpen] = useState(false);
  // Los dos menús se sostienen montados mientras corre la salida.
  const accountMenuAnim = useMountTransition(accountOpen, 120); // --dropdown-close-dur
  const siteMenu = useMountTransition(siteMenuOpen, 120);
  const siteMenuRef = useRef<HTMLDivElement | null>(null);
  const displayName = user?.nombre || user?.email || 'Usuario';
  const initials = displayName.split(/\s|@/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || 'U';
  const activeSiteInfo = sites.find(site => site.siteCode === activeSite);
  const canSwitchSites = user?.rolGlobal === 'Superadmin' && sites.length > 1;
  const oscuro = !isSmartProfile(themeProfile);

  useEffect(() => {
    if (!siteMenuOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!siteMenuRef.current?.contains(event.target as Node)) setSiteMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSiteMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [siteMenuOpen]);

  const siteSwitcher = canSwitchSites ? (
    <div className="site-switcher" ref={siteMenuRef}>
      <button
        className="site-switcher-trigger"
        type="button"
        aria-expanded={siteMenuOpen}
        aria-label="Seleccionar sede"
        onClick={() => setSiteMenuOpen(open => !open)}
        style={{ '--tenant-accent': activeSiteInfo?.themeColor || '#3b82f6' } as CSSProperties}
      >
        <TenantLogo className="site-switcher-logo" site={activeSiteInfo} />
        <span className="site-switcher-text">
          <strong>{activeSite}</strong>
          <small>{activeSiteInfo?.nombre || 'Sede activa'}</small>
        </span>
        <ChevronDown size={16} strokeWidth={1.7} />
      </button>
      {siteMenu.mounted && (
        <div className={`site-switcher-menu t-dropdown ${siteMenu.stateClass}`.trim()} data-origin="top-left" role="menu">
          {sites.map(site => {
            const selected = site.siteCode === activeSite;
            return (
              <button
                key={site.siteCode}
                type="button"
                className={`site-switcher-option ${selected ? 'active' : ''}`}
                role="menuitem"
                onClick={() => {
                  onSiteChange?.(site.siteCode);
                  setSiteMenuOpen(false);
                }}
                style={{ '--tenant-accent': site.themeColor || '#3b82f6' } as CSSProperties}
              >
                <TenantLogo className="site-switcher-logo" site={site} />
                <span className="site-switcher-text">
                  <strong>{site.siteCode}</strong>
                  <small>{site.nombre || site.subtitulo || 'Sede'}</small>
                </span>
                {selected && <Check size={16} strokeWidth={2.4} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  ) : null;

  // El menú de cuenta se monta en dos lugares (desktop y mobile), así que la
  // fase la maneja el llamador y acá sólo se recibe la clase.
  const accountMenu = (mounted: boolean, stateClass: string) => mounted ? (
    <div className={`account-menu t-dropdown ${stateClass}`.trim()} data-origin="top-right">
      <div className="account-menu-item">
        <strong>{displayName}</strong>
        <span>{user?.email || '-'}</span>
      </div>
      <div className="account-menu-item">
        <strong>Sede activa</strong>
        <span>{activeSiteInfo?.nombre ? `${activeSite} · ${activeSiteInfo.nombre}` : activeSite}</span>
      </div>
      {/* El tema vive acá y no como un botón suelto en la barra: se cambia una
          vez cada tanto y es una preferencia de la cuenta, no una acción. */}
      <div className="account-menu-theme">
        <span>Tema</span>
        <div className="account-theme-toggle" role="group" aria-label="Tema de la interfaz">
          <button type="button" className={oscuro ? 'is-active' : ''} aria-pressed={oscuro} onClick={() => { if (!oscuro) onToggleTheme(); }}>Oscuro</button>
          <button type="button" className={oscuro ? '' : 'is-active'} aria-pressed={!oscuro} onClick={() => { if (oscuro) onToggleTheme(); }}>Claro</button>
        </div>
      </div>
      <button type="button" className="account-menu-action" onClick={() => void onLogout?.()}>Cerrar sesión</button>
    </div>
  ) : null;

  if (hasVariantNav(themeProfile)) {
    return (
      <div className={`topbar-smart-block has-searchrow ${impersonating ? 'has-impersonation' : ''}`}>
        {impersonating && (
          <div className="impersonation-banner">
            <span className="impersonation-dot" aria-hidden="true" />
            <span>Modo superadmin · viendo {activeSiteInfo?.nombre || activeSite}</span>
            <button className="impersonation-exit" type="button" onClick={onExitImpersonation}>Salir del modo</button>
          </div>
        )}
        <header className="topbar-smart">
          <div className="topbar-left">
            <button className="topbar-icon-btn topbar-menu-btn" type="button" aria-label="Abrir menú" onClick={onMenu}>
              <Menu size={20} strokeWidth={1.7} />
            </button>
            {consultationMode && <span className="consulta-banner">Modo consulta</span>}
          </div>
          <div className="topbar-right">
            {siteSwitcher}
            <QuickAccessPopover onOpenFull={() => onNavigate?.('quickaccess')} />
            <NotificationBell enabled={!!user} onNavigate={onNavigate} />
            <div className="account-menu-wrap">
              <button className="topbar-icon-btn account-trigger" type="button" aria-label="Menú de cuenta" aria-expanded={accountOpen} onClick={() => setAccountOpen(open => !open)} title={user?.email || displayName}>
                <span className="account-avatar">{initials}</span>
              </button>
              {accountMenu(accountMenuAnim.mounted, accountMenuAnim.stateClass)}
            </div>
          </div>
        </header>
      </div>
    );
  }

  return (
    <header className="topbar topbar-min">
      {/* Sólo el hamburguesa a la izquierda: en mobile el sidebar es un cajón y
          sin esto no hay forma de abrirlo. En desktop no se dibuja. */}
      <div className="topbar-title-wrap">
        <button className="mobile-menu-btn" type="button" aria-label="Abrir menú" onClick={onMenu}>
          <span className="hamburger-icon" aria-hidden="true" />
        </button>
        {consultationMode && <span className="consulta-banner">Modo consulta</span>}
      </div>
      <div className="topbar-actions">
        {siteSwitcher || <span className="operator-chip" title={activeSiteInfo?.nombre || user?.email || 'Sede'}>{activeSite}</span>}
        <QuickAccessPopover onOpenFull={() => onNavigate?.('quickaccess')} />
        <NotificationBell enabled={!!user} onNavigate={onNavigate} />
        <div className="account-menu-wrap">
          <button className="account-chip" type="button" aria-label="Menú de cuenta" aria-expanded={accountOpen} onClick={() => setAccountOpen(open => !open)} title={user?.email || displayName}>
            <span className="account-avatar">{initials}</span>
          </button>
          {accountMenu(accountMenuAnim.mounted, accountMenuAnim.stateClass)}
        </div>
      </div>
    </header>
  );
}
