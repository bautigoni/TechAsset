import { useEffect, useState } from 'react';
import type { AgendaItem, TaskItem } from '../../types';
import { minutesFromTime } from '../../utils/dates';
import { getRecessSchedules } from '../../services/schedulesApi';
import { DailyHandoffChat } from './DailyHandoffChat';

function todayIso() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function normalize(value?: string) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function todayName() {
  return ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'][new Date().getDay()];
}

function isAgendaToday(item: AgendaItem) {
  if (item.fecha) return item.fecha === todayIso();
  return normalize(item.dia) === todayName();
}

function isOpenAgenda(item: AgendaItem) {
  return item.estado !== 'Realizado' && item.estado !== 'Cancelado';
}

function isPendingAgenda(item: AgendaItem) {
  return item.estado === 'Pendiente';
}

function isOpenTask(item: TaskItem) {
  return !item.done && item.estado !== 'Hecha';
}

function taskScore(task: TaskItem) {
  const priority = task.prioridad === 'Urgente' ? 0 : task.prioridad === 'Media' ? 1 : 2;
  const due = task.fechaVencimiento ? new Date(`${task.fechaVencimiento}T00:00:00`).getTime() : Number.MAX_SAFE_INTEGER;
  return priority * 10_000_000_000 + due;
}

export function NowPanel({ agenda, tasks, operator, consultationMode = false, onAgenda, onTasks, onOpenTask }: {
  agenda: AgendaItem[];
  tasks: TaskItem[];
  operator: string;
  consultationMode?: boolean;
  onAgenda: () => void;
  onTasks: () => void;
  onOpenTask?: (task: TaskItem) => void;
}) {
  // Primero las tuyas: la más urgente asignada a vos gana sobre la más urgente
  // del equipo. Si no tenés ninguna abierta, cae a la del equipo.
  const isMine = (task: TaskItem) => {
    const name = String(operator || '').trim().toLowerCase();
    if (!name) return false;
    return String(task.responsable || '').toLowerCase().includes(name)
      || (task.responsables || []).some(item => String(item || '').toLowerCase().includes(name));
  };
  const [activeRecess, setActiveRecess] = useState<Array<{ groupName: string; label: string; startTime: string; endTime: string }>>([]);
  useEffect(() => { getRecessSchedules().then(response => setActiveRecess(response.active || [])).catch(() => setActiveRecess([])); }, []);
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const validAgenda = agenda.filter(item => isOpenAgenda(item) && item.estado !== 'Faltaron equipos');
  const agendaToday = validAgenda.filter(item => isAgendaToday(item));
  const pendingTodayCount = agenda.filter(item => isAgendaToday(item) && isPendingAgenda(item)).length;
  const pendingTasks = tasks.filter(isOpenTask).length;
  const today = todayIso();
  const currentAgenda = agendaToday.find(item => minutesFromTime(item.desde) <= nowMinutes && minutesFromTime(item.hasta) >= nowMinutes && (item.estado === 'Entregado' || item.estado === 'Pendiente'));
  const nextToday = agendaToday
    .filter(item => minutesFromTime(item.desde) > nowMinutes && item.estado === 'Pendiente')
    .sort((a, b) => minutesFromTime(a.desde) - minutesFromTime(b.desde))[0];
  const futureAgenda = validAgenda
    .filter(item => !isAgendaToday(item) && (item.fecha ? item.fecha >= today : true) && item.estado === 'Pendiente')
    .sort((a, b) => String(a.fecha || '9999-12-31').localeCompare(String(b.fecha || '9999-12-31')) || weekdayRank(a.dia) - weekdayRank(b.dia) || minutesFromTime(a.desde) - minutesFromTime(b.desde))[0];
  const nextAgenda = currentAgenda || nextToday || futureAgenda;
  const openTasks = tasks.filter(isOpenTask);
  const mine = openTasks.filter(isMine).sort((a, b) => taskScore(a) - taskScore(b));
  // Hasta dos tareas tuyas. Si no tenés ninguna abierta, cae a la más urgente
  // del equipo; si tampoco hay, el chat se queda con todo el ancho.
  const topTasks = (mine.length ? mine : [...openTasks].sort((a, b) => taskScore(a) - taskScore(b))).slice(0, 2);

  return (
    <section className="card panel-ahora">
      <div className="card-head">
        <div>
          <h3>Ahora</h3>
          <p className="muted">Traspaso del día y tu tarea prioritaria</p>
        </div>
        <div className="head-actions">
          <button className="btn btn-secondary mini-action-btn" type="button" onClick={onAgenda}>Ver Agenda</button>
          <button className="btn btn-secondary mini-action-btn" type="button" onClick={onTasks}>Ver Tareas</button>
        </div>
      </div>
      <div className={`ahora-split ${topTasks.length ? '' : 'is-solo'}`}>
        <DailyHandoffChat operator={operator} consultationMode={consultationMode} />

        {topTasks.length > 0 && (
          <div className="ahora-task">
            <div className="handoff-chat-head">
              <strong>{topTasks.length > 1 ? 'Tus tareas prioritarias' : 'Tu tarea prioritaria'}</strong>
              {activeRecess.length > 0 && <span className="muted">Recreo hasta {activeRecess.map(item => item.endTime).join(' · ')}</span>}
            </div>
            {topTasks.map(task => (
              <button
                key={task.id}
                type="button"
                className={`ahora-task-card prioridad-${String(task.prioridad || '').toLowerCase()}`}
                onClick={() => onOpenTask ? onOpenTask(task) : onTasks()}
              >
                <span className="ahora-task-flag">{task.prioridad || 'Sin prioridad'}{isMine(task) ? ' · asignada a vos' : ''}</span>
                <strong>{task.titulo}</strong>
                <span className="ahora-task-meta">
                  {[task.estado, task.responsable, task.fechaVencimiento ? `vence ${task.fechaVencimiento}` : ''].filter(Boolean).join(' · ')}
                </span>
              </button>
            ))}
            <div className="ahora-agenda-line">
              {nextAgenda
                ? <>{currentAgenda ? 'En curso' : `Próxima ${nextAgenda.desde}`} · {nextAgenda.curso || nextAgenda.actividad}</>
                : pendingTodayCount ? `${pendingTodayCount} pendiente${pendingTodayCount === 1 ? '' : 's'} en agenda hoy` : 'Sin próximas actividades'}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function weekdayRank(day?: string) {
  const order = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  const today = new Date().getDay();
  const idx = order.indexOf(normalize(day));
  return idx < 0 ? 99 : (idx - today + 7) % 7;
}
