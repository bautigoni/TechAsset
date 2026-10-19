import { useSyncExternalStore } from 'react';

/**
 * `true` mientras la media query se cumple. Sirve para lo que el CSS no puede
 * cambiar (p. ej. un placeholder más corto en angosto, para que no se corte).
 */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    onChange => {
      const list = window.matchMedia?.(query);
      list?.addEventListener('change', onChange);
      return () => list?.removeEventListener('change', onChange);
    },
    () => Boolean(window.matchMedia?.(query).matches),
    () => false
  );
}
