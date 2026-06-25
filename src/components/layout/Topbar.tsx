import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { AuthUser, SiteInfo, SyncStatus, ViewKey } from '../../types';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import { NotificationBell } from './NotificationBell';
import { TenantLogo } from './TenantLogo';

const TITLES: Record<ViewKey, string> = {
  dashboard: 'TechAsset',
  devices: 'Dispositivos',
  loans: 'Préstamos',
  inventory: 'Inventario TIC',
  analytics: 'Analítica',
  agenda: 'Agenda TIC',
  tasks: 'Tareas TIC',
  classrooms: 'Estado aulas',
  tickets: 'Tickets',
  tools: 'Herramientas auxiliares',
  quickaccess: 'Accesos rápidos',
  assistant: 'Asistente TIC',
  tenants: 'Tenants',
  settings: 'Configuración'
};

export function Topbar({ view, search, setSearch, sync, consultationMode, onMenu, onToggleTheme, onReload, activeSite = 'NFPT', sites = [], onSiteChange, user, onLogout, onNavigate }: {
  view: ViewKey;
  search: string;
  setSearch: (value: string) => void;
  sync: SyncStatus;
  consultationMode: boolean;
  onMenu: () => void;
  onToggleTheme: () => void;
  onReload?: () => void;
  activeSite?: string;
  sites?: SiteInfo[];
  onSiteChange?: (siteCode: string) => void;
  user?: AuthUser | null;
  onLogout?: () => void | Promise<void>;
  onNavigate?: (view: ViewKey) => void;
}) {
  const syncUi = useSyncStatus(sync);
  const [accountOpen, setAccountOpen] = useState(false);
  const [siteMenuOpen, setSiteMenuOpen] = useState(false);
  const siteMenuRef = useRef<HTMLDivElement | null>(null);
  const displayName = user?.nombre || user?.email || 'Usuario';
  const initials = displayName.split(/\s|@/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || 'U';
  const activeSiteInfo = sites.find(site => site.siteCode === activeSite);
  const canSwitchSites = user?.rolGlobal === 'Superadmin' && sites.length > 1;

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

  return (
    <header className="topbar">
      <div className="topbar-title-wrap">
        <button className="mobile-menu-btn" type="button" aria-label="Abrir menú" onClick={onMenu}>
          <span className="hamburger-icon" aria-hidden="true" />
        </button>
        <TenantLogo className="topbar-logo" site={activeSiteInfo} />
        <div className="topbar-title-text">
          <h2>{TITLES[view]}</h2>
          <p>{activeSite} · {activeSiteInfo?.nombre || 'Sede activa'}</p>
        </div>
      </div>
      <div className="topbar-actions">
        {consultationMode && <span className="consulta-banner">Modo consulta</span>}
        {canSwitchSites ? (
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
              <ChevronDown size={16} strokeWidth={2.2} />
            </button>
            {siteMenuOpen && (
              <div className="site-switcher-menu" role="menu">
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
        ) : <span className="operator-chip" title={activeSiteInfo?.nombre || user?.email || 'Sede'}>{activeSite}</span>}
        <div className={`sync-mini ${syncUi.className}`} title={syncUi.title}>
          <span className="sync-mini-dot" />
          <span className="sr-only">{syncUi.title}</span>
        </div>
        <button className="sync-refresh-btn" type="button" aria-label="Actualizar base local" title="Actualizar base local" onClick={onReload}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 6v5h-5" />
            <path d="M4 18v-5h5" />
            <path d="M18.2 9A7 7 0 0 0 6.6 6.6L4 9" />
            <path d="M5.8 15A7 7 0 0 0 17.4 17.4L20 15" />
          </svg>
        </button>
        <button className="theme-icon-btn" type="button" aria-label="Cambiar modo claro u oscuro" title="Modo claro / oscuro" onClick={onToggleTheme}>
          <span className="theme-icon-half" />
        </button>
        <NotificationBell enabled={!!user} onNavigate={onNavigate} />
        <div className="account-menu-wrap">
          <button className="account-chip" type="button" aria-expanded={accountOpen} onClick={() => setAccountOpen(open => !open)} title={user?.email || displayName}>
            <span className="account-avatar">{initials}</span>
            <span className="account-name">{displayName}</span>
          </button>
          {accountOpen && (
            <div className="account-menu">
              <div className="account-menu-item">
                <strong>Mi cuenta</strong>
                <span>{user?.email || '-'}</span>
              </div>
              <div className="account-menu-item">
                <strong>Sede activa</strong>
                <span>{activeSiteInfo?.nombre ? `${activeSite} · ${activeSiteInfo.nombre}` : activeSite}</span>
              </div>
              <button type="button" className="account-menu-action" onClick={() => void onLogout?.()}>Cerrar sesión</button>
            </div>
          )}
        </div>
        <input className="input" type="search" placeholder="Buscar" value={search} onChange={event => setSearch(event.target.value)} />
      </div>
    </header>
  );
}
