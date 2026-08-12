import { useState } from 'react';
import type { ClassroomCategory, ClassroomItemState } from '../../types';
import { createClassroomCategory, deleteClassroomCategory, reorderClassroomCategories, updateClassroomCategory } from '../../services/classroomsApi';
import { Button } from '../layout/Button';
import { Modal } from '../layout/Modal';

const DEFAULT_OPTIONS: ClassroomItemState[] = ['OK', 'Con falla', 'No tiene', 'En reparación', 'Sin revisar'];

export function ClassroomCategoryManager({ categories, onClose, onChanged }: { categories: ClassroomCategory[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const move = async (index: number, delta: number) => {
    const next = [...categories];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    await reorderClassroomCategories(next.map(item => item.id));
    await onChanged();
  };

  const saveCategory = async (category: ClassroomCategory, form: HTMLFormElement) => {
    const data = new FormData(form);
    const options = DEFAULT_OPTIONS.filter(option => data.getAll('options').includes(option));
    setBusy(true);
    try {
      await updateClassroomCategory(category.id, {
        label: String(data.get('label') || category.label),
        options: options.length ? options : DEFAULT_OPTIONS
      });
      setEditing(null);
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Categorías de Estado de aulas" onClose={onClose} wide>
      <div className="cat-manager">
        <p className="muted">
          Cada categoría es una fila del checklist de aula. Al eliminar una, el historial anterior se conserva.
        </p>

        <div className="cat-list">
          {categories.map((category, index) => {
            const isEditing = editing === category.id;
            return (
              <article className={`cat-row ${isEditing ? 'is-editing' : ''}`} key={category.id}>
                {/* Vista compacta: nombre + resumen de estados. Los checkboxes
                    aparecen solo al editar, en vez de una grilla permanente. */}
                {!isEditing ? (
                  <>
                    <div className="cat-order">
                      <button type="button" disabled={index === 0} onClick={() => void move(index, -1)} aria-label="Subir">↑</button>
                      <button type="button" disabled={index === categories.length - 1} onClick={() => void move(index, 1)} aria-label="Bajar">↓</button>
                    </div>
                    <div className="cat-main">
                      <strong>{category.label}</strong>
                      <span>{category.options.length === DEFAULT_OPTIONS.length ? 'Todos los estados' : category.options.join(' · ')}</span>
                    </div>
                    <div className="cat-actions">
                      <button type="button" onClick={() => setEditing(category.id)}>Editar</button>
                      <button type="button" className="is-danger" onClick={async () => {
                        if (!window.confirm(`¿Eliminar la categoría "${category.label}"?`)) return;
                        await deleteClassroomCategory(category.id);
                        await onChanged();
                      }}>Eliminar</button>
                    </div>
                  </>
                ) : (
                  <form className="cat-edit" onSubmit={event => { event.preventDefault(); void saveCategory(category, event.currentTarget); }}>
                    <label>Nombre
                      <input className="input" name="label" defaultValue={category.label} autoFocus />
                    </label>
                    <fieldset className="cat-options">
                      <legend>Estados que admite</legend>
                      {DEFAULT_OPTIONS.map(option => (
                        <label key={option} className="cat-option">
                          <input name="options" type="checkbox" value={option} defaultChecked={category.options.includes(option)} />
                          <span>{option}</span>
                        </label>
                      ))}
                    </fieldset>
                    <div className="actions">
                      <Button variant="primary" type="submit" disabled={busy}>Guardar</Button>
                      <Button type="button" onClick={() => setEditing(null)}>Cancelar</Button>
                    </div>
                  </form>
                )}
              </article>
            );
          })}
          {!categories.length && <div className="empty-state">Todavía no hay categorías.</div>}
        </div>

        {creating ? (
          <form className="cat-create" onSubmit={async event => {
            event.preventDefault();
            if (!label.trim()) return;
            await createClassroomCategory({ label, options: DEFAULT_OPTIONS });
            setLabel('');
            setCreating(false);
            await onChanged();
          }}>
            <input className="input" autoFocus value={label} onChange={event => setLabel(event.target.value)} placeholder="Nombre de la categoría" />
            <Button variant="primary" type="submit">Crear</Button>
            <Button type="button" onClick={() => setCreating(false)}>Cancelar</Button>
          </form>
        ) : (
          <div className="actions">
            <Button variant="primary" onClick={() => setCreating(true)}>Nueva categoría</Button>
            <Button onClick={onClose}>Cerrar</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
