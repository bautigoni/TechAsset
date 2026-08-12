import { useCallback, useEffect, useRef, useState } from 'react';

export type MountPhase = 'entering' | 'open' | 'closing';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/**
 * Sostiene un nodo montado mientras corre su animación de salida.
 *
 * El problema que resuelve: en React, `{open && <Panel/>}` desmonta el nodo en
 * el mismo frame en que `open` pasa a false, así que la transición de cierre
 * nunca llega a verse. Este hook desacopla "el dueño quiere cerrar" de "el
 * nodo ya se puede ir": devuelve `mounted` en true durante `closeMs` más,
 * con `phase` en `'closing'` para que el CSS tenga de dónde agarrarse.
 *
 * `entering` dura un frame a propósito: el nodo tiene que pintarse en su
 * estado cerrado antes de recibir `.is-open`, si no el browser no tiene entre
 * qué interpolar y aparece de golpe.
 *
 * Con `prefers-reduced-motion` no hay espera: monta y desmonta en el acto.
 */
export function useMountTransition(open: boolean, closeMs: number) {
  const [mounted, setMounted] = useState(open);
  const [phase, setPhase] = useState<MountPhase>(open ? 'open' : 'closing');
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    window.clearTimeout(timerRef.current);

    if (open) {
      setMounted(true);
      setPhase('entering');
      const raf = requestAnimationFrame(() => setPhase('open'));
      return () => cancelAnimationFrame(raf);
    }

    if (!mounted) return;
    if (prefersReducedMotion()) { setMounted(false); return; }
    setPhase('closing');
    timerRef.current = window.setTimeout(() => setMounted(false), closeMs);
    // `mounted` queda fuera de las dependencias a propósito: incluirlo
    // reejecutaría el efecto cuando el timer lo baja, cancelando el cierre a
    // mitad de camino.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, closeMs]);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  /** Clase de estado lista para concatenar: '', 'is-open' o 'is-closing'. */
  const stateClass = phase === 'open' ? 'is-open' : phase === 'closing' ? 'is-closing' : '';

  return { mounted, phase, stateClass };
}

/**
 * Variante para componentes que controlan su propio cierre y tienen que avisar
 * al padre recién cuando terminó la animación (los modales, que se desmontan
 * desde afuera). Devuelve la fase y un `requestClose` idempotente.
 */
export function useCloseChoreography(onClose: () => void, closeMs: number) {
  const [phase, setPhase] = useState<MountPhase>('entering');
  const closingRef = useRef(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setPhase('open'));
    return () => cancelAnimationFrame(raf);
  }, []);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (prefersReducedMotion()) { onClose(); return; }
    setPhase('closing');
    window.setTimeout(onClose, closeMs);
  }, [onClose, closeMs]);

  const stateClass = phase === 'open' ? 'is-open' : phase === 'closing' ? 'is-closing' : '';

  return { phase, stateClass, requestClose };
}
