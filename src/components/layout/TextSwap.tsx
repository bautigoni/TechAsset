import { useEffect, useRef, useState } from 'react';

// Tiene que coincidir con --text-swap-dur en motion.css.
const SWAP_MS = 180;

/**
 * Receta `text-states-swap` de transitions.dev.
 *
 * Cuando el texto cambia, el viejo sale hacia arriba con blur y el nuevo entra
 * desde abajo. Sirve para los botones que cambian de etiqueta al trabajar
 * ("Guardar" → "Guardando…" → "Guardar"): sin esto la palabra se reemplaza en
 * seco y no se lee como que algo arrancó.
 *
 * Se monta solo cuando el label es un string. Un botón con ícono + texto se
 * renderiza tal cual: envolver nodos arbitrarios en un span rompería layouts
 * que no controlamos.
 */
export function TextSwap({ children }: { children: string }) {
  const [shown, setShown] = useState(children);
  const [phase, setPhase] = useState<'' | 'is-exit' | 'is-enter-start'>('');
  const pendingRef = useRef(children);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    pendingRef.current = children;
    if (children === shown) return;

    setPhase('is-exit');
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setShown(pendingRef.current);
      // El nuevo texto se pinta ya desplazado y sin transición; recién en el
      // frame siguiente se suelta la clase y el browser lo trae a su lugar.
      setPhase('is-enter-start');
      requestAnimationFrame(() => requestAnimationFrame(() => setPhase('')));
    }, SWAP_MS);

    return () => window.clearTimeout(timerRef.current);
  }, [children, shown]);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  return <span className={`t-text-swap ${phase}`.trim()}>{shown}</span>;
}
