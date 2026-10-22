import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { ArrowLeft, ClipboardList, Columns3, Eye, ListChecks, Lock, Trash2, Users, X } from 'lucide-react';
import type { TaskChecklistItem, TaskColumn, TaskItem } from '../../types';
import type { TasksStore } from '../../hooks/useTasks';
import { Button, Checkbox, Collapse, EmptyState, ErrorState, IconButton, InlineConfirm, Input, Kbd, SkeletonText, StatusLine, StatusSlot, TruncatedText, cx, recentTrigger, scrollParentOf, useAnchoredToggle, useSelection, useStatusLine, type StatusMessage } from '../../ui';
import { IconSearch } from '../../ui/icons';
import { GooeyMenu } from '../layout/GooeyMenu';
import { getSiteAssistants } from '../../services/authApi';
import { getActiveSiteCode } from '../../services/activeSite';
import { createTaskColumn, deleteTaskColumn, getTaskColumns, reorderTaskColumns, restoreTaskColumn, updateTaskColumn } from '../../services/tasksApi';
import { isEditableTarget } from '../../hooks/useGlobalScanner';
import { scrollAppToTop } from '../../utils/scroll';
import { TaskBoard, TaskBoardSkeleton, type Lane } from './TaskBoard';
import { TaskForm } from './TaskForm';
import { TaskDetail, TaskNotFound } from './TaskDetail';
import { TaskAnalytics } from './TaskAnalytics';
import { MOBILE_QUERY, PillTabs, useMedia } from './TaskBits';
import type { CardHandlers } from './TaskCard';
import { useTaskActions } from './useTaskActions';
import { useSmoothHeight } from './Presence';
import {
  PAGE_SIZE, PRIORITIES, columnOf, dueInfo, inSpace, isTaskDone, matchesQuery, plural, priorityLane, readTaskRoute, sortTasks, taskRouteUrl,
  type Space, type Tab, type TaskRoute
} from './taskModel';
import '../../styles/screens/tasks.css';

type Person = { name: string; email?: string; turno?: string };
type ColumnsState = 'loading' | 'ready' | 'error';

const errorText = (reason: unknown, fallback: string) => (reason instanceof Error && reason.message ? reason.message : fallback);

/**
 * Tareas TIC (rediseño Grafito). Tablero / Prioridad, Equipo / Mis tareas,
 * alta en línea arriba del tablero, la tarea como página propia con URL,
 * selección múltiple con la barra que reemplaza a la de herramientas, y
 * Deshacer / Reintentar como línea de estado. El "+" (menú gooey) es el de
 * siempre; al abrirse empuja el contenido.
 */
export function TasksPage({ store: core, operator, consultationMode }: { store: TasksStore; operator: string; consultationMode: boolean }) {
  const store = useTaskActions(core);
  const canEdit = !consultationMode;
  const isMobile = useMedia(MOBILE_QUERY);
  // Debajo de 900 px el "+" va pegado al borde: su rótulo tiene que ser corto para no cortarse.
  const narrowGoo = useMedia('(max-width: 899px)');
  const tasks = store.items;

  const [space, setSpace] = useState<Space>('team');
  const [tab, setTab] = useState<Tab>('board');
  const [query, setQuery] = useState('');
  // Las columnas llegan con la lista de tareas (useTasks): el tablero se dibuja
  // al abrir; el pedido de abajo solo las refresca, sin esqueleto.
  const [columns, setColumns] = useState<TaskColumn[]>(() => core.columns);
  const [columnsState, setColumnsState] = useState<ColumnsState>(() => (core.columns.length ? 'ready' : 'loading'));
  const [route, setRoute] = useState<TaskRoute>(readTaskRoute);
  const [creating, setCreating] = useState<'team' | 'private' | null>(null);
  const [colForm, setColForm] = useState<{ name: string; error: string; saving: boolean } | null>(null);
  const [gooOpen, setGooOpen] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  // "Elegir": modo selección explícito (sobre todo en touch, donde no hay
  // Ctrl+click ni hover que muestre las casillas).
  const [selecting, setSelecting] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [shown, setShown] = useState<Record<string, number>>({});
  const [mobileKey, setMobileKey] = useState('');
  const [reveal, setReveal] = useState<{ key: string; n: number } | null>(null);
  const [cardStatus, setCardStatus] = useState<{ taskId: string; key: number; message: StatusMessage } | null>(null);
  const boardStatus = useStatusLine();
  const detailStatus = useStatusLine();
  const selection = useSelection();
  const pushed = useRef(0);
  const colInputRef = useRef<HTMLInputElement | null>(null);

  /* ── Datos ── */
  const loadColumns = useCallback(async () => {
    try {
      const response = await getTaskColumns();
      // Igual a lo que ya se ve (llegó con la lista): sin re-render del tablero.
      setColumns(current => (JSON.stringify(current) === JSON.stringify(response.items) ? current : response.items));
      setColumnsState('ready');
    } catch {
      setColumnsState(current => (current === 'ready' ? current : 'error'));
    }
  }, []);
  // Si las columnas llegaron con la lista no se piden de nuevo al abrir (era un
  // pedido más antes de "a la vista", pasada 3): se siguen de la lista, que se
  // pollea. Solo se adopta lo nuevo si acá no se tocaron (un reordenar en curso
  // no se pisa con una lista vieja).
  useEffect(() => { if (!core.columns.length) void loadColumns(); }, [loadColumns]); // eslint-disable-line react-hooks/exhaustive-deps
  const seenCoreColumns = useRef(core.columns);
  useEffect(() => {
    const previous = seenCoreColumns.current;
    seenCoreColumns.current = core.columns;
    if (!core.columns.length || previous === core.columns) return;
    setColumns(current => (JSON.stringify(current) === JSON.stringify(previous) && JSON.stringify(current) !== JSON.stringify(core.columns) ? core.columns : current));
    setColumnsState('ready');
  }, [core.columns]);
  useEffect(() => {
    getSiteAssistants().then(response => setPeople(response.items.filter(item => item.name))).catch(() => setPeople([]));
  }, []);

  /* ── URL: /sede/<sede>/tasks[/<id>[/editar]] ── */
  useEffect(() => {
    const onPop = () => {
      if (pushed.current > 0) pushed.current -= 1;
      setRoute(readTaskRoute());
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = useCallback((next: TaskRoute, replace = false) => {
    const url = taskRouteUrl(next, getActiveSiteCode());
    if (url !== window.location.pathname) {
      if (replace) window.history.replaceState({ techasset: true }, '', url);
      else { window.history.pushState({ techasset: true }, '', url); pushed.current += 1; }
    }
    setRoute(next);
    setBulkConfirm(false);
    scrollAppToTop();
  }, []);
  // "Tareas TIC" en el menú estando en la página de una tarea: vuelve al tablero
  // (App no cambia de vista porque ya está en Tareas).
  useEffect(() => {
    const onClick = (event: globalThis.MouseEvent) => {
      if (!(event.target as HTMLElement | null)?.closest?.('[data-view="tasks"]') || !readTaskRoute()) return;
      go(null);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [go]);
  /** Volver: si la entrada la sumamos nosotros, Atrás del navegador (no crece el historial). */
  const back = useCallback((to: TaskRoute) => {
    if (pushed.current > 0) { window.history.back(); return; }
    go(to, true);
  }, [go]);

  /* ── Derivados ── */
  const doneOf = useCallback((task: TaskItem) => isTaskDone(task, columns), [columns]);
  const spaceTasks = useMemo(() => tasks.filter(task => inSpace(task, space, operator)), [tasks, space, operator]);
  const visible = useMemo(() => sortTasks(spaceTasks.filter(task => matchesQuery(task, query)), columns), [spaceTasks, query, columns]);
  const lanes = useMemo<Lane[]>(() => (tab === 'board'
    ? columns.map(column => ({ key: `c${column.id}`, title: column.name, column, tasks: visible.filter(task => columnOf(task, columns)?.id === column.id) }))
    : PRIORITIES.map(priority => ({ key: `p${priority}`, title: priority, tasks: visible.filter(task => !isTaskDone(task, columns) && priorityLane(task) === priority) }))
  ), [tab, columns, visible]);
  const openIn = (sp: Space) => tasks.filter(task => inSpace(task, sp, operator) && !doneOf(task)).length;
  const openN = visible.filter(task => !doneOf(task)).length;
  const doneN = visible.length - openN;
  const overN = visible.filter(task => dueInfo(task, doneOf(task))?.overdue).length;
  const tipos = useMemo(() => Array.from(new Set(tasks.map(task => task.tipo || '').filter(Boolean))), [tasks]);

  const resetKey = `${space}:${tab}`;
  const boardEmpty = store.loaded && !query.trim() && (tab === 'board' ? visible.length === 0 : openN === 0);
  useEffect(() => { setShown({}); }, [space, tab, query]);
  const shownIn = useCallback((key: string) => shown[key] ?? PAGE_SIZE, [shown]);
  const activeKey = lanes.some(lane => lane.key === mobileKey) ? mobileKey : lanes[0]?.key || '';
  const boardRef = useSmoothHeight<HTMLElement>(`${resetKey}:${isMobile ? activeKey : ''}`);
  // Orden de lo que se ve (para Shift+click con rango y "seleccionar todo").
  const order = useMemo(() => (isMobile ? lanes.filter(lane => lane.key === activeKey) : lanes).flatMap(lane => lane.tasks.slice(0, shownIn(lane.key)).map(task => task.id)), [isMobile, lanes, activeKey, shownIn]);

  // La selección se recalcula contra lo vivo (una tarea borrada por otro sale sola).
  useEffect(() => { selection.prune(tasks.map(task => task.id)); }, [tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cambiar de solapa, de espacio o de columna (mobile) reemplaza el tablero:
  // el segmentado tocado queda quieto y el tablero pasa de un alto al otro
  // suave (useSmoothHeight), nunca de golpe.
  const anchored = useAnchoredToggle();
  const changeSpace = (next: Space) => { if (next !== space) anchored(() => { setSpace(next); setCardStatus(null); }); };
  const changeTab = (next: Tab) => { if (next !== tab) anchored(() => { setTab(next); setCardStatus(null); }); };
  const changeLane = (key: string) => anchored(() => setMobileKey(key));

  /* ── Líneas de estado ── */
  const showCard = (taskId: string, message: StatusMessage) => setCardStatus({ taskId, message, key: Date.now() });
  const showFor = (place: 'card' | 'detail' | 'board', taskId: string, message: StatusMessage) => {
    if (place === 'detail') detailStatus.show(message);
    else if (place === 'card') showCard(taskId, message);
    else boardStatus.show(message);
  };

  /* ── Mover ── */
  const columnName = (id: number | null | undefined, fallback: string) => columns.find(column => column.id === id)?.name || fallback;
  const moveTasks = async (ids: string[], column: TaskColumn, bulk: boolean, place: 'board' | 'detail' = 'board') => {
    const status = place === 'detail' ? detailStatus : boardStatus;
    const before = new Map(tasks.filter(task => ids.includes(task.id)).map(task => [task.id, task]));
    if (bulk) { selection.clear(); setSelecting(false); setBulkConfirm(false); }
    try {
      const { result, moved } = await store.moveMany(ids, column);
      if (result === 'busy') { status.show({ tone: 'info', message: 'Esperá un segundo: todavía se está guardando el movimiento anterior.' }); return; }
      if (result !== 'ok') return;
      if (bulk) status.show({ tone: 'ok', message: `${plural(moved.length, 'tarea', 'tareas')} en «${column.name}».`, undo: { onUndo: () => store.moveBack(moved) } });
      else if (place === 'detail') status.show({ tone: 'ok', message: `Movida a «${column.name}».`, undo: { onUndo: () => store.moveBack(moved) } });
    } catch (reason) {
      const failed = (reason as { failed?: string[] }).failed || ids;
      const first = before.get(failed[0]);
      const from = first ? columnName(first.columnId, first.estado) : '';
      status.show({
        tone: 'bad',
        message: `No se pudo mover «${first?.titulo || 'la tarea'}» a «${column.name}». ${failed.length > 1 ? `${failed.length} tareas volvieron` : `Volvió a «${from}»`}. ${errorText(reason, '')}`.trim(),
        retry: { onRetry: () => moveTasks(failed, column, false, place) }
      });
    }
  };
  const keyMove = (task: TaskItem, dir: -1 | 1) => {
    const current = columnOf(task, columns);
    const index = columns.findIndex(column => column.id === current?.id);
    const target = columns[index + dir];
    if (target) void moveTasks([task.id], target, false);
  };

  /* ── Borrar (con Deshacer) ── */
  const deleteTasks = async (ids: string[]) => {
    setBulkConfirm(false);
    setSelecting(false);
    for (const id of ids) if (selection.isSelected(id)) selection.toggle(id);
    const { removed, failed } = await store.removeMany(ids);
    if (failed.length) {
      boardStatus.show({
        tone: 'bad',
        message: `No se ${failed.length === 1 ? 'pudo' : 'pudieron'} borrar: ${failed.map(task => `«${task.titulo}»`).join(', ')}.${removed.length ? ` ${plural(removed.length, 'se borró', 'se borraron')}.` : ''}`,
        retry: { onRetry: () => deleteTasks(failed.map(task => task.id)) }
      });
      return;
    }
    if (!removed.length) return;
    boardStatus.show({
      tone: 'info',
      message: removed.length === 1 ? `Borraste «${removed[0].titulo}».` : `Borraste ${removed.length} tareas.`,
      undo: {
        seconds: 10,
        onUndo: async () => {
          try { await store.restore(removed); } catch (reason) { boardStatus.show({ tone: 'bad', message: errorText(reason, 'No se pudo deshacer el borrado.') }); }
        }
      }
    });
  };

  /* ── Subtareas (al instante) ── */
  const toggleItem = (task: TaskItem, item: TaskChecklistItem, next: boolean, place: 'card' | 'detail') => {
    store.toggleItem(task.id, item.id, next).catch(reason => showFor(place, task.id, {
      tone: 'bad', message: `No se pudo ${next ? 'tildar' : 'destildar'} «${item.texto}». ${errorText(reason, '')}`.trim(),
      retry: { onRetry: () => toggleItem(task, item, next, place) }
    }));
  };
  const addItem = (task: TaskItem, texto: string, place: 'card' | 'detail') => {
    store.addItem(task.id, texto).catch(reason => showFor(place, task.id, {
      tone: 'bad', message: `No se pudo agregar «${texto}». ${errorText(reason, '')}`.trim(),
      retry: { onRetry: () => addItem(task, texto, place) }
    }));
  };
  const removeItem = (task: TaskItem, item: TaskChecklistItem, place: 'card' | 'detail') => {
    store.removeItem(task.id, item)
      .then(() => showFor(place, task.id, {
        tone: 'info',
        message: `Quitaste «${item.texto}».`,
        // Deshacer: la vuelve a crear con el mismo texto (al final) y, si estaba hecha, tildada.
        undo: { onUndo: () => store.addItem(task.id, item.texto, item.completada).then(() => undefined, reason => showFor(place, task.id, { tone: 'bad', message: errorText(reason, 'No se pudo restaurar la subtarea.') })) }
      }))
      .catch(reason => showFor(place, task.id, { tone: 'bad', message: `No se pudo quitar «${item.texto}». ${errorText(reason, '')}`.trim(), retry: { onRetry: () => removeItem(task, item, place) } }));
  };

  /* ── Columnas ── */
  const createColumn = async () => {
    // Doble Enter no crea dos columnas (la lista de columnas todavía no se recargó).
    if (!colForm || colForm.saving) return;
    const name = colForm.name.trim();
    if (!name) { setColForm({ ...colForm, error: 'Poné un nombre.' }); return; }
    if (columns.some(column => column.name.toLowerCase() === name.toLowerCase())) { setColForm({ ...colForm, error: `Ya hay una columna «${name}».` }); return; }
    setColForm({ ...colForm, saving: true, error: '' });
    try {
      const response = await createTaskColumn({ name });
      await loadColumns();
      setColForm(null);
      setTab('board');
      setMobileKey(`c${response.item.id}`);
      setReveal(current => ({ key: `c${response.item.id}`, n: (current?.n || 0) + 1 }));
      boardStatus.show({
        tone: 'ok',
        message: `Creaste la columna «${name}».`,
        undo: { onUndo: async () => { try { await deleteTaskColumn(response.item.id); await loadColumns(); await store.refresh(); } catch (reason) { boardStatus.show({ tone: 'bad', message: errorText(reason, 'No se pudo deshacer.') }); } } }
      });
    } catch (reason) {
      setColForm(current => current && { ...current, saving: false, error: errorText(reason, 'No se pudo crear la columna.') });
    }
  };
  const saveColumn = async (column: TaskColumn, patch: { name: string; isDone: boolean }) => {
    await updateTaskColumn(column.id, patch);
    await loadColumns();
    await store.refresh();
  };
  const deleteColumn = async (column: TaskColumn) => {
    const order = columns.map(item => item.id);
    const movedIds = tasks.filter(task => columnOf(task, columns)?.id === column.id).map(task => task.id);
    try {
      const response = await deleteTaskColumn(column.id);
      await loadColumns();
      await store.refresh();
      const fallback = response.fallback?.name || columns.find(item => item.id !== column.id)?.name || '';
      boardStatus.show({
        tone: 'info',
        message: `Eliminaste «${column.name}».${movedIds.length ? ` ${plural(movedIds.length, 'tarea pasó', 'tareas pasaron')} a «${fallback}».` : ''}`,
        undo: {
          seconds: 10,
          onUndo: async () => {
            try {
              const restored = await restoreTaskColumn(column.id, { taskIds: movedIds, ids: order });
              setColumns(restored.items);
              await store.refresh();
            } catch (reason) {
              boardStatus.show({ tone: 'bad', message: errorText(reason, 'No se pudo deshacer.') });
            }
          }
        }
      });
    } catch (reason) {
      boardStatus.show({ tone: 'bad', message: `No se pudo eliminar «${column.name}». ${errorText(reason, '')}`.trim(), retry: { onRetry: () => deleteColumn(column) } });
    }
  };
  const reorderColumns = async (ids: number[]) => {
    const previous = columns;
    setColumns(ids.map(id => columns.find(column => column.id === id)).filter((column): column is TaskColumn => Boolean(column)));
    try {
      const response = await reorderTaskColumns(ids);
      setColumns(response.items);
    } catch (reason) {
      setColumns(previous);
      boardStatus.show({ tone: 'bad', message: `No se pudo reordenar las columnas. ${errorText(reason, '')}`.trim(), retry: { onRetry: () => reorderColumns(ids) } });
    }
  };

  /* ── Alta y edición ── */
  const openCreate = (visibility: 'team' | 'private') => {
    const target: Space = visibility === 'private' ? 'my' : 'team';
    changeSpace(target);
    setCreating(visibility);
    setColForm(null);
    selection.clear();
    setSelecting(false);
    if (route) go(null);
    scrollAppToTop();
  };
  const openColumnForm = () => {
    setCreating(null);
    setColForm({ name: '', error: '', saving: false });
    if (route) go(null);
    window.setTimeout(() => colInputRef.current?.focus(), 60);
  };
  const submitCreate = async (payload: Partial<TaskItem>) => {
    const item = await store.save(payload);
    setCreating(null);
    const first = columns[0];
    if (first) setMobileKey(`c${first.id}`);
    const landing = first ? ` en «${first.name}»` : '';
    if (item?.visibility === 'private' && space === 'team') {
      boardStatus.show({ tone: 'ok', message: `Creaste «${item.titulo}»${landing}. Es privada: está en Mis tareas.`, action: { label: 'Ver Mis tareas', onClick: () => changeSpace('my') } });
    } else if (item && space === 'my' && !inSpace(item, 'my', operator)) {
      boardStatus.show({ tone: 'ok', message: `Creaste «${item.titulo}»${landing}. No estás entre los responsables: está en Grupo.`, action: { label: 'Ver Grupo', onClick: () => changeSpace('team') } });
    } else if (item) {
      boardStatus.show({ tone: 'ok', message: `Creaste «${item.titulo}»${landing}.`, undo: { onUndo: async () => { await store.removeMany([item.id]); } } });
    }
  };
  const submitEdit = async (payload: Partial<TaskItem>) => {
    await store.save(payload);
    if (route) go({ id: route.id, edit: false }, true);
    detailStatus.show({ tone: 'ok', message: 'Guardaste los cambios.' });
  };

  /* ── Selección y apertura ── */
  const latest = useRef({ selection, order, canEdit, isMobile, selecting, go, keyMove, toggleItem, addItem, removeItem });
  latest.current = { selection, order, canEdit, isMobile, selecting, go, keyMove, toggleItem, addItem, removeItem };
  const handlers = useMemo<Omit<CardHandlers, 'onPointerDown'>>(() => ({
    onOpen: (task: TaskItem, event: MouseEvent) => {
      const l = latest.current;
      // Eligiendo ("Elegir"): tocar la tarjeta la marca o la desmarca, no la abre.
      if (l.canEdit && l.selecting) {
        if (event.shiftKey) l.selection.selectRange(task.id, l.order);
        else l.selection.toggle(task.id);
        return;
      }
      if (l.canEdit && (event.ctrlKey || event.metaKey || event.shiftKey || (l.isMobile && l.selection.count > 0))) {
        l.selection.handleClick(task.id, event, l.order);
        return;
      }
      l.go({ id: task.id, edit: false });
    },
    onSelect: (task: TaskItem, event: MouseEvent) => {
      const l = latest.current;
      if (event.shiftKey) l.selection.selectRange(task.id, l.order);
      else l.selection.toggle(task.id);
    },
    onKeyMove: (task: TaskItem, dir: -1 | 1) => latest.current.keyMove(task, dir),
    onToggleItem: (task: TaskItem, item: TaskChecklistItem, next: boolean) => latest.current.toggleItem(task, item, next, 'card'),
    onAddItem: (task: TaskItem, texto: string) => latest.current.addItem(task, texto, 'card'),
    onRemoveItem: (task: TaskItem, item: TaskChecklistItem) => latest.current.removeItem(task, item, 'card')
  }), []);

  /* ── Escape: cierra lo último que se abrió ── */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || isEditableTarget(event.target)) return;
      if (bulkConfirm) { setBulkConfirm(false); return; }
      if (colForm) { setColForm(null); return; }
      if (selection.count || selecting) { selection.clear(); setSelecting(false); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [bulkConfirm, colForm, selection, selecting]);

  /* ── Render ── */
  const routeTask = route ? tasks.find(task => task.id === route.id) : undefined;
  const selectedIds = Array.from(selection.selected);
  const selectedCount = selectedIds.length;
  const visibleSelected = order.filter(id => selection.selected.has(id)).length;
  const hiddenSelected = selectedCount - visibleSelected;
  const selectedTitles = tasks.filter(task => selection.selected.has(task.id)).map(task => task.titulo).join(' · ');
  const selectMode = canEdit && !route && (selecting || selectedCount > 0);
  const showSelection = selectMode;
  const endSelection = () => { selection.clear(); setSelecting(false); };
  const loadingColumns = columnsState === 'loading';

  /* ── Barra de selección: reemplaza a la de herramientas y queda fija arriba
     (sticky) mientras se eligen tarjetas más abajo. El cambio de una barra a
     la otra tiene otro alto: se mide lo tocado ANTES del cambio (en el render,
     el DOM todavía es el viejo) y después se corrige el scroll en el mismo
     frame, así la tarjeta tocada no se mueve. Si queda debajo de la barra
     fija, se la baja lo justo para que se vea entera. ── */
  const screenRef = useRef<HTMLElement | null>(null);
  const selbarRef = useRef<HTMLDivElement | null>(null);
  const shownSel = useRef(showSelection);
  const swapAnchor = useRef<{ el: HTMLElement; top: number } | null>(null);
  if (shownSel.current !== showSelection) {
    shownSel.current = showSelection;
    const board = screenRef.current?.querySelector<HTMLElement>('.tk-board-sec') || null;
    const trigger = recentTrigger();
    const el = trigger && board?.contains(trigger) ? (trigger.closest<HTMLElement>('.tk-card') || trigger) : board;
    swapAnchor.current = el ? { el, top: el.getBoundingClientRect().top } : null;
  }
  useLayoutEffect(() => {
    const anchor = swapAnchor.current;
    swapAnchor.current = null;
    if (!anchor || !anchor.el.isConnected) return;
    const scroller = scrollParentOf(anchor.el);
    const delta = anchor.el.getBoundingClientRect().top - anchor.top;
    if (Math.abs(delta) >= 0.5) scroller.scrollTop += delta;
    const bar = selbarRef.current;
    if (!bar || !anchor.el.classList.contains('tk-card')) return;
    const covered = bar.getBoundingClientRect().bottom + 8 - anchor.el.getBoundingClientRect().top;
    if (covered > 0) scroller.scrollTop -= covered;
  }, [showSelection]);
  // Alto de la barra fija: margen de scroll de las tarjetas (foco con Tab, "llevar a la vista") para no quedar debajo.
  useLayoutEffect(() => {
    const bar = selbarRef.current;
    const screen = screenRef.current;
    if (!bar || !screen || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => screen.style.setProperty('--tk-selbar-h', `${Math.ceil(bar.offsetHeight)}px`));
    observer.observe(bar);
    return () => { observer.disconnect(); screen.style.removeProperty('--tk-selbar-h'); };
  }, [showSelection]);
  const cardStatusNode = cardStatus ? { taskId: cardStatus.taskId, element: <StatusLine key={cardStatus.key} {...cardStatus.message} className="tk-status--card" onDismiss={() => setCardStatus(null)} /> } : null;

  const hint = tab === 'priority'
    ? 'Solo tareas abiertas. Para mover de columna, usá el Tablero o la página de la tarea.'
    : !canEdit ? 'Modo consulta: no se mueven tarjetas.'
      : isMobile ? 'Deslizá para cambiar de columna. Para mover una tarea, abrila; para mover varias, tocá «Elegir», marcalas y usá «Mover a».'
        : 'Arrastrá una tarjeta a otra columna (o Alt + ← →), y los puntitos ⠿ de una columna para reordenarla. Para elegir varias: «Elegir», Ctrl+click o Shift+click. Una tarea se completa moviéndola a la columna de hechas.';

  const queryText = query.trim() ? `${plural(visible.length, 'resultado', 'resultados')} para «${query.trim()}»` : '';
  const boardTitle = tab === 'board' ? (space === 'team' ? 'Tareas del grupo' : 'Mis tareas') : (space === 'team' ? 'Abiertas del grupo por prioridad' : 'Mis abiertas por prioridad');
  const sums = (
    <>
      <span className="tk-mono tk-text-2">{plural(openN, 'abierta', 'abiertas')}</span>
      {overN > 0 ? <span className="tk-mono tk-bad">{plural(overN, 'vencida', 'vencidas')}</span> : <span className="tk-mono tk-muted">{plural(doneN, 'hecha', 'hechas')}</span>}
    </>
  );
  // Elegir varias (mover o borrar en lote): en touch es la única forma; en desktop, además de Ctrl/Shift+click.
  // Va en la cabecera del tablero; en el celu (sin esa cabecera), debajo de los conteos de la barra.
  const pickButton = canEdit && !boardEmpty && (
    <Button size="sm" variant="ghost" className={cx('tk-pick', selectMode && 'is-on')} icon={<ListChecks size={14} />} aria-pressed={selectMode} onClick={() => (selectMode ? endSelection() : setSelecting(true))}>Elegir</Button>
  );

  const toolbar = (
    <div className={cx('tk-toolbar', gooOpen && 'is-goo-open')}>
      <div className="tk-tb-title">
        <span className="tk-eyebrow">{tab === 'board' ? 'Tablero' : 'Prioridad'}</span>
        <span className="tk-tb-heading">{space === 'team' ? 'Grupo' : 'Mis tareas'}</span>
      </div>
      <div className="tk-tb-segs">
        <PillTabs ariaLabel="Vista" value={tab} onChange={changeTab} block={isMobile} options={[{ value: 'board', label: 'Tablero' }, { value: 'priority', label: 'Prioridad' }]} />
        {/* "Grupo" y no "Equipo": en la app "equipo" es un dispositivo (QA de lanzamiento, NN-12). */}
        <PillTabs ariaLabel="Espacio de tareas" value={space} onChange={changeSpace} block={isMobile} options={[{ value: 'team', label: 'Grupo', count: openIn('team') }, { value: 'my', label: 'Mis tareas', count: openIn('my') }]} />
      </div>
      <div className="tk-tb-plus">
        {canEdit && (
          <GooeyMenu
            ariaLabel="Nueva tarea o columna"
            direction="down"
            caption={narrowGoo ? 'Del grupo · Privada · Columna' : 'Tarea del grupo · Tarea privada · Columna nueva'}
            onOpenChange={setGooOpen}
            items={[
              { id: 'team', label: 'Nueva tarea del grupo', icon: <Users size={16} />, onSelect: () => openCreate('team') },
              { id: 'mine', label: 'Nueva tarea privada', icon: <Lock size={16} />, onSelect: () => openCreate('private') },
              { id: 'column', label: 'Nueva columna', icon: <Columns3 size={16} />, onSelect: openColumnForm }
            ]}
          />
        )}
      </div>
      <div className="tk-tb-sums">{sums}{isMobile && pickButton}</div>
      <div className="tk-tb-search" data-scanner-ignore="">
        <Input
          aria-label="Buscar tareas"
          value={query}
          placeholder="Buscar tarea, persona o subtarea"
          enterKeyHint="search"
          prefix={<IconSearch size={16} />}
          suffix={query ? <IconButton size="sm" label="Limpiar búsqueda" icon={<X size={14} />} onClick={() => setQuery('')} /> : undefined}
          onValueChange={setQuery}
          onKeyDown={event => { if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery(''); } }}
        />
        {isMobile && <Collapse open={Boolean(queryText)} anchor={false} reveal={false}><span className="tk-hint">{queryText}</span></Collapse>}
      </div>
      <div className="tk-goo-room" aria-hidden="true" />
    </div>
  );

  const selectionBar = showSelection && (
    <div ref={selbarRef} className="tk-selbar ui-enter" role="region" aria-label="Selección de tareas">
      {/* Acciones ↔ confirmación de borrar: una se pliega mientras la otra se despliega (sin salto de alto). */}
      <Collapse open={!bulkConfirm} lazy={false} reveal={false} className="tk-selbar-body">
          <div className="tk-selbar-main">
            <Checkbox
              checked={order.length > 0 && visibleSelected === order.length}
              indeterminate={visibleSelected > 0 && visibleSelected < order.length}
              ariaLabel="Seleccionar todas las tareas visibles"
              onCheckedChange={() => selection.toggleMany(order)}
            />
            {selectedCount
              ? <span className="tk-selbar-count"><b className="tk-mono">{selectedCount}</b> {selectedCount === 1 ? 'seleccionada' : 'seleccionadas'}</span>
              : <span className="tk-selbar-hint">Tocá las tareas para elegirlas</span>}
            {hiddenSelected > 0 && <span className="tk-muted tk-small tk-nw">{hiddenSelected} fuera de esta vista</span>}
          </div>
          <div className="tk-selbar-move">
            {/* En el celu, "Quitar selección" va en el renglón de "Mover a" (en el primero no entra junto a Borrar). */}
            <div className="tk-selbar-movehead">
              <span className="tk-label">Mover a</span>
              {isMobile && <Button size="sm" variant="ghost" className="tk-selbar-clear" onClick={endSelection}>{selectedCount ? 'Quitar selección' : 'Cancelar'}</Button>}
            </div>
            <div className={cx('tk-selbar-cols', isMobile && 'tk-chips--grid')}>
              {columns.map(column => <Button key={column.id} size="sm" disabled={store.moving || !selectedCount} onClick={() => void moveTasks(selectedIds, column, true)}>{column.name}</Button>)}
            </div>
          </div>
          <span className="tk-grow" />
          <div className="tk-selbar-end">
            <Button size="sm" variant="ghost" className="tk-danger-link" icon={<Trash2 size={14} />} disabled={!selectedCount} onClick={() => setBulkConfirm(true)}>Borrar</Button>
            {!isMobile && <Button size="sm" variant="ghost" onClick={endSelection} iconEnd={<Kbd>Esc</Kbd>}>{selectedCount ? 'Quitar selección' : 'Cancelar'}</Button>}
          </div>
      </Collapse>
      <Collapse open={bulkConfirm} reveal={false} unmountOnClose>
        <InlineConfirm
          danger
          className="tk-selbar-confirm"
          message={`¿Borrar ${plural(selectedCount, 'tarea', 'tareas')}?`}
          detail={<TruncatedText>{selectedTitles}</TruncatedText>}
          confirmLabel={`Borrar ${plural(selectedCount, 'tarea', 'tareas')}`}
          onConfirm={() => void deleteTasks(selectedIds)}
          onCancel={() => setBulkConfirm(false)}
        />
      </Collapse>
    </div>
  );

  // Alta de columna y de tarea: se abren y se cierran con el colapso
  // compartido; mientras se pliegan muestran lo último (ya inerte).
  const lastColForm = useRef(colForm);
  if (colForm) lastColForm.current = colForm;
  const shownColForm = colForm || lastColForm.current;
  const lastCreating = useRef(creating);
  if (creating) lastCreating.current = creating;
  const shownCreating = creating || lastCreating.current;
  const columnForm = shownColForm && (
    <form className="tk-colform" aria-label="Nueva columna" data-scanner-ignore="" onSubmit={event => { event.preventDefault(); void createColumn(); }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setColForm(null); } }}>
      <span className="tk-eyebrow tk-colform-label">Nueva columna</span>
      <Input
        ref={colInputRef}
        aria-label="Nombre de la columna"
        className="tk-colform-input"
        value={shownColForm.name}
        placeholder="Ej. En revisión"
        error={shownColForm.error || undefined}
        onValueChange={value => setColForm({ ...shownColForm, name: value, error: '' })}
      />
      <div className="tk-row">
        <Button variant="primary" type="submit" loading={shownColForm.saving}>Crear columna</Button>
        <Button variant="ghost" onClick={() => setColForm(null)}>Cancelar</Button>
      </div>
    </form>
  );

  let body: ReactNode;
  if (route) {
    const backBar = (label: string, to: TaskRoute) => (
      <div className="tk-back">
        <Button size="sm" variant="ghost" icon={<ArrowLeft size={16} />} onClick={() => back(to)}>{label}</Button>
        {routeTask && !isMobile && <><span className="tk-back-sep" aria-hidden="true">/</span><TruncatedText className="tk-back-trail">{routeTask.titulo}</TruncatedText></>}
      </div>
    );
    if (!routeTask) {
      body = <>{backBar('Tareas TIC', null)}{store.loaded ? <TaskNotFound onBack={() => back(null)} /> : <SkeletonText lines={4} />}</>;
    } else if (route.edit && canEdit) {
      body = (
        <>
          {backBar('Volver a la tarea', { id: routeTask.id, edit: false })}
          <TaskForm
            key={routeTask.id}
            mode="edit"
            initial={routeTask}
            defaultVisibility={routeTask.visibility || 'team'}
            operator={operator}
            people={people}
            tipos={tipos}
            isMobile={isMobile}
            onCancel={() => back({ id: routeTask.id, edit: false })}
            onSubmit={submitEdit}
          />
        </>
      );
    } else {
      body = (
        <>
          {backBar('Tareas TIC', null)}
          <TaskDetail
            key={routeTask.id}
            task={routeTask}
            column={columnOf(routeTask, columns)}
            columns={columns}
            done={doneOf(routeTask)}
            canEdit={canEdit}
            moving={store.moving}
            isMobile={isMobile}
            status={<StatusSlot status={detailStatus} />}
            onEdit={() => go({ id: routeTask.id, edit: true })}
            onDelete={() => { back(null); void deleteTasks([routeTask.id]); }}
            onMove={column => void moveTasks([routeTask.id], column, false, 'detail')}
            onSaveNote={async text => { await store.save({ ...routeTask, comentario: text }); detailStatus.show({ tone: 'ok', message: 'Guardaste la nota.' }); }}
            onToggleItem={(item, next) => toggleItem(routeTask, item, next, 'detail')}
            onAddItem={texto => addItem(routeTask, texto, 'detail')}
            onRemoveItem={item => removeItem(routeTask, item, 'detail')}
            onCommented={() => store.patchLocal(routeTask.id, task => ({ ...task, commentsCount: (task.commentsCount || 0) + 1 }))}
          />
        </>
      );
    }
  } else {
    body = (
      <>
        {showSelection ? selectionBar : toolbar}
        <StatusSlot status={boardStatus} />
        <Collapse open={Boolean(colForm) && canEdit} unmountOnClose>{columnForm}</Collapse>
        <Collapse open={Boolean(creating) && canEdit} unmountOnClose>
          {shownCreating && (
            <TaskForm
              mode="create"
              defaultVisibility={shownCreating}
              operator={operator}
              people={people}
              tipos={tipos}
              firstColumn={columns[0]?.name}
              isMobile={isMobile}
              onCancel={() => setCreating(null)}
              onSubmit={submitCreate}
            />
          )}
        </Collapse>
        <section ref={boardRef} className="tk-board-sec" aria-labelledby="tk-board-title">
          <header className="tk-section-head tk-board-head">
            <div className="tk-section-titles">
              <span className="tk-eyebrow">{tab === 'board' ? 'Tablero' : 'Prioridad'}</span>
              <h2 id="tk-board-title" className="tk-h2">{boardTitle}</h2>
            </div>
            <div className="tk-board-sums">
              {queryText && <><span className="tk-nw tk-text-2">{queryText}</span><button type="button" className="tk-link" onClick={() => setQuery('')}>Limpiar búsqueda</button></>}
              {sums}
              {store.moving && <span className="tk-mono tk-muted">Guardando…</span>}
              {!isMobile && pickButton}
            </div>
          </header>
          {/* Espacio sin tareas: un vacío diseñado con la acción siguiente (las columnas siguen abajo para soltar). */}
          <Collapse open={boardEmpty} anchor={false} reveal={false}>
            <EmptyState
              compact
              className="tk-board-empty"
              icon={<ClipboardList size={18} />}
              title={tab === 'priority' ? (space === 'my' ? 'No tenés tareas abiertas.' : 'El grupo no tiene tareas abiertas.') : (space === 'my' ? 'No tenés tareas en Mis tareas.' : 'Todavía no hay tareas del grupo.')}
              description={space === 'my' ? 'Acá están tus tareas privadas y las del grupo donde sos responsable.' : 'Las tareas del grupo las ve toda la sede.'}
              action={canEdit ? <Button size="sm" icon={space === 'my' ? <Lock size={14} /> : <Users size={14} />} onClick={() => openCreate(space === 'my' ? 'private' : 'team')}>{space === 'my' ? 'Nueva tarea privada' : 'Nueva tarea del grupo'}</Button> : undefined}
            />
          </Collapse>
          {columnsState === 'error' && tab === 'board' && <ErrorState message="No se pudieron cargar las columnas." onRetry={() => { setColumnsState('loading'); void loadColumns(); }} />}
          {loadingColumns ? <TaskBoardSkeleton isMobile={isMobile} /> : (columnsState === 'ready' || tab === 'priority') && (
            <TaskBoard
              lanes={lanes}
              columns={columns}
              resetKey={resetKey}
              canEdit={canEdit}
              isMobile={isMobile}
              boardMode={tab === 'board'}
              hasQuery={Boolean(query.trim())}
              doneOf={doneOf}
              selected={selection.selected}
              cardStatus={cardStatusNode}
              handlers={handlers}
              shownIn={shownIn}
              onShowMore={key => setShown(current => ({ ...current, [key]: (current[key] ?? PAGE_SIZE) + PAGE_SIZE }))}
              activeKey={activeKey}
              onActiveKey={changeLane}
              reveal={reveal}
              onMoveTask={(taskId, column) => void moveTasks([taskId], column, false)}
              onReorder={ids => void reorderColumns(ids)}
              onSaveColumn={saveColumn}
              onDeleteColumn={column => void deleteColumn(column)}
            />
          )}
          <p className="tk-hint">{hint}</p>
        </section>
        {/* Solo en Grupo: al pasar a Mis tareas se pliega (no desaparece de golpe). */}
        <Collapse open={space === 'team'} anchor={false} reveal={false}>
          <TaskAnalytics tasks={spaceTasks} columns={columns} people={people} />
        </Collapse>
      </>
    );
  }

  return (
    <section ref={screenRef} className={cx('tk-screen', showSelection && 'has-selbar', selectMode && 'is-selecting')} data-route={route ? (route.edit ? 'edit' : 'detail') : 'list'}>
      {consultationMode && (
        <p className="tk-consulta"><Eye size={16} aria-hidden="true" />Modo consulta: ves las tareas y sus comentarios, sin editar.</p>
      )}
      {body}
    </section>
  );
}
