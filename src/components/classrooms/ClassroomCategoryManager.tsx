import { useState } from 'react';
import type { ClassroomCategory, ClassroomItemState } from '../../types';
import { createClassroomCategory, deleteClassroomCategory, reorderClassroomCategories, updateClassroomCategory } from '../../services/classroomsApi';
import { Button } from '../layout/Button';
import { Modal } from '../layout/Modal';

const DEFAULT_OPTIONS: ClassroomItemState[] = ['OK', 'Con falla', 'No tiene', 'En reparación', 'Sin revisar'];

export function ClassroomCategoryManager({ categories, onClose, onChanged }: { categories: ClassroomCategory[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('');
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
    await updateClassroomCategory(category.id, {
      label: String(data.get('label') || category.label),
      options: options.length ? options : DEFAULT_OPTIONS
    });
    await onChanged();
  };

  return (
    <Modal title="Categorías de Estado de aulas" onClose={onClose}>
      <div className="classroom-category-manager">
        <p className="muted">Las categorías nuevas quedan disponibles automáticamente en todas las aulas. Podés elegir qué estados admite cada una; al eliminar una, el historial anterior se conserva.</p>
        <div className="classroom-category-list">
          {categories.map((category, index) => (
            <article key={category.id}>
              <div className="category-order">
                <button disabled={index === 0} onClick={() => void move(index, -1)}>↑</button>
                <button disabled={index === categories.length - 1} onClick={() => void move(index, 1)}>↓</button>
              </div>
              <form onSubmit={event => { event.preventDefault(); void saveCategory(category, event.currentTarget); }}>
                <input className="input" name="label" defaultValue={category.label} aria-label="Nombre de categoría" />
                <div className="category-options">
                  {DEFAULT_OPTIONS.map(option => <label key={option}><input name="options" type="checkbox" value={option} defaultChecked={category.options.includes(option)} /> {option}</label>)}
                </div>
                <Button type="submit">Guardar</Button>
              </form>
              <button className="btn" onClick={async () => { await deleteClassroomCategory(category.id); await onChanged(); }}>Eliminar</button>
            </article>
          ))}
        </div>
        {creating ? (
          <form className="category-create-form" onSubmit={async event => { event.preventDefault(); if (!label.trim()) return; await createClassroomCategory({ label, options: DEFAULT_OPTIONS }); setLabel(''); setCreating(false); await onChanged(); }}>
            <input className="input" autoFocus value={label} onChange={event => setLabel(event.target.value)} placeholder="Nombre de la categoría" />
            <Button variant="primary" type="submit">Crear</Button>
            <Button type="button" onClick={() => setCreating(false)}>Cancelar</Button>
          </form>
        ) : <Button variant="primary" onClick={() => setCreating(true)}>+ Nueva categoría</Button>}
        <div className="actions"><Button onClick={onClose}>Cerrar</Button></div>
      </div>
    </Modal>
  );
}
