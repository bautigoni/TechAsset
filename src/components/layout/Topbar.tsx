import { useState } from 'react';
import type { AuthUser, SiteInfo, SyncStatus, ViewKey } from '../../types';
import { useSyncStatus } from '../../hooks/useSyncStatus';

const TITLES: Record<ViewKey, string> = {
  dashboard: 'TechAsset',
  devices: 'Dispositivos',
  loans: 'Préstamos',
  inventory: 'Inventario TIC',
  analytics: 'Analítica',
  agenda: 'Agenda TIC',
  tasks: 'Tareas TIC',
  classrooms: 'Estado aulas',
  tools: 'Herramientas auxiliares',
  quickaccess: 'Accesos rápidos',
  assistant: 'Asistente TIC',
  settings: 'Configuración'
};

export function Topbar({ view, search, setSearch, sync, consultationMode, onMenu, onToggleTheme, onReload, activeSite = 'NFPT', sites = [], onSiteChange, user, onLogout }: {
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
}) {
  const syncUi = useSyncStatus(sync);
  const [accountOpen, setAccountOpen] = useState(false);
  const displayName = user?.nombre || user?.email || 'Usuario';
  const initials = displayName.split(/\s|@/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || 'U';
  const activeSiteInfo = sites.find(site => site.siteCode === activeSite);
  const canSwitchSites = user?.rolGlobal === 'Superadmin' && sites.length > 1;

  return (
    <header className="topbar">
      <div className="topbar-title-wrap">
        <button className="mobile-menu-btn" type="button" aria-label="Abrir menú" onClick={onMenu}>
          <span className="hamburger-icon" aria-hidden="true" />
        </button>
        <img className="topbar-logo" src="/northfield_logo.png" alt="Northfield" />
        <div className="topbar-title-text">
          <h2>{TITLES[view]}</h2>
          <p>{activeSite} · {activeSiteInfo?.nombre || 'Sede activa'}</p>
        </div>
      </div>
      <div className="topbar-actions">
        {consultationMode && <span className="consulta-banner">Modo consulta</span>}
        {canSwitchSites ? (
          <select className="operator-chip" value={activeSite} onChange={event => onSiteChange?.(event.target.value)} title="Seleccionar sede">
            {sites.map(site => <option key={site.siteCode} value={site.siteCode}>{site.siteCode}</option>)}
          </select>
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
