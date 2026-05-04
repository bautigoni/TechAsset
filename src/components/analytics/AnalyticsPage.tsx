import { useMemo, useState } from 'react';
import type { Device } from '../../types';
import { classifyDeviceType } from '../../utils/classifyDevice';
import { Button } from '../layout/Button';
import { StatCard } from '../layout/StatCard';
import { ChartCard, type ChartType } from './ChartCard';

function countBy(devices: Device[], getter: (device: Device) => string | undefined) {
  return Object.entries(devices.reduce<Record<string, number>>((acc, device) => {
    const label = String(getter(device) || '').trim();
    if (label && label !== '-') acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {})).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function topRows(rows: Array<{ label: string; value: number }>, limit: number) {
  return rows.slice(0, limit);
}

function defaultChartType(index: number): ChartType {
  const rotation: ChartType[] = ['donut', 'vertical', 'pie', 'threeD', 'bar', 'line'];
  return rotation[index % rotation.length];
}

function timeAgo(ts: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 5) return 'recién';
  if (seconds < 60) return `hace ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `hace ${hours} h`;
}

export function AnalyticsPage({ devices, onRefresh }: { devices: Device[]; onRefresh?: () => Promise<unknown> | void }) {
  const [reloadKey, setReloadKey] = useState(0);
  const [reloading, setReloading] = useState(false);
  const [reloadedAt, setReloadedAt] = useState<number>(() => Date.now());

  const reload = async () => {
    setReloading(true);
    try {
      await onRefresh?.();
      setReloadKey(k => k + 1);
      setReloadedAt(Date.now());
    } finally {
      setReloading(false);
    }
  };

  const loaned = devices.filter(device => device.estado === 'Prestado');
  const returned = devices.filter(device => device.returnedAt && device.estado !== 'Prestado');
  const historicalLoaned = devices.filter(device => device.loanedAt || device.returnedAt || device.estado === 'Prestado' || device.prestadoA);
  const stateRows = ['Disponible', 'Prestado', 'No encontrada', 'Fuera de servicio'].map(state => ({ label: state, value: devices.filter(device => device.estado === state).length }));
  const peopleRows = useMemo(() => countBy(loaned, device => device.prestadoA), [loaned]);
  const locationRows = useMemo(() => countBy(loaned, device => device.ubicacion), [loaned]);
  const roleRows = useMemo(() => countBy(loaned, device => device.rol), [loaned]);
  const reasonRows = useMemo(() => countBy(loaned, device => device.motivo), [loaned]);
  const historicalTypeRows = useMemo(() => ['TOUCH', 'PLANI', 'TIC', 'DELL'].map(type => ({ label: type, value: historicalLoaned.filter(device => classifyDeviceType(device) === type).length })), [historicalLoaned]);
  const modelRows = useMemo(() => countBy(devices, device => `${classifyDeviceType(device)} - ${device.modelo || device.dispositivo || 'Equipo'}`), [devices]);
  const recentRows = useMemo(() => devices.filter(device => device.loanedAt).map(device => ({ label: device.etiqueta, value: device.estado === 'Prestado' ? 2 : 1 })), [devices]);
  const topType = [...historicalTypeRows].sort((a, b) => b.value - a.value)[0];
  const withoutPerson = loaned.filter(device => !device.prestadoA).length;

  const charts = [
    { title: 'Estado general', rows: stateRows },
    { title: 'Prestamos por tipo de equipo', rows: historicalTypeRows },
    { title: 'Personas que mas piden', rows: topRows(peopleRows, 50) },
    { title: 'Ubicaciones activas', rows: topRows(locationRows, 50) },
    { title: 'Roles de prestamos', rows: topRows(roleRows, 50) },
    { title: 'Motivos de prestamos', rows: topRows(reasonRows, 50) },
    { title: 'Modelos y familias', rows: topRows(modelRows, 50) },
    { title: 'Equipos con movimiento reciente', rows: recentRows }
  ];

  return (
    <section className="view active">
      <div className="analytics-reload-bar">
        <span className="muted">Actualizado {timeAgo(reloadedAt)}</span>
        <Button variant="primary" disabled={reloading} onClick={reload}>{reloading ? 'Actualizando…' : 'Recargar analítica'}</Button>
      </div>
      <div className="stats-grid analytics-kpi-grid">
        <StatCard label="Total prestamos historicos" value={historicalLoaned.length} />
        <StatCard label="Total equipos devueltos" value={returned.length} />
        <StatCard label="Prestados ahora" value={loaned.length} />
        <StatCard label="Tipo mas prestado" value={topType?.label || '-'} />
        <StatCard label="Ubicacion principal" value={locationRows[0]?.label || '-'} />
        <StatCard label="Persona principal" value={peopleRows[0]?.label || '-'} />
        <StatCard label="Sin persona cargada" value={withoutPerson} />
        <StatCard label="No encontradas / servicio" value={devices.filter(device => device.estado === 'No encontrada' || device.estado === 'Perdida' || device.estado === 'Fuera de servicio').length} />
      </div>

      <section className="card analytics-filter-card">
        <div className="card-head">
          <h3>Resumen operativo</h3>
        </div>
        <div className="analytics-filters">
          <div className="analytics-summary-pill"><span>Con persona cargada</span><strong>{loaned.length - withoutPerson}</strong></div>
          <div className="analytics-summary-pill"><span>Ultimo equipo prestado</span><strong>{devices.find(device => device.loanedAt)?.etiqueta || '-'}</strong></div>
          <div className="analytics-summary-pill"><span>Touch en uso</span><strong>{loaned.filter(device => classifyDeviceType(device) === 'TOUCH').length}</strong></div>
          <div className="analytics-summary-pill"><span>Devueltos con hora</span><strong>{returned.length}</strong></div>
        </div>
      </section>

      <div className="analytics-grid" key={reloadKey}>
        {charts.map((chart, index) => <ChartCard key={chart.title} title={chart.title} rows={chart.rows} type={defaultChartType(index)} />)}
      </div>
    </section>
  );
}
