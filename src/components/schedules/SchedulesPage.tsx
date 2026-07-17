import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RecessGroup, SchoolLevel, TeacherScheduleEntry } from '../../types';
import { createTeacherSchedule, deleteTeacherSchedule, getRecessSchedules, getTeacherSchedules, saveRecessSchedules, updateTeacherSchedule } from '../../services/schedulesApi';
import { Button } from '../layout/Button';
import { Modal } from '../layout/Modal';

const DAY_NAMES = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const LEVEL_OPTIONS: Array<{ value: SchoolLevel; label: string; short: string }> = [
  { value: 'primary_first', label: 'Primaria · 1er ciclo', short: '1er ciclo' },
  { value: 'primary_second', label: 'Primaria · 2do ciclo', short: '2do ciclo' },
  { value: 'secondary', label: 'Secundaria', short: 'Secundaria' }
];
const EMPTY_SCHEDULE: Partial<TeacherScheduleEntry> = { teacher: '', course: '', subject: '', room: '', schoolLevel: 'primary_first', dayOfWeek: 1, startTime: '08:00', endTime: '08:45' };

export function SchedulesPage({ consultationMode }: { consultationMode: boolean }) {
  const [tab, setTab] = useState<'teachers' | 'recess'>('teachers');
  const [items, setItems] = useState<TeacherScheduleEntry[]>([]);
  const [current, setCurrent] = useState<TeacherScheduleEntry[]>([]);
  const [groups, setGroups] = useState<RecessGroup[]>([]);
  const [activeRecess, setActiveRecess] = useState<Array<{ groupName: string; label: string; startTime: string; endTime: string }>>([]);
  const [canConfigure, setCanConfigure] = useState(false);
  const [viewMode, setViewMode] = useState<'teacher' | 'course'>('teacher');
  const [schoolLevel, setSchoolLevel] = useState<SchoolLevel>('primary_first');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Partial<TeacherScheduleEntry> | null>(null);
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    const [schedules, recesses] = await Promise.all([getTeacherSchedules(), getRecessSchedules()]);
    setItems(schedules.items);
    setCurrent(schedules.current || []);
    setGroups(recesses.groups || []);
    setActiveRecess(recesses.active || []);
    setCanConfigure(Boolean(recesses.canConfigure));
  }, []);

  useEffect(() => { refresh().catch(() => setMessage('No se pudieron cargar los horarios.')); }, [refresh]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('es');
    const byLevel = items.filter(item => item.schoolLevel === schoolLevel);
    if (!needle) return byLevel;
    return byLevel.filter(item => [item.teacher, item.course, item.subject, item.room, DAY_NAMES[item.dayOfWeek]].some(value => String(value || '').toLocaleLowerCase('es').includes(needle)));
  }, [items, schoolLevel, search]);

  const currentLevel = useMemo(() => current.filter(item => item.schoolLevel === schoolLevel), [current, schoolLevel]);

  const grouped = useMemo(() => {
    const map = new Map<string, TeacherScheduleEntry[]>();
    for (const item of filtered) {
      const key = viewMode === 'teacher' ? item.teacher : item.course;
      map.set(key, [...(map.get(key) || []), item]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, 'es'));
  }, [filtered, viewMode]);

  const saveSchedule = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    if (editing.id) await updateTeacherSchedule(editing.id, editing);
    else await createTeacherSchedule(editing);
    setEditing(null);
    setMessage('Horario guardado.');
    await refresh();
  };

  const updateGroup = (index: number, patch: Partial<RecessGroup>) => setGroups(currentGroups => currentGroups.map((group, i) => i === index ? { ...group, ...patch } : group));
  const updateSlot = (groupIndex: number, slotIndex: number, patch: Record<string, string>) => setGroups(currentGroups => currentGroups.map((group, i) => i !== groupIndex ? group : { ...group, slots: group.slots.map((slot, j) => j === slotIndex ? { ...slot, ...patch } : slot) }));

  return (
    <section className="view active schedules-page">
      <div className="planning-hero card">
        <div><span className="eyebrow">Planificación escolar</span><h2>Horarios</h2><p>Encontrá dónde está un docente, qué curso tiene o cuándo es el próximo recreo.</p></div>
        <div className="planning-tabs">
          <button className={tab === 'teachers' ? 'active' : ''} onClick={() => setTab('teachers')}>Docentes</button>
          <button className={tab === 'recess' ? 'active' : ''} onClick={() => setTab('recess')}>Recreos</button>
        </div>
      </div>
      {message && <div className="tool-info">{message}</div>}

      {tab === 'teachers' ? (
        <>
          <div className="schedule-level-tabs" role="tablist" aria-label="Nivel escolar">
            {LEVEL_OPTIONS.map(option => (
              <button key={option.value} type="button" role="tab" aria-selected={schoolLevel === option.value} className={schoolLevel === option.value ? 'active' : ''} onClick={() => setSchoolLevel(option.value)}>
                <span>{option.label}</span>
                <small>{items.filter(item => item.schoolLevel === option.value).length} horarios</small>
              </button>
            ))}
          </div>
          {currentLevel.length > 0 && <div className="schedule-now-grid">{currentLevel.map(item => <div className="schedule-now card" key={item.id}><span>Ahora</span><strong>{item.teacher}</strong><p>{item.course}{item.subject ? ` · ${item.subject}` : ''}</p><small>{item.startTime}–{item.endTime}{item.room ? ` · ${item.room}` : ''}</small></div>)}</div>}
          <div className="schedule-controls card">
            <input className="input" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar docente, curso, materia o aula" />
            <div className="segmented-control"><button className={viewMode === 'teacher' ? 'active' : ''} onClick={() => setViewMode('teacher')}>Por docente</button><button className={viewMode === 'course' ? 'active' : ''} onClick={() => setViewMode('course')}>Por curso</button></div>
            <Button variant="primary" disabled={consultationMode} onClick={() => setEditing({ ...EMPTY_SCHEDULE, schoolLevel })}>+ Agregar horario</Button>
          </div>
          <div className="schedule-groups">
            {grouped.map(([name, rows]) => (
              <article className="schedule-group card" key={name}>
                <header><div><span>{viewMode === 'teacher' ? 'Docente' : 'Curso'}</span><h3>{name}</h3></div><strong>{rows.length} clase{rows.length === 1 ? '' : 's'}</strong></header>
                <div className="schedule-days">
                  {[...new Set(rows.map(row => row.dayOfWeek))].sort().map(day => (
                    <section key={day}><h4>{DAY_NAMES[day]}</h4>{rows.filter(row => row.dayOfWeek === day).sort((a, b) => a.startTime.localeCompare(b.startTime)).map(row => (
                      <div className="schedule-row" key={row.id}><time>{row.startTime}<small>{row.endTime}</small></time><div><strong>{viewMode === 'teacher' ? row.course : row.teacher}</strong><span>{[row.subject, row.room].filter(Boolean).join(' · ') || 'Sin detalle'}</span></div><div className="schedule-row-actions"><button disabled={consultationMode} onClick={() => setEditing(row)}>Editar</button><button disabled={consultationMode} onClick={async () => { await deleteTeacherSchedule(row.id); await refresh(); }}>Borrar</button></div></div>
                    ))}</section>
                  ))}
                </div>
              </article>
            ))}
            {!grouped.length && <div className="empty-state">No hay horarios cargados para {LEVEL_OPTIONS.find(option => option.value === schoolLevel)?.label.toLowerCase()}.</div>}
          </div>
        </>
      ) : (
        <div className="recess-workspace">
          {activeRecess.length > 0 && <div className="active-recess-banner"><span>Recreo activo</span>{activeRecess.map(item => <strong key={`${item.groupName}-${item.startTime}`}>{item.groupName} · {item.startTime}–{item.endTime}</strong>)}</div>}
          <div className="recess-toolbar"><p>Configurá grupos independientes para cada ciclo o nivel.</p>{canConfigure && !consultationMode && <><Button onClick={() => setGroups(value => [...value, { name: `Grupo ${value.length + 1}`, slots: [] }])}>+ Grupo</Button><Button variant="primary" onClick={async () => { await saveRecessSchedules(groups); setMessage('Recreos guardados.'); await refresh(); }}>Guardar cambios</Button></>}</div>
          <div className="recess-grid">{groups.map((group, groupIndex) => (
            <article className="recess-group-card card" key={group.id || groupIndex}>
              <header><input className="input" value={group.name} disabled={!canConfigure || consultationMode} onChange={event => updateGroup(groupIndex, { name: event.target.value })} /><button disabled={!canConfigure || consultationMode} onClick={() => setGroups(value => value.filter((_, index) => index !== groupIndex))}>Eliminar</button></header>
              <div className="recess-slots">{group.slots.map((slot, slotIndex) => <div className="recess-slot" key={slot.id || slotIndex}><input className="input" value={slot.label} disabled={!canConfigure || consultationMode} onChange={event => updateSlot(groupIndex, slotIndex, { label: event.target.value })} /><input className="input" inputMode="numeric" pattern="[0-2][0-9]:[0-5][0-9]" placeholder="10:00" value={slot.startTime} disabled={!canConfigure || consultationMode} onChange={event => updateSlot(groupIndex, slotIndex, { startTime: event.target.value })} /><span>–</span><input className="input" inputMode="numeric" pattern="[0-2][0-9]:[0-5][0-9]" placeholder="10:15" value={slot.endTime} disabled={!canConfigure || consultationMode} onChange={event => updateSlot(groupIndex, slotIndex, { endTime: event.target.value })} /><button disabled={!canConfigure || consultationMode} onClick={() => updateGroup(groupIndex, { slots: group.slots.filter((_, index) => index !== slotIndex) })}>×</button></div>)}</div>
              {canConfigure && !consultationMode && <Button onClick={() => updateGroup(groupIndex, { slots: [...group.slots, { label: 'Recreo', startTime: '10:00', endTime: '10:15' }] })}>+ Franja</Button>}
            </article>
          ))}</div>
          {!groups.length && <div className="empty-state">Todavía no hay grupos de recreo configurados.</div>}
        </div>
      )}

      {editing && <Modal title={editing.id ? 'Editar horario' : 'Nuevo horario'} onClose={() => setEditing(null)}><form className="stack" onSubmit={saveSchedule}><fieldset className="schedule-level-field"><legend>Nivel</legend><div>{LEVEL_OPTIONS.map(option => <button key={option.value} type="button" className={editing.schoolLevel === option.value ? 'active' : ''} onClick={() => setEditing(value => ({ ...value!, schoolLevel: option.value }))}>{option.short}</button>)}</div></fieldset><label>Docente<input className="input" required value={editing.teacher || ''} onChange={event => setEditing(value => ({ ...value!, teacher: event.target.value }))} /></label><label>Curso<input className="input" required value={editing.course || ''} onChange={event => setEditing(value => ({ ...value!, course: event.target.value }))} /></label><div className="grid-2"><label>Materia<input className="input" value={editing.subject || ''} onChange={event => setEditing(value => ({ ...value!, subject: event.target.value }))} /></label><label>Aula<input className="input" value={editing.room || ''} onChange={event => setEditing(value => ({ ...value!, room: event.target.value }))} /></label></div><label>Día<select className="input" value={editing.dayOfWeek || 1} onChange={event => setEditing(value => ({ ...value!, dayOfWeek: Number(event.target.value) }))}>{DAY_NAMES.slice(1).map((name, index) => <option value={index + 1} key={name}>{name}</option>)}</select></label><div className="grid-2"><label>Desde<input className="input" inputMode="numeric" pattern="[0-2][0-9]:[0-5][0-9]" placeholder="08:00" required value={editing.startTime || ''} onChange={event => setEditing(value => ({ ...value!, startTime: event.target.value }))} /></label><label>Hasta<input className="input" inputMode="numeric" pattern="[0-2][0-9]:[0-5][0-9]" placeholder="08:45" required value={editing.endTime || ''} onChange={event => setEditing(value => ({ ...value!, endTime: event.target.value }))} /></label></div><div className="actions"><Button variant="primary" type="submit">Guardar</Button><Button type="button" onClick={() => setEditing(null)}>Cancelar</Button></div></form></Modal>}
    </section>
  );
}
