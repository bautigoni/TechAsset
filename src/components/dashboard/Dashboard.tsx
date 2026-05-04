import { useMemo, useRef, useState } from 'react';
import type { AgendaItem, Device, Movement, TaskItem, ViewKey } from '../../types';
import { classifyDeviceType } from '../../utils/classifyDevice';
import { getDeviceStateKey } from '../../utils/deviceState';
import { StatCard } from '../layout/StatCard';
import { DeviceTable } from '../devices/DeviceTable';
import { NowPanel } from './NowPanel';
import { RecentMovements } from './RecentMovements';

type DeviceFilter = 'all' | 'available' | 'loaned' | 'PLANI' | 'TOUCH' | 'TIC' | 'DELL' | 'missing' | 'out';

const FILTER_TITLES: Record<DeviceFilter, string> = {
  all: 'Resumen de dispositivos',
  available: 'Dispositivos disponibles',
  loaned: 'Dispositivos prestados',
  PLANI: 'Equipos Plani',
  TOUCH: 'Equipos Touch',
  TIC: 'Equipos TIC',
  DELL: 'Equipos Dell',
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
  const tableRef = useRef<HTMLElement | null>(null);

  const applyDeviceFilter = (filter: DeviceFilter) => {
    setDeviceFilter(filter);
    window.setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40);
  };

  const visibleDevices = useMemo(() => {
    if (deviceFilter === 'all') return devices;
    return devices.filter(device => {
      if (deviceFilter === 'available') return getDeviceStateKey(device) === 'available';
      if (deviceFilter === 'loaned') return getDeviceStateKey(device) === 'loaned';
      if (deviceFilter === 'missing') return getDeviceStateKey(device) === 'missing';
      if (deviceFilter === 'out') return getDeviceStateKey(device) === 'out';
      return classifyDeviceType(device) === deviceFilter;
    });
  }, [deviceFilter, devices]);

  return (
    <section className="view active">
      <div className="dashboard-stat-groups">
        <div className="stats-grid stats-main">
          <StatCard label="Total" value={counts.total || 0} large active={deviceFilter === 'all'} onClick={() => applyDeviceFilter('all')} />
          <StatCard label="Disponibles" value={counts.available || 0} large active={deviceFilter === 'available'} onClick={() => applyDeviceFilter('available')} />
          <StatCard label="Prestados" value={counts.loaned || 0} large active={deviceFilter === 'loaned'} onClick={() => applyDeviceFilter('loaned')} />
        </div>
        <div className="stats-grid stats-secondary">
          <StatCard label="Plani" value={counts.PLANI || 0} active={deviceFilter === 'PLANI'} onClick={() => applyDeviceFilter('PLANI')} />
          <StatCard label="Touch" value={counts.TOUCH || 0} active={deviceFilter === 'TOUCH'} onClick={() => applyDeviceFilter('TOUCH')} />
          <StatCard label="TIC" value={counts.TIC || 0} active={deviceFilter === 'TIC'} onClick={() => applyDeviceFilter('TIC')} />
          <StatCard label="Dell" value={counts.DELL || 0} active={deviceFilter === 'DELL'} onClick={() => applyDeviceFilter('DELL')} />
          <StatCard label="No encontradas" value={counts.missing || 0} active={deviceFilter === 'missing'} onClick={() => applyDeviceFilter('missing')} />
          <StatCard label="Fuera de servicio" value={counts.out || 0} active={deviceFilter === 'out'} onClick={() => applyDeviceFilter('out')} />
        </div>
      </div>
      <NowPanel agenda={agenda} tasks={tasks} onAgenda={() => onNavigate('agenda')} onTasks={() => onNavigate('tasks')} />
      <RecentMovements items={movements} />
      <section className="card dashboard-device-section" ref={tableRef}>
        <div className="card-head">
          <h3>{FILTER_TITLES[deviceFilter]}</h3>
          <span className="muted">{visibleDevices.length} equipos</span>
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
