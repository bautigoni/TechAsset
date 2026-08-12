import { useEffect, useState } from 'react';
import type { TaskItem } from '../../types';
import { getSiteAssistants } from '../../services/authApi';

export function TaskAnalytics({ tasks }: { tasks: TaskItem[] }) {
  const [sitePeople, setSitePeople] = useState<string[]>([]);
  useEffect(() => {
    getSiteAssistants()
      .then(response => setSitePeople(response.items.map(item => item.name).filter(Boolean)))
      .catch(() => setSitePeople([]));
  }, []);
  const people = sitePeople.length
    ? sitePeople
    : Array.from(new Set(tasks.flatMap(task => task.responsables?.length ? task.responsables : String(task.responsable || '').split(',').map(item => item.trim())).filter(Boolean)));
  return (
    <section className="card assistant-task-analytics">
      <div className="card-head"><h3>Analítica de asistentes</h3><span className="muted">Datos reales de tareas</span></div>
      <div className="grid-2">
        {people.map((person, index) => {
          const assigned = tasks.filter(task => task.responsables?.includes(person) || String(task.responsable || '').split(',').map(v => v.trim()).includes(person) || task.responsable === 'Ambos');
          const done = assigned.filter(task => task.estado === 'Hecha').length;
          const pending = assigned.filter(task => task.estado === 'Pendiente').length;
          const progress = assigned.filter(task => task.estado === 'En proceso').length;
          // Sin tareas asignadas no hay porcentaje que mostrar: 100% verde daba
          // a entender que estaba todo hecho y obligaba a una nota al pie.
          const pct = assigned.length ? Math.round((done / assigned.length) * 100) : null;
          return (
            <div className={`assistant-progress-card assistant-progress-${index}`} key={person}>
              <div className="assistant-progress-head">
                <strong>{person}</strong>
                <span>{pct === null ? '—' : `${pct}%`}</span>
              </div>
              <div className="progress assistant-progress"><span style={{ width: `${pct ?? 0}%` }} /></div>
              <div className="assistant-progress-grid">
                <span>Asignadas</span><strong>{assigned.length}</strong>
                <span>Pendientes</span><strong>{pending}</strong>
                <span>En proceso</span><strong>{progress}</strong>
                <span>Hechas</span><strong>{done}</strong>
              </div>
              {!assigned.length && <p className="muted">Sin tareas asignadas.</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
