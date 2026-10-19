import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, House } from 'lucide-react';
import type { Device, Movement, PreviousDayLoan } from '../../types';
import { classifyDeviceType, getOperationalAlias } from '../../utils/classifyDevice';
import { formatDate, formatLoanDateTime, formatTimeOnly, loanAgeDays } from '../../utils/formatters';
import { getDeviceStateKey } from '../../utils/deviceState';
import { getPreviousDayLoans, undoLoans, type LoanBatchResponse } from '../../services/loansApi';
import { Button } from '../../ui/Button';
import { EmptyState, ErrorState, Eyebrow, SkeletonRows, StatusText, ageTone } from '../../ui/Data';
import { Collapse, useAnchoredToggle } from '../../ui/Collapse';
import { useStatusLine } from '../../ui/StatusSlot';
import { TruncatedText } from '../../ui/Truncated';
import { cx } from '../../ui/util';
import { LoanForm } from './LoanForm';
import { PhotoPassPanel } from './PhotoPassPanel';
import { DeviceChipsPanel } from './DeviceChipsPanel';
import { DailyClosureSection } from './DailyClosureSection';
import { Chevron, LazyBody, usePanelOpen } from './ChipPanelKit';
import { SuccessCheck } from './ScanMessage';
import { scrollAppToTop } from '../../utils/scroll';
import '../../styles/screens/loans.css';

type LoanActionResult = { synced?: boolean; message?: string; idempotent?: boolean } | void;

const SIDE_N = 8;
const PREV_N = 8;

/**
 * Préstamos ("mostrador"): formulario rápido arriba, equipos por tipo y
 * cartelitos debajo, y al costado el estado del momento y lo que está
 * afuera. El cierre del día se abre en línea arriba de todo.
 */
export function LoansPage({ devices, operator, consultationMode, onLend, onReturn, onLendBatch, onReturnBatch, onRefresh, onProfile, initialCode = '', initialBatch, scanRequest = 0, siteCode = '' }: {
  devices: Device[];
  movements: Movement[];
  operator: string;
  consultationMode: boolean;
  onLend: (payload: Record<string, unknown>) => Promise<LoanActionResult>;
  onReturn: (payload: Record<string, unknown>) => Promise<LoanActionResult>;
  onLendBatch: (payload: Record<string, unknown> & { etiquetas: string[] }) => Promise<LoanBatchResponse>;
  onReturnBatch: (etiquetas: string[]) => Promise<LoanBatchResponse>;
  /** Refresca equipos y movimientos (después de un Deshacer). */
  onRefresh?: () => Promise<unknown> | void;
  onProfile?: (device: Device) => void;
  initialCode?: string;
  initialBatch?: { etiquetas: string[]; nonce: number };
  scanRequest?: number;
  siteCode?: string;
}) {
  // Una sola fuente de semillas para el formulario (App: escáner global, Ctrl K,
  // Prestar de otra pantalla; y las de acá: chip libre, "Revisar"). El nonce
  // hace que la misma etiqueta dos veces seguidas también llegue.
  const [seed, setSeed] = useState<{ code: string; nonce: number } | undefined>();
  const [batchSeed, setBatchSeed] = useState<{ etiquetas: string[]; nonce: number } | undefined>();
  const [closureOpen, setClosureOpen] = useState(false);
  const closureBtnRef = useRef<HTMLButtonElement | null>(null);

  // App manda '' y después la etiqueta: cada pedido nuevo llega aunque se repita.
  useEffect(() => {
    if (initialCode) setSeed(current => ({ code: initialCode, nonce: (current?.nonce || 0) + 1 }));
  }, [initialCode]);
  useEffect(() => {
    if (initialBatch?.etiquetas.length) setBatchSeed(current => ({ etiquetas: initialBatch.etiquetas, nonce: (current?.nonce || 0) + 1 }));
  }, [initialBatch]);

  const seedLoanCode = useCallback((etiqueta: string) => {
    setSeed(current => ({ code: etiqueta, nonce: (current?.nonce || 0) + 1 }));
    scrollAppToTop(true);
  }, []);

  const seedLoanBatch = useCallback((etiquetas: string[]) => {
    setBatchSeed(current => ({ etiquetas, nonce: (current?.nonce || 0) + 1 }));
    scrollAppToTop(true);
  }, []);

  const onUndo = useCallback(async (etiquetas: string[], action: 'return' | 'lend') => {
    try {
      return await undoLoans(etiquetas, action);
    } finally {
      await onRefresh?.();
    }
  }, [onRefresh]);

  const site = siteCode || devices[0]?.siteCode || '';

  return (
    <section className="lo-page" data-loans-page="">
      <div className="lo-toolbar">
        <span className="lo-toolbar-date">{capitalize(formatDate(new Date(), { weekday: 'short', day: 'numeric', month: 'short' }))}</span>
        <Button ref={closureBtnRef} size="sm" variant="secondary" aria-expanded={closureOpen} aria-controls="lo-cierre" onClick={() => setClosureOpen(value => !value)}>
          Cierre del día
        </Button>
      </div>

      {/* En línea, suave y con el botón quieto (Collapse); lo escrito se conserva al cerrar. */}
      <Collapse open={closureOpen} id="lo-cierre" outerClassName="lo-fold">
        <DailyClosureSection open={closureOpen} operator={operator} consultationMode={consultationMode} onClose={() => { setClosureOpen(false); closureBtnRef.current?.focus({ preventScroll: true }); }} />
      </Collapse>

      <div className="lo-cols">
        <div className="lo-main">
          <LoanForm
            devices={devices}
            consultationMode={consultationMode}
            onLend={onLend}
            onReturn={onReturn}
            onLendBatch={onLendBatch}
            onUndo={onUndo}
            seed={seed}
            batchSeed={batchSeed}
            scanRequest={scanRequest}
          />
          <DeviceChipsPanel devices={devices} consultationMode={consultationMode} onReturnBatch={onReturnBatch} onUndo={onUndo} onSeedCode={seedLoanCode} onBatchLend={seedLoanBatch} />
          <PhotoPassPanel consultationMode={consultationMode} />
          {/* Va en la columna principal: si la lateral es más corta no queda un hueco
              arriba de esta tabla (en angosto baja al final, ver loans.css). */}
          <PreviousDay devices={devices} onProfile={onProfile} />
        </div>
        <div className="lo-side">
          <NowSummary devices={devices} site={site} />
          <LoanedNow devices={devices} consultationMode={consultationMode} onReview={seedLoanCode} onReturnBatch={onReturnBatch} onUndo={onUndo} onProfile={onProfile} />
        </div>
      </div>
    </section>
  );
}

/* ── Ahora en la sede ──────────────────────────────────────────────────── */

function NowSummary({ devices, site }: { devices: Device[]; site: string }) {
  const data = useMemo(() => {
    const keys = devices.map(device => getDeviceStateKey(device));
    const loaned = devices.filter((_, index) => keys[index] === 'loaned');
    const byLocation = countBy(loaned, device => device.ubicacion || 'Sin ubicación');
    const byType = countBy(devices, device => classifyDeviceType(device));
    return {
      loaned: loaned.length,
      available: keys.filter(key => key === 'available').length,
      out: keys.filter(key => key === 'out').length,
      missing: keys.filter(key => key === 'missing').length,
      late: loaned.filter(device => loanAgeDays(device.loanedAt) >= 1).length,
      topLocation: byLocation[0],
      byType
    };
  }, [devices]);
  return (
    <section className="lo-card lo-now" aria-labelledby="lo-now-title">
      <Eyebrow as="div"><span id="lo-now-title">Ahora{site ? ` en ${site}` : ''}</span></Eyebrow>
      <div className="lo-tiles">
        <Tile value={data.loaned} label="Prestados" tone={data.late ? 'warn' : undefined} hint={data.late ? `${data.late} hace más de 1 día` : undefined} />
        <Tile value={data.available} label={`Disponibles de ${devices.length}`} />
        <Tile value={data.out} label="Fuera de servicio" tone={data.out ? 'bad' : undefined} />
        <Tile value={data.missing} label="No encontrados" tone={data.missing ? 'bad' : undefined} />
      </div>
      <div className="lo-now-facts">
        <div className="lo-fact"><span className="lo-fact-k">Donde hay más prestados</span><span className="lo-fact-v">{data.topLocation ? `${data.topLocation[0]} (${data.topLocation[1]})` : '—'}</span></div>
        <div className="lo-fact"><span className="lo-fact-k">Tipo más numeroso</span><span className="lo-fact-v">{data.byType[0] ? `${data.byType[0][0]} (${data.byType[0][1]})` : '—'}</span></div>
        <div className="lo-fact lo-fact--types"><span className="lo-fact-k">Por tipo</span><span className="lo-fact-v g-num">{data.byType.map(([label, value]) => `${label} ${value}`).join(' · ') || '—'}</span></div>
      </div>
    </section>
  );
}

function Tile({ value, label, tone, hint }: { value: number; label: string; tone?: 'warn' | 'bad'; hint?: string }) {
  return (
    <div className="lo-tile">
      <span className={cx('lo-tile-num g-num', tone && `is-${tone}`)}>{value}</span>
      <span className="lo-tile-label">{label}</span>
      {hint && <StatusText tone="warn" className="lo-tile-hint">{hint}</StatusText>}
    </div>
  );
}

/* ── Actualmente prestados ─────────────────────────────────────────────── */

function LoanedNow({ devices, consultationMode, onReview, onReturnBatch, onUndo, onProfile }: {
  devices: Device[];
  consultationMode: boolean;
  onReview: (etiqueta: string) => void;
  onReturnBatch: (etiquetas: string[]) => Promise<LoanBatchResponse>;
  onUndo: (etiquetas: string[], action: 'return' | 'lend') => Promise<LoanBatchResponse>;
  onProfile?: (device: Device) => void;
}) {
  const [all, setAll] = useState(false);
  const anchored = useAnchoredToggle();
  const [busyTag, setBusyTag] = useState('');
  const status = useStatusLine();
  // Los que están afuera hace más tiempo, primero.
  const loaned = useMemo(() => devices
    .filter(device => getDeviceStateKey(device) === 'loaned')
    .sort((a, b) => loanAgeDays(b.loanedAt) - loanAgeDays(a.loanedAt) || String(a.loanedAt || '').localeCompare(String(b.loanedAt || ''))), [devices]);
  const list = all ? loaned : loaned.slice(0, SIDE_N);

  const returnOne = async (device: Device) => {
    if (busyTag) return;
    setBusyTag(device.etiqueta);
    status.clear();
    try {
      const response = await onReturnBatch([device.etiqueta]);
      const result = response.results[0];
      if (result && !result.ok) { status.show({ tone: 'bad', message: result.error || 'No se pudo registrar la devolución.' }); return; }
      const text = `${getOperationalAlias(device) || device.etiqueta} (${device.etiqueta}) devuelto${device.prestadoA ? ` · lo tenía ${device.prestadoA}` : ''}`;
      status.show({
        tone: 'ok', icon: <SuccessCheck />, message: text,
        undo: { seconds: 8, onUndo: async () => {
          try {
            const undone = await onUndo([device.etiqueta], 'return');
            const failed = undone.results.find(item => !item.ok);
            status.show(failed ? { tone: 'bad', message: `No se pudo deshacer: ${failed.error || failed.etiqueta}` } : { tone: 'info', message: `Se deshizo: ${text}` });
          } catch (error) {
            status.show({ tone: 'bad', message: error instanceof Error ? error.message : 'No se pudo deshacer.' });
          }
        } }
      });
    } catch (error) {
      status.show({ tone: 'bad', message: error instanceof Error ? error.message : 'No se pudo registrar la devolución.' });
    } finally {
      setBusyTag('');
    }
  };

  return (
    <section className="lo-card lo-loaned" aria-labelledby="lo-loaned-title">
      <div className="lo-card-head">
        <div className="lo-head-text">
          <h2 id="lo-loaned-title" className="lo-h2">Actualmente prestados <span className="lo-count g-num">{loaned.length}</span></h2>
          <p className="lo-help">Los que están afuera hace más tiempo, primero.</p>
        </div>
      </div>
      {status.slot('lo-card-status')}
      <div className="lo-loaned-list">
        {list.map(device => {
          const days = loanAgeDays(device.loanedAt);
          const alias = getOperationalAlias(device) || device.etiqueta;
          return (
            <div className="lo-loaned-row" key={device.id || device.etiqueta} data-loaned-tag={device.etiqueta}>
              {/* Equipo y acciones arriba; quién/dónde y desde cuándo usan todo el ancho abajo. */}
              <div className="lo-loaned-line">
                <button type="button" className="lo-link" aria-label={`Abrir ficha de ${alias} (${device.etiqueta})`} onClick={() => onProfile?.(device)}>{alias}</button>
                <span className="lo-loaned-tag g-num">{device.etiqueta}</span>
                <span className="lo-loaned-actions">
                  <Button size="sm" variant="ghost" aria-label={`Revisar la devolución de ${alias}`} disabled={consultationMode} onClick={() => onReview(device.etiqueta)}>Revisar</Button>
                  <Button size="sm" variant="secondary" aria-label={`Devolver ${alias}`} disabled={consultationMode || Boolean(busyTag)} loading={busyTag === device.etiqueta} onClick={() => void returnOne(device)}>Devolver</Button>
                </span>
              </div>
              <TruncatedText className="lo-loaned-who" lines={2}>{`${device.prestadoA || 'Sin persona'} · ${[device.ubicacion, device.curso].filter(Boolean).join(' · ') || 'Sin ubicación'}`}</TruncatedText>
              <StatusText tone={ageTone(days)} mono className="lo-loaned-since">{formatLoanDateTime(device.loanedAt) || 'Sin fecha'} · {days <= 0 ? 'hoy' : days === 1 ? '1 día' : `${days} días`}</StatusText>
            </div>
          );
        })}
        {!loaned.length && <EmptyState compact className="lo-empty-state" icon={<House size={18} strokeWidth={1.6} />} title="Todo en casa" description="No hay equipos prestados ahora." />}
      </div>
      {loaned.length > SIDE_N && (
        <Button size="sm" variant="ghost" block className="lo-more" onClick={() => anchored(() => setAll(value => !value))}>
          {all ? `Ver solo los ${SIDE_N} más antiguos` : `Ver todos (${loaned.length})`}
        </Button>
      )}
    </section>
  );
}

/* ── Último día con préstamos ──────────────────────────────────────────── */

function PreviousDay({ devices, onProfile }: { devices: Device[]; onProfile?: (device: Device) => void }) {
  const [open, setOpen] = usePanelOpen('previous-day', true);
  const [items, setItems] = useState<PreviousDayLoan[]>([]);
  const [date, setDate] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [all, setAll] = useState(false);
  const anchored = useAnchoredToggle();

  const load = useCallback(async (alive: () => boolean = () => true) => {
    setLoading(true);
    setError('');
    try {
      const response = await getPreviousDayLoans();
      if (!alive()) return;
      setItems(response.items || []);
      setDate(response.date || '');
    } catch (reason) {
      if (!alive()) return;
      setItems([]);
      const message = reason instanceof Error ? reason.message : '';
      setError(message.includes('API') || message.includes('JSON') || message.includes('inválida')
        ? 'No se pudo cargar el resumen de ayer. Reintentá en un momento.'
        : message || 'No se pudo cargar el resumen de ayer.');
    } finally {
      if (alive()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void load(() => alive);
    return () => { alive = false; };
  }, [load]);

  const byTag = useMemo(() => new Map(devices.map(device => [device.etiqueta, device])), [devices]);
  const rows = all ? items : items.slice(0, PREV_N);

  return (
    <section className="lo-card lo-prev" aria-labelledby="lo-prev-title">
      <div className="lo-card-head lo-prev-head">
        <button type="button" className="lo-group-toggle lo-prev-toggle" aria-expanded={open} aria-controls="lo-prev-body" onClick={() => setOpen(!open)}>
          <span className="lo-group-name">
            <Chevron open={open} />
            <span id="lo-prev-title" className="lo-group-title lo-h2">Último día con préstamos</span>
          </span>
          <span className="lo-prev-date">{date ? formatShortDate(date) : 'Actualización diaria'}</span>
          <span className="lo-count g-num">{loading ? '…' : items.length}</span>
        </button>
        <span className="lo-help lo-prev-note">Si ayer no hubo clases, muestra el último día que sí hubo.</span>
      </div>
      <LazyBody open={open} className="lo-prev-body">
        <div id="lo-prev-body">
          {error && <ErrorState message={error} onRetry={() => void load()} retrying={loading} />}
          {!error && loading && !items.length && <SkeletonRows rows={4} />}
          {!error && !loading && !items.length && <EmptyState compact className="lo-empty-state" icon={<CalendarClock size={18} strokeWidth={1.6} />} title="Sin préstamos anteriores" description="Cuando haya un día con préstamos, acá se ve qué salió, a quién y con qué." />}
          {!error && items.length > 0 && (
            <div className="lo-prev-table" role="table" aria-label="Préstamos del último día con préstamos">
              <div className="lo-prev-row lo-prev-row--head" role="row">
                <span role="columnheader">Hora</span><span role="columnheader">Equipo</span><span role="columnheader">Persona</span>
                <span role="columnheader">Ubicación · curso</span><span role="columnheader">Motivo</span><span role="columnheader">Accesorios</span>
              </div>
              {rows.map(item => {
                const device = byTag.get(item.etiqueta);
                return (
                  <div className="lo-prev-row" role="row" key={item.id}>
                    <span role="cell" className="lo-prev-hora g-num" data-label="Hora">{formatTimeOnly(item.timestamp) || '-'}</span>
                    <span role="cell" className="lo-prev-eq" data-label="Equipo">
                      {device
                        ? <button type="button" className="lo-link" aria-label={`Abrir ficha de ${item.etiqueta}`} onClick={() => onProfile?.(device)}>{item.alias || item.etiqueta}</button>
                        : <span>{item.alias || item.etiqueta}</span>}
                      <span className="lo-loaned-tag g-num">{item.etiqueta}</span>
                    </span>
                    <span role="cell" data-label="Persona"><TruncatedText>{item.persona || '-'}</TruncatedText></span>
                    <span role="cell" data-label="Ubicación · curso" data-empty={item.ubicacion || item.curso ? undefined : ''}><TruncatedText>{[item.ubicacion, item.curso].filter(Boolean).join(' · ') || '-'}</TruncatedText></span>
                    <span role="cell" data-label="Motivo" data-empty={item.motivo ? undefined : ''}><TruncatedText>{item.motivo || '-'}</TruncatedText></span>
                    <span role="cell" data-label="Accesorios"><TruncatedText>{item.accessories?.length ? item.accessories.join(', ') : 'Sin accesorios'}</TruncatedText></span>
                  </div>
                );
              })}
            </div>
          )}
          {items.length > PREV_N && (
            <Button size="sm" variant="ghost" block className="lo-more" onClick={() => anchored(() => setAll(value => !value))}>{all ? 'Ver menos' : `Ver los ${items.length}`}</Button>
          )}
        </div>
      </LazyBody>
    </section>
  );
}

function countBy(devices: Device[], getter: (device: Device) => string) {
  return Object.entries(devices.reduce<Record<string, number>>((acc, device) => {
    const key = getter(device) || '-';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]);
}

function capitalize(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function formatShortDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  return Number.isNaN(date.getTime()) ? value : formatDate(date, { weekday: 'short', day: 'numeric', month: 'short' });
}
