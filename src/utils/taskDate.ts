export function formatDdMm(value: string | undefined | null): string {
  if (!value) return '';
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}`;
  return String(value);
}

