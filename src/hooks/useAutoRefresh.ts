import { useEffect, useRef } from 'react';

/**
 * Intervalo estable: el callback se guarda en un ref, así el timer no se destruye
 * y se vuelve a crear en cada render (antes el callback iba en las deps del
 * useEffect, y como llega inline se recreaba el setInterval todo el tiempo).
 */
export function useAutoRefresh(callback: () => void, seconds = 5) {
  const saved = useRef(callback);
  saved.current = callback;

  useEffect(() => {
    if (!seconds || seconds < 0) return;
    const id = window.setInterval(() => saved.current(), seconds * 1000);
    return () => window.clearInterval(id);
  }, [seconds]);
}
