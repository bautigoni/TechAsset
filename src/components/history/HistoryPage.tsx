import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Device } from '../../types';
import { Button, DateRange, EmptyState, ErrorState, IconButton, Input, SectionHeader, Segmented, SkeletonRows, StatusText, Tabs, icons, useStatusLine } from '../../ui';
import { downloadHistoryCsv, getHistoryDeviceSummary, getLoanHistory, getMovementHistory, type HistoryFilters, type LoanHistoryItem, type MovementHistoryItem } from '../../services/historyApi';
import { getOperationalAlias } from '../../utils/classifyDevice';
import { APP_TIME_ZONE, addDaysToKey, dateFormatter, dayKeyAr, todayKeyAr } from '../../utils/formatters';
import { resolveAliasTags } from '../../utils/deviceSearch';
import { errorMessage } from '../layout/Feedback';
import { aliasOf, deviceKind, shortWhen, stateLabel, stateTone } from '../devices/deviceView';
import { clearHistorySeed, peekHistorySeed } from './historySeed';
import '../../styles/screens/history.css';

type Kind = 'loans' | 'all';
type Item = LoanHistoryItem | MovementHistoryItem;
const PAGE = 50;

const TIME_AR: Intl.DateTimeFormatOptions = { timeZone: APP_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
const DAY_AR: Intl.DateTimeFormatOptions = { timeZone: APP_TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long' };
const DAY_YEAR_AR: Intl.DateTimeFormatOptions = { timeZone: APP_TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };

function timeOf(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : dateFormatter(TIME_AR, 'es-AR').format(date);
}

function dayTitle(value: string, key: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return key;
  const sameYear = key.slice(0, 4) === todayKeyAr().slice(0, 4);
  const text = dateFormatter(sameYear ? DAY_AR : DAY_YEAR_AR, 'es-AR').format(date).replace(',', '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function tipoLabel(tipo: string) {
  if (tipo === 'prestamo') return 'Préstamo';
  if (tipo === 'devolucion') return 'Devolución';
  return tipo;
}

/**
 * Historial con filtros: quién tuvo un equipo, qué se llevó un curso, qué pasó
 * un día. Agrupado por día en hora de la sede, pagina hacia atrás con
 * "Cargar más" (cursor) y exporta TODO lo filtrado desde el server. La
 * búsqueda entiende los alias (touch34, 34touch, plani 5) y las etiquetas.
 */
export function HistoryPage({ devices, onProfile }: { devices: Device[]; onProfile?: (device: Device) => void }) {
  const [kind, setKind] = useState<Kind>('loans');
  const [q, setQ] = useState(() => peekHistorySeed());
  useEffect(() => { clearHistorySeed(); }, []);
  const [debouncedQ, setDebouncedQ] = useState(q.trim());
  const [range, setRange] = useState({ from: '', to: '' });
  const [tipo, setTipo] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [openRow, setOpenRow] = useState('');
  const [reload, setReload] = useState(0);
  const requestId = useRef(0);
  const exportStatus = useStatusLine();

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [q]);

  // El server busca con LIKE: los alias y las etiquetas se resuelven acá con
  // la búsqueda flexible y viajan como `tags`.
  const tags = useMemo(() => resolveAliasTags(devices, debouncedQ).join(','), [devices, debouncedQ]);
  const filters: HistoryFilters = useMemo(() => ({ q: debouncedQ, tags, from: range.from, to: range.to, tipo: kind === 'loans' ? tipo : '', limit: PAGE }), [debouncedQ, tags, range.from, range.to, tipo, kind]);

  // Cada cambio de filtro arranca de cero; una respuesta vieja que llega tarde
  // (se tipeó rápido) se descarta por requestId.
  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    setOpenRow('');
    const load = kind === 'loans' ? getLoanHistory(filters) : getMovementHistory(filters);
    load.then(response => {
      if (id !== requestId.current) return;
      setItems(response.items);
      setCursor(response.nextCursor);
    }).catch(reason => {
      if (id === requestId.current) setError(errorMessage(reason, 'No se pudo cargar el historial.'));
    }).finally(() => {
      if (id === requestId.current) setLoading(false);
    });
  }, [kind, filters, reload]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    const id = requestId.current;
    setLoadingMore(true);
    try {
      const response = kind === 'loans' ? await getLoanHistory({ ...filters, before: cursor }) : await getMovementHistory({ ...filters, before: cursor });
      if (id !== requestId.current) return;
      setItems(current => [...current, ...response.items]);
      setCursor(response.nextCursor);
    } catch (reason) {
      if (id === requestId.current) setError(errorMessage(reason, 'No se pudo cargar más.'));
    } finally {
      setLoadingMore(false);
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const { name, rows } = await downloadHistoryCsv(kind, filters);
      exportStatus.show({ tone: 'ok', message: <>Se descargó <span className="ui-mono">{name}</span> con {rows} {rows === 1 ? 'movimiento' : 'movimientos'} (todo lo filtrado, con BOM).</> });
    } catch (reason) {
      exportStatus.show({ tone: 'bad', message: errorMessage(reason, 'No se pudo exportar el historial.') });
    } finally {
      setExporting(false);
    }
  };

  const byTag = useMemo(() => new Map(devices.map(device => [device.etiqueta.toUpperCase(), device])), [devices]);
  const hasFilters = Boolean(q || range.from || range.to || (kind === 'loans' && tipo));
  const clearFilters = () => { setQ(''); setRange({ from: '', to: '' }); setTipo(''); };

  // Agrupado por día (hora argentina): encabezado con Hoy/Ayer y cuántos hay.
  const groups = useMemo(() => {
    const list: Array<{ key: string; title: string; items: Item[] }> = [];
    for (const item of items) {
      const key = dayKeyAr(item.timestamp) || 'sin-fecha';
      const last = list[list.length - 1];
      if (last && last.key === key) last.items.push(item);
      else list.push({ key, title: dayTitle(item.timestamp, key), items: [item] });
    }
    return list;
  }, [items]);
  const today = todayKeyAr();
  const yesterday = addDaysToKey(today, -1);

  const rowKey = (item: Item) => `${kind}-${item.cursorId}`;

  return (
    <section className="view active hs-page">
      <SectionHeader
        eyebrow="Gestión"
        title="Historial"
        description="Buscá en todo el historial de la sede, no solo en lo último."
        actions={(
          <Tabs<Kind>
            ariaLabel="Qué historial ver"
            value={kind}
            onChange={next => {
              if (next === kind) return;
              // Las filas de una pestaña no sirven para la otra: se vacía antes del render.
              setItems([]);
              setCursor('');
              setLoading(true);
              setKind(next);
            }}
            tabs={[{ value: 'loans', label: 'Préstamos' }, { value: 'all', label: 'Todos los movimientos' }]}
          />
        )}
      />

      <section className="hs-card hs-filters" aria-label="Filtros" data-scanner-ignore="">
        <div className="hs-filter-row">
          <Input
            className="hs-search"
            label="Buscar"
            prefix={<icons.IconSearch size={14} />}
            suffix={q ? <IconButton size="sm" label="Borrar búsqueda" icon={<icons.IconX size={14} />} onClick={() => setQ('')} /> : undefined}
            value={q}
            onValueChange={setQ}
            onKeyDown={event => { if (event.key === 'Escape' && q) { event.stopPropagation(); setQ(''); } }}
            placeholder={kind === 'loans' ? 'Persona, equipo (D1436, touch34), curso, operador…' : 'Descripción, equipo, operador…'}
            autoComplete="off"
            spellCheck={false}
          />
          {kind === 'loans' && (
            <Segmented
              label="Tipo"
              size="sm"
              value={tipo}
              onChange={setTipo}
              options={[{ value: '', label: 'Todos' }, { value: 'prestamo', label: 'Préstamos' }, { value: 'devolucion', label: 'Devoluciones' }]}
            />
          )}
          <div className="hs-filter-actions">
            {hasFilters && <Button variant="ghost" onClick={clearFilters}>Limpiar</Button>}
            <Button icon={<icons.IconFile size={14} />} disabled={!items.length} loading={exporting} loadingLabel="Exportando…" onClick={() => void exportCsv()}>Exportar CSV</Button>
          </div>
        </div>
        <DateRange
          className="hs-range"
          value={range}
          onChange={setRange}
          max={today}
          hint="Desde y Hasta incluyen el día entero, en hora de la sede."
        />
        {exportStatus.element}
      </section>

      <section className="hs-card hs-results" aria-label="Movimientos">
        <div className="hs-results-head">
          <h3 className="hs-h3">{kind === 'loans' ? (tipo === 'prestamo' ? 'Préstamos' : tipo === 'devolucion' ? 'Devoluciones' : 'Préstamos y devoluciones') : 'Todos los movimientos'}</h3>
          <span className="hs-muted hs-nowrap"><span className="ui-mono">{items.length}</span> cargados · más nuevos primero</span>
          <span className="hs-muted hs-nowrap hs-tz">Horas de la sede (UTC−3)</span>
        </div>

        {error && <ErrorState message={error} onRetry={() => setReload(value => value + 1)} />}
        {loading && <div className="hs-skeleton"><SkeletonRows rows={6} /></div>}
        {!loading && !error && !items.length && (
          hasFilters
            ? <EmptyState title="No hay resultados para esos filtros." action={<Button size="sm" onClick={clearFilters}>Limpiar filtros</Button>} />
            : <EmptyState title="Todavía no hay movimientos registrados." />
        )}

        {!loading && items.length > 0 && (
          <div className={`hs-list hs-list--${kind}`} role="table" aria-label={kind === 'loans' ? 'Préstamos y devoluciones' : 'Movimientos'}>
            <div role="row" className="hs-row hs-colh">
              {(kind === 'loans' ? ['Hora', 'Tipo', 'Equipo', 'Persona', 'Curso / ubicación', 'Motivo', 'Operador'] : ['Hora', 'Origen', 'Movimiento', 'Operador'])
                .map(label => <span key={label} role="columnheader" className="hs-ell">{label}</span>)}
            </div>
            {groups.map((group, index) => {
              const partial = Boolean(cursor) && index === groups.length - 1;
              return (
                <Fragment key={group.key}>
                  <div role="row" className="hs-day">
                    <h4 role="rowheader" className="hs-day-title">{group.title}</h4>
                    {(group.key === today || group.key === yesterday) && <span className="hs-muted">{group.key === today ? 'Hoy' : 'Ayer'}</span>}
                    <span className="hs-muted ui-mono hs-day-count">{group.items.length}{partial ? '+' : ''} {group.items.length === 1 && !partial ? 'movimiento' : 'movimientos'}</span>
                  </div>
                  {group.items.map(item => {
                    const key = rowKey(item);
                    const device = item.etiqueta ? byTag.get(item.etiqueta.toUpperCase()) : undefined;
                    const toggle = () => setOpenRow(current => (current === key ? '' : key));
                    return (
                      <Fragment key={key}>
                        {kind === 'loans'
                          ? <LoanRow item={item as LoanHistoryItem} device={device} open={openRow === key} onToggle={toggle} />
                          : <MovementRow item={item as MovementHistoryItem} device={device} open={openRow === key} onToggle={toggle} />}
                        {openRow === key && device && (
                          <MiniDevice
                            device={device}
                            onClose={() => setOpenRow('')}
                            onOpen={onProfile ? () => onProfile(device) : undefined}
                            onOnly={() => { setQ(device.etiqueta); setOpenRow(''); }}
                          />
                        )}
                      </Fragment>
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
        )}

        {!loading && items.length > 0 && (
          <div className="hs-foot">
            {cursor && <Button loading={loadingMore} loadingLabel="Cargando…" onClick={() => void loadMore()}>Cargar más</Button>}
            <span className="hs-muted">{cursor ? <><span className="ui-mono">{items.length}</span> cargados</> : 'No hay más movimientos para estos filtros.'}</span>
          </div>
        )}
      </section>
    </section>
  );
}

function Cell({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <span role="cell" className={`hs-cell${className ? ` ${className}` : ''}`}>
      <span className="hs-cell-label" aria-hidden="true">{label}</span>
      <span className="hs-cell-value">{children}</span>
    </span>
  );
}

function DeviceLink({ etiqueta, alias, device, open, onToggle }: { etiqueta: string; alias: string; device?: Device; open: boolean; onToggle: () => void }) {
  const shownAlias = device ? getOperationalAlias(device) || alias : alias;
  if (!device) {
    return (
      <span className="hs-eq">
        {shownAlias && <span className="hs-ell">{shownAlias}</span>}
        <span className="ui-mono hs-muted">{etiqueta || '—'}</span>
      </span>
    );
  }
  return (
    <button type="button" className="hs-eq hs-eq-btn" aria-expanded={open} aria-label={`${open ? 'Cerrar' : 'Ver'} el resumen de ${shownAlias || etiqueta}`} onClick={onToggle}>
      {shownAlias && <span className="hs-ell hs-eq-alias">{shownAlias}</span>}
      <span className="ui-mono hs-muted">{etiqueta}</span>
    </button>
  );
}

function LoanRow({ item, device, open, onToggle }: { item: LoanHistoryItem; device?: Device; open: boolean; onToggle: () => void }) {
  const place = [item.curso, item.ubicacion].filter(Boolean).join(' · ');
  return (
    <div role="row" className={`hs-row hs-item${open ? ' is-open' : ''}`}>
      <Cell label="Hora" className="hs-c-time"><span className="ui-mono">{timeOf(item.timestamp)}</span></Cell>
      <Cell label="Tipo" className="hs-c-type"><StatusText tone={item.tipo === 'prestamo' ? 'info' : 'normal'}>{tipoLabel(item.tipo)}</StatusText></Cell>
      <Cell label="Equipo" className="hs-c-eq"><DeviceLink etiqueta={item.etiqueta} alias={item.alias} device={device} open={open} onToggle={onToggle} /></Cell>
      <Cell label="Persona">
        <span className="hs-stack">
          <span className="hs-ell">{item.persona || '—'}</span>
          {item.rol && <span className="hs-ell hs-muted">{item.rol}</span>}
        </span>
      </Cell>
      <Cell label="Curso / ubicación"><span className="hs-ell">{place || '—'}</span></Cell>
      <Cell label="Motivo">
        <span className="hs-stack">
          <span className="hs-ell">{item.motivo || '—'}</span>
          {(item.accesorios || []).length > 0 && <span className="hs-wrap hs-muted">Accesorios: {item.accesorios.join(', ')}</span>}
        </span>
      </Cell>
      <Cell label="Operador"><span className="hs-ell hs-muted">{item.operador || '—'}</span></Cell>
    </div>
  );
}

function MovementRow({ item, device, open, onToggle }: { item: MovementHistoryItem; device?: Device; open: boolean; onToggle: () => void }) {
  return (
    <div role="row" className={`hs-row hs-item${open ? ' is-open' : ''}`}>
      <Cell label="Hora" className="hs-c-time"><span className="ui-mono">{timeOf(item.timestamp)}</span></Cell>
      <Cell label="Origen"><span className="hs-ell hs-muted">{item.origen || '—'}</span></Cell>
      <Cell label="Movimiento" className="hs-c-mv">
        <span className="hs-stack">
          <span className="hs-mv-line">
            <span className="hs-strong hs-nowrap">{item.tipo}</span>
            {item.etiqueta && (device
              ? <button type="button" className="hs-tag-btn ui-mono" aria-expanded={open} aria-label={`${open ? 'Cerrar' : 'Ver'} el resumen de ${item.etiqueta}`} onClick={onToggle}>{item.etiqueta}</button>
              : <span className="ui-mono hs-muted">{item.etiqueta}</span>)}
          </span>
          {item.descripcion && <span className="hs-wrap hs-muted">{item.descripcion}</span>}
        </span>
      </Cell>
      <Cell label="Operador"><span className="hs-ell hs-muted">{item.operador || '—'}</span></Cell>
    </div>
  );
}

/** Resumen del equipo en línea, debajo del movimiento (antes abría el modal de la ficha). */
function MiniDevice({ device, onClose, onOpen, onOnly }: { device: Device; onClose: () => void; onOpen?: () => void; onOnly: () => void }) {
  const [summary, setSummary] = useState<{ loans: number; lastLoan: string } | null>(null);
  useEffect(() => {
    let alive = true;
    getHistoryDeviceSummary(device.etiqueta).then(response => { if (alive) setSummary(response); }).catch(() => { if (alive) setSummary({ loans: -1, lastLoan: '' }); });
    return () => { alive = false; };
  }, [device.etiqueta]);
  return (
    <div role="row" className="hs-mini ui-enter">
      <div role="cell" className="hs-mini-inner" aria-label={`Resumen de ${device.etiqueta}`} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
        <div className="hs-mini-id">
          <span className="hs-mini-name"><span className="hs-strong hs-ell">{aliasOf(device)}</span><span className="ui-mono hs-muted">{device.etiqueta}</span></span>
          <span className="hs-ell hs-muted">{[deviceKind(device), [device.marca, device.modelo].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}</span>
          <StatusText tone={stateTone(device)}>{stateLabel(device)}{device.prestadoA && /prest/i.test(device.estado) ? ` · ${device.prestadoA}` : ''}</StatusText>
        </div>
        <dl className="hs-mini-data">
          <div><dt>SN</dt><dd className="ui-mono">{device.sn || device.mac || '—'}</dd></div>
          <div><dt>Préstamos</dt><dd className="ui-mono">{summary ? (summary.loans < 0 ? '—' : summary.loans) : '…'}</dd></div>
          <div><dt>Último</dt><dd className="ui-mono">{summary ? shortWhen(summary.lastLoan) || '—' : '…'}</dd></div>
        </dl>
        <div className="hs-mini-actions">
          {onOpen && <Button size="sm" onClick={onOpen}>Abrir ficha completa</Button>}
          <Button size="sm" variant="ghost" onClick={onOnly}>Ver solo este equipo</Button>
          <IconButton size="sm" label="Cerrar resumen" icon={<icons.IconX size={14} />} onClick={onClose} />
        </div>
      </div>
    </div>
  );
}
