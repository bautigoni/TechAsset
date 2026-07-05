import { getDb } from '../../db.js';
import { getMergedDevices } from '../deviceInventory.service.js';
import { config } from '../../config.js';
import { sameCode, normalizeCode } from './utils.js';

export async function deviceAnswer(text, siteCode) {
  const code = extractDeviceFromText(text);
  if (!code) return ask('Decime el código del dispositivo y lo busco.', 'device_query');
  const { items } = await getMergedDevices({ siteCode });
  const device = items.find(item => sameCode(item.etiqueta, code));
  if (!device) return response(`No encontré el dispositivo ${code} en el inventario real.`, 'device_query');
  const active = getActiveLoan(code, siteCode);
  const reply = active
    ? `${code} figura prestado a ${active.usuario_nombre}. Ubicación: ${active.sede || '-'}. Motivo: ${active.observaciones_entrega || '-'}.`
    : `${code} figura como ${device.estado || 'Disponible'}. Modelo: ${device.marca || ''} ${device.modelo || ''}. SN: ${device.sn || '-'}. MAC: ${device.mac || '-'}.`;
  return response(reply, 'device_query', { device, activeLoan: active });
}

export async function dataAwareAnswer(text, memory, access) {
  if (!config.openaiApiKey || !text) return null;
  try {
    const { dataChat } = await import('../assistantData.service.js');
    const { reply, navigation, items } = await dataChat({ text, history: memory.messages, access: { ...access, siteCode: memory.siteCode } });
    return response(reply, 'data_query', { navigation: navigation || null, items: items || undefined });
  } catch (error) {
    console.warn(`[assistant] dataChat fallback: ${error?.message || 'unknown'}`);
    return null;
  }
}

function getActiveLoan(code, siteCode) {
  return getDb().prepare("SELECT * FROM prestamos WHERE site_code=? AND upper(codigo_dispositivo)=upper(?) AND estado IN ('activo','vencido')").get(siteCode, normalizeCode(code));
}

function extractDeviceFromText(text) {
  const raw = String(text || '').match(/\bD\s*0*\d{1,5}\b/i)?.[0]?.replace(/\s+/g, '');
  return raw ? normalizeCode(raw) : '';
}

function response(reply, intent, data = {}) {
  return { reply, intent, needsConfirmation: false, pendingAction: null, suggestedActions: [], data };
}

function ask(reply, intent) {
  return { reply, intent, needsConfirmation: false, pendingAction: null, suggestedActions: [], data: {} };
}
