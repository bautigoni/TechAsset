import type { TaskItem } from '../../types';

export function TaskAnalytics({ tasks }: { tasks: TaskItem[] }) {
  const people = ['Bauti', 'Equi'];
  return (
    <section className="card assistant-task-analytics">
      <div className="card-head"><h3>Analitica de asistentes</h3><span className="muted">Datos reales de tareas</span></div>
      <div className="grid-2">
        {people.map((person, index) => {
          const assigned = tasks.filter(task => task.responsables?.includes(person) || String(task.responsable || '').split(',').map(v => v.trim()).includes(person) || task.responsable === 'Ambos');
          const done = assigned.filter(task => task.estado === 'Hecha').length;
          const pending = assigned.filter(task => task.estado === 'Pendiente').length;
          const progress = assigned.filter(task => task.estado === 'En proceso').length;
          const pct = assigned.length ? Math.round((done / assigned.length) * 100) : 100;
          return (
            <div className={`assistant-progress-card assistant-progress-${index}`} key={person}>
              <div className="assistant-progress-head">
                <strong>{person}</strong>
                <span>{pct}%</span>
              </div>
              <div className="progress assistant-progress"><span style={{ width: `${pct}%` }} /></div>
              <div className="assistant-progress-grid">
                <span>Asignadas</span><strong>{assigned.length}</strong>
                <span>Pendientes</span><strong>{pending}</strong>
                <span>En proceso</span><strong>{progress}</strong>
                <span>Hechas</span><strong>{done}</strong>
              </div>
              {!assigned.length && <p className="muted">Sin tareas pendientes asignadas: se muestra 100% porque no hay trabajo abierto.</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
