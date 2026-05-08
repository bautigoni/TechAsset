import type { AgendaItem, TaskItem } from '../../types';
import { minutesFromTime } from '../../utils/dates';

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
  return item.estado !== 'Hecha';
}

function taskScore(task: TaskItem) {
  const priority = task.prioridad === 'Urgente' ? 0 : task.prioridad === 'Media' ? 1 : 2;
  const due = task.fechaVencimiento ? new Date(`${task.fechaVencimiento}T00:00:00`).getTime() : Number.MAX_SAFE_INTEGER;
  return priority * 10_000_000_000 + due;
}

export function NowPanel({ agenda, tasks, onAgenda, onTasks }: { agenda: AgendaItem[]; tasks: TaskItem[]; onAgenda: () => void; onTasks: () => void }) {
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
  const urgentTask = [...tasks.filter(isOpenTask)].sort((a, b) => taskScore(a) - taskScore(b))[0];

  return (
    <section className="card panel-ahora">
      <div className="card-head">
        <div>
          <h3>Ahora</h3>
          <p className="muted">Agenda y tareas del día</p>
        </div>
        <div className="head-actions">
          <button className="btn btn-secondary mini-action-btn" type="button" onClick={onAgenda}>Ver Agenda</button>
          <button className="btn btn-secondary mini-action-btn" type="button" onClick={onTasks}>Ver Tareas</button>
        </div>
      </div>
      <div className="ahora-grid">
        <div className="list-item">
          <div className="muted">Agenda de hoy</div>
          <strong>{pendingTodayCount ? `${pendingTodayCount} pendiente${pendingTodayCount === 1 ? '' : 's'} hoy` : agendaToday.length ? `${agendaToday.length} en curso hoy` : 'Sin pendientes hoy'}</strong>
        </div>
        <div className="list-item">
          <div className="muted">Próxima agenda</div>
          <strong>{nextAgenda ? `${currentAgenda ? 'En curso' : nextAgenda.desde} · ${nextAgenda.curso || nextAgenda.actividad}` : 'Sin próximas actividades'}</strong>
        </div>
        <div className="list-item">
          <div className="muted">Tarea urgente</div>
          <strong>{urgentTask ? `${urgentTask.titulo} · ${urgentTask.responsable}` : pendingTasks ? `${pendingTasks} tareas por resolver` : 'Sin tareas pendientes'}</strong>
        </div>
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
