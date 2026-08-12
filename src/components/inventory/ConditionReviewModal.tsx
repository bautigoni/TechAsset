import { useCallback, useEffect, useMemo, useState } from 'react';
import type { InventoryItem } from '../../types';
import { CONDITION_VALUES } from '../../types';
import { getDeviceReviewQueue, updateDeviceMetadata, type ReviewQueueItem } from '../../services/devicesApi';
import { updateInventoryItem } from '../../services/inventoryApi';
import { Button } from '../layout/Button';
import { Modal } from '../layout/Modal';

// Recorrido de revisión. No hay tabla de sesión: la cola se recalcula cada vez
// que abrís (sin condición primero, después la revisión más vieja), así que
// cerrar y volver retoma donde estabas sin guardar estado en ningún lado.
type QueueEntry =
  | { kind: 'equipo'; key: string; titulo: string; detalle: string; clase: string; condicion: string; device: ReviewQueueItem }
  | { kind: 'recurso'; key: string; titulo: string; detalle: string; clase: string; condicion: string; item: InventoryItem };

export function ConditionReviewModal({ items, onClose, onDone }: {
  items: InventoryItem[];
  onClose: () => void;
  onDone: () => Promise<unknown> | void;
}) {
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [assetClasses, setAssetClasses] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [saved, setSaved] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [claseOverride, setClaseOverride] = useState('');

  useEffect(() => {
    let cancelled = false;
    getDeviceReviewQueue()
      .then(response => {
        if (cancelled) return;
        const equipos: QueueEntry[] = response.items.map(device => ({
          kind: 'equipo',
          key: `d:${device.etiqueta}`,
          titulo: device.alias || device.etiqueta,
          detalle: [device.etiqueta, device.marca, device.modelo].filter(Boolean).join(' · '),
          clase: device.assetClass,
          condicion: device.condition,
          device
        }));
        const recursos: QueueEntry[] = [...items]
          .sort((a, b) => {
            const aC = a.condicion ? 1 : 0;
            const bC = b.condicion ? 1 : 0;
            if (aC !== bC) return aC - bC;
            return a.nombre.localeCompare(b.nombre, 'es');
          })
          .map(item => ({
            kind: 'recurso',
            key: `i:${item.id}`,
            titulo: item.nombre,
            detalle: `${item.cantidad} ${item.unidad}`,
            clase: item.categoria || 'Otro',
            condicion: item.condicion || '',
            item
          }));
        setQueue([...equipos, ...recursos]);
        setAssetClasses(response.assetClasses);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'No se pudo cargar la cola de revisión.');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [items]);

  const current = queue[index];
  const revisadosPrevios = useMemo(() => queue.filter(entry => entry.condicion).length, [queue]);

  useEffect(() => { setClaseOverride(current?.clase || ''); }, [current?.key, current?.clase]);

  const advance = useCallback(() => {
    setIndex(value => Math.min(value + 1, queue.length));
    setError('');
  }, [queue.length]);

  const assign = useCallback(async (condicion: string) => {
    if (!current || saving) return;
    setSaving(true);
    setError('');
    try {
      if (current.kind === 'equipo') {
        await updateDeviceMetadata(current.device.etiqueta, {
          condition: condicion,
          assetClass: claseOverride || current.clase,
          origen: 'Revisión'
        });
      } else {
        await updateInventoryItem(current.item.id, { condicion, categoria: claseOverride || current.clase, revisado: true });
      }
      setSaved(value => value + 1);
      advance();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar. Probá de nuevo.');
    } finally {
      setSaving(false);
    }
  }, [current, saving, claseOverride, advance]);

  // Teclado: 1-4 condición, S saltar, Escape salir. Sin mouse.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (loading || !current) return;
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      const key = event.key.toLowerCase();
      const shortcut = ['1', '2', '3', '4'].indexOf(event.key);
      if (shortcut >= 0) {
        event.preventDefault();
        void assign(CONDITION_VALUES[shortcut]);
        return;
      }
      if (key === 's') {
        event.preventDefault();
        advance();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [assign, advance, loading, current]);

  const finish = async () => {
    await onDone();
    onClose();
  };

  const total = queue.length;
  const done = index >= total && total > 0;

  return (
    <Modal title="Revisión de condición" onClose={() => { void finish(); }}>
      <div className="review-wizard">
        {loading && <p className="muted">Cargando cola...</p>}

        {!loading && !total && <p className="muted">No hay nada para revisar en esta sede.</p>}

        {!loading && total > 0 && !done && current && (
          <>
            <div className="review-progress">
              <span>{index + 1} de {total}</span>
              <span className="muted">{revisadosPrevios + saved} con condición cargada</span>
            </div>
            <div className="review-bar"><i style={{ width: `${Math.round((index / total) * 100)}%` }} /></div>

            <div className="review-subject">
              <strong>{current.titulo}</strong>
              <span>{current.detalle}</span>
              {current.condicion && <span className="muted">Última revisión: {current.condicion}</span>}
            </div>

            <label className="review-class">
              <span className="field-label">{current.kind === 'equipo' ? 'Clase de activo' : 'Categoría'}</span>
              <select className="input" value={claseOverride} onChange={event => setClaseOverride(event.target.value)}>
                {[...new Set([claseOverride, ...(current.kind === 'equipo' ? assetClasses : [current.clase])].filter(Boolean))]
                  .map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>

            <div className="review-options">
              {CONDITION_VALUES.map((value, position) => (
                <button key={value} type="button" disabled={saving} onClick={() => void assign(value)}>
                  <kbd>{position + 1}</kbd>
                  <span>{value}</span>
                </button>
              ))}
            </div>

            {error && <div className="tool-error">{error}</div>}

            <div className="review-footer">
              <span className="muted">1-4 para calificar · S para saltar · Esc para salir</span>
              <div className="actions">
                <Button type="button" onClick={advance} disabled={saving}>Saltar</Button>
                <Button type="button" variant="primary" onClick={() => { void finish(); }}>Salir</Button>
              </div>
            </div>
          </>
        )}

        {!loading && done && (
          <div className="review-done">
            <strong>Recorrido terminado</strong>
            <p className="muted">{saved} {saved === 1 ? 'ítem calificado' : 'ítems calificados'} en esta pasada.</p>
            <div className="actions">
              <Button type="button" variant="primary" onClick={() => { void finish(); }}>Cerrar</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
