import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { AgendaItem, Device, Movement, TaskItem, ViewKey } from '../../types';
import { classifyDeviceType, matchesOperationalAlias, sortByOperationalAlias } from '../../utils/classifyDevice';
import { getDeviceStateKey } from '../../utils/deviceState';
import { StatCard } from '../layout/StatCard';
import { DeviceTable } from '../devices/DeviceTable';
import { NowPanel } from './NowPanel';
import { RecentMovements } from './RecentMovements';

type DeviceFilter = string;

const CARD_GAP = 14;
const CARD_MIN = 150;
const CARD_MAX_COLS = 6;

// Reparte `count` tarjetas en filas parejas sin pasar de `maxCols`:
// 6 categorías con lugar para 4 dan 3+3, no 4+2.
function balancedColumns(count: number, maxCols: number): number {
  if (count < 1) return 1;
  const rows = Math.ceil(count / Math.max(1, maxCols));
  return Math.ceil(count / rows);
}

// Calcula el ancho base de cada tarjeta midiendo el contenedor real, no con
// media queries: el espacio disponible depende del monitor Y de si la sidebar
// está colapsada, así que un breakpoint fijo se equivoca en la mitad de los
// casos. Combinado con flex-grow (ver components.css), si la última fila queda
// incompleta esas tarjetas crecen y llenan el ancho: nunca queda una tarjeta
// suelta con un hueco al lado.
function useCardBasis(count: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [basis, setBasis] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || count < 1) {
      setBasis(null);
      return;
    }
    const measure = () => {
      const width = element.clientWidth;
      if (!width) return;
      const fits = Math.max(1, Math.floor((width + CARD_GAP) / (CARD_MIN + CARD_GAP)));
      const columns = balancedColumns(count, Math.min(fits, CARD_MAX_COLS));
      setBasis(Math.floor((width - CARD_GAP * (columns - 1)) / columns));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [count]);

  return { ref, basis };
}

const FILTER_TITLES: Record<string, string> = {
  all: 'Resumen de dispositivos',
  available: 'Dispositivos disponibles',
  loaned: 'Dispositivos prestados',
  missing: 'Dispositivos no encontrados',
  out: 'Dispositivos fuera de servicio'
};

export function Dashboard({ devices, counts, agenda, tasks, movements, operator, consultationMode = false, onNavigate, onLoan, onReturn, onProfile, onEdit }: {
  operator: string;
  consultationMode?: boolean;
  devices: Device[];
  counts: Record<string, number>;
  agenda: AgendaItem[];
  tasks: TaskItem[];
  movements: Movement[];
  onNavigate: (view: ViewKey) => void;
  onLoan: (device: Device) => void;
  onReturn: (device: Device) => Promise<unknown> | void;
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

  const { ref: categoriesRef, basis: cardBasis } = useCardBasis(categoryCounts.length);

  return (
    <section className="view active dashboard-page">
      <div className="dashboard-stat-groups">
        <div className="stats-grid stats-main">
          <StatCard label="Total" value={counts.total || 0} large active={deviceFilter === 'all'} onClick={() => applyDeviceFilter('all')} />
          <StatCard label="Disponibles" value={counts.available || 0} large active={deviceFilter === 'available'} onClick={() => applyDeviceFilter('available')} />
          <StatCard label="Prestados" value={counts.loaned || 0} large active={deviceFilter === 'loaned'} onClick={() => applyDeviceFilter('loaned')} />
        </div>
        <div
          className="stats-grid stats-secondary"
          ref={categoriesRef}
          style={cardBasis ? ({ '--card-basis': `${cardBasis}px` } as CSSProperties) : undefined}
        >
          {categoryCounts.map(([category, value]) => (
            <StatCard key={category} label={category} value={value || 0} active={deviceFilter === category} onClick={() => applyDeviceFilter(category)} />
          ))}
        </div>
      </div>
      <NowPanel agenda={agenda} tasks={tasks} operator={operator} consultationMode={consultationMode} onAgenda={() => onNavigate('agenda')} onTasks={() => onNavigate('tasks')} />
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
          <DeviceTable devices={visibleDevices} compact={deviceFilter === 'all'} actionMode="dashboard" onLoan={onLoan} onReturn={onReturn} onProfile={onProfile} onEdit={onEdit} />
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
