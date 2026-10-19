import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InventoryItem } from '../../types';
import { CONDITION_VALUES } from '../../types';
import { getDeviceReviewQueue } from '../../services/devicesApi';
import type { ReviewUndoPayload } from '../../services/inventoryApi';
import { Button, ErrorState, Eyebrow, Kbd, Ring, SkeletonText } from '../../ui';
import { TruncatedText } from '../../ui/Truncated';
import { isEditableTarget } from '../../hooks/useGlobalScanner';
import { compareText, FORM_CATEGORIES, reviewLabel, type Entry } from './inventoryEntries';
import { Chip, ChipGroup, errorText, Tx } from './inventoryParts';

/**
 * Recorrido de revisión EN LÍNEA (empuja el contenido): calificar uno por uno
 * con el teclado. 1–4 califican, S salta, Esc sale; ninguno actúa con
 * Ctrl/Meta/Alt ni mientras se escribe en un campo. Deshacer revierte la
 * última calificación (condición, fecha y clase exactas) y vuelve a ese ítem.
 *
 * La cola no se guarda: se recalcula al abrir (equipos nunca revisados →
 * revisión más vieja; después recursos sin condición → por nombre), así que
 * cerrar y volver retoma donde estabas.
 */

type QueueEntry = {
  key: string;
  kind: 'equipo' | 'recurso';
  etiqueta?: string;
  itemId?: number;
  titulo: string;
  detalle: string;
  /** Clase/categoría que se muestra elegida por defecto. */
  clase: string;
  /** Clase guardada de verdad (equipos: '' si es derivada). Para Deshacer. */
  claseGuardada: string;
};

type LastRating = {
  index: number;
  key: string;
  titulo: string;
  condicion: string;
  undo: ReviewUndoPayload;
};

export function ConditionReview({ items, entriesByKey, consultationMode, onRateDevice, onRateItem, onUndo, onExit }: {
  items: InventoryItem[];
  entriesByKey: Map<string, Entry>;
  consultationMode: boolean;
  onRateDevice: (etiqueta: string, condicion: string, assetClass: string) => Promise<void>;
  onRateItem: (id: number, condicion: string, categoria: string) => Promise<void>;
  onUndo: (payload: ReviewUndoPayload) => Promise<void>;
  onExit: (rated: number) => void;
}) {
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [assetClasses, setAssetClasses] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [index, setIndex] = useState(0);
  const [rated, setRated] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [claseOverride, setClaseOverride] = useState('');
  const [last, setLast] = useState<LastRating | null>(null);
  const [undoing, setUndoing] = useState(false);
  const sectionRef = useRef<HTMLElement | null>(null);
  // La cola de recursos se arma una vez con la foto de cuando se abrió.
  const itemsAtOpen = useRef(items);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    getDeviceReviewQueue()
      .then(response => {
        if (cancelled) return;
        const equipos: QueueEntry[] = response.items.map(device => ({
          key: `d:${device.etiqueta}`,
          kind: 'equipo',
          etiqueta: device.etiqueta,
          titulo: device.alias || device.etiqueta,
          detalle: [device.marca, device.modelo].filter(Boolean).join(' · ') || 'Sin marca ni modelo cargados',
          clase: device.assetClass || device.categoria || 'Otro',
          claseGuardada: device.assetClassConfirmed ? device.assetClass : ''
        }));
        const recursos: QueueEntry[] = [...itemsAtOpen.current]
          .sort((a, b) => (a.condicion ? 1 : 0) - (b.condicion ? 1 : 0) || compareText(a.nombre, b.nombre))
          .map(item => ({
            key: `i:${item.id}`,
            kind: 'recurso',
            itemId: item.id,
            titulo: item.nombre,
            detalle: `${item.cantidad} / mín. ${item.minStock ?? 3} ${item.unidad || 'unidades'}`,
            clase: item.categoria || 'Otro',
            claseGuardada: item.categoria || 'Otro'
          }));
        setQueue([...equipos, ...recursos]);
        setAssetClasses(response.assetClasses || []);
        setLoading(false);
      })
      .catch(reason => {
        if (cancelled) return;
        setLoadError(errorText(reason, 'No se pudo cargar la cola de revisión.'));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => load(), [load]);
  useEffect(() => { sectionRef.current?.focus({ preventScroll: true }); }, []);

  const current = queue[index];
  const live = current ? entriesByKey.get(current.key) : undefined;
  useEffect(() => { setClaseOverride(''); setError(''); }, [current?.key]);

  const clase = claseOverride || live?.categoria || current?.clase || '';
  const total = queue.length;
  const done = !loading && !loadError && index >= total;

  const withCondition = useMemo(() => queue.filter(entry => entriesByKey.get(entry.key)?.condicion).length, [queue, entriesByKey]);

  const claseOptions = useMemo(() => {
    if (!current) return [];
    const base = current.kind === 'equipo'
      ? assetClasses
      : [...FORM_CATEGORIES, ...itemsAtOpen.current.map(item => item.categoria).filter(Boolean)];
    return [...new Set([...base, clase].filter(Boolean))].sort(compareText);
  }, [current, assetClasses, clase]);

  const skip = useCallback(() => {
    if (index >= total) return;
    setIndex(value => Math.min(value + 1, total));
  }, [index, total]);

  const exit = useCallback(() => onExit(rated), [onExit, rated]);

  const rate = useCallback(async (condicion: string) => {
    if (!current || saving || consultationMode) return;
    setSaving(true);
    setError('');
    const prev = entriesByKey.get(current.key);
    try {
      let undo: ReviewUndoPayload;
      if (current.kind === 'equipo' && current.etiqueta) {
        undo = { kind: 'equipo', etiqueta: current.etiqueta, condicion: prev?.condicion || '', reviewedAt: prev?.revisadoAt || '', assetClass: current.claseGuardada };
        await onRateDevice(current.etiqueta, condicion, clase || current.clase);
      } else {
        undo = { kind: 'recurso', id: current.itemId!, condicion: prev?.condicion || '', reviewedAt: prev?.revisadoAt || '', categoria: prev?.categoria || current.claseGuardada };
        await onRateItem(current.itemId!, condicion, clase || current.clase);
      }
      setLast({ index, key: current.key, titulo: current.titulo, condicion, undo });
      setRated(value => value + 1);
      setIndex(value => value + 1);
    } catch (reason) {
      setError(errorText(reason, 'No se pudo guardar. Probá de nuevo.'));
    } finally {
      setSaving(false);
    }
  }, [current, saving, consultationMode, entriesByKey, onRateDevice, onRateItem, clase, index]);

  const undoLast = useCallback(async () => {
    if (!last || undoing) return;
    setUndoing(true);
    setError('');
    try {
      await onUndo(last.undo);
      setIndex(last.index);
      setRated(value => Math.max(0, value - 1));
      setLast(null);
    } catch (reason) {
      setError(errorText(reason, 'No se pudo deshacer. Probá de nuevo.'));
    } finally {
      setUndoing(false);
    }
  }, [last, undoing, onUndo]);

  // Teclado: escucha en el documento (no hace falta tener el foco en el
  // recorrido), pero nunca con modificadores, ni escribiendo en un campo, ni
  // dentro de otro formulario o diálogo, ni si alguien ya atendió la tecla.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (isEditableTarget(target)) return;
      if (target?.closest?.('form, .modal, [role="dialog"]')) return;
      if (event.key === 'Escape') { event.preventDefault(); exit(); return; }
      if (loading || !current) return;
      const position = ['1', '2', '3', '4'].indexOf(event.key);
      if (position >= 0) { event.preventDefault(); void rate(CONDITION_VALUES[position]); return; }
      if (event.key === 's' || event.key === 'S') { event.preventDefault(); skip(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [loading, current, rate, skip, exit]);

  const next = queue.slice(index + 1, index + 5).map(entry => entry.titulo);
  const remaining = total - index - 1;

  return (
    <section ref={sectionRef} className="ivt-panel ivt-review" tabIndex={-1} aria-label="Recorrido de revisión de condición" data-scanner-ignore="">
      <div className="ivt-review-head">
        <Eyebrow className="ivt-grow">Recorrido de revisión</Eyebrow>
        {!loading && !loadError && total > 0 && (
          <span className="ivt-review-progress">
            <Ring value={withCondition} total={total} size={32} unit="con condición cargada" />
            <span className="ivt-review-pos">
              <Tx tone="strong" mono>{done ? `${total} de ${total}` : `${index + 1} de ${total}`}</Tx>
              <Tx tone="muted">{withCondition} con condición cargada</Tx>
            </span>
          </span>
        )}
        <Button variant="ghost" onClick={exit} iconEnd={<Kbd>Esc</Kbd>}>Salir</Button>
      </div>

      {loading && <SkeletonText lines={3} />}
      {loadError && <ErrorState message={loadError} onRetry={() => load()} />}

      {!loading && !loadError && current && (
        <>
          <div className="ivt-review-subject">
            <Tx tone="normal">{current.kind === 'equipo' ? `Equipo · ${current.etiqueta}` : `Recurso · ${live?.categoria || current.clase}`}</Tx>
            <TruncatedText as="strong" className="ivt-review-name">{current.titulo}</TruncatedText>
            <Tx tone="normal" mono className="ivt-ell">{current.detalle}</Tx>
            <Tx tone="muted">{live?.condicion ? `Última revisión: ${reviewLabel(live).replace(/^Revisado /, '')} (${live.condicion})` : 'Nunca revisado'}</Tx>
          </div>

          <div className="ivt-field">
            <span className="ivt-label">{current.kind === 'equipo' ? 'Clase de activo' : 'Categoría'} <Tx tone="muted">· se guarda junto con la condición</Tx></span>
            <ChipGroup label={current.kind === 'equipo' ? 'Clase de activo' : 'Categoría'}>
              {claseOptions.map(option => (
                <Chip key={option} pressed={option === clase} disabled={consultationMode} onClick={() => setClaseOverride(option)}>{option}</Chip>
              ))}
            </ChipGroup>
          </div>

          <div className="ivt-rate" role="group" aria-label="Calificar condición">
            {CONDITION_VALUES.map((condicion, position) => (
              <button
                key={condicion}
                type="button"
                className={`ivt-rate-btn is-${condicion === 'Regular' ? 'warn' : condicion === 'Malo' ? 'bad' : 'normal'}`}
                disabled={saving || consultationMode}
                onClick={() => void rate(condicion)}
              >
                <span className="ivt-ell">{condicion}</span>
                <Kbd>{String(position + 1)}</Kbd>
              </button>
            ))}
            <button type="button" className="ivt-rate-btn is-skip" disabled={saving} onClick={skip}>
              <span className="ivt-ell">Saltar</span>
              <Kbd>S</Kbd>
            </button>
          </div>

          {error && <div className="ivt-error" role="alert">{error}</div>}

          <div className="ivt-review-foot">
            {last && (
              <span className="ivt-review-last" role="status">
                <span>{last.titulo} quedó {last.condicion}.</span>
                <Button size="sm" variant="ghost" loading={undoing} onClick={() => void undoLast()}>Deshacer</Button>
              </span>
            )}
            {next.length > 0 && <TruncatedText className="ivt-review-next">{`Siguen: ${next.join(' · ')}${remaining > next.length ? ' …' : ''}`}</TruncatedText>}
            <span className="ivt-help ivt-review-keys">1–4 califican · S salta · Esc sale (no actúan mientras escribís)</span>
          </div>
        </>
      )}

      {done && (
        <div className="ivt-review-done">
          <div className="ivt-grow">
            <strong className="ivt-review-title">{total ? 'Recorrido terminado' : 'No hay nada para revisar en esta sede.'}</strong>
            {total > 0 && <p className="ivt-help ivt-para"><Tx tone="strong" mono>{rated}</Tx> {rated === 1 ? 'ítem calificado' : 'ítems calificados'} en esta pasada. La lista de abajo ya muestra las condiciones nuevas.</p>}
            {last && (
              <span className="ivt-review-last" role="status">
                <span>{last.titulo} quedó {last.condicion}.</span>
                <Button size="sm" variant="ghost" loading={undoing} onClick={() => void undoLast()}>Deshacer</Button>
              </span>
            )}
          </div>
          <Button variant="primary" onClick={exit}>Cerrar</Button>
        </div>
      )}
    </section>
  );
}
