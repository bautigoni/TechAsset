import { Fragment, useEffect, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { InventoryItem, InventoryUnit } from '../../types';
import { createInventoryUnit, createInventoryUnitsBatch, deleteInventoryUnit, getInventoryUnits, updateInventoryUnit } from '../../services/inventoryApi';
import { Button, Collapse, InlineConfirm, Input, SkeletonRows, useHeldKeys, useStatusLine } from '../../ui';
import { conditionTone } from './inventoryEntries';
import { ConditionChips, errorText, Tx } from './inventoryParts';

// Tope del alta en lote ("Crear las N"): el server aplica el mismo.
export const UNITS_BATCH_LIMIT = 60;

type Draft = Pick<InventoryUnit, 'numero' | 'descripcion' | 'sn' | 'mac' | 'teamviewerId' | 'condicion'>;
const EMPTY_DRAFT: Draft = { numero: '', descripcion: '', sn: '', mac: '', teamviewerId: '', condicion: '' };
type UnitsResponse = { units: InventoryUnit[]; item?: InventoryItem | null };

/**
 * Detalle unidad por unidad de un recurso (número, condición, descripción,
 * SN, MAC, TeamViewer) sin duplicar la ficha. El formulario se abre en línea
 * debajo de la unidad que se edita (o al final, para una nueva).
 */
export function InventoryUnits({ item, consultationMode, onItemChange }: {
  item: InventoryItem;
  consultationMode: boolean;
  onItemChange?: (item: InventoryItem) => void;
}) {
  const [units, setUnits] = useState<InventoryUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [asking, setAsking] = useState(false);
  const status = useStatusLine();

  const load = () => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    getInventoryUnits(item.id)
      .then(response => { if (!cancelled) setUnits(response.units); })
      .catch(reason => { if (!cancelled) setLoadError(errorText(reason, 'No se pudieron cargar las unidades.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  };

  useEffect(() => {
    setEditing(null);
    return load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const apply = (response: UnitsResponse) => {
    setUnits(response.units);
    if (response.item) onItemChange?.(response.item);
  };

  const run = async (action: () => Promise<UnitsResponse>, done: string) => {
    setBusy(true);
    status.clear();
    try {
      apply(await action());
      setEditing(null);
      setAsking(false);
      setDraft(EMPTY_DRAFT);
      status.show({ tone: 'ok', message: done });
    } catch (reason) {
      status.show({ tone: 'bad', message: errorText(reason, 'No se pudo guardar la unidad.') });
    } finally {
      setBusy(false);
    }
  };

  const cantidad = Math.min(Number(item.cantidad || 0), UNITS_BATCH_LIMIT);

  // Alta en lote: un recurso que dice "8 unidades" arranca con esas 8 fichas
  // numeradas. Un solo request (antes eran N en serie).
  const seed = () => run(
    () => createInventoryUnitsBatch(item.id, cantidad),
    `${cantidad} unidades creadas, numeradas del 1 al ${cantidad}.`
  );

  const startEdit = (unit: InventoryUnit) => {
    setAsking(false);
    setEditing(unit.id);
    setDraft({ numero: unit.numero, descripcion: unit.descripcion, sn: unit.sn, mac: unit.mac, teamviewerId: unit.teamviewerId, condicion: unit.condicion });
  };

  const conFalla = units.filter(unit => unit.condicion === 'Regular' || unit.condicion === 'Malo').length;
  const editingUnit = typeof editing === 'number' ? units.find(unit => unit.id === editing) : undefined;
  // El formulario que se cierra sigue dibujado hasta terminar de plegarse.
  const held = useHeldKeys(editing === null ? null : String(editing));

  const form = (
    <UnitForm
      draft={draft}
      busy={busy}
      isEdit={Boolean(editingUnit)}
      onChange={setDraft}
      onSubmit={() => {
        if (editingUnit) void run(() => updateInventoryUnit(editingUnit.id, draft), `Unidad #${draft.numero || editingUnit.numero} guardada.`);
        else void run(() => createInventoryUnit(item.id, draft), draft.numero ? `Unidad #${draft.numero} agregada.` : 'Unidad agregada.');
      }}
      onCancel={() => { setEditing(null); setAsking(false); setDraft(EMPTY_DRAFT); }}
      confirm={editingUnit && asking ? (
        <InlineConfirm
          danger
          message={`¿Quitar la unidad #${editingUnit.numero || editingUnit.id}?`}
          detail="El recurso y sus otras unidades no cambian."
          confirmLabel="Quitar"
          busy={busy}
          onConfirm={() => void run(() => deleteInventoryUnit(editingUnit.id), `Unidad #${editingUnit.numero || editingUnit.id} quitada.`)}
          onCancel={() => setAsking(false)}
        />
      ) : null}
      onAskDelete={editingUnit ? () => setAsking(true) : undefined}
    />
  );

  return (
    <section className="ivt-sec" aria-label="Unidades">
      <div className="ivt-sec-head">
        <h3>Unidades</h3>
        <span className="ivt-sec-summary">
          {loading ? 'Cargando…' : units.length
            ? <>{units.length} {units.length === 1 ? 'unidad cargada' : 'unidades cargadas'}{conFalla > 0 && <Tx tone="warn"> · {conFalla} con falla</Tx>}</>
            : 'Todavía no se detalló ninguna unidad'}
        </span>
        {!consultationMode && !loading && (
          <span className="ivt-sec-actions">
            {!units.length && cantidad > 1 && (
              <Button size="sm" loading={busy && editing === null} onClick={() => void seed()}>Crear las {cantidad}</Button>
            )}
            <Button size="sm" disabled={busy} onClick={() => { setAsking(false); setEditing('new'); setDraft(EMPTY_DRAFT); }}>Agregar unidad</Button>
          </span>
        )}
      </div>

      {loading && <SkeletonRows rows={2} />}
      {loadError && <div className="ivt-error" role="alert">{loadError} <Button size="sm" variant="ghost" onClick={() => load()}>Reintentar</Button></div>}

      {!loading && !units.length && editing !== 'new' && (
        <p className="ivt-help ivt-para">
          Detallá cada unidad solo si necesitás seguir su número, una falla puntual, SN, MAC o TeamViewer. El recurso sigue siendo uno solo; “Con falla” cuenta las unidades en Regular o Malo.
        </p>
      )}

      {units.length > 0 && (
        <ul className="ivt-units">
          {units.map(unit => (
            <Fragment key={unit.id}>
              <li className="ivt-unit">
                <span className="ivt-unit-num ivt-mono">#{unit.numero || '—'}</span>
                <Tx tone={conditionTone(unit.condicion)} className="ivt-unit-cond">{unit.condicion || 'Sin revisar'}</Tx>
                <Tx tone={unit.descripcion ? 'strong' : 'muted'} className="ivt-unit-desc">{unit.descripcion || 'Sin observaciones'}</Tx>
                <span className="ivt-unit-ids ivt-mono">SN {unit.sn || '—'} · MAC {unit.mac || '—'} · TeamViewer {unit.teamviewerId || '—'}</span>
                {!consultationMode && (
                  <Button size="sm" variant="ghost" aria-expanded={editing === unit.id} disabled={busy} onClick={() => (editing === unit.id ? setEditing(null) : startEdit(unit))}>
                    {editing === unit.id ? 'Cerrar' : 'Editar'}
                  </Button>
                )}
              </li>
              {held.drawn(String(unit.id)) && (
                <li className="ivt-unit-formrow">
                  <Collapse open={editing === unit.id} appear unmountOnClose className="ivt-unit-formbody" onSettled={open => { if (!open) held.release(String(unit.id)); }}>{form}</Collapse>
                </li>
              )}
            </Fragment>
          ))}
        </ul>
      )}

      {held.drawn('new') && (
        <Collapse open={editing === 'new'} appear unmountOnClose onSettled={open => { if (!open) held.release('new'); }}>{form}</Collapse>
      )}
      {status.element}
    </section>
  );
}

function UnitForm({ draft, busy, isEdit, onChange, onSubmit, onCancel, onAskDelete, confirm }: {
  draft: Draft;
  busy: boolean;
  isEdit: boolean;
  onChange: (draft: Draft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onAskDelete?: () => void;
  confirm: ReactNode;
}) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const submit = (event: FormEvent) => { event.preventDefault(); if (!busy) onSubmit(); };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); }
  };
  return (
    <form className="ivt-unit-form" onSubmit={submit} onKeyDown={onKeyDown} data-scanner-ignore="" aria-label={isEdit ? 'Editar unidad' : 'Nueva unidad'} noValidate>
      <div className="ivt-form-grid">
        <Input label="Número" inputMode="numeric" autoComplete="off" className="ivt-mono-field" value={draft.numero} placeholder="Automático" onValueChange={numero => set({ numero })} autoFocus />
        <Input label="Descripción" autoComplete="off" value={draft.descripcion} placeholder="Ej: no carga" onValueChange={descripcion => set({ descripcion })} />
        <Input label="SN" autoComplete="off" className="ivt-mono-field" value={draft.sn} placeholder="Opcional" onValueChange={sn => set({ sn })} />
        <Input label="MAC" autoComplete="off" className="ivt-mono-field" value={draft.mac} placeholder="Opcional" onValueChange={mac => set({ mac })} />
        <Input label="TeamViewer" autoComplete="off" className="ivt-mono-field" value={draft.teamviewerId} placeholder="No aplica en Chrome OS" onValueChange={teamviewerId => set({ teamviewerId })} />
        <div className="ivt-field ivt-full">
          <span className="ivt-label">Condición</span>
          <ConditionChips label="Condición de la unidad" value={draft.condicion} onChange={condicion => set({ condicion })} />
        </div>
      </div>
      <div className="ivt-actions">
        <Button type="submit" size="sm" variant="primary" loading={busy} loadingLabel="Guardando…">Guardar unidad</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>Cancelar</Button>
        {isEdit && onAskDelete && !confirm && (
          <Button size="sm" variant="ghost" className="ivt-danger-text ivt-push" disabled={busy} onClick={onAskDelete}>Quitar unidad</Button>
        )}
      </div>
      <Collapse open={Boolean(confirm)} unmountOnClose>{confirm}</Collapse>
    </form>
  );
}
