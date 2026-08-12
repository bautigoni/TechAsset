function headers(extra?: HeadersInit): HeadersInit {
  const siteCode = localStorage.getItem('techasset_active_site') || 'NFPT';
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
  if (!response.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${response.status}`);
  return data as T;
}

export async function apiSend<T>(url: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: headers({ 'Content-Type': 'application/json' }),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await readApiResponse(response);
  if (!response.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${response.status}`);
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
