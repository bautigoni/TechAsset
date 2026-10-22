import { useRef, useState, type FormEvent } from 'react';
import type { ClassroomCategory, ClassroomItemState } from '../../types';
import { createClassroomCategory, deleteClassroomCategory, reorderClassroomCategories, updateClassroomCategory } from '../../services/classroomsApi';
import { Button, Checkbox, Collapse, EmptyState, Eyebrow, IconButton, InlineConfirm, Input, StatusSlot, cx, useAnchoredToggle, useStatusLine } from '../../ui';
import { IconChevronDown, IconChevronUp } from '../../ui/icons';
import { errorMessage } from '../layout/Feedback';
import { ITEM_STATES } from './classroomState';
import { useSmoothHeight } from './useSmoothHeight';

/**
 * Administrar categorías de equipamiento EN LÍNEA (antes un modal). Solo para
 * administradores de la sede (el server lo vuelve a exigir). Subir/bajar,
 * editar nombre y estados admitidos en la misma fila, eliminar con
 * confirmación en la fila, crear una nueva. Los errores se ven acá mismo.
 */
export function ClassroomCategories({ categories, consultationMode, onChanged, onClose }: {
  categories: ClassroomCategory[];
  consultationMode: boolean;
  /** Vuelve a pedir las categorías; `before` corre justo antes de pintarlas (para animar el cambio de alto). */
  onChanged: (before?: () => void) => Promise<void>;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLElement | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editOptions, setEditOptions] = useState<ClassroomItemState[]>([]);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  // Aviso del resultado: entra y sale suave (StatusSlot), nunca empuja de golpe la lista.
  const notice = useStatusLine();
  // La lista cambia de alto suave al crear o eliminar, y el control tocado queda quieto.
  const listBox = useSmoothHeight<HTMLDivElement>();
  const anchored = useAnchoredToggle();

  const run = async (key: string, work: () => Promise<unknown>, ok: string) => {
    if (busy) return;
    setBusy(key);
    notice.clear();
    try {
      await work();
      await onChanged(() => anchored(() => listBox.smooth()));
      notice.show({ tone: 'ok', message: ok, autoHideMs: 5000 });
      return true;
    } catch (reason) {
      notice.show({ tone: 'bad', message: errorMessage(reason, 'No se pudo guardar el cambio de categorías.') });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const move = (index: number, delta: number) => {
    const next = [...categories];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    void run(`move-${next[target].id}`, () => reorderClassroomCategories(next.map(item => item.id)), `«${next[target].label}» ${delta < 0 ? 'subió' : 'bajó'} un lugar.`);
  };

  const startEdit = (category: ClassroomCategory) => {
    setDeleting(null);
    setEditing(category.id);
    setEditLabel(category.label);
    setEditOptions(category.options.length ? category.options : ITEM_STATES);
  };

  const saveEdit = async (event: FormEvent, category: ClassroomCategory) => {
    event.preventDefault();
    const label = editLabel.trim();
    if (!label) return;
    const options = ITEM_STATES.filter(state => editOptions.includes(state));
    const ok = await run(`edit-${category.id}`, () => updateClassroomCategory(category.id, { label, options: options.length ? options : ITEM_STATES }), `Categoría «${label}» guardada.`);
    if (ok) setEditing(null);
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const label = newLabel.trim();
    if (!label) return;
    const ok = await run('create', () => createClassroomCategory({ label, options: ITEM_STATES }), `Categoría «${label}» creada.`);
    if (ok) setNewLabel('');
  };

  return (
    <section ref={rootRef} className="cls-card cls-cats" aria-labelledby="cls-cats-title" data-scanner-ignore="">
      <div className="cls-cats-head">
        <div className="cls-grow">
          <Eyebrow>Solo administradores de la sede</Eyebrow>
          <h2 className="cls-h2" id="cls-cats-title">Categorías de equipamiento</h2>
          <p className="cls-muted cls-para">Cada categoría es una fila de la ficha del aula. Eliminar una no toca el historial.</p>
        </div>
        <Button variant="ghost" onClick={onClose}>Cerrar</Button>
      </div>

      <StatusSlot status={notice} />

      <div ref={listBox.ref} className="cls-cats-body">
      {categories.length ? (
        <ol className="cls-cats-list">
          {categories.map((category, index) => {
            const isEditing = editing === category.id;
            const allStates = category.options.length === ITEM_STATES.length;
            return (
              <li key={category.id} className={cx('cls-cats-row', isEditing && 'is-editing')}>
                <div className="cls-cats-line">
                  <IconButton size="sm" label={`Subir ${category.label}`} icon={<IconChevronUp size={14} />} disabled={consultationMode || index === 0 || Boolean(busy)} onClick={() => move(index, -1)} />
                  <IconButton size="sm" label={`Bajar ${category.label}`} icon={<IconChevronDown size={14} />} disabled={consultationMode || index === categories.length - 1 || Boolean(busy)} onClick={() => move(index, 1)} />
                  <span className="cls-cats-name">{category.label}</span>
                  <span className="cls-cats-states">{allStates ? 'Todos los estados' : category.options.join(' · ')}</span>
                  <Button size="sm" variant="ghost" aria-expanded={isEditing} disabled={consultationMode || Boolean(busy)} onClick={() => (isEditing ? setEditing(null) : startEdit(category))} aria-label={`${isEditing ? 'Cerrar la edición de' : 'Editar'} ${category.label}`}>{isEditing ? 'Cerrar' : 'Editar'}</Button>
                  <Button size="sm" variant="ghost" aria-expanded={deleting === category.id} disabled={consultationMode || Boolean(busy)} onClick={() => { setEditing(null); setDeleting(category.id); }} aria-label={`Eliminar ${category.label}`}>Eliminar</Button>
                </div>
                <Collapse open={isEditing} unmountOnClose>
                  <form className="cls-cats-edit" onSubmit={event => void saveEdit(event, category)} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setEditing(null); } }}>
                    <Input label="Nombre" value={editLabel} autoFocus onValueChange={setEditLabel} error={!editLabel.trim() ? 'Escribí un nombre.' : undefined} />
                    <fieldset className="cls-cats-options">
                      <legend className="cls-label">Estados que admite</legend>
                      <div className="cls-cats-checks">
                        {ITEM_STATES.map(state => (
                          <Checkbox
                            key={state}
                            label={state}
                            checked={editOptions.includes(state)}
                            onCheckedChange={next => setEditOptions(current => next ? [...current, state] : current.filter(item => item !== state))}
                          />
                        ))}
                      </div>
                      <span className="cls-help">Si no marcás ninguno, admite todos.</span>
                    </fieldset>
                    <div className="cls-actions">
                      <Button type="submit" variant="primary" size="sm" loading={busy === `edit-${category.id}`} disabled={!editLabel.trim()}>Guardar</Button>
                      <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => setEditing(null)}>Cancelar</Button>
                    </div>
                  </form>
                </Collapse>
                <Collapse open={deleting === category.id} unmountOnClose>
                  <InlineConfirm
                    danger
                    message={`¿Eliminar la categoría «${category.label}»?`}
                    detail="Las aulas dejan de mostrarla. El historial anterior se conserva."
                    confirmLabel="Eliminar"
                    busy={busy === `delete-${category.id}`}
                    onCancel={() => setDeleting(null)}
                    onConfirm={async () => {
                      const ok = await run(`delete-${category.id}`, () => deleteClassroomCategory(category.id), `Categoría «${category.label}» eliminada.`);
                      if (ok) setDeleting(null);
                    }}
                  />
                </Collapse>
              </li>
            );
          })}
        </ol>
      ) : (
        <EmptyState compact title="Todavía no hay categorías." description="Creá la primera: va a aparecer como una fila en la ficha de cada aula." />
      )}
      </div>

      <form className="cls-cats-new" onSubmit={event => void create(event)}>
        <Input
          label="Nueva categoría"
          placeholder="Nombre de la categoría"
          value={newLabel}
          disabled={consultationMode}
          onValueChange={setNewLabel}
          className="cls-cats-new-field"
        />
        <Button type="submit" variant="secondary" loading={busy === 'create'} disabled={consultationMode || !newLabel.trim()}>Crear categoría</Button>
      </form>
    </section>
  );
}
