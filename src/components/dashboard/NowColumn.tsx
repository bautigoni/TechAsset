import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronRight, Coffee, ListChecks } from 'lucide-react';
import type { AgendaItem, AgendaState, TaskItem } from '../../types';
import { Button, Segmented, StatusText, cx, useStatusLine } from '../../ui';
import { DashEmpty } from './DashEmpty';
import { getRecessSchedules } from '../../services/schedulesApi';
import { minutesFromTime } from '../../utils/dates';
import { nowMinutesAr, todayKeyAr } from '../../utils/formatters';
import { isOverdue } from '../../utils/dates';
import { errorMessage } from '../layout/Feedback';
import { clickableProps } from '../../utils/a11y';
import { agendaNow, isAgendaToday, isMine, topTasks } from './agendaNow';
import { NotesPanel } from './NotesPanel';
import { useSmoothHeight } from './useSmoothHeight';

type RecessSlot = { label: string; startTime: string; endTime: string; groupName?: string };

/** Minuto actual (hora argentina), con un tick por minuto. */
function useNowMinutes() {
  const [now, setNow] = useState(nowMinutesAr);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(nowMinutesAr()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/**
 * Recreos: se piden UNA vez (no se suman al polling) y el "en curso" se
 * calcula acá con el reloj, así "Recreo hasta…" no queda viejo si el Inicio
 * está abierto toda la mañana.
 */
function useRecess(nowMinutes: number) {
  const [slots, setSlots] = useState<RecessSlot[]>([]);
  useEffect(() => {
    let alive = true;
    getRecessSchedules()
      .then(response => {
        if (!alive) return;
        const all = (response.groups || []).flatMap(group => (group.slots || []).map(slot => ({ ...slot, groupName: group.name })));
        setSlots(all as RecessSlot[]);
      })
      // Sin permiso de Horarios o sin recreos: no se muestra nada.
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);
  return useMemo(() => {
    const active = slots.filter(slot => minutesFromTime(slot.startTime) <= nowMinutes && minutesFromTime(slot.endTime) > nowMinutes);
    if (active.length) return { active: true, text: `Recreo hasta ${[...new Set(active.map(slot => slot.endTime))].join(' · ')}` };
    const next = slots
      .filter(slot => minutesFromTime(slot.startTime) > nowMinutes)
      .sort((a, b) => minutesFromTime(a.startTime) - minutesFromTime(b.startTime))[0];
    return next ? { active: false, text: `Recreo ${next.startTime}–${next.endTime}` } : null;
  }, [slots, nowMinutes]);
}

type Tab = 'agenda' | 'tasks' | 'notes';

export function NowColumn({ agenda, tasks, operator, readOnly, canAgenda, canTasks, onAgendaSave, onOpenAgenda, onOpenTasks, onOpenTask }: {
  agenda: AgendaItem[];
  tasks: TaskItem[];
  operator: string;
  readOnly: boolean;
  canAgenda: boolean;
  canTasks: boolean;
  onAgendaSave: (item: Partial<AgendaItem>) => Promise<unknown>;
  onOpenAgenda: () => void;
  onOpenTasks: () => void;
  onOpenTask: (task: TaskItem) => void;
}) {
  const [tab, setTab] = useState<Tab>('agenda');
  const [noteCount, setNoteCount] = useState(0);
  const nowMinutes = useNowMinutes();
  // Mobile: cambiar de pestaña (Agenda / Tareas / Notas) cambia el alto suave.
  const nowRef = useSmoothHeight<HTMLDivElement>(tab);
  const top = useMemo(() => topTasks(tasks, operator), [tasks, operator]);
  const todayCount = useMemo(() => {
    const today = todayKeyAr();
    return agenda.filter(item => isAgendaToday(item, today) && item.estado !== 'Cancelado' && item.estado !== 'Realizado').length;
  }, [agenda]);

  return (
    <div ref={nowRef} className="dash-now" data-tab={tab}>
      {/* Mobile: pestañas Agenda / Tareas / Notas. En pantallas anchas se apilan. */}
      <Segmented<Tab>
        className="dash-now-tabs"
        block
        ariaLabel="Ahora"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'agenda', label: 'Agenda', count: todayCount || undefined },
          { value: 'tasks', label: 'Tareas', count: top.open || undefined },
          { value: 'notes', label: 'Notas', count: noteCount || undefined }
        ]}
      />
      <div className="dash-now-panel" data-panel="agenda">
        <AgendaCard agenda={agenda} nowMinutes={nowMinutes} readOnly={readOnly} canOpen={canAgenda} onSave={onAgendaSave} onOpen={onOpenAgenda} />
      </div>
      <div className="dash-now-panel" data-panel="tasks">
        <TasksCard top={top} operator={operator} canOpen={canTasks} onOpenTasks={onOpenTasks} onOpenTask={onOpenTask} />
      </div>
      <div className="dash-now-panel dash-now-panel--grow" data-panel="notes">
        <NotesPanel operator={operator} readOnly={readOnly} onCount={setNoteCount} />
      </div>
    </div>
  );
}

/* ── Agenda de hoy ─────────────────────────────────────────────────────── */

function AgendaCard({ agenda, nowMinutes, readOnly, canOpen, onSave, onOpen }: {
  agenda: AgendaItem[];
  nowMinutes: number;
  readOnly: boolean;
  canOpen: boolean;
  onSave: (item: Partial<AgendaItem>) => Promise<unknown>;
  onOpen: () => void;
}) {
  const now = useMemo(() => agendaNow(agenda, nowMinutes), [agenda, nowMinutes]);
  const recess = useRecess(nowMinutes);
  const status = useStatusLine();
  const [saving, setSaving] = useState<AgendaState | null>(null);
  const main = now.main;

  const setState = async (item: AgendaItem, estado: AgendaState) => {
    const previous = item.estado;
    setSaving(estado);
    try {
      await onSave({ ...item, estado });
      const name = item.curso || item.actividad;
      status.show({
        tone: 'ok',
        message: <><b>{name}</b> · {estado === 'Entregado' ? 'entregado' : 'realizada'}</>,
        undo: { onUndo: async () => { await onSave({ ...item, estado: previous }); status.show({ tone: 'info', message: `${name}: vuelve a ${previous.toLowerCase()}` }); } }
      });
    } catch (reason) {
      status.show({ tone: 'bad', message: `No se pudo actualizar la agenda · ${errorMessage(reason, 'Error del servidor')}`, retry: { onRetry: () => setState(item, estado) } });
    } finally {
      setSaving(null);
    }
  };

  const left = main && now.current ? minutesFromTime(main.hasta) - nowMinutes : null;
  const eyebrow = now.current ? 'En curso' : now.nextToday ? `Próxima ${main?.desde || ''}` : now.future ? `Próxima · ${main?.fecha ? main.fecha.split('-').reverse().slice(0, 2).join('/') : main?.dia || ''}` : '';
  const stateTone = main?.estado === 'Pendiente' && now.current ? 'warn' : 'normal';

  return (
    <section className="dash-card dash-agenda" aria-labelledby="agenda-titulo">
      <header className="dash-card-head">
        <h2 className="dash-h3" id="agenda-titulo">Agenda de hoy</h2>
        {recess && (
          <span className={cx('dash-recess', recess.active && 'is-active')}>
            <Coffee size={13} strokeWidth={1.7} aria-hidden="true" />
            <span className="g-num">{recess.text}</span>
          </span>
        )}
        {canOpen && <Button size="sm" variant="ghost" className="dash-link" onClick={onOpen}>Ver agenda</Button>}
      </header>
      {main ? (
        <div className="dash-agenda-main">
          <div className="dash-agenda-top">
            <span className="ui-eyebrow">{eyebrow}</span>
            <StatusText tone={stateTone}>{main.estado === 'Pendiente' && now.current ? 'pendiente de entregar' : main.estado.toLowerCase()}</StatusText>
            <span className="dash-grow" />
            <span className="ui-mono dash-sub">{main.desde} – {main.hasta}</span>
          </div>
          <div className="dash-agenda-title">{main.curso || main.actividad}</div>
          <div className="dash-sub">
            {[main.actividad, main.ubicacion].filter(Boolean).join(' · ')}
            {main.cantidad ? <> · <span className="ui-mono dash-strong">{main.cantidad}</span> {main.tipoDispositivo}</> : null}
          </div>
          {left !== null && left >= 0 && <div className="ui-mono dash-sub">faltan {left} min</div>}
          {!readOnly && now.current && (
            <div className="dash-row-wrap dash-agenda-acts">
              {main.estado === 'Pendiente' && <Button size="sm" variant="primary" loading={saving === 'Entregado'} onClick={() => void setState(main, 'Entregado')}>Entregar</Button>}
              <Button size="sm" variant={main.estado === 'Entregado' ? 'primary' : 'secondary'} loading={saving === 'Realizado'} onClick={() => void setState(main, 'Realizado')}>Marcar realizada</Button>
            </div>
          )}
        </div>
      ) : (
        <DashEmpty
          icon={<CalendarDays size={18} strokeWidth={1.6} />}
          title={now.pendingTodayCount ? `${now.pendingTodayCount} pendiente${now.pendingTodayCount === 1 ? '' : 's'} en agenda hoy` : 'Sin actividades hoy'}
          description={now.pendingTodayCount ? undefined : 'No hay entregas ni clases con equipos por delante.'}
          actions={canOpen ? <Button size="sm" variant="ghost" onClick={onOpen}>Ver la semana</Button> : undefined}
        />
      )}
      {status.slot('dash-status dash-status--in')}
      {now.later.length > 0 && (
        <ul className="dash-agenda-next" aria-label="Más tarde">
          {now.later.map(item => (
            <li key={item.id}>
              <span className="ui-mono dash-sub">{item.desde}</span>
              <span className="dash-agenda-next-name"><b>{item.curso || item.actividad}</b>{item.curso && item.actividad ? <span className="dash-sub">{item.actividad}</span> : null}</span>
              <span className="ui-mono dash-sub">{item.cantidad ? `${item.cantidad} ${item.tipoDispositivo}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ── Tus tareas ────────────────────────────────────────────────────────── */

function TasksCard({ top, operator, canOpen, onOpenTasks, onOpenTask }: {
  top: ReturnType<typeof topTasks>;
  operator: string;
  canOpen: boolean;
  onOpenTasks: () => void;
  onOpenTask: (task: TaskItem) => void;
}) {
  return (
    <section className="dash-card dash-tasks" aria-labelledby="tareas-titulo">
      <header className="dash-card-head">
        <h2 className="dash-h3" id="tareas-titulo">{top.mine || !top.list.length ? 'Tus tareas' : 'Tareas del equipo'}</h2>
        <span className="dash-card-meta g-num">{top.open ? `${top.open} ${top.open === 1 ? 'abierta' : 'abiertas'}` : ''}</span>
        {canOpen && <Button size="sm" variant="ghost" className="dash-link" onClick={onOpenTasks}>Ver tareas</Button>}
      </header>
      {top.list.length ? (
        <ul className="dash-task-list">
          {top.list.map(task => {
            const overdue = task.fechaVencimiento && isOverdue(task.fechaVencimiento);
            const due = task.fechaVencimiento ? task.fechaVencimiento.split('-').reverse().slice(0, 2).join('/') : '';
            return (
              <li key={task.id}>
                {/* Fila clickeable (no <button>): el título baja de renglón en vez de cortarse. */}
                <div className={cx('dash-task', !canOpen && 'is-static')} {...(canOpen ? clickableProps(() => onOpenTask(task), `Abrir la tarea ${task.titulo}`) : {})}>
                  <span className="dash-task-text">
                    <span className="dash-task-title">{task.titulo}</span>
                    <span className="dash-sub">
                      <StatusText tone={task.prioridad === 'Urgente' ? 'bad' : 'muted'} strong={task.prioridad === 'Urgente'}>{task.prioridad || 'Sin prioridad'}</StatusText>
                      {' · '}{task.estado}
                      {due ? <> · {overdue ? <StatusText tone="bad">venció el {due}</StatusText> : `vence ${due}`}</> : null}
                      {isMine(task, operator) ? ' · asignada a vos' : task.responsable ? ` · ${task.responsable}` : ''}
                    </span>
                  </span>
                  <ChevronRight size={16} strokeWidth={1.6} aria-hidden="true" className="dash-task-chev" />
                </div>
              </li>
            );
          })}
        </ul>
      ) : <DashEmpty icon={<ListChecks size={18} strokeWidth={1.6} />} title="No hay tareas abiertas" description="Las del equipo y las tuyas aparecen acá por prioridad." />}
    </section>
  );
}
