import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Device } from '../../types';
import { classifyDeviceType } from '../../utils/classifyDevice';
import { formatLoanDateTime, loanAgeDays } from '../../utils/formatters';
import { getAnalytics, type AnalyticsResponse } from '../../services/analyticsApi';
import { Button } from '../layout/Button';
import { ChartCard, type ChartType, type ChartSize } from './ChartCard';

type RangePreset = 'week' | 'month' | 'quarter' | 'year' | 'all' | 'custom';

const PRESETS: Array<{ key: RangePreset; label: string; days: number | null }> = [
  { key: 'week', label: 'Última semana', days: 7 },
  { key: 'month', label: 'Último mes', days: 30 },
  { key: 'quarter', label: 'Últimos 3 meses', days: 92 },
  { key: 'year', label: 'Último año', days: 365 },
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
      setError(err instanceof Error ? err.message : 'No se pudo cargar la analítica.');
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  useEffect(() => { void load(); }, [load]);

  // Estado vivo (no histórico): cuántos hay prestados ahora.
  const prestadosAhora = devices.filter(device => device.estado === 'Prestado');
  const overdueLoans = useMemo(() => prestadosAhora
    .map(device => ({ device, days: loanAgeDays(device.loanedAt) }))
    .filter(item => item.days >= 1)
    .sort((a, b) => b.days - a.days), [prestadosAhora]);
  const summary = data?.summary;
  const events = data?.events || [];
  const prestamoEvents = useMemo(() => events.filter(e => e.tipo === 'prestamo'), [events]);

  const typeRows = useMemo(() => {
    const map = new Map<string, number>();
    for (const ev of prestamoEvents) {
      const type = classifyDeviceType({ filtro: ev.filtro, aliasOperativo: ev.alias, etiqueta: ev.etiqueta } as Partial<Device>);
      map.set(type, (map.get(type) || 0) + 1);
    }
    return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [prestamoEvents]);

  const charts: Array<{ title: string; rows: Array<{ label: string; value: number; color?: string }>; type: ChartType; size: ChartSize }> = summary ? [
    { title: 'Préstamos en el tiempo', rows: summary.series.rows, type: 'line', size: 'wide' },
    { title: 'Préstamos por hora', rows: summary.byHour || [], type: 'vertical', size: 'md' },
    { title: 'Días con más demanda', rows: summary.byWeekday || [], type: 'bar', size: 'sm' },
    { title: 'Equipos más prestados', rows: summary.byDevice || [], type: 'bar', size: 'md' },
    { title: 'Personas que más piden', rows: summary.byPerson, type: 'bar', size: 'md' },
    { title: 'Préstamos por tipo de equipo', rows: typeRows, type: 'donut', size: 'sm' },
    { title: 'Ubicaciones', rows: summary.byLocation, type: 'vertical', size: 'md' },
    { title: 'Operadores', rows: summary.byOperator || [], type: 'bar', size: 'sm' },
    { title: 'Motivos', rows: summary.byReason, type: 'bar', size: 'sm' },
    { title: 'Cursos', rows: summary.byCourse, type: 'bar', size: 'sm' }
  ] : [];

  const kpis: Array<{ icon: string; label: string; value: string | number; primary?: boolean }> = [
    { icon: 'IN', label: 'Préstamos (período)', value: summary?.totalPrestamos ?? 0, primary: true },
    { icon: 'OUT', label: 'Devoluciones (período)', value: summary?.totalDevoluciones ?? 0, primary: true },
    { icon: 'NOW', label: 'Prestados ahora', value: prestadosAhora.length },
    { icon: 'LATE', label: 'Con más de 1 día', value: overdueLoans.length },
    { icon: 'PPL', label: 'Personas distintas', value: summary?.personasUnicas ?? 0 },
    { icon: 'TOP', label: 'Tipo más prestado', value: typeRows[0]?.label || '-' }
  ];

  return (
    <section className="view active">
      <div className="analytics-reload-bar">
        <span className="muted">{loading ? 'Cargando…' : `${summary?.totalPrestamos ?? 0} préstamos en el período`}</span>
        <Button variant="primary" disabled={loading} onClick={() => void load()}>{loading ? 'Actualizando…' : 'Recargar'}</Button>
      </div>

      <section className="card analytics-filter-card">
        <div className="card-head"><h3>Período</h3></div>
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
            <span className="kpi-bento-icon" aria-hidden>{kpi.icon}</span>
            <span className="kpi-bento-label">{kpi.label}</span>
            <span className="kpi-bento-value">{kpi.value}</span>
          </div>
        ))}
        <section className="card analytics-risk-card chart-card--md">
          <div className="card-head">
            <h3>Préstamos a revisar</h3>
            <span className="badge off">{overdueLoans.length}</span>
          </div>
          <div className="analytics-risk-list">
            {overdueLoans.slice(0, 8).map(({ device, days }) => (
              <div className={days >= 2 ? 'risk-row is-danger' : 'risk-row is-warning'} key={device.id}>
                <strong>{device.etiqueta}</strong>
                <span>{device.prestadoA || 'Sin persona'} · {formatLoanDateTime(device.loanedAt)}</span>
                <em>{days} {days === 1 ? 'dia' : 'dias'}</em>
              </div>
            ))}
            {!overdueLoans.length && <div className="empty-state analytics-risk-empty">No hay préstamos viejos activos.</div>}
          </div>
        </section>
        {charts.map(chart => (
          <ChartCard key={chart.title} title={chart.title} rows={chart.rows} type={chart.type} size={chart.size} />
        ))}
      </div>

      {!loading && summary && summary.totalPrestamos === 0 && (
        <div className="tool-info">No hay préstamos registrados en este período. Probá ampliar el rango.</div>
      )}
    </section>
  );
}
