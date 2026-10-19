import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { Device, ViewKey } from '../../types';
import { getAnalytics, getParque, type AnalyticsResponse, type ParqueResponse } from '../../services/analyticsApi';
import { Button, ErrorState, Segmented, Skeleton, cx } from '../../ui';
import { IconRetry } from '../../ui/icons';
import { addDaysToKey, todayKeyAr } from '../../utils/formatters';
import { appScroller } from '../../utils/scroll';
import { DemandSection } from './DemandSection';
import { formatInt, keepInPlace, reducedMotion, registerTail } from './kit';
import '../../styles/screens/analytics.css';

// Las secciones de abajo viajan en su propio chunk: abrir Analítica baja,
// compila y dibuja solo la demanda; el resto se pide cuando el navegador queda
// libre (o al acercarse a la vista, lo que pase primero).
const importLoans = () => import('./LoansSection');
const importParque = () => import('./ParqueSection');
const importTickets = () => import('./TicketsSection');
type LoansModule = Awaited<ReturnType<typeof importLoans>>;
type ParqueModule = Awaited<ReturnType<typeof importParque>>;
type TicketsModule = Awaited<ReturnType<typeof importTickets>>;

/* ══════════════════════════════════════════════════════════════════════════
   Analítica (etapa 8a): propuesta 05 "Planificar la demanda". Índice fijo de
   secciones, período como Segmented chico, gráficos propios en SVG/HTML que
   se dibujan recién al acercarse a la vista y valor exacto en línea.
   ══════════════════════════════════════════════════════════════════════════ */

type RangePreset = 'week' | 'month' | 'quarter' | 'year' | 'all';

const PRESETS: Array<{ key: RangePreset; label: string; long: string; inPeriod: string; days: number }> = [
  { key: 'week', label: 'Semana', long: 'Última semana', inPeriod: 'en la última semana', days: 7 },
  { key: 'month', label: 'Mes', long: 'Último mes', inPeriod: 'en el último mes', days: 30 },
  { key: 'quarter', label: '3 meses', long: 'Últimos 3 meses', inPeriod: 'en los últimos 3 meses', days: 92 },
  { key: 'year', label: 'Año', long: 'Último año', inPeriod: 'en el último año', days: 365 },
  { key: 'all', label: 'Todo', long: 'Todo el historial', inPeriod: 'en todo el historial', days: 3650 }
];

const SECTIONS = [
  { id: 'an-dem', n: '01', label: 'Demanda', short: 'Demanda' },
  { id: 'an-pre', n: '02', label: 'Préstamos', short: 'Préstamos' },
  { id: 'an-par', n: '03', label: 'Parque', short: 'Parque' },
  { id: 'an-tic', n: '04', label: 'Tickets', short: 'Tickets' },
  { id: 'an-eq', n: '05', label: 'Equipo TIC', short: 'Equipo' }
];

const dmy = (key: string) => key.split('-').reverse().join('/');
const timeFormat = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });

export function AnalyticsPage({ onNavigate }: { devices?: Device[]; onRefresh?: () => Promise<unknown> | void; onNavigate?: (view: ViewKey) => void }) {
  const [preset, setPreset] = useState<RangePreset>('year');
  const today = useMemo(() => todayKeyAr(), []);
  const period = PRESETS.find(item => item.key === preset) || PRESETS[3];
  const range = useMemo(() => ({ from: addDaysToKey(today, -period.days), to: today }), [period.days, today]);

  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const request = useRef(0);

  const [parque, setParque] = useState<ParqueResponse | null>(null);
  const [parqueLoading, setParqueLoading] = useState(true);
  const [parqueError, setParqueError] = useState('');
  const parqueRequest = useRef(0);

  const load = useCallback(async (fresh = false) => {
    const id = ++request.current;
    setLoading(true);
    setError('');
    try {
      const response = await getAnalytics(range.from, range.to, fresh);
      if (id !== request.current) return;
      setData(response);
      setUpdatedAt(new Date());
    } catch (err) {
      if (id !== request.current) return;
      setError(err instanceof Error ? err.message : 'No se pudo cargar la analítica.');
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [range.from, range.to]);

  const loadParque = useCallback(async (fresh = false) => {
    const id = ++parqueRequest.current;
    setParqueLoading(true);
    setParqueError('');
    try {
      const response = await getParque(fresh);
      if (id === parqueRequest.current) setParque(response);
    } catch (err) {
      if (id === parqueRequest.current) setParqueError(err instanceof Error ? err.message : 'No se pudo cargar el parque.');
    } finally {
      if (id === parqueRequest.current) setParqueLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadParque(); }, [loadParque]);
  // Con la demanda ya dibujada, el resto del código se baja en un rato libre.
  const hasData = Boolean(data);
  useEffect(() => {
    if (!hasData) return;
    // Después se arman las secciones de a una, cada una en su propio rato libre
    // (sin tareas largas): cuando llegás scrolleando —o saltando al final— ya
    // están dibujadas y nada cambia de alto a la vista.
    let cancelled = false;
    let handle = 0;
    const idle = (fn: () => void) => {
      handle = 'requestIdleCallback' in window ? window.requestIdleCallback(fn, { timeout: 2000 }) : globalThis.setTimeout(fn, 300);
    };
    const queue = SECTIONS.slice(1).map(section => section.id);
    const step = () => {
      if (cancelled) return;
      const next = queue.shift();
      if (!next) return;
      void Promise.all([...mountWaiters].map(waiter => waiter([next]))).then(() => idle(step));
    };
    idle(() => {
      void Promise.all([importLoans(), importParque(), importTickets()]).catch(() => undefined).then(() => { if (!cancelled) idle(step); });
    });
    return () => {
      cancelled = true;
      if ('requestIdleCallback' in window) window.cancelIdleCallback(handle); else globalThis.clearTimeout(handle);
    };
  }, [hasData]);

  const reload = () => { void load(true); void loadParque(true); };
  const busy = loading || parqueLoading;
  const failed = Boolean(error) && !data;
  const summary = data?.summary;
  const unreviewed = parque?.condicionTotales.find(row => row.label === 'Sin revisar')?.value;

  const rangeLabel = preset === 'all' ? 'Desde el primer registro' : `${dmy(range.from)} – ${dmy(range.to)}`;
  const headLine = busy && !summary ? 'Cargando préstamos, tickets y parque…'
    : loading ? 'Actualizando préstamos, tickets y parque…'
    : error && summary ? 'No se pudo actualizar: siguen a la vista los datos que ya estaban cargados'
    : summary ? `${formatInt(summary.totalPrestamos)} préstamos y ${formatInt(summary.totalDevoluciones)} devoluciones${updatedAt ? ` · actualizado a las ${timeFormat.format(updatedAt)}` : ''}`
    : 'No se pudieron cargar los datos';

  const current = useActiveSection();

  return (
    <section className="an-page" aria-labelledby="an-title">
      <header className="an-head">
        <div className="an-head-text">
          <span className="an-eyebrow">Inventario y datos</span>
          <h2 className="an-title" id="an-title">Analítica</h2>
          <p className="an-head-line" aria-live="polite"><span className="g-num an-head-range">{rangeLabel}</span><span className="an-head-sep" aria-hidden="true">·</span><span>{headLine}</span></p>
        </div>
        <div className="an-head-actions">
          <Segmented<RangePreset>
            size="sm"
            ariaLabel="Período"
            value={preset}
            onChange={setPreset}
            options={PRESETS.map(item => ({ value: item.key, label: item.label }))}
            className="an-period"
          />
          <Button size="sm" variant="secondary" icon={<IconRetry size={14} />} loading={busy} loadingLabel="Actualizando…" onClick={reload} aria-label="Recargar préstamos, tickets y parque">Recargar</Button>
        </div>
      </header>

      <nav className="an-index" aria-label="Índice de Analítica">
        <div className="an-index-links">
          {SECTIONS.map(section => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className={cx('an-index-link', current === section.id && 'is-on')}
              aria-current={current === section.id ? 'location' : undefined}
              aria-label={`${section.n} ${section.label}`}
              onClick={event => goToSection(event, section.id)}
            >
              <span className="an-index-n" aria-hidden="true">{section.n}</span>
              <span className="an-index-full" aria-hidden="true">{section.label}</span>
              <span className="an-index-short" aria-hidden="true">{section.short}</span>
            </a>
          ))}
        </div>
        <span className="an-index-meta">{period.long} · {summary ? <span className="g-num">{formatInt(summary.totalPrestamos)}</span> : <Skeleton width="1.5rem" height="0.75rem" />} préstamos</span>
      </nav>

      {error && summary && <ErrorState message={`No se pudo actualizar: ${error}. Se muestran los datos anteriores.`} onRetry={() => void load(true)} retrying={loading} />}

      <div className={cx('an-body', loading && summary && 'is-busy')} aria-busy={loading || undefined}>
        {/* Cada sección vive en un "slot" con su id (ancla del índice). Las de
            abajo se arman recién cuando se acercan a la vista: abrir Analítica
            dibuja primero la demanda y no paga el resto de una. */}
        <div className="an-anchor" id="an-dem">
          {failed ? <PeriodError label="la demanda" error={error} onRetry={() => void load(true)} retrying={loading} />
            : <DemandSection summary={summary} loading={loading} unreviewed={unreviewed} />}
        </div>
        <Deferred<LoansModule> id="an-pre" n="02" label="Préstamos" load={importLoans} render={({ LoansSection }) => (failed
          ? <PeriodError label="los préstamos" error={error} onRetry={() => void load(true)} retrying={loading} />
          : <LoansSection summary={summary} loading={loading} periodLabel={period.inPeriod} onOpenSettings={onNavigate ? () => onNavigate('settings') : undefined} />)} />
        <Deferred<ParqueModule> id="an-par" n="03" label="Parque" load={importParque} render={({ ParqueSection }) => (
          <ParqueSection data={parque} loading={parqueLoading} error={parqueError} onRetry={() => void loadParque(true)} />)} />
        <Deferred<TicketsModule> id="an-tic" n="04" label="Tickets" load={importTickets} render={({ TicketsSection }) => (failed
          ? <PeriodError label="los tickets" error={error} onRetry={() => void load(true)} retrying={loading} />
          : <TicketsSection summary={summary} loading={loading} periodLabel={period.inPeriod} />)} />
        <Deferred<TicketsModule> id="an-eq" n="05" label="Equipo TIC" load={importTickets} render={({ TeamSection }) => (failed
          ? <PeriodError label="la actividad del equipo" error={error} onRetry={() => void load(true)} retrying={loading} />
          : <TeamSection summary={summary} loading={loading} onOpenTasks={onNavigate ? () => onNavigate('tasks') : undefined} />)} />
        <div className="an-tail" ref={registerTail} aria-hidden="true" />
      </div>
    </section>
  );
}

/* ── Secciones diferidas ──
   Hasta que se acercan a la vista (120 px antes del borde de abajo) se ve el
   encabezado de la sección con un bloque reservado; se arman por debajo de
   lo que estás mirando, así nada de lo visible se mueve. */

const mountWaiters = new Set<(ids: string[]) => Promise<void>>();

/** Arma una sección sin mover lo que se ve: queda fija la primera sección visible arriba (scroll compensado en el mismo frame). */
function mountInPlace(mount: () => void) {
  const indexBottom = document.querySelector('.an-index')?.getBoundingClientRect().bottom ?? 0;
  const anchor = [...document.querySelectorAll<HTMLElement>('.an-anchor')].find(node => node.getBoundingClientRect().bottom > indexBottom + 1) || null;
  keepInPlace(anchor, mount);
}

function Deferred<M>({ id, n, label, load, render }: { id: string; n: string; label: string; load: () => Promise<M>; render: (module: M) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [module, setModule] = useState<M | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  // Baja el código (si hace falta) y recién ahí arma la sección, de una y en
  // el mismo frame que compensa el scroll: nunca queda un "cargando" a la vista.
  const mount = useCallback(() => loadRef.current().then(loaded => {
    mountInPlace(() => setModule(() => loaded));
  }).catch(() => undefined), []);
  const ready = module !== null;
  useEffect(() => {
    if (ready) return;
    const waiter = (ids: string[]) => (ids.includes(id) ? mount() : Promise.resolve());
    mountWaiters.add(waiter);
    return () => { mountWaiters.delete(waiter); };
  }, [ready, id, mount]);
  useEffect(() => {
    if (ready) return;
    if (!ref.current || typeof IntersectionObserver === 'undefined') { void mount(); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect();
        void mount();
      }
    }, { root: appScroller(), rootMargin: '0px 0px 120px 0px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ready, mount]);
  return (
    <div className="an-anchor" id={id} ref={ref}>
      {module ? render(module) : (
        <section className="an-sec an-sec--pending" aria-label={`${n} · ${label}`} aria-busy="true">
          <header className="an-sec-head">
            <span className="an-eyebrow">{n} · {label}</span>
            <Skeleton width="min(28rem, 80%)" height="1.5rem" />
          </header>
          <div className="an-pending-block" aria-hidden="true" />
        </section>
      )}
    </div>
  );
}

function PeriodError({ label, error, onRetry, retrying }: { label: string; error: string; onRetry: () => void; retrying: boolean }) {
  return (
    <section className="an-sec">
      <ErrorState message={`No se pudo cargar ${label}: ${error}`} onRetry={onRetry} retrying={retrying} />
    </section>
  );
}

/* ── Índice: marca la sección actual al scrollear (IntersectionObserver) ── */

let lockUntil = 0;
let lockedId = '';
const listeners = new Set<(id: string) => void>();

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

function goToSection(event: MouseEvent<HTMLAnchorElement>, id: string) {
  event.preventDefault();
  if (!document.getElementById(id)) return;
  const smooth = !reducedMotion();
  lockedId = id;
  lockUntil = Date.now() + 4000;
  listeners.forEach(listener => listener(id));
  // Antes de viajar se arman TODAS las secciones (y se espera su código):
  // así nada cambia de alto en el camino ni después, y la sección llega
  // justo bajo el índice, sin saltos.
  const all = SECTIONS.map(section => section.id);
  void Promise.all([...mountWaiters].map(waiter => waiter(all)))
    .catch(() => undefined)
    .then(nextFrame)
    .then(nextFrame)
    .then(() => travel(id, smooth));
}

function travel(id: string, smooth: boolean) {
  const target = document.getElementById(id);
  if (!target) return;
  lockUntil = Date.now() + (smooth ? 900 : 150);
  target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  target.querySelector<HTMLElement>('.an-sec-title')?.focus({ preventScroll: true });
  // Si algo de arriba cambió de alto mientras viajaba (un gráfico que terminó
  // de llegar), al terminar se corrige para que la sección quede justo bajo el índice.
  const scroller = appScroller();
  if (!scroller) return;
  let done = false;
  const realign = () => {
    if (done) return;
    done = true;
    const indexBottom = document.querySelector('.an-index')?.getBoundingClientRect().bottom ?? 0;
    const delta = target.getBoundingClientRect().top - (indexBottom + 8);
    if (Math.abs(delta) > 2) scroller.scrollTop += delta;
    lockUntil = Date.now() + 150;
    // La sección pudo armarse recién al llegar: el foco va a su título.
    const title = target.querySelector<HTMLElement>('.an-sec-title');
    if (title && document.activeElement !== title) title.focus({ preventScroll: true });
  };
  scroller.addEventListener('scrollend', realign, { once: true });
  window.setTimeout(realign, smooth ? 1000 : 60);
}

function useActiveSection() {
  const [current, setCurrent] = useState(SECTIONS[0].id);
  useEffect(() => {
    const scroller = appScroller();
    const visible = new Map<string, boolean>();
    const pick = () => {
      if (Date.now() < lockUntil) { setCurrent(lockedId); return; }
      if (scroller && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) {
        setCurrent(SECTIONS[SECTIONS.length - 1].id);
        return;
      }
      const first = SECTIONS.find(section => visible.get(section.id));
      if (first) setCurrent(first.id);
    };
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      for (const entry of entries) visible.set(entry.target.id, entry.isIntersecting);
      pick();
    }, { root: scroller, rootMargin: '-64px 0px -55% 0px', threshold: 0 });
    const observed = new Set<string>();
    const attach = () => {
      for (const section of SECTIONS) {
        const node = document.getElementById(section.id);
        if (node && !observed.has(section.id)) { observer?.observe(node); observed.add(section.id); }
      }
    };
    attach();
    // Las secciones aparecen cuando llegan los datos: se vuelven a enganchar.
    const retry = window.setInterval(() => { attach(); if (observed.size === SECTIONS.length) window.clearInterval(retry); }, 400);
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (Date.now() >= lockUntil && scroller && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) setCurrent(SECTIONS[SECTIONS.length - 1].id);
      });
    };
    scroller?.addEventListener('scroll', onScroll, { passive: true });
    const onLock = (id: string) => setCurrent(id);
    listeners.add(onLock);
    const release = () => { if (Date.now() >= lockUntil) return; lockUntil = 0; pick(); };
    scroller?.addEventListener('scrollend', release);
    return () => {
      observer?.disconnect();
      window.clearInterval(retry);
      scroller?.removeEventListener('scroll', onScroll);
      scroller?.removeEventListener('scrollend', release);
      listeners.delete(onLock);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return current;
}
