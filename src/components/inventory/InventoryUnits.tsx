import { useEffect, useState } from 'react';
import type { InventoryItem, InventoryUnit } from '../../types';
import { CONDITION_VALUES } from '../../types';
import { createInventoryUnit, deleteInventoryUnit, getInventoryUnits, updateInventoryUnit } from '../../services/inventoryApi';
import { Button } from '../layout/Button';
import { SelectField } from '../layout/SelectField';
import { SkeletonLine, SkeletonPanel } from '../layout/Skeleton';
import { conditionClass } from './inventoryEntries';

const CONDITION_OPTIONS = [{ value: '', label: 'Sin revisar' }, ...CONDITION_VALUES.map(value => ({ value, label: value }))];
// Tope de seguridad para el alta en lote: nadie va a cargar 500 unidades de una.
const BULK_LIMIT = 60;

type Draft = Pick<InventoryUnit, 'numero' | 'descripcion' | 'sn' | 'mac' | 'teamviewerId' | 'condicion'>;

const EMPTY_DRAFT: Draft = { numero: '', descripcion: '', sn: '', mac: '', teamviewerId: '', condicion: '' };

// Detalle unidad por unidad de un recurso. Sin esto, la única forma de anotar
// que uno de los 8 dash no carga era duplicar la ficha entera ("dash roto").
export function InventoryUnits({ item, consultationMode, onItemChange }: {
  item: InventoryItem;
  consultationMode: boolean;
  onItemChange?: (item: InventoryItem) => void;
}) {
  const [units, setUnits] = useState<InventoryUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEditing(null);
    getInventoryUnits(item.id)
      .then(response => { if (!cancelled) setUnits(response.units); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudieron cargar las unidades.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [item.id]);

  const apply = (response: { units: InventoryUnit[]; item?: InventoryItem | null }) => {
    setUnits(response.units);
    if (response.item) onItemChange?.(response.item);
  };

  const run = async (action: () => Promise<{ units: InventoryUnit[]; item?: InventoryItem | null }>) => {
    setBusy(true);
    setError('');
    try {
      apply(await action());
      setEditing(null);
      setDraft(EMPTY_DRAFT);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la unidad.');
    } finally {
      setBusy(false);
    }
  };

  // Alta en lote: un recurso que dice "8 unidades" arranca con esas 8 fichas
  // numeradas, en vez de obligar a crearlas de a una.
  const seed = async () => {
    const cantidad = Math.min(Number(item.cantidad || 0), BULK_LIMIT);
    if (cantidad < 1) return;
    setBusy(true);
    setError('');
    try {
      let last: { units: InventoryUnit[]; item?: InventoryItem | null } | null = null;
      for (let i = 0; i < cantidad; i += 1) last = await createInventoryUnit(item.id, {});
      if (last) apply(last);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron crear las unidades.');
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (unit: InventoryUnit) => {
    setEditing(unit.id);
    setDraft({
      numero: unit.numero,
      descripcion: unit.descripcion,
      sn: unit.sn,
      mac: unit.mac,
      teamviewerId: unit.teamviewerId,
      condicion: unit.condicion
    });
  };

  const conFalla = units.filter(unit => unit.condicion === 'Regular' || unit.condicion === 'Malo').length;

  return (
    <section className="inv-units">
      <header className="inv-units-head">
        <div>
          <strong>Unidades</strong>
          {loading
            ? <SkeletonLine width={150} height={11} />
            : <span>
                {units.length
                  ? `${units.length} ${units.length === 1 ? 'unidad cargada' : 'unidades cargadas'}${conFalla ? ` · ${conFalla} con falla` : ''}`
                  : 'Todavía no se detalló ninguna unidad'}
              </span>}
        </div>
        {!consultationMode && !loading && (
          <div className="inv-units-head-actions">
            {!units.length && Number(item.cantidad || 0) > 1 && (
              <Button type="button" disabled={busy} onClick={() => void seed()}>
                Crear las {Math.min(Number(item.cantidad || 0), BULK_LIMIT)}
              </Button>
            )}
            <Button type="button" disabled={busy} onClick={() => { setEditing('new'); setDraft(EMPTY_DRAFT); }}>Agregar unidad</Button>
          </div>
        )}
      </header>

      {loading && <SkeletonPanel rows={2} head={false} rowHeight={44} />}

      {!loading && !units.length && editing !== 'new' && (
        <p className="muted inv-units-empty">
          Detallar unidades sirve para anotar cuál de todas falla, su número de serie o su ID de TeamViewer,
          sin tener que duplicar la ficha del recurso.
        </p>
      )}

      {units.length > 0 && (
        <ul className="inv-units-list">
          {units.map(unit => (
            <li key={unit.id} className={editing === unit.id ? 'is-editing' : ''}>
              <div className="inv-unit-row">
                <span className="inv-unit-number">#{unit.numero || '—'}</span>
                <span className={`condition-dot ${conditionClass(unit.condicion)}`}>{unit.condicion || 'Sin revisar'}</span>
                <span className="inv-unit-desc">{unit.descripcion || <em>Sin observaciones</em>}</span>
                <span className="inv-unit-ids">
                  <i>SN {unit.sn || '—'}</i>
                  <i>MAC {unit.mac || '—'}</i>
                  <i>TeamViewer {unit.teamviewerId || '—'}</i>
                </span>
                {!consultationMode && (
                  <button type="button" className="inv-unit-edit" disabled={busy} onClick={() => (editing === unit.id ? setEditing(null) : startEdit(unit))}>
                    {editing === unit.id ? 'Cerrar' : 'Editar'}
                  </button>
                )}
              </div>

              {editing === unit.id && (
                <UnitForm
                  draft={draft}
                  busy={busy}
                  onChange={setDraft}
                  onSubmit={() => void run(() => updateInventoryUnit(unit.id, draft))}
                  onCancel={() => setEditing(null)}
                  onDelete={() => {
                    if (!window.confirm(`¿Quitar la unidad #${unit.numero || unit.id}?`)) return;
                    void run(() => deleteInventoryUnit(unit.id));
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {editing === 'new' && (
        <UnitForm
          draft={draft}
          busy={busy}
          onChange={setDraft}
          onSubmit={() => void run(() => createInventoryUnit(item.id, draft))}
          onCancel={() => { setEditing(null); setDraft(EMPTY_DRAFT); }}
        />
      )}

      {error && <div className="tool-error">{error}</div>}
    </section>
  );
}

function UnitForm({ draft, busy, onChange, onSubmit, onCancel, onDelete }: {
  draft: Draft;
  busy: boolean;
  onChange: (draft: Draft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });

  return (
    <form
      className="inv-unit-form"
      onSubmit={event => { event.preventDefault(); onSubmit(); }}
    >
      <div className="inv-unit-form-grid">
        <label>Número
          <input className="input" value={draft.numero} placeholder="Automático" onChange={event => set({ numero: event.target.value })} />
        </label>
        <label>Condición
          <SelectField value={draft.condicion} options={CONDITION_OPTIONS} onChange={condicion => set({ condicion })} ariaLabel="Condición de la unidad" />
        </label>
        <label className="inv-unit-form-wide">Descripción
          <input className="input" value={draft.descripcion} placeholder="Ej: no carga" onChange={event => set({ descripcion: event.target.value })} />
        </label>
        <label>Número de serie
          <input className="input" value={draft.sn} placeholder="Opcional" onChange={event => set({ sn: event.target.value })} />
        </label>
        <label>MAC
          <input className="input" value={draft.mac} placeholder="Opcional" onChange={event => set({ mac: event.target.value })} />
        </label>
        <label>TeamViewer ID
          {/* Opcional a propósito: en Chrome OS no aplica. */}
          <input className="input" value={draft.teamviewerId} placeholder="No aplica en Chrome OS" onChange={event => set({ teamviewerId: event.target.value })} />
        </label>
      </div>
      <div className="actions">
        {onDelete && <Button type="button" variant="danger" disabled={busy} onClick={onDelete}>Quitar</Button>}
        <Button type="button" disabled={busy} onClick={onCancel}>Cancelar</Button>
        <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar unidad'}</Button>
      </div>
    </form>
  );
}
