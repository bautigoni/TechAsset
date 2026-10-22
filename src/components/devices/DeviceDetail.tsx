import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Device } from '../../types';
import { Button, Collapse, DatePicker, ErrorState, Eyebrow, FlowColumns, IconButton, InlineConfirm, NumberField, Segmented, Skeleton, SkeletonText, StatusText, TruncatedText, ageTone, icons, useStatusLine } from '../../ui';
import { getDeviceOverview, updateDeviceMetadata, type DeviceOverviewResponse } from '../../services/devicesApi';
import { useAssistantContext } from '../../hooks/useAssistantContext';
import { getOperationalAlias } from '../../utils/classifyDevice';
import { loanAgeDays } from '../../utils/formatters';
import { errorMessage } from '../layout/Feedback';
import { DeviceReminders } from './DeviceReminders';
import { ageText, aliasOf, cellValue, dayLabel, deviceKind, deviceModel, isLendable, isLoaned, loanWhere, shortWhen, stateLabel, stateTone, typeOf } from './deviceView';

const CONDITIONS = [
  { value: '', label: 'Sin revisar' },
  ...['Excelente', 'Bueno', 'Regular', 'Malo'].map(value => ({ value, label: value }))
];

export type DeviceDetailActions = {
  onClose: () => void;
  onLoan?: (device: Device) => void;
  onReturn?: (device: Device) => Promise<unknown>;
  onEdit?: (device: Device) => void;
  onDelete?: (device: Device) => Promise<void>;
  /** Ficha de otro equipo (miembros del grupo). */
  onOpenDevice?: (etiqueta: string) => void;
  /** "Abrir como página" (/sede/x/devices/<etiqueta>). */
  onOpenPage?: (etiqueta: string) => void;
  onHistory?: (etiqueta: string) => void;
  onTickets?: () => void;
  onGroups?: () => void;
};

/**
 * Ficha del equipo. Se abre en línea debajo de su fila (Dispositivos) o como
 * página propia (/sede/x/devices/D1436, que es a donde llevan la ficha del
 * Inicio, Inventario, Historial y el asistente). Antes era un modal.
 *
 * Condición, vida útil y fecha de alta se guardan solas (la vida útil, al
 * dejar de tipear o al salir del campo, y también si se cierra la ficha:
 * antes, cerrar con Escape sin salir del campo perdía lo tipeado).
 */
export function DeviceDetail({ device, consultationMode, variant = 'inline', ...actions }: DeviceDetailActions & {
  device: Device;
  consultationMode: boolean;
  variant?: 'inline' | 'page';
}) {
  const [overview, setOverview] = useState<DeviceOverviewResponse | null>(null);
  const [loadError, setLoadError] = useState('');
  const [condition, setCondition] = useState('');
  const [life, setLife] = useState<number | null>(null);
  const [fechaAlta, setFechaAlta] = useState('');
  const [askDelete, setAskDelete] = useState(false);
  const [busy, setBusy] = useState<'return' | 'delete' | null>(null);
  const status = useStatusLine();
  const savedLife = useRef<number | null>(null);
  const lifeRef = useRef<number | null>(null);
  const tag = device.etiqueta;
  const alias = aliasOf(device);

  useAssistantContext({ type: 'device', id: tag, label: getOperationalAlias(device) || tag, data: { estado: device.estado, ubicacion: device.ubicacion } });

  useEffect(() => {
    let alive = true;
    setLoadError('');
    getDeviceOverview(tag)
      .then(response => {
        if (!alive) return;
        setOverview(response);
        setCondition(response.condition || '');
        const months = response.lifecycle?.origen === 'equipo' ? Number(response.lifecycle.meses) || null : null;
        savedLife.current = months;
        lifeRef.current = months;
        setLife(months);
        setFechaAlta(response.lifecycle?.estimada ? '' : response.lifecycle?.fechaAlta || '');
      })
      .catch(reason => { if (alive) setLoadError(errorMessage(reason, 'No se pudo cargar el resumen del equipo.')); });
    return () => { alive = false; };
    // El estado cambia al prestar/devolver: la actividad se rearma.
  }, [tag, device.estado]);

  const save = async (patch: { condition?: string; expectedLifeMonths?: number | null; fechaAlta?: string }) => {
    try {
      await updateDeviceMetadata(tag, { ...patch, origen: 'Perfil' });
      status.show({ tone: 'ok', message: 'Cambios guardados.', autoHideMs: 2500 });
    } catch (reason) {
      status.show({ tone: 'bad', message: errorMessage(reason, 'No se pudo guardar el dato.') });
    }
  };

  // Vida útil: se guarda 900 ms después de dejar de tipear, al salir del campo
  // y al cerrar la ficha si quedó algo sin guardar.
  const flushLife = () => {
    if (consultationMode || lifeRef.current === savedLife.current) return;
    savedLife.current = lifeRef.current;
    void save({ expectedLifeMonths: lifeRef.current });
  };
  useEffect(() => {
    lifeRef.current = life;
    if (life === savedLife.current) return;
    const timer = window.setTimeout(flushLife, 900);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [life]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => flushLife(), [tag]);

  const loaned = isLoaned(device);
  const runReturn = async () => {
    if (!actions.onReturn) return;
    setBusy('return');
    try { await actions.onReturn(device); } finally { setBusy(null); }
  };
  const runDelete = async () => {
    if (!actions.onDelete) return;
    setBusy('delete');
    try {
      await actions.onDelete(device);
    } catch (reason) {
      status.show({ tone: 'bad', message: errorMessage(reason, `No se pudo borrar ${tag}.`) });
      setBusy(null);
      setAskDelete(false);
    }
  };

  const stats = overview?.stats;
  const timeline = overview?.timeline.slice(0, 12) || [];
  const basic: Array<[string, ReactNode]> = [
    ['Nombre', getOperationalAlias(device) || device.dispositivo],
    ['Activo', <span className="ui-mono">{tag}</span>],
    ['Número operativo', device.numeroOperativo || device.numero],
    ['Serie', device.sn ? <span className="ui-mono">{device.sn}</span> : ''],
    ['Modelo', device.modelo],
    ['Fabricante', device.marca],
    ['Tipo', typeOf(device)],
    ['Estado', stateLabel(device)],
    ['Ubicación', cellValue(device.ubicacion)],
    ['Asignado a', cellValue(device.prestadoA)]
  ];
  const stateLine = loaned
    ? <StatusText tone={ageTone(loanAgeDays(device.loanedAt))}>Prestado{device.prestadoA ? ` a ${device.prestadoA}` : ''}{device.loanedAt ? ` · ${ageText(device.loanedAt)}` : ''}</StatusText>
    : <StatusText tone={stateTone(device)}>{stateLabel(device)}</StatusText>;
  const lifeNote = overview?.lifecycle
    ? overview.lifecycle.vencido
      ? <StatusText tone="bad">Vida útil vencida{overview.lifecycle.fechaRenovacion ? ` · renovar desde ${dayLabel(overview.lifecycle.fechaRenovacion)}` : ''}</StatusText>
      : overview.lifecycle.vidaConsumidaPct !== null && overview.lifecycle.vidaConsumidaPct !== undefined
        ? <span className="dv-muted">{`Lleva ${Math.round(overview.lifecycle.vidaConsumidaPct)} % de su vida útil${overview.lifecycle.fechaRenovacion ? ` · renovación ${dayLabel(overview.lifecycle.fechaRenovacion)}` : ''}${overview.lifecycle.estimada ? ' (alta estimada)' : ''}`}</span>
        : null
    : null;

  return (
    <section
      className={`dv-detail dv-detail--${variant}`}
      role="region"
      aria-label={`Ficha de ${alias} (${tag})`}
      data-scanner-ignore=""
      onKeyDown={event => { if (event.key === 'Escape' && variant === 'inline' && !askDelete) { event.stopPropagation(); actions.onClose(); } }}
    >
      <div className="dv-block-head">
        <div className="dv-block-title">
          <div className="dv-detail-name">
            <h3 className="dv-h3 dv-detail-title"><TruncatedText>{alias}</TruncatedText></h3>
            <span className="ui-mono dv-tag">{tag}</span>
          </div>
          <TruncatedText lines={2} className="dv-muted">{[deviceKind(device), deviceModel(device)].filter(Boolean).join(' · ')}</TruncatedText>
          <span className="dv-state-line">{stateLine}</span>
        </div>
        <div className="dv-actions">
          {!consultationMode && loaned && actions.onReturn && <Button size="sm" loading={busy === 'return'} loadingLabel="Devolviendo…" onClick={() => void runReturn()}>Devolver</Button>}
          {!consultationMode && isLendable(device) && actions.onLoan && <Button size="sm" onClick={() => actions.onLoan?.(device)}>Prestar</Button>}
          {!consultationMode && actions.onEdit && <Button size="sm" onClick={() => actions.onEdit?.(device)}>Editar</Button>}
          {actions.onHistory && <Button size="sm" variant="ghost" onClick={() => actions.onHistory?.(tag)}>Ver en Historial</Button>}
          {variant === 'inline' && actions.onOpenPage && <Button size="sm" variant="ghost" onClick={() => actions.onOpenPage?.(tag)}>Abrir como página</Button>}
          {!consultationMode && actions.onDelete && <Button size="sm" variant="danger" aria-expanded={askDelete} onClick={() => setAskDelete(true)}>Borrar</Button>}
          {variant === 'inline' && <IconButton label="Cerrar ficha (Esc)" icon={<icons.IconX size={16} />} onClick={actions.onClose} />}
        </div>
      </div>

      <Collapse open={askDelete} unmountOnClose outerClassName="dv-fold-sm">
        <InlineConfirm
          danger
          message={`¿Mover ${tag} a la papelera?`}
          detail="Se oculta de la app sin borrar su historial. Se puede restaurar desde la papelera."
          confirmLabel="Mover a la papelera"
          busy={busy === 'delete'}
          onConfirm={() => void runDelete()}
          onCancel={() => setAskDelete(false)}
        />
      </Collapse>
      <Collapse open={Boolean(loadError)} outerClassName="dv-fold-sm">
        <ErrorState message={loadError} />
      </Collapse>
      {status.element}
      {/* El resumen llega con el resto de la ficha: entra suave, no de golpe. */}
      <Collapse open={Boolean(overview?.aiSummary?.text)} outerClassName="dv-fold-sm" reveal={false}>
        <div className="dv-ai">
          <Eyebrow>Resumen</Eyebrow>
          <p className="dv-ai-text">{overview?.aiSummary?.text}</p>
          <span className="dv-muted">Actualizado {shortWhen(overview?.aiSummary?.generatedAt || '')}</span>
        </div>
      </Collapse>

      <FlowColumns minRem={17} className="dv-detail-grid">
        <section className="dv-sec" aria-label="Estado y cuidado">
          <Eyebrow>Estado y cuidado</Eyebrow>
          <Segmented
            label="Condición · se guarda al tocar"
            size="sm"
            value={condition}
            options={CONDITIONS}
            disabled={consultationMode || !overview}
            onChange={value => { setCondition(value); void save({ condition: value }); }}
          />
          {overview?.lifecycle?.lastReviewedAt && <span className="dv-muted">Última revisión {shortWhen(overview.lifecycle.lastReviewedAt)}</span>}
          <div className="dv-two">
            <div onBlur={flushLife}>
              <NumberField
                label="Vida útil"
                unit="meses"
                min={0}
                max={600}
                value={life}
                onChange={setLife}
                placeholder={overview?.lifecycle?.meses ? String(overview.lifecycle.meses) : ''}
                hint={life === null && overview?.lifecycle?.meses ? `Vacío = ${overview.lifecycle.meses} (de la clase)` : undefined}
                disabled={consultationMode || !overview}
              />
            </div>
            <DatePicker
              label="Fecha de alta"
              value={fechaAlta}
              onChange={value => { setFechaAlta(value); void save({ fechaAlta: value }); }}
              clearable
              shortcuts={['today']}
              disabled={consultationMode || !overview}
              placeholder={overview?.lifecycle?.estimada ? 'Sin fecha' : 'DD/MM/AAAA'}
            />
          </div>
          {lifeNote}
          {loaned && (
            <div className="dv-loan">
              <span className="dv-label">Préstamo activo</span>
              <TruncatedText lines={2}>{[device.prestadoA || 'Sin persona', device.rol].filter(Boolean).join(' · ')}</TruncatedText>
              {loanWhere(device) && <TruncatedText lines={2} className="dv-muted">{loanWhere(device)}</TruncatedText>}
              {device.loanedAt && <span className="ui-mono dv-muted">Desde {shortWhen(device.loanedAt)}</span>}
            </div>
          )}
          <div className="dv-group">
            <span className="dv-label">Grupo</span>
            {overview?.group ? (
              <>
                <TruncatedText lines={2}>{overview.group.name}</TruncatedText>
                {overview.group.description && <TruncatedText lines={2} className="dv-muted">{overview.group.description}</TruncatedText>}
                <div className="dv-chips" role="group" aria-label={`Equipos del grupo ${overview.group.name}`}>
                  {overview.group.members.map(member => (
                    <button key={member.etiqueta} type="button" className="dv-chip" aria-current={member.etiqueta === tag || undefined} onClick={() => actions.onOpenDevice?.(member.etiqueta)}>
                      {getOperationalAlias(member) || member.etiqueta} <span className="ui-mono">{member.etiqueta}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : <span className="dv-muted">{overview ? 'Sin grupo.' : '…'}</span>}
            {actions.onGroups && <Button size="sm" variant="ghost" onClick={actions.onGroups}>{overview?.group || consultationMode ? 'Ver grupos' : 'Agregar a un grupo'}</Button>}
          </div>
        </section>

        <section className="dv-sec" aria-label="Datos">
          <Eyebrow>Datos</Eyebrow>
          <dl className="dv-dl">
            {basic.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value || '—'}</dd>
              </div>
            ))}
          </dl>
          <div className="dv-stats">
            <Stat label="Préstamos" value={stats?.totalLoans} />
            <Stat label="Reparaciones" value={stats?.totalRepairs} />
            <Stat label="Incidentes" value={stats?.incidents} />
            <Stat label="Último préstamo" value={stats ? dayLabel(stats.lastLoan) || '—' : undefined} />
            <Stat label="Última reparación" value={stats ? dayLabel(stats.lastRepair) || '—' : undefined} />
            <Stat label="Mantenimiento" value={stats ? dayLabel(stats.lastMaintenance) || '—' : undefined} />
          </div>
        </section>

        <section className="dv-sec" aria-label="Actividad reciente">
          <div className="dv-sec-head">
            <Eyebrow>Actividad reciente</Eyebrow>
            {overview && <span className="ui-mono dv-muted">{overview.timeline.length}</span>}
          </div>
          {!overview && !loadError && <SkeletonText lines={4} />}
          {timeline.length > 0 && (
            <ol className="dv-timeline">
              {timeline.map((item, index) => (
                <li key={`${item.date}-${index}`}>
                  <span className="ui-mono dv-muted dv-when">{shortWhen(item.date)}</span>
                  <span className="dv-tl-body">
                    <span className="dv-tl-action">{item.action}</span>
                    {(item.notes || item.source) && <span className="dv-muted dv-tl-notes">{item.notes || item.source}</span>}
                    <TruncatedText lines={2} className="dv-muted">{item.user || 'Sistema'}</TruncatedText>
                  </span>
                </li>
              ))}
            </ol>
          )}
          {overview && !overview.timeline.length && <span className="dv-muted">Sin movimientos registrados.</span>}
          {actions.onHistory && <Button size="sm" variant="ghost" onClick={() => actions.onHistory?.(tag)}>Ver todo en Historial</Button>}
        </section>

        <section className="dv-sec" aria-label="Tickets relacionados">
          <Eyebrow>Tickets relacionados</Eyebrow>
          {!overview && !loadError && <Skeleton height="0.75rem" width="60%" />}
          {overview?.recentTickets.map(ticket => (
            <button key={ticket.id} type="button" className="dv-link-row" onClick={actions.onTickets}>
              <span className="ui-mono dv-muted">#{ticket.numero || ticket.id}</span>
              <TruncatedText>{ticket.titulo || ticket.categoria}</TruncatedText>
              <span className="dv-muted dv-nowrap">{ticket.estado}</span>
            </button>
          ))}
          {overview && !overview.recentTickets.length && <span className="dv-muted">No se detectaron tickets para esta etiqueta.</span>}
        </section>

        <section className="dv-sec" aria-label="Mantenimiento y compra">
          <Eyebrow>Mantenimiento y compra</Eyebrow>
          {overview?.maintenanceHistory.length ? overview.maintenanceHistory.map(item => (
            <div key={item.id} className="dv-maint">
              <TruncatedText lines={2}>{item.title}</TruncatedText>
              <TruncatedText lines={2} className="dv-muted">{[item.status, dayLabel(item.date), item.notes].filter(Boolean).join(' · ')}</TruncatedText>
            </div>
          )) : overview ? <span className="dv-muted">No hay mantenimientos vinculados.</span> : null}
          <dl className="dv-dl dv-dl--compact">
            <div><dt>Compra</dt><dd className="dv-muted">no registrada</dd></div>
            <div><dt>Garantía</dt><dd className="dv-muted">no registrada</dd></div>
          </dl>
        </section>

        <DeviceReminders etiqueta={tag} label={getOperationalAlias(device) || tag} consultationMode={consultationMode} />
      </FlowColumns>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <div className="dv-stat">
      <span className="ui-mono dv-stat-value">{value === undefined ? '—' : value}</span>
      <TruncatedText className="dv-muted">{label}</TruncatedText>
    </div>
  );
}
