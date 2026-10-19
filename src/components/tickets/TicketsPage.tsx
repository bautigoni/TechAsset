import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ExternalLink, LayoutTemplate, Ticket as TicketIcon } from 'lucide-react';
import { IconChevronLeft as ChevronLeft, IconPlus as Plus } from '../../ui/icons';
import '../../styles/screens/tickets.css';
import type { Classroom, Ticket, TicketSource, TicketState, TicketTemplate } from '../../types';
import { bulkTickets, getTickets, getTicketTemplates } from '../../services/ticketsApi';
import { getSiteAssistants, getSiteSettings } from '../../services/authApi';
import { fetchToolsConfig } from '../../services/toolsApi';
import { fetchClassrooms } from '../../services/classroomsApi';
import {
  Button, Checkbox, EmptyState, ErrorState, InlineConfirm, Input, SelectionHeader, Segmented, SkeletonRows, StatusText, useSelection, StatusSlot, useStatusLine
} from '../../ui';
import { TruncatedText } from '../../ui/Truncated';
import { IconLock, IconSearch, IconX } from '../../ui/icons';
import { cx, fold } from '../../ui/util';
import { appScroller } from '../../utils/scroll';
import { Collapse } from '../../ui';
import { TicketDetail } from './TicketDetail';
import { TicketForm } from './TicketForm';
import { TicketTemplates } from './TicketTemplates';
import {
  DEFAULT_HANDING, DEFAULT_INVGATE, ESTADOS, ORIGENES, errorText, estadoTone, externalLink, prioridadTone, readTicketRoute, sourceLabel,
  systemLabel, ticketAge, ticketHaystack, ticketNumber, ticketRoutePath, type LinkBases, type TicketRoute
} from './ticketUtils';

const PAGE = 30;
const NARROW = 880;
type Pending = { run: () => void } | null;

/**
 * Tickets: bandeja maestro-detalle. La lista (prioridad, número en mono, aula,
 * tags, estado y antigüedad como texto) a la izquierda; la ficha, el
 * formulario o las plantillas al lado, en línea. En angosto se ve una sola de
 * las dos, con "Volver". Cada ficha tiene su URL (/sede/x/tickets/<id>).
 */
export function TicketsPage({ consultationMode }: { consultationMode: boolean }) {
  const canEdit = !consultationMode;
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [templates, setTemplates] = useState<TicketTemplate[]>([]);
  const [templatesError, setTemplatesError] = useState('');
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [assistants, setAssistants] = useState<string[]>([]);
  const [bases, setBases] = useState<LinkBases>({ invgate: DEFAULT_INVGATE, handing: DEFAULT_HANDING });
  const [route, setRoute] = useState<TicketRoute>(() => readTicketRoute());
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState<'todos' | TicketState>('todos');
  const [origen, setOrigen] = useState<'todos' | TicketSource>('todos');
  const [limit, setLimit] = useState(PAGE);
  const selection = useSelection();
  const listStatus = useStatusLine();
  const paneStatus = useStatusLine();
  const [bulkBusy, setBulkBusy] = useState(false);
  const bulkRef = useRef(false);
  const setBulk = (on: boolean) => { bulkRef.current = on; setBulkBusy(on); };
  const [askBulkDelete, setAskBulkDelete] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const formDirty = useRef(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const paneRef = useRef<HTMLElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  // Volver a la lista en angosto: misma posición de scroll y foco en la fila.
  const returnPoint = useRef<{ id: number | null; top: number } | null>(null);
  const focusAfter = useRef<'pane' | 'row' | null>(null);

  /* ── Datos ── */
  const load = useCallback(async () => {
    try {
      const response = await getTickets();
      setTickets(response.items || []);
      setLoadError('');
    } catch (reason) {
      setLoadError(errorText(reason, 'No se pudieron cargar los tickets.'));
    } finally {
      setLoading(false);
    }
  }, []);
  const loadTemplates = useCallback(async () => {
    try {
      const response = await getTicketTemplates();
      setTemplates(response.items || []);
      setTemplatesError('');
    } catch (reason) {
      setTemplatesError(errorText(reason, 'No se pudieron cargar las plantillas.'));
    }
  }, []);
  useEffect(() => {
    void load();
    void loadTemplates();
    // Lo auxiliar (aulas, links, personas) no frena la pantalla si falla: los
    // campos quedan con lo que hay y el link usa la base por defecto.
    fetchClassrooms().then(response => setClassrooms(response.items || [])).catch(() => setClassrooms([]));
    getSiteAssistants().then(response => setAssistants((response.items || []).map(item => item.name).filter(Boolean))).catch(() => setAssistants([]));
    getSiteSettings()
      .then(response => {
        const url = String((response.settings as Record<string, unknown>)?.['tickets.invgateUrl'] || '').trim();
        if (url) setBases(current => ({ ...current, invgate: url.endsWith('/') ? url : `${url}/` }));
      })
      .catch(() => {});
    fetchToolsConfig()
      .then(response => { if (response.handingTicketUrl) setBases(current => ({ ...current, handing: response.handingTicketUrl })); })
      .catch(() => {});
  }, [load, loadTemplates]);
  const retry = async () => { setRetrying(true); await load(); setRetrying(false); };

  /* ── Rutas propias dentro de /tickets ── */
  useEffect(() => {
    const onPop = () => setRoute(readTicketRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // Con cambios sin guardar, cerrar la pestaña o recargar pide confirmación del navegador.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => { if (formDirty.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const go = useCallback((next: TicketRoute, { replace = false } = {}) => {
    const path = ticketRoutePath(next);
    if (window.location.pathname !== path) {
      if (replace) window.history.replaceState({ techasset: true }, '', path);
      else window.history.pushState({ techasset: true }, '', path);
    }
    setRoute(next);
    setPending(null);
  }, []);
  /** Si hay un formulario con cambios, primero se pregunta en línea. */
  const guard = (run: () => void) => {
    if (formDirty.current && (route.kind === 'new' || route.kind === 'edit')) { setPending({ run: () => { formDirty.current = false; run(); } }); return; }
    run();
  };

  /* ── Ancho: en angosto se ve la lista O el panel ── */
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width || 0;
      setNarrow(current => (current === width < NARROW ? current : width < NARROW));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const paneOpen = route.kind !== 'list';
  const currentId = route.kind === 'detail' || route.kind === 'edit' ? route.id : null;

  // Abrir o cerrar el panel lo deja a la vista (sin mover nada si ya se ve) y
  // en angosto, al volver, recupera la posición y el foco en la fila.
  useEffect(() => {
    const want = focusAfter.current;
    focusAfter.current = null;
    if (!want) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (want === 'pane') {
      const pane = paneRef.current;
      if (!pane) return;
      if (narrow) {
        const scroller = appScroller();
        if (scroller) {
          const top = pane.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 8;
          if (top < scroller.scrollTop) scroller.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
        }
        pane.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
      } else {
        // La ficha se abre al lado: si su encabezado quedó arriba de lo visible
        // (se abrió desde abajo de la lista), se lo trae; si ya se ve, nada se mueve.
        const scroller = appScroller();
        if (scroller) {
          const view = scroller.getBoundingClientRect();
          const box = pane.getBoundingClientRect();
          if (box.top < view.top || box.top > view.bottom - 120) {
            scroller.scrollTo({ top: Math.max(0, box.top - view.top + scroller.scrollTop - 12), behavior: reduced ? 'auto' : 'smooth' });
          }
        }
      }
    } else if (want === 'row') {
      const point = returnPoint.current;
      const scroller = appScroller();
      // En angosto la lista vuelve a aparecer: misma posición que cuando se abrió la ficha.
      if (point && scroller && narrow) scroller.scrollTo({ top: point.top, behavior: 'auto' });
      const row = point?.id ? wrapRef.current?.querySelector<HTMLElement>(`[data-ticket-id="${point.id}"] .tkx-row-open`) : null;
      if (row) {
        row.focus({ preventScroll: true });
        // En ancho la lista no se movió, salvo que se haya traído la ficha: la fila vuelve a la vista.
        if (!narrow && scroller) {
          const view = scroller.getBoundingClientRect();
          const box = row.getBoundingClientRect();
          if (box.bottom < view.top || box.top > view.bottom) scroller.scrollTo({ top: point?.top || 0, behavior: 'auto' });
        }
      }
    }
  }, [route, narrow]);

  const openPane = (next: TicketRoute) => guard(() => {
    if (route.kind === 'list') returnPoint.current = { id: next.kind === 'detail' ? next.id : null, top: appScroller()?.scrollTop || 0 };
    else if (next.kind === 'detail' && returnPoint.current) returnPoint.current = { ...returnPoint.current, id: next.id };
    focusAfter.current = 'pane';
    paneStatus.clear();
    go(next);
  });
  const backToList = () => guard(() => { focusAfter.current = 'row'; go({ kind: 'list' }); });

  /* ── Filtros (búsqueda sin tildes; conteos cruzados) ── */
  const query = fold(q);
  const haystacks = useMemo(() => new Map(tickets.map(ticket => [ticket.id, ticketHaystack(ticket)])), [tickets]);
  const matchesQ = useCallback((ticket: Ticket) => !query || (haystacks.get(ticket.id) || '').includes(query), [haystacks, query]);
  const byOrigin = useMemo(() => tickets.filter(ticket => matchesQ(ticket) && (origen === 'todos' || (ticket.origen || 'tik') === origen)), [tickets, matchesQ, origen]);
  const byEstado = useMemo(() => tickets.filter(ticket => matchesQ(ticket) && (estado === 'todos' || ticket.estado === estado)), [tickets, matchesQ, estado]);
  const visible = useMemo(() => byOrigin.filter(ticket => estado === 'todos' || ticket.estado === estado), [byOrigin, estado]);
  useEffect(() => { setLimit(PAGE); }, [query, estado, origen]);
  const shown = visible.slice(0, limit);
  const orderedKeys = useMemo(() => visible.map(ticket => String(ticket.id)), [visible]);
  const estadoOptions = [
    { value: 'todos' as const, label: 'Todos', count: byOrigin.length },
    ...ESTADOS.map(value => ({ value, label: value, count: byOrigin.filter(ticket => ticket.estado === value).length }))
  ];
  const origenOptions = [
    { value: 'todos' as const, label: 'Todos los orígenes', count: byEstado.length },
    ...ORIGENES.map(item => ({ value: item.key, label: item.label, count: byEstado.filter(ticket => (ticket.origen || 'tik') === item.key).length }))
  ];
  const clearFilters = () => { setQ(''); setEstado('todos'); setOrigen('todos'); };

  // La selección se recalcula contra lo que existe.
  useEffect(() => { selection.prune(tickets.map(ticket => String(ticket.id))); }, [tickets, selection.prune]);
  const selected = tickets.filter(ticket => selection.selected.has(String(ticket.id)));
  const visibleSelected = visible.filter(ticket => selection.selected.has(String(ticket.id))).length;
  useEffect(() => { if (!selection.count) setAskBulkDelete(false); }, [selection.count]);

  const patchLocal = useCallback((id: number, patch: Partial<Ticket>) => {
    setTickets(current => current.map(ticket => (ticket.id === id ? { ...ticket, ...patch } : ticket)));
  }, []);

  /* ── Lotes (un request) con Deshacer ── */
  const bulkEstado = async (next: TicketState) => {
    if (bulkRef.current) return;
    const targets = selected.filter(ticket => ticket.estado !== next);
    if (!targets.length) { listStatus.show({ tone: 'info', message: `Los seleccionados ya están en «${next}».` }); return; }
    const before = targets.map(ticket => ({ id: ticket.id, estado: ticket.estado }));
    setBulk(true);
    setTickets(current => current.map(ticket => (targets.some(target => target.id === ticket.id) ? { ...ticket, estado: next } : ticket)));
    try {
      const response = await bulkTickets({ action: 'estado', ids: targets.map(ticket => ticket.id), estado: next });
      selection.clear();
      const n = response.changed.length;
      listStatus.show({
        tone: 'ok',
        message: `${n} ${n === 1 ? 'ticket ahora está' : 'tickets ahora están'} en «${next}».`,
        undo: {
          onUndo: async () => {
            try {
              await bulkTickets({ action: 'estado', items: before });
              listStatus.show({ tone: 'info', message: 'Volvieron a su estado anterior.' });
            } catch (reason) {
              listStatus.show({ tone: 'bad', message: errorText(reason, 'No se pudo deshacer.') });
            }
            await load();
          }
        }
      });
      void load();
    } catch (reason) {
      listStatus.show({ tone: 'bad', message: errorText(reason, 'No se pudo cambiar el estado de los tickets.'), retry: { onRetry: () => bulkEstado(next) } });
      await load();
    } finally {
      setBulk(false);
    }
  };

  const bulkDelete = async () => {
    if (bulkRef.current) return;
    const ids = selected.map(ticket => ticket.id);
    setBulk(true);
    try {
      const response = await bulkTickets({ action: 'delete', ids });
      const removed = response.changed;
      setTickets(current => current.filter(ticket => !removed.includes(ticket.id)));
      selection.clear();
      setAskBulkDelete(false);
      if (currentId && removed.includes(currentId)) go({ kind: 'list' }, { replace: true });
      listStatus.show({
        tone: 'ok',
        message: `${removed.length} ${removed.length === 1 ? 'ticket borrado' : 'tickets borrados'}.`,
        undo: {
          onUndo: async () => {
            try {
              await bulkTickets({ action: 'restore', ids: removed });
              listStatus.show({ tone: 'info', message: `${removed.length === 1 ? 'Ticket recuperado' : 'Tickets recuperados'}.` });
            } catch (reason) {
              listStatus.show({ tone: 'bad', message: errorText(reason, 'No se pudieron recuperar.') });
            }
            await load();
          }
        }
      });
      void load();
    } catch (reason) {
      listStatus.show({ tone: 'bad', message: errorText(reason, 'No se pudieron borrar los tickets.') });
    } finally {
      setBulk(false);
    }
  };

  const onDeleted = (ticket: Ticket) => {
    setTickets(current => current.filter(item => item.id !== ticket.id));
    focusAfter.current = 'row';
    go({ kind: 'list' }, { replace: true });
    listStatus.show({
      tone: 'ok',
      message: `Ticket ${ticketNumber(ticket)} borrado.`,
      undo: {
        onUndo: async () => {
          try {
            await bulkTickets({ action: 'restore', ids: [ticket.id] });
            await load();
            listStatus.show({ tone: 'info', message: `Ticket ${ticketNumber(ticket)} recuperado.`, action: { label: 'Abrir', onClick: () => openPane({ kind: 'detail', id: ticket.id }) } });
          } catch (reason) {
            listStatus.show({ tone: 'bad', message: errorText(reason, 'No se pudo recuperar el ticket.') });
          }
        }
      }
    });
  };

  /* ── Filas: click abre; Ctrl/Cmd+click marca; Shift+click marca el rango ── */
  const onRowClick = (ticket: Ticket, event: MouseEvent<HTMLElement>) => {
    if (canEdit && selection.handleClick(String(ticket.id), event, orderedKeys)) return;
    openPane({ kind: 'detail', id: ticket.id });
  };
  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const target = event.target as HTMLElement;
    if (!target.classList.contains('tkx-row-open')) return;
    const rows = [...(event.currentTarget.querySelectorAll<HTMLElement>('.tkx-row-open'))];
    const index = rows.indexOf(target);
    const next = rows[index + (event.key === 'ArrowDown' ? 1 : -1)];
    if (next) { event.preventDefault(); next.focus(); }
  };

  const allVisible = visible.length > 0 && visibleSelected === visible.length;
  const selectAll = () => {
    if (allVisible) selection.clear();
    else { selection.setMode(true); selection.setSelected([...selection.selected, ...orderedKeys]); }
  };

  const editingTicket = route.kind === 'edit' ? tickets.find(ticket => ticket.id === route.id) : undefined;
  const paneLabel = route.kind === 'new' || route.kind === 'edit' ? 'Formulario de ticket' : route.kind === 'templates' ? 'Plantillas' : 'Detalle del ticket';

  const renderPane = () => {
    if (route.kind === 'list') {
      return <EmptyState compact icon={<TicketIcon size={18} strokeWidth={1.6} />} title="Elegí un ticket de la lista" description="El detalle se abre acá, al lado de la lista. Ctrl o Shift + click marca varios." />;
    }
    if (route.kind === 'templates') {
      return (
        <TicketTemplates
          templates={templates}
          loadError={templatesError}
          canEdit={canEdit}
          onReload={loadTemplates}
          onClose={backToList}
          closeLabel="Volver a la lista"
        />
      );
    }
    if ((route.kind === 'new' || route.kind === 'edit') && !canEdit) {
      return <EmptyState title="Modo consulta: solo lectura" description="En este modo no se pueden cargar ni editar tickets." action={<Button size="sm" variant="secondary" onClick={backToList}>Volver a la lista</Button>} />;
    }
    if (route.kind === 'new' || route.kind === 'edit') {
      if (route.kind === 'edit' && !editingTicket) {
        return loading ? <SkeletonRows rows={4} /> : <EmptyState title="Este ticket no existe o fue borrado." action={<Button size="sm" variant="secondary" onClick={backToList}>Volver a la lista</Button>} />;
      }
      return (
        <TicketForm
          key={route.kind === 'edit' ? `edit-${route.id}` : 'new'}
          initial={editingTicket}
          templates={templates}
          classrooms={classrooms}
          assistants={assistants}
          tickets={tickets}
          bases={bases}
          onDirtyChange={dirty => { formDirty.current = dirty; }}
          onCancel={() => guard(() => {
            focusAfter.current = route.kind === 'edit' ? 'pane' : 'row';
            if (route.kind === 'edit') go({ kind: 'detail', id: route.id });
            else go({ kind: 'list' });
          })}
          onSaved={(ticket, created) => {
            formDirty.current = false;
            setTickets(current => (created ? [ticket, ...current] : current.map(item => (item.id === ticket.id ? ticket : item))));
            focusAfter.current = 'pane';
            go({ kind: 'detail', id: ticket.id }, { replace: true });
            paneStatus.show({ tone: 'ok', message: created ? `Ticket ${ticketNumber(ticket)} cargado.` : `Cambios de ${ticketNumber(ticket)} guardados.` });
            void load();
          }}
        />
      );
    }
    return (
      <TicketDetail
        key={route.id}
        id={route.id}
        tickets={tickets}
        classrooms={classrooms}
        bases={bases}
        canEdit={canEdit}
        onOpen={id => openPane({ kind: 'detail', id })}
        onEdit={id => openPane({ kind: 'edit', id })}
        onDeleted={onDeleted}
        onLocalPatch={patchLocal}
        onChanged={() => void load()}
      />
    );
  };

  return (
    <section className={cx('view active tkx', narrow && 'is-narrow')} aria-label="Tickets">
      <div className="tkx-toolbar">
        <Input
          className="tkx-search"
          type="search"
          aria-label="Buscar tickets"
          prefix={<IconSearch size={16} />}
          suffix={q ? <button type="button" className="ui-icon-btn ui-btn--ghost ui-btn--sm" aria-label="Limpiar búsqueda" onClick={() => setQ('')}><IconX size={14} /></button> : undefined}
          value={q}
          placeholder="Buscar número, título, descripción, categoría, quién lo cargó o responsable"
          autoComplete="off"
          onValueChange={setQ}
        />
        {canEdit ? (
          <div className="tkx-actions">
            <Button variant="secondary" icon={<LayoutTemplate size={16} />} aria-pressed={route.kind === 'templates'} onClick={() => openPane({ kind: 'templates' })}>Plantillas</Button>
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => openPane({ kind: 'new' })}>Cargar ticket</Button>
          </div>
        ) : (
          <span className="tkx-consulta"><IconLock size={14} /> Modo consulta: solo lectura</span>
        )}
      </div>

      <div className="tkx-filters">
        <Segmented ariaLabel="Filtrar por estado" size="sm" value={estado} onChange={setEstado} options={estadoOptions} />
        <Segmented ariaLabel="Filtrar por origen" size="sm" value={origen} onChange={setOrigen} options={origenOptions} />
        <span className="tkx-count" role="status">{visible.length} {visible.length === 1 ? 'resultado' : 'resultados'}</span>
      </div>

      <div ref={wrapRef} className={cx('tkx-wrap', paneOpen ? 'has-pane' : 'no-pane')}>
        <section className="tkx-list" aria-label="Lista de tickets">
          <div className="tkx-list-head">
            <SelectionHeader
              count={canEdit ? selected.length : 0}
              onClear={selection.clear}
              noun={['ticket seleccionado', 'tickets seleccionados']}
              confirm={askBulkDelete ? (
                <InlineConfirm
                  danger
                  busy={bulkBusy}
                  message={`¿Borrar ${selected.length} ${selected.length === 1 ? 'ticket' : 'tickets'}?`}
                  detail={`${selected.map(ticketNumber).join(', ')}. Salen de la lista y quedan guardados como borrados; vas a poder deshacerlo.`}
                  confirmLabel={`Borrar ${selected.length}`}
                  onConfirm={() => void bulkDelete()}
                  onCancel={() => setAskBulkDelete(false)}
                />
              ) : undefined}
              actions={(
                <>
                  <Checkbox checked={allVisible} indeterminate={!allVisible && visibleSelected > 0} ariaLabel="Seleccionar todos los visibles" onCheckedChange={selectAll} />
                  <span className="tkx-small tkx-muted tkx-nowrap">Pasar a</span>
                  {ESTADOS.map(value => (
                    <Button key={value} size="sm" variant="secondary" disabled={bulkBusy} onClick={() => void bulkEstado(value)}>{value}</Button>
                  ))}
                  <Button size="sm" variant="danger" disabled={bulkBusy} onClick={() => setAskBulkDelete(true)}>Borrar</Button>
                </>
              )}
            >
              <div className="tkx-list-title">
                {canEdit && visible.length > 0 && (
                  <Checkbox checked={false} ariaLabel="Seleccionar todos los visibles" onCheckedChange={selectAll} />
                )}
                <span className="ui-eyebrow">Pendientes primero</span>
                <span className="tkx-small tkx-muted tkx-ell">No hecho · En proceso · Hecho</span>
              </div>
            </SelectionHeader>
          </div>
          <StatusSlot status={listStatus} className="tkx-list-status" />

          {loading && !tickets.length ? (
            <SkeletonRows rows={6} className="tkx-skel" />
          ) : loadError && !tickets.length ? (
            <ErrorState message={loadError} onRetry={() => void retry()} retrying={retrying} />
          ) : !visible.length ? (
            tickets.length
              ? <EmptyState compact title="No hay tickets en este filtro." action={<Button size="sm" variant="secondary" onClick={clearFilters}>Limpiar filtros y búsqueda</Button>} />
              : <EmptyState compact title="Todavía no hay tickets cargados." description="Cargá el primero con su número de InVgate o la referencia de Handing." action={canEdit ? <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => openPane({ kind: 'new' })}>Cargar ticket</Button> : undefined} />
          ) : (
            <div className="tkx-rows" onKeyDown={onListKeyDown}>
              {loadError && <ErrorState message={loadError} onRetry={() => void retry()} retrying={retrying} />}
              {shown.map(ticket => {
                const key = String(ticket.id);
                const checked = selection.selected.has(key);
                const current = currentId === ticket.id;
                const age = ticketAge(ticket);
                const prio = prioridadTone(ticket.prioridad);
                const meta = [ticket.classroom, (ticket.tags || []).slice(0, 3).join(', '), ticket.responsables?.length ? ticket.responsables.join(', ') : 'Sin responsable'].filter(Boolean).join(' · ');
                return (
                  <div key={ticket.id} className={cx('tkx-row', current && 'is-current', checked && 'is-selected')} data-ticket-id={ticket.id}>
                    {canEdit && (
                      <Checkbox
                        className="tkx-row-check"
                        checked={checked}
                        ariaLabel={`Seleccionar ${ticketNumber(ticket)} ${ticket.titulo}`}
                        onCheckedChange={(_, event) => {
                          selection.setMode(true);
                          if (event.shiftKey) selection.selectRange(key, orderedKeys);
                          else selection.toggle(key);
                        }}
                      />
                    )}
                    <a className="tkx-row-open" href={ticketRoutePath({ kind: 'detail', id: ticket.id })} aria-current={current ? 'page' : undefined} onClick={event => { if (event.button !== 0) return; event.preventDefault(); onRowClick(ticket, event); }}>
                      <span className="tkx-row-line">
                        <span className="tkx-mono tkx-strong tkx-nowrap">{ticketNumber(ticket)}</span>
                        <span className="tkx-muted tkx-small tkx-nowrap">{sourceLabel(ticket.origen)}</span>
                        <span className="tkx-grow" />
                        {prio && <StatusText tone={prio} className="tkx-small">{ticket.prioridad}</StatusText>}
                        <StatusText tone={estadoTone(ticket.estado)} strong className="tkx-small">{ticket.estado}</StatusText>
                      </span>
                      <TruncatedText className="tkx-row-title" lines={2}>{ticket.titulo || 'Ticket sin título'}</TruncatedText>
                      <span className="tkx-row-line">
                        <TruncatedText className="tkx-row-meta">{meta}</TruncatedText>
                        {age.label && <StatusText tone={age.tone} className="tkx-small tkx-nowrap">{age.label}</StatusText>}
                      </span>
                    </a>
                    <a className="ui-icon-btn ui-btn--ghost ui-btn--sm tkx-row-ext" href={externalLink(ticket, bases)} target="_blank" rel="noreferrer" aria-label={`Abrir ${ticketNumber(ticket)} en ${systemLabel(ticket.origen)}`}>
                      <ExternalLink size={14} aria-hidden="true" />
                    </a>
                  </div>
                );
              })}
              {visible.length > shown.length && (
                <div className="tkx-more">
                  <Button size="sm" variant="ghost" onClick={() => setLimit(current => current + PAGE)}>
                    Ver {Math.min(PAGE, visible.length - shown.length)} más ({visible.length - shown.length} restantes)
                  </Button>
                </div>
              )}
            </div>
          )}
          <p className="tkx-list-foot tkx-small tkx-muted">Click en un ticket para ver el detalle. El ícono de la derecha abre el sistema externo.</p>
        </section>

        <section ref={paneRef} className={`tkx-pane${route.kind === 'list' ? ' is-idle' : ''}`} aria-label={paneLabel}>
          {narrow && paneOpen && (
            <Button size="sm" variant="ghost" className="tkx-back" icon={<ChevronLeft size={16} />} onClick={backToList}>Volver a la lista</Button>
          )}
          <Collapse open={Boolean(pending)} unmountOnClose>
            <InlineConfirm
              danger
              message="Tenés cambios sin guardar."
              detail="Si salís ahora se pierden."
              confirmLabel="Descartar y salir"
              cancelLabel="Seguir editando"
              onConfirm={() => pending?.run()}
              onCancel={() => setPending(null)}
            />
          </Collapse>
          <StatusSlot status={paneStatus} />
          {renderPane()}
        </section>
      </div>
    </section>
  );
}
