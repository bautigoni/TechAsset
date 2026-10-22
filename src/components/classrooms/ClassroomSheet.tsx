import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { Classroom, ClassroomCategory, ClassroomHistoryEntry, ClassroomIncident, ClassroomIncidentSummary, ClassroomItemState, Operator } from '../../types';
import { fetchClassroom, fetchClassroomHealth, fetchClassroomHistory, fetchClassroomIncidents, generateClassroomHealth, updateClassroom, type ClassroomHealthReport } from '../../services/classroomsApi';
import { createTicket } from '../../services/ticketsApi';
import { Button, Checkbox, Collapse, Disclosure, EmptyState, ErrorState, Eyebrow, IconButton, Input, Ring, Segmented, SkeletonText, StatusSlot, StatusText, Textarea, TruncatedText, cx, useStatusLine } from '../../ui';
import { IconX } from '../../ui/icons';
import { errorMessage } from '../layout/Feedback';
import { DATE_ONLY, formatDate } from '../../utils/formatters';
import { focusQuietly, revealInline } from '../../utils/reveal';
import { RelatedReminders } from '../reminders/RelatedReminders';
import { DEFAULT_EQUIPMENT_OPTIONS, ITEM_STATES, calcGeneral, describeEquipmentChange, fieldLabel, generalTone, getEquipment, issuesOf, itemTone, normalizeClassroom } from './classroomState';
import { IconObs, IconProblem } from './plan/FloorPlan';

type Health = { report: ClassroomHealthReport; generatedAt: string; generatedBy: string } | null;
const EMPTY_SUMMARY: ClassroomIncidentSummary = { open: 0, closed: 0, total: 0, lastIncidentAt: '', commonCategories: [] };
const SHORT_DT: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false };
const HISTORY_PAGE = 20;

function payloadOf(item: Classroom, nombre: string, piso: string, categories: ClassroomCategory[], operator: Operator) {
  return {
    nombre: item.nombre || nombre,
    piso: piso || item.piso,
    proyector: item.proyector,
    nuc: item.nuc,
    monitor: item.monitor,
    tecladoMouse: item.tecladoMouse,
    equipment: getEquipment(item, categories),
    observaciones: item.observaciones,
    operator
  };
}

/** Cuántas cosas cambió el borrador respecto de lo guardado. */
function countChanges(saved: Classroom | null, draft: Classroom | null) {
  if (!saved || !draft) return 0;
  let n = 0;
  for (const item of draft.equipment) {
    const before = saved.equipment.find(entry => entry.key === item.key);
    if (!before || before.state !== item.state) n += 1;
  }
  for (const item of saved.equipment) if (!draft.equipment.some(entry => entry.key === item.key)) n += 1;
  if ((saved.observaciones || '') !== (draft.observaciones || '')) n += 1;
  return n;
}

function Section({ title, aside, children, className, id }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={cx('cls-sec', className)} aria-labelledby={id}>
      <div className="cls-sec-head">
        <h3 className="cls-h3" id={id}>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export type ClassroomSheetProps = {
  roomKey: string;
  nombre: string;
  piso: string;
  siteCode: string;
  operator: Operator;
  consultationMode: boolean;
  categories: ClassroomCategory[];
  onSaved: (item: Classroom) => void;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onNavigate?: (view: 'tickets' | 'reminders') => void;
  /** Se llama justo ANTES de un cambio de alto de la ficha (datos que llegan, diagnóstico, incidentes): la página lo anima. */
  onGrow?: () => void;
  /** Confirmación de "cambios sin guardar" que manda la página (va arriba de todo). */
  guard?: ReactNode;
};

/**
 * Ficha del aula EN LÍNEA (antes el modal ClassroomInfoPanel): columna al lado
 * del plano en desktop, debajo en pantallas angostas. Nada flota.
 */
export function ClassroomSheet({ roomKey, nombre, piso, siteCode, operator, consultationMode, categories, onSaved, onClose, onDirtyChange, onNavigate, onGrow, guard }: ClassroomSheetProps) {
  const growRef = useRef(onGrow);
  growRef.current = onGrow;
  const grow = useCallback(() => growRef.current?.(), []);
  const rootRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const categoriesRef = useRef(categories);
  categoriesRef.current = categories;
  const [classroom, setClassroom] = useState<Classroom | null>(null);
  const [draft, setDraft] = useState<Classroom | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [history, setHistory] = useState<ClassroomHistoryEntry[]>([]);
  const [historyShown, setHistoryShown] = useState(HISTORY_PAGE);
  const [incidents, setIncidents] = useState<ClassroomIncident[]>([]);
  const [incidentSummary, setIncidentSummary] = useState<ClassroomIncidentSummary>(EMPTY_SUMMARY);
  const [incidentsError, setIncidentsError] = useState('');
  const [health, setHealth] = useState<Health>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [healthError, setHealthError] = useState('');
  const [editEquipment, setEditEquipment] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ticketOpen, setTicketOpen] = useState(false);
  const status = useStatusLine();

  // Al abrir: foco en el título (sin mover el scroll) y, si la ficha quedó
  // fuera de vista (debajo del plano en mobile), se la trae.
  useEffect(() => {
    focusQuietly(headingRef.current);
    revealInline(rootRef.current, 'start');
  }, []);

  // Contexto para el Asistente (sabe en qué aula estás).
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('techasset:assistant-context', { detail: { type: 'classroom', id: roomKey, label: nombre, data: { piso } } }));
    return () => { window.dispatchEvent(new CustomEvent('techasset:assistant-context-clear', { detail: { type: 'classroom', id: roomKey } })); };
  }, [roomKey, nombre, piso]);

  // Carga. Depende SOLO del aula y del reintento: un refresco de categorías
  // en la página no vuelve a pedir el aula ni pisa el borrador. Todo llega en
  // un solo cambio (aula, historial, incidentes, diagnóstico): la ficha pasa
  // del esqueleto a su alto final una sola vez y suave, no en cuatro saltos.
  useEffect(() => {
    let cancelled = false;
    setLoadError('');
    void Promise.allSettled([
      fetchClassroom(roomKey, nombre, piso),
      fetchClassroomHistory(roomKey),
      fetchClassroomIncidents(roomKey),
      fetchClassroomHealth(roomKey)
    ]).then(([room, hist, inc, dx]) => {
      if (cancelled) return;
      grow();
      if (hist.status === 'fulfilled' && hist.value.ok) setHistory(hist.value.items);
      if (inc.status === 'fulfilled') {
        if (inc.value.ok) {
          setIncidents(inc.value.items || []);
          setIncidentSummary(inc.value.summary || EMPTY_SUMMARY);
        }
        setIncidentsError('');
      } else setIncidentsError(errorMessage(inc.reason, 'No se pudieron cargar los incidentes.'));
      if (dx.status === 'fulfilled' && dx.value.report) setHealth({ report: dx.value.report, generatedAt: dx.value.generatedAt, generatedBy: dx.value.generatedBy });
      if (room.status === 'rejected') { setLoadError(errorMessage(room.reason, 'No se pudo cargar el aula.')); return; }
      if (!room.value.ok) { setLoadError('No se pudo cargar el aula.'); return; }
      const item = normalizeClassroom(room.value.item, categoriesRef.current);
      setClassroom(item);
      setDraft(item);
    });
    return () => { cancelled = true; };
  }, [roomKey, nombre, piso, attempt, grow]);

  const changes = useMemo(() => countChanges(classroom, draft), [classroom, draft]);
  const dirty = changes > 0;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  // Cerrar o recargar la pestaña con cambios sin guardar: el navegador pregunta.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const reloadIncidents = useCallback(async () => {
    try {
      const response = await fetchClassroomIncidents(roomKey);
      grow();
      setIncidents(response.items || []);
      setIncidentSummary(response.summary || EMPTY_SUMMARY);
      setIncidentsError('');
    } catch (reason) {
      grow();
      setIncidentsError(errorMessage(reason, 'No se pudieron cargar los incidentes.'));
    }
  }, [roomKey, grow]);

  const reloadHistory = useCallback(async () => {
    try {
      const response = await fetchClassroomHistory(roomKey);
      if (response.ok) setHistory(response.items);
    } catch { /* el historial es secundario: la ficha sigue */ }
  }, [roomKey]);

  const header = (
    <div className="cls-sheet-head">
      <div className="cls-grow">
        <Eyebrow>{`Ficha del aula · ${piso}`}</Eyebrow>
        <h2 className="cls-h2 cls-sheet-title" ref={headingRef} tabIndex={-1}>{draft?.nombre || nombre}</h2>
      </div>
      <IconButton label="Cerrar ficha (Esc)" icon={<IconX size={18} />} onClick={onClose} />
    </div>
  );

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onClose(); }
  };

  if (!draft || !classroom) {
    return (
      <aside ref={rootRef} className="cls-card cls-sheet" aria-label={`Ficha del aula ${nombre}`} onKeyDown={onKeyDown} data-scanner-ignore="">
        {guard}
        {header}
        <div className="cls-sec">
          {loadError
            ? <ErrorState message={loadError} onRetry={() => { grow(); setAttempt(value => value + 1); }} />
            : <SkeletonText lines={5} />}
        </div>
      </aside>
    );
  }

  const equipment = draft.equipment;
  const estado = calcGeneral(equipment);
  const issues = issuesOf(equipment);
  const catalog = categories.length ? categories : DEFAULT_EQUIPMENT_OPTIONS;
  const locked = consultationMode || saving;

  const setItemState = (key: string, state: ClassroomItemState) => {
    setDraft(current => {
      if (!current) return current;
      const next = current.equipment.map(item => item.key === key ? { ...item, state } : item);
      return { ...current, equipment: next, estadoGeneral: calcGeneral(next), ...(key in current ? { [key]: state } : {}) };
    });
  };
  const toggleEquipment = (key: string) => {
    setDraft(current => {
      if (!current) return current;
      const option = catalog.find(item => item.key === key);
      if (!option) return current;
      const exists = current.equipment.some(item => item.key === key);
      if (exists && current.equipment.length === 1) return current;
      const next = exists ? current.equipment.filter(item => item.key !== key) : [...current.equipment, { key, label: option.label, state: 'Sin revisar' as ClassroomItemState }];
      return { ...current, equipment: next, estadoGeneral: calcGeneral(next) };
    });
  };

  const save = async () => {
    if (saving || !dirty) return;
    const before = classroom;
    setSaving(true);
    status.clear();
    try {
      const response = await updateClassroom(roomKey, payloadOf(draft, nombre, piso, categories, operator));
      const saved = normalizeClassroom(response.item, categories);
      setClassroom(saved);
      setDraft(saved);
      onSaved(saved);
      void reloadHistory();
      status.show({
        tone: 'ok',
        message: `Cambios guardados en ${saved.nombre || nombre}.`,
        undo: consultationMode ? undefined : {
          seconds: 10,
          onUndo: async () => {
            const response2 = await updateClassroom(roomKey, payloadOf(before, nombre, piso, categories, operator));
            const restored = normalizeClassroom(response2.item, categories);
            setClassroom(restored);
            setDraft(restored);
            onSaved(restored);
            void reloadHistory();
            status.show({ tone: 'info', message: 'Se volvió al estado anterior.' });
          }
        }
      });
    } catch (reason) {
      // El borrador queda tal cual: nada de lo cargado se pierde.
      status.show({ tone: 'bad', message: errorMessage(reason, 'No se pudo guardar. Revisá la conexión.'), retry: { onRetry: save } });
    } finally {
      setSaving(false);
    }
  };

  const generate = async () => {
    if (healthBusy) return;
    setHealthBusy(true);
    setHealthError('');
    try {
      const response = await generateClassroomHealth(roomKey);
      grow();
      setHealth({ report: response.report, generatedAt: response.generatedAt, generatedBy: response.generatedBy || '' });
    } catch (reason) {
      grow();
      setHealthError(errorMessage(reason, 'No se pudo generar el análisis.'));
    } finally {
      setHealthBusy(false);
    }
  };

  return (
    <aside ref={rootRef} className="cls-card cls-sheet ui-enter" aria-label={`Ficha del aula ${draft.nombre || nombre}`} onKeyDown={onKeyDown} data-scanner-ignore="">
      {guard}
      {header}

      <div className="cls-sheet-summary">
        <StatusText tone={generalTone(estado)} strong className="cls-sheet-state">
          {estado === 'Problema' && <IconProblem size={14} />}
          {estado === 'Con observaciones' && <IconObs size={14} />}
          {estado}
        </StatusText>
        {/* Siempre un renglón (lo que falla, o nada): cambiar un estado no corre la ficha hacia abajo. */}
        <TruncatedText className="cls-sheet-issues">{issues.length ? issues.join(' · ') : ' '}</TruncatedText>
      </div>
      <div className="cls-actions cls-sheet-actions">
        <Button variant="secondary" aria-expanded={ticketOpen} disabled={consultationMode} onClick={() => setTicketOpen(open => !open)}>Crear ticket</Button>
      </div>

      <Collapse open={ticketOpen} unmountOnClose>
        <TicketForm
          nombre={draft.nombre || nombre}
          roomKey={roomKey}
          issues={issues}
          onCancel={() => setTicketOpen(false)}
          onCreated={label => {
            setTicketOpen(false);
            void reloadIncidents();
            status.show({ tone: 'ok', message: `Ticket ${label} creado y vinculado a ${draft.nombre || nombre}.`, action: onNavigate ? { label: 'Ver en Tickets', onClick: () => onNavigate('tickets') } : undefined, autoHideMs: 12000 });
          }}
        />
      </Collapse>

      <StatusSlot status={status} className="cls-sheet-status" />

      {/* ── Equipamiento ─────────────────────────────────────────── */}
      <Section
        id={`cls-eq-${roomKey}`}
        title={<>Equipamiento <span className="cls-count">{equipment.length}</span></>}
        aside={<Button size="sm" variant="ghost" aria-expanded={editEquipment} disabled={locked} onClick={() => setEditEquipment(open => !open)}>{editEquipment ? 'Listo' : 'Editar equipamiento'}</Button>}
      >
        <Collapse open={editEquipment}>
          <div className="cls-eq-config">
            <div className="cls-eq-checks">
              {catalog.map(option => {
                const active = equipment.some(item => item.key === option.key);
                const last = active && equipment.length === 1;
                return (
                  <Checkbox
                    key={option.key}
                    label={option.label}
                    checked={active}
                    disabled={locked || last}
                    onCheckedChange={() => toggleEquipment(option.key)}
                  />
                );
              })}
            </div>
            <p className="cls-help">Lo que sumás arranca en Sin revisar. Tiene que quedar al menos un equipo.</p>
          </div>
        </Collapse>
        <div className="cls-eq-list">
          {equipment.map(item => {
            const before = classroom.equipment.find(entry => entry.key === item.key);
            const allowed = (categories.find(category => category.key === item.key)?.options || ITEM_STATES);
            const options = allowed.includes(item.state) ? allowed : [...allowed, item.state];
            return (
              <div key={item.key} className="cls-eq-item">
                <div className="cls-eq-name">
                  <span className="cls-eq-label">{item.label}</span>
                  {!before && <span className="cls-was">nuevo</span>}
                  {before && before.state !== item.state && <span className="cls-was">antes: {before.state}</span>}
                </div>
                <Segmented<ClassroomItemState>
                  ariaLabel={`Estado de ${item.label}`}
                  size="sm"
                  value={item.state}
                  disabled={locked}
                  onChange={state => setItemState(item.key, state)}
                  className="cls-eq-states"
                  options={ITEM_STATES.filter(state => options.includes(state)).map(state => ({ value: state, label: <span className={`cls-tone-${itemTone(state)}`}>{state}</span> }))}
                />
              </div>
            );
          })}
        </div>
      </Section>

      {/* ── Observaciones + guardar ─────────────────────────────── */}
      <Section id={`cls-obs-${roomKey}`} title="Observaciones">
        <Textarea
          aria-labelledby={`cls-obs-${roomKey}`}
          minRows={3}
          placeholder="Algo que el próximo tenga que saber de esta aula"
          value={draft.observaciones || ''}
          disabled={locked}
          onValueChange={value => setDraft(current => current ? { ...current, observaciones: value } : current)}
        />
        <span className="cls-help">
          Última actualización <span className="cls-mono">{formatDate(classroom.ultimaActualizacion, SHORT_DT, '—')}</span>
          {classroom.operadorUltimoCambio ? ` · ${classroom.operadorUltimoCambio}` : ''}
        </span>
        <div className="cls-savebar">
          <span className={cx('cls-savebar-text', dirty && 'is-dirty')} aria-live="polite">
            {consultationMode ? 'Modo consulta: no se puede editar.' : dirty ? `${changes} ${changes === 1 ? 'cambio sin guardar' : 'cambios sin guardar'}` : 'Sin cambios'}
          </span>
          {/* Los dos botones van juntos: si no entran al lado del texto, bajan juntos a la derecha. */}
          <span className="cls-savebar-btns">
            <Button variant="ghost" disabled={!dirty || saving} onClick={() => { setDraft(classroom); status.clear(); }}>Descartar</Button>
            <Button variant="primary" loading={saving} loadingLabel="Guardando…" disabled={!dirty || consultationMode} onClick={() => void save()}>Guardar cambios</Button>
          </span>
        </div>
      </Section>

      {/* ── Diagnóstico IA ──────────────────────────────────────── */}
      <Section
        id={`cls-dx-${roomKey}`}
        title="Diagnóstico del aula"
        aside={<Button size="sm" variant="secondary" loading={healthBusy} loadingLabel="Analizando…" disabled={consultationMode} onClick={() => void generate()}>{health ? 'Volver a generar' : 'Generar análisis'}</Button>}
      >
        <p className="cls-help">Lo arma la IA solo cuando lo pedís, con el equipamiento, los tickets y los equipos del aula. Si la IA no está disponible, se arma un resumen local.</p>
        {healthError && <ErrorState message={healthError} onRetry={consultationMode ? undefined : () => void generate()} retrying={healthBusy} />}
        {health ? <HealthReport health={health} /> : !healthError && <span className="cls-muted cls-small">Todavía no se generó ningún diagnóstico para esta aula.</span>}
      </Section>

      {/* ── Incidentes ──────────────────────────────────────────── */}
      <Section id={`cls-inc-${roomKey}`} title="Incidentes" aside={<span className="cls-help">tickets vinculados al aula</span>}>
        {incidentsError && <ErrorState message={incidentsError} onRetry={() => void reloadIncidents()} />}
        <dl className="cls-kpis">
          <div><dt>Abiertos</dt><dd className={cx('cls-mono', incidentSummary.open > 0 && 'cls-tone-warn')}>{incidentSummary.open}</dd></div>
          <div><dt>Cerrados</dt><dd className="cls-mono">{incidentSummary.closed}</dd></div>
          <div><dt>Total</dt><dd className="cls-mono">{incidentSummary.total}</dd></div>
          <div><dt>Último</dt><dd className="cls-mono">{formatDate(incidentSummary.lastIncidentAt, DATE_ONLY, '—')}</dd></div>
        </dl>
        {incidentSummary.commonCategories.length > 0 && (
          <p className="cls-help">Problemas frecuentes: {incidentSummary.commonCategories.map((item, index) => (
            <span key={item.label}>{index > 0 && ' · '}<span className="cls-text-2">{item.label}</span> <span className="cls-mono">{item.value}</span></span>
          ))}</p>
        )}
        {incidents.length ? (
          <ul className="cls-incidents">
            {incidents.slice(0, 8).map(item => (
              <li key={item.id} className="cls-incident">
                <div className="cls-grow">
                  <span className="cls-incident-title">{item.numero ? <span className="cls-mono cls-text-2">#{item.numero} · </span> : null}{item.titulo || 'Incidente sin título'}</span>
                  <span className="cls-help">{[item.categoria, item.prioridad, formatDate(item.createdAt, SHORT_DT, '')].filter(Boolean).join(' · ')}</span>
                </div>
                <StatusText tone={item.estado === 'Hecho' ? 'normal' : 'warn'} className="cls-nowrap">{item.estado}</StatusText>
              </li>
            ))}
          </ul>
        ) : !incidentsError && <span className="cls-muted cls-small">Esta aula todavía no tiene incidentes vinculados.</span>}
        {incidents.length > 0 && onNavigate && <Button size="sm" variant="ghost" className="cls-self-start" onClick={() => onNavigate('tickets')}>Ver en Tickets</Button>}
      </Section>

      {/* ── Recordatorios del aula ──────────────────────────────── */}
      <div className="cls-sec">
        <RelatedReminders type="classroom" id={roomKey} label={draft.nombre || nombre} consultationMode={consultationMode} onOpenAll={onNavigate ? () => onNavigate('reminders') : undefined} />
      </div>

      {/* ── Historial ───────────────────────────────────────────── */}
      <div className="cls-sec">
        <Disclosure variant="plain" title="Historial de cambios" summary={<span className="cls-count">{history.length}{history.length >= 100 ? '+' : ''}</span>}>
          {history.length ? (
            <>
              <ol className="cls-history">
                {history.slice(0, historyShown).map(entry => (
                  <li key={entry.id}>
                    <span className="cls-mono cls-history-when">{formatDate(entry.timestamp, SHORT_DT)}</span>
                    <span className="cls-history-what">
                      <b>{fieldLabel(entry.campo)}</b>
                      {entry.campo === 'equipment'
                        ? describeEquipmentChange(entry.valorAnterior, entry.valorNuevo)
                        : <>{entry.valorAnterior || '—'} → <span className="cls-text-1">{entry.valorNuevo || '—'}</span></>}
                      {entry.operador ? <span className="cls-history-op">{entry.operador}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
              {history.length > historyShown && (
                <Button size="sm" variant="ghost" onClick={() => { grow(); setHistoryShown(value => value + HISTORY_PAGE); }}>Ver {Math.min(HISTORY_PAGE, history.length - historyShown)} anteriores</Button>
              )}
            </>
          ) : <EmptyState compact title="Sin cambios registrados todavía." />}
        </Disclosure>
      </div>
    </aside>
  );
}

function HealthReport({ health }: { health: NonNullable<Health> }) {
  const { report } = health;
  const tone = report.score >= 85 ? 'normal' : report.score >= 65 ? 'warn' : 'bad';
  const lists: Array<[string, string[]]> = [
    ['Problemas recurrentes', report.recurringProblems],
    ['Puntos positivos', report.positives],
    ['Riesgos', report.risks],
    ['Acciones preventivas', report.preventiveActions]
  ];
  return (
    <div className="cls-health">
      <div className="cls-health-score">
        <Ring value={report.score} total={100} size={40} unit="puntos" warnAt={0.65} />
        <div className="cls-grow">
          <span className="cls-nowrap"><span className="cls-mono cls-health-num">{report.score}</span><span className="cls-mono cls-muted"> / 100</span> · <StatusText tone={tone}>{report.status}</StatusText></span>
          <span className="cls-help">Generado <span className="cls-mono">{formatDate(health.generatedAt, SHORT_DT, '—')}</span>{health.generatedBy ? ` · ${health.generatedBy}` : ''}</span>
        </div>
      </div>
      {report.summary && <p className="cls-para">{report.summary}</p>}
      {lists.filter(([, items]) => items.length).map(([title, items]) => (
        <div key={title} className="cls-health-list">
          <span className="cls-label">{title}</span>
          <ul>{items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
        </div>
      ))}
    </div>
  );
}

const PRIORITIES = ['Baja', 'Media', 'Alta', 'Urgente'] as const;

/** Crear un ticket vinculado al aula, en línea. */
function TicketForm({ nombre, roomKey, issues, onCancel, onCreated }: { nombre: string; roomKey: string; issues: string[]; onCancel: () => void; onCreated: (label: string) => void }) {
  const rootRef = useRef<HTMLFormElement | null>(null);
  const [origen, setOrigen] = useState<'handing' | 'tik'>('handing');
  const [numero, setNumero] = useState('');
  const [titulo, setTitulo] = useState(issues[0] ? `${issues[0]} en ${nombre}` : `Problema en ${nombre}`);
  const [prioridad, setPrioridad] = useState<(typeof PRIORITIES)[number]>('Media');
  const [categoria, setCategoria] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tried, setTried] = useState(false);

  const missingNumero = origen === 'tik' && !numero.trim();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (busy || !titulo.trim() || missingNumero) return;
    setBusy(true);
    setError('');
    try {
      const response = await createTicket({ origen, numero: numero.trim(), titulo: titulo.trim(), prioridad, categoria: categoria.trim(), estado: 'No hecho', classroom: nombre, classroomKey: roomKey });
      const created = response.item;
      onCreated(created?.origen === 'tik' && created.numero ? `#${created.numero}` : created?.numero ? `Handing ${created.numero}` : 'Handing');
    } catch (reason) {
      setError(errorMessage(reason, 'No se pudo crear el ticket.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form ref={rootRef} className="cls-ticket" onSubmit={event => void submit(event)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); } }}>
      <h3 className="cls-h3">Nuevo ticket para {nombre}</h3>
      <Segmented<'handing' | 'tik'> label="Dónde se cargó" value={origen} onChange={setOrigen} options={[{ value: 'handing', label: 'Handing' }, { value: 'tik', label: 'InVgate (con número)' }]} />
      {origen === 'tik'
        ? <Input label="Número de ticket (InVgate)" inputMode="numeric" placeholder="Ej. 2103" value={numero} onValueChange={setNumero} required error={tried && missingNumero ? 'Cargá el número del ticket de InVgate.' : undefined} />
        : <Input label="Referencia (opcional)" placeholder="Ej. HDMI-2103" value={numero} onValueChange={setNumero} />}
      <Input label="Título" value={titulo} onValueChange={setTitulo} required error={tried && !titulo.trim() ? 'Escribí un título.' : undefined} />
      <Segmented<(typeof PRIORITIES)[number]> label="Prioridad" value={prioridad} onChange={setPrioridad} options={PRIORITIES.map(value => ({ value, label: value }))} />
      <Input label="Categoría (opcional)" placeholder="Ej. Hardware" value={categoria} onValueChange={setCategoria} />
      <p className="cls-help">Queda vinculado al aula y aparece en Incidentes y en Tickets.</p>
      <Collapse open={Boolean(error)} unmountOnClose>
        <ErrorState message={error || 'No se pudo crear el ticket.'} />
      </Collapse>
      <div className="cls-actions cls-actions-end">
        <Button variant="ghost" disabled={busy} onClick={onCancel}>Cancelar</Button>
        <Button type="submit" variant="primary" loading={busy} loadingLabel="Creando…">Crear ticket</Button>
      </div>
    </form>
  );
}
