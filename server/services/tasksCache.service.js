/**
 * Caché de la lista de tareas armada por sede (GET /api/tasks).
 *
 * La app pollea /api/tasks cada 30 s en cada pestaña abierta y casi siempre no
 * cambió nada; armarla cuesta 4 consultas (columnas, subtareas, comentarios y
 * tareas) y en producción cada una es un viaje sincrónico a Supabase que frena
 * el proceso entero. Acá se guarda la lista ya convertida (rowToTask) y se
 * reusa mientras no haya escrituras.
 *
 * Invalidación: cualquier escritura que pase por la API de tareas, columnas o
 * el asistente sube la versión (hook en server/index.js, igual que el
 * inventario), y también las escrituras directas del server (creación del
 * asistente, migraciones). El TTL corto cubre lo que se escriba por fuera de la
 * app (SQL directo en Supabase).
 *
 * Lo que depende del usuario (privadas, "mías", equipo) se filtra después, por
 * pedido, sobre la lista compartida: nunca se cachea una respuesta ya filtrada.
 */
const TTL_MS = 60 * 1000;
const cache = new Map();
let version = 0;

export function bumpTasksVersion() {
  version += 1;
}

/** Lista de tareas de la sede (objetos de rowToTask) desde la caché o `build()`. */
export function getCachedTaskRows(siteCode, build) {
  const hit = cache.get(siteCode);
  if (hit && hit.version === version && Date.now() - hit.at < TTL_MS) return hit.rows;
  const startedAt = version;
  const rows = build();
  // Si una escritura pasó en el medio, no se guarda una lista que ya es vieja.
  if (startedAt === version) cache.set(siteCode, { version, at: Date.now(), rows });
  return rows;
}
