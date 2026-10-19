import { memo, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { CircleCheck, Circle, ExternalLink, GripVertical, MoveDiagonal2 } from 'lucide-react';
import type { CanvasItem, TaskItem } from '../../types';
import { Button, Checkbox, IconButton, cx, icons } from '../../ui';
import { SmoothCollapse } from '../common/SmoothCollapse';
import { MAX_H, MAX_W, MIN_H, MIN_W, TYPE_LABEL, clamp, fileSize, safeLink, stepsOf, type Step } from './canvasModel';

/** Acciones del lienzo: un objeto estable (no re-renderiza los nodos al panear). */
export type NodeActions = {
  zoom: () => number;
  patch: (id: number, patch: Partial<CanvasItem>) => void;
  /** live=true: solo pinta (arrastrando); live=false: guarda. */
  move: (id: number, x: number, y: number, live: boolean) => void;
  resize: (id: number, width: number, height: number, live: boolean) => void;
  front: (id: number) => void;
  dragging: (id: number | null) => void;
  focus: (id: number | null) => void;
  remove: (item: CanvasItem) => void;
  removeStep: (item: CanvasItem, index: number) => void;
};

const title = (item: CanvasItem) => item.title.trim() || 'Sin título';

function useAutoHeight(value: string) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return ref;
}

/** Arrastre con pointer capture sobre un asa (mover o redimensionar). */
function startHandleDrag(event: ReactPointerEvent<HTMLElement>, onMove: (dx: number, dy: number) => void, onEnd: (moved: boolean) => void) {
  const el = event.currentTarget;
  const pointerId = event.pointerId;
  const sx = event.clientX;
  const sy = event.clientY;
  let moved = false;
  try { el.setPointerCapture(pointerId); } catch { /* noop */ }
  const move = (next: PointerEvent) => {
    if (next.pointerId !== pointerId) return;
    const dx = next.clientX - sx;
    const dy = next.clientY - sy;
    if (!moved && Math.abs(dx) + Math.abs(dy) < 2) return;
    moved = true;
    onMove(dx, dy);
  };
  const up = (next: PointerEvent) => {
    if (next.pointerId !== pointerId) return;
    try { el.releasePointerCapture(pointerId); } catch { /* noop */ }
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    onEnd(moved);
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

function CanvasNodeView({ item, tasks, readOnly, actions }: { item: CanvasItem; tasks: TaskItem[]; readOnly: boolean; actions: NodeActions }) {
  const content = item.content || {};
  const [pickOpen, setPickOpen] = useState(false);
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [focusStep, setFocusStep] = useState<number | null>(null);
  const stepsRef = useRef<HTMLDivElement | null>(null);
  const text = String(content.text ?? '');
  const textRef = useAutoHeight(text);
  const steps = stepsOf(content);

  useLayoutEffect(() => {
    if (focusStep === null) return;
    const input = stepsRef.current?.querySelectorAll<HTMLInputElement>('.cv-step-text')[focusStep];
    input?.focus({ preventScroll: true });
    input?.select();
    setFocusStep(null);
  }, [focusStep]);

  const setContent = (patch: Record<string, unknown>) => actions.patch(item.id, { content: { ...content, ...patch } });
  const setSteps = (next: Step[]) => setContent({ items: next });

  const onGripDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (readOnly || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    actions.front(item.id);
    actions.dragging(item.id);
    const start = { x: item.x, y: item.y };
    let last = start;
    startHandleDrag(
      event,
      (dx, dy) => {
        const zoom = actions.zoom();
        last = { x: Math.round(start.x + dx / zoom), y: Math.round(start.y + dy / zoom) };
        actions.move(item.id, last.x, last.y, true);
      },
      moved => {
        actions.dragging(null);
        if (moved) actions.move(item.id, last.x, last.y, false);
      }
    );
  };

  const onGripKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const dir = ARROWS[event.key];
    if (!dir || readOnly) return;
    event.preventDefault();
    const step = event.shiftKey ? 50 : 10;
    actions.front(item.id);
    actions.move(item.id, item.x + dir[0] * step, item.y + dir[1] * step, false);
  };

  const onResizeDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (readOnly || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    actions.front(item.id);
    actions.dragging(item.id);
    const start = { w: item.width, h: item.height };
    let last = start;
    startHandleDrag(
      event,
      (dx, dy) => {
        const zoom = actions.zoom();
        last = { w: Math.round(clamp(start.w + dx / zoom, MIN_W, MAX_W)), h: Math.round(clamp(start.h + dy / zoom, MIN_H, MAX_H)) };
        actions.resize(item.id, last.w, last.h, true);
      },
      moved => {
        actions.dragging(null);
        if (moved) actions.resize(item.id, last.w, last.h, false);
      }
    );
  };

  const onResizeKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const dir = ARROWS[event.key];
    if (!dir || readOnly) return;
    event.preventDefault();
    const step = event.shiftKey ? 50 : 10;
    actions.resize(item.id, clamp(item.width + dir[0] * step, MIN_W, MAX_W), clamp(item.height + dir[1] * step, MIN_H, MAX_H), false);
  };

  const style = {
    transform: `translate(${item.x}px, ${item.y}px)`,
    width: item.width,
    [item.itemType === 'image' ? 'height' : 'minHeight']: item.height,
    zIndex: item.zIndex,
    '--cv-note': item.itemType === 'sticky' && /^#[0-9a-f]{3,8}$/i.test(item.color) ? item.color : undefined
  } as CSSProperties;

  const url = String(content.url || '');
  const linkUrl = safeLink(url);
  const ids = Array.isArray(content.taskIds) ? content.taskIds.map(String) : [];
  const chosen = ids.map(id => tasks.find(task => task.id === id)).filter(Boolean) as TaskItem[];
  const openTasks = tasks.filter(task => !task.done);
  const visibleOptions = showAllTasks ? openTasks : openTasks.slice(0, 8);

  return (
    <article
      className={cx('cv-node', `cv-node--${item.itemType}`)}
      style={style}
      aria-label={`${title(item)} · ${TYPE_LABEL[item.itemType] || 'elemento'}`}
      data-node-id={item.id}
      onFocus={() => actions.focus(item.id)}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) actions.focus(null); }}
    >
      <header className="cv-node-head">
        <button
          type="button"
          className="cv-grip"
          aria-label={`Mover «${title(item)}». Arrastrá o usá las flechas (Shift para pasos largos).`}
          disabled={readOnly}
          onPointerDown={onGripDown}
          onKeyDown={onGripKey}
        >
          <GripVertical size={16} aria-hidden="true" />
        </button>
        <input
          className="cv-node-title"
          type="text"
          value={item.title}
          maxLength={160}
          placeholder="Sin título"
          aria-label="Título del elemento"
          disabled={readOnly}
          onChange={event => actions.patch(item.id, { title: event.target.value })}
        />
        {!readOnly && (
          <IconButton size="sm" className="cv-node-del" label={`Borrar «${title(item)}»`} icon={<icons.IconX size={14} />} onClick={() => actions.remove(item)} />
        )}
      </header>

      <div className="cv-node-body">
        {(item.itemType === 'sticky' || item.itemType === 'text') && (
          <textarea
            ref={textRef}
            className="cv-text"
            rows={2}
            value={text}
            aria-label="Contenido"
            placeholder={item.itemType === 'sticky' ? 'Escribí la idea…' : 'Escribí el texto…'}
            disabled={readOnly}
            onChange={event => setContent({ text: event.target.value })}
          />
        )}

        {item.itemType === 'checklist' && (
          <div className="cv-steps" ref={stepsRef}>
            {steps.map((step, index) => (
              <div key={index} className={cx('cv-step', step.checked && 'is-done')}>
                <Checkbox
                  checked={step.checked}
                  disabled={readOnly}
                  ariaLabel={`${step.checked ? 'Reabrir' : 'Completar'}: ${step.text || `paso ${index + 1}`}`}
                  onCheckedChange={next => setSteps(steps.map((value, i) => (i === index ? { ...value, checked: next } : value)))}
                />
                <input
                  className="cv-step-text"
                  type="text"
                  value={step.text}
                  aria-label={`Paso ${index + 1}`}
                  placeholder="Paso"
                  disabled={readOnly}
                  onChange={event => setSteps(steps.map((value, i) => (i === index ? { ...value, text: event.target.value } : value)))}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && !readOnly) {
                      event.preventDefault();
                      setSteps([...steps.slice(0, index + 1), { text: '', checked: false }, ...steps.slice(index + 1)]);
                      setFocusStep(index + 1);
                    }
                  }}
                />
                {!readOnly && (
                  <IconButton size="sm" label={`Quitar paso: ${step.text || index + 1}`} icon={<icons.IconX size={14} />} onClick={() => actions.removeStep(item, index)} />
                )}
              </div>
            ))}
            {!steps.length && <p className="cv-hint-sm">Sin pasos todavía.</p>}
            {!readOnly && (
              <Button
                size="sm"
                variant="ghost"
                className="cv-add-step"
                icon={<icons.IconPlus size={14} />}
                onClick={() => { setSteps([...steps, { text: 'Nuevo paso', checked: false }]); setFocusStep(steps.length); }}
              >
                Paso
              </Button>
            )}
          </div>
        )}

        {item.itemType === 'link' && (
          <div className="cv-link">
            <label className="cv-field">
              <span>Texto</span>
              <input type="text" value={String(content.text ?? '')} placeholder="Cómo se muestra" disabled={readOnly} onChange={event => setContent({ text: event.target.value })} />
            </label>
            <label className="cv-field">
              <span>URL</span>
              <input type="url" inputMode="url" value={url} placeholder="https://" disabled={readOnly} onChange={event => setContent({ url: event.target.value })} />
            </label>
            {linkUrl ? (
              <a className="cv-open" href={linkUrl} target="_blank" rel="noopener noreferrer">
                <span className="cv-open-text">{String(content.text || '').trim() || 'Abrir enlace'}</span>
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            ) : (
              <p className="cv-hint-sm">Solo se abren enlaces http o https.</p>
            )}
          </div>
        )}

        {item.itemType === 'image' && (
          url ? <img className="cv-img" src={url} alt={item.title || String(content.name || 'Imagen del canvas')} draggable={false} /> : <p className="cv-hint-sm">La imagen no está disponible.</p>
        )}

        {item.itemType === 'file' && (
          <a className="cv-file" href={url || undefined} target="_blank" rel="noreferrer">
            <icons.IconFile size={20} />
            <span className="cv-file-text">
              <span className="cv-file-name">{String(content.name || item.title || 'Archivo')}</span>
              <span className="cv-file-meta">{[String(content.name || '').split('.').pop()?.toUpperCase(), fileSize(content.size)].filter(Boolean).join(' · ') || 'Abrir'}</span>
            </span>
          </a>
        )}

        {item.itemType === 'task-group' && (
          <div className="cv-group">
            {chosen.length ? (
              <ul className="cv-group-list">
                {chosen.map(task => (
                  <li key={task.id} className={cx('cv-group-task', task.done && 'is-done')}>
                    {task.done ? <CircleCheck size={14} aria-label="Hecha" /> : <Circle size={14} aria-label="Pendiente" />}
                    <span className="cv-group-title">{task.titulo}</span>
                    {task.prioridad && task.prioridad !== 'Baja' && <span className={cx('cv-prio', task.prioridad === 'Urgente' && 'is-bad')}>{task.prioridad}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="cv-hint-sm">Elegí tareas para armar este grupo.</p>
            )}
            {!readOnly && (
              <Button size="sm" variant="ghost" aria-expanded={pickOpen} iconEnd={<icons.IconChevronDown size={14} className={cx('cv-chev', pickOpen && 'is-open')} />} onClick={() => setPickOpen(value => !value)}>
                {pickOpen ? 'Listo' : 'Agregar tareas'}
              </Button>
            )}
            <SmoothCollapse open={pickOpen && !readOnly} reveal={false}>
              <div className="cv-pick">
                <span className="cv-hint-sm">Tareas de equipo sin terminar</span>
                {visibleOptions.map(task => {
                  const on = ids.includes(task.id);
                  return (
                    <div key={task.id} className="cv-pick-row">
                      <Checkbox
                        checked={on}
                        label={task.titulo}
                        ariaLabel={`${on ? 'Quitar del grupo' : 'Agregar al grupo'}: ${task.titulo}`}
                        onCheckedChange={next => setContent({ taskIds: next ? [...ids, task.id] : ids.filter(id => id !== task.id) })}
                      />
                      <span className="cv-pick-state">{task.estado}</span>
                    </div>
                  );
                })}
                {!openTasks.length && <span className="cv-hint-sm">No hay tareas de equipo pendientes.</span>}
                {openTasks.length > 8 && (
                  <Button size="sm" variant="ghost" onClick={() => setShowAllTasks(value => !value)}>
                    {showAllTasks ? 'Ver menos' : `Ver ${openTasks.length - 8} más`}
                  </Button>
                )}
              </div>
            </SmoothCollapse>
          </div>
        )}
      </div>

      {!readOnly && (
        // El asa va en su propia franja al pie: no pisa el contenido del nodo.
        <div className="cv-node-foot">
          <button
            type="button"
            className="cv-resize"
            aria-label={`Cambiar el tamaño de «${title(item)}». Arrastrá o usá las flechas.`}
            onPointerDown={onResizeDown}
            onKeyDown={onResizeKey}
          >
            <MoveDiagonal2 size={12} aria-hidden="true" />
          </button>
        </div>
      )}
    </article>
  );
}

export const CanvasNode = memo(CanvasNodeView);
