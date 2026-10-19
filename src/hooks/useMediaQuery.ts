import { useCallback, useSyncExternalStore } from 'react';

const listOf = (query: string) => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null);

/**
 * `true` mientras la media query se cumple (p. ej. '(max-width: 767px)'). Sirve
 * para lo que el CSS no puede cambiar (un placeholder más corto en angosto, un
 * layout que se arma distinto en mobile). Se lee en el mismo render (sin un
 * primer pintado con el valor equivocado) y se actualiza al cambiar el ancho.
 */
export function useMediaQuery(query: string) {
  const subscribe = useCallback((onChange: () => void) => {
    const list = listOf(query);
    list?.addEventListener('change', onChange);
    return () => list?.removeEventListener('change', onChange);
  }, [query]);
  return useSyncExternalStore(
    subscribe,
    () => Boolean(listOf(query)?.matches),
    () => false
  );
}
