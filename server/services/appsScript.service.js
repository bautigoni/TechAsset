import { config } from '../config.js';
import { getDb } from '../db.js';
import { normalizeSiteCode } from './siteContext.service.js';

export function getAppsScriptUrlForSite(siteCode) {
  const normalized = normalizeSiteCode(siteCode);
  const row = getDb().prepare('SELECT apps_script_url FROM sites WHERE site_code=?').get(normalized);
  return String(row?.apps_script_url || config.appsScriptUrl || '').trim();
}

export async function proxyAppsScript(action, payload = {}, method = 'POST', options = {}) {
  const targetUrl = String(options.url || getAppsScriptUrlForSite(options.siteCode || payload?.siteCode) || '').trim();
  if (!targetUrl) {
    return { ok: true, skipped: true, message: 'APPS_SCRIPT_URL no configurado.' };
  }
  const url = new URL(targetUrl);
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
