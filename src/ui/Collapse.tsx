import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode, type RefObject } from 'react';
import { cx } from './util';

/* ══ Collapse: abrir y cerrar secciones sin saltos (REGLAS-UX, agregado 19/10) ══

   - El alto se anima con `grid-template-rows: 0fr ↔ 1fr` (250 ms, var(--g-ease); receta "accordion" de transitions.dev);
     con `prefers-reduced-motion: reduce` es instantáneo.
   - Cerrado, el contenido queda inerte (ni foco ni lector de pantalla).
   - Lo que se tocó NO se mueve en pantalla: se mide su posición antes del cambio
     y, mientras dura la transición, se corrige el scroll del contenedor que
     scrollea (en el shell es `.shell-scroll`, no window). Si al cerrar el
     documento se acorta y el navegador tendría que recortar el scroll, se
     reserva ese alto al pie del contenedor y se va liberando a medida que deja
     de verse (nunca de golpe).
   - Al abrir, si lo nuevo quedó fuera de vista, se lo lleva a la vista suave
     (sin sacar de pantalla al encabezado que se tocó).

   Uso:
     <button aria-expanded={open} aria-controls="x" onClick={() => setOpen(!open)}>Cartelitos</button>
     <Collapse open={open} id="x" className="mi-cuerpo">…</Collapse>
*/

export const COLLAPSE_MS = 250;

type AnchorProp = RefObject<HTMLElement | null> | (() => HTMLElement | null | undefined) | false;

const reducedMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/* ── Último disparador tocado (para anclar sin que cada pantalla lo pase) ── */

let lastTrigger: { el: HTMLElement; at: number } | null = null;
let tracking = false;
const TRIGGER = 'button, a[href], summary, [role="button"], [role="tab"], [aria-expanded], [aria-controls]';

function trackTriggers() {
  if (tracking || typeof document === 'undefined') return;
  tracking = true;
  const remember = (event: Event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>(TRIGGER) : null;
    if (target) lastTrigger = { el: target, at: performance.now() };
  };
  document.addEventListener('pointerdown', remember, true);
  document.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') remember(event); }, true);
  document.addEventListener('click', remember, true);
}

/** El control que el usuario acaba de tocar (último segundo), si sigue en la página. */
export function recentTrigger(maxAgeMs = 1000): HTMLElement | null {
  trackTriggers();
  if (!lastTrigger || !lastTrigger.el.isConnected) return null;
  return performance.now() - lastTrigger.at <= maxAgeMs ? lastTrigger.el : null;
}

/* ── Contenedor que scrollea y reserva de alto ─────────────────────────── */

const isDocScroller = (el: Element) => el === document.scrollingElement || el === document.documentElement || el === document.body;

/** Ancestro que scrollea en Y (en el shell, `.shell-scroll`); si no hay, el documento. */
export function scrollParentOf(el: Element | null): HTMLElement {
  let node = el?.parentElement || null;
  while (node && !isDocScroller(node)) {
    const overflow = getComputedStyle(node).overflowY;
    // Un `overflow-x: auto` (tabla que scrollea de costado) hace que overflow-y
    // compute `auto` aunque no scrollee en Y: solo cuenta si de verdad scrollea.
    if ((overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') && node.scrollHeight > node.clientHeight + 1) return node;
    node = node.parentElement;
  }
  return (document.scrollingElement || document.documentElement) as HTMLElement;
}

type ScrollerState = { reserve: number; holds: number; listening: boolean };
const scrollers = new WeakMap<HTMLElement, ScrollerState>();

function stateOf(scroller: HTMLElement) {
  let state = scrollers.get(scroller);
  if (!state) { state = { reserve: 0, holds: 0, listening: false }; scrollers.set(scroller, state); }
  return state;
}

function setReserve(scroller: HTMLElement, px: number) {
  const state = stateOf(scroller);
  state.reserve = Math.max(0, Math.round(px));
  // El alto reservado es un ::after al final del contenido (no toca el DOM de React).
  const host = isDocScroller(scroller) ? document.body : scroller;
  host.classList.toggle('ui-scroll-reserve', state.reserve > 0);
  if (state.reserve > 0) host.style.setProperty('--ui-reserve', `${state.reserve}px`);
  else host.style.removeProperty('--ui-reserve');
}

/** Achica la reserva a lo que hoy se ve de ella: nunca obliga al navegador a recortar el scroll. */
function trimReserve(scroller: HTMLElement) {
  const state = stateOf(scroller);
  if (state.holds > 0 || state.reserve <= 0) return;
  // Hace falta lo justo para que el scroll actual siga siendo válido. Arriba de
  // todo (scrollTop 0) no hace falta nada: soltarla no mueve nada y en una
  // página corta no queda un hueco al pie.
  const contentBottom = scroller.scrollHeight - state.reserve;
  const visible = scroller.scrollTop <= 0 ? 0 : scroller.scrollTop + scroller.clientHeight - contentBottom;
  const next = Math.max(0, Math.min(state.reserve, Math.ceil(visible)));
  if (next !== state.reserve) setReserve(scroller, next);
  if (next === 0) stopTrimming(scroller);
}

const trimmers = new WeakMap<HTMLElement, () => void>();
function startTrimming(scroller: HTMLElement) {
  const state = stateOf(scroller);
  if (state.listening) return;
  state.listening = true;
  const onScroll = () => trimReserve(scroller);
  trimmers.set(scroller, onScroll);
  (isDocScroller(scroller) ? window : scroller).addEventListener('scroll', onScroll, { passive: true });
}
function stopTrimming(scroller: HTMLElement) {
  const state = stateOf(scroller);
  const onScroll = trimmers.get(scroller);
  if (onScroll) (isDocScroller(scroller) ? window : scroller).removeEventListener('scroll', onScroll);
  state.listening = false;
}

/**
 * Suelta ya el alto reservado al pie (si nada lo está usando). Para cuando se
 * cambia de página o de sección: la reserva de un cierre anterior no puede
 * quedar como hueco al pie de una página corta.
 */
export function releaseScrollReserve(scroller?: HTMLElement | null) {
  if (typeof document === 'undefined') return;
  const sc = scroller || (document.querySelector<HTMLElement>('.shell-scroll') ?? (document.scrollingElement as HTMLElement | null));
  if (!sc) return;
  const state = scrollers.get(sc);
  if (!state || state.holds > 0 || state.reserve <= 0) return;
  setReserve(sc, 0);
  stopTrimming(sc);
}

/* ── keepInPlace: que un elemento no se mueva en pantalla mientras algo cambia de alto ── */

export type KeepInPlaceOptions = {
  /** Cuánto dura la corrección (ms). 0 = solo el próximo frame (reduced motion). */
  duration?: number;
  /** Alto a reservar al pie por si el contenido se acorta ('auto' = el alto visible del contenedor). */
  reserve?: number | 'auto';
  /** Contenedor que scrollea (si no, el ancestro scrolleable del ancla). */
  scroller?: HTMLElement | null;
  /** Elemento que cambia de alto (se observa para corregir en el mismo frame). */
  watch?: HTMLElement | null;
};

export type KeepInPlace = { step: () => void; stop: () => void };

const NOOP: KeepInPlace = { step: () => {}, stop: () => {} };

/**
 * Mide dónde está `anchor` ahora y, durante `duration`, corrige el scroll de su
 * contenedor para que siga exactamente ahí. Llamalo ANTES del cambio de alto
 * (antes del setState o antes de aplicar la clase).
 */
export function keepInPlace(anchor: HTMLElement | null | undefined, { duration = COLLAPSE_MS + 60, reserve = 0, scroller, watch }: KeepInPlaceOptions = {}): KeepInPlace {
  if (!anchor || !anchor.isConnected || typeof window === 'undefined') return NOOP;
  const sc = scroller || scrollParentOf(anchor);
  // Arriba de todo no hay nada que compensar: cerrar no recorta y abrir no corre nada.
  if (sc.scrollTop <= 0) return NOOP;
  const state = stateOf(sc);
  state.holds += 1;
  if (state.holds === 1) sc.style.overflowAnchor = 'none';
  const extra = reserve === 'auto' ? sc.clientHeight : reserve;
  if (extra > 0) setReserve(sc, state.reserve + extra);
  const top0 = anchor.getBoundingClientRect().top;
  // Si algo que no es esta corrección scrollea mientras dura (la rueda del
  // usuario, un scrollIntoView, el teclado), manda eso: se deja de sostener
  // el ancla en vez de pelearle el scroll y devolverlo a donde estaba.
  let expected = sc.scrollTop;
  let released = false;
  const step = () => {
    if (released || !anchor.isConnected) return;
    if (Math.abs(sc.scrollTop - expected) > 1) { released = true; return; }
    const delta = anchor.getBoundingClientRect().top - top0;
    if (Math.abs(delta) >= 0.5) sc.scrollTop += delta;
    expected = sc.scrollTop;
  };
  // Se corrige DESPUÉS del layout y ANTES de pintar (ResizeObserver): con solo
  // rAF la corrección llegaría un frame tarde y el ancla temblaría. Se observa lo
  // que cambia de alto: el contenedor, su contenido y lo que se pase en `watch`.
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(step);
  const content = isDocScroller(sc) ? document.body : sc.firstElementChild;
  for (const el of [sc, content, watch]) if (el) observer?.observe(el);
  let raf = 0;
  let done = false;
  const until = performance.now() + duration;
  const stop = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    observer?.disconnect();
    step();
    state.holds = Math.max(0, state.holds - 1);
    if (state.holds === 0) {
      sc.style.overflowAnchor = '';
      if (state.reserve > 0) { startTrimming(sc); trimReserve(sc); }
    }
  };
  const loop = () => {
    step();
    if (performance.now() < until) raf = requestAnimationFrame(loop);
    else stop();
  };
  raf = requestAnimationFrame(loop);
  return { step, stop };
}

/**
 * Para cambios de alto que no pasan por <Collapse> (un "Ver más", una ficha que
 * se reemplaza): `const anchored = useAnchoredToggle(); anchored(() => setOpen(v => !v), event.currentTarget)`.
 * Sin ancla explícita usa el control recién tocado.
 */
export function useAnchoredToggle() {
  return useCallback((update: () => void, anchor?: HTMLElement | null) => {
    keepInPlace(anchor || recentTrigger(), { duration: reducedMotion() ? 0 : COLLAPSE_MS + 60, reserve: 'auto' });
    update();
  }, []);
}

/**
 * Lleva `target` a la vista dentro de su contenedor, suave (instantáneo con
 * reduced motion): si quedó arriba, lo baja hasta él; si se corta abajo, sube
 * lo justo sin sacar de pantalla a `keepVisible` (el encabezado tocado).
 */
export function revealInView(target: HTMLElement | null, keepVisible?: HTMLElement | null) {
  if (!target?.isConnected) return;
  const sc = scrollParentOf(target);
  const doc = isDocScroller(sc);
  const view = doc ? { top: 0, bottom: window.innerHeight } : sc.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  const margin = 8;
  let by = 0;
  if (rect.top < view.top) by = rect.top - view.top - margin;
  else if (rect.bottom > view.bottom) {
    const limit = (keepVisible?.isConnected ? keepVisible : target).getBoundingClientRect().top - view.top - margin;
    by = Math.min(rect.bottom - view.bottom + margin, Math.max(0, limit));
  }
  if (Math.abs(by) < 1) return;
  sc.scrollBy({ top: by, behavior: reducedMotion() ? 'auto' : 'smooth' });
}

/**
 * Una sola ficha abierta en una lista (debajo de su fila): la que se cierra
 * tiene que seguir dibujada hasta terminar de plegarse. Uso:
 *
 *   const held = useHeldKeys(openKey);
 *   {held.drawn(key) && <Collapse open={openKey === key} appear unmountOnClose onSettled={o => { if (!o) held.release(key); }}>…</Collapse>}
 */
export function useHeldKeys(openKey: string | null | undefined) {
  const current = openKey || null;
  const [closing, setClosing] = useState<string[]>([]);
  const [last, setLast] = useState<string | null>(current);
  if (current !== last) {
    // Ajuste durante el render (patrón de React para estado derivado de props).
    setClosing(list => {
      let next = last && !list.includes(last) ? [...list, last] : list;
      if (current && next.includes(current)) next = next.filter(item => item !== current);
      return next;
    });
    setLast(current);
  }
  const release = useCallback((key: string) => setClosing(list => (list.includes(key) ? list.filter(item => item !== key) : list)), []);
  return { drawn: (key: string) => key === current || closing.includes(key), release };
}

/** Duración de la transición de alto del colapso (ms), leída del CSS. */
function transitionMs(el: HTMLElement) {
  const value = getComputedStyle(el).transitionDuration.split(',')[0] || '0s';
  return parseFloat(value) * (value.endsWith('ms') ? 1 : 1000) || 0;
}

/* ── <Collapse> ────────────────────────────────────────────────────────── */

type CollapseState = 'open' | 'closed' | 'opening' | 'closing';

export type CollapseProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  open: boolean;
  children: ReactNode;
  /** Va al contenido (puede tener padding, borde, gap); la capa que recorta es aparte. */
  className?: string;
  /** Clase del contenedor que anima (sin padding ni borde propios). */
  outerClassName?: string;
  /**
   * Lo que no se mueve en pantalla. Default: el control recién tocado si está
   * fuera del contenido (el encabezado, "Ver más") o, si no, el borde de arriba
   * del colapso. `false` = no anclar (p. ej. franjas fuera del área que scrollea).
   */
  anchor?: AnchorProp;
  /** Al abrir, llevar lo nuevo a la vista si quedó afuera (default true). */
  reveal?: boolean;
  /** Montar el contenido recién la primera vez que se abre (default true). */
  lazy?: boolean;
  /** Desmontar el contenido al terminar de cerrar (default false: se conserva lo tipeado). */
  unmountOnClose?: boolean;
  /** Si se monta ya abierto, entra animado desde 0 (lo que se monta al abrir). */
  appear?: boolean;
  /**
   * Alto a reservar al pie del contenedor que scrollea mientras anima. Por
   * defecto, al cerrar, el alto que se va. 'auto' (el alto visible) sirve
   * cuando el colapso está FUERA del área que scrollea y el ancla adentro
   * (las franjas de la cabecera anclan el contenido de la página).
   */
  reserve?: 'auto';
  /** Al terminar de abrir o cerrar. */
  onSettled?: (open: boolean) => void;
  /**
   * Adónde vuelve el foco si estaba adentro al cerrar (el contenido cerrado
   * queda inerte). Default: el control que se tocó para abrir/cerrar, si está
   * fuera del contenido. `false` = no mover el foco.
   */
  returnFocus?: RefObject<HTMLElement | null> | false;
  /**
   * Espacio que el padre (flex/grid) deja entre hijos, p. ej. 'var(--g-s-4)'.
   * Cerrado, un margen negativo lo cancela (y se anima con el alto): un
   * colapso cerrado no deja un hueco de `gap` entre sus hermanos. Es lo mismo
   * que poner `--ui-collapse-gap` desde el CSS de la pantalla
   * (`.padre > .ui-collapse { --ui-collapse-gap: … }`): un solo mecanismo.
   * En un padre grid, si es el primer hijo, el hueco no se cancela.
   */
  gap?: string;
};

export function Collapse({ open, children, className, outerClassName, anchor, reveal = true, lazy = true, unmountOnClose = false, appear = false, reserve, onSettled, returnFocus, gap, ...rest }: CollapseProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const clipRef = useRef<HTMLDivElement | null>(null);
  const initial = useRef<CollapseState>(open && !appear ? 'open' : 'closed');
  const first = useRef(true);
  const [mounted, setMounted] = useState(open || !lazy);
  if (open && !mounted) setMounted(true);
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const focusRef = useRef(returnFocus);
  focusRef.current = returnFocus;
  // Mientras se cierra (y cerrado) se dibuja lo último que se vio abierto: si
  // el contenido depende de un estado que se limpió al cerrar (`result && …`),
  // no desaparece de golpe a mitad de la transición.
  const shown = useRef<ReactNode>(children);
  if (open) shown.current = children;

  useLayoutEffect(() => {
    trackTriggers();
    const wrap = wrapRef.current;
    const clip = clipRef.current;
    if (!wrap || !clip) return;
    const isFirst = first.current;
    first.current = false;
    if (isFirst && !(open && appear)) return;
    const current = (wrap.dataset.state || 'closed') as CollapseState;
    const target: CollapseState = open ? 'open' : 'closed';
    if (current === target) return;

    // La duración sale del CSS (--ui-collapse-dur); 0 = movimiento reducido o sin transición.
    const ms = transitionMs(wrap);
    const reduced = ms === 0 || reducedMotion();
    const anchorOpt = anchorRef.current;
    let anchorEl: HTMLElement | null = null;
    if (anchorOpt !== false) {
      if (typeof anchorOpt === 'function') anchorEl = anchorOpt() || null;
      else if (anchorOpt) anchorEl = anchorOpt.current;
      else {
        const trigger = recentTrigger();
        anchorEl = trigger && !wrap.contains(trigger) ? trigger : wrap;
      }
    }
    // Si el foco estaba adentro, vuelve al control que se tocó (o al que se indique).
    // (Si el navegador ya lo soltó por el `inert`, cuenta si lo último tocado estaba adentro.)
    const active = document.activeElement;
    const touched = recentTrigger();
    const focusInside = Boolean(active && (clip.contains(active) || (active === document.body && touched && clip.contains(touched))));
    if (!open && focusRef.current !== false && focusInside) {
      const back = focusRef.current?.current || (anchorEl && anchorEl !== wrap && !wrap.contains(anchorEl) ? anchorEl : null);
      back?.focus({ preventScroll: true });
    }
    const shrink = reserve === 'auto' ? 'auto' : open ? 0 : clip.getBoundingClientRect().height;
    const hold = anchorEl ? keepInPlace(anchorEl, { duration: reduced ? 0 : ms + 60, reserve: shrink, watch: wrap }) : NOOP;

    let timer = 0;
    const finish = () => {
      window.clearTimeout(timer);
      wrap.removeEventListener('transitionend', onEnd);
      wrap.dataset.state = target;
      clip.scrollTop = 0;
      hold.stop();
      if (open && reveal) revealInView(wrap, anchorEl && anchorEl !== wrap ? anchorEl : null);
      if (!open && unmountOnClose) setMounted(false);
      settled.current?.(open);
    };
    const onEnd = (event: TransitionEvent) => {
      if (event.target === wrap && event.propertyName === 'grid-template-rows') finish();
    };

    if (reduced) {
      wrap.dataset.state = target;
      hold.step();
      finish();
      return;
    }
    if (isFirst) void wrap.offsetHeight; // aparece: arranca desde 0 de verdad
    wrap.dataset.state = open ? 'opening' : 'closing';
    // Si quedó arriba de la vista (se abrió algo de arriba estando abajo), se baja hasta él ya.
    if (open && reveal) {
      const sc = scrollParentOf(wrap);
      const top = isDocScroller(sc) ? 0 : sc.getBoundingClientRect().top;
      if (wrap.getBoundingClientRect().top < top) revealInView(wrap);
    }
    wrap.addEventListener('transitionend', onEnd);
    timer = window.setTimeout(finish, ms + 120);
    return () => {
      window.clearTimeout(timer);
      wrap.removeEventListener('transitionend', onEnd);
      hold.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div
      ref={wrapRef}
      className={cx('ui-collapse', outerClassName)}
      data-state={initial.current}
      style={gap ? ({ '--ui-collapse-gap': gap } as CSSProperties) : undefined}
    >
      <div
        ref={clipRef}
        className="ui-collapse-clip"
        inert={!open}
        aria-hidden={open ? undefined : true}
        // Enfocar algo adentro mientras anima puede scrollear la capa que recorta.
        onScroll={event => { if (wrapRef.current?.dataset.state !== 'open') event.currentTarget.scrollTop = 0; }}
      >
        {mounted && <div className={className} {...rest}>{open ? children : shown.current}</div>}
      </div>
    </div>
  );
}
