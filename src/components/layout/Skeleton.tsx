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

/** Bloque suelto, para meter dentro de una card o un modal. */
export function SkeletonBlock({ height = 84, width, index = 0 }: { height?: number | string; width?: number | string; index?: number }) {
  return <div className="t-skel-card" aria-hidden="true" style={{ height, width, ...step(index) }} />;
}

/** Renglón fino, para un subtítulo o un contador que todavía no llegó. */
export function SkeletonLine({ width = '60%', height = 14, index = 0 }: { width?: number | string; height?: number | string; index?: number }) {
  return <div className="t-skel-line" aria-hidden="true" style={{ width, height, ...step(index) }} />;
}

/** Encabezado + filas: sirve para listas, tablas y cuerpos de modal. */
export function SkeletonPanel({ rows = 3, rowHeight = 64, head = true }: { rows?: number; rowHeight?: number; head?: boolean }) {
  return (
    <div className="t-skel-col" aria-hidden="true">
      {head && <div className="t-skel-line t-skel-head" />}
      {Array.from({ length: rows }, (_, index) => (
        <div className="t-skel-card" key={index} style={{ height: rowHeight, ...step(index + 1) }} />
      ))}
    </div>
  );
}

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
