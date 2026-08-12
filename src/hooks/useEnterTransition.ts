import { useEffect, useState } from 'react';

/**
 * Devuelve `false` en el primer frame después de activarse y `true` a partir
 * del siguiente.
 *
 * Sirve para animar nodos que se montan condicionalmente (`{open && <div/>}`):
 * una transición CSS necesita que el estado inicial se pinte antes de que
 * cambie la clase, si no el browser no tiene entre qué interpolar y el
 * elemento aparece de golpe. Con esto el nodo entra montado en su estado
 * cerrado y recién en el frame siguiente recibe `.is-open`.
 *
 * Es sólo entrada. Para salida hace falta sostener el nodo mientras corre la
 * animación — eso lo hace `Modal`, que sí lo justifica.
 */
export function useEnterTransition(active = true) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!active) {
      setEntered(false);
      return;
    }
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return entered;
}
