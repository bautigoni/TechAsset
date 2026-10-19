/** Título y cuerpo de una notificación sin markdown (#, **, `, viñetas, links). */
export function plainText(value: string) {
  return String(value || '').replace(/^#{1,6}\s*/gm, '').replace(/\*\*(.*?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/^[-*+]\s+/gm, '').replace(/\[(.*?)\]\([^)]*\)/g, '$1').trim();
}

/** "recién", "hace N min", "hace N h", "hace N d". */
export function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (!Number.isFinite(min) || min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}
