import type { PropsWithChildren } from 'react';
import { AnimatedNumber } from './AnimatedNumber';

// La prop `accent` pintaba un borde izquierdo de 4px de color. No la usaba
// ningún llamador y la elevación de la tarjeta ya la declara el borde propio,
// así que el borde de color era doble elevación además del tell visual más
// reconocible de UI autogenerada. Se fue: no cambia nada en pantalla.
export function StatCard({ label, value, onClick, large = false, active = false }: PropsWithChildren<{ label: string; value: string | number; onClick?: () => void; large?: boolean; active?: boolean }>) {
  const className = `stat-card ${large ? 'stat-card-lg' : ''} ${onClick ? 'clickable inline-kpi-filter' : ''} ${active ? 'active active-filter' : ''}`.trim();

  // Las tarjetas que filtran la tabla eran un <article onClick>: no se podían
  // usar con teclado ni las anunciaba un lector de pantalla. Cuando filtran son
  // un botón de verdad, con estado presionado.
  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick} aria-pressed={active}>
        <span>{label}</span>
        <strong><AnimatedNumber value={value} /></strong>
      </button>
    );
  }

  return (
    <article className={className}>
      <span>{label}</span>
      <strong><AnimatedNumber value={value} /></strong>
    </article>
  );
}
