import { useEffect, useState, type ReactNode } from 'react';
import { Button, ErrorState, Input, SkeletonRows } from '../../ui';
import { fetchShiftSettings, updateShiftSettings } from '../../services/operationsApi';
import { Card, CardBody, CardFoot, Notice, dropDraft, errorText, peekDraft, useDirty, useKeepDraft } from './settingsKit';

type Shifts = { morningOperator: string; afternoonOperator: string };
type Status = { tone: 'ok' | 'bad'; text: string } | null;

/**
 * Turnos TIC: quién está a la mañana y quién a la tarde. Lo usa "Mis tareas
 * del turno". En el server solo pide algún permiso de edición (no admin).
 */
export function ShiftsPanel({ header, readOnly, siteCode }: { header: (actions?: ReactNode) => ReactNode; readOnly: boolean; siteCode: string }) {
  const draftKey = `${siteCode}:turnos`;
  const [restored, setRestored] = useState(() => peekDraft<Shifts>(draftKey));
  const [server, setServer] = useState<Shifts | null>(null);
  const [draft, setDraft] = useState<Shifts>(() => restored || { morningOperator: '', afternoonOperator: '' });
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const load = () => {
    setLoadError('');
    fetchShiftSettings()
      .then(response => {
        setServer(response.settings);
        if (!restored) setDraft(response.settings);
      })
      .catch(reason => setLoadError(errorText(reason, 'No se pudieron cargar los turnos.')));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  const changed = Boolean(server) && (draft.morningOperator !== server!.morningOperator || draft.afternoonOperator !== server!.afternoonOperator);
  const dirty = Boolean(restored) || changed;
  useDirty('turnos', dirty && changed);
  useKeepDraft(draftKey, draft, changed);

  const save = async () => {
    setSaving(true);
    setStatus(null);
    const clean = { morningOperator: draft.morningOperator.trim(), afternoonOperator: draft.afternoonOperator.trim() };
    try {
      await updateShiftSettings(clean);
      setServer(clean);
      setDraft(clean);
      setRestored(null);
      dropDraft(draftKey);
      setStatus({ tone: 'ok', text: 'Turnos guardados.' });
    } catch (reason) {
      setStatus({ tone: 'bad', text: errorText(reason, 'No se pudieron guardar los turnos.') });
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    if (server) setDraft(server);
    setRestored(null);
    dropDraft(draftKey);
    setStatus(null);
  };

  if (loadError && !server) return <>{header()}<ErrorState message={loadError} onRetry={load} /></>;

  return (
    <>
      {header()}
      <Card ariaLabel="Turnos TIC">
        {restored && changed && <Notice tone="warn">Recuperamos cambios que no habías guardado.</Notice>}
        <CardBody>
          {!server ? <SkeletonRows rows={2} /> : (
            <div className="cfg-grid" data-scanner-ignore="" onKeyDown={event => { if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT' && !readOnly && changed && !saving) { event.preventDefault(); void save(); } }}>
              <Input label="Turno mañana" value={draft.morningOperator} disabled={readOnly} autoComplete="off" onValueChange={value => { setDraft(current => ({ ...current, morningOperator: value })); setStatus(null); }} />
              <Input label="Turno tarde" value={draft.afternoonOperator} disabled={readOnly} autoComplete="off" onValueChange={value => { setDraft(current => ({ ...current, afternoonOperator: value })); setStatus(null); }} />
            </div>
          )}
          <p className="cfg-hint">Escribí el nombre tal como entra cada uno a TechAsset: así "Mis tareas del turno" le muestra las suyas.</p>
        </CardBody>
        <CardFoot
          status={status?.text || (readOnly ? 'Modo consulta: no se puede guardar.' : changed ? 'Hay cambios sin guardar.' : '')}
          tone={status ? status.tone : changed ? 'warn' : readOnly ? 'muted' : undefined}
        >
          {changed && <Button variant="ghost" disabled={saving} onClick={discard}>Descartar</Button>}
          <Button variant="primary" loading={saving} loadingLabel="Guardando…" disabled={readOnly || !changed} onClick={() => void save()}>Guardar turnos</Button>
        </CardFoot>
      </Card>
    </>
  );
}
