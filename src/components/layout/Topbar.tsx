import type { Operator, SyncStatus, ViewKey } from '../../types';
import { OPERATORS } from '../../utils/permissions';
import { useSyncStatus } from '../../hooks/useSyncStatus';

const TITLES: Record<ViewKey, string> = {
  dashboard: 'TechAsset',
  devices: 'Dispositivos',
  loans: 'Prestamos',
  analytics: 'Analitica',
  agenda: 'Agenda TIC',
  tasks: 'Tareas TIC',
  classrooms: 'Estado aulas',
  tools: 'Herramientas auxiliares',
  quickaccess: 'Accesos rápidos',
  assistant: 'Asistente TIC',
  settings: 'Configuracion'
};

export function Topbar({ view, search, setSearch, operator, setOperator, sync, consultationMode, onMenu, onToggleTheme }: {
  view: ViewKey;
  search: string;
  setSearch: (value: string) => void;
  operator: Operator;
  setOperator: (value: Operator) => void;
  sync: SyncStatus;
  consultationMode: boolean;
  onMenu: () => void;
  onToggleTheme: () => void;
}) {
  const syncUi = useSyncStatus(sync);

  return (
    <header className="topbar">
      <div className="topbar-title-wrap">
        <button className="mobile-menu-btn" type="button" aria-label="Abrir menu" onClick={onMenu}>
          <span className="hamburger-icon" aria-hidden="true" />
        </button>
        <img className="topbar-logo" src="/northfield_logo.png" alt="Northfield" />
        <div className="topbar-title-text">
          <h2>{TITLES[view]}</h2>
          <p />
        </div>
      </div>
      <div className="topbar-actions">
        {consultationMode && <span className="consulta-banner">Modo consulta</span>}
        <select className="operator-chip" value={operator} onChange={event => setOperator(event.target.value as Operator)} title="Seleccionar operador">
          {OPERATORS.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
        <div className={`sync-mini ${syncUi.className}`} title={syncUi.title}>
          <span className="sync-mini-dot" />
          <span className="sr-only">{syncUi.title}</span>
        </div>
        <button className="theme-icon-btn" type="button" aria-label="Cambiar modo claro u oscuro" title="Modo claro / oscuro" onClick={onToggleTheme}>
          <span className="theme-icon-half" />
        </button>
        <input className="input" type="search" placeholder="Buscar" value={search} onChange={event => setSearch(event.target.value)} />
      </div>
    </header>
  );
}
