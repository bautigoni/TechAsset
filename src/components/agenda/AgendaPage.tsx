import { useMemo, useState } from 'react';
import { CalendarPlus, Clipboard, RefreshCw, Rss } from 'lucide-react';
import type { AgendaItem } from '../../types';
import { getAgendaCalendarFeed, rotateAgendaCalendarFeed } from '../../services/agendaApi';
import { Button } from '../layout/Button';
import { Modal } from '../layout/Modal';
import { type AgendaKpiFilter, AgendaKpis } from './AgendaKpis';
import { AgendaCard } from './AgendaCard';
import { AgendaModal } from './AgendaModal';

const DAYS = ['Hoy', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie'];
const DAY_MAP: Record<string, string> = { Lun: 'Lunes', Mar: 'Martes', Mie: 'Miércoles', Jue: 'Jueves', Vie: 'Viernes' };
const WEEK_DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
const MONTH_WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

type TurnoFilter = 'completo' | 'manana' | 'tarde';
type AgendaTab = 'today' | 'week' | 'month' | 'history';

function comparableDay(value: string) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/^mi.*rcoles$/, 'miercoles');
}

function todayName() {
  const index = new Date().getDay();
  return ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][index] || '';
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function matchesTurno(item: AgendaItem, turno: TurnoFilter) {
  if (turno === 'completo') return true;
  const v = String(item.turno || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (turno === 'manana') return v === 'manana';
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

function itemDate(item: AgendaItem) {
  if (item.fecha) return item.fecha;
  const wanted = WEEK_DAYS.find(day => comparableDay(day) === comparableDay(item.dia));
  if (!wanted) return '';
  const wantedIndex = WEEK_DAYS.indexOf(wanted) + 1;
  const base = new Date();
  const current = base.getDay() || 7;
  base.setDate(base.getDate() + wantedIndex - current);
  return base.toISOString().slice(0, 10);
}

function monthMatrix(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - startOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return {
      date: day,
      iso: day.toISOString().slice(0, 10),
      inMonth: day.getMonth() === month,
      isToday: day.toISOString().slice(0, 10) === todayIso()
    };
  });
}

export function AgendaPage({ items, consultationMode, onSave, onDelete, onTask, onRefresh }: { items: AgendaItem[]; kpis?: Record<string, number>; consultationMode: boolean; onSave: (item: Partial<AgendaItem>) => Promise<unknown>; onDelete: (id: string) => Promise<unknown>; onTask: (item: AgendaItem) => void; onRefresh?: () => Promise<unknown> | void }) {
  const [day, setDay] = useState('Hoy');
  const [tab, setTab] = useState<AgendaTab>('today');
  const [turno, setTurno] = useState<TurnoFilter>('completo');
  const [kpiFilter, setKpiFilter] = useState<AgendaKpiFilter | null>(null);
  const [creating, setCreating] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [feedUrl, setFeedUrl] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [selectedDate, setSelectedDate] = useState(todayIso());

  const itemsByTurno = useMemo(() => items.filter(item => matchesTurno(item, turno)), [items, turno]);

  const todayItems = useMemo(() => {
    const target = comparableDay(todayName());
    const iso = todayIso();
    return itemsByTurno.filter(item => {
      if (item.fecha) return item.fecha === iso;
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
    const iso = todayIso();
    const byDay = targetDay ? itemsByTurno.filter(item => {
      if (item.fecha) return day === 'Hoy' ? item.fecha === iso : comparableDay(item.dia) === targetDay;
      return comparableDay(item.dia) === targetDay;
    }) : [];
    return applyKpiFilter(byDay);
  }, [day, itemsByTurno, kpiFilter]);

  const weekGroups = useMemo(() => WEEK_DAYS.map(weekDay => ({
    day: weekDay,
    items: applyKpiFilter(itemsByTurno.filter(item => comparableDay(item.dia) === comparableDay(weekDay))).sort((a, b) => `${a.desde}${a.curso}`.localeCompare(`${b.desde}${b.curso}`))
  })), [itemsByTurno, kpiFilter]);

  const monthDays = useMemo(() => monthMatrix(), []);
  const eventsByDate = useMemo(() => {
    const map = new Map<string, AgendaItem[]>();
    for (const item of applyKpiFilter(itemsByTurno)) {
      const iso = itemDate(item);
      if (!iso) continue;
      const list = map.get(iso) || [];
      list.push(item);
      map.set(iso, list);
    }
    return map;
  }, [itemsByTurno, kpiFilter]);

  const selectedDateItems = useMemo(() => (eventsByDate.get(selectedDate) || []).sort((a, b) => `${a.desde}${a.curso}`.localeCompare(`${b.desde}${b.curso}`)), [eventsByDate, selectedDate]);

  const historyItems = useMemo(() => applyKpiFilter(itemsByTurno.filter(item => item.estado === 'Realizado' || item.estado === 'Cancelado')).sort((a, b) => (b.ultimaModificacion || b.createdAt || '').localeCompare(a.ultimaModificacion || a.createdAt || '')), [itemsByTurno, kpiFilter]);

  const kpis = useMemo(() => {
    if (tab === 'today') return computeKpis(todayItems);
    if (tab === 'month') return computeKpis(selectedDateItems);
    return computeKpis(itemsByTurno);
  }, [tab, todayItems, selectedDateItems, itemsByTurno]);

  const toggleKpiFilter = (filter: AgendaKpiFilter) => setKpiFilter(current => current === filter || filter === 'total' ? null : filter);
  const copySummary = async () => {
    const source = tab === 'month' ? selectedDateItems : filtered;
    const text = agendaSummary(source);
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else downloadText('agenda-resumen.txt', text);
  };
  const exportCsv = () => downloadText('agenda-tic.csv', agendaCsv(filtered.length ? filtered : items), 'text/csv;charset=utf-8');

  const openSync = async () => {
    setSyncOpen(true);
    setSyncMessage('');
    try {
      const response = await getAgendaCalendarFeed();
      setFeedUrl(response.feedUrl);
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : 'No se pudo generar el enlace.');
    }
  };

  const rotateSync = async () => {
    setSyncMessage('');
    try {
      const response = await rotateAgendaCalendarFeed();
      setFeedUrl(response.feedUrl);
      setSyncMessage('Enlace regenerado. El link anterior deja de actualizarse.');
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : 'No se pudo regenerar el enlace.');
    }
  };

  const copyFeed = async () => {
    if (!feedUrl) return;
    await navigator.clipboard?.writeText(feedUrl);
    setSyncMessage('Enlace copiado.');
  };

  return (
    <section className="view active agenda-view">
      <div className="agenda-hero">
        <div>
          <span className="section-eyebrow">Agenda institucional</span>
          <h2>Agenda TIC</h2>
          <p>{itemsByTurno.length} actividades visibles. Coordiná reservas, entregas y seguimiento del día.</p>
        </div>
        <div className="agenda-hero-actions">
          <Button onClick={() => onRefresh?.()}><RefreshCw size={16} /> Actualizar</Button>
          <Button onClick={openSync}><Rss size={16} /> Sincronizar</Button>
          <Button variant="primary" disabled={consultationMode} onClick={() => setCreating(true)}><CalendarPlus size={16} /> Nueva actividad</Button>
        </div>
      </div>

      <div className="agenda-control-band">
        <div className="agenda-day-selector">
          {DAYS.map(item => <button key={item} className={`day-btn agenda-day-btn ${day === item ? 'active' : ''}`} onClick={() => { setDay(item); setTab('today'); }}>{item}</button>)}
        </div>
        <div className="agenda-view-tabs" role="tablist">
          {(['today', 'week', 'month', 'history'] as AgendaTab[]).map(option => (
            <button key={option} className={`agenda-tab ${tab === option ? 'active' : ''}`} onClick={() => setTab(option)}>
              {option === 'today' ? 'Día' : option === 'week' ? 'Semana' : option === 'month' ? 'Mes' : 'Historial'}
            </button>
          ))}
        </div>
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

      <div className="agenda-secondary-actions">
        <Button onClick={copySummary}><Clipboard size={16} /> Copiar resumen</Button>
        <Button onClick={exportCsv}>Exportar CSV</Button>
      </div>

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
      ) : tab === 'month' ? (
        <div className="agenda-month-layout">
          <section className="agenda-month-card">
            <div className="agenda-month-head">
              <h3>{new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}</h3>
              <Button onClick={() => setSelectedDate(todayIso())}>Hoy</Button>
            </div>
            <div className="agenda-month-grid">
              {MONTH_WEEKDAYS.map(label => <span className="agenda-month-weekday" key={label}>{label}</span>)}
              {monthDays.map(dayInfo => {
                const dayItems = eventsByDate.get(dayInfo.iso) || [];
                return (
                  <button
                    key={dayInfo.iso}
                    type="button"
                    className={`agenda-month-day ${dayInfo.inMonth ? '' : 'muted-day'} ${dayInfo.isToday ? 'today' : ''} ${selectedDate === dayInfo.iso ? 'selected' : ''}`}
                    onClick={() => setSelectedDate(dayInfo.iso)}
                  >
                    <strong>{dayInfo.date.getDate()}</strong>
                    {dayItems.length > 0 && <span>{dayItems.length}</span>}
                  </button>
                );
              })}
            </div>
          </section>
          <section className="agenda-selected-day">
            <div className="card-head">
              <div>
                <h3>{new Date(`${selectedDate}T12:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
                <span className="muted">{selectedDateItems.length} actividades</span>
              </div>
            </div>
            <div className="agenda-cards">
              {selectedDateItems.map(item => <AgendaCard key={item.id} item={item} consultationMode={consultationMode} onUpdate={(current, patch) => onSave({ ...current, ...patch })} onDelete={id => onDelete(id)} onTask={onTask} />)}
              {!selectedDateItems.length && <div className="empty-state">Sin actividades para este día.</div>}
            </div>
          </section>
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
      {syncOpen && (
        <Modal title="Sincronizar calendario" onClose={() => setSyncOpen(false)}>
          <div className="calendar-sync-modal">
            <p className="muted">Generá un enlace personal para suscribirte desde Google Calendar, Outlook o Apple Calendar. Es solo lectura y respeta la sede activa.</p>
            <label>Enlace ICS
              <input className="input" readOnly value={feedUrl || 'Generando enlace...'} />
            </label>
            <div className="actions">
              <Button variant="primary" disabled={!feedUrl} onClick={copyFeed}>Copiar enlace</Button>
              <Button disabled={!feedUrl} onClick={() => window.open(`https://calendar.google.com/calendar/u/0/r/settings/addbyurl`, '_blank', 'noopener,noreferrer')}>Abrir Google Calendar</Button>
              <Button disabled={!feedUrl} onClick={rotateSync}>Regenerar</Button>
            </div>
            {syncMessage && <div className={syncMessage.includes('No se') ? 'tool-error' : 'tool-info'}>{syncMessage}</div>}
            <ol className="calendar-sync-steps">
              <li>Copiá el enlace.</li>
              <li>En Google Calendar abrí “Agregar calendario por URL”.</li>
              <li>Pegá el enlace y guardá.</li>
            </ol>
          </div>
        </Modal>
      )}
    </section>
  );
}
