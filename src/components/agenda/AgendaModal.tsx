import { useState } from 'react';
import type { AgendaItem } from '../../types';
import { Button } from '../layout/Button';
import { Modal } from '../layout/Modal';
import { SelectField } from '../layout/SelectField';

export function AgendaModal({ onClose, onSave }: { onClose: () => void; onSave: (item: Partial<AgendaItem>) => Promise<unknown> }) {
  const [item, setItem] = useState<Partial<AgendaItem>>({ dia: 'Lunes', turno: 'Mañana', desde: '09:05', hasta: '09:55', actividad: 'Glifing', tipoDispositivo: 'Touch', cantidad: 1, estado: 'Pendiente' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const update = (key: keyof AgendaItem, value: string | number) => setItem(current => ({ ...current, [key]: value }));

  return (
    <Modal title="+ Nueva actividad" onClose={onClose}>
      <form className="stack" onSubmit={async event => {
        event.preventDefault();
        setSaving(true);
        setError('');
        try {
          await onSave(item);
          onClose();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'No se pudo guardar la actividad.');
        } finally {
          setSaving(false);
        }
      }}>
        <div className="grid-2">
          <label>Día<SelectField value={String(item.dia)} onChange={value => update('dia', value)} options={[{ value: "Lunes", label: "Lunes" }, { value: "Martes", label: "Martes" }, { value: "Miércoles", label: "Miércoles" }, { value: "Jueves", label: "Jueves" }, { value: "Viernes", label: "Viernes" }]} /></label>
          <label>Turno<SelectField value={String(item.turno)} onChange={value => update('turno', value)} options={[{ value: "Mañana", label: "Mañana" }, { value: "Tarde", label: "Tarde" }]} /></label>
        </div>
        <div className="grid-2">
          <label>Desde<input className="input" inputMode="numeric" pattern="[0-2][0-9]:[0-5][0-9]" placeholder="08:00" value={item.desde} onChange={e => update('desde', e.target.value)} /></label>
          <label>Hasta<input className="input" inputMode="numeric" pattern="[0-2][0-9]:[0-5][0-9]" placeholder="08:45" value={item.hasta} onChange={e => update('hasta', e.target.value)} /></label>
        </div>
        <label>Curso<input className="input" required value={item.curso || ''} onChange={e => update('curso', e.target.value)} /></label>
        <label>Actividad<input className="input" value={item.actividad || ''} onChange={e => update('actividad', e.target.value)} /></label>
        <div className="grid-2">
          <label>Tipo<SelectField value={String(item.tipoDispositivo)} onChange={value => update('tipoDispositivo', value)} options={[{ value: "Touch", label: "Touch" }, { value: "Plani", label: "Plani" }, { value: "TIC", label: "TIC" }, { value: "Dell", label: "Dell" }]} /></label>
          <label>Cantidad<input className="input" type="number" min="1" max={item.tipoDispositivo === 'Touch' ? 25 : 99} value={item.cantidad || 1} onChange={e => update('cantidad', Number(e.target.value))} /></label>
        </div>
        <label>Ubicación<input className="input" value={item.ubicacion || ''} onChange={e => update('ubicacion', e.target.value)} /></label>
        <label>Nota<input className="input" value={item.nota || ''} onChange={e => update('nota', e.target.value)} /></label>
        {error && <div className="form-error">{error}</div>}
        <div className="actions"><Button variant="primary" type="submit" disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button><Button type="button" onClick={onClose}>Cancelar</Button></div>
      </form>
    </Modal>
  );
}
