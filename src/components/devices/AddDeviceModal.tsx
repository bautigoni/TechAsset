import { useState } from 'react';
import type { Device } from '../../types';
import { Modal } from '../layout/Modal';
import { Button } from '../layout/Button';

export function AddDeviceModal({ onClose, onSave, initialDevice, title = '+ Anadir dispositivo' }: {
  onClose: () => void;
  onSave: (device: Partial<Device>) => Promise<void>;
  initialDevice?: Partial<Device>;
  title?: string;
}) {
  const [device, setDevice] = useState<Partial<Device>>({ estado: 'Disponible', dispositivo: 'Chromebook', ...initialDevice });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const update = (key: keyof Device, value: string) => setDevice(current => ({ ...current, [key]: value }));

  return (
    <Modal title={title} onClose={onClose}>
      <form className="stack" onSubmit={async event => {
        event.preventDefault();
        setSaving(true);
        setError('');
        try {
          await onSave(device);
          onClose();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'No se pudo guardar el dispositivo.');
        } finally {
          setSaving(false);
        }
      }}>
        <label>Etiqueta 2023<input className="input" required value={device.etiqueta || ''} onChange={e => update('etiqueta', e.target.value)} /></label>
        <label>Numero operativo<input className="input" value={device.numero || ''} onChange={e => update('numero', e.target.value)} /></label>
        <label>Dispositivo<input className="input" required value={device.dispositivo || ''} onChange={e => update('dispositivo', e.target.value)} /></label>
        <div className="grid-2">
          <label>Marca<input className="input" required value={device.marca || ''} onChange={e => update('marca', e.target.value)} /></label>
          <label>Modelo<input className="input" required value={device.modelo || ''} onChange={e => update('modelo', e.target.value)} /></label>
        </div>
        <div className="grid-2">
          <label>Serial<input className="input" value={device.sn || ''} onChange={e => update('sn', e.target.value)} /></label>
          <label>MAC<input className="input" value={device.mac || ''} onChange={e => update('mac', e.target.value)} /></label>
        </div>
        <label>Estado
          <select className="input" value={device.estado || 'Disponible'} onChange={e => update('estado', e.target.value)}>
            <option>Disponible</option>
            <option>Prestado</option>
            <option>No encontrada</option>
            <option>Fuera de servicio</option>
          </select>
        </label>
        {error && <div className="form-error">{error}</div>}
        <div className="actions">
          <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button>
          <Button type="button" onClick={onClose}>Cancelar</Button>
        </div>
      </form>
    </Modal>
  );
}
