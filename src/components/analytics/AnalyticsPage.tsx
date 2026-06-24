import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Device } from '../../types';
import { classifyDeviceType } from '../../utils/classifyDevice';
import { getAnalytics, type AnalyticsResponse } from '../../services/analyticsApi';
import { Button } from '../layout/Button';
import { StatCard } from '../layout/StatCard';
import { ChartCard, type ChartType } from './ChartCard';

type RangePreset = 'week' | 'month' | 'quarter' | 'year' | 'all' | 'custom';

const PRESETS: Array<{ key: RangePreset; label: string; days: number | null }> = [
  { key: 'week', label: 'Última semana', days: 7 },
  { key: 'month', label: 'Último mes', days: 30 },
  { key: 'quarter', label: 'Últimos 3 meses', days: 92 },
  { key: 'year', label: 'Último año', days: 365 },
  { key: 'all', label: 'Todo', days: 3650 },
];

function defaultChartType(index: number): ChartType {
  const rotation: ChartType[] = ['donut', 'vertical', 'pie', 'bar', 'threeD', 'line'];
  return rotation[index % rotation.length];
}

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

  const charts = summary ? [
    { title: 'Préstamos en el tiempo', rows: summary.series.rows },
    { title: 'Personas que más piden', rows: summary.byPerson },
    { title: 'Préstamos por tipo de equipo', rows: typeRows },
    { title: 'Ubicaciones', rows: summary.byLocation },
    { title: 'Roles', rows: summary.byRole },
    { title: 'Motivos', rows: summary.byReason },
    { title: 'Cursos', rows: summary.byCourse },
  ] : [];

  const seriesType: ChartType = summary?.series.granularity === 'month' ? 'line' : 'line';

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

      <div className="stats-grid analytics-kpi-grid">
        <StatCard label="Préstamos (período)" value={summary?.totalPrestamos ?? 0} />
        <StatCard label="Devoluciones (período)" value={summary?.totalDevoluciones ?? 0} />
        <StatCard label="Prestados ahora" value={prestadosAhora.length} />
        <StatCard label="Personas distintas" value={summary?.personasUnicas ?? 0} />
        <StatCard label="Equipos distintos" value={summary?.equiposUnicos ?? 0} />
        <StatCard label="Persona principal" value={summary?.byPerson[0]?.label || '-'} />
        <StatCard label="Tipo más prestado" value={typeRows[0]?.label || '-'} />
        <StatCard label="Ubicación principal" value={summary?.byLocation[0]?.label || '-'} />
      </div>

      <div className="analytics-grid">
        {charts.map((chart, index) => (
          <ChartCard key={chart.title} title={chart.title} rows={chart.rows} type={index === 0 ? seriesType : defaultChartType(index)} />
        ))}
      </div>

      {!loading && summary && summary.totalPrestamos === 0 && (
        <div className="tool-info">No hay préstamos registrados en este período. Probá ampliar el rango.</div>
      )}
    </section>
  );
}
