import type { PropsWithChildren } from 'react';

export function StatCard({ label, value, onClick, large = false, active = false }: PropsWithChildren<{ label: string; value: string | number; onClick?: () => void; large?: boolean; active?: boolean }>) {
  return (
    <article className={`stat-card ${large ? 'stat-card-lg' : ''} ${onClick ? 'clickable inline-kpi-filter' : ''} ${active ? 'active active-filter' : ''}`.trim()} onClick={onClick}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
