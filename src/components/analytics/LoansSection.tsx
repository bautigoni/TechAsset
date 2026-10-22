import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnalyticsRow, AnalyticsSummary, DeviceRankRow } from '../../services/analyticsApi';
import { Segmented, cx } from '../../ui';
import { downloadCsv } from '../../utils/download';
import { todayKeyAr } from '../../utils/formatters';
import {
  Columns, CsvButton, EmptyCard, FlowRows, KpiStrip, Lazy, LineChart, Panel, PartsRing, SimpleTable, columnsHeight, formatDec, formatInt, hoursLabel, keepInPlace, lineHeight, pct, useActive, useNarrow, useWidth,
  type Column, type Kpi, type Part, type TableSort, type Tone, type View
} from './kit';
import { GRAN_LABEL, evolutionPoints, monthLong, sum, topWithRest, versusPrevious } from './model';

type Props = {
  summary?: AnalyticsSummary;
  loading: boolean;
  periodLabel: string;
  onOpenSettings?: () => void;
};

const TOP_OPTIONS = [10, 15, 25, 50].map(value => ({ value: String(value), label: String(value) }));

export function LoansSection({ summary, loading, periodLabel, onOpenSettings }: Props) {
  const total = summary?.totalPrestamos ?? 0;
  const durations = summary?.durations;
  const maxDevice = summary?.avgLoanHoursByDevice?.find(row => row.value > 0);
  const initial = loading && !summary;

  const kpis: Kpi[] = [
    { label: 'Préstamos', value: formatInt(total), hint: <><span className="g-num">{formatInt(summary?.totalDevoluciones ?? 0)}</span> devoluciones · en el período</> },
    { label: 'Personas distintas', value: formatInt(summary?.personasUnicas ?? 0), hint: 'pidieron al menos un equipo · en el período' },
    { label: 'Equipos distintos', value: formatInt(summary?.equiposUnicos ?? 0), hint: 'salieron al menos una vez · en el período' },
    {
      label: 'Duración mediana',
      value: durations?.count ? hoursLabel(durations.median) : '—',
      tone: durations?.count ? undefined : 'muted',
      hint: <>todo el historial{maxDevice ? <> · máx. por equipo: {maxDevice.label}, <span className="g-num">{formatDec(maxDevice.value)} h</span></> : null}</>
    }
  ];

  const headline = initial ? 'Cargando los préstamos del período…'
    : !total ? `Sin préstamos ${periodLabel}`
    : `${formatInt(total)} préstamos ${periodLabel}${durations?.count ? `; la mitad vuelve en menos de ${hoursLabel(durations.median)}` : ''}`;

  const people = summary?.byPersonGrouped || [];
  const devicesRank = summary?.byDeviceTag || [];
  const extras = {
    loc: summary?.byLocation || [],
    reason: summary?.byReason || [],
    course: summary?.byCourse || []
  };
  const has = (key: string) => {
    if (initial) return true;
    if (key === 'evo') return Boolean(summary?.evolution.points.some(point => point.value > 0 || (point.prev || 0) > 0));
    if (key === 'ann') return Boolean(summary);
    if (key === 'dur') return Boolean(durations?.count);
    if (key === 'eq') return devicesRank.length > 0 || (summary?.byType.length ?? 0) > 0;
    if (key === 'per') return people.length > 0;
    if (key === 'loc') return extras.loc.length > 0;
    if (key === 'reason') return extras.reason.length > 0;
    if (key === 'course') return extras.course.length > 0;
    return false;
  };
  const missing = [
    !has('evo') && { name: 'Evolución de préstamos', shape: 'línea con el período anterior' },
    !has('dur') && { name: 'Duración de los préstamos', shape: 'diagrama de puntos' },
    !has('eq') && { name: 'Equipos más prestados', shape: 'tabla ranking' },
    !has('per') && { name: 'Personas que más pidieron', shape: 'tabla ranking' },
    !has('loc') && { name: 'Ubicaciones', shape: 'columnas por lugar' },
    !has('reason') && { name: 'Motivos de préstamo', shape: 'anillo de partes' },
    !has('course') && { name: 'Top cursos', shape: 'columnas por curso' }
  ].filter(Boolean) as Array<{ name: string; shape: string }>;
  const onlyExtrasMissing = missing.length > 0 && missing.every(item => ['Ubicaciones', 'Motivos de préstamo', 'Top cursos'].includes(item.name));

  const render = (key: string, span: number) => {
    switch (key) {
      case 'evo': return <EvolutionPanel key={key} span={span} summary={summary} />;
      case 'ann': return <AnnualPanel key={key} span={span} summary={summary} />;
      case 'dur': return <DurationPanel key={key} span={span} summary={summary} />;
      case 'eq': return <DevicesPanel key={key} span={span} rows={devicesRank} byType={summary?.byType || []} total={total} loading={initial} />;
      case 'per': return <PeoplePanel key={key} span={span} rows={people} total={total} sinPersona={summary?.sinPersona ?? 0} loading={initial} />;
      case 'loc': return <CategoryPanel key={key} id="an-loc" span={span} eyebrow="Ubicaciones · columnas" title="Dónde se usan los equipos" rows={extras.loc} total={total} noun="préstamos" loading={initial} />;
      case 'course': return <CategoryPanel key={key} id="an-course" span={span} eyebrow="Top cursos · columnas" title="Cursos que más pidieron" rows={extras.course} total={total} noun="préstamos" loading={initial} sortByLabel />;
      case 'reason': return <ReasonPanel key={key} span={span} rows={extras.reason} total={total} loading={initial} />;
      default: return null;
    }
  };

  return (
    <section className="an-sec" aria-labelledby="an-pre-h">
      <header className="an-sec-head">
        <span className="an-eyebrow">02 · Préstamos · según el período</span>
        <h3 className="an-sec-title" id="an-pre-h" tabIndex={-1}>{headline}</h3>
      </header>
      <KpiStrip label="Préstamos" items={kpis} loading={initial} />
      {/* Filas pensadas para que las tarjetas queden parejas en alto (sin
          huecos): la duración al lado de Motivos + Ubicaciones apilados, los
          dos rankings juntos. Lo que no tiene datos sale de la fila y el resto
          se reparte el ancho. */}
      <FlowRows
        has={has}
        render={render}
        rows={[
          [['evo', 8], ['ann', 4]],
          [['dur', 12]],
          [['eq', 6, 'wide'], ['per', 6, 'wide']],
          [['reason', 5], ['loc', 7]],
          [['course', 12]]
        ]}
      />
      {!initial && missing.length > 0 && (
        <EmptyCard
          id="an-pre-empty"
          title={onlyExtrasMissing ? 'Ubicación, motivo o curso no se están cargando' : 'Sin datos para estos gráficos en el período'}
          reason={onlyExtrasMissing
            ? 'Ningún préstamo del período tiene ese dato. Se pueden pedir al prestar desde Configuración › Opciones de préstamo.'
            : 'Aparecen en cuanto haya préstamos con ese dato. Probá con un período más largo.'}
          items={missing}
          action={onlyExtrasMissing && onOpenSettings ? <button type="button" className="an-link" onClick={onOpenSettings}>Ir a Configuración</button> : undefined}
        />
      )}
    </section>
  );
}

/* ── Evolución con el período anterior en gris punteado ──────────────────── */

function EvolutionPanel({ span, summary }: { span: number; summary?: AnalyticsSummary }) {
  const { active, setActive, groupProps } = useActive();
  const [view, setView] = useState<View>('chart');
  const evolution = summary?.evolution;
  const points = useMemo(() => evolutionPoints(evolution), [evolution]);
  const showPrev = Boolean(evolution?.prevAvailable);
  const gran = evolution ? GRAN_LABEL[evolution.granularity] : 'día';
  const current = sum(points.map(point => point.value));
  const previous = sum(points.map(point => point.prev || 0));
  const maxIndex = points.reduce((best, point, index) => (point.value > (points[best]?.value ?? -1) ? index : best), 0);
  const title = !summary ? 'Préstamos en el tiempo' : showPrev ? `Préstamos por ${gran}: ${versusPrevious(current, previous)}` : `Préstamos por ${gran}, desde el primer registro`;
  const readout = active !== null && points[active]
    ? `${points[active].long} · ${formatInt(points[active].value)} préstamos${showPrev ? ` · período anterior: ${formatInt(points[active].prev || 0)}` : ''}`
    : points[maxIndex]?.value ? `Máximo: ${points[maxIndex].long}, con ${formatInt(points[maxIndex].value)} préstamos.${showPrev && !previous ? ' El período anterior no tiene registros.' : ''}` : 'Sin préstamos en el período.';
  const tools = showPrev ? (
    <span className="an-keys" aria-hidden="true">
      <span className="an-key"><svg width="16" height="8"><path d="M0 4h16" className="an-key-cur" /></svg>Este período</span>
      <span className="an-key"><svg width="16" height="8"><path d="M0 4h16" className="an-key-prev" /></svg>Período anterior</span>
    </span>
  ) : undefined;
  return (
    <Panel id="an-evo" span={span} eyebrow={`Evolución · por ${gran}`} title={title} tools={tools} view={view} onView={setView} readout={summary ? readout : undefined}>
      {view === 'table' && summary ? (
        <SimpleTable caption={`Préstamos por ${gran}${showPrev ? ', este período y el anterior' : ''}`} head={showPrev ? [gran[0].toUpperCase() + gran.slice(1), 'Este período', 'Período anterior'] : [gran[0].toUpperCase() + gran.slice(1), 'Préstamos']}
          rows={points.map(point => showPrev ? [point.long, formatInt(point.value), formatInt(point.prev || 0)] : [point.long, formatInt(point.value)])} />
      ) : (
        <Lazy height={lineHeight(200)} kind="line">
          {() => <div {...groupProps}><LineChart points={points} height={200} active={active} onActive={setActive} showPrev={showPrev} ariaLabel={`Gráfico de línea: préstamos por ${gran}${showPrev ? ', con el período anterior en gris punteado' : ''}. Cada punto es un botón con su valor.`} /></div>}
        </Lazy>
      )}
    </Panel>
  );
}

function AnnualPanel({ span, summary }: { span: number; summary?: AnalyticsSummary }) {
  const { active, setActive, groupProps } = useActive();
  const [view, setView] = useState<View>('chart');
  const current = summary?.annualTrend || [];
  const previous = summary?.annualTrendPrev || [];
  const points = current.map((row, index) => {
    const [year, month] = row.label.split('-').map(Number);
    const short = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][month - 1];
    return { key: row.label, tick: `${short}${index === 0 || month === 1 ? ` ${String(year).slice(2)}` : ''}`, long: monthLong(row.label), value: row.value, prev: previous[index]?.value ?? 0 };
  });
  const totalNow = sum(points.map(point => point.value));
  const totalPrev = sum(points.map(point => point.prev || 0));
  const best = points.reduce((top, point, index) => (point.value > (points[top]?.value ?? -1) ? index : top), 0);
  const readout = active !== null && points[active]
    ? `${points[active].long} · ${formatInt(points[active].value)} préstamos · un año antes: ${formatInt(points[active].prev || 0)}`
    : totalNow ? `${formatInt(totalNow)} préstamos en 12 meses (${versusPrevious(totalNow, totalPrev)}); el mes con más fue ${points[best].long}.` : 'Sin préstamos en los últimos 12 meses.';
  return (
    <Panel id="an-ann" span={span} eyebrow="Tendencia anual · fija" title="Últimos 12 meses contra los 12 anteriores" view={view} onView={setView} readout={summary ? readout : undefined} note="No cambia con el período: siempre los últimos 12 meses.">
      {view === 'table' && summary ? (
        <SimpleTable caption="Préstamos por mes, últimos 12 meses y los 12 anteriores" head={['Mes', 'Préstamos', 'Un año antes']} rows={points.map(point => [point.long, formatInt(point.value), formatInt(point.prev || 0)])} />
      ) : (
        <Lazy height={lineHeight(128)} kind="line">
          {() => <div {...groupProps}><LineChart points={points} height={128} active={active} onActive={setActive} showPrev ariaLabel="Gráfico de línea: préstamos por mes en los últimos 12 meses, con los 12 anteriores en gris punteado." /></div>}
        </Lazy>
      )}
    </Panel>
  );
}

/* ── Duración: diagrama de puntos con mediana y rango intercuartil ──────── */

const BUCKET_LABELS = ['Menos de 1 h', '1 a 3 h', '3 a 6 h', '6 a 12 h', '12 a 24 h', 'Más de 24 h'];
const BUCKET_SHORT = ['< 1 h', '1–3 h', '3–6 h', '6–12 h', '12–24 h', '> 24 h'];
const AXIS_TICKS = [0, 1, 3, 6, 12, 24, 48];

function DurationPanel({ span, summary }: { span: number; summary?: AnalyticsSummary }) {
  const { active, setActive, groupProps } = useActive();
  const [view, setView] = useState<View>('chart');
  const data = summary?.durations;
  const [per, setPer] = useState(1);
  const [durRef, durWidth] = useWidth<HTMLDivElement>(600);
  const count = data?.count ?? 0;
  const over = data?.over12 ?? 0;
  const title = !data ? 'Cuánto tiempo están afuera los equipos'
    : `La mitad vuelve en menos de ${hoursLabel(data.median)}${over ? `; 1 de cada ${Math.max(1, Math.round(count / over))} pasa más de 12 h afuera` : ''}`;
  const readout = active !== null && data
    ? `${BUCKET_LABELS[active]} afuera · ${formatInt(data.buckets[active])} préstamos (${pct(data.buckets[active], count)} de los devueltos)${active >= 4 ? ' · conviene contarlos como no disponibles al día siguiente' : ''}`
    : data ? `Mediana ${hoursLabel(data.median)} · la mitad central va de ${hoursLabel(data.q1)} a ${hoursLabel(data.q3)} · ${formatInt(over)} de ${formatInt(count)} (${pct(over, count)}) pasaron más de 12 h afuera.` : '';
  return (
    <Panel id="an-dur" span={span} eyebrow="Duración de los préstamos · todo el historial" title={title} view={view} onView={setView} readout={summary ? readout : undefined}
      note={data ? `${formatInt(count)} préstamos con devolución registrada${data.stillOut ? ` (${formatInt(data.stillOut)} siguen afuera)` : ''}. Eje en raíz cuadrada para que se lean las horas cortas sin aplastar las largas.${data.sampled ? ' El diagrama dibuja una muestra pareja de 5.000; las cuentas usan todos.' : ''}` : undefined}>
      {view === 'table' && data ? (
        <SimpleTable caption="Préstamos devueltos según cuánto estuvieron afuera" head={['Tiempo afuera', 'Préstamos', '%']} rows={BUCKET_LABELS.map((label, index) => [label, formatInt(data.buckets[index]), pct(data.buckets[index], count)])} />
      ) : (
        <div className="an-dur" ref={durRef} {...groupProps}>
          {data && <p className="an-dots-cap" aria-hidden="true"><span className="an-dots-key" />mediana {hoursLabel(data.median)} · mitad central {hoursLabel(data.q1)}–{hoursLabel(data.q3)}{per > 1 ? ` · cada punto = ${per} préstamos` : ''}</p>}
          <Lazy height={data ? dotLayout(data, durWidth).H : 164} kind="dots">{() => data ? <DotPlot data={data} width={durWidth} active={active} onPer={setPer} /> : null}</Lazy>
          <div className="an-buckets" onKeyDown={event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button')]; const i = items.indexOf(document.activeElement as HTMLElement); const next = items[Math.max(0, Math.min(items.length - 1, i + (event.key === 'ArrowRight' ? 1 : -1)))]; next?.focus(); event.preventDefault(); } }}>
            {BUCKET_LABELS.map((label, index) => (
              <button
                type="button"
                key={label}
                className={cx('an-bucket', active === index && 'is-on')}
                tabIndex={(active ?? 0) === index ? 0 : -1}
                aria-pressed={active === index}
                aria-label={`${label}: ${data?.buckets[index] ?? 0} préstamos, ${pct(data?.buckets[index] ?? 0, count)}. Resalta sus puntos`}
                onMouseEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                onClick={() => setActive(index)}
              >
                <span className="an-bucket-l">{BUCKET_SHORT[index]}</span>
                <span className="an-bucket-n">{formatInt(data?.buckets[index] ?? 0)}</span>
                <span className="an-bucket-p">{pct(data?.buckets[index] ?? 0, count)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

/**
 * Geometría del diagrama de puntos para un ancho dado. El alto sale de la pila
 * más alta que se dibuja (hasta 12 puntos): con pocas devoluciones por franja
 * el diagrama es bajo, sin una banda vacía reservada para pilas que no hay.
 * La usa también el panel para reservar el alto exacto antes de dibujarlo.
 */
function dotLayout(data: NonNullable<AnalyticsSummary['durations']>, width: number) {
  const W = Math.max(280, width || 600);
  const pad = 16;
  const d = 8;
  const X = (hours: number) => pad + Math.sqrt(Math.min(hours, 48) / 48) * (W - 2 * pad);
  const bins = new Map<number, number[]>();
  for (const hours of data.hours) {
    const bin = Math.floor((X(hours) - pad) / d);
    const list = bins.get(bin) || [];
    list.push(hours);
    bins.set(bin, list);
  }
  const maxStack = Math.max(1, ...[...bins.values()].map(list => list.length));
  const cap = 12;
  const per = Math.max(1, Math.ceil(maxStack / cap));
  const stacks = Math.ceil(maxStack / per);
  // Mitad central y mediana arriba (hasta y≈23), la pila debajo y el eje con sus rótulos al pie.
  const axisY = 28 + 6 + stacks * d + 4;
  return { W, H: axisY + 28, pad, d, X, bins, per, axisY };
}

function DotPlot({ data, width, active, onPer }: { data: NonNullable<AnalyticsSummary['durations']>; width: number; active: number | null; onPer: (per: number) => void }) {
  const { W, H, pad, d, X, bins, per, axisY } = dotLayout(data, width);
  useEffect(() => { onPer(per); }, [per, onPer]);
  const bucketOf = (hours: number) => data.edges.reduce((found, edge, index) => (hours >= edge ? index : found), 0);
  const on: string[] = [];
  const off: string[] = [];
  for (const [bin, list] of bins) {
    const cx = pad + bin * d + d / 2;
    const stack = Math.ceil(list.length / per);
    const bucket = bucketOf(list[Math.floor(list.length / 2)]);
    for (let s = 0; s < stack; s += 1) {
      const cy = axisY - 6 - s * d - d / 2;
      const dot = `M${(cx - 3.5).toFixed(1)} ${cy.toFixed(1)}a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0`;
      (active === null || active === bucket ? on : off).push(dot);
    }
  }
  const q1 = X(data.q1);
  const q3 = X(data.q3);
  const med = X(data.median);
  const label = `mediana ${hoursLabel(data.median)} · mitad central ${hoursLabel(data.q1)}–${hoursLabel(data.q3)}`;
  return (
    <div className="an-dots">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Diagrama de puntos: ${data.count} préstamos devueltos según cuántas horas estuvieron afuera, en escala de raíz cuadrada de 0 a 48 horas. ${label}.${per > 1 ? ` Cada punto representa ${per} préstamos.` : ''}`}>
        <path d={`M${q1.toFixed(1)} 16H${q3.toFixed(1)}`} className="an-dots-iqr" />
        <path d={`M${med.toFixed(1)} 9V23`} className="an-dots-med" />
        <path d={off.join('')} className="an-dots-off" />
        <path d={on.join('')} className="an-dots-on" />
        <path d={`M${pad} ${axisY}H${W - pad}`} className="an-dots-axis" />
        <path d={AXIS_TICKS.map(tick => `M${X(tick).toFixed(1)} ${axisY}v4`).join('')} className="an-dots-axis" />
        {AXIS_TICKS.map(tick => <text key={tick} x={X(tick)} y={axisY + 18} textAnchor={tick === 48 ? 'end' : tick === 0 ? 'start' : 'middle'} className="an-dots-tick">{tick ? `${tick} h` : '0'}</text>)}
      </svg>
    </div>
  );
}

/* ── Rankings: tablas densas con orden y Top N ───────────────────────────── */

function useTop(initial = 10) {
  const [top, setTop] = useState(initial);
  const ref = useRef<HTMLDivElement>(null);
  const control = (label: string) => (
    <div ref={ref} className="an-top">
      <Segmented size="sm" ariaLabel={label} value={String(top)} onChange={value => keepInPlace(ref.current, () => setTop(Number(value)))} options={TOP_OPTIONS} />
    </div>
  );
  return { top, control };
}

/** Orden controlado por columna: primer click descendente (lo más grande arriba), después ascendente. */
function useSort(initial: TableSort) {
  const [sort, setSort] = useState<TableSort>(initial);
  const ref = useRef<HTMLDivElement>(null);
  const onSort = (col: number) => keepInPlace(ref.current, () => setSort(current => (current.col === col ? { col, dir: current.dir === 'desc' ? 'asc' : 'desc' } : { col, dir: col <= 1 ? 'asc' : 'desc' })));
  return { sort, onSort, ref };
}

function sortBy<T>(rows: T[], sort: TableSort, values: Array<((row: T) => string | number | null) | null>) {
  const get = values[sort.col];
  if (!get) return rows;
  const factor = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = get(a);
    const vb = get(b);
    if (va === vb) return 0;
    if (va === null || va === '') return 1;
    if (vb === null || vb === '') return -1;
    return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'es', { numeric: true })) * factor;
  });
}

function DevicesPanel({ span, rows, byType, total, loading }: { span: number; rows: DeviceRankRow[]; byType: AnalyticsRow[]; total: number; loading: boolean }) {
  const { top, control } = useTop();
  const { sort, onSort, ref } = useSort({ col: 3, dir: 'desc' });
  const [widthRef, narrow] = useNarrow<HTMLDivElement>(460, typeof window !== 'undefined' && window.innerWidth < 600);
  const values: Array<((row: DeviceRankRow) => string | number | null) | null> = [null, row => row.alias || row.etiqueta, row => row.tipo, row => row.value, row => row.avgHours];
  const sorted = sortBy(rows, sort, values);
  const leader = rows[0];
  const title = loading ? 'Equipos más prestados' : rows.length ? `${leader.alias || leader.etiqueta} encabeza los préstamos (${formatInt(leader.value)})` : 'Préstamos por tipo de equipo';
  const exportCsv = () => downloadCsv(`equipos-mas-prestados-${todayKeyAr()}.csv`, [['Puesto', 'Etiqueta', 'Alias', 'Tipo', 'Préstamos', 'Horas promedio afuera'], ...sorted.map((row, index) => [index + 1, row.etiqueta, row.alias, row.tipo, row.value, row.avgHours ?? ''])]);
  if (!loading && !rows.length) {
    // Respaldo: si los préstamos no tienen etiqueta, se cuenta por tipo.
    return (
      <Panel id="an-eqs" span={span} eyebrow="Equipos · por tipo" title={title} note="Los préstamos del período no traen etiqueta: se cuentan por tipo de equipo.">
        <SimpleTable caption="Préstamos por tipo de equipo" head={['Tipo', 'Préstamos', '%']} rows={byType.map(row => [row.label, formatInt(row.value), pct(row.value, total)])} />
      </Panel>
    );
  }
  return (
    <Panel id="an-eqs" span={span} eyebrow="Equipos · ranking" title={title}
      tools={<>{control('Cuántos equipos mostrar')}<CsvButton onExport={exportCsv} disabled={!rows.length} /></>}
      note={loading ? undefined : `Mostrando ${Math.min(top, rows.length)} de ${rows.length} equipos. Se agrupan por etiqueta aunque el alias haya cambiado. Prom. afuera: préstamos del período ya devueltos; en ámbar, más de 24 h.`}>
      <div className="an-rank-wrap" ref={node => { ref.current = node; widthRef(node); }}>
        {loading ? <Lazy height={360} kind="rows">{() => null}</Lazy> : (
          <SimpleTable
            caption="Equipos más prestados"
            // Angosto: el tipo pasa debajo del nombre (sin columna aparte) para no apretar ni partir palabras.
            head={narrow ? ['#', 'Equipo', 'Préstamos', 'Afuera'] : ['#', 'Equipo', 'Tipo', 'Préstamos', 'Prom. afuera']}
            cols={narrow ? '1.25rem minmax(0, 1fr) 5.25rem 4.5rem' : '1.5rem minmax(0, 2fr) minmax(0, 1fr) 5.25rem 6rem'}
            align={narrow ? ['end', 'start', 'end', 'end'] : ['end', 'start', 'start', 'end', 'end']}
            rowHeader={1}
            sortable={narrow ? [false, true, true, true] : [false, true, true, true, true]}
            sort={narrow ? { col: sort.col === 3 ? 2 : sort.col === 4 ? 3 : sort.col, dir: sort.dir } : sort}
            onSort={col => onSort(narrow && col >= 2 ? col + 1 : col)}
            rows={sorted.slice(0, top).map((row, index) => {
              const name = (
                <span key="e" className="an-device">
                  <span className="an-device-name">{row.alias || row.etiqueta}</span>
                  {row.alias && <span className="an-tag">{row.etiqueta}</span>}
                  {narrow && row.tipo && <span className="an-tag">{row.tipo}</span>}
                </span>
              );
              const hours = row.avgHours === null ? <span key="h" className="an-dim">—</span> : <span key="h" className={cx(row.avgHours > 24 && 'an-warn')}>{formatDec(row.avgHours)} h</span>;
              return narrow
                ? [<span key="r" className="an-rank">{index + 1}</span>, name, formatInt(row.value), hours]
                : [<span key="r" className="an-rank">{index + 1}</span>, name, <span key="t" className="an-dim">{row.tipo || '—'}</span>, formatInt(row.value), hours];
            })}
          />
        )}
      </div>
    </Panel>
  );
}

function PeoplePanel({ span, rows, total, sinPersona, loading }: { span: number; rows: Array<AnalyticsRow & { variants: number }>; total: number; sinPersona: number; loading: boolean }) {
  const { top, control } = useTop();
  const { sort, onSort, ref } = useSort({ col: 2, dir: 'desc' });
  const values: Array<((row: AnalyticsRow) => string | number | null) | null> = [null, row => row.label, row => row.value, row => row.value];
  const sorted = sortBy(rows, sort, values);
  const merged = rows.filter(row => row.variants > 1).length;
  const exportCsv = () => downloadCsv(`personas-que-mas-pidieron-${todayKeyAr()}.csv`, [['Puesto', 'Persona', 'Préstamos', '% del período'], ...sorted.map((row, index) => [index + 1, row.label, row.value, pct(row.value, total)])]);
  return (
    <Panel id="an-per" span={span} eyebrow="Personas · ranking" title={loading || !rows.length ? 'Personas que más pidieron' : `${rows[0].label} pidió ${formatInt(rows[0].value)} ${rows[0].value === 1 ? 'vez' : 'veces'}`}
      tools={<>{control('Cuántas personas mostrar')}<CsvButton onExport={exportCsv} disabled={!rows.length} /></>}
      note={loading ? undefined : `Mostrando ${Math.min(top, rows.length)} de ${rows.length} personas.${sinPersona ? ` ${formatInt(sinPersona)} préstamos sin persona cargada no entran.` : ''} Los nombres se agrupan sin distinguir mayúsculas ni acentos${merged ? ` (${merged} con más de una grafía)` : ''}; los errores de tipeo cuentan aparte.`}>
      <div className="an-rank-wrap" ref={ref}>
        {loading ? <Lazy height={360} kind="rows">{() => null}</Lazy> : (
          <SimpleTable
            caption="Personas que más pidieron equipos"
            head={['#', 'Persona', 'Pidió', '%']}
            cols="1.5rem minmax(0, 1fr) 4rem 3.5rem"
            align={['end', 'start', 'end', 'end']}
            rowHeader={1}
            sortable={[false, true, true, true]}
            sort={sort}
            onSort={onSort}
            rows={sorted.slice(0, top).map((row, index) => [<span key="r" className="an-rank">{index + 1}</span>, row.label, formatInt(row.value), <span key="p" className="an-dim">{pct(row.value, total)}</span>])}
          />
        )}
      </div>
    </Panel>
  );
}


/* ── Categorías: columnas (hasta 8: las 7 primeras y "Otros") + tabla completa ── */

export function CategoryPanel({ id, span, eyebrow, title, rows, total, noun, loading, sortByLabel, order, readoutLabel }: {
  id: string;
  span: number;
  eyebrow: string;
  title: string;
  rows: AnalyticsRow[];
  total: number;
  noun: string;
  loading: boolean;
  sortByLabel?: boolean;
  /** Orden fijo de categorías (prioridad: Urgente, Alta, Media, Baja). */
  order?: string[];
  readoutLabel?: string;
}) {
  const { active, setActive, groupProps } = useActive();
  const [view, setView] = useState<View>('chart');
  const [ref, small] = useNarrow<HTMLDivElement>(360, typeof window !== 'undefined' && window.innerWidth < 420);
  const ordered = order
    ? [...rows].sort((a, b) => (order.indexOf(a.label) === -1 ? 99 : order.indexOf(a.label)) - (order.indexOf(b.label) === -1 ? 99 : order.indexOf(b.label)))
    : sortByLabel ? [...rows].sort((a, b) => a.label.localeCompare(b.label, 'es', { numeric: true })) : rows;
  const limit = small ? 5 : 7;
  const { shown, rest } = order || sortByLabel ? { shown: ordered.filter(row => row.value > 0), rest: null } : topWithRest(ordered, limit);
  const sumAll = sum(rows.map(row => row.value)) || total;
  const cols: Column[] = shown.map(row => ({ key: row.label, label: row.label, value: row.value, display: formatInt(row.value), aria: `${row.label}: ${row.value} ${noun}, ${pct(row.value, sumAll)}` }));
  if (rest) cols.push({ key: '__rest', label: `Otros (${rest.count})`, value: rest.value, display: formatInt(rest.value), aria: `Otras ${rest.count} categorías: ${rest.value} ${noun}`, tone: 'rest' });
  const top = rows[0];
  const readout = active !== null && cols[active]
    ? `${cols[active].key === '__rest' ? `Otras ${rest?.count} categorías (ver Tabla)` : cols[active].label} · ${formatInt(cols[active].value)} ${noun} · ${pct(cols[active].value, sumAll)}`
    : top ? `${readoutLabel || 'Primero'}: ${top.label}, con ${formatInt(top.value)} ${noun} (${pct(top.value, sumAll)}).` : '';
  return (
    <Panel id={id} span={span} eyebrow={eyebrow} title={title} view={view} onView={setView} readout={loading ? undefined : readout}
      note={rest && view === 'chart' ? `Las ${rest.count} categorías más chicas van juntas en "Otros"; la Tabla las muestra todas.` : undefined}>
      {view === 'table' ? (
        <SimpleTable caption={title} head={['Categoría', noun[0].toUpperCase() + noun.slice(1), '%']} rows={ordered.filter(row => row.value > 0).map(row => [row.label, formatInt(row.value), pct(row.value, sumAll)])} />
      ) : (
        <div ref={ref}>
          <Lazy height={columnsHeight(132) + 16} kind="columns">
            {() => <div className="an-cats" {...groupProps}><Columns cols={cols} height={132} active={active} onActive={setActive} ariaLabel={`Columnas: ${title}`} valueMode="all" /></div>}
          </Lazy>
        </div>
      )}
    </Panel>
  );
}

/* ── Motivos: anillo de partes ── */


function ReasonPanel({ span, rows, total, loading }: { span: number; rows: AnalyticsRow[]; total: number; loading: boolean }) {
  const { active, setActive, groupProps } = useActive();
  const [view, setView] = useState<View>('chart');
  const { shown, rest } = topWithRest(rows, 4);
  const parts: Part[] = shown.map((row, index) => ({ key: row.label, label: row.label, value: row.value, tone: ['accent', 'series2', 'series3', 'series4'][index] as Tone }));
  if (rest) parts.push({ key: '__rest', label: `Otros (${rest.count})`, value: rest.value, tone: 'rest' });
  const sumAll = sum(rows.map(row => row.value)) || total;
  const readout = active !== null && parts[active] ? `${parts[active].label} · ${formatInt(parts[active].value)} préstamos · ${pct(parts[active].value, sumAll)}` : rows[0] ? `El motivo más común es ${rows[0].label} (${pct(rows[0].value, sumAll)}).` : '';
  return (
    <Panel id="an-reason" span={span} eyebrow="Motivos de préstamo · partes de un todo" title="Para qué se piden los equipos" view={view} onView={setView} readout={loading ? undefined : readout}>
      {view === 'table' ? (
        <SimpleTable caption="Motivos de préstamo" head={['Motivo', 'Préstamos', '%']} rows={rows.map(row => [row.label, formatInt(row.value), pct(row.value, sumAll)])} />
      ) : (
        <div {...groupProps}><PartsRing parts={parts} total={sumAll} active={active} onActive={setActive} ariaLabel={`Anillo de motivos: ${parts.map(part => `${part.label} ${part.value}`).join(', ')}.`} centerLabel="préstamos" /></div>
      )}
    </Panel>
  );
}
