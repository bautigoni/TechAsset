import { config } from '../config.js';

export async function proxyAppsScript(action, payload = {}, method = 'POST') {
  if (!config.appsScriptUrl) {
    return { ok: true, skipped: true, message: 'APPS_SCRIPT_URL no configurado.' };
  }
  const url = new URL(config.appsScriptUrl);
  if (action) url.searchParams.set('action', action);
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(Math.max(1000, Number(config.sheetFetchTimeoutMs || 4500)))
  });
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: response.ok, raw: text };
  }
}
