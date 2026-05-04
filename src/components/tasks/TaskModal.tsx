import { useState } from 'react';
import type { TaskItem } from '../../types';
import { OPERATORS } from '../../utils/permissions';
import { Modal } from '../layout/Modal';
import { Button } from '../layout/Button';

export function TaskModal({ onClose, onSave, initial }: { onClose: () => void; onSave: (task: Partial<TaskItem>) => Promise<unknown>; initial?: Partial<TaskItem> }) {
  const [task, setTask] = useState<Partial<TaskItem>>({ responsable: 'Bauti', prioridad: 'Media', estado: 'Pendiente', ...initial });
  const update = (key: keyof TaskItem, value: string) => setTask(current => ({ ...current, [key]: value }));

  return (
    <Modal title="+ Nueva tarea" onClose={onClose}>
      <form className="stack" onSubmit={event => { event.preventDefault(); onSave(task).then(onClose); }}>
        <label>Título<input className="input" required value={task.titulo || ''} onChange={e => update('titulo', e.target.value)} /></label>
        <label>Descripción<textarea className="input" value={task.descripcion || ''} onChange={e => update('descripcion', e.target.value)} /></label>
        <div className="grid-2">
          <label>Responsable<select className="input" value={task.responsable} onChange={e => update('responsable', e.target.value)}>{OPERATORS.slice(0, 2).map(item => <option key={item}>{item}</option>)}</select></label>
          <label>Prioridad<select className="input" value={task.prioridad} onChange={e => update('prioridad', e.target.value)}><option>Baja</option><option>Media</option><option>Urgente</option></select></label>
        </div>
        <label>Vencimiento<input className="input" type="date" value={task.fechaVencimiento || ''} onChange={e => update('fechaVencimiento', e.target.value)} /></label>
        <div className="actions"><Button variant="primary" type="submit">Guardar</Button><Button type="button" onClick={onClose}>Cancelar</Button></div>
      </form>
    </Modal>
  );
}
