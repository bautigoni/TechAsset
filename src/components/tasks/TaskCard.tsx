import { memo, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { Lock, MessageSquare, Paperclip, Plus, X } from 'lucide-react';
import type { TaskChecklistItem, TaskItem } from '../../types';
import { Button, Checkbox, Collapse, StatusText, TruncatedText, cx, useAnchoredToggle } from '../../ui';
import { getActiveSiteCode } from '../../services/activeSite';
import { CARD_ITEMS, dueInfo, joinNames, responsablesOf, taskRouteUrl } from './taskModel';

export type CardHandlers = {
  /** Click en la tarjeta o el título: abre la página (o selecciona con Ctrl/Shift). */
  onOpen: (task: TaskItem, event: MouseEvent) => void;
  onSelect: (task: TaskItem, event: MouseEvent) => void;
  onPointerDown?: (task: TaskItem, event: PointerEvent<HTMLElement>) => void;
  /** Alt + ← / → mueve a la columna de al lado (teclado). */
  onKeyMove?: (task: TaskItem, dir: -1 | 1) => void;
  onToggleItem: (task: TaskItem, item: TaskChecklistItem, next: boolean) => void;
  onAddItem: (task: TaskItem, texto: string) => void;
  onRemoveItem: (task: TaskItem, item: TaskChecklistItem) => void;
};

type Props = CardHandlers & {
  task: TaskItem;
  done: boolean;
  selected: boolean;
  canEdit: boolean;
  draggable: boolean;
  dragging: boolean;
  /** Línea de estado de la tarjeta (Deshacer de una subtarea, error). */
  status?: ReactNode;
};

/**
 * Tarjeta del tablero. Se abre como página (click en la tarjeta o el título);
 * desde acá se operan las subtareas sin salir del tablero. Sin menú "⋯":
 * editar, nota, comentarios, borrar y mover viven en la página de la tarea.
 */
export const TaskCard = memo(function TaskCard({ task, done, selected, canEdit, draggable, dragging, status, onOpen, onSelect, onPointerDown, onKeyMove, onToggleItem, onAddItem, onRemoveItem }: Props) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [showAll, setShowAll] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (adding) inputRef.current?.focus({ preventScroll: true }); }, [adding]);
  // La línea de estado de la tarjeta se va con el colapso: mientras se pliega muestra la última.
  const lastStatus = useRef<ReactNode>(null);
  if (status) lastStatus.current = status;
  const shownStatus = status || lastStatus.current;
  const anchored = useAnchoredToggle();

  const items = task.items || [];
  const doneItems = items.filter(item => item.completada).length;
  const due = dueInfo(task, done);
  const who = joinNames(responsablesOf(task));
  const urgent = !done && (task.prioridad === 'Urgente' || task.prioridad === 'Alta');
  const note = String(task.comentario || '').replace(/\s+/g, ' ').trim();
  const comments = task.commentsCount || 0;
  const files = task.attachments?.length || 0;
  const shownItems = showAll ? items : items.slice(0, CARD_ITEMS);

  const submit = () => {
    const value = text.trim();
    if (!value) return;
    onAddItem(task, value);
    setText('');
    inputRef.current?.focus({ preventScroll: true });
  };

  const onCardClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('button, input, textarea, a, [data-nodrag]')) return;
    // En touch, tocar un texto cortado lo despliega en línea (no abre la tarea).
    const pointer = (event.nativeEvent as globalThis.PointerEvent).pointerType;
    if ((pointer === 'touch' || pointer === 'pen') && target.closest('.ui-trunc.is-cut')) return;
    onOpen(task, event);
  };

  const onTitleKey = (event: KeyboardEvent<HTMLAnchorElement>) => {
    if (!event.altKey || !onKeyMove) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      onKeyMove(task, event.key === 'ArrowLeft' ? -1 : 1);
    }
  };

  return (
    <article
      className={cx('tk-card', selected && 'is-selected', dragging && 'is-dragging', draggable && 'can-drag', done && 'is-done')}
      data-task-id={task.id}
      aria-label={`${task.titulo}${done ? ', hecha' : ''}`}
      onClick={onCardClick}
      onPointerDown={event => onPointerDown?.(task, event)}
    >
      <div className="tk-card-head">
        {canEdit && (
          <Checkbox
            className="tk-card-check"
            checked={selected}
            ariaLabel={`Seleccionar «${task.titulo}»`}
            onCheckedChange={(_, event) => onSelect(task, event)}
          />
        )}
        {/* Link de verdad a la página de la tarea (el título puede ocupar
            varias líneas; el click lo maneja la app: abre, o con Ctrl/Shift
            selecciona). El botón del medio la abre en otra pestaña. */}
        <a className="tk-card-title" href={taskRouteUrl({ id: task.id, edit: false }, getActiveSiteCode())} onClick={event => { event.preventDefault(); event.stopPropagation(); onOpen(task, event); }} onKeyDown={onTitleKey}>
          {task.titulo}
        </a>
      </div>

      <div className="tk-card-meta">
        <span className="tk-nw">{who}</span>
        <span className={cx('tk-nw', urgent && 'tk-bad')}>{task.prioridad || 'Media'}</span>
        {task.tipo && <span className="tk-nw">{task.tipo}</span>}
        {task.turno && task.turno !== 'Sin turno' && <span className="tk-nw">{task.turno}</span>}
        {due && <StatusText tone={due.tone} mono>{due.text}</StatusText>}
        {task.visibility === 'private' && <span className="tk-nw tk-private"><Lock size={12} aria-hidden="true" />Privada</span>}
      </div>

      {task.descripcion && <TruncatedText as="p" lines={2} className="tk-card-desc">{task.descripcion}</TruncatedText>}
      {note && (
        <div className="tk-card-note">
          <span className="tk-card-note-label">Nota</span>
          <TruncatedText className="tk-card-note-text" lines={2} tooltip={task.comentario}>{note}</TruncatedText>
        </div>
      )}

      {items.length > 0 && (
        <div className="tk-subs" data-nodrag="">
          <div className="tk-subs-head">
            <span>Subtareas</span>
            <span className="tk-mono">{doneItems}/{items.length}</span>
          </div>
          {shownItems.map(item => (
            <div className="tk-sub" key={item.id}>
              <Checkbox
                checked={item.completada}
                disabled={!canEdit || item.id < 0}
                ariaLabel={`Subtarea: ${item.texto}`}
                onCheckedChange={next => onToggleItem(task, item, next)}
              />
              <TruncatedText className={cx('tk-sub-text', item.completada && 'is-done')} lines={2}>{item.texto}</TruncatedText>
              {canEdit && (
                <button type="button" className="tk-sub-x" aria-label={`Quitar la subtarea «${item.texto}»`} disabled={item.id < 0} onClick={() => onRemoveItem(task, item)}>
                  <X size={12} aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
          {items.length > CARD_ITEMS && (
            <button type="button" className="tk-link tk-link--sm" aria-expanded={showAll} onClick={event => { const at = event.currentTarget; anchored(() => setShowAll(value => !value), at); }}>
              {showAll ? 'Ver menos' : `Ver ${items.length - CARD_ITEMS} más`}
            </button>
          )}
        </div>
      )}

      <Collapse open={Boolean(status)} className="tk-card-status" data-nodrag="" unmountOnClose>{shownStatus}</Collapse>

      <Collapse open={adding} unmountOnClose>
        <form
          className="tk-card-add"
          data-nodrag=""
          data-scanner-ignore=""
          onSubmit={event => { event.preventDefault(); submit(); }}
        >
          <input
            ref={inputRef}
            className="tk-input tk-input--sm"
            value={text}
            placeholder="¿Qué falta hacer?"
            aria-label={`Nueva subtarea para «${task.titulo}»`}
            onChange={event => setText(event.target.value)}
            onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setAdding(false); setText(''); } }}
            // Si se va el foco con el campo vacío, se cierra (como siempre).
            onBlur={() => window.setTimeout(() => { if (!inputRef.current?.value.trim()) setAdding(false); }, 150)}
          />
          <Button size="sm" type="submit">Agregar</Button>
        </form>
      </Collapse>

      <div className="tk-card-foot">
        <button type="button" className="tk-foot-btn" aria-label={`${comments} ${comments === 1 ? 'comentario' : 'comentarios'} en «${task.titulo}»`} onClick={event => { event.stopPropagation(); onOpen(task, event); }}>
          <MessageSquare size={14} aria-hidden="true" />
          <span className="tk-mono">{comments}</span>
        </button>
        {files > 0 && (
          <button type="button" className="tk-foot-btn" aria-label={`${files} ${files === 1 ? 'adjunto' : 'adjuntos'} en «${task.titulo}»`} onClick={event => { event.stopPropagation(); onOpen(task, event); }}>
            <Paperclip size={14} aria-hidden="true" />
            <span className="tk-mono">{files}</span>
          </button>
        )}
        <span className="tk-grow" />
        {/* Una tarea hecha no suma subtareas nuevas (como siempre). */}
        {canEdit && !done && !adding && (
          <button type="button" className="tk-foot-btn" onClick={event => { event.stopPropagation(); setAdding(true); }}>
            <Plus size={14} aria-hidden="true" />
            Subtarea
          </button>
        )}
      </div>
    </article>
  );
});
