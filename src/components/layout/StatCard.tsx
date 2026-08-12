import type { CSSProperties, PropsWithChildren } from 'react';

export function StatCard({ label, value, onClick, large = false, active = false, accent }: PropsWithChildren<{ label: string; value: string | number; onClick?: () => void; large?: boolean; active?: boolean; accent?: string }>) {
  const className = `stat-card ${large ? 'stat-card-lg' : ''} ${onClick ? 'clickable inline-kpi-filter' : ''} ${active ? 'active active-filter' : ''}`.trim();
  const style = accent ? ({ '--stat-accent': accent, borderLeft: '4px solid var(--stat-accent)' } as CSSProperties) : undefined;

  // Las tarjetas que filtran la tabla eran un <article onClick>: no se podían
  // usar con teclado ni las anunciaba un lector de pantalla. Cuando filtran son
  // un botón de verdad, con estado presionado.
  if (onClick) {
    return (
      <button type="button" className={className} style={style} onClick={onClick} aria-pressed={active}>
        <span>{label}</span>
        <strong>{value}</strong>
      </button>
    );
  }

  return (
    <article className={className} style={style}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
