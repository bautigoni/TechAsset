import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { SchoolLevel, TeacherScheduleEntry } from '../../types';
import { Button, Collapse, Input, Segmented, TimeField, cx, preloadPickers } from '../../ui';
import { DAY_SHORT, LEVELS, MODULES, toMin } from './scheduleModel';

export type ScheduleDraft = Pick<TeacherScheduleEntry, 'teacher' | 'course' | 'subject' | 'room' | 'schoolLevel' | 'dayOfWeek' | 'startTime' | 'endTime'>;

const errorText = (err: unknown) => (err instanceof Error && err.message ? err.message : 'No se pudo guardar el horario.');

/** Alta y edición de un horario, en línea (antes era un modal que no mostraba los 400). */
export function ScheduleForm({ initial, title, compact, onSubmit, onCancel, onDraftChange }: {
  initial: ScheduleDraft;
  title: string;
  /** Dentro de una tarjeta de grupo (edición). */
  compact?: boolean;
  onSubmit: (draft: ScheduleDraft) => Promise<unknown>;
  onCancel: () => void;
  /** Cada cambio del borrador (la página lo guarda para recuperarlo si se sale sin guardar). */
  onDraftChange?: (draft: ScheduleDraft) => void;
}) {
  const [draft, setDraft] = useState<ScheduleDraft>(initial);
  const draftChange = useRef(onDraftChange);
  draftChange.current = onDraftChange;
  useEffect(() => { draftChange.current?.(draft); }, [draft]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const modId = useId();
  const lastError = useRef(error);
  if (error) lastError.current = error;
  const set = (patch: Partial<ScheduleDraft>) => { setDraft(current => ({ ...current, ...patch })); setError(''); };
  useEffect(() => { void preloadPickers(); }, []);

  const timeOk = (toMin(draft.startTime) ?? 1441) < (toMin(draft.endTime) ?? -1);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.teacher.trim() || !draft.course.trim()) { setError('Completá docente y curso para guardar.'); return; }
    if (!timeOk) { setError('Hasta tiene que ser después de Desde.'); return; }
    setSaving(true);
    setError('');
    try {
      await onSubmit({ ...draft, teacher: draft.teacher.trim(), course: draft.course.trim(), subject: draft.subject.trim(), room: draft.room.trim() });
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  };

  return (
    <form className={cx('hr-form', compact && 'hr-form--compact')} aria-label={title} onSubmit={submit} noValidate data-scanner-ignore="">
      <div className="hr-form-head">
        <h3 className="hr-h3">{title}</h3>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
      </div>
      <div className="hr-form-body">
        <div className="hr-form-row">
          <Segmented<SchoolLevel> label="Nivel" value={draft.schoolLevel} onChange={schoolLevel => set({ schoolLevel })} options={LEVELS.map(level => ({ value: level.value, label: compact ? level.short : level.label }))} />
          <Segmented<string> label="Día" value={String(draft.dayOfWeek)} onChange={day => set({ dayOfWeek: Number(day) })} options={DAY_SHORT.slice(1).map((label, index) => ({ value: String(index + 1), label }))} />
        </div>
        <div className="hr-form-row">
          <Input label="Docente" required autoComplete="off" value={draft.teacher} onValueChange={teacher => set({ teacher })} className="hr-grow-2" />
          <Input label="Curso" required autoComplete="off" placeholder="Ej. 4N" value={draft.course} onValueChange={course => set({ course })} className="hr-grow-1" />
          <Input label="Materia" autoComplete="off" value={draft.subject} onValueChange={subject => set({ subject })} className="hr-grow-2" />
          <Input label="Aula" autoComplete="off" value={draft.room} onValueChange={room => set({ room })} className="hr-grow-1" />
        </div>
        <div className="ui-field">
          <span className="ui-label" id={modId}><span className="ui-label-text">Módulo</span></span>
          <div className="hr-chips" role="group" aria-labelledby={modId}>
            {MODULES.map(([from, to]) => {
              const on = draft.startTime === from && draft.endTime === to;
              return <button key={from} type="button" className={cx('hr-chip', on && 'is-on')} aria-pressed={on} onClick={() => set({ startTime: from, endTime: to })}>{from}–{to}</button>;
            })}
          </div>
        </div>
        <div className="hr-form-row">
          <TimeField label="Desde" required value={draft.startTime} onChange={startTime => set({ startTime })} className="hr-form-time" />
          <TimeField label="Hasta" required value={draft.endTime} onChange={endTime => set({ endTime })} error={!timeOk && draft.startTime && draft.endTime ? 'Hasta tiene que ser después de Desde.' : undefined} className="hr-form-time" />
        </div>
        <Collapse open={Boolean(error)}>
          <p className="hr-form-error" role="alert">{error || lastError.current}</p>
        </Collapse>
        <div className="hr-form-foot">
          <span className="hr-form-note">Al guardar se avisa a los administradores de la sede.</span>
          <Button type="submit" variant="primary" size={compact ? 'sm' : 'md'} loading={saving} loadingLabel="Guardando…" disabled={!timeOk}>{compact ? 'Guardar cambios' : 'Guardar horario'}</Button>
          <Button variant="ghost" size={compact ? 'sm' : 'md'} disabled={saving} onClick={onCancel}>Cancelar</Button>
        </div>
      </div>
    </form>
  );
}
