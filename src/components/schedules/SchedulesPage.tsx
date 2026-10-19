import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import type { RecessGroup, SchoolLevel, TeacherScheduleEntry } from '../../types';
import {
  createTeacherSchedule, deleteTeacherSchedule, getRecessSchedules, getTeacherSchedules, restoreTeacherSchedule, updateTeacherSchedule
} from '../../services/schedulesApi';
import { useMinuteTick } from '../../hooks/useMinuteTick';
import { Button, EmptyState, ErrorState, Eyebrow, IconButton, InlineConfirm, Input, Segmented, SkeletonRows, Tabs, TruncatedText, cx, icons, useStatusLine } from '../../ui';
import { RecessPanel } from './RecessPanel';
import { ScheduleForm, type ScheduleDraft } from './ScheduleForm';
import {
  DAY_NAMES, LEVELS, durationText, fold, isNow, levelLabel, matchesSearch, readSchoolClock, recessNow, scheduleShort, toMin
} from './scheduleModel';
import '../../styles/screens/horarios.css';

type GroupBy = 'teacher' | 'course';
type Tab = 'docentes' | 'recreos';

const EMPTY: ScheduleDraft = { teacher: '', course: '', subject: '', room: '', schoolLevel: 'primary_first', dayOfWeek: 1, startTime: '08:00', endTime: '08:45' };
const errorText = (err: unknown) => (err instanceof Error && err.message ? err.message : 'Error de conexión.');
const draftOf = (entry: TeacherScheduleEntry): ScheduleDraft => ({
  teacher: entry.teacher, course: entry.course, subject: entry.subject || '', room: entry.room || '', schoolLevel: entry.schoolLevel, dayOfWeek: entry.dayOfWeek, startTime: entry.startTime, endTime: entry.endTime
});

export function SchedulesPage({ consultationMode }: { consultationMode: boolean }) {
  const tick = useMinuteTick();
  const clock = useMemo(() => readSchoolClock(), [tick]);

  const [items, setItems] = useState<TeacherScheduleEntry[]>([]);
  const [groups, setGroups] = useState<RecessGroup[]>([]);
  const [canConfigure, setCanConfigure] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [retrying, setRetrying] = useState(false);

  const [tab, setTab] = useState<Tab>('docentes');
  const [level, setLevel] = useState<SchoolLevel>('primary_first');
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('teacher');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(0);
  const [deletingId, setDeletingId] = useState(0);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [recessDirty, setRecessDirty] = useState(false);
  const status = useStatusLine();

  const refresh = useCallback(async () => {
    const [schedules, recesses] = await Promise.all([getTeacherSchedules(), getRecessSchedules()]);
    setItems(schedules.items || []);
    setGroups(recesses.groups || []);
    setCanConfigure(Boolean(recesses.canConfigure));
    setLoadError('');
    setLoaded(true);
  }, []);

  const load = useCallback(async () => {
    try { await refresh(); } catch (err) { setLoadError(`No se pudieron cargar los horarios: ${errorText(err)}`); }
  }, [refresh]);
  useEffect(() => { void load(); }, [load]);

  const needle = fold(search);
  const levelItems = useMemo(() => items.filter(item => item.schoolLevel === level), [items, level]);
  const shown = useMemo(() => levelItems.filter(item => matchesSearch(item, needle)), [levelItems, needle]);
  const grouped = useMemo(() => {
    const map = new Map<string, TeacherScheduleEntry[]>();
    for (const item of shown) {
      const key = groupBy === 'teacher' ? item.teacher : item.course;
      map.set(key, [...(map.get(key) || []), item]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, 'es'));
  }, [shown, groupBy]);

  // "Ahora" se calcula con la hora del colegio y se actualiza cada minuto
  // (antes quedaba congelado a la hora en que se abrió la pantalla).
  const nowRows = useMemo(() => levelItems.filter(item => isNow(item, clock)).sort((a, b) => a.teacher.localeCompare(b.teacher, 'es')), [levelItems, clock]);
  const nextRow = useMemo(() => levelItems
    .filter(item => item.dayOfWeek === clock.day && (toMin(item.startTime) ?? -1) > clock.now)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))[0], [levelItems, clock]);
  const recess = useMemo(() => recessNow(groups, clock), [groups, clock]);
  const lvName = levelLabel(level);
  const nowEmptyText = recess.active.length
    ? `Nadie da clase en ${lvName}: ${recess.active.map(entry => `${entry.group} está en ${entry.slot.label.toLowerCase()} hasta las ${entry.slot.endTime}`).join(', ')}.${nextRow ? ` Próxima clase ${nextRow.startTime}.` : ''}`
    : `Nadie da clase ahora en ${lvName}.${nextRow ? ` Próxima: ${nextRow.teacher} a las ${nextRow.startTime}.` : ''}`;

  /* ── Escrituras ───────────────────────────────────────────────────────── */

  const afterWrite = async () => { try { await refresh(); } catch { /* el próximo intento lo trae */ } };

  const create = async (draft: ScheduleDraft) => {
    await createTeacherSchedule(draft);
    setAdding(false);
    setLevel(draft.schoolLevel);
    setSearch('');
    await afterWrite();
    status.show({ tone: 'ok', message: `Horario guardado: ${draft.teacher} · ${draft.course} · ${DAY_NAMES[draft.dayOfWeek]} ${draft.startTime}–${draft.endTime}. Se avisó a los administradores.` });
  };

  const update = async (entry: TeacherScheduleEntry, draft: ScheduleDraft) => {
    await updateTeacherSchedule(entry.id, draft);
    setEditingId(0);
    setLevel(draft.schoolLevel);
    await afterWrite();
    const before = draftOf(entry);
    status.show({
      tone: 'ok',
      message: `Horario guardado: ${scheduleShort(draft)}. Se avisó a los administradores de la sede.`,
      undo: {
        onUndo: async () => {
          try { await updateTeacherSchedule(entry.id, before); await afterWrite(); status.show({ tone: 'info', message: `Se deshizo el cambio en ${scheduleShort(before)}.` }); } catch (err) { status.show({ tone: 'bad', message: `No se pudo deshacer: ${errorText(err)}` }); }
        }
      }
    });
  };

  const remove = async (entry: TeacherScheduleEntry) => {
    setDeleteBusy(true);
    try {
      await deleteTeacherSchedule(entry.id);
      setDeletingId(0);
      await afterWrite();
      status.show({
        tone: 'ok',
        message: `Horario borrado: ${scheduleShort(entry)}.`,
        undo: {
          onUndo: async () => {
            try { await restoreTeacherSchedule(entry.id); await afterWrite(); status.show({ tone: 'info', message: `${scheduleShort(entry)} volvió al horario.` }); } catch (err) { status.show({ tone: 'bad', message: `No se pudo restaurar: ${errorText(err)}` }); }
          }
        }
      });
    } catch (err) {
      status.show({ tone: 'bad', message: `No se pudo borrar: ${errorText(err)}`, retry: { onRetry: () => remove(entry) } });
    } finally {
      setDeleteBusy(false);
    }
  };

  const toggleAdd = () => {
    setAdding(value => !value);
    setEditingId(0);
    setDeletingId(0);
    setTab('docentes');
  };

  /* ── Vista ────────────────────────────────────────────────────────────── */

  const recessCard = (
    <section className="hr-card hr-now-recess" aria-label="Recreo ahora">
      <Eyebrow>{recess.active.length ? 'Recreo activo' : 'Próximo recreo'} · <span className="g-num">{clock.time}</span></Eyebrow>
      {recess.weekend ? (
        <span className="hr-muted">Fin de semana: no hay recreos.</span>
      ) : recess.active.length ? recess.active.map(entry => (
        <div key={`${entry.group}-${entry.slot.startTime}`} className="hr-recess-line">
          <span className="hr-recess-name"><TruncatedText>{`${entry.group} · ${entry.slot.label}`}</TruncatedText><span className="hr-recess-time g-num">{entry.slot.startTime}–{entry.slot.endTime}</span></span>
          <span className="hr-recess-left is-live">Termina en {durationText(entry.to - clock.now)}</span>
        </div>
      )) : recess.next ? (
        <div className="hr-recess-line">
          <span className="hr-recess-name"><TruncatedText>{`${recess.next.group} · ${recess.next.slot.label}`}</TruncatedText><span className="hr-recess-time g-num">{recess.next.slot.startTime}–{recess.next.slot.endTime}</span></span>
          <span className="hr-recess-left">Empieza en {durationText(recess.next.from - clock.now)}</span>
        </div>
      ) : (
        <span className="hr-muted">{groups.length ? 'No hay más recreos hoy.' : 'No hay franjas de recreo cargadas.'}</span>
      )}
    </section>
  );

  return (
    <section className="hr-page" aria-labelledby="hr-title">
      <header className="hr-head">
        <div className="hr-head-text">
          <Eyebrow>Hora del colegio · <span className="g-num">{clock.time}</span></Eyebrow>
          <h2 id="hr-title" className="hr-title">Horarios docentes y recreos</h2>
          <p className="hr-head-sub">Quién da clase ahora, el horario de cada docente o curso y las franjas de recreo por grupo. Lo de “ahora” se actualiza cada minuto.</p>
        </div>
        <Button variant="primary" icon={<icons.IconPlus size={16} />} aria-expanded={adding} disabled={consultationMode} onClick={toggleAdd}>Agregar horario</Button>
      </header>

      {loadError && <ErrorState message={loadError} retrying={retrying} onRetry={async () => { setRetrying(true); await load(); setRetrying(false); }} />}

      <div className={cx('hr-body', `is-${tab}`)}>
        {recessCard}
        <div className="hr-tabs">
          <Segmented<Tab>
            ariaLabel="Sección"
            block
            value={tab}
            onChange={setTab}
            options={[{ value: 'docentes', label: 'Docentes' }, { value: 'recreos', label: recessDirty ? 'Recreos · sin guardar' : 'Recreos' }]}
          />
        </div>

        <section className="hr-docentes" aria-label="Horarios docentes">
          <Tabs<SchoolLevel>
            ariaLabel="Nivel escolar"
            value={level}
            onChange={next => { setLevel(next); setEditingId(0); setDeletingId(0); }}
            tabs={LEVELS.map(entry => ({ value: entry.value, label: entry.label, count: items.filter(item => item.schoolLevel === entry.value).length }))}
          />

          {status.element}

          {adding && (
            <section className="hr-card">
              <ScheduleForm title="Nuevo horario" initial={{ ...EMPTY, schoolLevel: level }} onSubmit={create} onCancel={() => setAdding(false)} />
            </section>
          )}

          <div className="hr-now">
            <div className="hr-now-head">
              <Eyebrow>Ahora · <span className="g-num">{clock.time}</span></Eyebrow>
              {nowRows.length > 0 && <span className="hr-muted">{DAY_NAMES[clock.day].toLowerCase()} · {lvName}</span>}
            </div>
            {nowRows.length ? (
              <div className="hr-now-grid">
                {nowRows.map(item => (
                  <div key={item.id} className="hr-card hr-now-card">
                    <TruncatedText className="hr-now-teacher">{item.teacher}</TruncatedText>
                    <TruncatedText className="hr-now-course">{`${item.course} · ${item.subject || 'sin materia'}`}</TruncatedText>
                    <span className="hr-now-when g-num">{item.startTime}–{item.endTime}{item.room ? ` · ${item.room}` : ''}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="hr-now-empty">{loaded ? nowEmptyText : 'Cargando…'}</p>
            )}
          </div>

          <div className="hr-tools">
            <Input
              type="text"
              role="searchbox"
              aria-label="Buscar por docente, curso, materia, aula o día"
              placeholder="Docente, curso, materia, aula o día"
              autoComplete="off"
              value={search}
              onValueChange={setSearch}
              onKeyDown={event => { if (event.key === 'Escape' && search) { event.preventDefault(); setSearch(''); } }}
              prefix={<icons.IconSearch size={15} />}
              suffix={search ? <IconButton size="sm" label="Limpiar búsqueda" icon={<icons.IconX size={14} />} onClick={() => setSearch('')} /> : undefined}
              className="hr-search"
              data-scanner-ignore=""
            />
            <Segmented<GroupBy> ariaLabel="Agrupar" value={groupBy} onChange={setGroupBy} options={[{ value: 'teacher', label: 'Por docente' }, { value: 'course', label: 'Por curso' }]} />
            <span className="hr-result">
              <span className="g-num">{shown.length}</span> {shown.length === 1 ? 'horario' : 'horarios'}{needle ? ` con “${search.trim()}”` : ''}
            </span>
          </div>

          {!loaded && !loadError && <SkeletonRows rows={5} />}

          <div className="hr-groups">
            {grouped.map(([name, rows]) => (
              <article key={name} className="hr-card hr-group" aria-label={`${groupBy === 'teacher' ? 'Docente' : 'Curso'} ${name}`}>
                <header className="hr-group-head">
                  <span className="hr-group-title">
                    <Eyebrow>{groupBy === 'teacher' ? 'Docente' : 'Curso'}</Eyebrow>
                    <TruncatedText className="hr-group-name">{name}</TruncatedText>
                  </span>
                  <span className="hr-group-count"><span className="g-num">{rows.length}</span> {rows.length === 1 ? 'clase' : 'clases'}</span>
                </header>
                {[...new Set(rows.map(row => row.dayOfWeek))].sort((a, b) => a - b).map(day => (
                  <div key={day} className="hr-day">
                    <div className="hr-day-label">{DAY_NAMES[day]}</div>
                    {rows.filter(row => row.dayOfWeek === day).sort((a, b) => a.startTime.localeCompare(b.startTime)).map(row => {
                      const short = scheduleShort(row);
                      const live = isNow(row, clock);
                      const detail = [row.subject, row.room].filter(Boolean).join(' · ');
                      if (editingId === row.id) {
                        return (
                          <div key={row.id} className="hr-row-edit">
                            <ScheduleForm compact title="Editar horario" initial={draftOf(row)} onSubmit={draft => update(row, draft)} onCancel={() => setEditingId(0)} />
                          </div>
                        );
                      }
                      if (deletingId === row.id) {
                        return (
                          <div key={row.id} className="hr-row-confirm">
                            <InlineConfirm danger message={`¿Borrar ${short}?`} detail="Se borra este bloque del horario docente." confirmLabel="Borrar" cancelLabel="No" busy={deleteBusy} onConfirm={() => remove(row)} onCancel={() => setDeletingId(0)} />
                          </div>
                        );
                      }
                      return (
                        <div key={row.id} className={cx('hr-row', live && 'is-live')}>
                          <time className="hr-row-time g-num"><span>{row.startTime}</span><span className="hr-row-end">{row.endTime}</span></time>
                          <span className="hr-row-text">
                            <span className="hr-row-title">
                              <TruncatedText className="hr-row-main">{groupBy === 'teacher' ? row.course : row.teacher}</TruncatedText>
                              {live && <span className="hr-row-now">· ahora</span>}
                            </span>
                            <TruncatedText className={cx('hr-row-sub', !detail && 'is-empty')}>{detail || 'Sin detalle'}</TruncatedText>
                          </span>
                          <span className="hr-row-actions">
                            <IconButton size="sm" label={`Editar ${short}`} icon={<Pencil size={15} />} disabled={consultationMode} onClick={() => { setEditingId(row.id); setDeletingId(0); setAdding(false); }} />
                            <IconButton size="sm" label={`Borrar ${short}`} icon={<Trash2 size={15} />} disabled={consultationMode} onClick={() => { setDeletingId(row.id); setEditingId(0); }} />
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </article>
            ))}
          </div>
          {loaded && !grouped.length && (
            <EmptyState
              title={needle ? `Ningún horario de ${lvName.toLowerCase()} coincide con “${search.trim()}”.` : `No hay horarios cargados para ${lvName.toLowerCase()}.`}
              action={needle
                ? <Button size="sm" variant="secondary" onClick={() => setSearch('')}>Limpiar búsqueda</Button>
                : !consultationMode && !adding ? <Button size="sm" variant="secondary" onClick={toggleAdd}>Agregar el primero</Button> : undefined}
              className="hr-card"
            />
          )}
        </section>

        <div className="hr-recess">
          <RecessPanel groups={groups} canConfigure={canConfigure} consultation={consultationMode} clock={clock} onSaved={refresh} onDirtyChange={setRecessDirty} />
        </div>
      </div>
    </section>
  );
}
