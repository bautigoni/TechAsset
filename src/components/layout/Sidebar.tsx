import type { ViewKey } from '../../types';

const NAV: Array<{ key: ViewKey; label: string }> = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'devices', label: 'Dispositivos' },
  { key: 'loans', label: 'Prestamos' },
  { key: 'analytics', label: 'Analitica' },
  { key: 'agenda', label: 'Agenda TIC' },
  { key: 'tasks', label: 'Tareas TIC' },
  { key: 'classrooms', label: 'Estado aulas' },
  { key: 'tools', label: 'Herramientas auxiliares' },
  { key: 'quickaccess', label: 'Accesos rápidos' },
  { key: 'settings', label: 'Configuracion' }
];

export function Sidebar({ active, onNavigate, open, onClose, onReload }: { active: ViewKey; onNavigate: (view: ViewKey) => void; open: boolean; onClose: () => void; onReload: () => void }) {
  const navigate = (view: ViewKey) => {
    onNavigate(view);
    onClose();
  };

  return (
    <>
      <div className={`mobile-overlay ${open ? '' : 'hidden'}`} onClick={onClose} />
      <aside className={`sidebar ${open ? 'open mobile-open' : ''}`}>
        <div className="brand">
          <img className="brand-logo" src="/northfield_logo.png" alt="Northfield" />
          <div>
            <h1>TechAsset - NFS</h1>
            <p>NFPT - Prestamos</p>
          </div>
        </div>

        <nav className="nav nav-scrollable">
          {NAV.map(item => (
            <button key={item.key} className={`nav-btn ${active === item.key ? 'active' : ''}`} type="button" onClick={() => navigate(item.key)}>
              {item.label}
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
