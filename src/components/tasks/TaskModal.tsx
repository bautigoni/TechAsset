import { useState } from 'react';
import type { TaskItem } from '../../types';
import { Modal } from '../layout/Modal';
import { Button } from '../layout/Button';
import { ddMmToIso, formatDdMm, isValidDdMm } from '../../utils/taskDate';

const ASSIGN_OPTIONS = ['Bauti', 'Equi', 'Ambos'] as const;

export function TaskModal({ onClose, onSave, initial }: { onClose: () => void; onSave: (task: Partial<TaskItem>) => Promise<unknown>; initial?: Partial<TaskItem> }) {
  const [task, setTask] = useState<Partial<TaskItem>>({ responsable: 'Bauti', prioridad: 'Media', estado: 'Pendiente', ...initial });
  const [dateInput, setDateInput] = useState(formatDdMm(task.fechaVencimiento));
  const update = (key: keyof TaskItem, value: string) => setTask(current => ({ ...current, [key]: value }));

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isValidDdMm(dateInput)) return;
    const iso = ddMmToIso(dateInput);
    await onSave({ ...task, fechaVencimiento: iso });
    onClose();
  };

  return (
    <Modal title="+ Nueva tarea" onClose={onClose}>
      <form className="stack" onSubmit={onSubmit}>
        <label>Título<input className="input" required value={task.titulo || ''} onChange={e => update('titulo', e.target.value)} /></label>
        <label>Descripción<textarea className="input" value={task.descripcion || ''} onChange={e => update('descripcion', e.target.value)} /></label>
        <div className="grid-2">
          <label>Responsable
            <select className="input" value={task.responsable} onChange={e => update('responsable', e.target.value)}>
              {ASSIGN_OPTIONS.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>Prioridad<select className="input" value={task.prioridad} onChange={e => update('prioridad', e.target.value)}><option>Baja</option><option>Media</option><option>Urgente</option></select></label>
        </div>
        <label>Vencimiento (DD/MM)
          <input
            className="input"
            placeholder="DD/MM"
            inputMode="numeric"
            maxLength={5}
            value={dateInput}
            onChange={e => {
              const raw = e.target.value.replace(/[^\d/]/g, '');
              const digits = raw.replace(/\D/g, '').slice(0, 4);
              const formatted = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
              setDateInput(formatted);
            }}
          />
          {!isValidDdMm(dateInput) && <span className="muted" style={{ color: '#ff9b9b' }}>Formato inválido. Usá DD/MM.</span>}
        </label>
        <div className="actions"><Button variant="primary" type="submit">Guardar</Button><Button type="button" onClick={onClose}>Cancelar</Button></div>
      </form>
    </Modal>
  );
}
