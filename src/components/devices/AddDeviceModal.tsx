import { useEffect, useState } from 'react';
import type { Device } from '../../types';
import { Modal } from '../layout/Modal';
import { Button } from '../layout/Button';
import { getDeviceCategories } from '../../services/devicesApi';

export function AddDeviceModal({ onClose, onSave, initialDevice, title = '+ Anadir dispositivo' }: {
  onClose: () => void;
  onSave: (device: Partial<Device>) => Promise<void>;
  initialDevice?: Partial<Device>;
  title?: string;
}) {
  const [device, setDevice] = useState<Partial<Device> & { originalEtiqueta?: string }>({ estado: 'Disponible', categoria: 'Chromebook', dispositivo: 'Chromebook', ...initialDevice, originalEtiqueta: initialDevice?.etiqueta });
  const [categories, setCategories] = useState<string[]>(['Tablet', 'Notebook', 'Chromebook', 'Plani', 'Touch', 'TIC', 'Dell', 'Camara', 'Proyector', 'Router', 'Impresora', 'Otro']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const update = (key: keyof Device, value: string) => setDevice(current => ({ ...current, [key]: value }));

  useEffect(() => {
    getDeviceCategories()
      .then(r => {
        if (r.ok) setCategories(Array.from(new Set([...categories, ...r.items.map(item => item.nombre).filter(Boolean)])).sort());
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal title={title} onClose={onClose}>
      <form className="stack" onSubmit={async event => {
        event.preventDefault();
        setSaving(true);
        setError('');
        try {
          if (!String(device.etiqueta || '').trim()) throw new Error('La etiqueta es obligatoria.');
          if (!String(device.categoria || '').trim()) throw new Error('La categoría es obligatoria.');
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
        <label>Categoría / tipo
          <input className="input" list="device-category-options" required value={device.categoria || ''} onChange={e => update('categoria', e.target.value)} placeholder="Tablet, Notebook, Proyector..." />
          <datalist id="device-category-options">
            {categories.map(item => <option key={item} value={item} />)}
          </datalist>
        </label>
        <label>Dispositivo<input className="input" value={device.dispositivo || ''} onChange={e => update('dispositivo', e.target.value)} placeholder="Chromebook, Tablet, Router..." /></label>
        <div className="grid-2">
          <label>Marca<input className="input" value={device.marca || ''} onChange={e => update('marca', e.target.value)} /></label>
          <label>Modelo<input className="input" value={device.modelo || ''} onChange={e => update('modelo', e.target.value)} /></label>
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
        <label>Alias operativo opcional<input className="input" value={device.aliasOperativo || ''} onChange={e => update('aliasOperativo', e.target.value)} placeholder="TIC1, TIC 1, 1TIC, 1 TIC" /></label>
        <label>Observaciones<textarea className="input" rows={3} value={device.comentarios || ''} onChange={e => update('comentarios', e.target.value)} /></label>
        {error && <div className="form-error">{error}</div>}
        <div className="actions">
          <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button>
          <Button type="button" onClick={onClose}>Cancelar</Button>
        </div>
      </form>
    </Modal>
  );
}
