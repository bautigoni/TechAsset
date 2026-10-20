import { useEffect, useMemo, useRef, useState } from 'react';
import { Coffee, X } from 'lucide-react';
import type { RecessGroup, RecessSlot } from '../../types';
import { saveRecessSchedules } from '../../services/schedulesApi';
import { getActiveSiteCode } from '../../services/activeSite';
import { Button, Collapse, EmptyState, IconButton, InlineConfirm, Input, StatusText, TimeField, cx, icons, preloadPickers } from '../../ui';
import { keepScheduleDraft, peekScheduleDraft, slotValid, toMin, type SchoolClock } from './scheduleModel';
import { MotionList } from '../../utils/motion';

type DraftSlot = RecessSlot & { key: string };
type DraftGroup = Omit<RecessGroup, 'slots'> & { key: string; slots: DraftSlot[] };

let seq = 0;
const newKey = () => `r${Date.now().toString(36)}${(seq += 1)}`;
// Claves estables: lo guardado se identifica por posición (o por la clave que tenía en el borrador recién guardado),
// así guardar o recargar no hace "salir y entrar" a todas las franjas.
const withKeys = (groups: RecessGroup[], carry?: DraftGroup[] | null): DraftGroup[] => groups.map((group, gi) => {
  const key = carry?.[gi]?.key || `g${gi}`;
  return { ...group, key, slots: group.slots.map((slot, si) => ({ ...slot, key: carry?.[gi]?.slots[si]?.key || `${key}-s${si}` })) };
});
const strip = (groups: DraftGroup[]): RecessGroup[] => groups.map(group => ({
  ...(group.id !== undefined ? { id: group.id } : {}),
  name: group.name,
  slots: group.slots.map(slot => ({ label: slot.label, startTime: slot.startTime, endTime: slot.endTime }))
}));
const signature = (groups: RecessGroup[]) => JSON.stringify(groups.map(group => [group.name.trim(), group.slots.map(slot => [slot.label.trim(), slot.startTime, slot.endTime])]));
const errorText = (err: unknown) => (err instanceof Error && err.message ? err.message : 'No se pudieron guardar los recreos.');

/**
 * Franjas de recreo por grupo. Se editan en memoria y se guardan todas juntas
 * (PUT reemplaza todo). Un refresh de la pantalla ya no pisa lo que se está
 * editando, las franjas inválidas se marcan (no se descartan en silencio) y
 * el estado "Cambios sin guardar" queda a la vista.
 */
export function RecessPanel({ groups, canConfigure, consultation, clock, onSaved, onDirtyChange }: {
  groups: RecessGroup[];
  canConfigure: boolean;
  consultation: boolean;
  clock: SchoolClock;
  onSaved: () => Promise<unknown>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const carry = useRef<DraftGroup[] | null>(null);
  const saved = useMemo(() => { const list = withKeys(groups, carry.current); carry.current = null; return list; }, [groups]);
  const site = getActiveSiteCode();
  // Borrador que quedó de una visita anterior (se salió por el menú sin guardar).
  const [draft, setDraft] = useState<DraftGroup[] | null>(() => peekScheduleDraft<DraftGroup[]>('recess', site));
  const [restored, setRestored] = useState(() => Boolean(peekScheduleDraft('recess', site)));
  const [askDelete, setAskDelete] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const editable = canConfigure && !consultation;
  const view = draft ?? saved;
  const dirty = draft !== null && signature(strip(draft)) !== signature(groups);
  const noName = view.some(group => !group.name.trim());
  const bad = view.some(group => group.slots.some(slot => !slotValid(slot)));

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  // Con cambios sin guardar, el borrador se guarda (memoria + sessionStorage) para recuperarlo al volver.
  useEffect(() => { keepScheduleDraft('recess', site, dirty ? draft : null); }, [draft, dirty, site]);
  useEffect(() => { if (!dirty) setRestored(false); }, [dirty]);
  // Cerrar la pestaña con cambios sin guardar pide confirmación del navegador.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => { if (editable) void preloadPickers(); }, [editable]);

  const edit = (fn: (current: DraftGroup[]) => DraftGroup[]) => {
    setDraft(current => fn(current ?? saved));
    setMessage(null);
  };
  const setGroup = (key: string, patch: Partial<DraftGroup>) => edit(list => list.map(group => (group.key === key ? { ...group, ...patch } : group)));
  const setSlot = (groupKey: string, slotKey: string, patch: Partial<DraftSlot>) => edit(list => list.map(group => (group.key !== groupKey ? group : { ...group, slots: group.slots.map(slot => (slot.key === slotKey ? { ...slot, ...patch } : slot)) })));

  const save = async () => {
    if (noName) { setMessage({ tone: 'bad', text: 'No se guardó: todos los grupos necesitan un nombre.' }); return; }
    if (bad) { setMessage({ tone: 'bad', text: 'No se guardó: corregí las franjas marcadas en rojo.' }); return; }
    setSaving(true);
    try {
      await saveRecessSchedules(strip(view));
      carry.current = view;
      await onSaved();
      setDraft(null);
      setMessage({ tone: 'ok', text: 'Recreos guardados. Se avisó a los administradores.' });
    } catch (err) {
      setMessage({ tone: 'bad', text: `No se guardó: ${errorText(err)}` });
    } finally {
      setSaving(false);
    }
  };

  const stateText = message?.text
    || (noName ? 'Todos los grupos necesitan un nombre.' : bad ? 'Hay franjas con el fin antes del inicio: así no se guardan.' : dirty ? 'Cambios sin guardar' : 'Sin cambios');
  const stateTone = message ? message.tone : noName || bad ? 'bad' : dirty ? 'warn' : 'muted';

  return (
    <section className="hr-card hr-recess-card" aria-label="Franjas de recreo">
      <div className="hr-card-head">
        <h3 className="hr-h3">Franjas de recreo</h3>
        {dirty && <StatusText tone="warn" className="hr-head-flag">Sin guardar</StatusText>}
        {editable && (
          <Button size="sm" variant="secondary" icon={<icons.IconPlus size={14} />} onClick={() => edit(list => [...list, { key: newKey(), name: `Grupo ${list.length + 1}`, slots: [] }])}>Grupo</Button>
        )}
      </div>
      <p className="hr-note">{canConfigure ? 'Configurá grupos independientes para cada ciclo o nivel. Los cambios se guardan todos juntos.' : 'Solo los administradores de la sede editan los recreos.'}</p>
      <Collapse open={restored && dirty} unmountOnClose>
        <div className="hr-restored" role="status">
          <span className="hr-restored-text">Recuperamos los cambios sin guardar de la última vez.</span>
          <span className="hr-restored-actions">
            <Button size="sm" variant="ghost" onClick={() => setRestored(false)}>Seguir editando</Button>
            <Button size="sm" variant="ghost" onClick={() => { setDraft(null); setAskDelete(''); setMessage(null); setRestored(false); }}>Descartar</Button>
          </span>
        </div>
      </Collapse>

      <MotionList items={view} keyOf={group => group.key} itemClassName="hr-rgroup-motion" render={group => {
        const groupIndex = view.indexOf(group);
        return (
        <div className="hr-rgroup">
          <div className="hr-rgroup-head">
            <Input
              aria-label={`Nombre del grupo ${groupIndex + 1}`}
              placeholder="Nombre del grupo"
              value={group.name}
              disabled={!editable}
              error={!group.name.trim() ? 'Ponele un nombre al grupo.' : undefined}
              onValueChange={name => setGroup(group.key, { name })}
              className="hr-rgroup-name"
            />
            {editable && <Button variant="ghost" onClick={() => setAskDelete(group.key)}>Eliminar</Button>}
          </div>
          <Collapse open={askDelete === group.key} unmountOnClose>
            <InlineConfirm
              danger
              message={`¿Eliminar ${group.name.trim() || 'este grupo'} y sus franjas?`}
              detail="Se borra cuando guardes los cambios."
              confirmLabel="Eliminar"
              cancelLabel="No"
              onConfirm={() => { edit(list => list.filter(entry => entry.key !== group.key)); setAskDelete(''); }}
              onCancel={() => setAskDelete('')}
            />
          </Collapse>
          <MotionList items={group.slots} keyOf={slot => slot.key} itemClassName="hr-slot-motion" render={slot => {
            const slotIndex = group.slots.indexOf(slot);
            const valid = slotValid(slot);
            const active = valid && clock.day <= 5 && clock.now >= (toMin(slot.startTime) ?? 0) && clock.now < (toMin(slot.endTime) ?? 0);
            return (
              <div className={cx('hr-slot', !valid && 'is-bad')}>
                <div className="hr-slot-line">
                  <Input aria-label={`Nombre de la franja ${slotIndex + 1} de ${group.name || 'el grupo'}`} value={slot.label} disabled={!editable} onValueChange={label => setSlot(group.key, slot.key, { label })} className="hr-slot-label" />
                  {editable && <IconButton label={`Quitar la franja ${slot.label} ${slot.startTime}–${slot.endTime}`} icon={<X size={15} />} onClick={() => edit(list => list.map(entry => (entry.key !== group.key ? entry : { ...entry, slots: entry.slots.filter(item => item.key !== slot.key) })))} />}
                </div>
                <div className="hr-slot-times">
                  {editable ? (
                    <>
                      <TimeField ariaLabel={`Inicio de ${slot.label}`} value={slot.startTime} onChange={startTime => setSlot(group.key, slot.key, { startTime })} className="hr-slot-time" />
                      <span className="hr-slot-dash" aria-hidden="true">–</span>
                      <TimeField ariaLabel={`Fin de ${slot.label}`} value={slot.endTime} error={!valid} onChange={endTime => setSlot(group.key, slot.key, { endTime })} className="hr-slot-time" />
                    </>
                  ) : (
                    <span className="hr-slot-ro g-num">{slot.startTime}–{slot.endTime}</span>
                  )}
                </div>
                {active && <StatusText tone="info" className="hr-slot-msg">En curso ahora</StatusText>}
                <Collapse open={!valid}>
                  <span className="hr-slot-msg hr-slot-msg--bad" role="alert">El fin tiene que ser después del inicio. Así no se guarda.</span>
                </Collapse>
              </div>
            );
          }} />
          <Collapse open={!group.slots.length}><span className="hr-muted">Sin franjas.</span></Collapse>
          {editable && (
            <Button size="sm" variant="ghost" icon={<icons.IconPlus size={14} />} className="hr-add-slot" onClick={() => setGroup(group.key, { slots: [...group.slots, { key: newKey(), label: 'Recreo', startTime: '10:00', endTime: '10:15' }] })}>Franja</Button>
          )}
        </div>
        );
      }} />
      <Collapse open={!view.length}>
        <EmptyState
          compact
          className="hr-empty"
          icon={<Coffee size={18} strokeWidth={1.6} />}
          title="Todavía no hay grupos de recreo."
          description={editable ? 'Sumá un grupo por ciclo o nivel con «Grupo» y cargale sus franjas.' : 'Los carga un administrador de la sede.'}
        />
      </Collapse>

      {editable && (
        <div className="hr-card-foot">
          <StatusText tone={stateTone} className="hr-rstate">{stateText}</StatusText>
          {dirty && <Button size="sm" variant="ghost" disabled={saving} onClick={() => { setDraft(null); setAskDelete(''); setMessage(null); }}>Descartar</Button>}
          <Button size="sm" variant="primary" loading={saving} loadingLabel="Guardando…" disabled={!dirty || noName || bad} onClick={save}>Guardar cambios</Button>
        </div>
      )}
    </section>
  );
}
