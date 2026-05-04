import { StatCard } from '../layout/StatCard';

export type AgendaKpiFilter = 'total' | 'pending' | 'entregadas' | 'realizadas' | 'vencidas' | 'plani' | 'tic';

export function AgendaKpis({ kpis, activeFilter, onFilter }: { kpis: Record<string, number>; activeFilter: AgendaKpiFilter | null; onFilter: (filter: AgendaKpiFilter) => void }) {
  return (
    <div className="stats-grid agenda-kpi-grid">
      <StatCard label="Actividades" value={kpis.total || 0} active={activeFilter === 'total'} onClick={() => onFilter('total')} />
      <StatCard label="Pendientes" value={kpis.pending || 0} active={activeFilter === 'pending'} onClick={() => onFilter('pending')} />
      <StatCard label="Entregadas" value={kpis.entregadas || 0} active={activeFilter === 'entregadas'} onClick={() => onFilter('entregadas')} />
      <StatCard label="Realizadas" value={kpis.realizadas || 0} active={activeFilter === 'realizadas'} onClick={() => onFilter('realizadas')} />
      <StatCard label="Vencidas" value={kpis.vencidas || 0} active={activeFilter === 'vencidas'} onClick={() => onFilter('vencidas')} />
      <StatCard label="Plani requeridas" value={kpis.plani || 0} active={activeFilter === 'plani'} onClick={() => onFilter('plani')} />
      <StatCard label="TIC requeridas" value={kpis.tic || 0} active={activeFilter === 'tic'} onClick={() => onFilter('tic')} />
    </div>
  );
}
