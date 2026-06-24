import { useEffect, useMemo, useState } from 'react';
import type { TaskItem } from '../../types';
import { Modal } from '../layout/Modal';
import { Button } from '../layout/Button';
import { ddMmToIso, formatDdMm, isValidDdMm } from '../../utils/taskDate';
import { getSiteAssistants } from '../../services/authApi';

const TURNOS = ['Sin turno', 'Mañana', 'Tarde', 'Todo el día'] as const;

function initialResponsables(initial?: Partial<TaskItem>, operator?: string): string[] {
  if (initial?.responsables?.length) return initial.responsables.filter(Boolean);
  const legacy = String(initial?.responsable || '').split(',').map(s => s.trim()).filter(Boolean);
  if (legacy.length) return legacy;
  return operator ? [operator] : [];
}

export function TaskModal({ onClose, onSave, initial, operator }: { onClose: () => void; onSave: (task: Partial<TaskItem>) => Promise<unknown>; initial?: Partial<TaskItem>; operator: string }) {
  const [assistants, setAssistants] = useState<string[]>([]);
  const [task, setTask] = useState<Partial<TaskItem>>({ prioridad: 'Media', estado: 'Pendiente', ...initial });
  const [selected, setSelected] = useState<string[]>(() => initialResponsables(initial, operator));
  const [dateInput, setDateInput] = useState(formatDdMm(task.fechaVencimiento));
  const update = (key: keyof TaskItem, value: string) => setTask(current => ({ ...current, [key]: value }));

  useEffect(() => {
    getSiteAssistants()
      .then(response => setAssistants(response.items.map(item => item.name).filter(Boolean)))
      .catch(() => setAssistants([]));
  }, []);

  // C1/C2: todas las personas del sitio + el operador actual, como chips toggleables.
  const people = useMemo(
    () => Array.from(new Set([operator, ...assistants, ...selected].map(s => String(s || '').trim()).filter(Boolean))),
    [assistants, operator, selected]
  );

  const toggle = (name: string) =>
    setSelected(current => current.includes(name) ? current.filter(n => n !== name) : [...current, name]);

  const resumen = selected.length === 0
    ? 'Sin asignar'
    : selected.length === 1
      ? selected[0]
      : selected.length === 2
        ? `${selected[0]} e ${selected[1]}`
        : `${selected.slice(0, -1).join(', ')} y ${selected[selected.length - 1]}`;

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isValidDdMm(dateInput)) return;
    const iso = ddMmToIso(dateInput);
    const responsables = selected.length ? selected : ['Sin asignar'];
    await onSave({ ...task, responsables, responsable: responsables.join(','), fechaVencimiento: iso });
    onClose();
  };

  return (
    <Modal title={initial?.id ? 'Editar tarea' : '+ Nueva tarea'} onClose={onClose}>
      <form className="stack" onSubmit={onSubmit}>
        <label>Título<input className="input" required value={task.titulo || ''} onChange={e => update('titulo', e.target.value)} /></label>
        <label>Descripción<textarea className="input" value={task.descripcion || ''} onChange={e => update('descripcion', e.target.value)} /></label>

        <div className="field">
          <span className="field-label">Responsables</span>
          <div className="assignee-chips">
            {people.map(name => (
              <button
                key={name}
                type="button"
                className={`assignee-chip ${selected.includes(name) ? 'is-on' : ''}`}
                onClick={() => toggle(name)}
              >
                {selected.includes(name) && <span className="assignee-chip-check">✓</span>}
                {name}{name === operator ? ' (vos)' : ''}
              </button>
            ))}
          </div>
          <span className="muted" style={{ fontSize: 12 }}>Asignado a: <strong>{resumen}</strong></span>
        </div>

        <div className="grid-2">
          <label>Prioridad<select className="input" value={task.prioridad} onChange={e => update('prioridad', e.target.value)}><option>Baja</option><option>Media</option><option>Urgente</option></select></label>
          <label>Turno<select className="input" value={task.turno || 'Sin turno'} onChange={e => update('turno', e.target.value)}>{TURNOS.map(item => <option key={item}>{item}</option>)}</select></label>
        </div>
        <label>Tipo<input className="input" value={task.tipo || ''} onChange={e => update('tipo', e.target.value)} placeholder="Soporte, Aula, Agenda..." /></label>
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
        <label>Comentario<textarea className="input" rows={3} value={task.comentario || ''} onChange={e => update('comentario', e.target.value)} /></label>
        <div className="actions"><Button variant="primary" type="submit">Guardar</Button><Button type="button" onClick={onClose}>Cancelar</Button></div>
      </form>
    </Modal>
  );
}
