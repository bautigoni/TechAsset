import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import type { AgendaItem } from '../../types';
import { Button, DatePicker, Input, NumberField, Ring, Segmented, Textarea, TimeField, cx, preloadPickers } from '../../ui';
import { weekdayOfKey } from '../../utils/formatters';
import {
  DAY_SHORT, DEVICE_TYPES, MODULES, WEEK_DAYS, cap1, capacityFor, capacityUsage, dayNameOfDate, displayTurno, fold, longDate, toMin,
  type Clock
} from './agendaModel';

type Repeat = 'semanal' | 'fecha';

type Draft = {
  rep: Repeat;
  dia: string;
  fecha: string;
  turno: string;
  desde: string;
  hasta: string;
  curso: string;
  actividad: string;
  ubicacion: string;
  tipo: string;
  cantidad: number;
  nota: string;
};

// Valores por defecto de siempre (Lunes, Mañana, 09:05–09:55, Glifing, Touch, 1).
const BLANK: Draft = { rep: 'semanal', dia: 'Lunes', fecha: '', turno: 'Mañana', desde: '09:05', hasta: '09:55', curso: '', actividad: 'Glifing', ubicacion: '', tipo: 'Touch', cantidad: 1, nota: '' };

function fromItem(item: AgendaItem): Draft {
  return {
    rep: item.fecha ? 'fecha' : 'semanal',
    dia: item.dia || 'Lunes',
    fecha: item.fecha || '',
    turno: displayTurno(item.turno),
    desde: item.desde || '',
    hasta: item.hasta || '',
    curso: item.curso || '',
    actividad: item.actividad || '',
    ubicacion: item.ubicacion || '',
    tipo: DEVICE_TYPES.find(type => fold(type) === fold(item.tipoDispositivo)) || item.tipoDispositivo || 'Touch',
    cantidad: Number(item.cantidad || 1),
    nota: item.nota || ''
  };
}

/** El payload completo que sale del formulario (la pantalla manda solo lo que cambió al editar). */
export function draftPayload(draft: Draft): Partial<AgendaItem> {
  const dated = draft.rep === 'fecha';
  return {
    dia: dated && draft.fecha ? dayNameOfDate(draft.fecha) : draft.dia,
    fecha: dated ? draft.fecha : '',
    turno: draft.turno,
    desde: draft.desde,
    hasta: draft.hasta,
    curso: draft.curso.trim(),
    actividad: draft.actividad.trim(),
    ubicacion: draft.ubicacion.trim(),
    tipoDispositivo: draft.tipo,
    cantidad: draft.cantidad,
    nota: draft.nota
  };
}

const weekend = (iso: string) => { const wd = weekdayOfKey(iso); return wd === 0 || wd === 6; };
const errorText = (err: unknown) => (err instanceof Error && err.message ? err.message : 'No se pudo guardar la actividad.');

export function AgendaForm({ initial, items, clock, frequent, onSubmit, onCancel }: {
  /** Si viene, es la edición de esa actividad. */
  initial?: AgendaItem;
  items: AgendaItem[];
  clock: Clock;
  frequent: string[];
  onSubmit: (payload: Partial<AgendaItem>) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => (initial ? fromItem(initial) : BLANK));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const modId = useId();
  const set = (patch: Partial<Draft>) => { setDraft(current => ({ ...current, ...patch })); setError(''); };

  useEffect(() => { void preloadPickers(); }, []);

  const max = capacityFor(draft.tipo);
  const timeOk = (toMin(draft.desde) ?? -1) >= 0 && (toMin(draft.hasta) ?? -1) > (toMin(draft.desde) ?? 1440);
  const dated = draft.rep === 'fecha';
  const dayName = dated && draft.fecha ? dayNameOfDate(draft.fecha) : draft.dia;
  const whenReady = timeOk && (!dated || Boolean(draft.fecha));
  const usage = useMemo(() => capacityUsage(items, {
    id: initial?.id,
    dia: dayName,
    fecha: dated ? draft.fecha : '',
    desde: draft.desde,
    hasta: draft.hasta,
    tipoDispositivo: draft.tipo,
    cantidad: draft.cantidad,
    estado: initial?.estado
  }, clock.today), [items, initial?.id, initial?.estado, dayName, dated, draft.fecha, draft.desde, draft.hasta, draft.tipo, draft.cantidad, clock.today]);
  const conflict = whenReady && usage.conflict;

  const dayOptions = [...WEEK_DAYS as readonly string[]];
  if (draft.dia && !dayOptions.some(day => fold(day) === fold(draft.dia))) dayOptions.push(draft.dia);
  const typeOptions = DEVICE_TYPES.includes(draft.tipo) ? DEVICE_TYPES : [...DEVICE_TYPES, draft.tipo];
  const turnoOptions = ['Mañana', 'Tarde'].includes(draft.turno) ? ['Mañana', 'Tarde'] : ['Mañana', 'Tarde', draft.turno];
  const minDate = initial?.fecha && initial.fecha < clock.today ? initial.fecha : clock.today;
  const whenText = dated ? (draft.fecha ? cap1(longDate(draft.fecha)) : 'Fecha sin elegir') : `Todos los ${draft.dia.toLowerCase()}`;
  const where = dated && draft.fecha ? `el ${longDate(draft.fecha)}` : `los ${draft.dia.toLowerCase()}`;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.curso.trim()) { setError('Escribí el curso para guardar la actividad.'); return; }
    if (dated && !draft.fecha) { setError('Elegí la fecha de la actividad.'); return; }
    if (!timeOk) { setError('Hasta tiene que ser después de Desde.'); return; }
    if (conflict) { setError(`Conflicto de disponibilidad: ${draft.tipo} supera ${max} en ese horario.`); return; }
    setSaving(true);
    setError('');
    try {
      await onSubmit(draftPayload(draft));
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  };

  const title = initial ? 'Editar actividad' : 'Nueva actividad';
  return (
    <form className="ag-form" aria-label={title} onSubmit={submit} data-scanner-ignore="" noValidate>
      <div className="ag-form-head">
        <h3 className="ag-h3">{title}</h3>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
      </div>
      <div className="ag-form-body">
        <div className="ag-form-row">
          <Segmented<Repeat>
            label="Se repite"
            value={draft.rep}
            onChange={rep => set({ rep })}
            options={[{ value: 'semanal', label: 'Todas las semanas' }, { value: 'fecha', label: 'Una sola fecha' }]}
          />
          {dated ? (
            <DatePicker
              label="Fecha"
              value={draft.fecha}
              onChange={fecha => set({ fecha })}
              min={minDate}
              isDateDisabled={weekend}
              disabledMessage="Sábados y domingos no se agendan"
              shortcuts
              required
              defaultOpen={!draft.fecha}
              className="ag-form-date"
            />
          ) : (
            <Segmented
              label="Día"
              value={dayOptions.find(day => fold(day) === fold(draft.dia)) || draft.dia}
              onChange={dia => set({ dia })}
              options={dayOptions.map(day => ({ value: day, label: DAY_SHORT[day] || day }))}
            />
          )}
          <Segmented label="Turno" value={draft.turno} onChange={turno => set({ turno })} options={turnoOptions.map(turno => ({ value: turno, label: turno || 'Sin turno' }))} />
        </div>

        <div className="ui-field">
          <span className="ui-label" id={modId}><span className="ui-label-text">Módulo</span></span>
          <div className="ag-chips" role="group" aria-labelledby={modId}>
            {MODULES.map(([from, to]) => {
              const on = draft.desde === from && draft.hasta === to;
              return (
                <button key={from} type="button" className={cx('ag-chip', 'g-num', on && 'is-on')} aria-pressed={on} onClick={() => set({ desde: from, hasta: to, turno: (toMin(from) ?? 0) >= 13 * 60 ? 'Tarde' : 'Mañana' })}>
                  {from}–{to}
                </button>
              );
            })}
          </div>
        </div>

        <div className="ag-form-row">
          <TimeField
            label="Desde"
            value={draft.desde}
            onChange={desde => set(desde ? { desde, turno: (toMin(desde) ?? 0) >= 13 * 60 ? 'Tarde' : 'Mañana' } : { desde })}
            className="ag-form-time"
          />
          <TimeField
            label="Hasta"
            value={draft.hasta}
            onChange={hasta => set({ hasta })}
            error={!timeOk && draft.desde && draft.hasta ? 'Hasta tiene que ser después de Desde.' : undefined}
            className="ag-form-time"
          />
        </div>

        <div className="ag-form-row">
          <Input label="Curso" required placeholder="Ej. 3N" autoComplete="off" value={draft.curso} onValueChange={curso => set({ curso })} className="ag-grow-1" />
          <Input label="Actividad" autoComplete="off" value={draft.actividad} onValueChange={actividad => set({ actividad })} className="ag-grow-2" />
          <Input label="Ubicación" placeholder="Ej. Aula, Aula TIC" autoComplete="off" value={draft.ubicacion} onValueChange={ubicacion => set({ ubicacion })} className="ag-grow-2" />
        </div>
        <div className="ag-chips" role="group" aria-label="Actividades frecuentes">
          <span className="ag-chips-label">Frecuentes</span>
          {frequent.map(name => (
            <button key={name} type="button" className={cx('ag-chip', draft.actividad === name && 'is-on')} aria-pressed={draft.actividad === name} onClick={() => set({ actividad: name })}>{name}</button>
          ))}
        </div>

        <div className="ag-form-row ag-form-row--stretch">
          <Segmented
            label="Tipo de equipo"
            value={draft.tipo}
            onChange={tipo => { const cap = capacityFor(tipo); set({ tipo, cantidad: cap ? Math.min(draft.cantidad, cap) : draft.cantidad }); }}
            options={typeOptions.map(type => ({ value: type, label: type }))}
          />
          <NumberField
            label={max ? `Cantidad · máx ${max}` : 'Cantidad'}
            value={draft.cantidad}
            onChange={value => set({ cantidad: Math.max(1, value ?? 1) })}
            min={1}
            max={max ?? 999}
            className="ag-form-qty"
          />
          <div className={cx('ag-cap', conflict && 'is-conflict')} role="status" aria-live="polite">
            {max === null ? (
              <span className="ag-cap-text"><span className="ag-cap-l1">Sin tope para {draft.tipo}.</span></span>
            ) : !whenReady ? (
              <span className="ag-cap-text"><span className="ag-cap-l1">Elegí {dated && !draft.fecha ? 'la fecha y ' : ''}un horario válido para ver cuántas quedan.</span></span>
            ) : (
              <>
                <Ring value={Math.max(0, usage.libres ?? 0)} total={max} size={36} unit={`${draft.tipo} libres`} />
                <span className={cx('ag-cap-num', 'g-num', (usage.libres ?? 0) <= 0 ? 'is-bad' : (usage.libres ?? 0) / max <= 0.2 && 'is-warn')}>{Math.max(0, usage.libres ?? 0)}</span>
                <span className="ag-cap-text">
                  <span className="ag-cap-l1">de {max} {draft.tipo} libres {where} de {draft.desde} a {draft.hasta}{initial ? ' (sin contar esta actividad)' : ''}</span>
                  <span className="ag-cap-l2">
                    {conflict
                      ? `Conflicto de disponibilidad: ${draft.tipo} supera ${max} en ese horario${usage.users.length ? ` (${usage.users.map(user => `${user.curso} · ${user.actividad} ${user.cantidad}`).join(', ')})` : ''}.`
                      : usage.users.length ? `Ya reservado: ${usage.users.map(user => `${user.curso} ${user.cantidad}`).join(', ')}` : `Nadie más pidió ${draft.tipo} en esa franja.`}
                  </span>
                </span>
              </>
            )}
          </div>
        </div>

        <Textarea label="Nota" minRows={2} value={draft.nota} onValueChange={nota => set({ nota })} placeholder="Algo que el equipo TIC tenga que saber (cargadores, auriculares, docente a cargo…)" />

        {error && <p className="ag-form-error" role="alert">{error}</p>}
        <div className="ag-form-foot">
          <span className="ag-form-summary">{whenText} · {draft.desde}–{draft.hasta} · {draft.cantidad} {draft.tipo}{draft.curso.trim() ? ` para ${draft.curso.trim()}` : ''}</span>
          <Button type="submit" variant="primary" loading={saving} loadingLabel="Guardando…" disabled={conflict || !timeOk}>{initial ? 'Guardar cambios' : 'Guardar actividad'}</Button>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancelar</Button>
        </div>
      </div>
    </form>
  );
}
