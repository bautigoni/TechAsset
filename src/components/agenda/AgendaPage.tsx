import { Fragment, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CalendarCheck, ClipboardList, Download, RefreshCw, Rss } from 'lucide-react';
import type { AgendaItem } from '../../types';
import { restoreAgenda } from '../../services/agendaApi';
import { useMinuteTick } from '../../hooks/useMinuteTick';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { Button, Collapse, EmptyState, Eyebrow, IconButton, Ring, Segmented, StatusSlot, StatusText, TruncatedText, cx, icons, useStatusLine } from '../../ui';
import { addDaysToKey, weekdayOfKey } from '../../utils/formatters';
import { downloadCsv, downloadText } from '../../utils/download';
import { AgendaForm } from './AgendaForm';
import { AgendaLog } from './AgendaLog';
import { AgendaRow, type AgendaActions } from './AgendaRow';
import { AgendaSync } from './AgendaSync';
import { AgendaWeek, type WeekColumn } from './AgendaWeek';
import {
  DAY_SHORT, KPI_DEFS, MONTHS, WEEK_DAYS, applyKpi, byTime, cap1, csvRows, dateOfWeekday, displayTurno, frequentActivities,
  itemDate, kpiCounts, longDate, matchesTurno, occursOn, readClock, referenceMonday, shortLabel, slotsOfDay, statusOf, summaryText,
  weekRangeLabel, type KpiKey, type TurnoFilter
} from './agendaModel';
import '../../styles/screens/agenda.css';

type View = 'dia' | 'semana' | 'mes' | 'hist';
type DayKey = 'Hoy' | (typeof WEEK_DAYS)[number];

const VIEWS: Array<{ value: View; label: string }> = [
  { value: 'dia', label: 'Día' }, { value: 'semana', label: 'Semana' }, { value: 'mes', label: 'Mes' }, { value: 'hist', label: 'Historial' }
];
const TURNOS: TurnoFilter[] = ['Completo', 'Mañana', 'Tarde'];
const errorText = (err: unknown) => (err instanceof Error && err.message ? err.message : 'Error de conexión.');

function monthCells(cursor: string) {
  const first = `${cursor}-01`;
  const offset = (weekdayOfKey(first) + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => addDaysToKey(first, index - offset));
}

function groupByTurno(list: AgendaItem[]) {
  const groups = new Map<string, AgendaItem[]>();
  for (const item of [...list].sort(byTime)) {
    const label = displayTurno(item.turno);
    groups.set(label, [...(groups.get(label) || []), item]);
  }
  const order = (label: string) => (label === 'Mañana' ? 0 : label === 'Tarde' ? 1 : 2);
  return [...groups.entries()].sort((a, b) => order(a[0]) - order(b[0])).map(([label, rows]) => ({ label, rows }));
}

export function AgendaPage({ items, consultationMode, onSave, onDelete, onTask, onRefresh, olderHidden = 0, onLoadOlder }: {
  items: AgendaItem[];
  kpis?: Record<string, number>;
  consultationMode: boolean;
  olderHidden?: number;
  onLoadOlder?: () => Promise<unknown>;
  onSave: (item: Partial<AgendaItem>) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
  onTask: (item: AgendaItem) => Promise<unknown> | void;
  onRefresh?: () => Promise<unknown> | void;
}) {
  // "Hoy", "en curso" y vencidas en hora argentina, recalculados cada minuto.
  const tick = useMinuteTick();
  const clock = useMemo(() => readClock(), [tick]);
  const monday = referenceMonday(clock.today);
  const isWeekend = clock.weekday === 0 || clock.weekday === 6;

  const [view, setView] = useState<View>('dia');
  const [day, setDay] = useState<DayKey>('Hoy');
  const [turno, setTurno] = useState<TurnoFilter>('Completo');
  const [kpi, setKpi] = useState<KpiKey | null>(null);
  const [openId, setOpenId] = useState('');
  const [creating, setCreating] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [monthCursor, setMonthCursor] = useState(() => clock.today.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(clock.today);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [olderLoaded, setOlderLoaded] = useState(false);
  const status = useStatusLine();
  const isNarrow = useMediaQuery('(max-width: 767px)');
  const lastKpiLabel = useRef('');
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // Sin huecos (REGLAS-UX): "Touch por franja" va en la columna de al lado o
  // debajo de la lista, donde deje las dos columnas más parejas. Se decide al
  // cambiar lo que se mira (vista, día, filtros, cantidad de filas) o el ancho,
  // nunca al abrir el detalle de una fila: no salta mientras se trabaja.
  const [capInMain, setCapInMain] = useState(false);
  const capInMainRef = useRef(capInMain);
  capInMainRef.current = capInMain;

  const visible = useMemo(() => items.filter(item => matchesTurno(item, turno)), [items, turno]);
  const itemsOn = useCallback((iso: string) => visible.filter(item => occursOn(item, iso)).sort(byTime), [visible]);
  const todayItems = useMemo(() => itemsOn(clock.today), [itemsOn, clock.today]);
  const dayDate = day === 'Hoy' ? clock.today : dateOfWeekday(day, monday);
  const dayBase = useMemo(() => itemsOn(dayDate), [itemsOn, dayDate]);
  const weekBase = useMemo(() => WEEK_DAYS.map(name => {
    const date = dateOfWeekday(name, monday);
    return { day: name, date, isToday: date === clock.today, items: itemsOn(date) };
  }), [itemsOn, monday, clock.today]);
  const monthBase = useMemo(() => visible.filter(item => itemDate(item, monday) === selectedDate).sort(byTime), [visible, monday, selectedDate]);
  const historyBase = useMemo(() => visible
    .filter(item => item.estado === 'Realizado' || item.estado === 'Cancelado')
    .sort((a, b) => (b.ultimaModificacion || b.createdAt || '').localeCompare(a.ultimaModificacion || a.createdAt || '')), [visible]);

  // Los conteos cuentan lo que se está mirando: el día elegido, la fecha del
  // mes, la semana o el historial (antes, en Día siempre contaban "hoy").
  const kpiBase = view === 'dia' ? dayBase : view === 'mes' ? monthBase : view === 'semana' ? weekBase.flatMap(column => column.items) : historyBase;
  const counts = useMemo(() => kpiCounts(kpiBase, clock), [kpiBase, clock]);
  const dayList = useMemo(() => applyKpi(dayBase, kpi, clock), [dayBase, kpi, clock]);
  const monthList = useMemo(() => applyKpi(monthBase, kpi, clock), [monthBase, kpi, clock]);
  const historyList = useMemo(() => applyKpi(historyBase, kpi, clock), [historyBase, kpi, clock]);
  const weekColumns: WeekColumn[] = useMemo(() => weekBase.map(column => ({ ...column, items: applyKpi(column.items, kpi, clock) })), [weekBase, kpi, clock]);
  const monthCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of applyKpi(visible, kpi, clock)) {
      const iso = itemDate(item, monday);
      if (iso) map.set(iso, (map.get(iso) || 0) + 1);
    }
    return map;
  }, [visible, kpi, clock, monday]);

  const nextToday = todayItems.filter(item => item.estado === 'Pendiente' || item.estado === 'Entregado').slice(0, 4);
  const pendingToday = todayItems.filter(item => item.estado === 'Pendiente').length;
  const frequent = useMemo(() => frequentActivities(items), [items]);
  // La capacidad es de toda la sede (todos los turnos), del día que se mira.
  const capDate = view === 'dia' ? dayDate : view === 'mes' ? selectedDate : isWeekend ? monday : clock.today;
  const capSlots = useMemo(() => slotsOfDay(items, capDate, 'Touch'), [items, capDate]);

  /* ── Acciones ─────────────────────────────────────────────────────────── */

  const run = async <T,>(id: string, kind: string, fn: () => Promise<T>) => {
    setBusy(current => ({ ...current, [id]: kind }));
    try {
      return await fn();
    } finally {
      setBusy(current => { const next = { ...current }; delete next[id]; return next; });
    }
  };

  const revert = async (item: AgendaItem, before: Partial<AgendaItem>) => {
    try {
      await onSave({ id: item.id, ...before });
      status.show({ tone: 'info', message: `Se deshizo el cambio en ${shortLabel(item)}.` });
    } catch (err) {
      status.show({ tone: 'bad', message: `No se pudo deshacer: ${errorText(err)}` });
    }
  };

  const patch: AgendaActions['patch'] = async (item, change, options) => {
    const before: Partial<AgendaItem> = {};
    for (const key of Object.keys(change) as Array<keyof AgendaItem>) (before as Record<string, unknown>)[key] = item[key] ?? '';
    try {
      await run(item.id, options.kind, () => onSave({ id: item.id, ...change }));
      if (options.message) status.show({ tone: 'ok', message: options.message, undo: options.undo ? { onUndo: () => revert(item, before) } : undefined });
      return true;
    } catch (err) {
      status.show({ tone: 'bad', message: `No se pudo guardar ${shortLabel(item)}: ${errorText(err)}`, retry: { onRetry: () => patch(item, change, options) } });
      return false;
    }
  };

  const remove: AgendaActions['remove'] = async item => {
    const short = shortLabel(item);
    try {
      await run(item.id, 'delete', () => onDelete(item.id));
      setOpenId('');
      status.show({
        tone: 'ok',
        message: `${short} borrada de la agenda.`,
        undo: {
          onUndo: async () => {
            try {
              await restoreAgenda(item.id, '');
              await onRefresh?.();
              status.show({ tone: 'info', message: `${short} volvió a la agenda.` });
            } catch (err) {
              status.show({ tone: 'bad', message: `No se pudo restaurar: ${errorText(err)}` });
            }
          }
        }
      });
      return true;
    } catch (err) {
      status.show({ tone: 'bad', message: `No se pudo borrar ${short}: ${errorText(err)}` });
      return false;
    }
  };

  const createTask: AgendaActions['createTask'] = async item => {
    try {
      // Crea "Revisar {curso} - {actividad}" y lleva a Tareas (App).
      await run(item.id, 'task', async () => { await onTask(item); });
    } catch (err) {
      status.show({ tone: 'bad', message: `No se pudo crear la tarea: ${errorText(err)}` });
    }
  };

  const edit: AgendaActions['edit'] = async (item, payload) => {
    const change: Partial<AgendaItem> = {};
    const before: Partial<AgendaItem> = {};
    for (const [key, value] of Object.entries(payload) as Array<[keyof AgendaItem, unknown]>) {
      if (String(item[key] ?? '') === String(value ?? '')) continue;
      (change as Record<string, unknown>)[key] = value;
      (before as Record<string, unknown>)[key] = item[key] ?? '';
    }
    if (!Object.keys(change).length) return;
    await onSave({ id: item.id, ...change });
    status.show({ tone: 'ok', message: `Actividad actualizada: ${shortLabel({ ...item, ...change } as AgendaItem)}.`, undo: { onUndo: () => revert(item, before) } });
  };

  const actions: AgendaActions = { consultation: consultationMode, items, clock, frequent, busy, patch, remove, createTask, edit };

  const create = async (payload: Partial<AgendaItem>) => {
    const created = (await onSave({ ...payload, estado: 'Pendiente' })) as AgendaItem | undefined;
    setCreating(false);
    setKpi(null);
    if (payload.turno && !matchesTurno(payload as AgendaItem, turno)) setTurno('Completo');
    const date = payload.fecha || dateOfWeekday(payload.dia || '', monday);
    if (payload.fecha && (payload.fecha < monday || payload.fecha > addDaysToKey(monday, 4))) {
      setView('mes');
      setMonthCursor(payload.fecha.slice(0, 7));
      setSelectedDate(payload.fecha);
    } else {
      setView('dia');
      const name = WEEK_DAYS.find(entry => entry === payload.dia);
      setDay(date === clock.today || !name ? 'Hoy' : name);
    }
    if (created?.id) setOpenId(created.id);
    status.show({ tone: 'ok', message: `Actividad creada: ${payload.curso} · ${payload.actividad || 'Actividad'} · ${payload.fecha ? longDate(payload.fecha) : DAY_SHORT[payload.dia || ''] || payload.dia} ${payload.desde}–${payload.hasta}.` });
  };

  const exportSource = view === 'mes' ? monthList : view === 'semana' ? weekColumns.flatMap(column => column.items) : view === 'hist' ? historyList : dayList;
  const copySummary = async () => {
    if (!exportSource.length) { status.show({ tone: 'warn', message: 'No hay actividades en lo que estás mirando para copiar.' }); return; }
    const text = summaryText(exportSource);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('sin portapapeles');
      await navigator.clipboard.writeText(text);
      status.show({ tone: 'ok', message: `Resumen copiado: ${exportSource.length} ${exportSource.length === 1 ? 'línea' : 'líneas'} (día, horario, curso, actividad, equipos y estado).` });
    } catch {
      downloadText('agenda-resumen.txt', text);
      status.show({ tone: 'info', message: 'No se pudo usar el portapapeles: se descargó agenda-resumen.txt.' });
    }
  };
  const exportCsv = () => {
    // Si lo que se mira está vacío, exporta toda la agenda (como siempre).
    const rows = exportSource.length ? exportSource : items;
    downloadCsv('agenda-tic.csv', csvRows(rows));
    status.show({ tone: 'ok', message: `Se descargó agenda-tic.csv con ${rows.length} ${rows.length === 1 ? 'fila' : 'filas'}.` });
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh?.();
    } catch (err) {
      status.show({ tone: 'bad', message: `No se pudo actualizar la agenda: ${errorText(err)}`, retry: { onRetry: refresh } });
    } finally {
      setRefreshing(false);
    }
  };

  const loadOlder = async () => {
    if (!onLoadOlder) return;
    setOlderLoading(true);
    try {
      await onLoadOlder();
      setOlderLoaded(true);
    } catch (err) {
      status.show({ tone: 'bad', message: `No se pudieron traer las anteriores: ${errorText(err)}` });
    } finally {
      setOlderLoading(false);
    }
  };

  const toggle = (id: string) => setOpenId(current => (current === id ? '' : id));
  const goToItem = (item: AgendaItem, target: DayKey) => {
    setView('dia');
    setDay(target);
    setKpi(null);
    setOpenId(item.id);
    requestAnimationFrame(() => document.querySelector(`.ag-list [data-agenda-id="${CSS.escape(item.id)}"]`)?.scrollIntoView({ block: 'nearest' }));
  };

  /* ── Textos ───────────────────────────────────────────────────────────── */

  const [monthYear, monthNumber] = monthCursor.split('-').map(Number);
  const monthLabel = `${cap1(MONTHS[monthNumber - 1])} ${monthYear}`;
  const headTitle = view === 'dia'
    ? day === 'Hoy' ? `Hoy, ${longDate(clock.today)}` : cap1(longDate(dayDate))
    : view === 'semana' ? 'Semana de lunes a viernes' : view === 'mes' ? `Mes de ${MONTHS[monthNumber - 1]}` : 'Historial';
  const listItems = view === 'mes' ? monthList : dayList;
  const listTitle = view === 'mes' ? cap1(longDate(selectedDate)) : day === 'Hoy' ? `Hoy · ${longDate(clock.today)}` : cap1(longDate(dayDate));
  const kpiLabel = KPI_DEFS.find(def => def.key === kpi)?.label || '';
  if (kpiLabel) lastKpiLabel.current = kpiLabel;
  const filterSummary = `Turno ${turno.toLowerCase()} · ${kpi ? kpiLabel : 'todas las actividades'}`;
  const tools = (
    <div className="ag-card-tools">
      <Button size="sm" variant="ghost" icon={<ClipboardList size={15} />} onClick={copySummary}>Copiar resumen</Button>
      <Button size="sm" variant="ghost" icon={<Download size={15} />} onClick={exportCsv}>Exportar CSV</Button>
    </div>
  );

  const balanceKey = `${view}|${day}|${selectedDate}|${turno}|${kpi}|${listItems.length}|${historyList.length}|${capSlots.length}|${nextToday.length}|${olderLoaded}`;
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const decide = () => {
      const main = body.querySelector<HTMLElement>('.ag-main');
      const side = body.querySelector<HTMLElement>('.ag-side');
      const cap = body.querySelector<HTMLElement>('.ag-cap-card');
      if (!main || !side || !cap) return;
      // Una sola columna (angosto o Semana a todo el ancho): va al costado, que ya cae abajo.
      if (Math.abs(side.offsetTop - main.offsetTop) > 4) { if (capInMainRef.current) setCapInMain(false); return; }
      const gap = parseFloat(getComputedStyle(main).rowGap) || 0;
      const inMain = capInMainRef.current;
      const capH = cap.offsetHeight + gap;
      const mainH = main.offsetHeight - (inMain ? capH : 0);
      const sideH = side.offsetHeight - (inMain ? 0 : capH);
      const atSide = Math.abs(mainH - (sideH + capH));
      const below = Math.abs(mainH + capH - sideH);
      const next = inMain ? below <= atSide + 24 : below < atSide - 24;
      if (next !== inMain) setCapInMain(next);
    };
    decide();
    let width = body.clientWidth;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (Math.abs(body.clientWidth - width) < 1) return;
      width = body.clientWidth;
      decide();
    });
    observer?.observe(body);
    return () => observer?.disconnect();
  }, [balanceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const capCard = (
    <section className="ag-card ag-cap-card" aria-label="Touch por franja">
      <div className="ag-card-head ag-card-head--stack">
        <h3 className="ag-h3">Touch por franja · {longDate(capDate)}</h3>
        <span className="ag-head-sub">Tope 25 sumando las actividades que se superponen</span>
      </div>
      {capSlots.map(slot => (
        <div key={slot.key} className="ag-slot">
          <Ring value={Math.max(0, slot.libres)} total={slot.max} size={32} unit={`Touch libres de ${slot.key}`} />
          <span className={cx('ag-cap-num', 'g-num', slot.libres <= 0 ? 'is-bad' : slot.libres / slot.max <= 0.2 && 'is-warn')}>{Math.max(0, slot.libres)}</span>
          <span className="ag-slot-text">
            <span className="ag-time g-num">{slot.key}</span>
            <TruncatedText className="ag-what" lines={2}>{slot.users.map(user => `${user.curso} ${user.cantidad}`).join(' · ')}</TruncatedText>
          </span>
        </div>
      ))}
      {!capSlots.length && <EmptyState compact className="ag-empty-state" icon={<CalendarCheck size={18} strokeWidth={1.6} />} title="Ese día no hay Touch reservadas." />}
      <p className="ag-note-small ag-inset">El número es cuántas quedan libres. TIC, Plani y Dell tienen tope 99. Al crear o editar una actividad se avisa antes de guardar si no hay lugar.</p>
    </section>
  );

  const listEmpty = view === 'dia' && day === 'Hoy' && isWeekend && !dayList.length ? (
    <EmptyState
      title={`Hoy es ${clock.todayName.toLowerCase()}: la agenda es de lunes a viernes.`}
      description="Lo que viene arranca el lunes."
      action={<Button size="sm" variant="secondary" onClick={() => setDay('Lunes')}>Ver el lunes</Button>}
    />
  ) : (
    <EmptyState
      compact
      className="ag-empty-state"
      icon={<CalendarCheck size={18} strokeWidth={1.6} />}
      title={view === 'mes' ? 'Sin actividades para este día.' : kpi || turno !== 'Completo' ? 'Sin actividades en el filtro actual.' : 'Sin actividades para este día.'}
      action={kpi || turno !== 'Completo'
        ? <Button size="sm" variant="secondary" onClick={() => { setKpi(null); setTurno('Completo'); }}>Ver todas</Button>
        : !consultationMode && !creating ? <Button size="sm" variant="secondary" icon={<icons.IconPlus size={14} />} onClick={() => setCreating(true)}>Nueva actividad</Button> : undefined}
    />
  );

  return (
    <section className="ag-page" aria-labelledby="ag-title">
      <header className="ag-head">
        <div className="ag-head-text">
          <Eyebrow>{weekRangeLabel(monday)}</Eyebrow>
          <h2 id="ag-title" className="ag-title">{headTitle}</h2>
          <p className="ag-head-sub">
            <b className="g-num">{todayItems.length}</b> hoy · <b className="g-num">{visible.length}</b> visibles · <b className="g-num">{pendingToday}</b> pendientes
          </p>
        </div>
        <div className="ag-head-actions">
          <Button variant="ghost" className="ag-refresh" icon={<RefreshCw size={16} />} loading={refreshing} aria-label="Actualizar la agenda" onClick={refresh}>Actualizar</Button>
          <Button variant="secondary" icon={<Rss size={16} />} aria-expanded={syncOpen} onClick={() => setSyncOpen(value => !value)}>Sincronizar</Button>
          {!consultationMode && (
            <Button variant="primary" icon={<icons.IconPlus size={16} />} aria-expanded={creating} onClick={() => setCreating(value => !value)}>Nueva actividad</Button>
          )}
        </div>
      </header>

      <Collapse open={syncOpen}>
        <AgendaSync onClose={() => setSyncOpen(false)} />
      </Collapse>
      <Collapse open={creating && !consultationMode} unmountOnClose>
        <section className="ag-card">
          <AgendaForm items={items} clock={clock} frequent={frequent} onSubmit={create} onCancel={() => setCreating(false)} />
        </section>
      </Collapse>

      <div className="ag-controls">
        <Segmented<View> ariaLabel="Vista" value={view} onChange={next => { setView(next); setOpenId(''); }} options={VIEWS} />
        <Segmented<string>
          ariaLabel="Día"
          value={view === 'dia' ? day : ''}
          onChange={next => { setDay(next as DayKey); setView('dia'); setOpenId(''); }}
          options={[{ value: 'Hoy', label: 'Hoy' }, ...WEEK_DAYS.map(name => ({ value: name, label: DAY_SHORT[name] }))]}
        />
      </div>

      <div className={cx('ag-filters', filtersOpen && 'is-open')}>
        <button type="button" className="ag-filt-toggle" aria-expanded={filtersOpen} aria-controls="ag-filters-body" onClick={() => setFiltersOpen(value => !value)}>
          <span className="ag-filt-name">Filtros</span>
          <span className="ag-filt-sum">{filterSummary}</span>
          <icons.IconChevronDown size={16} className="ag-chev" />
        </button>
        {/* En mobile los filtros se pliegan detrás de su botón (colapso compartido); en ancho están siempre. */}
        <Collapse open={!isNarrow || filtersOpen} className="ag-filters-body" id="ag-filters-body" reveal={isNarrow}>
          <Segmented<TurnoFilter> ariaLabel="Turno" value={turno} onChange={setTurno} options={TURNOS.map(value => ({ value, label: value }))} />
          <div className="ag-kpis" role="group" aria-label="Contar y filtrar">
            {KPI_DEFS.map(def => {
              const on = kpi === def.key || (def.key === 'total' && !kpi);
              const n = counts[def.key];
              return (
                <button
                  key={def.key}
                  type="button"
                  className={cx('ag-kpi', on && 'is-on')}
                  aria-pressed={def.key === 'total' ? !kpi : kpi === def.key}
                  onClick={() => setKpi(current => (def.key === 'total' || current === def.key ? null : def.key))}
                >
                  <span className="ag-kpi-label">{def.label}</span>
                  <span className={cx('ag-kpi-n', 'g-num', def.key === 'venc' && n > 0 && 'is-bad')}>{n}</span>
                </button>
              );
            })}
          </div>
        </Collapse>
        <Collapse open={Boolean(kpi)} unmountOnClose>
          <div className="ag-filtering" role="status">
            <span>Filtrando por <b>{kpiLabel || lastKpiLabel.current}</b></span>
            <Button size="sm" variant="ghost" className="ag-link-btn" onClick={() => setKpi(null)}>Limpiar</Button>
          </div>
        </Collapse>
      </div>

      <div className="ag-body" ref={bodyRef}>
        <div className={cx('ag-main', view === 'semana' && 'is-wide')}>
          <StatusSlot status={status} />

          {view === 'mes' && (
            <section className="ag-card" aria-label="Mes">
              <div className="ag-card-head">
                <h3 className="ag-h3">{monthLabel}</h3>
                <IconButton size="sm" label="Mes anterior" icon={<icons.IconChevronLeft size={16} />} onClick={() => setMonthCursor(addDaysToKey(`${monthCursor}-01`, -1).slice(0, 7))} />
                <IconButton size="sm" label="Mes siguiente" icon={<icons.IconChevronRight size={16} />} onClick={() => setMonthCursor(addDaysToKey(`${monthCursor}-01`, 32).slice(0, 7))} />
                <span className="ag-spacer" />
                <Button size="sm" variant="secondary" onClick={() => { setMonthCursor(clock.today.slice(0, 7)); setSelectedDate(clock.today); }}>Hoy</Button>
              </div>
              <div className="ag-month">
                <div className="ag-month-grid" aria-hidden="true">
                  {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(label => <span key={label} className="ag-month-dow">{label}</span>)}
                </div>
                <div className="ag-month-grid" role="group" aria-label={monthLabel}>
                  {monthCells(monthCursor).map(iso => {
                    const n = monthCounts.get(iso) || 0;
                    const outside = iso.slice(0, 7) !== monthCursor;
                    const isToday = iso === clock.today;
                    const selected = iso === selectedDate;
                    return (
                      <button
                        key={iso}
                        type="button"
                        className={cx('ag-month-day', outside && 'is-outside', isToday && 'is-today', selected && 'is-selected')}
                        aria-pressed={selected}
                        aria-current={isToday ? 'date' : undefined}
                        aria-label={`${longDate(iso)}${n ? `, ${n} ${n === 1 ? 'actividad' : 'actividades'}` : ', sin actividades'}${isToday ? ', hoy' : ''}`}
                        onClick={() => { setSelectedDate(iso); setOpenId(''); }}
                      >
                        <span className="ag-month-n g-num">{Number(iso.slice(8))}</span>
                        {n > 0 && <span className="ag-month-c g-num">{n}</span>}
                      </button>
                    );
                  })}
                </div>
                <p className="ag-note-small">Las actividades semanales se muestran en la semana en curso.</p>
              </div>
            </section>
          )}

          {(view === 'dia' || view === 'mes') && (
            <section className="ag-card ag-list" aria-label="Actividades">
              <div className="ag-card-head">
                <div className="ag-list-title">
                  <h3 className="ag-h3 ag-h3--lg">{listTitle}</h3>
                  <span className="ag-head-sub"><span className="g-num">{listItems.length}</span> {listItems.length === 1 ? 'actividad' : 'actividades'}</span>
                </div>
                {tools}
              </div>
              {listItems.length > 0 && (
                <div className="ag-colhead" aria-hidden="true">
                  <span>Horario</span><span>Curso y actividad</span><span>Equipos</span><span>Estado</span><span /><span className="ag-colhead-act">Acciones</span>
                </div>
              )}
              {groupByTurno(listItems).map(group => (
                <Fragment key={group.label}>
                  <div className="ag-group"><Eyebrow>{group.label}</Eyebrow><span className="ag-group-n g-num">{group.rows.length}</span></div>
                  {group.rows.map(item => <AgendaRow key={item.id} item={item} open={openId === item.id} onToggle={toggle} actions={actions} />)}
                </Fragment>
              ))}
              {!listItems.length && listEmpty}
            </section>
          )}

          {view === 'semana' && (
            <section className="ag-week-wrap" aria-label="Semana">
              <div className="ag-week-bar">
                <span className="ag-muted">Lunes a viernes, agrupado por día. Tocá una actividad para ver el detalle.</span>
                {tools}
              </div>
              <AgendaWeek columns={weekColumns} openId={openId} onToggle={toggle} actions={actions} onOpenDay={(item, name) => goToItem(item, dateOfWeekday(name, monday) === clock.today ? 'Hoy' : name as DayKey)} />
            </section>
          )}

          {view === 'hist' && (
            <>
              <section className="ag-card ag-list" aria-label="Realizadas y canceladas">
                <div className="ag-card-head">
                  <div className="ag-list-title">
                    <h3 className="ag-h3 ag-h3--lg">Realizadas y canceladas</h3>
                    <span className="ag-head-sub">más recientes primero</span>
                  </div>
                  {tools}
                </div>
                {historyList.map(item => <AgendaRow key={item.id} item={item} open={openId === item.id} onToggle={toggle} actions={actions} showDay />)}
                {!historyList.length && <EmptyState compact className="ag-empty-state" icon={<CalendarCheck size={18} strokeWidth={1.6} />} title="Aún no hay actividades realizadas o canceladas." />}
                {(olderHidden > 0 || olderLoaded) && (
                  <div className="ag-card-foot ag-older">
                    <span className="ag-muted">
                      {olderHidden > 0
                        ? <>Hay <b className="g-num">{olderHidden}</b> {olderHidden === 1 ? 'actividad terminada' : 'actividades terminadas'} de hace más de 4 meses.</>
                        : 'Mostrando también las terminadas de hace más de 4 meses.'}
                    </span>
                    {olderHidden > 0 && onLoadOlder && <Button size="sm" variant="secondary" loading={olderLoading} onClick={loadOlder}>Ver anteriores</Button>}
                  </div>
                )}
              </section>
              <AgendaLog version={`${items.length}|${items.reduce((last, item) => (item.ultimaModificacion && item.ultimaModificacion > last ? item.ultimaModificacion : last), '')}`} />
            </>
          )}
          {capInMain && capCard}
        </div>

        <aside className="ag-side" aria-label="Hoy y disponibilidad">
          <section className="ag-card" aria-label="Próximas de hoy">
            <div className="ag-card-head">
              <h3 className="ag-h3">Próximas de hoy</h3>
              <span className="ag-head-sub">pendientes y entregadas</span>
            </div>
            {nextToday.map(item => {
              const st = statusOf(item, clock);
              return (
                <button key={item.id} type="button" className="ag-next" onClick={() => goToItem(item, 'Hoy')}>
                  <span className="ag-time g-num">{item.desde}–{item.hasta}</span>
                  <TruncatedText className="ag-next-label">{`${item.curso} · ${item.actividad}`}</TruncatedText>
                  <StatusText tone={st.tone}>{st.label}</StatusText>
                </button>
              );
            })}
            {!nextToday.length && <p className="ag-empty ag-empty--left">No hay actividades pendientes o entregadas para hoy.</p>}
          </section>

          {!capInMain && capCard}
        </aside>
      </div>
    </section>
  );
}
