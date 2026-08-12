import { CONDITION_VALUES } from '../../types';
import type { Device, InventoryItem } from '../../types';
import { Button } from '../layout/Button';
import type { Entry } from './inventoryEntries';

// Panel de detalle del recurso seleccionado. Vive abajo de la lista, no en un
// modal: así se puede ir clickeando de una fila a otra sin abrir y cerrar.
export function InventoryDetail({ entry, consultationMode, onClose, onCondition, onEdit, onHide, onProfile }: {
  entry: Entry;
  consultationMode: boolean;
  onClose: () => void;
  onCondition: (condicion: string) => void;
  onEdit?: (item: InventoryItem) => void;
  onHide?: (item: InventoryItem) => void;
  onProfile?: (device: Device) => void;
}) {
  return (
    <section className="inv-detail-panel">
      <div className="inv-detail-media">
        {entry.imagenUrl
          ? <img src={entry.imagenUrl} alt="" />
          : <span>{entry.kind === 'equipo' ? entry.nombre : 'Sin foto'}</span>}
      </div>

      <div className="inv-detail-main">
        <div className="inv-detail-title">
          <strong>{entry.nombre}</strong>
          <span>{[entry.categoria, entry.subcategoria].filter(Boolean).join(' › ')}</span>
        </div>
        {entry.detalle && <p className="muted">{entry.detalle}</p>}
        <dl>
          {entry.kind === 'recurso' ? (
            <>
              <div><dt>Stock</dt><dd>{entry.cantidad} {entry.unidad}</dd></div>
              <div><dt>Bajo stock</dt><dd>{entry.bajoStock ? 'Sí' : 'No'}</dd></div>
            </>
          ) : (
            <>
              <div><dt>Vida útil</dt><dd>{entry.vidaPct === null ? '—' : entry.vencido ? 'Vencida' : `${entry.vidaPct}% consumida`}</dd></div>
              <div><dt>Renovación</dt><dd>{entry.renovacion || '—'}</dd></div>
            </>
          )}
          <div><dt>Seguimiento</dt><dd>{entry.kind === 'equipo' ? 'Individual' : 'Por stock'}</dd></div>
        </dl>
      </div>

      <div className="inv-detail-side">
        <label>Condición
          <select className="input" value={entry.condicion} disabled={consultationMode} onChange={event => onCondition(event.target.value)}>
            <option value="">Sin revisar</option>
            {CONDITION_VALUES.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <div className="actions">
          {entry.device && onProfile && <Button onClick={() => onProfile(entry.device as Device)}>Ver ficha</Button>}
          {entry.item && onEdit && <Button disabled={consultationMode} onClick={() => onEdit(entry.item as InventoryItem)}>Editar</Button>}
          {entry.item && onHide && <Button disabled={consultationMode} onClick={() => onHide(entry.item as InventoryItem)}>Ocultar</Button>}
        </div>
      </div>

      <button className="inv-detail-close" type="button" onClick={onClose} aria-label="Cerrar detalle">✕</button>
    </section>
  );
}
