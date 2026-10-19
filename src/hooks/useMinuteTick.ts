import { useEffect, useState } from 'react';

/**
 * Re-render una vez por minuto (alineado al cambio de minuto) para lo que
 * depende de la hora: "en curso", vencidas, recreo activo, "hoy" pasada la
 * medianoche. Con la pestaña oculta no corre; al volver se pone al día.
 * Devuelve un número que cambia cada minuto (sirve de dependencia de useMemo).
 */
export function useMinuteTick() {
  const [tick, setTick] = useState(() => Math.floor(Date.now() / 60000));
  useEffect(() => {
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      if (document.hidden) return;
      timer = window.setTimeout(() => {
        setTick(Math.floor(Date.now() / 60000));
        schedule();
      }, 60000 - (Date.now() % 60000) + 50);
    };
    const onVisibility = () => {
      if (!document.hidden) setTick(Math.floor(Date.now() / 60000));
      schedule();
    };
    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  return tick;
}
