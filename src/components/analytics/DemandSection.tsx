import { useMemo, useState, type KeyboardEvent } from 'react';
import type { AnalyticsSummary } from '../../services/analyticsApi';
import { Segmented, cx } from '../../ui';
import {
  ChartSkeleton, Columns, FlowRows, Ghost, Lazy, keepInPlace, useNarrow, Panel, SimpleTable, columnsHeight, formatInt, heatStep, pct, useActive, type Column, type View
} from './kit';
import { DAY_NAMES, DAY_SHORT, WEEK_ORDER, foldText, hh, hourRange, sum } from './model';

type Props = { summary?: AnalyticsSummary; loading: boolean; unreviewed?: number };

type Cell = { day: number; hour: number; value: number };

/** Horas a mostrar: el horario escolar (8 a 16) ampliado a donde haya préstamos. */
function visibleHours(matrix: number[][]) {
  let first = 24;
  let last = -1;
  matrix.forEach(row => row.forEach((value, hour) => {
    if (!value) return;
    first = Math.min(first, hour);
    last = Math.max(last, hour);
  }));
  const start = Math.min(8, first);
  const end = Math.max(16, last);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export function DemandSection({ summary, loading, unreviewed }: Props) {
  const matrix = useMemo(() => summary?.hourWeekday || Array.from({ length: 7 }, () => Array(24).fill(0)), [summary]);
  const total = summary?.totalPrestamos ?? 0;
  const hours = useMemo(() => visibleHours(matrix), [matrix]);
  const hourTotals = hours.map(hour => sum(WEEK_ORDER.map(day => matrix[day][hour])));
  const dayTotals = WEEK_ORDER.map(day => sum(matrix[day]));
  const cells = useMemo(() => {
    const list: Cell[] = [];
    WEEK_ORDER.forEach(day => hours.forEach(hour => { if (matrix[day][hour]) list.push({ day, hour, value: matrix[day][hour] }); }));
    return list.sort((a, b) => b.value - a.value || a.hour - b.hour || WEEK_ORDER.indexOf(a.day) - WEEK_ORDER.indexOf(b.day));
  }, [matrix, hours]);
  const peak = cells[0];
  const peakHourIndex = hourTotals.reduce((best, value, index) => (value > hourTotals[best] ? index : best), 0);
  const weekdayTotals = [1, 2, 3, 4, 5].map(day => ({ day, value: sum(matrix[day]) }));
  const quiet = total ? [...weekdayTotals].sort((a, b) => a.value - b.value)[0] : null;

  const headline = loading && !summary ? 'Cargando la demanda del período…'
    : !total ? 'Sin préstamos en el período: no hay demanda para mostrar'
    : `La franja de las ${hh(hours[peakHourIndex])} se lleva el ${pct(hourTotals[peakHourIndex], total)} de los préstamos; el pico es el ${DAY_NAMES[peak.day].toLowerCase()} de ${peak.hour} a ${peak.hour + 1}`;

  const types = (summary?.byTypeHour || []).filter(type => type.total > 0).slice(0, 4);
  const showTypes = Boolean(types.length);
  const agendaRows = summary?.agendaOccupation || [];
  const showCompare = total > 0 || agendaRows.length > 0;
  const hasPanel = (key: string) => (loading && !summary) || (key === 'types' ? showTypes : showCompare);

  return (
    <section className="an-sec" aria-labelledby="an-dem-h">
      <header className="an-sec-head">
        <span className="an-eyebrow">01 · Demanda · según el período</span>
        <h3 className="an-sec-title" id="an-dem-h" tabIndex={-1}>{headline}</h3>
      </header>

      {loading && !summary ? (
        <section className="an-card an-heatcard" aria-label="Cargando el mapa de calor">
          <div className="an-heat-main"><ChartSkeleton kind="heat" height={340} /></div>
        </section>
      ) : !total ? (
        <Ghost>Sin préstamos en el período. Acá va el mapa de calor hora × día, con las franjas críticas y el total por hora. Probá con un período más largo.</Ghost>
      ) : (
        <Heatmap matrix={matrix} hours={hours} hourTotals={hourTotals} dayTotals={dayTotals} total={total} cells={cells} quiet={quiet} unreviewed={unreviewed} />
      )}

      {/* FlowRows (no una grilla fija): si los dos paneles quedan muy desparejos
          en alto, la fila se apila en vez de dejar una franja vacía en el corto. */}
      <FlowRows rows={[[['types', 7], ['cmp', 5]]]} has={hasPanel} render={(key, span) => (key === 'types'
        ? <TypesPanel span={span} summary={summary} loading={loading} hours={hours} types={types} total={total} />
        : <ComparePanel span={span} summary={summary} loading={loading} matrix={matrix} total={total} />)} />
    </section>
  );
}

/* ── Mapa de calor hora × día (protagonista) ─────────────────────────────── */

function Heatmap({ matrix, hours, hourTotals, dayTotals, total, cells, quiet, unreviewed }: {
  matrix: number[][];
  hours: number[];
  hourTotals: number[];
  dayTotals: number[];
  total: number;
  cells: Cell[];
  quiet: { day: number; value: number } | null;
  unreviewed?: number;
}) {
  const [view, setView] = useState<View>('chart');
  const [widthRef, transposed] = useNarrow<HTMLDivElement>(560, typeof window !== 'undefined' && window.innerWidth < 700);
  const [cell, setCell] = useState<string | null>(null);
  const [hourSel, setHourSel] = useState<number | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const max = cells[0]?.value || 1;
  const rank = (value: number) => 1 + cells.filter(item => item.value > value).length;
  const clear = () => { setCell(null); setHourSel(null); };

  let readout = `Pico: ${DAY_NAMES[cells[0].day].toLowerCase()} de ${hourRange(cells[0].hour)}, con el ${pct(cells[0].value, total)} de los préstamos. Pasá el mouse, tocá o enfocá una celda para ver su valor exacto.`;
  if (cell) {
    const [day, hour] = cell.split('-').map(Number);
    const value = matrix[day][hour];
    readout = `${DAY_NAMES[day]} de ${hourRange(hour)} · ${value ? `${pct(value, total)} de los préstamos (${formatInt(value)}) · puesto ${rank(value)} de ${cells.length} franjas con préstamos` : 'sin préstamos en el período'}`;
  } else if (hourSel !== null) {
    const index = hours.indexOf(hourSel);
    readout = `De ${hourRange(hourSel)}, todos los días · ${pct(hourTotals[index], total)} de los préstamos (${formatInt(hourTotals[index])})`;
  }

  const legendSteps = [1, 2, 3, 4, 5, 6, 7].map(step => Math.max(1, Math.round(((step / 7) * max * 100) / total)));
  const topHours = [...hourTotals].map((value, index) => ({ value, index })).sort((a, b) => b.value - a.value).slice(0, 2).map(item => item.index);
  const days = WEEK_ORDER;
  const cellText = (value: number) => (value ? (Math.round((value / total) * 100) < 1 ? '<1%' : pct(value, total)) : '');

  const select = (day: number, hour: number) => { setCell(`${day}-${hour}`); setHourSel(null); };

  // Grilla con una sola parada de Tab: las flechas recorren celdas en 2D.
  const rowsKeys = transposed ? hours : days;
  const colsKeys = transposed ? days : hours;
  const keyOf = (r: number, c: number) => (transposed ? `${colsKeys[c]}-${rowsKeys[r]}` : `${rowsKeys[r]}-${colsKeys[c]}`);
  const firstKey = cells.length ? `${cells[0].day}-${cells[0].hour}` : keyOf(0, 0);
  const tabKey = focusKey || cell || firstKey;
  const onGridKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const move = moves[event.key];
    if (!move) return;
    const current = (document.activeElement as HTMLElement | null)?.dataset.cell;
    if (!current) return;
    const [day, hour] = current.split('-').map(Number);
    let r = transposed ? rowsKeys.indexOf(hour) : rowsKeys.indexOf(day);
    let c = transposed ? colsKeys.indexOf(day) : colsKeys.indexOf(hour);
    r = Math.max(0, Math.min(rowsKeys.length - 1, r + move[0]));
    c = Math.max(0, Math.min(colsKeys.length - 1, c + move[1]));
    event.preventDefault();
    const next = keyOf(r, c);
    setFocusKey(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-cell="${next}"]`)?.focus();
  };

  const cellButton = (day: number, hour: number) => {
    const value = matrix[day][hour];
    const key = `${day}-${hour}`;
    const step = heatStep(value, max);
    return (
      <button
        type="button"
        key={key}
        data-cell={key}
        className={cx('an-hc', `is-s${step}`, cell === key && 'is-on', hourSel !== null && hourSel !== hour && 'is-dim')}
        tabIndex={tabKey === key ? 0 : -1}
        aria-label={`${DAY_NAMES[day]} de ${hourRange(hour)}: ${value ? `${pct(value, total)} de los préstamos` : 'sin préstamos'}`}
        aria-pressed={cell === key}
        onMouseEnter={() => select(day, hour)}
        onFocus={() => { setFocusKey(key); select(day, hour); }}
        onClick={() => select(day, hour)}
      >{cellText(value)}</button>
    );
  };

  return (
    <section className="an-card an-heatcard" aria-labelledby="an-heat-t">
      <div className="an-heat-main" ref={widthRef}>
        <div className="an-card-head">
          <div className="an-card-titles">
            <span className="an-eyebrow">Hora × día de la semana</span>
            <h4 className="an-card-title" id="an-heat-t">Préstamos por franja horaria</h4>
          </div>
          <div className="an-card-tools">
            <HeatViewSwitch view={view} onView={setView} />
          </div>
        </div>

        {view === 'chart' ? (
          <>
            <div
              className={cx('an-heat', transposed && 'is-transposed')}
              role="group"
              aria-label="Mapa de calor del porcentaje de préstamos por hora y día. Cada celda es un botón con su valor; las flechas recorren la grilla."
              style={{ ['--an-hcols' as string]: colsKeys.length }}
              onMouseLeave={clear}
              onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) clear(); }}
              onKeyDown={onGridKey}
            >
              <div className="an-heat-row an-heat-row--head" aria-hidden="true">
                <span />
                {colsKeys.map(key => <span key={key} className="an-heat-colh">{transposed ? DAY_SHORT[key] : hh(key)}</span>)}
                <span className="an-heat-tot">Total</span>
              </div>
              {rowsKeys.map((rowKey, r) => {
                const rowTotal = transposed ? hourTotals[r] : dayTotals[r];
                return (
                  <div key={rowKey} className={cx('an-heat-row', !rowTotal && 'is-empty')}>
                    <span className="an-heat-rowh">{transposed ? hh(rowKey) : DAY_NAMES[rowKey]}</span>
                    {colsKeys.map(colKey => (transposed ? cellButton(colKey, rowKey) : cellButton(rowKey, colKey)))}
                    <span className="an-heat-tot">{pct(rowTotal, total)}</span>
                  </div>
                );
              })}
              {transposed ? (
                <div className="an-heat-row an-heat-row--foot" aria-hidden="true">
                  <span className="an-heat-rowh">Total</span>
                  {days.map((day, index) => <span key={day} className="an-heat-colh">{pct(dayTotals[index], total)}</span>)}
                  <span />
                </div>
              ) : (
                <div className="an-heat-row an-heat-row--bars">
                  <span className="an-heat-rowh">Total por hora</span>
                  {hours.map((hour, index) => (
                    <button
                      type="button"
                      key={hour}
                      className={cx('an-col', 'an-heat-hour', hourSel === hour && 'is-on')}
                      tabIndex={-1}
                      aria-label={`De ${hourRange(hour)}, todos los días: ${pct(hourTotals[index], total)} de los préstamos`}
                      onMouseEnter={() => { setHourSel(hour); setCell(null); }}
                      onClick={() => { setHourSel(hour); setCell(null); }}
                    >
                      <span className="an-col-v">{pct(hourTotals[index], total)}</span>
                      <span className={cx('an-col-bar', topHours.includes(index) || hourSel === hour ? 'is-accent' : 'is-rest')} style={{ ['--an-r' as string]: hourTotals[index] ? Math.max(0.03, hourTotals[index] / Math.max(...hourTotals)) : 0 }} />
                    </button>
                  ))}
                  <span />
                </div>
              )}
            </div>
            {transposed && (
              <HourColumns hours={hours} hourTotals={hourTotals} total={total} topHours={topHours} hourSel={hourSel} onHour={hour => { setHourSel(hour); setCell(null); }} />
            )}
            <div className="an-heat-foot">
              <p className="an-readout" aria-live="polite">{readout}</p>
              <div className="an-heat-legend" aria-hidden="true">
                <span className="an-heat-legend-t">% del período</span>
                {legendSteps.map((value, index) => <span key={index} className="an-heat-legend-s"><i className={`an-hc-sw is-s${index + 1}`} />{value}</span>)}
              </div>
            </div>
          </>
        ) : (
          <>
            {transposed ? (
              <SimpleTable
                dense
                caption="Porcentaje de préstamos por hora y día"
                head={['Hora', ...days.map(day => DAY_SHORT[day]), 'Total']}
                rows={hours.map((hour, index) => [hh(hour), ...days.map(day => (matrix[day][hour] ? pct(matrix[day][hour], total) : '—')), pct(hourTotals[index], total)])}
              />
            ) : (
              <SimpleTable
                dense={hours.length > 9}
                caption="Porcentaje de préstamos por día y hora"
                head={['Día', ...hours.map(hh), 'Total']}
                rows={days.map((day, index) => [DAY_NAMES[day], ...hours.map(hour => (matrix[day][hour] ? pct(matrix[day][hour], total) : '—')), pct(dayTotals[index], total)])}
              />
            )}
            <p className="an-note">Porcentaje sobre el total de préstamos del período. “—” = ningún préstamo en esa franja.</p>
          </>
        )}
      </div>

      <aside className="an-heat-aside" aria-labelledby="an-slots-t">
        <div className="an-card-titles">
          <span className="an-eyebrow">Franjas críticas</span>
          <h4 className="an-card-title" id="an-slots-t">Dónde tener equipos cargados</h4>
        </div>
        <ol className="an-slots">
          {/* Hasta 10: al lado del mapa llenan su alto (sin un hueco entre la lista y la nota). */}
          {cells.slice(0, 10).map(item => {
            const key = `${item.day}-${item.hour}`;
            return (
              <li key={key}>
                <button
                  type="button"
                  className={cx('an-slot', cell === key && 'is-on')}
                  aria-label={`${DAY_NAMES[item.day]} de ${hh(item.hour)} a ${hh(item.hour + 1)}: ${pct(item.value, total)}. Marca la celda en el mapa`}
                  onMouseEnter={() => { setView('chart'); select(item.day, item.hour); }}
                  onFocus={() => select(item.day, item.hour)}
                  onClick={() => { setView('chart'); select(item.day, item.hour); }}
                >
                  <span className="an-slot-rank">{rank(item.value)}</span>
                  <span className="an-slot-day">{DAY_NAMES[item.day]}</span>
                  <span className="an-slot-time">{hh(item.hour)}–{hh(item.hour + 1)}</span>
                  <span className="an-slot-val">{pct(item.value, total)}</span>
                </button>
              </li>
            );
          })}
        </ol>
        {quiet && (
          <p className="an-note an-heat-quiet">
            El {DAY_NAMES[quiet.day].toLowerCase()} es el día hábil más tranquilo ({pct(quiet.value, total)} de los préstamos)
            {unreviewed ? `: buen momento para revisar los ${formatInt(unreviewed)} activos sin condición cargada.` : '.'}
          </p>
        )}
      </aside>
    </section>
  );
}

function HeatViewSwitch({ view, onView }: { view: View; onView: (view: View) => void }) {
  // Mismo control que el resto de los paneles (Segmented de src/ui).
  return (
    <div className="an-heat-switch">
      <PanelViewSwitch view={view} onView={onView} />
    </div>
  );
}

function PanelViewSwitch({ view, onView }: { view: View; onView: (view: View) => void }) {
  return (
    <Segmented<View>
      size="sm"
      ariaLabel="Cómo ver la demanda por franja"
      value={view}
      onChange={next => keepInPlace(document.getElementById('an-heat-t'), () => onView(next))}
      options={[{ value: 'chart', label: 'Gráfico' }, { value: 'table', label: 'Tabla' }]}
    />
  );
}

function HourColumns({ hours, hourTotals, total, topHours, hourSel, onHour }: { hours: number[]; hourTotals: number[]; total: number; topHours: number[]; hourSel: number | null; onHour: (hour: number) => void }) {
  const cols: Column[] = hours.map((hour, index) => ({
    key: String(hour),
    label: index % 2 === 0 ? hh(hour) : '',
    value: hourTotals[index],
    display: pct(hourTotals[index], total),
    aria: `De ${hourRange(hour)}, todos los días: ${pct(hourTotals[index], total)} de los préstamos`,
    tone: topHours.includes(index) || hourSel === hour ? 'accent' : 'rest'
  }));
  return (
    <div className="an-heat-hours">
      <span className="an-card-sub">Total por hora</span>
      <Columns cols={cols} height={72} active={hourSel === null ? null : hours.indexOf(hourSel)} onActive={index => { if (index !== null) onHour(hours[index]); }} ariaLabel="Columnas: porcentaje de préstamos por hora, todos los días" valueMode="max" labelEvery={1} sparseLabels />
    </div>
  );
}

/* ── Tipo de equipo por hora: small multiples con la misma escala ────────── */

function TypesPanel({ span, summary, loading, hours, types, total }: {
  span: number;
  summary?: AnalyticsSummary;
  loading: boolean;
  hours: number[];
  types: AnalyticsSummary['byTypeHour'];
  total: number;
}) {
  const { active, setActive, groupProps } = useActive<string>();
  const [view, setView] = useState<View>('chart');
  const fleet = sum((summary?.byTypeHour || []).map(type => type.fleet));
  const scale = Math.max(1, ...types.flatMap(type => hours.map(hour => type.hours[hour])));
  const busiest = [...types].sort((a, b) => (b.total / Math.max(1, b.fleet)) - (a.total / Math.max(1, a.fleet)))[0];
  const title = busiest ? `${busiest.type}: ${formatInt(busiest.fleet)} equipos cubren el ${pct(busiest.total, total)} de los préstamos` : 'Préstamos por tipo de equipo';
  const peaks = types.map(type => {
    const peakHour = hours.reduce((best, hour) => (type.hours[hour] > type.hours[best] ? hour : best), hours[0]);
    return `${type.type}: pico de ${hh(peakHour)} a ${hh(peakHour + 1)} (${pct(type.hours[peakHour], type.total)} de sus préstamos)`;
  });
  let readout = peaks.join(' · ');
  if (active) {
    const [typeIndex, hour] = active.split('|').map(Number);
    const type = types[typeIndex];
    if (type) readout = `${type.type} de ${hourRange(hour)} · ${pct(type.hours[hour], total)} de todos los préstamos · ${pct(type.hours[hour], type.total)} de los de ${type.type} (${formatInt(type.hours[hour])})`;
  }
  const noLoans = (summary?.byTypeHour || []).filter(type => type.total === 0 && type.fleet > 0);
  const notes = [
    'Porcentaje sobre todos los préstamos del período, misma escala en todos.',
    noLoans.length ? `${noLoans.map(type => `${type.type} (${type.fleet} equipos)`).join(', ')} no ${noLoans.length === 1 ? 'tuvo' : 'tuvieron'} préstamos.` : '',
    summary?.untypedFleet ? `Los ${formatInt(summary.untypedFleet)} equipos sin tipo cargado no aparecen${summary.untypedLoans ? ` (${formatInt(summary.untypedLoans)} préstamos)` : ''}.` : ''
  ].filter(Boolean).join(' ');
  const plot = 160;
  return (
    <Panel id="an-types" span={span} eyebrow="Demanda por tipo de equipo · por hora" title={loading && !summary ? 'Préstamos por tipo de equipo' : title} view={view} onView={setView} readout={summary ? readout : undefined} note={summary ? notes : undefined}>
      {view === 'table' && summary ? (
        <SimpleTable caption="Porcentaje de préstamos por hora y tipo de equipo" head={['Hora', ...types.map(type => type.type)]}
          rows={[...hours.map(hour => [`${hh(hour)}:00`, ...types.map(type => (type.hours[hour] ? pct(type.hours[hour], total) : '—'))]), ['Total', ...types.map(type => pct(type.total, total))]]} />
      ) : (
        <>
          {(
            <div className="an-multiples" role="group" aria-label="Gráficos de columnas con la misma escala: porcentaje de préstamos por hora para cada tipo de equipo." {...groupProps}>
              {types.map((type, typeIndex) => {
                const cols: Column[] = hours.map((hour, index) => ({
                  key: String(hour),
                  label: index % 2 === 0 ? hh(hour) : '',
                  value: type.hours[hour],
                  display: pct(type.hours[hour], total),
                  aria: `${type.type} de ${hourRange(hour)}: ${pct(type.hours[hour], total)} de todos los préstamos`
                }));
                const activeIndex = active && active.startsWith(`${typeIndex}|`) ? hours.indexOf(Number(active.split('|')[1])) : null;
                return (
                  <div className="an-multiple" key={type.type}>
                    <div className="an-multiple-head"><span className="an-multiple-name">{type.type}</span><span className="an-multiple-share">{pct(type.total, total)}</span></div>
                    <span className="an-multiple-sub">
                      <span className="an-nw">{formatInt(type.fleet)} equipos</span> · <span className="an-nw">{pct(type.fleet, fleet)} del parque</span> · <span className="an-nw">pico {hh(hours.reduce((best, hour) => (type.hours[hour] > type.hours[best] ? hour : best), hours[0]))} h</span>
                    </span>
                    {/* El encabezado puede ocupar 1 o 2 renglones según el ancho: solo
                        las columnas son diferidas, con su alto exacto reservado. */}
                    <div className="an-multiple-chart">
                      <Lazy height={columnsHeight(plot)} kind="columns">
                        {() => <Columns cols={cols} height={plot} max={scale} active={activeIndex} onActive={index => setActive(index === null ? null : `${typeIndex}|${hours[index]}`)} ariaLabel={`${type.type}: préstamos por hora`} valueMode="max" labelEvery={1} sparseLabels />}
                      </Lazy>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

/* ── Préstamos vs. agenda TIC, alineados por día ─────────────────────────── */

function ComparePanel({ span, summary, loading, matrix, total }: { span: number; summary?: AnalyticsSummary; loading: boolean; matrix: number[][]; total: number }) {
  const { active, setActive, groupProps } = useActive();
  const [view, setView] = useState<View>('chart');
  const agenda = new Map((summary?.agendaOccupation || []).map(row => [foldText(row.label), row.value]));
  const agendaOf = (day: number) => agenda.get(foldText(DAY_NAMES[day])) || 0;
  const days = WEEK_ORDER.filter(day => day >= 1 && day <= 5 || sum(matrix[day]) > 0 || agendaOf(day) > 0);
  const loans = days.map(day => sum(matrix[day]));
  const acts = days.map(agendaOf);
  const peakIndex = loans.reduce((best, value, index) => (value > loans[best] ? index : best), 0);
  const quietIndex = loans.reduce((best, value, index) => (value < loans[best] ? index : best), 0);
  const title = total
    ? `El ${DAY_NAMES[days[peakIndex]].toLowerCase()} tiene más préstamos (${pct(loans[peakIndex], total)}) y ${formatInt(acts[peakIndex])} ${acts[peakIndex] === 1 ? 'actividad' : 'actividades'} en la agenda`
    : 'Actividades de la agenda TIC por día';
  const readout = active !== null
    ? `${DAY_NAMES[days[active]]} · ${pct(loans[active], total)} de los préstamos del período (${formatInt(loans[active])}) · ${formatInt(acts[active])} ${acts[active] === 1 ? 'actividad' : 'actividades'} en la agenda TIC`
    : total ? `El ${DAY_NAMES[days[quietIndex]].toLowerCase()} es el día más tranquilo (${pct(loans[quietIndex], total)} de los préstamos).` : 'Sin préstamos en el período; la agenda es una foto actual.';
  const loanCols: Column[] = days.map((day, index) => ({ key: `l${day}`, label: DAY_SHORT[day], value: loans[index], display: pct(loans[index], total), aria: `${DAY_NAMES[day]}: ${pct(loans[index], total)} de los préstamos y ${acts[index]} actividades en la agenda TIC` }));
  const agendaCols: Column[] = days.map((day, index) => ({ key: `a${day}`, label: DAY_SHORT[day], value: acts[index], display: formatInt(acts[index]), aria: `${DAY_NAMES[day]}: ${acts[index]} actividades en la agenda TIC y ${pct(loans[index], total)} de los préstamos`, tone: 'series2' }));
  return (
    <Panel id="an-cmp" span={span} eyebrow="Préstamos vs. agenda TIC" title={loading && !summary ? 'Préstamos vs. agenda TIC' : title} view={view} onView={setView} readout={summary ? readout : undefined}
      note="La agenda es una foto actual (pendientes y entregadas, sin canceladas ni realizadas) y no cambia con el período.">
      {view === 'table' && summary ? (
        <SimpleTable caption="Préstamos y agenda TIC por día" head={['Día', 'Préstamos', '% período', 'Agenda TIC']} rows={days.map((day, index) => [DAY_NAMES[day], formatInt(loans[index]), pct(loans[index], total), formatInt(acts[index])])} />
      ) : (
        <Lazy height={total > 0 ? columnsHeight(88) + columnsHeight(64) + 56 : columnsHeight(64) + 24} kind="columns">
          {() => (
            <div className="an-paired" {...groupProps}>
              {total > 0 && <span className="an-card-sub"><b>Préstamos</b> · % del período</span>}
              {total > 0 && <Columns cols={loanCols} height={88} active={active} onActive={setActive} ariaLabel="Columnas: porcentaje de préstamos por día" valueMode="all" />}
              <span className="an-card-sub"><b>Agenda TIC</b> · actividades</span>
              <Columns cols={agendaCols} height={64} active={active} onActive={setActive} ariaLabel="Columnas: actividades de la agenda TIC por día" valueMode="all" />
            </div>
          )}
        </Lazy>
      )}
    </Panel>
  );
}
