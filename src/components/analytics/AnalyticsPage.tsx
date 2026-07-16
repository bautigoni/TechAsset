import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Device } from '../../types';
import { classifyDeviceType } from '../../utils/classifyDevice';
import { getAnalytics, type AnalyticsResponse } from '../../services/analyticsApi';
import { Button } from '../layout/Button';
import { ChartCard, type ChartSize, type ChartType } from './ChartCard';

type RangePreset = 'week' | 'month' | 'quarter' | 'year' | 'all';

const PRESETS: Array<{ key: RangePreset; label: string; days: number }> = [
  { key: 'year', label: 'Ultimo ano', days: 365 },
  { key: 'quarter', label: 'Ultimos 3 meses', days: 92 },
  { key: 'month', label: 'Ultimo mes', days: 30 },
  { key: 'week', label: 'Ultima semana', days: 7 },
  { key: 'all', label: 'Todo', days: 3650 },
];

function toIsoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function AnalyticsPage({ devices }: { devices: Device[]; onRefresh?: () => Promise<unknown> | void }) {
  const [preset, setPreset] = useState<RangePreset>('year');
  const today = useMemo(() => toIsoDate(new Date()), []);
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const range = useMemo(() => {
    const days = PRESETS.find(p => p.key === preset)?.days ?? 365;
    return { from: toIsoDate(new Date(Date.now() - days * 86400000)), to: today };
  }, [preset, today]);

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

  const typeRows = useMemo(() => {
    const map = new Map<string, number>();
    for (const ev of prestamoEvents) {
      const type = classifyDeviceType({ filtro: ev.filtro, aliasOperativo: ev.alias, etiqueta: ev.etiqueta } as Partial<Device>);
      map.set(type, (map.get(type) || 0) + 1);
    }
    return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [prestamoEvents]);

  const kpis: Array<{ label: string; value: string | number; hint?: string }> = [
    { label: 'Prestamos en el periodo', value: summary?.totalPrestamos ?? 0, hint: `${summary?.totalDevoluciones ?? 0} devoluciones` },
    { label: 'Personas distintas', value: summary?.personasUnicas ?? 0, hint: 'que pidieron prestado' },
    { label: 'Equipos distintos', value: summary?.equiposUnicos ?? 0, hint: 'que se prestaron' },
    { label: 'Tickets abiertos', value: summary?.ticketsAbiertos ?? 0 },
    { label: 'Tareas abiertas', value: summary?.tareasAbiertas ?? 0 },
    { label: 'Tiempo resp. tickets', value: `${summary?.ticketResponseDays ?? 0} d`, hint: 'Promedio de tickets cerrados' },
    { label: 'Tickets creados', value: summary?.ticketMetrics?.created ?? 0, hint: `${summary?.ticketMetrics?.resolved ?? 0} resueltos` },
    { label: 'Resolución tickets', value: `${summary?.ticketMetrics?.averageResolutionHours ?? 0} h`, hint: 'promedio del período' },
    { label: 'Primera respuesta', value: `${summary?.ticketMetrics?.averageResponseHours ?? 0} h`, hint: 'promedio del período' },
    { label: 'Promedio prestado', value: formatTopAverage(summary?.avgLoanHoursByDevice), hint: 'horas por equipo' },
  ];

  const charts: Array<{ title: string; rows: Array<{ label: string; value: number; color?: string }>; type: ChartType; size: ChartSize }> = summary ? [
    { title: 'Evolucion de prestamos', rows: summary.series.rows, type: 'line', size: 'wide' },
    { title: 'Equipos mas utilizados', rows: summary.byDevice?.length ? summary.byDevice : typeRows, type: 'bar', size: 'md' },
    { title: 'Tendencia anual', rows: summary.annualTrend || [], type: 'line', size: 'md' },
    { title: 'Personas que mas prestaron', rows: summary.byPerson?.slice(0, 15) || [], type: 'bar', size: 'md' },
    { title: 'Ubicaciones', rows: summary.byLocation || [], type: 'bar', size: 'md' },
    { title: 'Motivos de prestamo', rows: summary.byReason, type: 'donut', size: 'md' },
    { title: 'Top cursos usuarios', rows: summary.byCourse, type: 'bar', size: 'md' },
    { title: 'Prestamos por hora', rows: summary.byHour || [], type: 'vertical', size: 'md' },
    { title: 'Dias con mas demanda', rows: summary.byWeekday || [], type: 'bar', size: 'sm' },
    { title: 'Demanda por hora y dia', rows: summary.byHourWeekday || [], type: 'vertical', size: 'lg' },
    { title: 'Actividad TIC', rows: summary.byOperator || [], type: 'bar', size: 'sm' },
    { title: 'Equipos con mas fallas', rows: summary.byTicketDevice || [], type: 'bar', size: 'sm' },
    { title: 'Agenda TIC ocupacion', rows: summary.agendaOccupation || [], type: 'vertical', size: 'sm' },
    { title: 'Tickets abiertos vs cerrados', rows: summary.ticketMetrics?.openClosed || [], type: 'donut', size: 'sm' },
    { title: 'Tickets por categoría', rows: summary.ticketMetrics?.byCategory || [], type: 'bar', size: 'md' },
    { title: 'Tickets por prioridad', rows: summary.ticketMetrics?.byPriority || [], type: 'donut', size: 'sm' },
    { title: 'Tickets por técnico', rows: summary.ticketMetrics?.byTechnician || [], type: 'bar', size: 'md' },
    { title: 'Tickets por escuela', rows: summary.ticketMetrics?.bySchool || [], type: 'bar', size: 'sm' },
    { title: 'Tickets por aula', rows: summary.ticketMetrics?.byClassroom || [], type: 'bar', size: 'md' },
    { title: 'Incidentes recurrentes', rows: summary.ticketMetrics?.recurring || [], type: 'bar', size: 'md' },
    { title: 'Tendencia mensual de tickets', rows: summary.ticketMetrics?.monthly || [], type: 'line', size: 'wide' },
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
        </div>
      </section>

      {error && <div className="tool-error">{error}</div>}

      <div className="analytics-bento">
        {kpis.map(kpi => (
          <div key={kpi.label} className="kpi-bento span-1">
            <span className="kpi-bento-label">{kpi.label}</span>
            <span className="kpi-bento-value">{kpi.value}</span>
            {kpi.hint && <span className="kpi-bento-hint">{kpi.hint}</span>}
          </div>
        ))}
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
