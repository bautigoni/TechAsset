export function clean(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeText(value: unknown): string {
  return clean(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

export function formatDateTime(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('es-AR');
}

export function formatLoanDateTime(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

export function formatTime(value?: string): string {
  if (!value) return '';
  if (/^\d{1,2}:\d{2}/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

export function formatTimeOnly(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const directTime = String(value).match(/(?:^|\s)(\d{1,2}):(\d{2})(?::\d{2})?(?:\s|$)/);
  return directTime ? `${directTime[1].padStart(2, '0')}:${directTime[2]}` : value;
}

export function loanAgeDays(value?: string): number {
  if (!value) return 0;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

export function loanAgeLabel(value?: string): string {
  const days = loanAgeDays(value);
  if (!value) return '';
  if (days <= 0) return 'Hoy';
  if (days === 1) return '1 dia';
  return `${days} dias`;
}

export function loanAgeTone(value?: string): 'fresh' | 'warning' | 'danger' {
  const days = loanAgeDays(value);
  if (days >= 2) return 'danger';
  if (days >= 1) return 'warning';
  return 'fresh';
}

export function todayNameEs(date = new Date()): string {
  const map = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  return map[date.getDay()];
}

export function csvCell(value: unknown): string {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}
