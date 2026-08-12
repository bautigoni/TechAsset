import { useEffect, useRef } from 'react';

/**
 * Intervalo estable: el callback se guarda en un ref, así el timer no se destruye
 * y se vuelve a crear en cada render (antes el callback iba en las deps del
 * useEffect, y como llega inline se recreaba el setInterval todo el tiempo).
 *
 * Se pausa cuando la pestaña no está visible: antes seguía golpeando la API con
 * la pestaña en segundo plano o la PWA en el bolsillo, y en producción cada
 * ciclo es una consulta a la base. Al volver a la pestaña refresca una vez y
 * retoma el intervalo.
 */
export function useAutoRefresh(callback: () => void, seconds = 5) {
  const saved = useRef(callback);
  saved.current = callback;

  useEffect(() => {
    if (!seconds || seconds < 0) return;
    let id = 0;

    const stop = () => {
      if (id) window.clearInterval(id);
      id = 0;
    };
    const start = () => {
      stop();
      id = window.setInterval(() => saved.current(), seconds * 1000);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        saved.current();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [seconds]);
}
