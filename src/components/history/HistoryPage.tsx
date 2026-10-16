import { useEffect, useMemo, useRef, useState } from 'react';
import type { Device } from '../../types';
import { getLoanHistory, getMovementHistory, type HistoryFilters, type LoanHistoryItem, type MovementHistoryItem } from '../../services/historyApi';
import { useTabPill } from '../../hooks/useTabPill';
import { DATE_TIME, formatDate } from '../../utils/formatters';
import { downloadCsv } from '../../utils/download';
import { Button } from '../layout/Button';
import { DateField } from '../layout/DateField';
import { SkeletonLine } from '../layout/Skeleton';
import { errorMessage } from '../layout/Feedback';
import { SelectField } from '../layout/SelectField';

type Kind = 'loans' | 'all';
const PAGE = 50;

/**
 * Historial con filtros: quién tuvo un equipo, qué se llevó un curso, qué pasó
 * un día. El dashboard muestra los últimos movimientos; esto busca en todo el
 * historial y pagina hacia atrás sin traer todo de golpe.
 */
export function HistoryPage({ devices, onProfile }: { devices: Device[]; onProfile?: (device: Device) => void }) {
  const [kind, setKind] = useState<Kind>('loans');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [tipo, setTipo] = useState('');
  const [loanItems, setLoanItems] = useState<LoanHistoryItem[]>([]);
  const [movementItems, setMovementItems] = useState<MovementHistoryItem[]>([]);
  const [cursor, setCursor] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const pill = useTabPill<HTMLDivElement>(kind);
  const requestId = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [q]);

  const filters: HistoryFilters = useMemo(() => ({ q: debouncedQ, from, to, tipo: kind === 'loans' ? tipo : '', limit: PAGE }), [debouncedQ, from, to, tipo, kind]);

  // Cada cambio de filtro arranca de cero; una respuesta vieja que llega tarde
  // (se tipeó rápido) se descarta por requestId.
  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    const load = kind === 'loans' ? getLoanHistory(filters) : getMovementHistory(filters);
    load.then(response => {
      if (id !== requestId.current) return;
      if (kind === 'loans') setLoanItems(response.items as LoanHistoryItem[]);
      else setMovementItems(response.items as MovementHistoryItem[]);
      setCursor(response.nextCursor);
    }).catch(reason => {
      if (id === requestId.current) setError(errorMessage(reason, 'No se pudo cargar el historial.'));
    }).finally(() => {
      if (id === requestId.current) setLoading(false);
    });
  }, [kind, filters]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    const id = requestId.current;
    setLoadingMore(true);
    try {
      if (kind === 'loans') {
        const response = await getLoanHistory({ ...filters, before: cursor });
        if (id !== requestId.current) return;
        setLoanItems(items => [...items, ...response.items]);
        setCursor(response.nextCursor);
      } else {
        const response = await getMovementHistory({ ...filters, before: cursor });
        if (id !== requestId.current) return;
        setMovementItems(items => [...items, ...response.items]);
        setCursor(response.nextCursor);
      }
    } catch (reason) {
      setError(errorMessage(reason, 'No se pudo cargar más.'));
    } finally {
      setLoadingMore(false);
    }
  };

  const byTag = useMemo(() => new Map(devices.map(device => [device.etiqueta.toUpperCase(), device])), [devices]);
  const openDevice = (etiqueta: string) => {
    const device = byTag.get(etiqueta.toUpperCase());
    if (device) onProfile?.(device);
  };

  const exportCsv = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === 'loans') {
      downloadCsv(`historial_prestamos_${stamp}.csv`, [
        ['Fecha', 'Tipo', 'Etiqueta', 'Alias', 'Persona', 'Rol', 'Curso', 'Ubicación', 'Motivo', 'Accesorios', 'Comentarios', 'Operador'],
        ...loanItems.map(item => [formatDate(item.timestamp), tipoLabel(item.tipo), item.etiqueta, item.alias, item.persona, item.rol, item.curso, item.ubicacion, item.motivo, item.accesorios.join(' / '), item.comentarios, item.operador])
      ]);
    } else {
      downloadCsv(`historial_movimientos_${stamp}.csv`, [
        ['Fecha', 'Origen', 'Tipo', 'Descripción', 'Etiqueta', 'Operador'],
        ...movementItems.map(item => [formatDate(item.timestamp), item.origen, item.tipo, item.descripcion, item.etiqueta, item.operador])
      ]);
    }
  };

  const items = kind === 'loans' ? loanItems : movementItems;
  const hasFilters = Boolean(q || from || to || tipo);

  return (
    <section className="view active history-page">
      <section className="card">
        <div className="card-head history-head">
          <div>
            <h2>Historial</h2>
            <span className="muted">Buscá en todo el historial de la sede, no solo en lo último.</span>
          </div>
          <div className="segmented-control history-switch t-tabs" ref={pill.ref} role="tablist" aria-label="Qué historial ver">
            <span className="t-tabs-pill" style={pill.style} aria-hidden="true" />
            <button type="button" role="tab" aria-selected={kind === 'loans'} className={kind === 'loans' ? 'active' : ''} data-tab-active={kind === 'loans'} onClick={() => setKind('loans')}>Préstamos</button>
            <button type="button" role="tab" aria-selected={kind === 'all'} className={kind === 'all' ? 'active' : ''} data-tab-active={kind === 'all'} onClick={() => setKind('all')}>Todos los movimientos</button>
          </div>
        </div>

        <div className="history-filters">
          <label className="history-search">Buscar
            <input className="input" value={q} onChange={event => setQ(event.target.value)} placeholder={kind === 'loans' ? 'Persona, equipo (D1436, Touch 34), curso, ubicación…' : 'Descripción, equipo, operador…'} />
          </label>
          <label>Desde<DateField value={from} onChange={setFrom} ariaLabel="Desde" /></label>
          <label>Hasta<DateField value={to} onChange={setTo} ariaLabel="Hasta" /></label>
          {kind === 'loans' && (
            <label>Tipo
              <SelectField ariaLabel="Tipo de movimiento" value={tipo} onChange={setTipo} options={[{ value: '', label: 'Préstamos y devoluciones' }, { value: 'prestamo', label: 'Solo préstamos' }, { value: 'devolucion', label: 'Solo devoluciones' }]} />
            </label>
          )}
          <div className="history-filter-actions">
            {hasFilters && <Button onClick={() => { setQ(''); setFrom(''); setTo(''); setTipo(''); }}>Limpiar</Button>}
            <Button disabled={!items.length} onClick={exportCsv}>Exportar CSV</Button>
          </div>
        </div>

        {error && <div className="tool-error">{error}</div>}
        {loading && (
          <div className="stack history-skeleton" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => <SkeletonLine key={index} width={`${90 - index * 6}%`} height={16} index={index} />)}
          </div>
        )}
        {!loading && !error && !items.length && (
          <div className="empty-state">{hasFilters ? 'No hay resultados para esos filtros.' : 'Todavía no hay movimientos registrados.'}</div>
        )}

        {!loading && kind === 'loans' && loanItems.length > 0 && (
          <div className="table-wrap">
            <table className="compact-table history-table">
              <thead>
                <tr><th>Fecha</th><th>Tipo</th><th>Equipo</th><th>Persona</th><th>Curso / ubicación</th><th>Motivo</th><th>Operador</th></tr>
              </thead>
              <tbody>
                {loanItems.map(item => (
                  <tr key={item.cursorId}>
                    <td data-label="Fecha">{formatDate(item.timestamp, DATE_TIME)}</td>
                    <td data-label="Tipo"><div><span className={`badge ${item.tipo === 'prestamo' ? 'loaned' : 'available'}`}>{tipoLabel(item.tipo)}</span></div></td>
                    <td data-label="Equipo"><div>
                      {byTag.has(item.etiqueta.toUpperCase())
                        ? <button type="button" className="link-button" onClick={() => openDevice(item.etiqueta)}>{item.etiqueta}</button>
                        : <strong>{item.etiqueta}</strong>}
                      {item.alias && <div className="cell-sub">{item.alias}</div>}
                    </div></td>
                    <td data-label="Persona"><div>{item.persona || '—'}{item.rol && <div className="cell-sub">{item.rol}</div>}</div></td>
                    <td data-label="Curso / ubicación">{[item.curso, item.ubicacion].filter(Boolean).join(' · ') || '—'}</td>
                    <td data-label="Motivo"><div>
                      {item.motivo || '—'}
                      {item.accesorios.length > 0 && <div className="cell-sub">Accesorios: {item.accesorios.join(', ')}</div>}
                    </div></td>
                    <td data-label="Operador">{item.operador || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && kind === 'all' && movementItems.length > 0 && (
          <div className="table-wrap">
            <table className="compact-table history-table">
              <thead>
                <tr><th>Fecha</th><th>Origen</th><th>Movimiento</th><th>Operador</th></tr>
              </thead>
              <tbody>
                {movementItems.map(item => (
                  <tr key={item.cursorId}>
                    <td data-label="Fecha">{formatDate(item.timestamp, DATE_TIME)}</td>
                    <td data-label="Origen">{item.origen || '—'}</td>
                    <td data-label="Movimiento"><div>
                      <strong>{item.tipo}</strong>
                      <div className="cell-sub">{item.descripcion}</div>
                    </div></td>
                    <td data-label="Operador">{item.operador || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && cursor && (
          <div className="history-more">
            <span className="muted">{items.length} cargados</span>
            <Button disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Cargando…' : 'Cargar más'}</Button>
          </div>
        )}
      </section>
    </section>
  );
}

function tipoLabel(tipo: string) {
  if (tipo === 'prestamo') return 'Préstamo';
  if (tipo === 'devolucion') return 'Devolución';
  return tipo;
}
