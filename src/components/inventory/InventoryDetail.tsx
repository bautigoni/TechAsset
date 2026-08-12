import { useEffect, useState } from 'react';
import { CONDITION_VALUES } from '../../types';
import type { Device, InventoryItem } from '../../types';
import { updateDeviceMetadata } from '../../services/devicesApi';
import { Button } from '../layout/Button';
import { SelectField } from '../layout/SelectField';
import { isReviewFresh, reviewLabel, type Entry } from './inventoryEntries';
import { InventoryUnits } from './InventoryUnits';

const CONDITION_OPTIONS = [{ value: '', label: 'Sin revisar' }, ...CONDITION_VALUES.map(value => ({ value, label: value }))];

// Cuerpo del modal de detalle. Antes esto se desplegaba abajo de la grilla: con
// el inventario largo el click no tenía respuesta visible y parecía que no
// había pasado nada.
export function InventoryDetail({ entry, consultationMode, onCondition, onEdit, onHide, onProfile, onItemChange, onDeviceSaved }: {
  entry: Entry;
  consultationMode: boolean;
  onCondition: (condicion: string) => void;
  onEdit?: (item: InventoryItem) => void;
  onHide?: (item: InventoryItem) => void;
  onProfile?: (device: Device) => void;
  onItemChange?: (item: InventoryItem) => void;
  onDeviceSaved?: () => Promise<unknown> | void;
}) {
  const fresh = isReviewFresh(entry);

  return (
    <div className="inv-detail-body">
      <div className="inv-detail-top">
        <div className="inv-detail-media">
          {entry.imagenUrl
            ? <img src={entry.imagenUrl} alt="" />
            : <span>{entry.kind === 'equipo' ? entry.nombre : 'Sin foto'}</span>}
        </div>

        <div className="inv-detail-main">
          <div className="inv-detail-title">
            <span>{[entry.categoria, entry.subcategoria].filter(Boolean).join(' › ')}</span>
            {entry.detalle && <p className="muted">{entry.detalle}</p>}
          </div>

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
            <div>
              <dt>Revisión</dt>
              <dd className={fresh ? '' : 'is-warn'}>{reviewLabel(entry)}</dd>
            </div>
          </dl>

          <label className="inv-detail-condition">Condición
            <SelectField
              value={entry.condicion}
              options={CONDITION_OPTIONS}
              disabled={consultationMode}
              onChange={onCondition}
              ariaLabel="Condición"
            />
          </label>

          <div className="actions">
            {entry.device && onProfile && <Button onClick={() => onProfile(entry.device as Device)}>Ver ficha</Button>}
            {entry.item && onEdit && <Button disabled={consultationMode} onClick={() => onEdit(entry.item as InventoryItem)}>Editar</Button>}
            {entry.item && onHide && <Button disabled={consultationMode} onClick={() => onHide(entry.item as InventoryItem)}>Ocultar</Button>}
          </div>
        </div>
      </div>

      {entry.device && <DeviceIdentity device={entry.device} consultationMode={consultationMode} onSaved={onDeviceSaved} />}

      {entry.item && (
        <InventoryUnits item={entry.item} consultationMode={consultationMode} onItemChange={onItemChange} />
      )}
    </div>
  );
}

// Identificación física del equipo. Los datos ya estaban cargados (SN seguro,
// MAC en parte del parque) pero no se veían en ninguna pantalla: sin esto no
// hay forma de saber cuál de los 50 Chromebook tenés en la mano.
function DeviceIdentity({ device, consultationMode, onSaved }: { device: Device; consultationMode: boolean; onSaved?: () => Promise<unknown> | void }) {
  const [teamviewer, setTeamviewer] = useState(device.teamviewerId || '');
  const [saved, setSaved] = useState(device.teamviewerId || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setTeamviewer(device.teamviewerId || '');
    setSaved(device.teamviewerId || '');
  }, [device.etiqueta, device.teamviewerId]);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      // Sin `condition`: cargar el ID no es haber revisado el equipo, no tiene
      // que mover la fecha de última revisión.
      await updateDeviceMetadata(device.etiqueta, { teamviewerId: teamviewer, origen: 'Inventario' });
      setSaved(teamviewer.trim());
      await onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el TeamViewer ID.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="inv-identity">
      <header><strong>Identificación</strong></header>
      <dl>
        <div><dt>Etiqueta</dt><dd>{device.etiqueta}</dd></div>
        {/* "—" es una situación normal, no un registro incompleto: parte del
            parque no tiene MAC cargada y todos los Chrome OS no usan TeamViewer. */}
        <div><dt>Número de serie</dt><dd>{device.sn || <span className="muted">—</span>}</dd></div>
        <div><dt>MAC</dt><dd>{device.mac || <span className="muted">—</span>}</dd></div>
      </dl>

      <label className="inv-identity-tv">TeamViewer ID
        <span className="inv-identity-tv-row">
          <input
            className="input"
            value={teamviewer}
            disabled={consultationMode || busy}
            placeholder="No aplica en Chrome OS"
            onChange={event => setTeamviewer(event.target.value)}
          />
          <Button
            type="button"
            disabled={consultationMode || busy || teamviewer.trim() === saved.trim()}
            onClick={() => void save()}
          >
            {busy ? 'Guardando…' : 'Guardar'}
          </Button>
        </span>
      </label>
      {error && <div className="tool-error">{error}</div>}
    </section>
  );
}
