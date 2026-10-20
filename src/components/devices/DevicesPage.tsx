import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { Device, ViewKey } from '../../types';
import {
  Button, Collapse, EmptyState, IconButton, InlineConfirm, Input, Kbd, SectionHeader, Segmented, SelectionHeader, SkeletonRows, StatusText, Table, TruncatedText,
  ageTone, icons, useSelection, useStatusLine, type Column, type SortState
} from '../../ui';
import { deleteDevicesBatch, getDevicePanelCounts, restoreDevice, restoreDevicesBatch, updateDeviceStatus, updateDevicesStatusBatch, type DeviceBatchResponse } from '../../services/devicesApi';
import type { LoanBatchResponse } from '../../services/loansApi';
import { getDeviceStateKey } from '../../utils/deviceState';
import { loanAgeDays } from '../../utils/formatters';
import { matchesDeviceSearch } from '../../utils/deviceSearch';
import { scrollAppToTop } from '../../utils/scroll';
import { errorMessage } from '../layout/Feedback';
import { setHistorySeed } from '../history/historySeed';
import { DeviceDetail } from './DeviceDetail';
import { DeviceForm, normalizeTagInput, type DeviceFormSave } from './DeviceForm';
import { DeviceGroupsPanel } from './DeviceGroupsPanel';
import { ExportPanel, ImportPanel } from './DevicePanels';
import { DeviceTrashPanel } from './DeviceTrashPanel';
import {
  MANUAL_STATES, STATE_FILTERS, ageText, aliasOf, cellValue, deviceKind, deviceModel, isLendable, isLoaned, loanWhere, shortWhen,
  sortDevices, stateLabel, stateTone, typeOf, type SortKey
} from './deviceView';
import '../../styles/screens/devices.css';

type StateFilter = 'all' | 'available' | 'loaned' | 'missing' | 'out';
type Panel = 'import' | 'export' | 'groups' | 'trash' | null;
type Open = { tag: string; mode: 'ficha' | 'edit' } | null;
type Batch = { kind: 'return' | 'status' | 'delete'; estado?: string } | null;

const FIRST_PAINT = 12;
const PAGE = 30;

export type DevicesPageProps = {
  /** Lo que muestra la lista (con el filtro de Ctrl K aplicado, si hay). */
  devices: Device[];
  /** Todos los equipos de la sede (duplicados al dar de alta, picker de grupos, página de un equipo). */
  allDevices?: Device[];
  consultationMode: boolean;
  operator: string;
  siteCode?: string;
  onAdd: (device: Partial<Device>) => Promise<void>;
  onLoan: (device: Device) => void;
  onReturn: (device: Device) => Promise<unknown> | void;
  onDelete?: (device: Device) => Promise<void> | void;
  onImported?: () => Promise<void> | void;
  onLoanBatch?: (etiquetas: string[]) => void;
  onReturnBatch?: (etiquetas: string[]) => Promise<LoanBatchResponse>;
  /** Equipo abierto como página (/sede/x/devices/D1436). */
  pageTag?: string;
  pageEdit?: boolean;
  onOpenPage?: (etiqueta: string | null, edit?: boolean) => void;
  onNavigate?: (view: ViewKey) => void;
};

/**
 * Dispositivos: inventario de la sede con su estado de préstamo. Filtros como
 * segmentados con el conteo en mono, búsqueda flexible, orden por columna,
 * selección (casilla, Ctrl/⌘+clic, Shift+clic para un rango) acotada a lo
 * visible, y todo lo que se abre va en línea: la ficha y la edición debajo de
 * su fila, los paneles (importar, exportar, grupos, papelera) arriba de la
 * lista, las confirmaciones de lote en la barra de selección y el Deshacer
 * como línea de estado.
 */
export function DevicesPage(props: DevicesPageProps) {
  const { devices, consultationMode, onImported } = props;
  const allDevices = props.allDevices || devices;
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState<'original' | 'operational'>('original');
  const [sort, setSort] = useState<SortState>(null);
  const [limit, setLimit] = useState(FIRST_PAINT);
  const [open, setOpen] = useState<Open>(null);
  const [creating, setCreating] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [counts, setCounts] = useState<{ groups: number | null; trash: number | null }>({ groups: null, trash: null });
  const [batch, setBatch] = useState<Batch>(null);
  const [busy, setBusy] = useState(false);
  const [returning, setReturning] = useState('');
  const [pageEditing, setPageEditing] = useState(Boolean(props.pageEdit));
  const scrollTo = useRef<string | null>(null);
  // Botones del encabezado: al cerrar un panel desde adentro, el foco vuelve a su botón.
  const panelButtons = useRef<Partial<Record<Exclude<Panel, null> | 'create', HTMLButtonElement | null>>>({});
  const selection = useSelection();
  const listStatus = useStatusLine();
  const refresh = useCallback(async () => { await onImported?.(); }, [onImported]);

  // Contadores de Grupos y Papelera: un pedido chico al abrir, después de pintar
  // (antes, las dos listas completas). Si un panel ya informó su número, manda ese.
  useEffect(() => {
    const idle = window.setTimeout(() => {
      getDevicePanelCounts().then(response => setCounts(current => ({ groups: current.groups ?? response.groups, trash: current.trash ?? response.trash }))).catch(() => undefined);
    }, 300);
    return () => window.clearTimeout(idle);
  }, []);

  useEffect(() => { setPageEditing(Boolean(props.pageEdit)); }, [props.pageTag, props.pageEdit]);

  /* ── Filtros, búsqueda y orden ─────────────────────────────────────────── */

  const types = useMemo(() => Array.from(new Set(devices.map(typeOf).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es')), [devices]);
  const byState = (device: Device) => stateFilter === 'all' || getDeviceStateKey(device) === stateFilter;
  const byType = (device: Device) => typeFilter === 'all' || typeOf(device) === typeFilter;
  const stateCounts = useMemo(() => {
    const base: Record<string, number> = { all: 0, available: 0, loaned: 0, missing: 0, out: 0 };
    for (const device of devices) {
      if (typeFilter !== 'all' && typeOf(device) !== typeFilter) continue;
      base.all += 1;
      base[getDeviceStateKey(device)] += 1;
    }
    return base;
  }, [devices, typeFilter]);
  const typeCounts = useMemo(() => {
    const base: Record<string, number> = { all: 0 };
    for (const device of devices) {
      if (stateFilter !== 'all' && getDeviceStateKey(device) !== stateFilter) continue;
      base.all += 1;
      const type = typeOf(device);
      base[type] = (base[type] || 0) + 1;
    }
    return base;
  }, [devices, stateFilter]);

  const visible = useMemo(() => {
    const list = devices.filter(device => byState(device) && byType(device) && matchesDeviceSearch(device, query));
    if (sort) return sortDevices(list, sort.key as SortKey, sort.dir);
    // Buscar ordena por número operativo (touch → Touch 1, 2, 3…), como siempre.
    if (order === 'operational' || query.trim()) return sortDevices(list, 'operational');
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices, stateFilter, typeFilter, query, order, sort]);
  const visibleKeys = useMemo(() => visible.map(device => device.etiqueta), [visible]);

  // Primer pintado con las filas que entran en pantalla; el resto en idle.
  useEffect(() => {
    setLimit(FIRST_PAINT);
    const done = () => setLimit(value => Math.max(value, PAGE));
    const idle = window.requestIdleCallback ? window.requestIdleCallback(done, { timeout: 400 }) : window.setTimeout(done, 50);
    return () => { if (window.cancelIdleCallback) window.cancelIdleCallback(idle); else window.clearTimeout(idle); };
  }, [stateFilter, typeFilter, query, order, sort]);

  // La fila abierta tiene que estar dibujada.
  const openIndex = open ? visibleKeys.indexOf(open.tag) : -1;
  const shown = visible.slice(0, Math.max(limit, openIndex + 1));

  useEffect(() => {
    if (!scrollTo.current) return;
    const tag = scrollTo.current;
    scrollTo.current = null;
    window.requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(`.dv-table [data-device-tag="${CSS.escape(tag)}"]`);
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      row?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    });
  });

  // La selección se recalcula contra lo que existe (borrados, cambio de sede).
  useEffect(() => { selection.prune(allDevices.map(device => device.etiqueta)); }, [allDevices, selection.prune]);
  const selectedVisible = useMemo(() => visible.filter(device => selection.selected.has(device.etiqueta)), [visible, selection.selected]);
  const hiddenSelected = selection.count - selectedVisible.length;
  const toLend = selectedVisible.filter(isLendable);
  const toReturn = selectedVisible.filter(isLoaned);
  const notLoaned = selectedVisible.filter(device => !isLoaned(device));
  useEffect(() => { if (!selection.count) setBatch(null); }, [selection.count]);

  const resetFilters = () => { setStateFilter('all'); setTypeFilter('all'); setQuery(''); setSort(null); };

  /** Abre la ficha de un equipo en la lista (desde Grupos o un miembro del grupo). */
  const openInList = (tag: string, mode: 'ficha' | 'edit' = 'ficha') => {
    if (props.pageTag) { props.onOpenPage?.(tag, mode === 'edit'); return; }
    if (!visibleKeys.includes(tag)) resetFilters();
    setPanel(null);
    setCreating(false);
    setOpen({ tag, mode });
    scrollTo.current = tag;
  };

  /* ── Acciones de una fila ──────────────────────────────────────────────── */

  const runReturn = async (device: Device) => {
    if (returning) return;
    setReturning(device.etiqueta);
    try {
      await props.onReturn(device);
      listStatus.show({ tone: 'ok', message: `${device.etiqueta} devuelto.` });
    } catch (reason) {
      listStatus.show({ tone: 'bad', message: errorMessage(reason, `No se pudo devolver ${device.etiqueta}.`) });
    } finally {
      setReturning('');
    }
  };

  const deleteOne = async (device: Device) => {
    if (!props.onDelete) return;
    await props.onDelete(device);
    setOpen(null);
    if (props.pageTag) props.onOpenPage?.(null);
    setCounts(current => ({ ...current, trash: current.trash === null ? null : current.trash + 1 }));
    listStatus.show({
      tone: 'ok',
      message: `${device.etiqueta} se movió a la papelera.`,
      undo: {
        seconds: 7,
        onUndo: async () => {
          try {
            await restoreDevice(device.etiqueta);
            await refresh();
            setCounts(current => ({ ...current, trash: current.trash === null ? null : Math.max(0, current.trash - 1) }));
            listStatus.show({ tone: 'ok', message: `${device.etiqueta} restaurado.` });
          } catch (reason) {
            listStatus.show({ tone: 'bad', message: errorMessage(reason, 'No se pudo restaurar.') });
          }
        }
      }
    });
  };

  const saveDevice = async (payload: DeviceFormSave, estadoChanged: boolean) => {
    await props.onAdd(payload);
    if (estadoChanged && payload.estado) {
      // El estado guardado en el equipo pierde contra el último préstamo o
      // devolución: se aplica también como cambio de estado (como el lote).
      await updateDeviceStatus({ etiqueta: String(payload.etiqueta), estado: String(payload.estado), operator: props.operator });
      await refresh();
    }
    const tag = String(payload.etiqueta);
    if (payload.originalEtiqueta) {
      if (props.pageTag) {
        setPageEditing(false);
        if (tag !== payload.originalEtiqueta) props.onOpenPage?.(tag);
      } else {
        setOpen({ tag, mode: 'ficha' });
      }
      listStatus.show({ tone: 'ok', message: tag !== payload.originalEtiqueta ? `${payload.originalEtiqueta} ahora es ${tag}.` : `${tag} guardado.` });
    } else {
      setCreating(false);
      listStatus.show({ tone: 'ok', message: `${tag} agregado.`, action: { label: 'Ver ficha', onClick: () => openInList(tag) } });
    }
  };

  const detailActions = (device: Device) => ({
    // Al cerrar la ficha, el foco vuelve a su fila (no se pierde en la página).
    onClose: () => {
      setOpen(null);
      document.querySelector<HTMLElement>(`.dv-table [data-device-tag="${CSS.escape(device.etiqueta)}"]`)?.focus({ preventScroll: true });
    },
    onLoan: consultationMode ? undefined : props.onLoan,
    onReturn: consultationMode ? undefined : async (item: Device) => { await runReturn(item); },
    onEdit: consultationMode ? undefined : (item: Device) => (props.pageTag ? setPageEditing(true) : setOpen({ tag: item.etiqueta, mode: 'edit' })),
    onDelete: consultationMode || !props.onDelete ? undefined : deleteOne,
    onOpenDevice: (tag: string) => openInList(tag),
    onOpenPage: props.onOpenPage ? (tag: string) => props.onOpenPage?.(tag) : undefined,
    onHistory: props.onNavigate ? (tag: string) => { setHistorySeed(tag); props.onNavigate?.('history'); } : undefined,
    onTickets: props.onNavigate ? () => props.onNavigate?.('tickets') : undefined,
    onGroups: () => {
      if (props.pageTag) props.onOpenPage?.(null);
      setPanel('groups');
      scrollAppToTop(true);
    },
    device
  });

  /* ── Lotes ─────────────────────────────────────────────────────────────── */

  const runBatch = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (reason) {
      listStatus.show({ tone: 'bad', message: errorMessage(reason, 'No se pudo completar la acción.') });
    } finally {
      setBusy(false);
      setBatch(null);
    }
  };

  const failedText = (response: DeviceBatchResponse | LoanBatchResponse) => response.results.filter(item => !item.ok).map(item => `${item.etiqueta}: ${item.error || 'error'}`).join('; ');

  const confirmReturn = () => runBatch(async () => {
    if (!props.onReturnBatch) return;
    const tags = toReturn.map(device => device.etiqueta);
    const response = await props.onReturnBatch(tags);
    const failed = failedText(response);
    listStatus.show(failed
      ? { tone: 'warn', message: `Se devolvieron ${response.done} de ${tags.length}. ${failed}` }
      : { tone: 'ok', message: `Se devolvieron ${response.done} equipos.` });
    selection.clear();
  });

  const confirmStatus = (estado: string) => runBatch(async () => {
    const tags = notLoaned.map(device => device.etiqueta);
    const response = await updateDevicesStatusBatch({ etiquetas: tags, estado, operator: props.operator });
    await refresh();
    const failed = failedText(response);
    listStatus.show(failed
      ? { tone: 'warn', message: `Cambiaron ${response.done} de ${tags.length}. ${failed}` }
      : { tone: 'ok', message: `${response.done} equipos ahora están "${estado}".` });
    selection.clear();
  });

  const confirmDelete = () => runBatch(async () => {
    const tags = selectedVisible.map(device => device.etiqueta);
    const response = await deleteDevicesBatch(tags, props.operator);
    await refresh();
    selection.clear();
    if (open && tags.includes(open.tag)) setOpen(null);
    setCounts(current => ({ ...current, trash: current.trash === null ? null : current.trash + response.done }));
    listStatus.show({
      tone: 'ok',
      message: `${response.done} ${response.done === 1 ? 'equipo se movió' : 'equipos se movieron'} a la papelera.`,
      undo: {
        seconds: 7,
        onUndo: async () => {
          try {
            const restored = await restoreDevicesBatch(tags, props.operator);
            await refresh();
            setCounts(current => ({ ...current, trash: current.trash === null ? null : Math.max(0, current.trash - restored.done) }));
            const failed = failedText(restored);
            listStatus.show(failed
              ? { tone: 'warn', message: `Se restauraron ${restored.done} de ${tags.length}. ${failed}` }
              : { tone: 'ok', message: `${restored.done} equipos restaurados.` });
          } catch (reason) {
            listStatus.show({ tone: 'bad', message: errorMessage(reason, 'No se pudieron restaurar.') });
          }
        }
      }
    });
  });

  const batchConfirm: ReactNode = batch?.kind === 'return' ? (
    <InlineConfirm
      message={`¿Devolver ${toReturn.length} ${toReturn.length === 1 ? 'equipo' : 'equipos'}?`}
      detail={toReturn.map(device => device.etiqueta).join(', ')}
      confirmLabel={`Devolver ${toReturn.length}`}
      busy={busy}
      onConfirm={() => void confirmReturn()}
      onCancel={() => setBatch(null)}
    />
  ) : batch?.kind === 'delete' ? (
    <InlineConfirm
      danger
      message={`¿Mover ${selectedVisible.length} ${selectedVisible.length === 1 ? 'equipo' : 'equipos'} a la papelera?`}
      detail="Se ocultan de la app sin borrar su historial. Se pueden restaurar desde la papelera."
      confirmLabel={`Borrar ${selectedVisible.length}`}
      busy={busy}
      onConfirm={() => void confirmDelete()}
      onCancel={() => setBatch(null)}
    />
  ) : batch?.kind === 'status' ? (
    <div className="ui-confirm dv-batch-state ui-enter" role="group" aria-label="Cambiar estado" data-scanner-ignore="" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setBatch(null); } }}>
      <div className="ui-confirm-text">
        <span className="ui-confirm-msg">Cambiar el estado de {notLoaned.length} {notLoaned.length === 1 ? 'equipo' : 'equipos'}</span>
        {toReturn.length > 0 && <span className="ui-confirm-detail">{toReturn.length === 1 ? 'El prestado no se toca: devolvelo primero.' : `Los ${toReturn.length} prestados no se tocan: devolvelos primero.`}</span>}
      </div>
      <Segmented ariaLabel="Nuevo estado" size="sm" value={batch.estado || ''} onChange={estado => setBatch({ kind: 'status', estado })} options={MANUAL_STATES.map(value => ({ value, label: value }))} />
      <div className="ui-confirm-actions">
        <Button size="sm" variant="primary" disabled={!batch.estado} loading={busy} onClick={() => batch.estado && void confirmStatus(batch.estado)}>Cambiar {notLoaned.length}</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setBatch(null)}>Cancelar</Button>
      </div>
    </div>
  ) : null;

  /* ── Columnas ──────────────────────────────────────────────────────────── */

  const columns: Column<Device>[] = [
    {
      key: 'equipo', header: 'Equipo', card: 'title', width: 'minmax(0, 1.25fr)', className: 'dv-c-eq', sortValue: device => device.etiqueta,
      cell: device => (
        <span className="dv-cell2">
          <TruncatedText className="dv-strong">{aliasOf(device)}</TruncatedText>
          <span className="ui-mono dv-muted operational-tag">{device.etiqueta}</span>
        </span>
      )
    },
    {
      key: 'dispositivo', header: 'Dispositivo', width: 'minmax(0, 1.2fr)', sortValue: deviceKind,
      cell: device => (
        <span className="dv-cell2">
          <TruncatedText>{deviceKind(device)}</TruncatedText>
          {/* Hasta 2 renglones: con el ancho de columna fijo, cortar con elipsis dejaba espacio sin usar. */}
          {deviceModel(device) && <TruncatedText lines={2} className="dv-muted dv-break">{deviceModel(device)}</TruncatedText>}
        </span>
      )
    },
    {
      key: 'sn', header: 'SN / MAC', width: 'minmax(0, 1fr)', sortValue: device => device.sn || device.mac,
      cell: device => (cellValue(device.sn || device.mac) ? <TruncatedText lines={2} className="ui-mono dv-break">{cellValue(device.sn || device.mac)}</TruncatedText> : <span className="dv-muted">—</span>)
    },
    {
      key: 'prestado', header: 'Prestado a', width: 'minmax(0, 1.4fr)', sortValue: device => device.prestadoA,
      cell: device => (isLoaned(device) ? (
        <span className="dv-cell2">
          <span className="dv-who">
            <TruncatedText>{cellValue(device.prestadoA) || 'Sin persona'}</TruncatedText>
            {device.loanedAt && <StatusText mono tone={ageTone(loanAgeDays(device.loanedAt))} className="dv-nowrap">{ageText(device.loanedAt)}</StatusText>}
          </span>
          {(loanWhere(device) || device.loanedAt) && <TruncatedText lines={2} className="dv-muted">{[loanWhere(device), shortWhen(device.loanedAt)].filter(Boolean).join(' · ')}</TruncatedText>}
        </span>
      ) : <span className="dv-muted">—</span>)
    },
    {
      key: 'devolucion', header: 'Devuelto', cardLabel: 'Última devolución', width: 'minmax(0, .95fr)', sortValue: device => device.returnedAt,
      cell: device => (cellValue(device.returnedAt) ? <span className="ui-mono dv-muted">{shortWhen(device.returnedAt)}</span> : <span className="dv-muted">—</span>)
    },
    {
      key: 'estado', header: 'Estado', card: 'meta', width: 'minmax(0, .95fr)', sortValue: stateLabel,
      // Mismo color que StatusText, pero con tooltip si el estado no entra.
      cell: device => <TruncatedText lines={2} className={`ui-stext ui-stext--${stateTone(device)} dv-state`}>{stateLabel(device)}</TruncatedText>
    },
    {
      key: 'acciones', header: <span className="dv-sr">Acciones</span>, cardLabel: 'Acciones', width: consultationMode ? '2rem' : '11rem', align: 'end', className: 'dv-c-act',
      cell: device => (
        <span className="dv-row-actions">
          {!consultationMode && isLoaned(device) && (
            <Button size="sm" loading={returning === device.etiqueta} loadingLabel="Devolviendo…" disabled={Boolean(returning) && returning !== device.etiqueta} aria-label={`Devolver ${device.etiqueta}`} onClick={() => void runReturn(device)}>Devolver</Button>
          )}
          {!consultationMode && isLendable(device) && (
            <Button size="sm" variant="ghost" aria-label={`Prestar ${device.etiqueta}`} onClick={() => props.onLoan(device)}>Prestar</Button>
          )}
          {!consultationMode && (
            <Button size="sm" variant="ghost" aria-label={`Editar ${device.etiqueta}`} onClick={() => setOpen({ tag: device.etiqueta, mode: 'edit' })}>Editar</Button>
          )}
          <span className={`dv-chev${open?.tag === device.etiqueta ? ' is-open' : ''}`} aria-hidden="true"><icons.IconChevronDown size={16} /></span>
        </span>
      )
    }
  ];

  /* ── Página de un equipo (/sede/x/devices/D1436) ───────────────────────── */

  if (props.pageTag) {
    const wanted = normalizeTagInput(props.pageTag);
    const device = allDevices.find(item => normalizeTagInput(item.etiqueta) === wanted);
    return (
      <section className="view active dv-page">
        <div className="dv-page-back">
          <Button size="sm" variant="ghost" icon={<icons.IconChevronLeft size={14} />} onClick={() => props.onOpenPage?.(null)}>Dispositivos</Button>
        </div>
        {listStatus.element}
        {device ? (
          pageEditing && !consultationMode ? (
            <div className="dv-card">
              <DeviceForm initial={device} existingTags={new Set(allDevices.map(item => item.etiqueta))} onSave={saveDevice} onCancel={() => setPageEditing(false)} />
            </div>
          ) : (
            <div className="dv-card">
              <DeviceDetail variant="page" consultationMode={consultationMode} {...detailActions(device)} />
            </div>
          )
        ) : allDevices.length ? (
          <EmptyState title={`No hay un equipo ${wanted} en esta sede.`} description="Puede estar en la papelera o ser de la otra sede." action={<Button onClick={() => props.onOpenPage?.(null)}>Ver Dispositivos</Button>} />
        ) : <div className="dv-card"><SkeletonRows rows={4} /></div>}
      </section>
    );
  }

  /* ── Lista ─────────────────────────────────────────────────────────────── */

  const stateTitle = STATE_FILTERS.find(item => item.value === stateFilter)?.title || 'Todos los equipos';
  const listTitle = typeFilter === 'all' ? stateTitle : `${stateTitle} · ${typeFilter}`;
  const togglePanel = (next: Exclude<Panel, null>) => { setPanel(current => (current === next ? null : next)); setCreating(false); };
  const closePanel = (which: Exclude<Panel, null> | 'create') => {
    if (which === 'create') setCreating(false);
    else setPanel(null);
    panelButtons.current[which]?.focus({ preventScroll: true });
  };
  const onToggle = (key: string, event: MouseEvent) => {
    if (event.shiftKey) selection.selectRange(key, visibleKeys);
    else selection.toggle(key);
  };

  return (
    <section className="view active dv-page">
      <SectionHeader
        eyebrow={`Operación${props.siteCode ? ` · ${props.siteCode}` : ''}`}
        title="Equipos de la sede"
        actions={(
          <div className="dv-head-actions">
            {!consultationMode && <Button ref={el => { panelButtons.current.import = el; }} aria-expanded={panel === 'import'} aria-controls="dv-panel-import" icon={<icons.IconUpload size={14} />} onClick={() => togglePanel('import')}>Importar CSV</Button>}
            <Button ref={el => { panelButtons.current.export = el; }} aria-expanded={panel === 'export'} aria-controls="dv-panel-export" icon={<icons.IconFile size={14} />} onClick={() => togglePanel('export')}>Exportar</Button>
            <Button ref={el => { panelButtons.current.groups = el; }} aria-expanded={panel === 'groups'} aria-controls="dv-panel-groups" onClick={() => togglePanel('groups')}>Grupos{counts.groups !== null && <span className="ui-mono dv-count">{counts.groups}</span>}</Button>
            <Button ref={el => { panelButtons.current.trash = el; }} aria-expanded={panel === 'trash'} aria-controls="dv-panel-trash" onClick={() => togglePanel('trash')}>Papelera{counts.trash !== null && <span className="ui-mono dv-count">{counts.trash}</span>}</Button>
            {!consultationMode && <Button ref={el => { panelButtons.current.create = el; }} variant="primary" icon={<icons.IconPlus size={14} />} aria-expanded={creating} aria-controls="dv-create" onClick={() => { setCreating(value => !value); setPanel(null); setOpen(null); }}>Añadir dispositivo</Button>}
          </div>
        )}
      />

      {/* Paneles en línea: se abren y se cierran suaves con el botón quieto (Collapse).
          Importar y Grupos conservan lo que se estaba haciendo; Exportar y la
          Papelera se vuelven a leer cada vez que se abren. */}
      {!consultationMode && (
        <Collapse open={panel === 'import'} id="dv-panel-import" outerClassName="dv-fold">
          <ImportPanel operator={props.operator} onImported={refresh} onClose={() => closePanel('import')} />
        </Collapse>
      )}
      <Collapse open={panel === 'export'} id="dv-panel-export" outerClassName="dv-fold" unmountOnClose>
        <ExportPanel visible={visible} siteCode={props.siteCode || ''} onClose={() => closePanel('export')} />
      </Collapse>
      <Collapse open={panel === 'groups'} id="dv-panel-groups" outerClassName="dv-fold">
        <DeviceGroupsPanel devices={allDevices} consultationMode={consultationMode} onOpenDevice={tag => openInList(tag)} onCount={groups => setCounts(current => ({ ...current, groups }))} onClose={() => closePanel('groups')} />
      </Collapse>
      <Collapse open={panel === 'trash'} id="dv-panel-trash" outerClassName="dv-fold" unmountOnClose>
        <DeviceTrashPanel consultationMode={consultationMode} onRestored={refresh} onCount={trash => setCounts(current => ({ ...current, trash }))} onClose={() => closePanel('trash')} />
      </Collapse>

      <div className="dv-filters">
        <Segmented<StateFilter>
          label="Estado"
          size="sm"
          value={stateFilter}
          onChange={setStateFilter}
          options={STATE_FILTERS.map(item => ({ value: item.value, label: item.label, count: stateCounts[item.value] ?? 0 }))}
        />
        {types.length > 1 && (
          <Segmented
            label="Tipo"
            size="sm"
            value={typeFilter}
            onChange={setTypeFilter}
            options={[{ value: 'all', label: 'Todos', count: typeCounts.all }, ...types.map(type => ({ value: type, label: type, count: typeCounts[type] || 0 }))]}
          />
        )}
      </div>

      <section className="dv-card dv-list" aria-label="Lista de equipos">
        {/* Con equipos marcados, la barra de selección reemplaza SOLO el título:
            el buscador y el orden siguen a la vista y se pueden usar. */}
        <div className="dv-list-head">
        <SelectionHeader
          className="dv-selhead"
          count={consultationMode ? 0 : selection.count}
          noun={['equipo marcado', 'equipos marcados']}
          onClear={() => { selection.clear(); setBatch(null); }}
          confirm={batchConfirm}
          actions={(
            <>
              {hiddenSelected > 0 && (
                <>
                  <span className="dv-muted dv-nowrap"><span className="ui-mono">{hiddenSelected}</span> {hiddenSelected === 1 ? 'oculto' : 'ocultos'} por el filtro</span>
                  <Button size="sm" variant="ghost" onClick={() => selection.setSelected(selectedVisible.map(device => device.etiqueta))}>Desmarcar ocultos</Button>
                </>
              )}
              {props.onLoanBatch && toLend.length > 0 && <Button size="sm" variant="primary" disabled={busy} onClick={() => { props.onLoanBatch?.(toLend.map(device => device.etiqueta)); selection.clear(); }}>Prestar {toLend.length}</Button>}
              {props.onReturnBatch && toReturn.length > 0 && <Button size="sm" disabled={busy} onClick={() => setBatch({ kind: 'return' })}>Devolver {toReturn.length}</Button>}
              {notLoaned.length > 0 && <Button size="sm" disabled={busy} onClick={() => setBatch({ kind: 'status' })}>Cambiar estado</Button>}
              {selectedVisible.length > 0 && <Button size="sm" variant="danger" disabled={busy} onClick={() => setBatch({ kind: 'delete' })}>Borrar {selectedVisible.length}</Button>}
            </>
          )}
        >
            <div className="dv-list-title">
              <h3 className="dv-h3 dv-ell">{listTitle}</h3>
              <span className="dv-muted dv-nowrap"><span className="ui-mono">{visible.length}</span> visibles</span>
            </div>
        </SelectionHeader>
            <Input
              className="dv-search"
              aria-label="Filtrar por etiqueta, alias, número, SN o persona"
              prefix={<icons.IconSearch size={14} />}
              suffix={query ? <IconButton size="sm" label="Borrar búsqueda" icon={<icons.IconX size={14} />} onClick={() => setQuery('')} /> : undefined}
              value={query}
              onValueChange={setQuery}
              onKeyDown={event => { if (event.key === 'Escape' && query) { event.stopPropagation(); setQuery(''); } }}
              placeholder="touch34, D1436, plani 5, SN…"
              autoComplete="off"
              spellCheck={false}
            />
            <Segmented
              ariaLabel="Orden"
              size="sm"
              value={sort ? '' : order}
              onChange={value => { setOrder(value as 'original' | 'operational'); setSort(null); }}
              options={[{ value: 'original', label: 'Orden original' }, { value: 'operational', label: 'Nº operativo' }]}
            />
        </div>
        <Collapse open={Boolean(query.trim() && !sort)}>
          <p className="dv-hint">Mientras buscás, se ordena por número operativo. Entiende touch34, 34touch, D1436, 1436, plani 5, planificación 5, el SN y la persona que lo tiene.</p>
        </Collapse>

        {listStatus.element}

        {!consultationMode && (
          <Collapse open={creating} id="dv-create" className="dv-create" unmountOnClose>
            <DeviceForm existingTags={new Set(allDevices.map(item => item.etiqueta))} onSave={saveDevice} onCancel={() => closePanel('create')} />
          </Collapse>
        )}

        <Table
          className="dv-table"
          caption="Equipos de la sede"
          rows={shown}
          columns={columns}
          rowKey={device => device.etiqueta}
          manualSort
          sort={sort}
          onSortChange={setSort}
          cardBelow="lg"
          rowAttrs={device => ({ 'data-device-tag': device.etiqueta })}
          onRowClick={device => setOpen(current => (current?.tag === device.etiqueta && current.mode === 'ficha' ? null : { tag: device.etiqueta, mode: 'ficha' }))}
          selection={consultationMode ? undefined : { selected: selection.selected, onToggle, onToggleAll: () => selection.toggleMany(visibleKeys) }}
          expandedKey={open?.tag || null}
          renderExpanded={device => (open?.mode === 'edit' && !consultationMode ? (
            <DeviceForm initial={device} existingTags={new Set(allDevices.map(item => item.etiqueta))} onSave={saveDevice} onCancel={() => setOpen({ tag: device.etiqueta, mode: 'ficha' })} />
          ) : (
            <DeviceDetail consultationMode={consultationMode} {...detailActions(device)} />
          ))}
          empty={(
            <EmptyState
              compact
              title="No hay dispositivos para este filtro o búsqueda."
              action={(stateFilter !== 'all' || typeFilter !== 'all' || query) ? <Button size="sm" onClick={resetFilters}>Quitar filtros</Button> : undefined}
            />
          )}
        />

        <div className="dv-foot">
          {visible.length > 0 && <span className="dv-muted dv-nowrap">Mostrando <span className="ui-mono">{shown.length}</span> de <span className="ui-mono">{visible.length}</span></span>}
          {visible.length > shown.length && (
            <>
              <Button size="sm" onClick={() => setLimit(value => value + PAGE)}>Ver más</Button>
              <Button size="sm" variant="ghost" onClick={() => setLimit(visible.length)}>Ver todos</Button>
            </>
          )}
          {!consultationMode && (
            <span className="dv-help dv-foot-help">Clic: ficha · <Kbd>Ctrl</Kbd> o <Kbd>⌘</Kbd> + clic: marcar · <Kbd>Shift</Kbd> + clic: rango</span>
          )}
        </div>
      </section>
    </section>
  );
}
