import { useMemo } from 'react';
import type { TaskColumn, TaskItem } from '../../types';
import { ProgressRing } from './TaskBits';
import { columnOf, isTaskDone, plural, responsablesOf, turnoText } from './taskModel';

type Person = { name: string; turno?: string };

/**
 * Tareas por persona (solo en el espacio Grupo): por persona, asignadas,
 * pendientes, en proceso, hechas y el avance con un anillo fino neutro. Se
 * calcula con las tareas que ya están en memoria (cero pedidos extra).
 * "Compartida" (y el viejo "Ambos") cuentan para todos.
 */
export function TaskAnalytics({ tasks, columns, people }: { tasks: TaskItem[]; columns: TaskColumn[]; people: Person[] }) {
  const rows = useMemo(() => {
    const names: Person[] = people.length
      ? people
      : Array.from(new Set(tasks.flatMap(task => responsablesOf(task)).filter(name => name && !['Sin asignar', 'Compartida', 'Ambos'].includes(name)))).map(name => ({ name }));
    return names.map(person => {
      const assigned = tasks.filter(task => {
        const list = responsablesOf(task);
        return list.includes(person.name) || list.includes('Compartida') || list.includes('Ambos');
      });
      const open = assigned.filter(task => !isTaskDone(task, columns));
      const pending = open.filter(task => columnOf(task, columns)?.name === 'Pendiente').length;
      const progress = open.filter(task => columnOf(task, columns)?.name === 'En proceso').length;
      const done = assigned.length - open.length;
      return { ...person, assigned: assigned.length, pending, progress, done, pct: assigned.length ? Math.round((done / assigned.length) * 100) : null };
    });
  }, [tasks, columns, people]);

  const others = tasks.filter(task => {
    if (isTaskDone(task, columns)) return false;
    const name = columnOf(task, columns)?.name;
    return name !== 'Pendiente' && name !== 'En proceso';
  }).length;

  if (!rows.length) return null;

  return (
    <section className="tk-people" aria-labelledby="tk-people-title">
      <header className="tk-section-head">
        <div className="tk-section-titles">
          <span className="tk-eyebrow">Grupo</span>
          <h2 id="tk-people-title" className="tk-h2">Tareas por persona</h2>
        </div>
        <span className="tk-hint">Cuenta las tareas del grupo (no las privadas)</span>
      </header>
      <div className="tk-people-table" role="table" aria-label="Tareas por persona">
        <div className="tk-people-row tk-people-row--head" role="row">
          <span role="columnheader" className="tk-people-name">Persona</span>
          <span role="columnheader">Asignadas</span>
          <span role="columnheader">Pendientes</span>
          <span role="columnheader">En proceso</span>
          <span role="columnheader">Hechas</span>
          <span role="columnheader" className="tk-people-ring">Avance</span>
        </div>
        {rows.map(row => (
          <div className="tk-people-row" role="row" key={row.name}>
            <span role="cell" className="tk-people-name">
              <span className="tk-people-who">{row.name}</span>
              {turnoText(row.turno) && <span className="tk-muted tk-small">{turnoText(row.turno)}</span>}
              {!row.assigned && <span className="tk-muted tk-small">Sin tareas asignadas.</span>}
            </span>
            <span role="cell" className="tk-people-num" data-label="Asignadas">{row.assigned}</span>
            <span role="cell" className="tk-people-num tk-text-2" data-label="Pendientes">{row.pending}</span>
            <span role="cell" className="tk-people-num tk-text-2" data-label="En proceso">{row.progress}</span>
            <span role="cell" className="tk-people-num tk-text-2" data-label="Hechas">{row.done}</span>
            <span role="cell" className="tk-people-ring">
              <ProgressRing done={row.done} total={row.assigned} label={row.pct === null ? `${row.name}: sin tareas` : `${row.name}: ${row.done} de ${row.assigned} hechas`} />
              <span className="tk-mono">{row.pct === null ? '—' : `${row.pct}%`}</span>
            </span>
          </div>
        ))}
      </div>
      {others > 0 && <p className="tk-hint">{plural(others, 'tarea abierta está', 'tareas abiertas están')} en columnas propias: suman a Asignadas, no a Pendientes ni En proceso.</p>}
    </section>
  );
}
