import { useMemo, useState } from 'react';
import type { AgendaItem } from '../../types';
import { Button } from '../layout/Button';
import { type AgendaKpiFilter, AgendaKpis } from './AgendaKpis';
import { AgendaCard } from './AgendaCard';
import { AgendaModal } from './AgendaModal';

const DAYS = ['Hoy', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie'];
const DAY_MAP: Record<string, string> = { Lun: 'Lunes', Mar: 'Martes', Mie: 'Miércoles', Jue: 'Jueves', Vie: 'Viernes' };
const WEEK_DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];

type TurnoFilter = 'completo' | 'manana' | 'tarde';

function comparableDay(value: string) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/^mi.*rcoles$/, 'miercoles');
}

function todayName() {
  const index = new Date().getDay();
  return ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', ''][index] || '';
}

function displayTurno(value: string) {
  const v = String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (v === 'manana') return 'Mañana';
  if (v === 'tarde') return 'Tarde';
  return value || '';
}

function matchesTurno(item: AgendaItem, turno: TurnoFilter) {
  if (turno === 'completo') return true;
  const v = String(item.turno || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (turno === 'manana') return v === 'manana' || v === 'mañana';
  if (turno === 'tarde') return v === 'tarde';
  return true;
}

function isVencida(item: AgendaItem) {
  if (item.estado !== 'Pendiente' || !item.fecha) return false;
  return new Date(`${item.fecha}T${item.hasta || '23:59'}`) < new Date();
}

function computeKpis(items: AgendaItem[]) {
  return {
    total: items.length,
    pending: items.filter(item => item.estado === 'Pendiente').length,
    retiradas: items.reduce((sum, item) => sum + Number(item.compusRetiradas || 0), 0),
    entregadas: items.filter(item => item.estado === 'Entregado').length,
    realizadas: items.filter(item => item.estado === 'Realizado').length,
    vencidas: items.filter(item => isVencida(item)).length,
    plani: items.filter(item => /plani/i.test(item.tipoDispositivo)).reduce((sum, item) => sum + Number(item.cantidad || 0), 0),
    tic: items.filter(item => /tic/i.test(item.tipoDispositivo)).reduce((sum, item) => sum + Number(item.cantidad || 0), 0)
  } as Record<string, number>;
}

function agendaSummary(items: AgendaItem[]) {
  return items.map(item => `${item.dia} ${item.desde}-${item.hasta} | ${item.curso} | ${item.actividad} | ${item.cantidad} ${item.tipoDispositivo} | ${item.estado}`).join('\n');
}

function agendaCsv(items: AgendaItem[]) {
  const headers = ['dia', 'turno', 'desde', 'hasta', 'curso', 'actividad', 'tipo', 'cantidad', 'ubicacion', 'estado', 'nota'];
  const rows = items.map(item => [item.dia, item.turno, item.desde, item.hasta, item.curso, item.actividad, item.tipoDispositivo, item.cantidad, item.ubicacion, item.estado, item.nota || '']);
  return [headers, ...rows].map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
}

function downloadText(filename: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function AgendaPage({ items, consultationMode, onSave, onDelete, onTask, onRefresh }: { items: AgendaItem[]; kpis?: Record<string, number>; consultationMode: boolean; onSave: (item: Partial<AgendaItem>) => Promise<unknown>; onDelete: (id: string) => Promise<unknown>; onTask: (item: AgendaItem) => void; onRefresh?: () => Promise<unknown> | void }) {
  const [day, setDay] = useState('Hoy');
  const [tab, setTab] = useState<'today' | 'week' | 'history'>('today');
  const [turno, setTurno] = useState<TurnoFilter>('completo');
  const [kpiFilter, setKpiFilter] = useState<AgendaKpiFilter | null>(null);
  const [creating, setCreating] = useState(false);

  const itemsByTurno = useMemo(() => items.filter(item => matchesTurno(item, turno)), [items, turno]);

  const todayItems = useMemo(() => {
    const target = comparableDay(todayName());
    if (!target) return [];
    const todayIso = new Date().toISOString().slice(0, 10);
    return itemsByTurno.filter(item => {
      if (item.fecha) return item.fecha === todayIso || comparableDay(item.dia) === target;
      return comparableDay(item.dia) === target;
    });
  }, [itemsByTurno]);

  const applyKpiFilter = (source: AgendaItem[]) => {
    if (!kpiFilter || kpiFilter === 'total') return source;
    return source.filter(item => {
      const type = `${item.tipoDispositivo} ${item.actividad}`.toLowerCase();
      if (kpiFilter === 'pending') return item.estado === 'Pendiente';
      if (kpiFilter === 'entregadas') return item.estado === 'Entregado';
      if (kpiFilter === 'realizadas') return item.estado === 'Realizado';
      if (kpiFilter === 'vencidas') return isVencida(item);
      if (kpiFilter === 'plani') return type.includes('plani') || type.includes('planificacion');
      if (kpiFilter === 'tic') return type.includes('tic');
      return true;
    });
  };

  const filtered = useMemo(() => {
    const target = day === 'Hoy' ? todayName() : DAY_MAP[day] || '';
    const targetDay = comparableDay(target);
    const todayIso = new Date().toISOString().slice(0, 10);
    const byDay = targetDay ? itemsByTurno.filter(item => {
      if (item.fecha) return item.fecha === todayIso || comparableDay(item.dia) === targetDay;
      return comparableDay(item.dia) === targetDay;
    }) : [];
    return applyKpiFilter(byDay);
  }, [day, itemsByTurno, kpiFilter]);

  const weekGroups = useMemo(() => WEEK_DAYS.map(weekDay => ({
    day: weekDay,
    items: applyKpiFilter(itemsByTurno.filter(item => comparableDay(item.dia) === comparableDay(weekDay))).sort((a, b) => `${a.desde}${a.curso}`.localeCompare(`${b.desde}${b.curso}`))
  })), [itemsByTurno, kpiFilter]);

  const historyItems = useMemo(() => applyKpiFilter(itemsByTurno.filter(item => item.estado === 'Realizado' || item.estado === 'Cancelado')).sort((a, b) => (b.ultimaModificacion || b.createdAt || '').localeCompare(a.ultimaModificacion || a.createdAt || '')), [itemsByTurno, kpiFilter]);

  const kpis = useMemo(() => {
    if (tab === 'today') return computeKpis(todayItems);
    return computeKpis(itemsByTurno);
  }, [tab, todayItems, itemsByTurno]);

  const toggleKpiFilter = (filter: AgendaKpiFilter) => setKpiFilter(current => current === filter || filter === 'total' ? null : filter);
  const copySummary = async () => {
    const text = agendaSummary(filtered);
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else downloadText('agenda-resumen.txt', text);
  };
  const exportCsv = () => downloadText('agenda-tic.csv', agendaCsv(filtered.length ? filtered : items), 'text/csv;charset=utf-8');

  return (
    <section className="view active">
      <div className="agenda-topbar">
        <div className="agenda-day-selector">
          {DAYS.map(item => <button key={item} className={`day-btn agenda-day-btn ${day === item ? 'active' : ''}`} onClick={() => setDay(item)}>{item}</button>)}
        </div>
        <div className="agenda-toolbar-actions">
          <Button onClick={() => onRefresh?.()}>Actualizar agenda</Button>
          <Button onClick={copySummary}>Copiar resumen</Button>
          <Button onClick={exportCsv}>Exportar CSV</Button>
          <Button variant="primary" disabled={consultationMode} onClick={() => setCreating(true)}>+ Nueva actividad</Button>
        </div>
      </div>
      <div className="agenda-tabs">
        <button className={`agenda-tab ${tab === 'today' ? 'active' : ''}`} onClick={() => setTab('today')}>Hoy</button>
        <button className={`agenda-tab ${tab === 'week' ? 'active' : ''}`} onClick={() => setTab('week')}>Semana</button>
        <button className={`agenda-tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>Historial</button>
        <div className="agenda-turno-filter" role="group" aria-label="Filtrar por turno">
          {(['completo', 'manana', 'tarde'] as TurnoFilter[]).map(option => (
            <button
              key={option}
              type="button"
              className={`agenda-turno-btn ${turno === option ? 'active' : ''}`}
              onClick={() => setTurno(option)}
            >
              {option === 'completo' ? 'Completo' : option === 'manana' ? 'Mañana' : 'Tarde'}
            </button>
          ))}
        </div>
      </div>
      <AgendaKpis kpis={kpis} activeFilter={kpiFilter} onFilter={toggleKpiFilter} />
      {kpiFilter && (
        <div className="filter-strip">
          <span>Filtro activo: {kpiFilter}</span>
          <button type="button" onClick={() => setKpiFilter(null)}>Limpiar</button>
        </div>
      )}
      {tab === 'week' ? (
        <div className="agenda-week-board">
          {weekGroups.map(group => (
            <section className="agenda-week-day" key={group.day}>
              <h3>{group.day}</h3>
              <div className="agenda-week-list">
                {group.items.map(item => <AgendaCard key={item.id} item={item} consultationMode={consultationMode} onUpdate={(current, patch) => onSave({ ...current, ...patch })} onDelete={id => onDelete(id)} onTask={onTask} />)}
                {!group.items.length && <div className="empty-state">Sin actividades</div>}
              </div>
            </section>
          ))}
        </div>
      ) : tab !== 'history' ? (
        <div className="agenda-cards">
          {filtered.map(item => <AgendaCard key={item.id} item={item} consultationMode={consultationMode} onUpdate={(current, patch) => onSave({ ...current, ...patch })} onDelete={id => onDelete(id)} onTask={onTask} />)}
          {!filtered.length && <div className="empty-state">Sin actividades en el filtro actual.</div>}
        </div>
      ) : (
        <div className="agenda-cards">
          {historyItems.map(item => <AgendaCard key={item.id} item={item} consultationMode={consultationMode} onUpdate={(current, patch) => onSave({ ...current, ...patch })} onDelete={id => onDelete(id)} onTask={onTask} />)}
          {!historyItems.length && <div className="empty-state">Aún no hay actividades realizadas o canceladas.</div>}
        </div>
      )}
      {creating && <AgendaModal onClose={() => setCreating(false)} onSave={onSave} />}
    </section>
  );
}

