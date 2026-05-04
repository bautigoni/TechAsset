import { useState } from 'react';
import type { AgendaItem } from '../../types';
import { Button } from '../layout/Button';
import { Modal } from '../layout/Modal';

function activityClass(activity: string) {
  const text = activity.toLowerCase();
  if (text.includes('glifing')) return 'agenda-kind-glifing';
  if (text.includes('matific')) return 'agenda-kind-matific';
  if (text.includes('program')) return 'agenda-kind-programacion';
  if (text.includes('tic')) return 'agenda-kind-tic';
  return '';
}

function displayTurno(value: string) {
  const v = String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (v === 'manana') return 'Mañana';
  if (v === 'tarde') return 'Tarde';
  return value || '';
}

export function AgendaCard({ item, consultationMode, onUpdate, onDelete, onTask }: { item: AgendaItem; consultationMode: boolean; onUpdate: (item: AgendaItem, patch: Partial<AgendaItem>) => Promise<unknown> | void; onDelete: (id: string) => void; onTask: (item: AgendaItem) => void }) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(item.nota || '');
  const [busyState, setBusyState] = useState('');
  const canRetire = item.estado === 'Entregado' || item.estado === 'Realizado';
  const isDelivered = item.estado === 'Entregado';
  const retired = Number(item.compusRetiradas || 0);
  const expected = Number(item.cantidad || 0);
  const allRetired = retired > 0 && retired >= expected;
  const someRetired = retired > 0 && retired < expected;
  const retiredClass = allRetired ? 'agenda-retired-all' : someRetired ? 'agenda-retired-some' : '';

  const update = async (patch: Partial<AgendaItem>, stateLabel = '') => {
    setBusyState(stateLabel);
    try {
      await onUpdate(item, patch);
    } finally {
      setBusyState('');
    }
  };

  return (
    <article className={`agenda-card ${activityClass(item.actividad)} agenda-state-${item.estado.toLowerCase().replace(/\s+/g, '-')} ${retiredClass}`}>
      <div className="agenda-card-head">
        <div>
          <strong>{item.desde} - {item.hasta}</strong>
          <div className="muted">{displayTurno(item.turno)}</div>
        </div>
        <div className="small-actions">
          <span className={`badge subtle agenda-status-badge agenda-status-${item.estado.toLowerCase().replace(/\s+/g, '-')}`}>{item.estado}</span>
          {retired > 0 && <span className={`badge subtle agenda-retired-badge ${allRetired ? 'is-all' : 'is-some'}`}>Retiradas {retired}/{expected}</span>}
        </div>
      </div>
      <span className="badge subtle">{item.actividad}</span>
      <h3>{item.curso}</h3>
      <p><strong>Dispositivo:</strong> {item.cantidad} {item.tipoDispositivo}</p>
      <p><strong>Ubicacion:</strong> {item.ubicacion}</p>
      {item.nota && <p className="muted agenda-note-preview">{item.nota}</p>}
      <div className="small-actions agenda-actions">
        <Button
          className={`agenda-delivered-btn ${isDelivered ? 'is-on' : ''}`}
          variant={isDelivered ? 'success' : undefined}
          disabled={consultationMode || busyState === 'entregado'}
          aria-pressed={isDelivered}
          onClick={() => update({ estado: isDelivered ? 'Pendiente' : 'Entregado' }, 'entregado')}
        >
          {busyState === 'entregado' ? 'Guardando...' : isDelivered ? 'Entregado ✓' : 'Marcar entregado'}
        </Button>
        <Button disabled={consultationMode} onClick={() => setNoteOpen(true)}>Nota</Button>
        {canRetire && <Button className={`agenda-retired-btn ${allRetired ? 'is-on' : ''}`} variant={allRetired ? 'success' : undefined} disabled={consultationMode} onClick={() => update({ compusRetiradas: allRetired ? 0 : item.cantidad })}>{allRetired ? 'Retiradas ✓' : 'Computadoras retiradas'}</Button>}
        <Button disabled={consultationMode} onClick={() => update({ estado: 'Cancelado' })}>Cancelar</Button>
        <Button disabled={consultationMode} onClick={() => onTask(item)}>Crear tarea relacionada</Button>
        <Button disabled={consultationMode} onClick={() => onDelete(item.id)}>Borrar actividad</Button>
      </div>
      {noteOpen && (
        <Modal title={`Nota - ${item.curso}`} onClose={() => setNoteOpen(false)}>
          <form className="stack" onSubmit={async event => {
            event.preventDefault();
            await update({ nota: note });
            setNoteOpen(false);
          }}>
            <label>Nota<textarea className="input" rows={5} value={note} onChange={event => setNote(event.target.value)} /></label>
            <div className="actions">
              <Button variant="primary" type="submit">Guardar nota</Button>
              <Button type="button" onClick={() => setNoteOpen(false)}>Cancelar</Button>
            </div>
          </form>
        </Modal>
      )}
    </article>
  );
}
