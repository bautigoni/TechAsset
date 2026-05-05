export function formatDdMm(value: string | undefined | null): string {
  if (!value) return '';
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}`;
  return String(value);
}

export function ddMmToIso(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const m = trimmed.match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$/);
  if (!m) return '';
  const day = m[1].padStart(2, '0');
  const month = m[2].padStart(2, '0');
  const yearRaw = m[3];
  const year = yearRaw ? (yearRaw.length === 2 ? `20${yearRaw}` : yearRaw) : String(new Date().getFullYear());
  return `${year}-${month}-${day}`;
}

export function isValidDdMm(input: string): boolean {
  if (!input.trim()) return true;
  return Boolean(ddMmToIso(input));
}
