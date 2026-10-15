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

export async function apiGet<T>(url: string): Promise<T> {
  // 'no-cache' revalida SIEMPRE contra el servidor (no hay riesgo de dato viejo),
  // pero deja que responda 304 sin cuerpo cuando nada cambió. Con 'no-store' se
  // volvía a bajar el JSON completo en cada poll: ~1 MB por minuto por pestaña.
  const response = await fetch(url, { cache: 'no-cache', headers: headers() });
  const data = await readApiResponse(response);
  checkResponse(url, response, data);
  return data as T;
}

export async function apiSend<T>(url: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: headers({ 'Content-Type': 'application/json' }),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await readApiResponse(response);
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
