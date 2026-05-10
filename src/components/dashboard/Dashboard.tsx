import { useMemo, useRef, useState } from 'react';
import type { AgendaItem, Device, Movement, TaskItem, ViewKey } from '../../types';
import { classifyDeviceType, matchesOperationalAlias, sortByOperationalAlias } from '../../utils/classifyDevice';
import { getDeviceStateKey } from '../../utils/deviceState';
import { StatCard } from '../layout/StatCard';
import { DeviceTable } from '../devices/DeviceTable';
import { NowPanel } from './NowPanel';
import { RecentMovements } from './RecentMovements';

type DeviceFilter = string;

const FILTER_TITLES: Record<string, string> = {
  all: 'Resumen de dispositivos',
  available: 'Dispositivos disponibles',
  loaned: 'Dispositivos prestados',
  missing: 'Dispositivos no encontrados',
  out: 'Dispositivos fuera de servicio'
};

export function Dashboard({ devices, counts, agenda, tasks, movements, onNavigate, onLoan, onReturn, onProfile, onEdit }: {
  devices: Device[];
  counts: Record<string, number>;
  agenda: AgendaItem[];
  tasks: TaskItem[];
  movements: Movement[];
  onNavigate: (view: ViewKey) => void;
  onLoan: (device: Device) => void;
  onReturn: (device: Device) => void;
  onProfile: (device: Device) => void;
  onEdit: (device: Device) => void;
}) {
  const [deviceFilter, setDeviceFilter] = useState<DeviceFilter>('all');
  const [aliasQuery, setAliasQuery] = useState('');
  const tableRef = useRef<HTMLElement | null>(null);

  const applyDeviceFilter = (filter: DeviceFilter) => {
    setDeviceFilter(filter);
    window.setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40);
  };

  const visibleDevices = useMemo(() => {
    const base = deviceFilter === 'all' ? devices : devices.filter(device => {
      if (deviceFilter === 'available') return getDeviceStateKey(device) === 'available';
      if (deviceFilter === 'loaned') return getDeviceStateKey(device) === 'loaned';
      if (deviceFilter === 'missing') return getDeviceStateKey(device) === 'missing';
      if (deviceFilter === 'out') return getDeviceStateKey(device) === 'out';
      return getDashboardFilter(device) === deviceFilter;
    });
    const filtered = base.filter(device => matchesOperationalAlias(device, aliasQuery));
    return sortByOperationalAlias(filtered);
  }, [aliasQuery, deviceFilter, devices]);

  const categoryCounts = useMemo(() => Object.entries(counts)
    .filter(([key, value]) => !['total', 'available', 'loaned', 'missing', 'out'].includes(key) && Number(value) > 0)
    .sort(([a], [b]) => a.localeCompare(b)), [counts]);

  return (
    <section className="view active">
      <div className="dashboard-stat-groups">
        <div className="stats-grid stats-main">
          <StatCard label="Total" value={counts.total || 0} large active={deviceFilter === 'all'} onClick={() => applyDeviceFilter('all')} />
          <StatCard label="Disponibles" value={counts.available || 0} large active={deviceFilter === 'available'} onClick={() => applyDeviceFilter('available')} />
          <StatCard label="Prestados" value={counts.loaned || 0} large active={deviceFilter === 'loaned'} onClick={() => applyDeviceFilter('loaned')} />
        </div>
        <div className="stats-grid stats-secondary">
          {categoryCounts.map(([category, value]) => (
            <StatCard key={category} label={category} value={value || 0} active={deviceFilter === category} onClick={() => applyDeviceFilter(category)} />
          ))}
        </div>
      </div>
      <NowPanel agenda={agenda} tasks={tasks} onAgenda={() => onNavigate('agenda')} onTasks={() => onNavigate('tasks')} />
      <RecentMovements items={movements} />
      <section className="card dashboard-device-section" ref={tableRef}>
        <div className="card-head">
          <div>
            <h3>{FILTER_TITLES[deviceFilter] || `Equipos ${deviceFilter}`}</h3>
            <span className="muted">{visibleDevices.length} equipos</span>
          </div>
          <input
            className="input compact-search"
            type="search"
            placeholder="Filtrar etiqueta o alias"
            value={aliasQuery}
            onChange={event => setAliasQuery(event.target.value)}
            title="Buscar D1433, Touch 31, touch31, Plani 5..."
          />
        </div>
        {visibleDevices.length ? (
          <DeviceTable devices={visibleDevices} compact={deviceFilter === 'all'} actionMode="dashboard" onLoan={onLoan} onReturn={onReturn} onEdit={onEdit} />
        ) : (
          <div className="empty-state">No hay equipos para este filtro.</div>
        )}
      </section>
    </section>
  );
}

function getDashboardFilter(device: Device) {
  return String(device.filtro || device.categoria || classifyDeviceType(device) || 'Otro').trim() || 'Otro';
}
