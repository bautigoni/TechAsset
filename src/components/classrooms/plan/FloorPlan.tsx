import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { ClassroomGeneralState } from '../../../types';
import { IconButton, Segmented, cx } from '../../../ui';
import { IconMinus, IconPlus } from '../../../ui/icons';
import { roomName, roomsOf, type FloorPlanDef, type PlanItem } from './floorPlans.js';

export type RoomStatus = { estado: ClassroomGeneralState; issues: string[] };

type Frame = 'all' | 'left' | 'right';
type Zoom = { s: number; ox: number; oy: number };

const MAX_SCALE = 4;
const COMPACT_BELOW = 560;

/* Íconos de estado: el estado nunca depende solo del color. */
export function IconObs({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" />
    </svg>
  );
}
export function IconProblem({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86L7.86 2zM15 9l-6 6M9 9l6 6" />
    </svg>
  );
}
function IconFrame() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
    </svg>
  );
}

export function statusClass(estado: ClassroomGeneralState | undefined) {
  if (estado === 'Problema') return 'is-bad';
  if (estado === 'Con observaciones') return 'is-obs';
  if (estado === 'OK') return 'is-ok';
  return 'is-unrev';
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function clampZoom(zoom: Zoom, fz: number): Zoom {
  const s = clamp(zoom.s, 1, MAX_SCALE);
  return { s, ox: clamp(zoom.ox, 0, Math.max(0, 1 - fz / s)), oy: clamp(zoom.oy, 0, Math.max(0, 1 - 1 / s)) };
}

function startZoom(frame: Frame): Zoom {
  return { s: 1, ox: frame === 'right' ? 0.5 : 0, oy: 0 };
}

/** ¿Entra el texto en una caja de w×h px? Mono: ~0,62 em por carácter. */
function fits(label: string, w: number, h: number, font: number) {
  const lines = label.split('\n');
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  return longest * font * 0.62 + 6 <= w && lines.length * (font + 3) + 2 <= h;
}

function doorPath(item: PlanItem) {
  const { door, x = 0, y = 0, w = 0, h = 0 } = item;
  if (!door) return '';
  const r = 15;
  const at = door.at ?? 0.5;
  if (door.side === 'bottom') { const px = x + w * at, py = y + h; return `M${px - r} ${py}A${r} ${r} 0 0 0 ${px} ${py - r}`; }
  if (door.side === 'top') { const px = x + w * at; return `M${px - r} ${y}A${r} ${r} 0 0 1 ${px} ${y + r}`; }
  if (door.side === 'left') { const py = y + h * at; return `M${x} ${py - r}A${r} ${r} 0 0 0 ${x + r} ${py}`; }
  const px = x + w, py = y + h * at; return `M${px} ${py - r}A${r} ${r} 0 0 1 ${px - r} ${py}`;
}

const rectPath = (x: number, y: number, w: number, h: number) => `M${x} ${y}h${w}v${h}h${-w}Z`;
const polyPath = (pts: string) => `M${pts.trim().split(/\s+/).join('L')}Z`;

/** Fondo del plano (silueta, pasillos, bloques, escalones, baños, puertas) en un solo SVG. */
function usePlanPaths(floor: FloorPlanDef) {
  return useMemo(() => {
    let body = '', corr = '', deco = '', dash = '', line = '', door = '';
    (floor.outline || []).forEach(pts => { body += polyPath(pts); });
    for (const item of floor.items || []) {
      const { x = 0, y = 0, w = 0, h = 0 } = item;
      if (item.k === 'corridor') corr += rectPath(x, y, w, h);
      else if (item.k === 'patio' || item.k === 'dashed') dash += rectPath(x + 1, y + 1, w - 2, h - 2);
      else if (item.k === 'block' || item.k === 'vertical') deco += rectPath(x + 2, y + 2, w - 4, h - 4);
      else if (item.k === 'poly' && item.pts) deco += polyPath(item.pts);
      else if (item.k === 'stairs') {
        deco += rectPath(x + 2, y + 2, w - 4, h - 4);
        const n = item.n || 6;
        for (let i = 1; i < n; i += 1) {
          if (item.dir === 'h') line += `M${x + (w / n) * i} ${y + 6}V${y + h - 6}`;
          else line += `M${x + 6} ${y + (h / n) * i}H${x + w - 6}`;
        }
      } else if (item.k === 'bath') {
        deco += rectPath(x + 2, y + 2, w - 4, h - 4);
        const fw = 14, fh = 10, gap = (w - 16 - 3 * fw) / 2;
        for (let i = 0; i < 3; i += 1) line += rectPath(x + 8 + i * (fw + gap), y + h - fh - 8, fw, fh);
      } else if (item.k === 'room' && item.door) door += doorPath(item);
    }
    return { body, corr, deco, dash, line, door };
  }, [floor]);
}

export type FloorPlanProps = {
  floor: FloorPlanDef;
  siteLabel: string;
  statuses: Record<string, RoomStatus>;
  selectedKey: string | null;
  /** Filtro del resumen: las aulas que no coinciden se ven atenuadas (siguen tocables). */
  matches: ((roomKey: string) => boolean) | null;
  onPick: (roomKey: string, nombre: string) => void;
};

/**
 * Plano de una planta. Cada aula es un `<button>` (Tab recorre en orden de
 * lectura, Enter abre). Zoom: botones −/+/Encuadrar (y Ctrl+rueda) en desktop;
 * pinza con dos dedos SOLO dentro del recuadro en mobile (`touch-action` y
 * eventos táctiles propios: la página alrededor no se agranda); con zoom, un
 * dedo (o arrastrar con el mouse) mueve el plano. En pantallas angostas,
 * Izquierda/Derecha muestran cada mitad al doble.
 */
export function FloorPlan({ floor, siteLabel, statuses, selectedKey, matches, onPick }: FloorPlanProps) {
  const W = floor.width || 1000;
  const H = floor.height || 1000;
  const viewRef = useRef<HTMLDivElement | null>(null);
  // Lo que se mide (ancho, alto, puntos de la pinza) es el recuadro interior: el
  // exterior deja un margen para que el contorno de foco o de hover de un aula
  // del borde no quede recortado por el overflow del plano.
  const portRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [viewW, setViewW] = useState(0);
  const [rootW, setRootW] = useState(0);
  const [remScale, setRemScale] = useState(1);
  const [frame, setFrame] = useState<Frame>('all');
  const [zoom, setZoom] = useState<Zoom>(startZoom('all'));
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  // Angosto = el lugar disponible para el plano (no el ancho del plano mismo).
  const compact = rootW > 0 && rootW < COMPACT_BELOW;
  const fz = frame === 'all' ? 1 : 0.5;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const fzRef = useRef(fz);
  fzRef.current = fz;
  const movedRef = useRef(false);

  const paths = usePlanPaths(floor);
  const rooms = useMemo(() => roomsOf(floor), [floor]);

  // Cambio de planta o de mitad: el encuadre vuelve al inicio.
  useEffect(() => { setFrame('all'); setZoom(startZoom('all')); }, [floor]);
  useEffect(() => { if (!compact && frame !== 'all') { setFrame('all'); setZoom(startZoom('all')); } }, [compact, frame]);

  useEffect(() => {
    const el = portRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const root = rootRef.current;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const width = Math.round(entry.contentRect.width || 0);
        if (entry.target === el) setViewW(current => (current === width ? current : width));
        else setRootW(current => (current === width ? current : width));
      }
      // Tamaño de texto de la app (Configuración › Tema): los rótulos escalan con rem.
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setRemScale(current => (Math.abs(current - rem / 16) < 0.01 ? current : rem / 16));
    });
    observer.observe(el);
    if (root) observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const pickFrame = (next: Frame) => {
    setFrame(next);
    setZoom(clampZoom(startZoom(next), next === 'all' ? 1 : 0.5));
  };

  /** Zoom con un punto fijo (px dentro del recuadro). */
  const zoomAt = useCallback((nextScale: number, px: number, py: number, base: Zoom = zoomRef.current) => {
    const el = portRef.current;
    if (!el) return;
    const vw = el.clientWidth || 1;
    const vh = el.clientHeight || 1;
    const f = fzRef.current;
    const cw0 = vw / f;
    const fx = (px + base.ox * cw0 * base.s) / (cw0 * base.s);
    const fy = (py + base.oy * vh * base.s) / (vh * base.s);
    const s = clamp(nextScale, 1, MAX_SCALE);
    setZoom(clampZoom({ s, ox: (fx * cw0 * s - px) / (cw0 * s), oy: (fy * vh * s - py) / (vh * s) }, f));
  }, []);

  const zoomBy = (factor: number) => {
    const el = portRef.current;
    if (!el) return;
    zoomAt(zoomRef.current.s * factor, el.clientWidth / 2, el.clientHeight / 2);
  };
  const resetZoom = () => setZoom(clampZoom(startZoom(frame), fz));

  const panBy = useCallback((dx: number, dy: number, base: Zoom) => {
    const el = portRef.current;
    if (!el) return;
    const f = fzRef.current;
    const cw = (el.clientWidth / f) * base.s;
    const ch = el.clientHeight * base.s;
    setZoom(clampZoom({ s: base.s, ox: base.ox - dx / cw, oy: base.oy - dy / ch }, f));
  }, []);

  // Gestos táctiles: listeners nativos con passive:false para poder frenar
  // el zoom de la página (Safari ignora user-scalable=no).
  useEffect(() => {
    const el = viewRef.current;
    const port = portRef.current;
    if (!el || !port) return;
    let mode: 'none' | 'pinch' | 'pan' = 'none';
    let start = { d: 1, mx: 0, my: 0, x: 0, y: 0, zoom: zoomRef.current };
    const local = (touch: Touch) => {
      const rect = port.getBoundingClientRect();
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    };
    const onStart = (event: TouchEvent) => {
      movedRef.current = false;
      if (event.touches.length >= 2) {
        const a = local(event.touches[0]);
        const b = local(event.touches[1]);
        mode = 'pinch';
        start = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, x: 0, y: 0, zoom: zoomRef.current };
        event.preventDefault();
      } else if (event.touches.length === 1 && zoomRef.current.s > 1.01) {
        const p = local(event.touches[0]);
        mode = 'pan';
        start = { d: 1, mx: 0, my: 0, x: p.x, y: p.y, zoom: zoomRef.current };
      } else mode = 'none';
    };
    const onMove = (event: TouchEvent) => {
      if (mode === 'pinch' && event.touches.length >= 2) {
        event.preventDefault();
        const a = local(event.touches[0]);
        const b = local(event.touches[1]);
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        movedRef.current = true;
        zoomAt(start.zoom.s * (d / start.d), start.mx, start.my, start.zoom);
      } else if (mode === 'pan' && event.touches.length === 1) {
        const p = local(event.touches[0]);
        if (Math.abs(p.x - start.x) + Math.abs(p.y - start.y) > 6) movedRef.current = true;
        if (!movedRef.current) return;
        event.preventDefault();
        panBy(p.x - start.x, p.y - start.y, start.zoom);
      } else if (event.touches.length >= 2) event.preventDefault();
    };
    const onEnd = (event: TouchEvent) => { if (!event.touches.length) mode = 'none'; };
    const stopGesture = (event: Event) => event.preventDefault();
    const onWheel = (event: WheelEvent) => {
      // Ctrl + rueda (o la pinza del touchpad) acerca el plano, no la página.
      if (!event.ctrlKey) return;
      event.preventDefault();
      const rect = port.getBoundingClientRect();
      zoomAt(zoomRef.current.s * (event.deltaY < 0 ? 1.15 : 1 / 1.15), event.clientX - rect.left, event.clientY - rect.top);
    };
    const options: AddEventListenerOptions = { passive: false };
    el.addEventListener('touchstart', onStart, options);
    el.addEventListener('touchmove', onMove, options);
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    el.addEventListener('gesturestart', stopGesture, options);
    el.addEventListener('gesturechange', stopGesture, options);
    el.addEventListener('wheel', onWheel, options);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      el.removeEventListener('gesturestart', stopGesture);
      el.removeEventListener('gesturechange', stopGesture);
      el.removeEventListener('wheel', onWheel);
    };
  }, [zoomAt, panBy]);

  // Arrastrar con el mouse cuando hay zoom.
  const drag = useRef<{ x: number; y: number; zoom: Zoom; id: number } | null>(null);
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') return;
    movedRef.current = false;
    if (event.button !== 0 || zoomRef.current.s <= 1.01) return;
    drag.current = { x: event.clientX, y: event.clientY, zoom: zoomRef.current, id: event.pointerId };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    if (!movedRef.current && Math.abs(dx) + Math.abs(dy) > 5) {
      movedRef.current = true;
      viewRef.current?.setPointerCapture?.(event.pointerId);
    }
    if (movedRef.current) panBy(dx, dy, d.zoom);
  };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === event.pointerId) drag.current = null;
  };

  /** Con zoom, el aula que recibe el foco por teclado se trae a la vista. */
  const ensureVisible = (item: PlanItem) => {
    const z = zoomRef.current;
    if (z.s <= 1.01 && fz === 1) return;
    const x0 = (item.x || 0) / W, x1 = ((item.x || 0) + (item.w || 0)) / W;
    const y0 = (item.y || 0) / H, y1 = ((item.y || 0) + (item.h || 0)) / H;
    const spanX = fz / z.s, spanY = 1 / z.s;
    let { ox, oy } = z;
    if (x0 < ox) ox = x0 - 0.02; else if (x1 > ox + spanX) ox = x1 - spanX + 0.02;
    if (y0 < oy) oy = y0 - 0.02; else if (y1 > oy + spanY) oy = y1 - spanY + 0.02;
    if (ox !== z.ox || oy !== z.oy) setZoom(clampZoom({ s: z.s, ox, oy }, fz));
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomBy(1.4); }
    else if (event.key === '-') { event.preventDefault(); zoomBy(1 / 1.4); }
    else if (event.key === '0') { event.preventDefault(); resetZoom(); }
  };

  // Medidas en px para decidir qué textos entran.
  const font = (compact ? 11 : 12) * remScale;
  const unit = viewW ? (viewW / fz) * zoom.s / W : 0;
  const pct = (value: number, total: number) => `${(value / total) * 100}%`;
  const box = (x: number, y: number, w: number, h: number): CSSProperties => ({ left: pct(x, W), top: pct(y, H), width: pct(w, W), height: pct(h, H) });

  let hiddenLabels = 0;
  const roomButtons = rooms.map(({ roomKey, nombre, item }) => {
    const status = statuses[roomKey];
    const estado = status?.estado || 'Sin revisar';
    // En una sola línea (un botón nunca se parte): si no entra, el nombre se lee en la línea de abajo.
    const showLabel = unit > 0 && fits(nombre, (item.w - 4) * unit, (item.h - 4) * unit, font);
    const visibleX = (item.x + item.w) / W > zoom.ox && item.x / W < zoom.ox + fz / zoom.s;
    if (!showLabel && visibleX) hiddenLabels += 1;
    const small = unit > 0 && (item.w - 4) * unit < 28;
    const issues = status?.issues || [];
    return (
      <button
        key={roomKey}
        type="button"
        className={cx('cls-room', statusClass(estado), roomKey === selectedKey && 'is-sel', matches && !matches(roomKey) && 'is-dim', !showLabel && 'is-bare', small && 'is-small')}
        style={box(item.x + 2, item.y + 2, item.w - 4, item.h - 4)}
        data-room-key={roomKey}
        aria-label={`${nombre}, ${estado}${issues.length ? `: ${issues.join(', ')}` : ''}`}
        aria-pressed={roomKey === selectedKey}
        onClick={() => { if (movedRef.current) { movedRef.current = false; return; } onPick(roomKey, nombre); }}
        onFocus={() => { setHoverKey(roomKey); ensureVisible(item); }}
        onBlur={() => setHoverKey(current => (current === roomKey ? null : current))}
        onMouseEnter={() => setHoverKey(roomKey)}
        onMouseLeave={() => setHoverKey(current => (current === roomKey ? null : current))}
      >
        {showLabel && <span className="cls-room-label">{nombre}</span>}
        {estado === 'Problema' && <span className="cls-room-icon"><IconProblem /></span>}
        {estado === 'Con observaciones' && <span className="cls-room-icon"><IconObs /></span>}
      </button>
    );
  });

  const labels = (floor.items || []).filter(item => item.k !== 'room' && item.label).map((item, index) => {
    if (item.k === 'poly') {
      return <span key={`l${index}`} className="cls-plan-label is-free" style={{ left: pct(item.lx || 0, W), top: pct(item.ly || 0, H) }}>{item.label}</span>;
    }
    const { x = 0, y = 0, w = 0, h = 0 } = item;
    const vertical = item.k === 'vertical';
    const ok = unit > 0 && (vertical ? fits(item.label, (h - 4) * unit, (w - 4) * unit, 10 * remScale) : fits(item.label, (w - 4) * unit, (h - 4) * unit, 10 * remScale));
    if (!ok) return null;
    return <span key={`l${index}`} className={cx('cls-plan-label', vertical && 'is-vertical', item.k === 'bath' && 'is-top')} style={box(x, y, w, h)}>{item.label}</span>;
  });

  const hovered = hoverKey ? rooms.find(room => room.roomKey === hoverKey) : null;
  const hoveredStatus = hovered ? statuses[hovered.roomKey] : null;
  const readout = hovered
    ? `${hovered.nombre} · ${hoveredStatus?.estado || 'Sin revisar'}${hoveredStatus?.issues.length ? ` · ${hoveredStatus.issues.join(', ')}` : ''}`
    : hiddenLabels > 0
      ? `${hiddenLabels === 1 ? '1 aula no muestra' : `${hiddenLabels} aulas no muestran`} el nombre a este tamaño: ${compact ? 'tocala igual, acercá con dos dedos o con Izquierda / Derecha' : 'pasá el mouse, acercá con + o usá la lista'}.`
      : compact
        ? 'Tocá un aula para abrir su ficha debajo del plano.'
        : 'Clic en un aula para abrir su ficha. Con Tab recorrés las aulas y Enter la abre; + y − acercan.';

  const zoomed = zoom.s > 1.01;
  const viewStyle = { ['--cls-ratio' as string]: (W * fz) / H, aspectRatio: `${W * fz} / ${H}` } as CSSProperties;
  const stageStyle: CSSProperties = {
    width: `${(zoom.s / fz) * 100}%`,
    height: `${zoom.s * 100}%`,
    transform: `translate(${-zoom.ox * 100}%, ${-zoom.oy * 100}%)`
  };

  return (
    <div className="cls-plan" ref={rootRef}>
      <div className="cls-plan-tools">
        {compact && (
          <Segmented<Frame>
            size="sm"
            ariaLabel="Qué parte del plano ver"
            value={frame}
            onChange={pickFrame}
            options={[{ value: 'all', label: 'Todo' }, { value: 'left', label: 'Izquierda' }, { value: 'right', label: 'Derecha' }]}
          />
        )}
        <div className="cls-plan-zoom" role="group" aria-label="Zoom del plano">
          <IconButton size="sm" variant="secondary" label="Alejar el plano" icon={<IconMinus size={16} />} disabled={!zoomed} onClick={() => zoomBy(1 / 1.4)} />
          <span className="cls-plan-zoom-value" aria-live="polite">{Math.round(zoom.s * 100)}%</span>
          <IconButton size="sm" variant="secondary" label="Acercar el plano" icon={<IconPlus size={16} />} disabled={zoom.s >= MAX_SCALE - 0.01} onClick={() => zoomBy(1.4)} />
          <IconButton size="sm" variant="ghost" label="Encuadrar el plano completo" icon={<IconFrame />} disabled={!zoomed} onClick={resetZoom} />
        </div>
      </div>
      <div
        ref={viewRef}
        className={cx('classroom-model-canvas', 'cls-plan-view', zoomed && 'is-zoomed')}
        style={viewStyle}
        role="group"
        aria-label={`Plano de ${floor.label}, ${siteLabel}`}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="cls-plan-port" ref={portRef}>
        <div className="cls-plan-stage" style={stageStyle}>
          <svg className="cls-plan-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
            {paths.body && <path className="cls-plan-body" d={paths.body} />}
            {paths.corr && <path className="cls-plan-corr" d={paths.corr} />}
            {paths.deco && <path className="cls-plan-deco" d={paths.deco} />}
            {paths.dash && <path className="cls-plan-dash" d={paths.dash} />}
            {paths.line && <path className="cls-plan-line" d={paths.line} />}
            {paths.door && <path className="cls-plan-door" d={paths.door} />}
          </svg>
          {labels}
          {roomButtons}
        </div>
        </div>
      </div>
      <p className={cx('cls-plan-readout', hovered && 'is-live')} aria-live="polite">{readout}</p>
    </div>
  );
}

export { roomName };
