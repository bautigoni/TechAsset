import type { PropsWithChildren } from 'react';

// Tonos reales que existen en components.css. Se acepta string libre por
// compatibilidad con badges de estados dinámicos (agenda, tareas, etc.).
type KnownTone = 'subtle' | 'off' | 'available' | 'loaned' | 'lost' | 'out-service' | 'overdue';
type Tone = KnownTone | (string & {});

export function Badge({ children, tone = 'subtle' }: PropsWithChildren<{ tone?: Tone }>) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
