// Consumo de IA: tope diario por sede y log de tokens/latencia.
// El log nunca lleva contenido (ni pedidos, ni respuestas, ni argumentos).
import { config } from '../../config.js';
import { getDb, nowIso } from '../../db.js';
import { todayLocal } from '../localTime.js';

function siteKey(siteCode) {
  return String(siteCode || config.defaultSiteCode || 'NFPT').toUpperCase();
}

export function aiDailyUsage(siteCode) {
  const row = getDb().prepare('SELECT requests, input_tokens, output_tokens FROM ai_usage_daily WHERE site_code=? AND day=?').get(siteKey(siteCode), todayLocal());
  return { requests: Number(row?.requests || 0), inputTokens: Number(row?.input_tokens || 0), outputTokens: Number(row?.output_tokens || 0), limit: config.aiDailyLimitPerSite };
}

// Reserva una llamada contra el tope diario de la sede. Devuelve false si ya se
// llegó al tope (0 = sin tope). Las llamadas internas (resúmenes de tickets,
// diagnóstico de aulas) cuentan igual que el chat.
export function reserveAiCall(siteCode) {
  const site = siteKey(siteCode);
  const day = todayLocal();
  const limit = config.aiDailyLimitPerSite;
  const db = getDb();
  if (limit > 0) {
    const used = Number(db.prepare('SELECT requests FROM ai_usage_daily WHERE site_code=? AND day=?').get(site, day)?.requests || 0);
    if (used >= limit) return { allowed: false, used, limit };
  }
  db.prepare(`
    INSERT INTO ai_usage_daily (site_code, day, requests, updated_at) VALUES (?, ?, 1, ?)
    ON CONFLICT(site_code, day) DO UPDATE SET requests=ai_usage_daily.requests + 1, updated_at=excluded.updated_at
  `).run(site, day, nowIso());
  return { allowed: true, limit };
}

export function recordAiTokens(siteCode, usage) {
  if (!usage) return;
  const total = (usage.inputTokens || 0) + (usage.outputTokens || 0) + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0);
  if (!total) return;
  try {
    getDb().prepare(`
      UPDATE ai_usage_daily SET input_tokens=input_tokens + ?, output_tokens=output_tokens + ?,
        cache_read_tokens=cache_read_tokens + ?, cache_write_tokens=cache_write_tokens + ?, updated_at=?
      WHERE site_code=? AND day=?
    `).run(usage.inputTokens || 0, usage.outputTokens || 0, usage.cacheReadTokens || 0, usage.cacheWriteTokens || 0, nowIso(), siteKey(siteCode), todayLocal());
  } catch (error) {
    console.warn('[ai] no se pudo registrar el consumo:', error?.message || error);
  }
}

// Una línea por llamada: proveedor, modelo, operación, sede, tokens y tiempos.
export function logAiCall({ op, provider, model, siteCode, usage, ms, firstTokenMs = null, rounds = 1, tools = [], outcome = 'ok' }) {
  const u = usage || {};
  const parts = [
    `[ai] op=${op}`, `provider=${provider}`, `model=${model}`, `site=${siteKey(siteCode)}`, `outcome=${outcome}`,
    `rounds=${rounds}`, `in=${u.inputTokens || 0}`, `out=${u.outputTokens || 0}`,
    `cache_read=${u.cacheReadTokens || 0}`, `cache_write=${u.cacheWriteTokens || 0}`, `ms=${Math.round(ms || 0)}`
  ];
  if (firstTokenMs != null) parts.push(`first_token_ms=${Math.round(firstTokenMs)}`);
  if (tools.length) parts.push(`tools=${tools.join(',')}`);
  console.log(parts.join(' '));
}
