import { useMemo, useRef, useState } from 'react';
import type { AnalyticsRow, AnalyticsSummary } from '../../services/analyticsApi';
import { Segmented } from '../../ui';
import { downloadCsv } from '../../utils/download';
import { todayKeyAr } from '../../utils/formatters';
import { CategoryPanel } from './LoansSection';
import {
  CsvButton, EmptyCard, FlowRows, GroupedColumns, KpiStrip, Lazy, LineChart, Panel, SimpleTable, ThinRing, formatDec, formatInt, keepInPlace, lineHeight, pct, useActive,
  type FlowItem, type Group, type Kpi, type View
} from './kit';
import { GRAN_LABEL, evolutionPoints, sum, versusPrevious } from './model';

const PRIORITY_ORDER = ['Urgente', 'Alta', 'Media', 'Baja', 'Sin prioridad'];
const TOP_OPTIONS = [10, 15, 25, 50].map(value => ({ value: String(value), label: String(value) }));

type Props = { summary?: AnalyticsSummary; loading: boolean; periodLabel: string };

export function TicketsSection({ summary, loading, periodLabel }: Props) {
  const initial = loading && !summary;
  const metrics = summary?.ticketMetrics;
  const created = metrics?.created ?? 0;
  const resolved = metrics?.resolved ?? 0;
  const kpis: Kpi[] = [
    { label: 'Tickets abiertos', value: formatInt(summary?.ticketsAbiertos ?? 0), hint: 'foto actual' },
    { label: 'Tickets creados', value: formatInt(created), hint: <><span className="g-num">{formatInt(resolved)}</span> resueltos · en el período</> },
    { label: 'Resolución promedio', value: resolved ? `${formatDec(metrics?.averageResolutionHours ?? 0)} h` : '—', tone: resolved ? undefined : 'muted', hint: 'de los resueltos · en el período' },
    { label: 'Primera respuesta', value: metrics?.averageResponseHours ? `${formatDec(metrics.averageResponseHours)} h` : '—', tone: metrics?.averageResponseHours ? undefined : 'muted', hint: 'promedio · en el período' },
    { label: 'Respuesta histórica', value: summary?.ticketResponseDays ? `${formatDec(summary.ticketResponseDays)} d` : '—', tone: summary?.ticketResponseDays ? undefined : 'muted', hint: 'días · todos los tickets hechos' }
  ];
  const headline = initial ? 'Cargando los tickets…'
    : created ? `${formatInt(created)} tickets creados ${periodLabel}; ${pct(resolved, created)} ya resueltos`
    : summary?.ticketsAbiertos ? `Sin tickets nuevos ${periodLabel}; quedan ${formatInt(summary.ticketsAbiertos)} abiertos`
    : 'Sin tickets en el período';

  const lists = {
    prio: metrics?.byPriority || [],
    tech: metrics?.byTechnician || [],
    school: metrics?.bySchool || [],
    cat: metrics?.byCategory || [],
    room: metrics?.byClassroom || [],
    rec: metrics?.recurring || [],
    fail: summary?.byTicketDevice || []
  };
  const has = (key: string) => {
    if (initial) return true;
    if (key === 'evo') return created > 0 || Boolean(metrics?.evolution.points.some(point => (point.prev || 0) > 0));
    if (key === 'oc') return created > 0;
    return (lists[key as keyof typeof lists] || []).length > 0;
  };
  const rows: FlowItem[][] = [
    [['evo', 8], ['oc', 4]],
    [['prio', 4], ['tech', 4], ['school', 4]],
    [['cat', 6], ['room', 6]],
    [['rec', 6], ['fail', 6]],
  ];
  const NAMES: Record<string, [string, string]> = {
    evo: ['Tendencia de tickets', 'línea con el período anterior'],
    oc: ['Abiertos vs. cerrados', 'anillos finos'],
    prio: ['Por prioridad', 'columnas en orden'],
    tech: ['Por técnico', 'columnas'],
    school: ['Por escuela', 'columnas'],
    cat: ['Por categoría', 'tabla ranking'],
    room: ['Por aula', 'tabla ranking'],
    rec: ['Incidentes recurrentes', 'tabla, más de una vez'],
    fail: ['Equipos con más fallas', 'tabla, foto actual']
  };
  const missing = Object.keys(NAMES).filter(key => !has(key)).map(key => ({ name: NAMES[key][0], shape: NAMES[key][1] }));

  const render = (key: string, span: number) => {
    switch (key) {
      case 'evo': return <TicketEvolution key={key} span={span} summary={summary} />;
      case 'oc': return <OpenClosed key={key} span={span} created={created} resolved={resolved} loading={initial} />;
      case 'prio': return <CategoryPanel key={key} id="an-prio" span={span} eyebrow="Por prioridad · columnas en orden" title="Tickets por prioridad" rows={lists.prio} total={created} noun="tickets" loading={initial} order={PRIORITY_ORDER} readoutLabel="La más usada" />;
      case 'tech': return <CategoryPanel key={key} id="an-tech" span={span} eyebrow="Por técnico · columnas" title="Tickets por técnico" rows={lists.tech} total={created} noun="tickets" loading={initial} readoutLabel="Con más tickets" />;
      case 'school': return <CategoryPanel key={key} id="an-school" span={span} eyebrow="Por escuela · columnas" title="Tickets por escuela" rows={lists.school} total={created} noun="tickets" loading={initial} readoutLabel="Con más tickets" />;
      case 'cat': return <RankPanel key={key} id="an-cat" span={span} eyebrow="Por categoría · ranking" title="Tickets por categoría" head="Categoría" rows={lists.cat} total={created} file="tickets-por-categoria" loading={initial} />;
      case 'room': return <RankPanel key={key} id="an-room" span={span} eyebrow="Por aula · ranking" title="Tickets por aula" head="Aula" rows={lists.room} total={created} file="tickets-por-aula" loading={initial} />;
      case 'rec': return <RankPanel key={key} id="an-rec" span={span} eyebrow="Incidentes recurrentes · más de una vez" title="Lo que se repite" head="Incidente" rows={lists.rec} total={created} file="incidentes-recurrentes" loading={initial} note="Misma categoría (o mismo título si no tiene) más de una vez en el período; hasta 12." />;
      case 'fail': return <RankPanel key={key} id="an-fail" span={span} eyebrow="Equipos con más fallas · foto actual" title="Equipos mencionados en tickets activos" head="Equipo" rows={lists.fail} total={sum(lists.fail.map(row => row.value))} file="equipos-con-mas-fallas" loading={initial} note="Etiquetas D… escritas en el título, la descripción o la nota de los tickets activos; no cambia con el período." />;
      default: return null;
    }
  };

  return (
    <section className="an-sec" aria-labelledby="an-tic-h">
      <header className="an-sec-head">
        <span className="an-eyebrow">04 · Tickets · según el período</span>
        <h3 className="an-sec-title" id="an-tic-h" tabIndex={-1}>{headline}</h3>
      </header>
      <KpiStrip label="Tickets" items={kpis} loading={initial} />
      <FlowRows rows={rows} has={has} render={render} />
      {!initial && missing.length > 0 && (
        <EmptyCard
          id="an-tic-empty"
          title={missing.length === Object.keys(NAMES).length ? 'Sin tickets para graficar en el período' : 'Sin datos para estos gráficos en el período'}
          reason={missing.length === Object.keys(NAMES).length ? 'Cuando haya tickets creados en el período aparecen acá. Equipos con más fallas mira los tickets activos de cualquier fecha.' : 'Aparecen en cuanto los tickets del período tengan ese dato.'}
          items={missing}
        />
      )}
    </section>
  );
}

function TicketEvolution({ span, summary }: { span: number; summary?: AnalyticsSummary }) {
  const { active, setActive, groupProps } = useActive();
  const [view, setView] = useState<View>('chart');
  const evolution = summary?.ticketMetrics.evolution;
  const points = useMemo(() => evolutionPoints(evolution), [evolution]);
  const showPrev = Boolean(evolution?.prevAvailable);
  const gran = evolution ? GRAN_LABEL[evolution.granularity] : 'mes';
  const now = sum(points.map(point => point.value));
  const before = sum(points.map(point => point.prev || 0));
  const readout = active !== null && points[active]
    ? `${points[active].long} · ${formatInt(points[active].value)} tickets${showPrev ? ` · período anterior: ${formatInt(points[active].prev || 0)}` : ''}`
    : `${formatInt(now)} tickets creados${showPrev ? `, ${versusPrevious(now, before)}` : ''}.`;
  return (
    <Panel id="an-tevo" span={span} eyebrow={`Tendencia · por ${gran}${showPrev ? ' · vs. período anterior' : ''}`} title={`Tickets creados por ${gran}`} view={view} onView={setView} readout={summary ? readout : undefined}>
      {view === 'table' && summary ? (
        <SimpleTable caption={`Tickets creados por ${gran}`} head={showPrev ? ['Fecha', 'Este período', 'Período anterior'] : ['Fecha', 'Tickets']} rows={points.map(point => showPrev ? [point.long, formatInt(point.value), formatInt(point.prev || 0)] : [point.long, formatInt(point.value)])} />
      ) : (
        <Lazy height={lineHeight(160)} kind="line">
          {() => <div {...groupProps}><LineChart points={points} height={160} active={active} onActive={setActive} showPrev={showPrev} ariaLabel={`Gráfico de línea: tickets creados por ${gran}.`} /></div>}
        </Lazy>
      )}
    </Panel>
  );
}

function OpenClosed({ span, created, resolved, loading }: { span: number; created: number; resolved: number; loading: boolean }) {
  const open = Math.max(0, created - resolved);
  return (
    <Panel id="an-oc" span={span} eyebrow="Anillos finos · en el período" title="Abiertos vs. cerrados" readout={loading ? undefined : `${formatInt(open)} de ${formatInt(created)} tickets del período siguen abiertos (${pct(open, created)}).`}>
      <div className="an-rings">
        <span className="an-ring-stat"><ThinRing value={open} total={created} /><span><span className="an-ring-n">{formatInt(open)}</span><span className="an-ring-l">Abiertos · {pct(open, created)}</span></span></span>
        <span className="an-ring-stat"><ThinRing value={resolved} total={created} /><span><span className="an-ring-n">{formatInt(resolved)}</span><span className="an-ring-l">Cerrados · {pct(resolved, created)}</span></span></span>
      </div>
    </Panel>
  );
}

/** Ranking simple con Top N y CSV. */
export function RankPanel({ id, span, eyebrow, title, head, rows, total, file, loading, note }: {
  id: string;
  span: number;
  eyebrow: string;
  title: string;
  head: string;
  rows: AnalyticsRow[];
  total: number;
  file: string;
  loading: boolean;
  note?: string;
}) {
  const [top, setTop] = useState(10);
  const ref = useRef<HTMLDivElement>(null);
  const clean = rows.filter(row => row.value > 0);
  const exportCsv = () => downloadCsv(`${file}-${todayKeyAr()}.csv`, [['Puesto', head, 'Cantidad', '%'], ...clean.map((row, index) => [index + 1, row.label, row.value, pct(row.value, total)])]);
  return (
    <Panel id={id} span={span} eyebrow={eyebrow} title={title}
      tools={<div ref={ref} className="an-tools-row">
        {clean.length > 10 && <Segmented size="sm" ariaLabel="Cuántos mostrar" value={String(top)} onChange={value => keepInPlace(ref.current, () => setTop(Number(value)))} options={TOP_OPTIONS} />}
        <CsvButton onExport={exportCsv} disabled={!clean.length} />
      </div>}
      note={loading ? undefined : [clean.length > top ? `Mostrando ${top} de ${clean.length}.` : '', note || ''].filter(Boolean).join(' ') || undefined}>
      {loading ? <Lazy height={180} kind="rows">{() => null}</Lazy> : (
        <SimpleTable caption={title} head={['#', head, 'Cant.', '%']} cols="1.5rem minmax(0, 1fr) 3.5rem 3.5rem" rowHeader={1} align={['end', 'start', 'end', 'end']}
          rows={clean.slice(0, top).map((row, index) => [<span key="r" className="an-rank">{index + 1}</span>, row.label, formatInt(row.value), <span key="p" className="an-dim">{pct(row.value, total)}</span>])} />
      )}
    </Panel>
  );
}

/* ══ 05 · Equipo TIC ══════════════════════════════════════════════════════ */

export function TeamSection({ summary, loading, onOpenTasks }: { summary?: AnalyticsSummary; loading: boolean; onOpenTasks?: () => void }) {
  const initial = loading && !summary;
  const ops = summary?.byOperatorSplit || [];
  const loansTotal = sum(ops.map(op => op.prestamos));
  const returnsTotal = sum(ops.map(op => op.devoluciones));
  const movesTotal = loansTotal + returnsTotal;
  const lead = ops[0];
  const flip = ops.find(op => op.devoluciones > op.prestamos && op !== lead);
  const headline = initial ? 'Cargando la actividad del equipo…'
    : !lead ? 'Sin movimientos registrados en el período'
    : `${lead.label} registró ${pct(lead.prestamos + lead.devoluciones, movesTotal)} de los movimientos${flip ? `; ${flip.label} hace más devoluciones que préstamos` : ''}`;
  const hasPanel = (key: string) => key === 'tasks' || initial || ops.length > 0;
  return (
    <section className="an-sec" aria-labelledby="an-eq-h">
      <header className="an-sec-head">
        <span className="an-eyebrow">05 · Equipo TIC · según el período</span>
        <h3 className="an-sec-title" id="an-eq-h" tabIndex={-1}>{headline}</h3>
      </header>
      {/* Tareas abiertas al lado del gráfico de operadores: si queda mucho más corta, la fila se apila (sin franja vacía al costado). */}
      <FlowRows rows={[[['ops', 8], ['tasks', 4]]]} has={hasPanel} render={(key, span) => (key === 'ops'
        ? <OperatorsPanel span={span} ops={ops} loansTotal={loansTotal} returnsTotal={returnsTotal} loading={initial} />
        : <TasksPanel span={span} summary={summary} loading={initial} onOpenTasks={onOpenTasks} />)} />
    </section>
  );
}

function OperatorsPanel({ span, ops, loansTotal, returnsTotal, loading }: { span: number; ops: AnalyticsSummary['byOperatorSplit']; loansTotal: number; returnsTotal: number; loading: boolean }) {
  const { active, setActive, groupProps } = useActive();
  const [view, setView] = useState<View>('chart');
  const shown = ops.slice(0, 6);
  const groups: Group[] = shown.map(op => ({
    key: op.label,
    label: op.label,
    aria: `${op.label}: ${pct(op.prestamos, loansTotal)} de los préstamos y ${pct(op.devoluciones, returnsTotal)} de las devoluciones`,
    values: [
      { value: loansTotal ? op.prestamos / loansTotal : 0, display: pct(op.prestamos, loansTotal) },
      { value: returnsTotal ? op.devoluciones / returnsTotal : 0, display: pct(op.devoluciones, returnsTotal) }
    ]
  }));
  const readout = active !== null && shown[active]
    ? `${shown[active].label} · ${pct(shown[active].prestamos, loansTotal)} de los préstamos (${formatInt(shown[active].prestamos)}) y ${pct(shown[active].devoluciones, returnsTotal)} de las devoluciones (${formatInt(shown[active].devoluciones)})`
    : shown.slice(0, 2).map(op => `${op.label}: ${pct(op.prestamos, loansTotal)} de los préstamos y ${pct(op.devoluciones, returnsTotal)} de las devoluciones`).join(' · ');
  const keys = (
    <span className="an-keys" aria-hidden="true">
      <span className="an-key"><i className="an-swatch is-accent" />Préstamos</span>
      <span className="an-key"><i className="an-swatch is-series2" />Devoluciones</span>
    </span>
  );
  return (
    <Panel id="an-ops" span={span} eyebrow="Actividad TIC · columnas agrupadas" title="Quién registró los préstamos y las devoluciones" tools={keys} view={view} onView={setView} readout={loading ? undefined : readout}
      note={`Porcentaje de todos los préstamos y de todas las devoluciones del período. Los nombres se agrupan sin distinguir mayúsculas ("Equi" y "equi" cuentan juntos).${ops.length > 6 ? ` Se muestran 6 de ${ops.length}; la Tabla tiene todos.` : ''}`}>
      {view === 'table' ? (
        <SimpleTable caption="Préstamos y devoluciones por operador" head={['Operador', 'Préstamos', '%', 'Devoluciones', '%']} rows={ops.map(op => [op.label, formatInt(op.prestamos), pct(op.prestamos, loansTotal), formatInt(op.devoluciones), pct(op.devoluciones, returnsTotal)])} />
      ) : (
        <Lazy height={184 + 28} kind="groups">
          {() => <div {...groupProps}><GroupedColumns groups={groups} series={[{ name: 'Préstamos', tone: 'accent' }, { name: 'Devoluciones', tone: 'series2' }]} height={184} active={active} onActive={setActive} ariaLabel="Columnas agrupadas por operador: porcentaje de los préstamos y de las devoluciones que registró cada uno." /></div>}
        </Lazy>
      )}
    </Panel>
  );
}

function TasksPanel({ span, summary, loading, onOpenTasks }: { span: number; summary?: AnalyticsSummary; loading: boolean; onOpenTasks?: () => void }) {
  const open = summary?.openTasksByType || [];
  const all = summary?.byTaskType || [];
  const openByLabel = new Map(open.map(row => [row.label, row.value]));
  return (
    <Panel id="an-tasks" span={span} eyebrow="Tareas · foto actual" title="Tareas abiertas">
      <span className="an-big">{loading ? '·' : formatInt(summary?.tareasAbiertas ?? 0)}</span>
      {!loading && (all.length ? (
        <SimpleTable caption="Tareas por tipo" head={['Tipo de tarea', 'Abiertas', 'Todas']} rows={all.map(row => [row.label, formatInt(openByLabel.get(row.label) || 0), formatInt(row.value)])} />
      ) : <p className="an-note">No hay tareas cargadas.</p>)}
      {onOpenTasks && <button type="button" className="an-link an-link--end" onClick={onOpenTasks}>Ir a Tareas TIC</button>}
    </Panel>
  );
}
