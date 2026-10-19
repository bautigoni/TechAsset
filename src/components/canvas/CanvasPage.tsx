import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Crosshair, Link as LinkIcon, ListChecks, Maximize, RefreshCw, Shapes, StickyNote, Type, Upload } from 'lucide-react';
import type { CanvasItem, CanvasItemType, TaskItem } from '../../types';
import {
  createCanvasItem, deleteCanvasItem, getCanvasItems, getCanvasVersion, restoreCanvasItem, updateCanvasItem, uploadCanvasFile
} from '../../services/canvasApi';
import { getTasks } from '../../services/tasksApi';
import { getActiveSiteCode } from '../../services/activeSite';
import { useAssistantContext } from '../../hooks/useAssistantContext';
import { Button, ErrorState, FileDrop, IconButton, Skeleton, cx, icons, useStatusLine } from '../../ui';
import { SmoothCollapse } from '../common/SmoothCollapse';
import { CanvasNode, type NodeActions } from './CanvasNode';
import {
  HOME, NOTE_COLORS, SAVE_DELAY, TYPE_LABEL, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, clampZoom, errorText, fitView, freeSpot, initialView, readFileAsDataUrl,
  readSavedView, saveView, sizeFor, stepsOf, zoomAround, type View
} from './canvasModel';
import '../../styles/screens/canvas.css';

const POLL_MS = 30_000;
const ACCEPT = 'image/*,.pdf,.docx,.xlsx,.txt';
const MAX_MB = 7;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const ADDS: Array<{ type: Exclude<CanvasItemType, 'image' | 'file'>; label: string; short?: string; icon: React.ReactNode; title: string; content: Record<string, unknown>; phrase: string }> = [
  { type: 'sticky', label: 'Nota', icon: <StickyNote size={14} />, title: 'Nota', content: { text: 'Nueva idea' }, phrase: 'una nota' },
  { type: 'text', label: 'Texto', icon: <Type size={14} />, title: '', content: { text: 'Bloque de texto' }, phrase: 'un bloque de texto' },
  { type: 'checklist', label: 'Checklist', icon: <ListChecks size={14} />, title: 'Checklist', content: { items: [{ text: 'Primer paso', checked: false }] }, phrase: 'un checklist' },
  { type: 'task-group', label: 'Grupo de tareas', short: 'Grupo', icon: <Shapes size={14} />, title: 'Grupo de tareas', content: { taskIds: [] }, phrase: 'un grupo de tareas' },
  { type: 'link', label: 'Enlace', icon: <LinkIcon size={14} />, title: 'Enlace', content: { url: 'https://', text: 'Enlace' }, phrase: 'un enlace' }
];

export function CanvasPage({ consultationMode }: { consultationMode: boolean }) {
  const site = getActiveSiteCode();
  const [items, setItems] = useState<CanvasItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState<View>(() => readSavedView(site) || HOME);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [creating, setCreating] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [fileOpen, setFileOpen] = useState(false);
  const [panning, setPanning] = useState(false);
  const [dropOver, setDropOver] = useState(false);
  const status = useStatusLine();

  const boardRef = useRef<HTMLDivElement | null>(null);
  const fileBtnRef = useRef<HTMLButtonElement | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const viewRef = useRef(view);
  viewRef.current = view;
  const pendingRef = useRef(new Map<number, Partial<CanvasItem>>());
  const failedRef = useRef(new Map<number, Partial<CanvasItem>>());
  const timersRef = useRef(new Map<number, number>());
  const inflightRef = useRef(new Set<number>());
  const deletedRef = useRef(new Set<number>());
  const draggingRef = useRef<number | null>(null);
  const focusedRef = useRef<number | null>(null);
  const versionRef = useRef('');
  const viewInitRef = useRef(Boolean(readSavedView(site)));
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureRef = useRef<{ kind: 'pan'; sx: number; sy: number; vx: number; vy: number } | { kind: 'pinch'; d0: number; z0: number; wx: number; wy: number } | null>(null);
  const readOnly = consultationMode;

  useAssistantContext({ type: 'canvas', id: site, label: `Canvas de ${site}`, data: { elementos: items.length } });

  useEffect(() => { saveView(site, view); }, [site, view]);

  /* ── Guardado diferido (450 ms por nodo) ──────────────────────────────── */
  const refreshSaveState = useCallback(() => {
    if (failedRef.current.size) setSaveState('error');
    else if (pendingRef.current.size || inflightRef.current.size) setSaveState('saving');
    else setSaveState(current => (current === 'idle' ? 'idle' : 'saved'));
  }, []);

  const flush = useCallback(async (id: number) => {
    window.clearTimeout(timersRef.current.get(id));
    timersRef.current.delete(id);
    const patch = pendingRef.current.get(id);
    if (!patch) return;
    pendingRef.current.delete(id);
    inflightRef.current.add(id);
    setSaveState('saving');
    try {
      await updateCanvasItem(id, patch);
      inflightRef.current.delete(id);
    } catch (reason) {
      inflightRef.current.delete(id);
      // El nodo se borró en otro lado: no hay nada que reintentar.
      if (/no encontrado|404/i.test(errorText(reason))) {
        setItems(current => current.filter(item => item.id !== id));
      } else {
        failedRef.current.set(id, { ...(failedRef.current.get(id) || {}), ...patch, ...(pendingRef.current.get(id) || {}) });
      }
    }
    refreshSaveState();
  }, [refreshSaveState]);

  const flushAll = useCallback(async () => {
    await Promise.all([...pendingRef.current.keys()].map(id => flush(id)));
  }, [flush]);

  const queue = useCallback((id: number, patch: Partial<CanvasItem>) => {
    pendingRef.current.set(id, { ...(pendingRef.current.get(id) || {}), ...patch });
    window.clearTimeout(timersRef.current.get(id));
    timersRef.current.set(id, window.setTimeout(() => { void flush(id); }, SAVE_DELAY));
    setSaveState('saving');
  }, [flush]);

  const retryFailed = useCallback(async () => {
    const failed = [...failedRef.current.entries()];
    failedRef.current.clear();
    for (const [id, patch] of failed) pendingRef.current.set(id, { ...patch, ...(pendingRef.current.get(id) || {}) });
    await Promise.all(failed.map(([id]) => flush(id)));
  }, [flush]);

  const patchItem = useCallback((id: number, patch: Partial<CanvasItem>) => {
    setItems(current => current.map(item => (item.id === id ? { ...item, ...patch } : item)));
    queue(id, patch);
  }, [queue]);

  // Al salir: lo pendiente se manda igual (antes de desmontar y al ocultar la pestaña).
  useEffect(() => {
    const timers = timersRef.current;
    const pending = pendingRef.current;
    return () => {
      timers.forEach(timer => window.clearTimeout(timer));
      pending.forEach((patch, id) => { void updateCanvasItem(id, patch).catch(() => undefined); });
      pending.clear();
    };
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!pendingRef.current.size && !failedRef.current.size && !inflightRef.current.size) return;
      void flushAll();
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [flushAll]);

  /* ── Carga, polling liviano y Recargar ────────────────────────────────── */
  /** Mezcla lo del server sin pisar lo que estás editando, arrastrando o guardando. */
  const merge = useCallback((server: CanvasItem[]) => {
    const local = new Map(itemsRef.current.map(item => [item.id, item]));
    const keep = (id: number) => pendingRef.current.has(id) || failedRef.current.has(id) || inflightRef.current.has(id) || draggingRef.current === id || focusedRef.current === id;
    const next = server.filter(item => !deletedRef.current.has(item.id)).map(item => (keep(item.id) && local.get(item.id)) || item);
    for (const [id, item] of local) if (keep(id) && !next.some(entry => entry.id === id)) next.push(item);
    setItems(next);
  }, []);

  const fetchAll = useCallback(async (initial = false) => {
    const [itemsResponse, version] = await Promise.all([getCanvasItems(), getCanvasVersion().catch(() => null)]);
    if (version) versionRef.current = version.version;
    if (initial) setItems(itemsResponse.items.filter(item => !deletedRef.current.has(item.id)));
    else merge(itemsResponse.items);
    return itemsResponse.items;
  }, [merge]);

  const loadTasks = useCallback(() => getTasks('team').then(response => setTasks(response.items)).catch(() => undefined), []);

  const initial = useCallback(async () => {
    setLoadState('loading');
    setLoadError('');
    try {
      const list = await fetchAll(true);
      setLoadState('ok');
      if (!viewInitRef.current && boardRef.current) {
        viewInitRef.current = true;
        if (list.length) setView(initialView(list, boardRef.current.clientWidth, boardRef.current.clientHeight));
      }
    } catch (reason) {
      setLoadState('error');
      setLoadError(errorText(reason));
    }
  }, [fetchAll]);

  useEffect(() => {
    void initial();
    void loadTasks();
  }, [initial, loadTasks]);

  const checkRemote = useCallback(async () => {
    if (document.visibilityState !== 'visible' || loadState !== 'ok') return;
    try {
      const { version } = await getCanvasVersion();
      if (version !== versionRef.current) {
        await fetchAll(false);
        void loadTasks();
      }
    } catch { /* el próximo intento vuelve a probar */ }
  }, [fetchAll, loadTasks, loadState]);

  useEffect(() => {
    const timer = window.setInterval(() => { void checkRemote(); }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkRemote();
      else void flushAll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [checkRemote, flushAll]);

  const reload = async () => {
    if (reloading) return;
    setReloading(true);
    try {
      await flushAll();
      await fetchAll(false);
      await loadTasks();
      status.show({ tone: 'ok', message: 'Canvas actualizado con los cambios del equipo.' });
    } catch (reason) {
      status.show({ tone: 'bad', message: `No se pudo recargar: ${errorText(reason)}`, retry: { onRetry: reload } });
    } finally {
      setReloading(false);
    }
  };

  /* ── Vista: zoom, paneo, pinza ────────────────────────────────────────── */
  const boardSize = () => ({ w: boardRef.current?.clientWidth || 800, h: boardRef.current?.clientHeight || 600 });
  const zoomBy = (next: number, px?: number, py?: number) => {
    const { w, h } = boardSize();
    setView(current => zoomAround(current, next, px ?? w / 2, py ?? h / 2));
  };

  // Rueda: listener nativo NO pasivo, así el preventDefault vale y la página no scrollea.
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = board.getBoundingClientRect();
      const factor = event.ctrlKey ? Math.exp(-event.deltaY * 0.01) : event.deltaY > 0 ? 0.9 : 1.1;
      setView(current => zoomAround(current, current.zoom * factor, event.clientX - rect.left, event.clientY - rect.top));
    };
    board.addEventListener('wheel', onWheel, { passive: false });
    return () => board.removeEventListener('wheel', onWheel);
  }, [loadState]);

  const relative = (event: { clientX: number; clientY: number }) => {
    const rect = boardRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const startGesture = () => {
    const points = [...pointersRef.current.values()];
    const v = viewRef.current;
    if (points.length >= 2) {
      const [a, b] = points;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      gestureRef.current = { kind: 'pinch', d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), z0: v.zoom, wx: (mid.x - v.x) / v.zoom, wy: (mid.y - v.y) / v.zoom };
    } else if (points.length === 1) {
      gestureRef.current = { kind: 'pan', sx: points[0].x, sy: points[0].y, vx: v.x, vy: v.y };
    } else {
      gestureRef.current = null;
    }
  };

  const onBoardDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('.cv-node')) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* noop */ }
    pointersRef.current.set(event.pointerId, relative(event));
    startGesture();
    setPanning(true);
  };
  const onBoardMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, relative(event));
    const gesture = gestureRef.current;
    if (!gesture) return;
    const points = [...pointersRef.current.values()];
    if (gesture.kind === 'pan' && points.length === 1) {
      setView(current => ({ ...current, x: gesture.vx + points[0].x - gesture.sx, y: gesture.vy + points[0].y - gesture.sy }));
    } else if (gesture.kind === 'pinch' && points.length >= 2) {
      const [a, b] = points;
      const zoom = clampZoom(gesture.z0 * (Math.hypot(a.x - b.x, a.y - b.y) / gesture.d0));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      setView({ zoom, x: Math.round(mid.x - gesture.wx * zoom), y: Math.round(mid.y - gesture.wy * zoom) });
    }
  };
  const onBoardUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.delete(event.pointerId)) return;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* noop */ }
    startGesture();
    if (!pointersRef.current.size) setPanning(false);
  };

  const onBoardKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const step = event.shiftKey ? 160 : 40;
    const pan: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (pan[event.key]) {
      event.preventDefault();
      const [dx, dy] = pan[event.key];
      setView(current => ({ ...current, x: current.x + dx, y: current.y + dy }));
    } else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomBy(viewRef.current.zoom + ZOOM_STEP); }
    else if (event.key === '-' || event.key === '_') { event.preventDefault(); zoomBy(viewRef.current.zoom - ZOOM_STEP); }
    else if (event.key === '0') { event.preventDefault(); zoomBy(1); }
  };

  // Enfocar con Tab un campo de un nodo que quedó fuera de la vista hace que el
  // navegador scrollee el lienzo (aunque sea overflow:hidden) y descuadra las
  // coordenadas. Ese scroll se convierte en paneo: el campo queda a la vista y el
  // lienzo vuelve a scroll 0.
  const onBoardScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const board = event.currentTarget;
    const dx = board.scrollLeft;
    const dy = board.scrollTop;
    if (!dx && !dy) return;
    board.scrollLeft = 0;
    board.scrollTop = 0;
    setView(current => ({ ...current, x: current.x - dx, y: current.y - dy }));
  };

  const fit = () => {
    const { w, h } = boardSize();
    setView(fitView(itemsRef.current, w, h));
  };

  /* ── Altas, archivos, borrar con Deshacer ─────────────────────────────── */
  const place = (type: CanvasItemType) => {
    const size = sizeFor(type);
    const { w, h } = boardSize();
    return { ...size, ...freeSpot(viewRef.current, w, h, size.width, size.height, itemsRef.current) };
  };

  const undoCreate = (item: CanvasItem) => async () => {
    await deleteCanvasItem(item.id);
    deletedRef.current.add(item.id);
    setItems(current => current.filter(entry => entry.id !== item.id));
    status.show({ tone: 'info', message: `Se quitó ${item.title ? `«${item.title}»` : 'el elemento'}.` });
  };

  const add = async (def: (typeof ADDS)[number]) => {
    if (creating || readOnly) return;
    setCreating(def.type);
    try {
      const spot = place(def.type);
      const notes = itemsRef.current.length;
      const response = await createCanvasItem({
        itemType: def.type, title: def.title, content: def.content, ...spot,
        color: NOTE_COLORS[notes % NOTE_COLORS.length]
      });
      setItems(current => [...current, response.item]);
      status.show({ tone: 'ok', message: `Se agregó ${def.phrase} en el centro de la vista.`, undo: { onUndo: undoCreate(response.item) } });
    } catch (reason) {
      status.show({ tone: 'bad', message: `No se pudo agregar ${def.phrase}: ${errorText(reason)}`, retry: { onRetry: () => add(def) } });
    } finally {
      setCreating(null);
    }
  };

  const uploadFile = useCallback(async (file: File) => {
    const base64 = await readFileAsDataUrl(file);
    let stored;
    try {
      stored = await uploadCanvasFile({ name: file.name, mimeType: file.type || 'application/octet-stream', base64 });
    } catch (reason) {
      const message = errorText(reason, 'No se pudo subir.');
      throw new Error(/413|too large|entity/i.test(message) ? `Pesa demasiado (hasta ${MAX_MB} MB).` : message);
    }
    const type: CanvasItemType = stored.mimeType.startsWith('image/') ? 'image' : 'file';
    const response = await createCanvasItem({
      itemType: type,
      title: file.name,
      content: { url: stored.url, name: stored.name, mimeType: stored.mimeType, size: stored.size },
      ...place(type)
    });
    setItems(current => [...current, response.item]);
    status.show({ tone: 'ok', message: `Se agregó «${file.name}» en el centro de la vista.`, undo: { onUndo: undoCreate(response.item) } });
    return response.item;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dropOnBoard = async (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    setDropOver(false);
    if (readOnly) return;
    const files = Array.from(event.dataTransfer.files);
    for (const file of files) {
      if (file.size > MAX_MB * 1024 * 1024) {
        status.show({ tone: 'bad', message: `«${file.name}» pesa más de ${MAX_MB} MB: no se subió.` });
        continue;
      }
      status.show({ tone: 'info', message: `Subiendo «${file.name}»…`, autoHideMs: 0 });
      try {
        await uploadFile(file);
      } catch (reason) {
        status.show({ tone: 'bad', message: `No se pudo subir «${file.name}»: ${errorText(reason)}`, retry: { onRetry: () => uploadFile(file) } });
      }
    }
  };

  const remove = useCallback(async (item: CanvasItem) => {
    await flush(item.id);
    failedRef.current.delete(item.id);
    deletedRef.current.add(item.id);
    setItems(current => current.filter(entry => entry.id !== item.id));
    const label = item.title.trim() ? `«${item.title.trim()}»` : `el ${TYPE_LABEL[item.itemType] || 'elemento'}`;
    try {
      await deleteCanvasItem(item.id);
      status.show({
        tone: 'ok',
        message: `Se borró ${label}.`,
        undo: {
          onUndo: async () => {
            try {
              const restored = await restoreCanvasItem(item.id);
              deletedRef.current.delete(item.id);
              setItems(current => [...current.filter(entry => entry.id !== item.id), restored.item]);
              status.show({ tone: 'ok', message: `Volvió ${label}.` });
            } catch (reason) {
              status.show({ tone: 'bad', message: `No se pudo deshacer: ${errorText(reason)}` });
            }
          }
        }
      });
    } catch (reason) {
      deletedRef.current.delete(item.id);
      setItems(current => (current.some(entry => entry.id === item.id) ? current : [...current, item]));
      status.show({ tone: 'bad', message: `No se pudo borrar ${label}: ${errorText(reason)}` });
    }
    refreshSaveState();
  }, [flush, refreshSaveState, status]);

  const removeStep = useCallback((item: CanvasItem, index: number) => {
    const current = itemsRef.current.find(entry => entry.id === item.id) || item;
    const before = stepsOf(current.content || {});
    const removed = before[index];
    if (!removed) return;
    patchItem(item.id, { content: { ...(current.content || {}), items: before.filter((_, i) => i !== index) } });
    status.show({
      tone: 'ok',
      message: `Se quitó el paso «${removed.text || index + 1}».`,
      undo: {
        onUndo: () => {
          const now = itemsRef.current.find(entry => entry.id === item.id);
          if (!now) return;
          const steps = stepsOf(now.content || {});
          steps.splice(Math.min(index, steps.length), 0, removed);
          patchItem(item.id, { content: { ...(now.content || {}), items: steps } });
          // Reemplaza el aviso: un segundo Deshacer duplicaría el paso.
          status.show({ tone: 'ok', message: `Volvió el paso «${removed.text || index + 1}».` });
        }
      }
    });
  }, [patchItem, status]);

  /* ── Acciones estables para los nodos ─────────────────────────────────── */
  const live = useRef({ patchItem, remove, removeStep, queue });
  live.current = { patchItem, remove, removeStep, queue };
  const actions = useMemo<NodeActions>(() => ({
    zoom: () => viewRef.current.zoom,
    patch: (id, patch) => live.current.patchItem(id, patch),
    move: (id, x, y, isLive) => {
      setItems(current => current.map(item => (item.id === id ? { ...item, x, y } : item)));
      if (!isLive) live.current.queue(id, { x, y });
    },
    resize: (id, width, height, isLive) => {
      setItems(current => current.map(item => (item.id === id ? { ...item, width, height } : item)));
      if (!isLive) live.current.queue(id, { width, height });
    },
    front: id => {
      const all = itemsRef.current;
      const top = all.reduce((max, item) => Math.max(max, item.zIndex || 0), 0);
      const target = all.find(item => item.id === id);
      if (!target || (target.zIndex >= top && all.filter(item => item.zIndex === top).length === 1)) return;
      live.current.patchItem(id, { zIndex: top + 1 });
    },
    dragging: id => { draggingRef.current = id; },
    focus: id => { focusedRef.current = id; },
    remove: item => { void live.current.remove(item); },
    removeStep: (item, index) => live.current.removeStep(item, index)
  }), []);

  /* ── Render ───────────────────────────────────────────────────────────── */
  const zoomPct = Math.round(view.zoom * 100);
  const grid = 24 * view.zoom;
  const boardStyle = {
    '--cv-grid': `${grid}px`,
    '--cv-gx': `${((view.x % grid) + grid) % grid}px`,
    '--cv-gy': `${((view.y % grid) + grid) % grid}px`
  } as React.CSSProperties;
  const saveText = saveState === 'saving' ? 'Guardando…' : saveState === 'error' ? 'No se pudo guardar' : saveState === 'saved' ? 'Guardado' : 'Todo guardado';
  const count = items.length;

  return (
    <section className="cv-page" aria-label="Canvas">
      <div className="cv-head">
        <span className="cv-eyebrow">Pizarra compartida · {site}</span>
        <span className="cv-count g-num">{loadState === 'loading' ? '' : `${count} ${count === 1 ? 'elemento' : 'elementos'}`}</span>
        <span className="cv-head-spacer" />
        {/* Guardado en su propia línea: que cambie el texto no corre ningún botón. */}
        <span className={cx('cv-save', `is-${saveState}`)} role="status" aria-live="polite">{readOnly ? 'Solo lectura' : saveText}</span>
        {saveState === 'error' && <Button size="sm" variant="secondary" icon={<icons.IconRetry size={14} />} onClick={() => void retryFailed()}>Reintentar</Button>}
      </div>

      <div className="cv-bar">
        <div className="cv-add" role="group" aria-label="Agregar al canvas">
          {ADDS.map(def => (
            <Button key={def.type} size="sm" icon={def.icon} disabled={readOnly || loadState !== 'ok' || (creating !== null && creating !== def.type)} loading={creating === def.type} aria-label={`Agregar ${def.phrase}`} onClick={() => void add(def)}>
              {def.short ? <><span className="cv-lbl-long">{def.label}</span><span className="cv-lbl-short">{def.short}</span></> : def.label}
            </Button>
          ))}
          <Button ref={fileBtnRef} size="sm" icon={<Upload size={14} />} disabled={readOnly || loadState !== 'ok'} aria-expanded={fileOpen} onClick={() => setFileOpen(value => !value)}>
            Archivo
          </Button>
        </div>
        <div className="cv-tools" role="group" aria-label="Vista del lienzo">
          <span className="cv-zoom">
            <IconButton size="sm" label="Alejar" icon={<icons.IconMinus size={14} />} disabled={view.zoom <= ZOOM_MIN} onClick={() => zoomBy(view.zoom - ZOOM_STEP)} />
            <Button size="sm" variant="ghost" className="cv-zoom-pct" aria-label={`Zoom ${zoomPct} %. Volver a 100 %`} onClick={() => zoomBy(1)}>
              <span className="g-num">{zoomPct} %</span>
            </Button>
            <IconButton size="sm" label="Acercar" icon={<icons.IconPlus size={14} />} disabled={view.zoom >= ZOOM_MAX} onClick={() => zoomBy(view.zoom + ZOOM_STEP)} />
          </span>
          <Button size="sm" icon={<Maximize size={14} />} disabled={!count} aria-label="Encuadrar: ver todos los elementos" onClick={fit}><span className="cv-hide-xs">Encuadrar</span></Button>
          <Button size="sm" variant="ghost" icon={<Crosshair size={14} />} aria-label="Centrar la vista al 100 %" onClick={() => setView(HOME)}><span className="cv-hide-xs">Centrar</span></Button>
          <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} loading={reloading} aria-label="Recargar el canvas con los cambios del equipo" onClick={() => void reload()}>
            <span className="cv-hide-xs">Recargar</span>
          </Button>
        </div>
      </div>

      {readOnly && (
        <p className="cv-readonly"><icons.IconLock size={14} /> Modo consulta: podés moverte y hacer zoom, no editar.</p>
      )}

      <SmoothCollapse open={fileOpen && !readOnly} anchorRef={fileBtnRef}>
        <div className="cv-upload" data-scanner-ignore="">
          <FileDrop
            multiple
            accept={ACCEPT}
            maxSizeMB={MAX_MB}
            upload={uploadFile}
            label="Subir archivos al canvas"
            title="Arrastrá archivos acá o directo sobre el lienzo, pegá una imagen o tocá para elegir"
            hint={`Imágenes, PDF, DOCX, XLSX o TXT · hasta ${MAX_MB} MB · se ubican en el centro de lo que estás viendo`}
          />
          <div className="cv-upload-foot">
            <Button size="sm" variant="ghost" onClick={() => { setFileOpen(false); fileBtnRef.current?.focus({ preventScroll: true }); }}>Listo</Button>
          </div>
        </div>
      </SmoothCollapse>

      {status.element}

      {loadState === 'error' ? (
        <ErrorState message={`No se pudo cargar el canvas: ${loadError}`} onRetry={() => void initial()} />
      ) : (
        <div
          ref={boardRef}
          className={cx('cv-board', 'infinite-canvas', panning && 'is-panning', dropOver && 'is-drop')}
          style={boardStyle}
          role="application"
          aria-label="Lienzo del canvas. Arrastrá el fondo para moverte; rueda, pinza o los botones para el zoom; flechas para moverte con el teclado."
          tabIndex={0}
          data-scanner-ignore=""
          onPointerDown={onBoardDown}
          onPointerMove={onBoardMove}
          onPointerUp={onBoardUp}
          onPointerCancel={onBoardUp}
          onKeyDown={onBoardKey}
          onScroll={onBoardScroll}
          onDragEnter={event => { if (!readOnly && event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDropOver(true); } }}
          onDragOver={event => { if (!readOnly && event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropOver(false); }}
          onDrop={event => void dropOnBoard(event)}
        >
          <div className="cv-origin" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
            {items.map(item => (
              <CanvasNode key={item.id} item={item} tasks={tasks} readOnly={readOnly} actions={actions} />
            ))}
          </div>
          {loadState === 'loading' && (
            <div className="cv-board-msg" aria-busy="true" aria-label="Cargando el canvas">
              <Skeleton width="12rem" height="6rem" radius="md" />
              <Skeleton width="9rem" height="4.5rem" radius="md" index={1} />
            </div>
          )}
          {loadState === 'ok' && !count && (
            <div className="cv-board-msg">
              <div className="cv-empty" role="status">
                <span className="cv-empty-icon" aria-hidden="true"><StickyNote size={20} /></span>
                <span className="cv-empty-title">El canvas está vacío</span>
                <span className="cv-empty-desc">{readOnly ? 'Cuando el equipo agregue notas, aparecen acá.' : 'Agregá una nota, un checklist, un enlace o un archivo con la barra de arriba.'}</span>
              </div>
            </div>
          )}
          {dropOver && <div className="cv-board-msg cv-drop-msg"><span>Soltá para subir: se ubica en el centro de la vista</span></div>}
        </div>
      )}

      <p className="cv-hints">
        <span>Arrastrá el fondo para moverte (dos dedos para el zoom en el celu)</span>
        <span>Rueda o − / + para el zoom (35 a 220 %)</span>
        <span>Mové un nodo desde su manija o con las flechas</span>
        <span>Soltá archivos sobre el lienzo</span>
      </p>
    </section>
  );
}
