import { getActiveSiteCode } from './activeSite';

/** Error de la API con el status y el cuerpo, para quien necesite más que el mensaje. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly data: Record<string, unknown> = {}) {
    super(message);
  }
}

export const SESSION_EXPIRED_EVENT = 'techasset:session-expired';

// Un 401 fuera de /api/auth es una sesión vencida o cerrada en otro lado: se
// avisa una vez a la app para que mande al login, en vez de que cada pantalla
// muestre "HTTP 401" por su cuenta.
function checkResponse(url: string, response: Response, data: Record<string, unknown> | undefined) {
  if (response.status === 401 && !url.startsWith('/api/auth/')) {
    clearApiCache();
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  }
  if (!response.ok || data?.ok === false) {
    throw new ApiError(String(data?.error || `HTTP ${response.status}`), response.status, data || {});
  }
}

function headers(extra?: HeadersInit): HeadersInit {
  const siteCode = getActiveSiteCode();
  return { Accept: 'application/json', 'X-Site-Code': siteCode, ...(extra || {}) };
}

export function siteHeaders(extra?: HeadersInit): HeadersInit {
  return headers(extra);
}

// Caché corta de lecturas para volver a una pantalla al instante. Cada vista pide
// sus datos al abrirse y, con red real, volver a una pantalla que se vio hace
// segundos costaba otro viaje al servidor (medido: ~200 ms con 150 ms de red,
// contra ~90 ms sin red). Dentro de GET_CACHE_MS se responde con lo último que
// se vio y en paralelo se revalida, así la visita siguiente ya trae lo nuevo.
// Cualquier escritura propia (apiSend) vacía la caché entera: lo que uno cambió
// se ve siempre al toque. Lo que se pollea o tiene que estar al día no pasa por acá.
const GET_CACHE_MS = 15 * 1000;
const NO_CACHE = /^\/api\/(auth\/|devices(\?|$|\/diagnostics)|movements|notifications|release-notes|push\/)/;
const getCache = new Map<string, { at: number; data: unknown }>();
const getInflight = new Map<string, Promise<unknown>>();
// Cambia con cada escritura: una lectura que salió antes no guarda su resultado.
let generation = 0;

export function clearApiCache() {
  generation += 1;
  getCache.clear();
  getInflight.clear();
}

async function fetchJson<T>(url: string, background = false): Promise<T> {
  // 'no-cache' revalida SIEMPRE contra el servidor (no hay riesgo de dato viejo),
  // pero deja que responda 304 sin cuerpo cuando nada cambió. Con 'no-store' se
  // volvía a bajar el JSON completo en cada poll: ~1 MB por minuto por pestaña.
  // X-Revalidate marca las revalidaciones en segundo plano (la pantalla ya
  // muestra datos): sirve para distinguirlas en logs y en el banco de pruebas.
  const response = await fetch(url, { cache: 'no-cache', headers: headers(background ? { 'X-Revalidate': '1' } : undefined) });
  const data = await readApiResponse(response);
  checkResponse(url, response, data);
  return data as T;
}

export async function apiGet<T>(url: string): Promise<T> {
  if (NO_CACHE.test(url)) return fetchJson<T>(url);
  const key = `${getActiveSiteCode()}|${url}`;
  const load = (background = false) => {
    const pending = getInflight.get(key);
    if (pending) return pending as Promise<T>;
    const started = generation;
    const request = fetchJson<T>(url, background)
      .then(data => {
        if (started === generation) getCache.set(key, { at: Date.now(), data: structuredClone(data) });
        return data;
      })
      .finally(() => getInflight.delete(key));
    getInflight.set(key, request);
    return request;
  };
  const cached = getCache.get(key);
  if (cached && Date.now() - cached.at < GET_CACHE_MS) {
    void load(true).catch(() => undefined);
    // Copia: quien la reciba puede ordenarla o mutarla sin tocar la caché.
    return structuredClone(cached.data) as T;
  }
  return load();
}

export async function apiSend<T>(url: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  clearApiCache();
  const response = await fetch(url, {
    method,
    headers: headers({ 'Content-Type': 'application/json' }),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await readApiResponse(response);
  clearApiCache();
  checkResponse(url, response, data);
  return data as T;
}

async function readApiResponse(response: Response) {
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  if (contentType.toLowerCase().includes('application/json')) {
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`JSON inválido del servidor (${response.status}).`);
    }
  }
  const trimmed = text.trim().toLowerCase();
  if (trimmed.startsWith('<!doctype') || trimmed.startsWith('<html')) {
    throw new Error('El servidor devolvió la app en vez del API. Recargá o tocá Reintentar.');
  }
  const sample = text.replace(/\s+/g, ' ').slice(0, 120);
  throw new Error(response.ok
    ? `La API devolvió una respuesta no JSON (${sample || 'sin contenido'}).`
    : `HTTP ${response.status}: ${sample || response.statusText}`);
}
