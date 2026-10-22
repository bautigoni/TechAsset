import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { AgendaItem } from '../../types';
import { Button, Collapse, InlineConfirm, StatusText, Textarea, TruncatedText, cx, icons } from '../../ui';
import { AgendaForm } from './AgendaForm';
import { smoothHeight } from '../../utils/motion';
import { cap1, isEnCurso, longDate, retiredInfo, shortDateTime, shortLabel, statusOf, turnoLabel, type Clock } from './agendaModel';

/** Lo que la pantalla le presta a cada fila (Día, Mes, Semana, Historial). */
export type AgendaActions = {
  consultation: boolean;
  items: AgendaItem[];
  clock: Clock;
  frequent: string[];
  /** id → acción en curso ("deliver", "retire", "nota"…) para el spinner del botón. */
  busy: Record<string, string>;
  /**
   * Cambia campos de una actividad. `undo` = deja Deshacer en la línea de
   * estado; `global` = la línea de la cabecera (pushStatus), que se ve desde
   * cualquier fila, y un segundo toque enseguida no encadena otra acción.
   */
  patch: (item: AgendaItem, patch: Partial<AgendaItem>, options: { kind: string; message?: string; undo?: boolean; global?: boolean }) => Promise<boolean>;
  remove: (item: AgendaItem) => Promise<boolean>;
  createTask: (item: AgendaItem) => Promise<void>;
  /** Edición completa desde el formulario en línea (tira el error para mostrarlo en el form). */
  edit: (item: AgendaItem, payload: Partial<AgendaItem>) => Promise<void>;
};


const equipos = (item: AgendaItem) => `${item.cantidad} ${item.tipoDispositivo}`.trim();

/**
 * Entregar y retirar: acciones explícitas (el botón dice lo que hace), con
 * Deshacer en la línea de estado. Antes "✓ Entregado" parecía una etiqueta y
 * tocarlo volvía la actividad a pendiente sin aviso.
 */
export const agendaQuick = {
  deliver: (actions: AgendaActions, item: AgendaItem) => actions.patch(item, { estado: 'Entregado' }, {
    kind: 'deliver', global: true, undo: true,
    message: `${shortLabel(item)}: ${equipos(item)} entregados en ${item.ubicacion || 'el aula'}. Cuando vuelvan al depósito, marcalos retirados.`
  }),
  undeliver: (actions: AgendaActions, item: AgendaItem) => actions.patch(item, { estado: 'Pendiente' }, {
    kind: 'deliver', global: true, undo: true, message: `${shortLabel(item)} volvió a pendiente: los equipos figuran sin entregar.`
  }),
  retire: (actions: AgendaActions, item: AgendaItem) => actions.patch(item, { compusRetiradas: item.cantidad }, {
    kind: 'retire', global: true, undo: true, message: `${shortLabel(item)}: ${equipos(item)} retirados del aula.`
  }),
  unretire: (actions: AgendaActions, item: AgendaItem) => actions.patch(item, { compusRetiradas: 0 }, {
    kind: 'retire', global: true, undo: true, message: `${shortLabel(item)}: los equipos vuelven a figurar sin retirar.`
  })
};

/** La acción que conviene en la fila: entregar lo pendiente, retirar lo entregado; nada si ya está todo. */
export function nextQuick(item: AgendaItem) {
  const ret = retiredInfo(item);
  if (item.estado === 'Pendiente') return 'deliver' as const;
  if (ret.canRetire && !ret.all) return 'retire' as const;
  return null;
}

/** Un click en cualquier lugar de la fila la abre; los botones de adentro no (y en touch, tocar un texto cortado lo despliega). */
export function rowClickOpens(event: MouseEvent<HTMLElement>) {
  const target = event.target as HTMLElement;
  if (target.closest('button, a, input, textarea, [role="checkbox"]')) return false;
  const pointer = (event.nativeEvent as PointerEvent).pointerType;
  if ((pointer === 'touch' || pointer === 'pen') && target.closest('.ui-trunc.is-cut')) return false;
  return true;
}

export function AgendaRow({ item, open, onToggle, actions, showDay }: {
  item: AgendaItem;
  open: boolean;
  onToggle: (id: string) => void;
  actions: AgendaActions;
  /** Historial: muestra el día además del horario. */
  showDay?: boolean;
}) {
  const { clock, consultation, busy } = actions;
  const st = statusOf(item, clock);
  const ret = retiredInfo(item);
  const quick = nextQuick(item);
  const live = isEnCurso(item, clock);
  const cancelled = item.estado === 'Cancelado';
  const working = busy[item.id];
  const sub = live ? 'en curso' : showDay ? (item.fecha ? item.fecha.split('-').reverse().join('/') : item.dia) : item.fecha ? 'una vez' : 'semanal';
  const label = `${item.curso}, ${item.actividad}, ${item.desde} a ${item.hasta}, ${st.label}`;

  return (
    <div className={cx('ag-item', open && 'is-open')} data-agenda-id={item.id}>
      <div className="ag-row" onClick={event => { if (rowClickOpens(event)) onToggle(item.id); }}>
        <div className="ag-row-main">
          <span className="ag-c-time">
            <span className="ag-time g-num">{item.desde}–{item.hasta}</span>
            <span className={cx('ag-sub', live && 'is-live')}>{sub}</span>
          </span>
          <span className="ag-c-what">
            <TruncatedText className={cx('ag-curso', cancelled && 'is-cancelled')}>{item.curso || 'Sin curso'}</TruncatedText>
            <TruncatedText className="ag-what" lines={2}>{`${item.actividad || 'Actividad'} · ${item.ubicacion || 'sin ubicación'}`}</TruncatedText>
          </span>
          <span className="ag-c-eq g-num">{item.cantidad} {item.tipoDispositivo}</span>
          <span className="ag-c-st">
            <StatusText tone={st.tone}>{st.label}</StatusText>
            {ret.text && <StatusText tone={ret.tone} className="ag-ret">{ret.text}</StatusText>}
          </span>
          <button type="button" className="ag-toggle ui-icon-btn ui-btn--ghost ui-btn--sm" aria-expanded={open} aria-controls={`ag-detail-${item.id}`} aria-label={`${open ? 'Ocultar' : 'Ver'} detalle: ${label}`} onClick={() => onToggle(item.id)}>
            <icons.IconChevronDown size={16} className="ag-chev" />
          </button>
        </div>
        {quick && (
          <div className="ag-row-act">
            <Button
              size="sm"
              variant="secondary"
              className="ag-quick"
              disabled={consultation}
              loading={working === quick}
              loadingLabel="Guardando…"
              aria-label={quick === 'deliver' ? `Marcar entregados los ${equipos(item)} de ${item.curso || 'esta actividad'}` : `Marcar retirados del aula los ${equipos(item)} de ${item.curso || 'esta actividad'}`}
              onClick={() => void agendaQuick[quick](actions, item)}
            >
              {quick === 'deliver' ? 'Marcar entregados' : 'Marcar retirados'}
            </Button>
          </div>
        )}
      </div>
      {/* El detalle se abre y se cierra con el colapso compartido (la fila tocada no se mueve); queda montado para no perder una nota a medio escribir. */}
      <Collapse open={open} id={`ag-detail-${item.id}`}>
        <AgendaDetail item={item} actions={actions} />
      </Collapse>
    </div>
  );
}

type Ask = null | 'cancel' | 'delete';

export function AgendaDetail({ item, actions }: { item: AgendaItem; actions: AgendaActions }) {
  const { clock, consultation, busy } = actions;
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [ask, setAsk] = useState<Ask>(null);
  const [note, setNote] = useState(item.nota || '');
  const [noteDirty, setNoteDirty] = useState(false);
  // Si la nota cambia desde otro lado (poll) y no se está escribiendo, se actualiza.
  useEffect(() => { if (!noteDirty) setNote(item.nota || ''); }, [item.nota, noteDirty]);

  const st = statusOf(item, clock);
  const ret = retiredInfo(item);
  const delivered = item.estado === 'Entregado';
  const finished = item.estado === 'Realizado' || item.estado === 'Cancelado' || item.estado === 'Faltaron equipos';
  const short = shortLabel(item);
  const working = busy[item.id];
  const lastChange = item.ultimaModificacion ? shortDateTime(item.ultimaModificacion) : '';
  // Detalle ↔ edición: el contenedor pasa de un alto al otro suave (nada de golpe).
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const switchMode = (next: 'view' | 'edit') => smoothHeight(wrapRef.current, () => setMode(next));

  if (mode === 'edit') {
    return (
      <div ref={wrapRef} className="ag-detail ag-detail--form" role="region" aria-label={`Editar ${item.curso} · ${item.actividad}`}>
        <AgendaForm
          initial={item}
          items={actions.items}
          clock={clock}
          frequent={actions.frequent}
          onCancel={() => switchMode('view')}
          onSubmit={async payload => { await actions.edit(item, payload); switchMode('view'); }}
        />
      </div>
    );
  }

  const fields: Array<{ k: string; v: string; tone?: 'muted' | 'state'; mono?: boolean }> = [
    { k: 'Horario', v: `${item.fecha ? cap1(longDate(item.fecha)) : item.dia} · ${item.desde}–${item.hasta} · ${turnoLabel(item.turno)}` },
    { k: 'Equipos', v: `${item.cantidad} ${item.tipoDispositivo} · ${item.ubicacion || 'sin ubicación'}` },
    { k: 'Estado', v: st.label, tone: 'state' },
    { k: 'Retirados del aula', v: `${ret.retired} de ${ret.expected}`, mono: true },
    { k: 'Se repite', v: item.fecha ? `Solo el ${longDate(item.fecha)}` : 'Todas las semanas' },
    { k: 'Último cambio', v: lastChange ? `${lastChange} · ${item.operadorUltimoCambio || 'sin operador'}` : 'Sin cambios registrados', tone: 'muted' }
  ];

  const saveNote = async () => {
    const ok = await actions.patch(item, { nota: note }, { kind: 'nota', message: `Nota guardada en ${short}.`, undo: true });
    if (ok) setNoteDirty(false);
  };

  return (
    <div ref={wrapRef} className="ag-detail" role="region" aria-label={`Detalle de ${item.curso} · ${item.actividad}`}>
      <div className="ag-detail-grid">
        <dl className="ag-dl">
          {fields.map(field => (
            <div key={field.k} className="ag-dl-item">
              <dt>{field.k}</dt>
              <dd className={cx(field.mono && 'g-num', field.tone === 'muted' && 'is-muted')}>
                {field.tone === 'state' ? <StatusText tone={st.tone}>{field.v}</StatusText> : field.v}
              </dd>
            </div>
          ))}
        </dl>
        <div className="ag-note">
          <Textarea
            label="Nota"
            minRows={3}
            value={note}
            readOnly={consultation}
            placeholder={consultation ? 'Sin nota.' : 'Sin nota. Escribí algo para el equipo TIC.'}
            onValueChange={value => { setNote(value); setNoteDirty(value !== (item.nota || '')); }}
          />
          <Collapse open={noteDirty && !consultation}>
            <div className="ag-note-actions">
              <Button size="sm" variant="secondary" loading={working === 'nota'} loadingLabel="Guardando…" onClick={saveNote}>Guardar nota</Button>
              <Button size="sm" variant="ghost" onClick={() => { setNote(item.nota || ''); setNoteDirty(false); }}>Descartar</Button>
            </div>
          </Collapse>
        </div>
      </div>

      <p className="ag-note-small ag-legend">Entregados: los equipos se llevaron al aula. Retirados: ya volvieron al depósito. Ninguno de los dos registra un préstamo.</p>

      {/* Acciones ↔ confirmación: una se pliega mientras la otra se abre. */}
      <Collapse open={ask === 'cancel'} unmountOnClose>
        <InlineConfirm
          message={`¿Cancelar ${short}?`}
          detail="Queda en el historial y sale de los calendarios suscriptos."
          confirmLabel="Sí, cancelar"
          cancelLabel="No"
          busy={working === 'cancel'}
          onCancel={() => setAsk(null)}
          onConfirm={async () => { await actions.patch(item, { estado: 'Cancelado' }, { kind: 'cancel', message: `${short} cancelada.`, undo: true }); setAsk(null); }}
        />
      </Collapse>
      <Collapse open={ask === 'delete'} unmountOnClose>
        <InlineConfirm
          danger
          message={`¿Borrar ${short} de la agenda?`}
          detail="Se puede deshacer desde el aviso que aparece arriba de la lista."
          confirmLabel="Borrar"
          cancelLabel="No"
          busy={working === 'delete'}
          onCancel={() => setAsk(null)}
          onConfirm={async () => { const ok = await actions.remove(item); if (!ok) setAsk(null); }}
        />
      </Collapse>
      <Collapse open={!ask} lazy={false}>
        <div className="ag-detail-actions">
          <Button size="sm" variant="primary" disabled={consultation} loading={working === 'deliver'} loadingLabel="Guardando…" onClick={() => void (delivered ? agendaQuick.undeliver : agendaQuick.deliver)(actions, item)}>
            {delivered ? 'Volver a pendiente' : 'Marcar entregados'}
          </Button>
          <Button size="sm" variant="secondary" disabled={consultation} loading={working === 'retire'} onClick={() => void (ret.all ? agendaQuick.unretire : agendaQuick.retire)(actions, item)}>
            {ret.all ? 'Desmarcar retirados' : 'Marcar retirados'}
          </Button>
          <Button size="sm" variant="secondary" disabled={consultation} loading={working === 'task'} onClick={() => actions.createTask(item)}>Crear tarea</Button>
          <Button size="sm" variant="secondary" disabled={consultation} onClick={() => switchMode('edit')}>Editar</Button>
          <span className="ag-divider" aria-hidden="true" />
          {item.estado !== 'Realizado' && (
            <Button size="sm" variant="ghost" disabled={consultation} loading={working === 'done'} onClick={() => actions.patch(item, { estado: 'Realizado' }, { kind: 'done', message: `${short} quedó como realizada.`, undo: true })}>Marcar realizada</Button>
          )}
          {item.estado !== 'Faltaron equipos' && (
            <Button size="sm" variant="ghost" disabled={consultation} loading={working === 'missing'} onClick={() => actions.patch(item, { estado: 'Faltaron equipos' }, { kind: 'missing', message: `${short}: faltaron equipos.`, undo: true })}>Faltaron equipos</Button>
          )}
          {finished && (
            <Button size="sm" variant="ghost" disabled={consultation} loading={working === 'reopen'} onClick={() => actions.patch(item, { estado: 'Pendiente' }, { kind: 'reopen', message: `${short} volvió a pendiente.`, undo: true })}>Reabrir</Button>
          )}
          <span className="ag-spacer" aria-hidden="true" />
          {!item.estado.startsWith('Cancel') && <Button size="sm" variant="ghost" disabled={consultation} onClick={() => setAsk('cancel')}>Cancelar evento</Button>}
          <Button size="sm" variant="ghost" className="ag-danger" disabled={consultation} onClick={() => setAsk('delete')}>Borrar</Button>
        </div>
      </Collapse>
    </div>
  );
}
