import { useEffect, useMemo, useState } from 'react';
import type { TaskItem } from '../../types';
import { Modal } from '../layout/Modal';
import { Button } from '../layout/Button';
import { ddMmToIso, formatDdMm, isValidDdMm } from '../../utils/taskDate';
import { getSiteAssistants } from '../../services/authApi';
import { uploadTaskAttachment } from '../../services/tasksApi';

const TURNOS = ['Sin turno', 'Mañana', 'Tarde', 'Todo el día'] as const;

function initialResponsables(initial?: Partial<TaskItem>, operator?: string): string[] {
  if (initial?.responsables?.length) return initial.responsables.filter(Boolean);
  const legacy = String(initial?.responsable || '').split(',').map(s => s.trim()).filter(Boolean);
  if (legacy.length) return legacy;
  return operator ? [operator] : [];
}

export function TaskModal({ onClose, onSave, initial, operator, defaultVisibility = 'team' }: { onClose: () => void; onSave: (task: Partial<TaskItem>) => Promise<unknown>; initial?: Partial<TaskItem>; operator: string; defaultVisibility?: 'team' | 'private' }) {
  const [assistants, setAssistants] = useState<Array<{ name: string; email?: string }>>([]);
  const [task, setTask] = useState<Partial<TaskItem>>({ prioridad: 'Media', estado: 'Pendiente', visibility: defaultVisibility, ...initial });
  const [selected, setSelected] = useState<string[]>(() => initialResponsables(initial, operator));
  const [dateInput, setDateInput] = useState(formatDdMm(task.fechaVencimiento));
  const [uploading, setUploading] = useState(false);
  const update = (key: keyof TaskItem, value: string) => setTask(current => ({ ...current, [key]: value }));

  useEffect(() => {
    getSiteAssistants()
      .then(response => setAssistants(response.items.filter(item => item.name)))
      .catch(() => setAssistants([]));
  }, []);

  // C1/C2: todas las personas del sitio + el operador actual, como chips toggleables.
  const people = useMemo(
    () => Array.from(new Set([operator, ...assistants.map(item => item.name), ...selected].map(s => String(s || '').trim()).filter(Boolean))),
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
    const assigneeEmails = assistants.filter(item => responsables.includes(item.name)).map(item => item.email || '').filter(Boolean);
    await onSave({ ...task, responsables, assigneeEmails, responsable: responsables.join(','), fechaVencimiento: iso });
    onClose();
  };

  return (
    <Modal title={initial?.id ? 'Editar tarea' : '+ Nueva tarea'} onClose={onClose}>
      <form className="stack" onSubmit={onSubmit}>
        {!initial?.id && <div className="task-visibility-choice"><button type="button" className={task.visibility === 'private' ? 'active' : ''} onClick={() => setTask(value => ({ ...value, visibility: 'private' }))}><strong>Mi tarea</strong><span>Solo visible para vos</span></button><button type="button" className={task.visibility !== 'private' ? 'active' : ''} onClick={() => setTask(value => ({ ...value, visibility: 'team' }))}><strong>Tarea de equipo</strong><span>Visible en el espacio compartido</span></button></div>}
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
        <div className="task-attachment-editor">
          <span className="field-label">Adjuntos</span>
          <div className="task-attachment-list">
            {(task.attachments || []).map((attachment, index) => <span key={`${attachment.url}-${index}`}><a href={attachment.url} target="_blank" rel="noreferrer">{attachment.name}</a><button type="button" aria-label={`Quitar ${attachment.name}`} onClick={() => setTask(current => ({ ...current, attachments: (current.attachments || []).filter((_, itemIndex) => itemIndex !== index) }))}>×</button></span>)}
          </div>
          <label className="btn task-upload-button">{uploading ? 'Subiendo…' : '+ Adjuntar archivo'}<input type="file" disabled={uploading} accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,.doc,.docx,.xls,.xlsx" onChange={async event => {
            const file = event.target.files?.[0];
            if (!file) return;
            setUploading(true);
            try {
              const base64 = await readFileAsDataUrl(file);
              const response = await uploadTaskAttachment({ name: file.name, mimeType: file.type || mimeFromName(file.name), base64 });
              setTask(current => ({ ...current, attachments: [...(current.attachments || []), response.attachment] }));
            } finally {
              setUploading(false);
              event.target.value = '';
            }
          }} /></label>
        </div>
        <div className="actions"><Button variant="primary" type="submit">Guardar</Button><Button type="button" onClick={onClose}>Cancelar</Button></div>
      </form>
    </Modal>
  );
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
}

function mimeFromName(name: string) {
  const extension = name.split('.').pop()?.toLowerCase();
  return ({ doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf', txt: 'text/plain' } as Record<string, string>)[extension || ''] || 'application/octet-stream';
}
