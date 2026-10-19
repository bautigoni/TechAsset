import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, GripVertical, Pencil } from 'lucide-react';
import type { TaskColumn, TaskItem } from '../../types';
import { Button, Checkbox, Collapse, IconButton, Skeleton, TruncatedText, cx } from '../../ui';
import { TaskCard, type CardHandlers } from './TaskCard';
import { PAGE_SIZE, plural } from './taskModel';

export type Lane = { key: string; title: string; column?: TaskColumn; tasks: TaskItem[] };

type DragState = { kind: 'task' | 'col'; id: string; over: string | null };

type Props = {
  lanes: Lane[];
  columns: TaskColumn[];
  /** Cambia al cambiar de espacio, solapa o búsqueda: reinicia "Ver más" y la entrada animada. */
  resetKey: string;
  canEdit: boolean;
  isMobile: boolean;
  /** En la vista Prioridad no se arrastra ni se editan columnas. */
  boardMode: boolean;
  hasQuery: boolean;
  doneOf: (task: TaskItem) => boolean;
  selected: Set<string>;
  cardStatus: { taskId: string; element: ReactNode } | null;
  handlers: Omit<CardHandlers, 'onPointerDown'>;
  /** Tarjetas que se dibujan por columna ("Ver N más" las suma). */
  shownIn: (laneKey: string) => number;
  onShowMore: (laneKey: string) => void;
  /** Mobile: la columna que se ve. */
  activeKey: string;
  onActiveKey: (laneKey: string) => void;
  /** Pedido de traer una columna a la vista (al crearla): el carril se corre hasta ella. */
  reveal?: { key: string; n: number } | null;
  onMoveTask: (taskId: string, column: TaskColumn) => void;
  onReorder: (ids: number[]) => void;
  onSaveColumn: (column: TaskColumn, patch: { name: string; isDone: boolean }) => Promise<void>;
  onDeleteColumn: (column: TaskColumn) => void;
};

export function TaskBoardSkeleton({ isMobile }: { isMobile: boolean }) {
  if (isMobile) {
    return (
      <div className="tk-skel-m" aria-busy="true" aria-label="Cargando columnas">
        <div className="tk-skel-m-switch">{[0, 1, 2].map(index => <Skeleton key={index} height="2.75rem" radius="sm" index={index} />)}</div>
        {[8, 6.5, 5.5].map((height, index) => <Skeleton key={index} height={`${height}rem`} radius="md" index={index + 1} />)}
      </div>
    );
  }
  return (
    <div className="tk-lanes tk-lanes--skel" aria-busy="true" aria-label="Cargando columnas">
      {[42, 50, 34].map((width, column) => (
        <div className="tk-lane" key={column}>
          <Skeleton width={`${width}%`} height="1.25rem" index={column} />
          {[7, 5.5, 4.5].map((height, card) => <Skeleton key={card} height={`${height}rem`} radius="md" index={column + card} />)}
        </div>
      ))}
    </div>
  );
}

/**
 * Tablero: columnas que se paneán arrastrando el fondo (sin barra: el carril
 * se corre con transform y hay "Columnas 1–3 de 5" con flechas), tarjetas que
 * se arrastran con el puntero SIN fantasma flotante (la tarjeta queda en su
 * lugar, apagada, y la columna destino muestra el hueco "Soltá para mover…"),
 * columnas que se reordenan con el asa (o con ← → en el teclado) y se editan
 * en línea. En mobile: una columna a la vez, con selector y deslizando.
 */
export function TaskBoard({ lanes, columns, resetKey, canEdit, isMobile, boardMode, hasQuery, doneOf, selected, cardStatus, handlers, shownIn, onShowMore, activeKey, onActiveKey, reveal, onMoveTask, onReorder, onSaveColumn, onDeleteColumn }: Props) {
  /* ── Mobile: qué columna se ve (el estado vive en la página) ── */
  const laneKeys = lanes.map(lane => lane.key);
  const activeIndex = laneKeys.indexOf(activeKey);
  // Dirección de la entrada: desde la derecha si se avanzó, desde la izquierda si se volvió.
  const lastIndex = useRef(activeIndex);
  const slideDir = activeIndex < lastIndex.current ? 'l' : 'r';
  useEffect(() => { lastIndex.current = activeIndex; }, [activeIndex]);
  const goLane = (index: number) => {
    if (index < 0 || index >= laneKeys.length || index === activeIndex) return;
    onActiveKey(laneKeys[index]);
    setEditing(null);
  };
  const visibleLanes = isMobile ? lanes.filter(lane => lane.key === activeKey) : lanes;

  /* ── Edición de columna (en línea, debajo del encabezado) ── */
  const [editing, setEditing] = useState<{ id: number; name: string; isDone: boolean; error: string; confirmDelete: boolean; saving: boolean } | null>(null);
  const editRef = useRef<HTMLInputElement | null>(null);
  // Lo último que se editó: el formulario lo sigue mostrando mientras se pliega.
  const lastEdit = useRef(editing);
  if (editing) lastEdit.current = editing;
  useEffect(() => { if (editing) editRef.current?.focus({ preventScroll: true }); }, [editing?.id]);
  const openEditor = (column: TaskColumn) => setEditing(current => (current?.id === column.id ? null : { id: column.id, name: column.name, isDone: column.isDone, error: '', confirmDelete: false, saving: false }));
  const saveEditor = async (column: TaskColumn) => {
    if (!editing || editing.saving) return;
    const name = editing.name.trim();
    if (!name) { setEditing({ ...editing, error: 'Poné un nombre.' }); return; }
    if (columns.some(item => item.id !== column.id && item.name.toLowerCase() === name.toLowerCase())) { setEditing({ ...editing, error: 'Ya hay una columna con ese nombre.' }); return; }
    if (name === column.name && editing.isDone === column.isDone) { setEditing(null); return; }
    setEditing({ ...editing, saving: true, error: '' });
    try {
      await onSaveColumn(column, { name, isDone: editing.isDone });
      setEditing(null);
    } catch (reason) {
      setEditing(current => current && { ...current, saving: false, error: reason instanceof Error ? reason.message : 'No se pudo guardar la columna.' });
    }
  };
  const moveColumnBy = (column: TaskColumn, dir: -1 | 1) => {
    const ids = columns.map(item => item.id);
    const from = ids.indexOf(column.id);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    onReorder(ids);
  };

  /* ── Paneo del carril (sin barra de scroll) ── */
  const vpRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState(0);
  const [metrics, setMetrics] = useState({ max: 0, from: 1, to: lanes.length });
  const [panning, setPanning] = useState(false);
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;

  const laneStarts = () => Array.from(trackRef.current?.children || []).map(child => (child as HTMLElement).offsetLeft);
  const measure = useCallback(() => {
    const vp = vpRef.current;
    const track = trackRef.current;
    if (!vp || !track) return;
    // Ancho de layout de las columnas (offsetLeft/offsetWidth no ven los
    // transform): con scrollWidth, la entrada animada (translateX) inflaba el
    // ancho justo al medir y quedaba "Columnas 1–3 de 3" con la última
    // columna desvanecida aunque entraran todas.
    const last = track.lastElementChild as HTMLElement | null;
    const contentW = last ? last.offsetLeft + last.offsetWidth : 0;
    const raw = contentW - vp.clientWidth;
    const max = raw > 1 ? raw : 0;
    const off = Math.min(offsetRef.current, max);
    let from = 0;
    let to = 0;
    Array.from(track.children).forEach((child, index) => {
      const el = child as HTMLElement;
      const left = el.offsetLeft;
      const right = left + el.offsetWidth;
      // Cuenta como visible si se ve al menos la mitad.
      const seen = Math.min(right, off + vp.clientWidth) - Math.max(left, off);
      if (seen >= el.offsetWidth / 2) { if (!from) from = index + 1; to = index + 1; }
    });
    setMetrics(current => (current.max === max && current.from === from && current.to === to ? current : { max, from, to }));
    if (off !== offsetRef.current) setOffset(off);
  }, []);
  useLayoutEffect(() => {
    if (isMobile || !boardMode) return;
    measure();
    const vp = vpRef.current;
    const track = trackRef.current;
    if (!vp || !track || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(vp);
    observer.observe(track);
    return () => observer.disconnect();
  }, [measure, isMobile, boardMode, lanes.length, resetKey]);
  useEffect(() => { measure(); }, [offset, measure]);
  // Al cambiar de espacio o solapa el carril vuelve al principio.
  useEffect(() => { setOffset(0); }, [resetKey]);
  useEffect(() => {
    if (!reveal || isMobile) return;
    const vp = vpRef.current;
    const track = trackRef.current;
    const lane = track?.querySelector<HTMLElement>(`[data-lane="${reveal.key}"]`);
    if (!vp || !track || !lane) return;
    const last = track.lastElementChild as HTMLElement | null;
    const max = Math.max(0, (last ? last.offsetLeft + last.offsetWidth : 0) - vp.clientWidth);
    const left = lane.offsetLeft;
    const right = left + lane.offsetWidth;
    const off = offsetRef.current;
    if (left < off) setOffset(Math.min(max, left));
    else if (right > off + vp.clientWidth) setOffset(Math.min(max, right - vp.clientWidth));
  }, [reveal?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  const snap = (value: number, dir: -1 | 0 | 1) => {
    const max = metricsRef.current.max;
    const starts = laneStarts().map(start => Math.min(start, max));
    if (!starts.length) return 0;
    if (dir > 0) return starts.find(start => start > value + 2) ?? max;
    if (dir < 0) { const before = starts.filter(start => start < value - 2); return before.length ? before[before.length - 1] : 0; }
    return starts.reduce((best, start) => (Math.abs(start - value) < Math.abs(best - value) ? start : best), starts[0]);
  };
  const clampOffset = (value: number) => Math.max(0, Math.min(metricsRef.current.max, value));

  const onBackgroundDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (isMobile || !boardMode || event.button !== 0 || metricsRef.current.max <= 0 || event.pointerType === 'touch') return;
    if ((event.target as HTMLElement).closest('[data-task-id], button, input, textarea, a, header, form, .tk-col-edit')) return;
    const start = { x: event.clientX, off: offsetRef.current };
    setPanning(true);
    const onMove = (move: PointerEvent) => setOffset(clampOffset(start.off - (move.clientX - start.x)));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setPanning(false);
      setOffset(current => snap(current, 0));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };
  // Trackpad o Shift + rueda: también panea (sin barra que mostrar).
  const wheelSnap = useRef<number | undefined>(undefined);
  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (isMobile || !boardMode || metricsRef.current.max <= 0) return;
    const dx = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.shiftKey ? event.deltaY : 0;
    if (!dx) return;
    setOffset(current => clampOffset(current + dx));
    window.clearTimeout(wheelSnap.current);
    wheelSnap.current = window.setTimeout(() => setOffset(current => snap(current, 0)), 180);
  };
  // Con Tab a una tarjeta de una columna que no se ve, el carril la trae.
  const onFocusIn = (event: React.FocusEvent<HTMLDivElement>) => {
    if (isMobile || !boardMode || metricsRef.current.max <= 0) return;
    const lane = (event.target as HTMLElement).closest<HTMLElement>('[data-lane]');
    const vp = vpRef.current;
    if (!lane || !vp) return;
    const left = lane.offsetLeft;
    const right = left + lane.offsetWidth;
    const off = offsetRef.current;
    if (left < off) setOffset(clampOffset(left));
    else if (right > off + vp.clientWidth) setOffset(clampOffset(right - vp.clientWidth));
  };

  /* ── Arrastrar tarjetas y columnas (pointer events) ── */
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  const justDragged = useRef(false);
  const autoPan = useRef<number | undefined>(undefined);

  const laneAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y);
    return (el as HTMLElement | null)?.closest<HTMLElement>('[data-lane]')?.dataset.lane || null;
  };
  const finishDrag = (drop: boolean) => {
    window.clearInterval(autoPan.current);
    autoPan.current = undefined;
    const current = dragRef.current;
    setDrag(null);
    document.documentElement.classList.remove('tk-dragging');
    if (!current) return;
    justDragged.current = true;
    window.setTimeout(() => { justDragged.current = false; }, 80);
    if (!drop || !current.over) return;
    const targetLane = lanes.find(lane => lane.key === current.over);
    if (!targetLane?.column) return;
    if (current.kind === 'task') {
      onMoveTask(current.id, targetLane.column);
      return;
    }
    const ids = columns.map(column => column.id);
    const from = ids.indexOf(Number(current.id));
    const to = ids.indexOf(targetLane.column.id);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    onReorder(ids);
  };
  const beginPress = (kind: 'task' | 'col', id: string, event: ReactPointerEvent<HTMLElement>) => {
    const start = { x: event.clientX, y: event.clientY };
    let started = false;
    const onMove = (move: PointerEvent) => {
      if (!started) {
        if (Math.abs(move.clientX - start.x) + Math.abs(move.clientY - start.y) < 6) return;
        started = true;
        document.documentElement.classList.add('tk-dragging');
      }
      const over = laneAt(move.clientX, move.clientY);
      setDrag(current => (current && current.over === over ? current : { kind, id, over }));
      // Cerca del borde del tablero, el carril se corre solo.
      const vp = vpRef.current;
      window.clearInterval(autoPan.current);
      autoPan.current = undefined;
      if (vp && metricsRef.current.max > 0) {
        const rect = vp.getBoundingClientRect();
        const dir = move.clientX < rect.left + 48 ? -1 : move.clientX > rect.right - 48 ? 1 : 0;
        if (dir) autoPan.current = window.setInterval(() => setOffset(current => clampOffset(current + dir * 16)), 16);
      }
    };
    const onUp = () => { cleanup(); if (started) finishDrag(true); };
    const onCancel = () => { cleanup(); if (started) finishDrag(false); };
    const onKey = (key: globalThis.KeyboardEvent) => { if (key.key === 'Escape') { key.stopPropagation(); cleanup(); if (started) finishDrag(false); } };
    function cleanup() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
  };
  const onCardPointerDown = (task: TaskItem, event: ReactPointerEvent<HTMLElement>) => {
    if (!canEdit || isMobile || !boardMode || event.button !== 0 || event.pointerType === 'touch') return;
    if ((event.target as HTMLElement).closest('button, input, textarea, a, [data-nodrag], [role="checkbox"]')) return;
    beginPress('task', task.id, event);
  };
  const onGripDown = (column: TaskColumn, event: ReactPointerEvent<HTMLElement>) => {
    if (!canEdit || event.button !== 0) return;
    event.stopPropagation();
    beginPress('col', String(column.id), event);
  };
  const onGripKey = (column: TaskColumn, event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      moveColumnBy(column, event.key === 'ArrowLeft' ? -1 : 1);
    }
  };
  useEffect(() => () => { window.clearInterval(autoPan.current); document.documentElement.classList.remove('tk-dragging'); }, []);

  // Después de soltar, el click que sigue no abre la tarjeta.
  const onClickCapture = (event: React.MouseEvent) => {
    if (!justDragged.current) return;
    event.stopPropagation();
    event.preventDefault();
  };

  /* ── Deslizar en mobile para cambiar de columna ── */
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const onSwipeDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!isMobile || event.pointerType === 'mouse') return;
    swipe.current = { x: event.clientX, y: event.clientY };
  };
  const onSwipeUp = (event: ReactPointerEvent<HTMLElement>) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) goLane(activeIndex + (dx < 0 ? 1 : -1));
  };

  const dragTask = drag?.kind === 'task' ? lanes.flatMap(lane => lane.tasks).find(task => task.id === drag.id) : undefined;
  const dragColumn = drag?.kind === 'col' ? columns.find(column => String(column.id) === drag.id) : undefined;

  const renderLane = (lane: Lane, laneIndex: number) => {
    const column = lane.column;
    const total = lane.tasks.length;
    const limit = shownIn(lane.key);
    const cards = lane.tasks.slice(0, limit);
    const over = drag?.over === lane.key;
    const taskOver = over && Boolean(dragTask) && Boolean(column) && !lane.tasks.some(task => task.id === dragTask!.id);
    const colOver = over && Boolean(dragColumn) && Boolean(column) && dragColumn!.id !== column!.id;
    const isEditing = Boolean(column && editing?.id === column.id);
    const ed = isEditing ? editing : column && lastEdit.current?.id === column.id ? lastEdit.current : null;
    const columnIndex = column ? columns.findIndex(item => item.id === column.id) : -1;
    const tasksHere = column ? lanes.find(item => item.column?.id === column.id)?.tasks.length ?? 0 : 0;
    const fallback = column ? columns.find(item => item.id !== column.id) : undefined;
    const isDraggedColumn = Boolean(dragColumn && column && dragColumn.id === column.id);

    return (
      <section
        key={lane.key}
        className={cx('tk-lane', (taskOver || colOver) && 'is-over', isDraggedColumn && 'is-dragging')}
        data-lane={lane.key}
        aria-label={`${lane.title}, ${plural(total, 'tarea', 'tareas')}`}
        onPointerDown={onSwipeDown}
        onPointerUp={onSwipeUp}
        onPointerCancel={() => { swipe.current = null; }}
      >
        <header className="tk-lane-head">
          {column && canEdit && !isMobile && boardMode && (
            <button
              type="button"
              className="tk-grip"
              aria-label={`Mover la columna «${lane.title}». Arrastrá o usá las flechas.`}
              onPointerDown={event => onGripDown(column, event)}
              onKeyDown={event => onGripKey(column, event)}
            >
              <GripVertical size={14} aria-hidden="true" />
            </button>
          )}
          <TruncatedText as="strong" className="tk-lane-title">{lane.title}</TruncatedText>
          <span className="tk-lane-count tk-mono">{total}</span>
          {isMobile && lanes.length > 1 && <span className="tk-lane-pos tk-mono">{laneIndex + 1}/{lanes.length}</span>}
          <span className="tk-grow" />
          {column && boardMode && (
            <IconButton
              size="sm"
              className="tk-lane-edit"
              label={`Editar la columna «${lane.title}»`}
              aria-expanded={isEditing}
              aria-controls={`tk-col-edit-${column.id}`}
              disabled={!canEdit}
              icon={<Pencil size={14} />}
              onClick={() => openEditor(column)}
            />
          )}
        </header>

        {/* Edición de la columna: se abre y se cierra con el colapso compartido
            (mientras se pliega muestra lo último que tenía, ya inerte). */}
        {column && boardMode && (
          <Collapse open={isEditing} id={`tk-col-edit-${column.id}`} unmountOnClose>
            {ed && (
          <form
            className="tk-col-edit"
            data-scanner-ignore=""
            onSubmit={event => { event.preventDefault(); void saveEditor(column); }}
            onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setEditing(null); } }}
          >
            <label className="tk-field">
              <span className="tk-label">Nombre</span>
              <input
                ref={editRef}
                className={cx('tk-input tk-input--sm', ed.error && 'is-error')}
                value={ed.name}
                aria-invalid={Boolean(ed.error) || undefined}
                onChange={event => setEditing({ ...ed, name: event.target.value, error: '' })}
              />
            </label>
            {ed.error && <span className="tk-error" role="alert">{ed.error}</span>}
            <Checkbox
              checked={ed.isDone}
              onCheckedChange={next => setEditing({ ...ed, isDone: next })}
              label="Columna de cierre"
              description="Sus tareas cuentan como hechas"
            />
            {isMobile && (
              <div className="tk-col-edit-nav">
                <Button size="sm" block icon={<ChevronLeft size={14} />} disabled={columnIndex <= 0} onClick={() => moveColumnBy(column, -1)}>Antes</Button>
                <Button size="sm" block iconEnd={<ChevronRight size={14} />} disabled={columnIndex >= columns.length - 1} onClick={() => moveColumnBy(column, 1)}>Después</Button>
              </div>
            )}
            <div className="tk-col-edit-row">
              <Button size="sm" variant="primary" type="submit" loading={ed.saving}>Guardar</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
              <span className="tk-grow" />
              {!isMobile && (
                <>
                  <IconButton size="sm" label="Mover la columna a la izquierda" icon={<ChevronLeft size={14} />} disabled={columnIndex <= 0} onClick={() => moveColumnBy(column, -1)} />
                  <IconButton size="sm" label="Mover la columna a la derecha" icon={<ChevronRight size={14} />} disabled={columnIndex >= columns.length - 1} onClick={() => moveColumnBy(column, 1)} />
                </>
              )}
            </div>
            <Button size="sm" variant="ghost" className="tk-danger-link" aria-expanded={ed.confirmDelete} disabled={columns.length <= 1} onClick={() => setEditing({ ...ed, confirmDelete: !ed.confirmDelete })}>
              {columns.length <= 1 ? 'Es la única columna: no se puede eliminar' : 'Eliminar columna'}
            </Button>
            <Collapse open={ed.confirmDelete} unmountOnClose>
              <div className="tk-col-del" role="group" aria-label="Confirmar eliminar columna">
                <span className="tk-bad">{tasksHere ? `${tasksHere === 1 ? 'Su tarea pasa' : `Sus ${tasksHere} tareas pasan`} a «${fallback?.name || ''}».` : 'No tiene tareas.'}</span>
                <div className="tk-col-edit-row">
                  <Button size="sm" variant="danger" onClick={() => { setEditing(null); onDeleteColumn(column); }}>Eliminar columna</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing({ ...ed, confirmDelete: false })}>Cancelar</Button>
                </div>
              </div>
            </Collapse>
            <span className="tk-hint">Renombrarla cambia el estado de sus tareas.</span>
          </form>
            )}
          </Collapse>
        )}

        <div className="tk-lane-cards t-stagger" key={resetKey}>
          {cards.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              done={doneOf(task)}
              selected={selected.has(task.id)}
              canEdit={canEdit}
              draggable={canEdit && !isMobile && boardMode}
              dragging={drag?.kind === 'task' && drag.id === task.id}
              status={cardStatus?.taskId === task.id ? cardStatus.element : undefined}
              onPointerDown={onCardPointerDown}
              {...handlers}
            />
          ))}
        </div>
        {/* El hueco donde cae lo arrastrado va DEBAJO de las tarjetas: nada de
            lo que está bajo el puntero se corre mientras se arrastra. En una
            columna vacía ocupa el lugar (y el alto) del "Soltá una tarea acá". */}
        {(taskOver || colOver) && (
          <div className={cx('tk-drop', !total && 'tk-drop--fill')}>
            {taskOver ? <>Soltá para mover «{dragTask!.titulo}» a «{lane.title}»</> : <>Soltá para poner «{dragColumn!.name}» en este lugar</>}
          </div>
        )}
        {!total && !taskOver && !colOver && <div className="tk-lane-empty">{column ? (hasQuery ? 'Sin resultados' : canEdit && boardMode ? 'Soltá una tarea acá' : 'Sin tareas') : 'Sin tareas'}</div>}
        {total > limit && (
          <Button size="sm" variant={isMobile ? 'secondary' : 'ghost'} block onClick={() => onShowMore(lane.key)}>
            {`Ver ${Math.min(PAGE_SIZE, total - limit)} más (${total - limit} restantes)`}
          </Button>
        )}
      </section>
    );
  };

  const rendered = visibleLanes.map(lane => renderLane(lane, laneKeys.indexOf(lane.key)));

  if (isMobile) {
    return (
      <div className="tk-board tk-board--mobile" onClickCapture={onClickCapture}>
        {lanes.length > 1 && (
          <div className="tk-switch" role="group" aria-label="Columna">
            {lanes.map((lane, index) => (
              <button
                key={lane.key}
                type="button"
                className={cx('tk-switch-btn', lane.key === activeKey && 'is-on')}
                aria-pressed={lane.key === activeKey}
                aria-label={`${lane.title}, ${plural(lane.tasks.length, 'tarea', 'tareas')}`}
                onClick={() => goLane(index)}
              >
                <span className="tk-ell">{lane.title}</span>
                <span className="tk-mono tk-muted">{lane.tasks.length}</span>
              </button>
            ))}
          </div>
        )}
        <div className={cx('tk-lane-slide', `tk-lane-slide--${slideDir}`)} key={`${activeKey}:${resetKey}`}>{rendered}</div>
      </div>
    );
  }

  return (
    <div className="tk-board" onClickCapture={onClickCapture}>
      {boardMode && metrics.max > 0 && (
        <div className="tk-pager" aria-label="Columnas">
          <IconButton size="sm" label="Columnas anteriores" icon={<ChevronLeft size={16} />} disabled={offset <= 0} onClick={() => setOffset(current => snap(current, -1))} />
          <span className="tk-mono tk-muted">Columnas {metrics.from || 1}–{metrics.to || lanes.length} de {lanes.length}</span>
          <IconButton size="sm" label="Columnas siguientes" icon={<ChevronRight size={16} />} disabled={offset >= metrics.max} onClick={() => setOffset(current => snap(current, 1))} />
        </div>
      )}
      <div
        ref={vpRef}
        className={cx('tk-lanes-vp', metrics.max > 0 && boardMode && 'can-pan', panning && 'is-panning', boardMode && offset > 0 && 'fade-l', boardMode && offset < metrics.max && 'fade-r')}
        onPointerDown={onBackgroundDown}
        onWheel={onWheel}
        onFocus={onFocusIn}
      >
        <div
          ref={trackRef}
          className={cx('tk-lanes t-stagger-x', panning && 'is-panning')}
          key={resetKey}
          style={{ transform: `translateX(${-offset}px)` }}
        >
          {rendered}
        </div>
      </div>
    </div>
  );
}
