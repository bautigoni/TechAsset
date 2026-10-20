import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAnchoredToggle } from '../../ui';

/* Movimiento de las listas de Dispositivos e Inventario (agregados del dueño
   del 20/10: "nada se abre de golpe" y "nada cambia de tamaño de golpe al
   tocar un filtro"). Local a estas pantallas: no cambia componentes compartidos. */

/** Filas que entran animadas como máximo por tanda (las de más abajo quedan fuera de vista). */
const CAP = 30;

const reducedMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/** Duración de los colapsos (`--ui-collapse-dur`, 250 ms), para moverse igual que ellos. */
function collapseMs() {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--ui-collapse-dur').trim();
  const n = parseFloat(value);
  return Number.isFinite(n) ? (value.endsWith('ms') ? n : n * 1000) : 250;
}

/**
 * "Ver más" sin aparecer de golpe: marca por un rato las filas que se acaban
 * de sumar (por clave) para que su CSS las haga crecer desde alto 0 con
 * opacidad (`@starting-style` + `interpolate-size`, con guarda de
 * movimiento reducido). Pasada la transición la marca se saca y las filas
 * quedan como cualquier otra (sin `overflow: clip` ni capas de más).
 * Lo de arriba no se mueve: lo nuevo crece debajo de la última fila vista.
 */
export function useRevealedRows(ms = 600) {
  const [keys, setKeys] = useState<ReadonlySet<string>>(() => new Set());
  const timer = useRef(0);
  const anchored = useAnchoredToggle();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  /** Marca `added` y aplica `update` (subir el límite) con "Ver más" quieto bajo el cursor, como los colapsos. */
  const reveal = useCallback((added: string[], update: () => void) => {
    window.clearTimeout(timer.current);
    anchored(() => {
      setKeys(new Set(added.slice(0, CAP)));
      update();
    });
    timer.current = window.setTimeout(() => setKeys(new Set()), ms);
  }, [ms, anchored]);
  const isNew = useCallback((key: string) => keys.has(key), [keys]);
  return { reveal, isNew };
}

/**
 * Un bloque cuyo alto cambia por algo que se tocó (un filtro, un segmentado,
 * la barra de selección que pasa a confirmación) pasa del alto viejo al nuevo
 * suave, con el control tocado quieto en la pantalla:
 *
 *   const smooth = useSmoothHeight<HTMLDivElement>();
 *   <Segmented onChange={value => smooth.change(() => setFilter(value))} />
 *   <div ref={smooth.ref}>…lista…</div>
 *
 * `change` mide el alto antes, aplica el cambio anclando el control
 * (useAnchoredToggle: si el documento se acorta, el scroll no salta) y, ya
 * pintado lo nuevo, anima `height` del viejo al nuevo y lo libera (`auto`).
 * Con movimiento reducido el cambio es inmediato (sin saltos de scroll igual).
 */
export function useSmoothHeight<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const from = useRef<number | null>(null);
  const cleanup = useRef<() => void>(() => undefined);
  const anchored = useAnchoredToggle();

  const change = useCallback((update: () => void) => {
    const el = ref.current;
    if (el) {
      cleanup.current();
      from.current = el.getBoundingClientRect().height;
    }
    anchored(update);
  }, [anchored]);

  // Después de cada render: si hubo un `change`, se anima del alto anterior al nuevo.
  useLayoutEffect(() => {
    const el = ref.current;
    const start = from.current;
    from.current = null;
    if (!el || start === null || reducedMotion()) return;
    const end = el.getBoundingClientRect().height;
    if (Math.abs(end - start) < 2) return;
    const ms = collapseMs();
    el.style.height = `${start}px`;
    el.style.overflow = 'clip';
    void el.offsetHeight;
    el.style.transition = `height ${ms}ms var(--g-ease)`;
    el.style.height = `${end}px`;
    let timer = 0;
    const done = () => {
      window.clearTimeout(timer);
      el.removeEventListener('transitionend', onEnd);
      el.style.removeProperty('height');
      el.style.removeProperty('overflow');
      el.style.removeProperty('transition');
      cleanup.current = () => undefined;
    };
    const onEnd = (event: TransitionEvent) => { if (event.target === el && event.propertyName === 'height') done(); };
    el.addEventListener('transitionend', onEnd);
    timer = window.setTimeout(done, ms + 80);
    cleanup.current = done;
  });

  useEffect(() => () => cleanup.current(), []);
  return { ref, change };
}
