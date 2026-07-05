import type { CSSProperties, PropsWithChildren } from 'react';

export function StatCard({ label, value, onClick, large = false, active = false, accent }: PropsWithChildren<{ label: string; value: string | number; onClick?: () => void; large?: boolean; active?: boolean; accent?: string }>) {
  return (
    <article
      className={`stat-card ${large ? 'stat-card-lg' : ''} ${onClick ? 'clickable inline-kpi-filter' : ''} ${active ? 'active active-filter' : ''}`.trim()}
      style={accent ? ({ '--stat-accent': accent, borderLeft: '4px solid var(--stat-accent)' } as CSSProperties) : undefined}
      onClick={onClick}
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
