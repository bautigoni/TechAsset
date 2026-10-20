import { CalendarClock } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, EmptyState, ErrorState, NumberField, SkeletonRows } from '../../ui';
import { IconCheck } from '../../ui/icons';
import { cx } from '../../ui/util';
import { getLifecycleDefaults, updateLifecycleDefault, type LifecycleDefault } from '../../services/devicesApi';
import { Card, CardFoot, Notice, Reveal, dropDraft, errorText, peekDraft, useDirty, useKeepDraft } from './settingsKit';

type RowState = { tone: 'ok' | 'bad'; text: string };

/**
 * Vida útil esperada por clase de activo. Cadena de prioridad: equipo → esta
 * sede → valor del sistema. Vacío (o 0) vuelve al del sistema. El server pide
 * permiso de edición de Dispositivos.
 */
export function LifecyclePanel({ header, readOnly, siteCode }: { header: (actions?: ReactNode) => ReactNode; readOnly: boolean; siteCode: string }) {
  // Lo tipeado y sin guardar sobrevive a salir por el menú (como en las otras secciones).
  const draftKey = `${siteCode}:vida-util`;
  const [restored] = useState(() => peekDraft<Record<string, number | null>>(draftKey));
  const [rows, setRows] = useState<LifecycleDefault[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, number | null>>({});
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState('');
  const [rowState, setRowState] = useState<Record<string, RowState>>({});

  const apply = (items: LifecycleDefault[]) => {
    setRows(items);
    const fromServer = Object.fromEntries(items.map(item => [item.assetClass, item.origen === 'sede' ? item.meses : null]));
    setDrafts(current => ({ ...fromServer, ...(restored || {}), ...current }));
  };
  const load = () => {
    setLoadError('');
    return getLifecycleDefaults().then(response => apply(response.items)).catch(reason => setLoadError(errorText(reason, 'No se pudo cargar la vida útil.')));
  };
  useEffect(() => { void load(); }, []);

  const savedValue = (row: LifecycleDefault) => (row.origen === 'sede' ? row.meses : null);
  const dirtyClasses = (rows || []).filter(row => (drafts[row.assetClass] ?? null) !== savedValue(row));
  useDirty('vida-util', dirtyClasses.length > 0);
  useKeepDraft(draftKey, Object.fromEntries(dirtyClasses.map(row => [row.assetClass, drafts[row.assetClass] ?? null])), dirtyClasses.length > 0);
  const discardAll = () => { dropDraft(draftKey); setDrafts(Object.fromEntries((rows || []).map(row => [row.assetClass, savedValue(row)]))); };

  const save = async (row: LifecycleDefault) => {
    setBusy(row.assetClass);
    setRowState(current => { const next = { ...current }; delete next[row.assetClass]; return next; });
    const value = drafts[row.assetClass];
    try {
      await updateLifecycleDefault({ assetClass: row.assetClass, meses: value && value > 0 ? value : 0 });
      const response = await getLifecycleDefaults();
      // Se pisa solo la fila guardada: lo que estés tipeando en otras no se pierde.
      const fresh = response.items.find(item => item.assetClass === row.assetClass);
      setRows(response.items);
      if (fresh) setDrafts(current => ({ ...current, [row.assetClass]: fresh.origen === 'sede' ? fresh.meses : null }));
      setRowState(current => ({ ...current, [row.assetClass]: { tone: 'ok', text: value && value > 0 ? 'Guardado para esta sede.' : 'Volvió al valor del sistema.' } }));
    } catch (reason) {
      setRowState(current => ({ ...current, [row.assetClass]: { tone: 'bad', text: errorText(reason, 'No se pudo guardar.') } }));
    } finally {
      setBusy('');
    }
  };

  if (loadError && !rows) return <>{header()}<ErrorState message={loadError} onRetry={() => void load()} /></>;

  return (
    <>
      {header()}
      <Card ariaLabel="Vida útil por clase">
        {restored && dirtyClasses.length > 0 && <Notice tone="warn">Recuperamos cambios que no habías guardado.</Notice>}
        {!rows ? <div className="cfg-pad"><SkeletonRows rows={6} /></div> : !rows.length ? (
          <div className="cfg-pad"><EmptyState compact icon={<CalendarClock size={18} aria-hidden="true" />} title="No hay clases de activo cargadas." description="Aparecen cuando el inventario tiene equipos con clase." /></div>
        ) : (
          <div className="cfg-table cfg-tv" role="table" aria-label="Vida útil por clase de activo">
            <div className="cfg-trow is-head" role="row">
              <span role="columnheader">Clase</span><span role="columnheader">Meses en esta sede</span><span role="columnheader" className="cfg-tv-or">Origen</span><span role="columnheader" className="ui-sr">Guardar</span>
            </div>
            {rows.map(row => {
              const value = drafts[row.assetClass] ?? null;
              const changed = value !== savedValue(row);
              const state = rowState[row.assetClass];
              return (
                <div className="cfg-tgroup" key={row.assetClass}>
                  <div className="cfg-trow" role="row">
                    <span role="cell" className="cfg-strong cfg-wrap">{row.assetClass}</span>
                    <span role="cell">
                      <NumberField
                        ariaLabel={`Vida útil de ${row.assetClass} en meses`}
                        value={value}
                        min={0}
                        max={600}
                        unit="meses"
                        placeholder={String(row.origen === 'sede' ? '' : row.meses)}
                        disabled={readOnly}
                        onChange={next => { setDrafts(current => ({ ...current, [row.assetClass]: next === 0 ? null : next })); setRowState(current => { const copy = { ...current }; delete copy[row.assetClass]; return copy; }); }}
                      />
                    </span>
                    <span role="cell" className="cfg-tv-or cfg-t2 cfg-wrap">
                      <span className="cfg-mono">{row.meses}</span> meses · {row.origen === 'sede' ? 'esta sede' : 'por defecto'}
                    </span>
                    <span role="cell" className="cfg-cell-end">
                      <Button size="sm" variant={changed ? 'primary' : 'ghost'} loading={busy === row.assetClass} loadingLabel="Guardando…" disabled={readOnly || !changed || Boolean(busy)} onClick={() => void save(row)}>Guardar</Button>
                    </span>
                  </div>
                  <Reveal when={state}>
                    {state && (
                      <p className={cx('cfg-rowmsg', state.tone === 'bad' ? 'is-bad' : 'cfg-t2')} role={state.tone === 'bad' ? 'alert' : 'status'}>
                        {state.tone === 'ok' && <IconCheck size={14} />} {row.assetClass}: {state.text}
                      </p>
                    )}
                  </Reveal>
                </div>
              );
            })}
          </div>
        )}
        <CardFoot status="Dejalo vacío para usar el valor por defecto del sistema. Un equipo puntual puede tener su propio valor desde su ficha. Prioridad: equipo, sede, sistema." tone="muted">
          <Button variant="ghost" disabled={!dirtyClasses.length || Boolean(busy) || readOnly} onClick={discardAll}>Descartar</Button>
        </CardFoot>
      </Card>
    </>
  );
}
