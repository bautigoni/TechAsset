import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ClipboardCheck } from 'lucide-react';
import type { AgendaItem, Device, Movement, SyncStatus, TaskItem, ViewKey } from '../../types';
import { Button, StatusText, cx, icons, useStatusLine } from '../../ui';
import { undoLoans, type LoanBatchResponse } from '../../services/loansApi';
import { getDevicesHealth, subscribeDevicesHealth } from '../../hooks/useDevices';
import { isEditableTarget } from '../../hooks/useGlobalScanner';
import { errorMessage } from '../layout/Feedback';
import { ActionBar, Shortcuts } from './ActionBar';
// Cierre del día en línea: la misma sección que Préstamos (etapa 4).
import { DailyClosureSection } from '../loans/DailyClosureSection';
import { NowColumn } from './NowColumn';
import { OutList } from './OutList';
import { RecentMoves } from './RecentMoves';
import { StatusTiles } from './StatusTiles';
import { agoText, aliasOf, countDevices, typeStats, type ListFilter } from './dashModel';
import { loanOptions } from './loanOptions';
import { useLoanActions } from './useLoanActions';
import '../../styles/screens/dashboard.css';

export type DashboardProps = {
  operator: string;
  consultationMode?: boolean;
  devices: Device[];
  sync: SyncStatus;
  agenda: AgendaItem[];
  tasks: TaskItem[];
  movements: Movement[];
  siteSettings: Record<string, unknown> | null;
  /** Lo que el lector USB leyó estando en el Inicio (cae en la barra de acción). */
  scan?: { code: string; nonce: number };
  canOpen: (view: ViewKey) => boolean;
  onNavigate: (view: ViewKey) => void;
  /** Abre la página de ESA tarea (/sede/x/tasks/<id>). */
  onOpenTask: (id: string) => void;
  onOpenLoans: (etiqueta: string) => void;
  onProfile: (device: Device) => void;
  onEdit: (device: Device) => void;
  onLend: (payload: Record<string, unknown>) => Promise<unknown>;
  onReturn: (payload: Record<string, unknown>) => Promise<unknown>;
  onLendBatch: (payload: Record<string, unknown> & { etiquetas: string[] }) => Promise<LoanBatchResponse>;
  onReturnBatch: (etiquetas: string[]) => Promise<LoanBatchResponse>;
  /** Refresco forzado de equipos y movimientos (después de un Deshacer). */
  onLoanChanged: () => Promise<unknown>;
  onRefresh: () => Promise<unknown>;
  onAgendaSave: (item: Partial<AgendaItem>) => Promise<unknown>;
};

function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

/** "Actualizado hace 12 s": lee la salud del inventario con su propio reloj (no re-renderiza la app). */
function useUpdatedLabel() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick(value => value + 1), 5000);
    return () => window.clearInterval(timer);
  }, []);
  const okAt = getDevicesHealth().okAt;
  if (!okAt) return '';
  const seconds = Math.max(0, Math.round((Date.now() - okAt) / 1000));
  return seconds < 60 ? `hace ${seconds} s` : agoText(Date.now() - okAt);
}

/**
 * Inicio — "Mostrador" (docs/redesign/PLAN.md §9). Solo datos vivos y las
 * acciones frecuentes en un paso: barra de acción, tres contadores, "Afuera
 * ahora", la columna "Ahora" (agenda, tareas, notas) y últimos movimientos.
 * Sin analíticas, sin modales: todo se abre en línea.
 */
export function Dashboard(props: DashboardProps) {
  const { operator, consultationMode = false, devices, sync, agenda, tasks, movements, siteSettings, scan, canOpen, onNavigate, onOpenTask, onOpenLoans, onProfile, onEdit, onLoanChanged, onRefresh, onAgendaSave } = props;
  const [filter, setFilter] = useState<ListFilter>('loaned');
  const [type, setType] = useState('');
  const [query, setQuery] = useState('');
  const [typesOpen, setTypesOpen] = useState(false);
  const [closureOpen, setClosureOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [lendRequest, setLendRequest] = useState<{ etiquetas: string[]; nonce: number }>();
  const [retrying, setRetrying] = useState(false);
  const barStatus = useStatusLine();
  const listStatus = useStatusLine();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const online = useOnline();
  const updated = useUpdatedLabel();
  const healthError = useSyncExternalStore(subscribeDevicesHealth, () => getDevicesHealth().error);

  const readOnly = consultationMode || !online;
  const readOnlyReason = consultationMode ? 'Modo consulta: solo lectura' : 'Sin conexión: prestar y devolver en pausa';
  const options = useMemo(() => loanOptions(siteSettings), [siteSettings]);
  const counts = useMemo(() => countDevices(devices), [devices]);
  const types = useMemo(() => typeStats(devices), [devices]);
  const loading = !devices.length && sync.state === 'loading';
  const listError = healthError || (sync.state === 'error' ? sync.message || 'Error' : '');

  const actions = useLoanActions(devices, {
    onReturn: props.onReturn,
    onReturnBatch: props.onReturnBatch,
    onLend: props.onLend,
    onLendBatch: props.onLendBatch,
    onUndo: async (kind, etiquetas) => {
      try {
        // Contrato compartido con Préstamos: POST /api/loans/undo (loansUndo.routes.js).
        return await undoLoans(etiquetas, kind);
      } finally {
        await onLoanChanged().catch(() => undefined);
      }
    }
  });

  const focusBar = useCallback(() => {
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const scrollTo = (element: HTMLElement | null) => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(() => element?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }), 40);
  };

  // Teclado del Inicio: "/" enfoca la barra, "?" muestra los atajos.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isEditableTarget(event.target)) return;
      if (event.key === '/') { event.preventDefault(); inputRef.current?.focus(); }
      else if (event.key === '?') { event.preventDefault(); setHelp(value => !value); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pickFilter = (next: ListFilter) => { setFilter(next); setType(''); setTypesOpen(false); scrollTo(listRef.current); };
  const toggleTypes = () => {
    if (typesOpen) { setTypesOpen(false); return; }
    setTypesOpen(true);
    setFilter('available');
  };
  const pickType = (next: string) => { setFilter('available'); setType(next); setTypesOpen(false); scrollTo(listRef.current); };
  const lendFromList = (etiquetas: string[]) => {
    if (readOnly) return;
    setLendRequest(current => ({ etiquetas, nonce: (current?.nonce || 0) + 1 }));
    scrollTo(barRef.current);
  };
  const copyTag = async (device: Device) => {
    try {
      if (!navigator.clipboard) throw new Error('El navegador no permite copiar acá.');
      await navigator.clipboard.writeText(device.etiqueta);
      listStatus.show({ tone: 'ok', message: <><b>{device.etiqueta}</b> copiada al portapapeles · {aliasOf(device)}</>, autoHideMs: 3000 });
    } catch (reason) {
      listStatus.show({ tone: 'bad', message: errorMessage(reason, 'No se pudo copiar.') });
    }
  };
  const retry = async () => {
    setRetrying(true);
    try { await onRefresh(); } finally { setRetrying(false); }
  };

  return (
    <section className="dash" aria-label="Inicio">
      <div className="dash-top">
        {!online && (
          <StatusText tone="bad" className="dash-offline"><icons.IconWifiOff size={14} /> Sin conexión · reintentando</StatusText>
        )}
        {consultationMode && <StatusText tone="muted" className="dash-nw"><icons.IconLock size={13} /> Solo lectura</StatusText>}
        <span className="dash-grow" />
        {updated && <span className="dash-updated" role="status">Actualizado <span className="ui-mono">{updated}</span></span>}
        <Button
          variant="secondary"
          className={cx('dash-closure-btn', closureOpen && 'is-on')}
          aria-expanded={closureOpen}
          icon={<ClipboardCheck size={16} strokeWidth={1.6} />}
          onClick={() => setClosureOpen(value => !value)}
        >
          Cierre del día
        </Button>
      </div>

      {closureOpen && <div className="dash-closure"><DailyClosureSection operator={operator} consultationMode={consultationMode} onClose={() => setClosureOpen(false)} /></div>}

      <div ref={barRef} className="dash-anchor">
        <ActionBar
          devices={devices}
          options={options}
          readOnly={readOnly}
          readOnlyReason={readOnlyReason}
          actions={actions}
          status={barStatus}
          scan={scan}
          lendRequest={lendRequest}
          inputRef={inputRef}
          focusBar={focusBar}
          onOpenLoans={onOpenLoans}
          onShowInList={text => { setFilter('all'); setType(''); setQuery(text); scrollTo(listRef.current); }}
          onProfile={onProfile}
        />
      </div>
      {help && <Shortcuts />}

      <StatusTiles
        counts={counts}
        types={types}
        filter={filter}
        type={type}
        typesOpen={typesOpen}
        loading={loading}
        onFilter={pickFilter}
        onToggleTypes={toggleTypes}
        onType={pickType}
      />

      <div className="dash-body">
        <div ref={listRef} className="dash-col-l dash-anchor">
          <OutList
            devices={devices}
            counts={counts}
            filter={filter}
            type={type}
            query={query}
            loading={loading}
            error={listError}
            updatedLabel={updated ? `Actualizado ${updated}` : ''}
            retrying={retrying}
            readOnly={readOnly}
            actions={actions}
            status={listStatus}
            onFilter={next => setFilter(next)}
            onType={setType}
            onQuery={setQuery}
            onRetry={() => void retry()}
            onLend={lendFromList}
            onEdit={onEdit}
            onProfile={onProfile}
            onCopy={device => void copyTag(device)}
            onShortcuts={() => { setHelp(true); scrollTo(barRef.current); }}
          />
        </div>
        <div className="dash-col-r">
          <NowColumn
            agenda={agenda}
            tasks={tasks}
            operator={operator}
            readOnly={readOnly}
            canAgenda={canOpen('agenda')}
            canTasks={canOpen('tasks')}
            onAgendaSave={onAgendaSave}
            onOpenAgenda={() => onNavigate('agenda')}
            onOpenTasks={() => onNavigate('tasks')}
            onOpenTask={task => onOpenTask(String(task.id))}
          />
        </div>
      </div>

      <RecentMoves items={movements} canHistory={canOpen('history')} onHistory={() => onNavigate('history')} />
    </section>
  );
}
