import { useCallback, useEffect, useRef, useState } from 'react';
import './ui.css';

/** Une clases ignorando falsy. */
export function cx(...parts: Array<string | false | null | undefined | 0 | 0n>) {
  return parts.filter(Boolean).join(' ');
}

/**
 * Valor controlado o no controlado con la misma API: si viene `value` manda el
 * padre; si no, el estado interno arranca en `defaultValue`.
 */
export function useControllable<T>(value: T | undefined, defaultValue: T, onChange?: (next: T) => void) {
  const [inner, setInner] = useState(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? (value as T) : inner;
  const set = useCallback((next: T) => {
    if (!controlled) setInner(next);
    onChange?.(next);
  }, [controlled, onChange]);
  return [current, set] as const;
}

/** `prefers-reduced-motion: reduce` en vivo (para lo que se anima desde JS). */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** Último valor de una función sin re-suscribir efectos. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/** Normaliza para buscar y para el type-ahead: sin tildes, minúsculas. */
export function fold(text: string) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Scrollea un contenedor interno para que `child` quede visible, sin tocar el
 * scroll de la página (scrollIntoView mueve todos los ancestros).
 */
export function keepInView(container: HTMLElement | null, child: HTMLElement | null) {
  if (!container || !child) return;
  const top = child.offsetTop;
  const bottom = top + child.offsetHeight;
  if (top < container.scrollTop) container.scrollTop = top;
  else if (bottom > container.scrollTop + container.clientHeight) container.scrollTop = bottom - container.clientHeight;
}
