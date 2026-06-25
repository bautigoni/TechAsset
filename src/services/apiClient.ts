function headers(extra?: HeadersInit): HeadersInit {
  const siteCode = localStorage.getItem('techasset_active_site') || 'NFPT';
  return { 'X-Site-Code': siteCode, ...(extra || {}) };
}

export function siteHeaders(extra?: HeadersInit): HeadersInit {
  return headers(extra);
}

export async function apiGet<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', headers: headers() });
  const data = await readApiResponse(response);
  if (!response.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${response.status}`);
  return data as T;
}

export async function apiSend<T>(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
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
  if (contentType.includes('application/json')) {
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new Error('El servidor devolvio JSON invalido.');
    }
  }
  const sample = text.replace(/\s+/g, ' ').slice(0, 120);
  throw new Error(response.ok
    ? `La API devolvio una respuesta no JSON (${sample || 'sin contenido'}).`
    : `HTTP ${response.status}: ${sample || response.statusText}`);
}
