import type { CSSProperties } from 'react';

/**
 * Esqueletos de carga, con la misma receta que el tablero de Tareas TIC
 * (`t-skel-*` en motion.css).
 *
 * Reemplazan a los carteles de texto tipo "Cargando vista...". Un texto no dice
 * nada útil, ocupa el lugar equivocado y hace que el contenido real salte
 * cuando llega; el esqueleto reserva la forma de lo que viene desde el primer
 * frame, así la página no se mueve dos veces.
 */

// Escalonar el pulso hace que el bloque se lea como una sola pieza cargando y
// no como varios cuadrados parpadeando cada uno por su cuenta.
const step = (index: number): CSSProperties => ({ animationDelay: `${index * 90}ms` });

/** Página entera: título, subtítulo, fila de tarjetas y el cuerpo. */
export function SkeletonView() {
  return (
    <div className="t-skel-view" aria-hidden="true">
      <div className="t-skel-line t-skel-title" />
      <div className="t-skel-line t-skel-sub" />
      <div className="t-skel-strip">
        {[0, 1, 2, 3].map(index => <div className="t-skel-card t-skel-stat" key={index} style={step(index)} />)}
      </div>
      <div className="t-skel-card t-skel-body" style={step(4)} />
    </div>
  );
}
