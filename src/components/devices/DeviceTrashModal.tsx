import { useEffect, useState } from 'react';
import { getDeletedDevices, restoreDevice, type DeletedDevice } from '../../services/devicesApi';
import { DATE_TIME, formatDate } from '../../utils/formatters';
import { Button } from '../layout/Button';
import { Modal } from '../layout/Modal';
import { SkeletonLine } from '../layout/Skeleton';
import { errorMessage, toast } from '../layout/Feedback';

/**
 * Papelera de dispositivos. Borrar un equipo lo oculta (su historial queda); acá
 * se ve quién lo borró y cuándo, y se lo devuelve tal cual estaba. Antes la
 * única forma de recuperar uno era reimportar el CSV.
 */
export function DeviceTrashModal({ consultationMode, onRestored, onClose }: { consultationMode: boolean; onRestored: () => void; onClose: () => void }) {
  const [items, setItems] = useState<DeletedDevice[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [query, setQuery] = useState('');

  const load = () => getDeletedDevices()
    .then(response => setItems(response.items))
    .catch(reason => { setItems([]); setError(errorMessage(reason, 'No se pudo cargar la papelera.')); });

  useEffect(() => { void load(); }, []);

  const restore = async (item: DeletedDevice) => {
    setBusy(item.etiqueta);
    try {
      await restoreDevice(item.etiqueta);
      setItems(current => (current || []).filter(entry => entry.etiqueta !== item.etiqueta));
      onRestored();
      toast({ message: `${item.etiqueta} restaurado.`, tone: 'ok' });
    } catch (reason) {
      toast({ message: errorMessage(reason, 'No se pudo restaurar.'), tone: 'error' });
    } finally {
      setBusy('');
    }
  };

  const needle = query.trim().toLowerCase();
  const visible = (items || []).filter(item => !needle || [item.etiqueta, item.alias, item.categoria, item.modelo, item.deletedBy].join(' ').toLowerCase().includes(needle));

  return (
    <Modal title="Papelera de dispositivos" onClose={onClose} wide>
      <div className="stack device-trash">
        <p className="muted device-trash-intro">Los equipos borrados se ocultan de la app pero conservan su historial. Restaurarlos los devuelve como estaban.</p>
        {items && items.length > 6 && (
          <input className="input" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por etiqueta, alias, modelo o quién lo borró" aria-label="Buscar en la papelera" />
        )}
        {error && <div className="tool-error">{error}</div>}
        {!items && <div className="stack"><SkeletonLine width="70%" height={14} /><SkeletonLine width="55%" height={14} /></div>}
        {items && !items.length && !error && <div className="empty-state">La papelera está vacía.</div>}
        {visible.length > 0 && (
          <ul className="device-trash-list">
            {visible.map(item => (
              <li key={item.etiqueta}>
                <div className="device-trash-main">
                  <strong>{item.etiqueta}{item.alias ? ` · ${item.alias}` : ''}</strong>
                  <span className="muted">{[item.categoria, item.modelo].filter(Boolean).join(' · ') || 'Sin datos del equipo'}</span>
                  <span className="muted device-trash-meta">
                    Borrado {formatDate(item.deletedAt, DATE_TIME, 'sin fecha')}{item.deletedBy ? ` por ${item.deletedBy}` : ''}
                  </span>
                </div>
                <Button disabled={consultationMode || busy === item.etiqueta} onClick={() => void restore(item)}>
                  {busy === item.etiqueta ? 'Restaurando…' : 'Restaurar'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
