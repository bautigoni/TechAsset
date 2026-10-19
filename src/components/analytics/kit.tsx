import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Segmented, Skeleton, Button, cx, keepInPlace as holdInPlace } from '../../ui';
import { appScroller } from '../../utils/scroll';
import { IconChevronDown, IconChevronUp } from '../../ui/icons';

/* ══════════════════════════════════════════════════════════════════════════
   Piezas de la Analítica Grafito (etapa 8a). Gráficos en SVG/HTML propios,
   sin librerías: cada valor exacto se lee en la línea de debajo ("readout")
   al pasar el mouse, tocar o enfocar; nada flota.
   ══════════════════════════════════════════════════════════════════════════ */

export type Tone = 'accent' | 'rest' | 'warn' | 'bad' | 'ok' | 'info' | 'series2' | 'series3' | 'series4' | 'muted';

export const reducedMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/* ── Ancho del contenedor (un ResizeObserver por gráfico, sin lecturas en loop) ── */

/**
 * Mide el contenedor con un ResizeObserver (sin getBoundingClientRect, que
 * fuerza un layout) y guarda `map(ancho)`: solo vuelve a dibujar si el valor
 * mapeado cambia. Se aplica antes de pintar (el observer corre entre layout y
 * pintado), así no hay un frame con la forma equivocada.
 */
export function useMeasure<T extends HTMLElement, V>(map: (width: number) => V, guess: V): [(node: T | null) => void, V] {
  const [value, setValue] = useState<V>(guess);
  const current = useRef<V>(guess);
  const mapRef = useRef(map);
  mapRef.current = map;
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node || typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width || 0;
      if (width <= 0) return;
      const next = mapRef.current(width);
      if (next !== current.current) { current.current = next; flushSync(() => setValue(next)); }
    });
    observer.current.observe(node);
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return [ref, value];
}

export function useWidth<T extends HTMLElement>(guess = 0) {
  return useMeasure<T, number>(width => Math.round(width), guess);
}

/** ¿El contenedor mide menos que `limit`? */
export function useNarrow<T extends HTMLElement>(limit: number, guess = false) {
  return useMeasure<T, boolean>(width => width < limit, guess);
}

/* ── Valor activo de un gráfico (hover / foco / toque) ── */

export function useActive<T = number>() {
  const [active, setActive] = useState<T | null>(null);
  const clear = useCallback(() => setActive(null), []);
  /** Props del grupo: al salir el mouse o el foco, vuelve el resumen. */
  const groupProps = {
    onMouseLeave: clear,
    onBlur: (event: FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) clear();
    }
  };
  return { active, setActive, clear, groupProps };
}

/** Flechas ← → (y Inicio/Fin) entre los botones de un gráfico: una sola parada de Tab. */
export function rovingKeys(event: KeyboardEvent<HTMLElement>, selector = '[data-an-item]') {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(selector)];
  const index = items.indexOf(document.activeElement as HTMLElement);
  if (index < 0) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0
    : event.key === 'End' ? items.length - 1
    : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? Math.max(0, index - 1)
    : Math.min(items.length - 1, index + 1);
  items[next]?.focus();
}

/* ── Mantener en su lugar lo que se tocó ──────────────────────────────────
   Cambiar Gráfico/Tabla, Top N u ordenar cambia de golpe el alto de lo que
   está DEBAJO del control (no es un colapso). Se usa el `keepInPlace` de
   `src/ui` (el mismo del colapso): se mide el control, se aplica el cambio en
   el mismo frame (flushSync) y se corrige el scroll; si la página se acorta
   cerca del final, el alto que falta se reserva al pie y se libera al subir. */

export function keepInPlace(anchor: HTMLElement | null, mutate: () => void) {
  const hold = holdInPlace(anchor, { duration: 0, reserve: 'auto' });
  flushSync(mutate);
  hold.stop();
}

/* ── Carga diferida: el gráfico se dibuja recién cuando se acerca a la vista ──
   El alto queda reservado desde el primer frame (skeleton con la misma forma
   y el mismo alto), así la página no salta cuando aparece. */

export type SkeletonKind = 'columns' | 'line' | 'dots' | 'rows' | 'ring' | 'heat' | 'groups';

export function Lazy({ height, kind, children, eager }: { height: number; kind: SkeletonKind; children: () => ReactNode; eager?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(Boolean(eager) || typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (visible || !ref.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { root: appScroller(), rootMargin: '480px 0px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [visible]);
  return (
    <div ref={ref} className="an-lazy" data-reserve={height} style={{ minHeight: height }}>
      {visible ? children() : <ChartSkeleton kind={kind} height={height} />}
    </div>
  );
}

const SKEL_BARS = [42, 68, 30, 84, 56, 72, 38, 60, 26];

export function ChartSkeleton({ kind, height }: { kind: SkeletonKind; height: number }) {
  const style: CSSProperties = { height };
  if (kind === 'columns' || kind === 'groups') {
    return (
      <div className="an-skel an-skel--cols" style={style} aria-hidden="true">
        {SKEL_BARS.map((h, index) => <Skeleton key={index} width="100%" height={`${h}%`} radius="sm" index={index % 4} />)}
      </div>
    );
  }
  if (kind === 'ring') {
    return <div className="an-skel an-skel--ring" style={style} aria-hidden="true"><span className="an-skel-ring" /><span className="an-skel-lines"><Skeleton width="80%" height="0.75rem" /><Skeleton width="64%" height="0.75rem" index={1} /><Skeleton width="72%" height="0.75rem" index={2} /></span></div>;
  }
  if (kind === 'rows') {
    return (
      <div className="an-skel an-skel--rows" style={style} aria-hidden="true">
        {Array.from({ length: Math.max(2, Math.floor(height / 36)) }, (_, index) => <Skeleton key={index} width={`${88 - (index * 9) % 30}%`} height="0.75rem" index={index % 4} />)}
      </div>
    );
  }
  if (kind === 'heat') {
    return (
      <div className="an-skel an-skel--heat" style={style} aria-hidden="true">
        {Array.from({ length: 35 }, (_, index) => <Skeleton key={index} width="100%" height="100%" radius="sm" index={index % 5} />)}
      </div>
    );
  }
  // line / dots: una franja con la forma general y el eje.
  return (
    <div className={cx('an-skel', `an-skel--${kind}`)} style={style} aria-hidden="true">
      <Skeleton width="100%" height="62%" radius="sm" />
      <Skeleton width="100%" height="0.75rem" index={2} />
    </div>
  );
}

/* ── Vacío por gráfico: dice qué forma tendrá ── */

export function Ghost({ height, shape, children }: { height?: number; shape?: 'ring' | 'plain'; children: ReactNode }) {
  return (
    <div className={cx('an-ghost', shape === 'ring' && 'an-ghost--ring')} style={height ? { minHeight: height } : undefined} role="status">
      {shape === 'ring' && <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="22" fill="none" strokeWidth="6" className="an-ghost-ring" /></svg>}
      <span>{children}</span>
    </div>
  );
}

/* ── Tarjeta de gráfico: encabezado, Gráfico/Tabla, línea de lectura y nota ── */

export type View = 'chart' | 'table';

export function Panel({
  id, eyebrow, title, span = 12, tools, view, onView, children, readout, note, className
}: {
  id: string;
  eyebrow: ReactNode;
  title: ReactNode;
  /** Columnas de 12 que ocupa en desktop (debajo de ~1000 px de ancho, todas ocupan la fila). */
  span?: number;
  tools?: ReactNode;
  view?: View;
  onView?: (view: View) => void;
  children: ReactNode;
  readout?: ReactNode;
  note?: ReactNode;
  className?: string;
}) {
  const headRef = useRef<HTMLDivElement>(null);
  return (
    <section className={cx('an-card', className)} style={{ ['--an-span' as string]: span }} aria-labelledby={`${id}-t`}>
      <div className="an-card-head" ref={headRef}>
        <div className="an-card-titles">
          <span className="an-eyebrow">{eyebrow}</span>
          <h4 className="an-card-title" id={`${id}-t`}>{title}</h4>
        </div>
        {(tools || (view && onView)) && (
          <div className="an-card-tools">
            {tools}
            {view && onView && (
              <Segmented<View>
                size="sm"
                ariaLabel="Cómo ver los datos"
                value={view}
                onChange={next => keepInPlace(headRef.current, () => onView(next))}
                options={[{ value: 'chart', label: 'Gráfico' }, { value: 'table', label: 'Tabla' }]}
              />
            )}
          </div>
        )}
      </div>
      {children}
      {readout !== undefined && <p className="an-readout" aria-live="polite">{readout}</p>}
      {note && <p className="an-note">{note}</p>}
    </section>
  );
}

/* ── Gráficos sin datos de una sección: UNA tarjeta compacta que los nombra
   (en vez de varias tarjetas altas con un "Sin datos" suelto). ── */

export function EmptyCard({ id, title, reason, items, action, span = 12 }: {
  id: string;
  title: ReactNode;
  reason: ReactNode;
  items: Array<{ name: string; shape: string }>;
  action?: ReactNode;
  span?: number;
}) {
  return (
    <section className="an-card an-empty" style={{ ['--an-span' as string]: span }} aria-labelledby={`${id}-t`}>
      <div className="an-empty-head">
        <svg className="an-empty-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="M8 17v-3M13 17V9M18 17v-6" /></svg>
        <div className="an-empty-text">
          <h4 className="an-card-title" id={`${id}-t`}>{title}</h4>
          <p className="an-empty-reason">{reason}</p>
        </div>
      </div>
      {items.length > 0 && (
        <ul className="an-empty-list">
          {items.map(item => <li key={item.name}><span className="an-empty-name">{item.name}</span><span className="an-empty-shape">{item.shape}</span></li>)}
        </ul>
      )}
      {action && <div className="an-empty-action">{action}</div>}
    </section>
  );
}

/* ── Filas de tarjetas que se reacomodan (sin huecos) ──
   Cada ítem es una clave o una pila de claves (tarjetas una debajo de la
   otra en la misma columna). Lo que no tiene datos sale y los demás se
   reparten las 12 columnas. */

/** [clave(s), columnas de 12, "wide" = en anchos medios va a fila entera (tablas: lado a lado quedan apretadas y desparejas en alto)]. */
export type FlowItem = [string | string[], number, ('wide')?];

export function FlowRows({ rows, has, render }: { rows: FlowItem[][]; has: (key: string) => boolean; render: (key: string, span: number) => ReactNode }) {
  return (
    <>
      {rows.map((row, index) => {
        const items = row
          .map(([key, span, wide]) => [Array.isArray(key) ? key.filter(has) : has(key) ? [key] : [], span, wide] as [string[], number, 'wide' | undefined])
          .filter(([keys]) => keys.length > 0);
        if (!items.length) return null;
        const total = items.reduce((acc, [, span]) => acc + span, 0);
        let used = 0;
        const shares = items.map(([, span], i) => {
          const share = items.length === 1 ? 12 : i === items.length - 1 ? 12 - used : Math.max(3, Math.round((span / total) * 12));
          used += share;
          return share;
        });
        // En anchos medios la fila se mantiene si todas sus tarjetas son de
        // media fila o menos (2 o 3 por fila); si alguna es ancha, todas bajan
        // a fila entera (nada de una tarjeta sola al lado de un hueco).
        const midKeeps = shares.every(share => share <= 6) && !items.some(([, , wide]) => wide);
        return (
          <div className="an-grid" key={index}>
            {items.map(([keys], i) => {
              const style = { ['--an-span' as string]: shares[i], ['--an-span-mid' as string]: midKeeps ? shares[i] : 12 };
              if (keys.length === 1) return <div className="an-cell" key={keys[0]} style={style}>{render(keys[0], shares[i])}</div>;
              return <div className="an-stack" key={keys.join('+')} style={style}>{keys.map(key => <Fragment key={key}>{render(key, 12)}</Fragment>)}</div>;
            })}
          </div>
        );
      })}
    </>
  );
}

/* ── KPIs: dicen si siguen el período o son foto actual ── */

export type Kpi = { label: string; value: ReactNode; hint: ReactNode; tone?: 'warn' | 'bad' | 'muted'; extra?: ReactNode };

export function KpiStrip({ items, loading, label }: { items: Kpi[]; loading?: boolean; label: string }) {
  return (
    <div className="an-kpis" role="list" aria-label={label} aria-busy={loading || undefined}>
      {items.map(item => (
        <div className="an-kpi" role="listitem" key={item.label}>
          <span className="an-kpi-label">{item.label}</span>
          <span className="an-kpi-row">
            {item.extra}
            <span className={cx('an-kpi-value', item.tone && `is-${item.tone}`)}>{loading ? <Skeleton width="3.5rem" height="1.5rem" /> : item.value}</span>
          </span>
          <span className="an-kpi-hint">{item.hint}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Columnas ─────────────────────────────────────────────────────────────── */

export type Column = { key: string; label: string; value: number; display: string; aria: string; tone?: Tone };

export function Columns({
  cols, height, max, active, onActive, ariaLabel, valueMode = 'auto', labelEvery, dim, sparseLabels
}: {
  cols: Column[];
  height: number;
  /** Escala común (small multiples); si no, el máximo propio. */
  max?: number;
  active: number | null;
  onActive: (index: number | null) => void;
  ariaLabel: string;
  /** auto: todos si son ≤ 12, si no solo el máximo y el activo. */
  valueMode?: 'auto' | 'all' | 'max';
  labelEvery?: number;
  dim?: boolean;
  /** Rótulos de eje numérico (horas): solo los visibles, sin cajas vacías. */
  sparseLabels?: boolean;
}) {
  const top = Math.max(1, max ?? Math.max(0, ...cols.map(col => col.value)));
  const maxIndex = cols.reduce((best, col, index) => (col.value > (cols[best]?.value ?? -1) ? index : best), 0);
  // Tramo de cantidad de columnas: el CSS esconde los números si cada columna queda de menos de ~28 px (container query, sin medir en JS ni volver a renderizar).
  const bucket = cols.length <= 6 ? 6 : cols.length <= 9 ? 9 : cols.length <= 12 ? 12 : cols.length <= 16 ? 16 : 99;
  const showAll = (valueMode === 'all' || (valueMode === 'auto' && cols.length <= 12));
  const every = labelEvery || (cols.length > 16 ? Math.ceil(cols.length / 8) : 1);
  return (
    <div className="an-cols" data-nb={bucket} role="group" aria-label={ariaLabel} style={{ ['--an-plot-h' as string]: `${height}px` }} onKeyDown={event => rovingKeys(event)}>
      <div className="an-cols-plot">
        {cols.map((col, index) => {
          const on = active === index;
          const showValue = col.value > 0 && (showAll || index === maxIndex || on);
          return (
            <button
              type="button"
              key={col.key}
              className={cx('an-col', on && 'is-on', dim && active !== null && !on && 'is-dim')}
              data-an-item=""
              tabIndex={(active ?? 0) === index ? 0 : -1}
              aria-label={col.aria}
              aria-pressed={on}
              onMouseEnter={() => onActive(index)}
              onFocus={() => onActive(index)}
              onClick={() => onActive(index)}
            >
              <span className={cx('an-col-v', !showValue && 'is-hidden')}>{col.display}</span>
              <span className={cx('an-col-bar', `is-${col.tone || 'accent'}`)} style={{ ['--an-r' as string]: col.value > 0 ? Math.max(0.015, col.value / top) : 0 }} />
            </button>
          );
        })}
      </div>
      {sparseLabels ? (
        // Eje numérico (horas): solo los rótulos que se muestran, centrados en su columna y sin cortarse.
        <div className="an-cols-x an-cols-x--sparse" aria-hidden="true">
          {cols.map((col, index) => (index % every === 0 && col.label
            ? <span key={col.key} className="an-cols-xs" style={{ left: `${((index + 0.5) / cols.length) * 100}%` }}>{col.label}</span>
            : null))}
        </div>
      ) : (
        <div className="an-cols-x" aria-hidden="true">
          {cols.map((col, index) => <span key={col.key} className="an-cols-xl">{index % every === 0 ? col.label : ''}</span>)}
        </div>
      )}
    </div>
  );
}

/** Alto total que ocupa <Columns height={h}>: plot + separación + rótulos. */
export const columnsHeight = (plot: number) => plot + 22;

/* ── Columnas agrupadas (dos series por grupo) ── */

export type Group = { key: string; label: string; aria: string; values: Array<{ value: number; display: string }> };

export function GroupedColumns({ groups, series, height, active, onActive, ariaLabel }: {
  groups: Group[];
  series: Array<{ name: string; tone: Tone }>;
  height: number;
  active: number | null;
  onActive: (index: number | null) => void;
  ariaLabel: string;
}) {
  const top = Math.max(1e-9, ...groups.flatMap(group => group.values.map(item => item.value)));
  return (
    <div className="an-groups" role="group" aria-label={ariaLabel} style={{ ['--an-plot-h' as string]: `${height}px`, ['--an-n' as string]: groups.length }} onKeyDown={event => rovingKeys(event)}>
      <div className="an-groups-plot">
        {groups.map((group, index) => {
          const on = active === index;
          return (
            <button
              type="button"
              key={group.key}
              className={cx('an-group', on && 'is-on')}
              data-an-item=""
              tabIndex={(active ?? 0) === index ? 0 : -1}
              aria-label={group.aria}
              aria-pressed={on}
              onMouseEnter={() => onActive(index)}
              onFocus={() => onActive(index)}
              onClick={() => onActive(index)}
            >
              {group.values.map((item, serie) => (
                <span className="an-group-col" key={serie}>
                  <span className="an-col-v">{item.display}</span>
                  <span className={cx('an-col-bar', `is-${series[serie]?.tone || 'accent'}`)} style={{ ['--an-r' as string]: item.value > 0 ? Math.max(0.015, item.value / top) : 0 }} />
                </span>
              ))}
            </button>
          );
        })}
      </div>
      <div className="an-groups-x" aria-hidden="true">
        {groups.map(group => <span key={group.key} className="an-cols-xl">{group.label}</span>)}
      </div>
    </div>
  );
}

/* ── Línea / área con el período anterior en gris punteado ──────────────── */

export type LinePoint = { key: string; tick: string; long: string; value: number; prev: number | null };

function niceStep(max: number) {
  if (max <= 5) return 1;
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / pow;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10) * pow;
}

export function LineChart({ points, height, active, onActive, ariaLabel, showPrev }: {
  points: LinePoint[];
  height: number;
  active: number | null;
  onActive: (index: number | null) => void;
  ariaLabel: string;
  showPrev: boolean;
}) {
  const [ref, slots] = useMeasure<HTMLDivElement, number>(width => Math.max(3, Math.floor(width / 64)), 9);
  const n = points.length;
  const max = Math.max(0, ...points.map(point => Math.max(point.value, showPrev ? point.prev || 0 : 0)));
  const step = niceStep(max || 1);
  const yMax = Math.max(step, Math.ceil((max * 1.08) / step) * step);
  const H = height;
  const X = (i: number) => ((i + 0.5) * 1000) / Math.max(1, n);
  const Y = (v: number) => H - 1 - (v / yMax) * (H - 10);
  const path = (get: (point: LinePoint) => number) => points.map((point, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(get(point)).toFixed(1)}`).join('');
  const line = path(point => point.value);
  const area = n ? `${line}L${X(n - 1).toFixed(1)} ${H - 1}L${X(0).toFixed(1)} ${H - 1}Z` : '';
  const prev = showPrev ? path(point => point.prev || 0) : '';
  const ticks: number[] = [];
  for (let t = 0; t <= yMax + 1e-9; t += step) ticks.push(Math.round(t * 100) / 100);
  const maxIndex = points.reduce((best, point, index) => (point.value > (points[best]?.value ?? -1) ? index : best), 0);
  const marker = active ?? (max > 0 ? maxIndex : null);
  const labelEvery = Math.max(1, Math.ceil(n / slots));
  const cols = { gridTemplateColumns: `repeat(${Math.max(1, n)}, minmax(0, 1fr))` };
  return (
    <div className="an-line" ref={ref}>
      <div className="an-line-y" aria-hidden="true" style={{ height: H }}>
        {ticks.map(t => <span key={t} className="an-line-yt" style={{ top: `${(Y(t) / H) * 100}%` }}>{formatInt(t)}</span>)}
      </div>
      <div className="an-line-plot" role="group" aria-label={ariaLabel} style={{ height: H }} onKeyDown={event => rovingKeys(event)}>
        <svg viewBox={`0 0 1000 ${H}`} preserveAspectRatio="none" width="100%" height={H} aria-hidden="true" focusable="false">
          <path className="an-line-grid" d={ticks.filter(t => t > 0).map(t => `M0 ${Y(t).toFixed(1)}H1000`).join('')} />
          <path className="an-line-area" d={area} />
          <path className="an-line-base" d={`M0 ${H - 1}H1000`} />
          {showPrev && <path className="an-line-prev" d={prev} />}
          <path className="an-line-cur" d={line} />
        </svg>
        {active !== null && <span className="an-line-cross" style={{ left: `${X(active) / 10}%` }} />}
        {marker !== null && points[marker] && <span className="an-line-dot" style={{ left: `${X(marker) / 10}%`, top: `${(Y(points[marker].value) / H) * 100}%` }} />}
        <div className="an-line-hits" style={cols}>
          {points.map((point, index) => (
            <button
              type="button"
              key={point.key}
              className="an-line-hit"
              data-an-item=""
              tabIndex={(active ?? 0) === index ? 0 : -1}
              aria-label={`${point.long}: ${point.value}${showPrev && point.prev !== null ? `; período anterior: ${point.prev}` : ''}`}
              onMouseEnter={() => onActive(index)}
              onFocus={() => onActive(index)}
              onClick={() => onActive(index)}
            />
          ))}
        </div>
      </div>
      <span aria-hidden="true" />
      <div className="an-line-x" aria-hidden="true" style={cols}>
        {points.map((point, index) => <span key={point.key} className="an-cols-xl">{index % labelEvery === 0 ? point.tick : ''}</span>)}
      </div>
    </div>
  );
}

export const lineHeight = (plot: number) => plot + 22;

/* ── Anillo de partes (partes de un todo) con leyenda que es la interacción ── */

export type Part = { key: string; label: string; value: number; tone: Tone };

export function PartsRing({ parts, total, active, onActive, ariaLabel, centerLabel, size = 160 }: {
  parts: Part[];
  total: number;
  active: number | null;
  onActive: (index: number | null) => void;
  ariaLabel: string;
  centerLabel: string;
  size?: number;
}) {
  const r = 64;
  const circumference = 2 * Math.PI * r;
  let acc = 0;
  const arcs = parts.map((part, index) => {
    const length = total > 0 ? (part.value / total) * circumference : 0;
    const arc = { part, index, dash: `${Math.max(0, length - (parts.filter(p => p.value > 0).length > 1 ? 2 : 0)).toFixed(2)} ${circumference.toFixed(2)}`, offset: (-acc).toFixed(2), length };
    acc += length;
    return arc;
  });
  const center = active !== null && parts[active] ? parts[active] : null;
  return (
    <div className="an-parts" onKeyDown={event => rovingKeys(event)}>
      <svg width={size} height={size} viewBox="0 0 160 160" role="img" aria-label={ariaLabel} className="an-parts-svg">
        <circle cx="80" cy="80" r={r} className="an-parts-track" fill="none" strokeWidth="12" />
        {arcs.filter(arc => arc.length > 0).map(arc => (
          <circle
            key={arc.part.key}
            cx="80" cy="80" r={r}
            fill="none"
            className={cx('an-parts-arc', `is-${arc.part.tone}`, active !== null && active !== arc.index && 'is-dim')}
            strokeWidth={active === arc.index ? 18 : 12}
            strokeDasharray={arc.dash}
            strokeDashoffset={arc.offset}
            transform="rotate(-90 80 80)"
          />
        ))}
        <text x="80" y="82" textAnchor="middle" className="an-parts-num">{formatInt(center ? center.value : total)}</text>
        <text x="80" y="102" textAnchor="middle" className="an-parts-cap">{center ? center.label.toLowerCase() : centerLabel}</text>
      </svg>
      <div className="an-legend">
        {parts.map((part, index) => (
          <button
            type="button"
            key={part.key}
            className={cx('an-legend-row', active === index && 'is-on')}
            data-an-item=""
            tabIndex={(active ?? 0) === index ? 0 : -1}
            aria-label={`${part.label}: ${part.value}, ${pct(part.value, total)}`}
            aria-pressed={active === index}
            onMouseEnter={() => onActive(index)}
            onFocus={() => onActive(index)}
            onClick={() => onActive(index)}
          >
            <span className={cx('an-swatch', `is-${part.tone}`)} aria-hidden="true" />
            <span className="an-legend-label">{part.label}</span>
            <span className="an-legend-n">{formatInt(part.value)}</span>
            <span className="an-legend-p">{pct(part.value, total)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Anillo fino neutro (valor sobre total) ── */

export function ThinRing({ value, total, size = 40 }: { value: number; total: number; size?: number }) {
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false" className="an-thin">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="an-thin-track" />
      {ratio > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" className="an-thin-arc" strokeDasharray={`${(c * ratio).toFixed(2)} ${c.toFixed(2)}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
    </svg>
  );
}

/* ── Tabla simple para la vista "Tabla" y exportar a CSV ── */

export type TableSort = { col: number; dir: 'asc' | 'desc' };

export function SimpleTable({ caption, head, rows, align, dense, cols, sortable, sort, onSort, rowHeader = 0 }: {
  caption: string;
  head: string[];
  rows: Array<Array<ReactNode>>;
  align?: Array<'start' | 'end'>;
  dense?: boolean;
  /** Pistas de grid propias (si no, la primera columna más ancha). */
  cols?: string;
  /** Columnas que se pueden ordenar (el que llama ordena las filas). */
  sortable?: boolean[];
  sort?: TableSort;
  onSort?: (col: number) => void;
  /** Columna que nombra la fila (rowheader). */
  rowHeader?: number;
}) {
  const template = cols || head.map((_, index) => (index === 0 ? (dense ? 'minmax(2rem, 1.2fr)' : 'minmax(0, 1.4fr)') : 'minmax(0, 1fr)')).join(' ');
  const alignOf = (index: number) => align?.[index] || (index ? 'end' : 'start');
  return (
    <div role="table" aria-label={caption} className={cx('an-table', dense && 'is-dense')} style={{ ['--an-cols' as string]: template }}>
      <div role="row" className="an-tr an-tr--head">
        {head.map((cell, index) => {
          const active = sort?.col === index ? sort.dir : null;
          return (
            <span role="columnheader" key={`${cell}-${index}`} aria-sort={sortable?.[index] ? (active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none') : undefined} className={cx('an-td', alignOf(index) === 'end' && 'is-num')}>
              {sortable?.[index] && onSort ? (
                <button type="button" className={cx('an-th-sort', active && 'is-on')} onClick={() => onSort(index)}>
                  <span className="an-th-text">{cell}</span><span aria-hidden="true" className="an-th-arrow">{active === 'asc' ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}</span>
                </button>
              ) : cell}
            </span>
          );
        })}
      </div>
      {rows.map((row, r) => (
        <div role="row" className="an-tr" key={r}>
          {row.map((cell, index) => <span role={index === rowHeader ? 'rowheader' : 'cell'} key={index} className={cx('an-td', alignOf(index) === 'end' && 'is-num')}>{cell}</span>)}
        </div>
      ))}
    </div>
  );
}

export function CsvButton({ onExport, disabled, label = 'CSV', describedBy }: { onExport: () => void; disabled?: boolean; label?: string; describedBy?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => setDone(false), 2400);
    return () => window.clearTimeout(timer);
  }, [done]);
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={disabled}
      aria-describedby={describedBy}
      onClick={() => { onExport(); setDone(true); }}
      icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 15V3M7 10l5 5 5-5M5 21h14" /></svg>}
    >
      <span className="an-csv-label">{done ? 'Descargado' : label}</span>
    </Button>
  );
}

/* ── Formatos ── */

const intFormat = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const formatInt = (value: number) => intFormat.format(value);
export const formatDec = (value: number) => oneDecimal.format(value);
export function pct(value: number, total: number) {
  if (!total) return '0%';
  return `${Math.round((value / total) * 100)}%`;
}
export function hoursLabel(value: number) {
  if (value < 1) return `${Math.round(value * 60)} min`;
  return `${oneDecimal.format(value)} h`;
}

/** Estilo de la escala de calor: 7 pasos de azul (mezcla del acento sobre la superficie). */
export function heatStep(value: number, max: number) {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(1, Math.min(7, Math.ceil((value / max) * 7)));
}

export { Skeleton };
