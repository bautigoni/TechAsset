/**
 * "Abrir ESTA tarea" desde otra vista (Inicio → Tareas). Quien pide deja el id
 * y navega; Tareas, cuando ya tiene la lista, toma el pedido y abre esa tarea.
 * En memoria: si la tarea no aparece (borrada, otra sede), el pedido se olvida
 * al cambiar de sede o a los 30 s.
 */
let pending: { id: string; at: number } | null = null;

export function requestOpenTask(id: string) {
  pending = { id: String(id), at: Date.now() };
}

/** El id pedido si sigue vigente (no lo consume). */
export function peekOpenTask(): string | null {
  if (!pending) return null;
  if (Date.now() - pending.at > 30_000) { pending = null; return null; }
  return pending.id;
}

export function clearOpenTask() {
  pending = null;
}
