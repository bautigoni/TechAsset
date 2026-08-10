import { lazy, type ComponentType } from 'react';

/**
 * Carga diferida de vistas + prefetch en idle.
 *
 * El equivalente real de las speculation rules en una SPA: cada vista viaja en su
 * propio chunk (el bundle inicial baja mucho) y, apenas la sesión está lista, se
 * precargan en segundo plano los chunks de las vistas que el rol puede ver. Cuando
 * el usuario hace click, el módulo ya está en memoria y el cambio de vista es
 * instantáneo.
 */

type ModuleLoader = () => Promise<unknown>;

const loaders = new Map<string, ModuleLoader>();
const RELOAD_FLAG = 'techasset_chunk_reload';

/**
 * Tras un deploy los chunks viejos dejan de existir (el hash cambia). Un usuario
 * con la app abierta que entra a una vista todavía no cargada recibe un
 * "Failed to fetch dynamically imported module": recargamos una sola vez para
 * tomar el bundle nuevo. El flag en sessionStorage evita el loop si la falla es
 * de red y no de deploy.
 */
function onChunkError(error: unknown): never {
  if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem(RELOAD_FLAG)) {
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
    window.location.reload();
  }
  throw error;
}

function clearChunkErrorFlag() {
  try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* modo privado sin storage */ }
}

/**
 * Igual que React.lazy pero para módulos con export nombrado, registrando el
 * loader para poder precargarlo después.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- React.lazy pide ComponentType<any>
export function lazyView<K extends string, M extends { [P in K]: ComponentType<any> }>(
  name: string,
  load: () => Promise<M>,
  exportName: K
) {
  const guarded = (): Promise<M> => load().then(module => { clearChunkErrorFlag(); return module; }, onChunkError);
  loaders.set(name, guarded);
  return lazy(async () => ({ default: (await guarded())[exportName] }));
}

/** Dispara la descarga del chunk de una vista sin renderizarla (hover, foco, etc.). */
export function prefetchView(name: string) {
  void loaders.get(name)?.().catch(() => { /* el prefetch nunca rompe la UI */ });
}

/**
 * Precarga en idle los chunks indicados, de a uno para no pelear ancho de banda
 * con las llamadas a la API del arranque.
 */
export function prefetchViewsWhenIdle(names: string[]) {
  const pending = names.filter(name => loaders.has(name));
  if (!pending.length) return;
  const idle = (callback: () => void) =>
    typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback(() => callback(), { timeout: 2500 })
      : window.setTimeout(callback, 300);

  const next = () => {
    const name = pending.shift();
    if (!name) return;
    void loaders.get(name)?.().catch(() => undefined).finally(() => idle(next));
  };
  idle(next);
}
