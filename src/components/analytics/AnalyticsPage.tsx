import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Device } from '../../types';
import { classifyDeviceType } from '../../utils/classifyDevice';
import { getAnalytics, type AnalyticsResponse } from '../../services/analyticsApi';
import { Button } from '../layout/Button';
import { ChartCard, type ChartSize, type ChartType } from './ChartCard';

type RangePreset = 'week' | 'month' | 'quarter' | 'year' | 'all' | 'custom';

const PRESETS: Array<{ key: RangePreset; label: string; days: number | null }> = [
  { key: 'week', label: 'Ultima semana', days: 7 },
  { key: 'month', label: 'Ultimo mes', days: 30 },
  { key: 'quarter', label: 'Ultimos 3 meses', days: 92 },
  { key: 'year', label: 'Ultimo ano', days: 365 },
  { key: 'all', label: 'Todo', days: 3650 },
];

function toIsoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function AnalyticsPage({ devices }: { devices: Device[]; onRefresh?: () => Promise<unknown> | void }) {
  const [preset, setPreset] = useState<RangePreset>('year');
  const today = useMemo(() => toIsoDate(new Date()), []);
  const [customFrom, setCustomFrom] = useState(() => toIsoDate(new Date(Date.now() - 30 * 86400000)));
  const [customTo, setCustomTo] = useState(today);
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const range = useMemo(() => {
    if (preset === 'custom') return { from: customFrom, to: customTo };
    const days = PRESETS.find(p => p.key === preset)?.days ?? 365;
    return { from: toIsoDate(new Date(Date.now() - days * 86400000)), to: today };
  }, [preset, customFrom, customTo, today]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await getAnalytics(range.from, range.to);
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la analitica.');
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  useEffect(() => { void load(); }, [load]);

  const summary = data?.summary;
  const events = data?.events || [];
  const prestamoEvents = useMemo(() => events.filter(e => e.tipo === 'prestamo'), [events]);
  const prestadosAhora = devices.filter(device => device.estado === 'Prestado');
  const disponiblesAhora = devices.filter(device => String(device.estado || '').toLowerCase().includes('disponible'));
  const enReparacion = devices.filter(device => /fuera|repar|servicio|no encontrada/i.test(String(device.estado || '')));
  const disponibilidad = devices.length ? Math.round((disponiblesAhora.length / devices.length) * 100) : 0;

  const typeRows = useMemo(() => {
    const map = new Map<string, number>();
    for (const ev of prestamoEvents) {
      const type = classifyDeviceType({ filtro: ev.filtro, aliasOperativo: ev.alias, etiqueta: ev.etiqueta } as Partial<Device>);
      map.set(type, (map.get(type) || 0) + 1);
    }
    return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [prestamoEvents]);

  const kpis: Array<{ label: string; value: string | number; primary?: boolean; hint?: string }> = [
    { label: 'Disponibilidad actual', value: `${disponibilidad}%`, primary: true, hint: `${disponiblesAhora.length} disponibles / ${prestadosAhora.length} prestados` },
    { label: 'Prestamos hoy', value: summary?.prestamosHoy ?? 0, primary: true, hint: `${summary?.prestamosAyer ?? 0} prestamos ayer` },
    { label: 'Equipos en reparacion', value: enReparacion.length, hint: 'Fuera de servicio, reparacion o no encontrados' },
    { label: 'Tickets abiertos', value: summary?.ticketsAbiertos ?? 0 },
    { label: 'Tiempo resp. tickets', value: `${summary?.ticketResponseDays ?? 0} d`, hint: 'Promedio de tickets cerrados' },
    { label: 'Promedio prestado', value: formatTopAverage(summary?.avgLoanHoursByDevice) },
  ];

  const charts: Array<{ title: string; rows: Array<{ label: string; value: number; color?: string }>; type: ChartType; size: ChartSize }> = summary ? [
    { title: 'Evolucion de prestamos', rows: summary.series.rows, type: 'line', size: 'wide' },
    { title: 'Demanda por hora', rows: summary.byHourWeekday, type: 'vertical', size: 'lg' },
    { title: 'Top cursos usuarios', rows: summary.byCourse, type: 'bar', size: 'md' },
    { title: 'Motivos de prestamo', rows: summary.byReason, type: 'donut', size: 'md' },
    { title: 'Equipos mas utilizados', rows: summary.byDevice.length ? summary.byDevice : typeRows, type: 'bar', size: 'md' },
    { title: 'Tendencia anual', rows: summary.annualTrend, type: 'line', size: 'md' },
    { title: 'Equipos con mas fallas', rows: summary.byTicketDevice, type: 'bar', size: 'md' },
    { title: 'Actividad TIC', rows: summary.byOperator, type: 'bar', size: 'sm' },
    { title: 'Agenda TIC ocupacion', rows: summary.agendaOccupation, type: 'vertical', size: 'sm' },
  ] : [];

  return (
    <section className="view active">
      <div className="analytics-reload-bar">
        <span className="muted">{loading ? 'Cargando...' : `${summary?.totalPrestamos ?? 0} prestamos en el periodo`}</span>
        <Button variant="primary" disabled={loading} onClick={() => void load()}>{loading ? 'Actualizando...' : 'Recargar'}</Button>
      </div>

      <section className="card analytics-filter-card">
        <div className="card-head"><h3>Periodo</h3></div>
        <div className="analytics-filters">
          {PRESETS.map(p => (
            <button
              key={p.key}
              type="button"
              className={`analytics-summary-pill ${preset === p.key ? 'is-active' : ''}`}
              onClick={() => setPreset(p.key)}
            >
              <strong>{p.label}</strong>
            </button>
          ))}
          <button
            type="button"
            className={`analytics-summary-pill ${preset === 'custom' ? 'is-active' : ''}`}
            onClick={() => setPreset('custom')}
          >
            <strong>Personalizado</strong>
          </button>
        </div>
        {preset === 'custom' && (
          <div className="grid-2" style={{ marginTop: 12 }}>
            <label>Desde<input className="input" type="date" value={customFrom} max={customTo} onChange={e => setCustomFrom(e.target.value)} /></label>
            <label>Hasta<input className="input" type="date" value={customTo} min={customFrom} max={today} onChange={e => setCustomTo(e.target.value)} /></label>
          </div>
        )}
      </section>

      {error && <div className="tool-error">{error}</div>}

      <div className="analytics-bento">
        {kpis.map(kpi => (
          <div key={kpi.label} className={`kpi-bento ${kpi.primary ? 'is-primary span-2' : 'span-1'}`}>
            <span className="kpi-bento-label">{kpi.label}</span>
            <span className="kpi-bento-value">{kpi.value}</span>
            {kpi.hint && <span className="kpi-bento-hint">{kpi.hint}</span>}
          </div>
        ))}
        <GaugeCard label="Parque activo" value={disponibilidad} detail={`${devices.length} equipos cargados`} />
        {charts.map(chart => (
          <ChartCard key={chart.title} title={chart.title} rows={chart.rows} type={chart.type} size={chart.size} />
        ))}
      </div>

      {!loading && summary && summary.totalPrestamos === 0 && (
        <div className="tool-info">No hay prestamos registrados en este periodo. Proba ampliar el rango.</div>
      )}
    </section>
  );
}

function formatTopAverage(rows?: Array<{ label: string; value: number }>) {
  const top = rows?.find(row => row.value > 0);
  return top ? `${top.value} h` : '-';
}

function GaugeCard({ label, value, detail }: { label: string; value: number; detail: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <section className="card chart-card chart-card--sm analytics-gauge-card">
      <div className="card-head"><h3>{label}</h3></div>
      <div className="analytics-gauge" style={{ '--gauge-value': `${clamped}%` } as CSSProperties}>
        <div><strong>{clamped}%</strong><span>{detail}</span></div>
      </div>
    </section>
  );
}
