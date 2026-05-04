import { useState, type CSSProperties } from 'react';

export type ChartType = 'bar' | 'vertical' | 'pie' | 'donut' | 'line' | 'threeD';

const PALETTE = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#f97316', '#84cc16'];

function color(index: number, custom?: string) {
  return custom || PALETTE[index % PALETTE.length];
}

function percent(value: number, total: number) {
  return total ? Math.round((value / total) * 100) : 0;
}

function polar(cx: number, cy: number, radius: number, angle: number) {
  const radians = (angle - 90) * Math.PI / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

function arcPath(cx: number, cy: number, radius: number, start: number, end: number) {
  const from = polar(cx, cy, radius, end);
  const to = polar(cx, cy, radius, start);
  const largeArc = end - start <= 180 ? 0 : 1;
  return `M ${cx} ${cy} L ${from.x} ${from.y} A ${radius} ${radius} 0 ${largeArc} 0 ${to.x} ${to.y} Z`;
}

function compactRows(rows: Array<{ label: string; value: number; color?: string }>) {
  return rows.filter(row => Number(row.value) > 0);
}

function HorizontalBars({ rows }: { rows: Array<{ label: string; value: number; color?: string }> }) {
  const max = Math.max(1, ...rows.map(row => row.value));
  return (
    <div className="chart-bars-horizontal">
      {rows.map((row, index) => (
        <div className="chart-row" key={row.label}>
          <span>{row.label}</span>
          <div className="chart-bar-track"><i style={{ width: `${(row.value / max) * 100}%`, background: color(index, row.color) }} /></div>
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
  );
}

function VerticalBars({ rows }: { rows: Array<{ label: string; value: number; color?: string }> }) {
  const max = Math.max(1, ...rows.map(row => row.value));
  return (
    <div className="chart-bars-vertical" style={{ '--chart-count': rows.length } as CSSProperties}>
      {rows.map((row, index) => (
        <div className="vbar" key={row.label}>
          <strong>{row.value}</strong>
          <span style={{ height: `${Math.max(8, (row.value / max) * 100)}%`, background: color(index, row.color) }} />
          <em title={row.label}>{row.label}</em>
        </div>
      ))}
    </div>
  );
}

function PieLike({ rows, donut = false }: { rows: Array<{ label: string; value: number; color?: string }>; donut?: boolean }) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  let cursor = 0;
  const segments = rows.map((row, index) => {
    const start = cursor;
    const size = total ? (row.value / total) * 360 : 0;
    cursor += size;
    return { row, index, start, end: Math.min(cursor, 359.99) };
  });
  return (
    <div className={`chart-pie-wrap ${donut ? 'donut' : ''}`}>
      <svg viewBox="0 0 120 120" className="chart-pie-svg" role="img" aria-label={donut ? 'Donut chart' : 'Pie chart'}>
        {segments.map(segment => (
          <path key={segment.row.label} d={arcPath(60, 60, 52, segment.start, segment.end)} fill={color(segment.index, segment.row.color)} />
        ))}
        {donut && <circle cx="60" cy="60" r="28" className="donut-hole" />}
      </svg>
      <div className="chart-legend">
        {rows.map((row, index) => <span key={row.label}><i style={{ background: color(index, row.color) }} />{row.label} · {percent(row.value, total)}%</span>)}
      </div>
    </div>
  );
}

function LineChart({ rows }: { rows: Array<{ label: string; value: number; color?: string }> }) {
  const max = Math.max(1, ...rows.map(row => row.value));
  const width = 320;
  const height = 150;
  const points = rows.map((row, index) => {
    const x = rows.length <= 1 ? width / 2 : 18 + (index * (width - 36)) / (rows.length - 1);
    const y = height - 18 - (row.value / max) * (height - 38);
    return { x, y, row };
  });
  const d = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
  return (
    <div className="chart-line-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-line-svg">
        <path d={d} />
        {points.map(point => <circle key={point.row.label} cx={point.x} cy={point.y} r="4" />)}
      </svg>
      <div className="chart-line-labels">{rows.map(row => <span key={row.label}>{row.label}</span>)}</div>
    </div>
  );
}

function ThreeDChart({ rows }: { rows: Array<{ label: string; value: number; color?: string }> }) {
  const max = Math.max(1, ...rows.map(row => row.value));
  return (
    <div className="chart-3d-stage">
      {rows.map((row, index) => (
        <div className="bar-3d" key={row.label} style={{ '--bar-height': `${Math.max(14, (row.value / max) * 100)}%`, '--bar-color': color(index, row.color), '--delay': `${index * 55}ms` } as CSSProperties}>
          <span />
          <strong>{row.value}</strong>
          <em title={row.label}>{row.label}</em>
        </div>
      ))}
    </div>
  );
}

const CHART_OPTIONS: Array<{ value: ChartType; label: string }> = [
  { value: 'bar', label: 'Horizontal' },
  { value: 'vertical', label: 'Vertical' },
  { value: 'pie', label: 'Pie chart' },
  { value: 'donut', label: 'Donut chart' },
  { value: 'threeD', label: '3D animado' },
  { value: 'line', label: 'Linea' }
];

export function ChartCard({ title, rows, type = 'bar' }: { title: string; rows: Array<{ label: string; value: number; color?: string }>; type?: ChartType }) {
  const [chartType, setChartType] = useState<ChartType>(type);
  const [topLimit, setTopLimit] = useState(10);
  const visibleRows = compactRows(rows).slice(0, topLimit);
  return (
    <section className="card chart-card">
      <div className="card-head chart-card-head">
        <h3>{title}</h3>
        <div className="chart-controls">
          <label className="chart-type-control">
            <span>Top</span>
            <select className="input" value={topLimit} onChange={event => setTopLimit(Number(event.target.value))}>
              <option value={10}>Top 10</option>
              <option value={15}>Top 15</option>
              <option value={25}>Top 25</option>
              <option value={50}>Top 50</option>
            </select>
          </label>
          <label className="chart-type-control">
            <span>Tipo</span>
            <select className="input" value={chartType} onChange={event => setChartType(event.target.value as ChartType)}>
              {CHART_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>
      </div>
      <div className={`chart-stage chart-${chartType}`}>
        {visibleRows.length === 0 && <div className="empty-state">Sin datos</div>}
        {visibleRows.length > 0 && chartType === 'bar' && <HorizontalBars rows={visibleRows} />}
        {visibleRows.length > 0 && chartType === 'vertical' && <VerticalBars rows={visibleRows} />}
        {visibleRows.length > 0 && chartType === 'pie' && <PieLike rows={visibleRows} />}
        {visibleRows.length > 0 && chartType === 'donut' && <PieLike rows={visibleRows} donut />}
        {visibleRows.length > 0 && chartType === 'line' && <LineChart rows={visibleRows} />}
        {visibleRows.length > 0 && chartType === 'threeD' && <ThreeDChart rows={visibleRows} />}
      </div>
    </section>
  );
}
