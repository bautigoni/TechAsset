import type { SiteInfo, ViewKey } from '../../types';

const NAV: Array<{ key: ViewKey; label: string; icon: string }> = [
  { key: 'dashboard', label: 'Dashboard', icon: 'DB' },
  { key: 'devices', label: 'Dispositivos', icon: 'DV' },
  { key: 'loans', label: 'Prestamos', icon: 'PR' },
  { key: 'analytics', label: 'Analitica', icon: 'AN' },
  { key: 'agenda', label: 'Agenda TIC', icon: 'AG' },
  { key: 'tasks', label: 'Tareas TIC', icon: 'TK' },
  { key: 'classrooms', label: 'Estado aulas', icon: 'AU' },
  { key: 'tools', label: 'Herramientas auxiliares', icon: 'TL' },
  { key: 'quickaccess', label: 'Accesos rápidos', icon: 'QA' },
  { key: 'settings', label: 'Configuracion', icon: 'CF' }
];

export function Sidebar({ active, onNavigate, open, onClose, onReload, collapsed, onToggleCollapsed, activeSite, sites }: {
  active: ViewKey;
  onNavigate: (view: ViewKey) => void;
  open: boolean;
  onClose: () => void;
  onReload: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  activeSite: string;
  sites: SiteInfo[];
}) {
  const siteInfo = sites.find(site => site.siteCode === activeSite);
  const visibleNav = NAV.filter(item => item.key !== 'classrooms' || activeSite === 'NFPT');
  const navigate = (view: ViewKey) => {
    onNavigate(view);
    onClose();
  };

  return (
    <>
      <div className={`mobile-overlay ${open ? '' : 'hidden'}`} onClick={onClose} />
      <aside className={`sidebar ${open ? 'open mobile-open' : ''} ${collapsed ? 'is-collapsed' : ''}`}>
        <div className="brand">
          <img className="brand-logo" src="/northfield_logo.png" alt="Northfield" />
          <div className="brand-text">
            <h1>TechAsset</h1>
            <p>{siteInfo?.nombre || activeSite}</p>
          </div>
          <button className="sidebar-collapse-btn" type="button" aria-label={collapsed ? 'Expandir menu' : 'Contraer menu'} onClick={onToggleCollapsed}>
            <span />
            <span />
            <span />
          </button>
        </div>

        <nav className="nav nav-scrollable">
          {visibleNav.map(item => (
            <button key={item.key} className={`nav-btn ${active === item.key ? 'active' : ''}`} type="button" onClick={() => navigate(item.key)} title={item.label}>
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button className="btn btn-secondary btn-block" type="button" onClick={onReload}>Recargar hoja</button>
          <button className="btn btn-secondary btn-block" type="button">Exportar PDF QR</button>
        </div>
      </aside>
    </>
  );
}
