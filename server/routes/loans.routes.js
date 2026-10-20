import { Router } from 'express';
import crypto from 'node:crypto';
import { addLocalMovement, addLoanEvent, getDb, getLoanEventsVersion, nowIso, setLocalState } from '../db.js';
import { getLoanPeople, searchLoanPeople } from '../services/loanPeople.service.js';
import { sendWithEtag } from '../services/etag.service.js';
import { getCurrentInventory, isLoanedState, patchInventoryState } from '../services/deviceInventory.service.js';
import { requireSite } from '../services/siteContext.service.js';

export const loansRouter = Router();

loansRouter.post('/loans/lend', async (req, res, next) => {
  try {
    const etiqueta = normalizeEtiqueta(req.body.etiqueta);
    const siteCode = requireSite(req);
    if (!etiqueta) return res.status(400).json({ ok: false, error: 'Etiqueta inválida.' });
    const device = await currentDevice(siteCode, etiqueta);
    if (!device) return res.status(404).json({ ok: false, error: `No existe el dispositivo ${etiqueta}.` });
    if (!isAvailableState(device.estado)) {
      return res.status(409).json({ ok: false, error: `${deviceDisplayLabel(device, etiqueta)} está ${device.estado || 'no disponible'} y no se puede prestar.` });
    }
    const validation = validateLoanPayload(req.body);
    if (validation) return res.status(400).json({ ok: false, error: validation });
    const state = registerLend(siteCode, device, etiqueta, req.body);
    // El inventario cacheado se actualiza solo en este equipo (sin rearmarlo).
    res.locals.inventoryPatched = patchInventoryState(siteCode, state, 'loan-lend');
    res.json({ ok: true, synced: true, syncing: false, message: 'Préstamo registrado en base local.' });
  } catch (error) {
    next(error);
  }
});

// Préstamo y devolución en lote (selección múltiple de Préstamos). Antes el
// front mandaba un request por equipo y después de cada uno recargaba el
// inventario entero; acá el inventario se arma una vez y se invalida una vez.
// Cada equipo se resuelve por separado: uno que falla no frena al resto.
loansRouter.post('/loans/lend-batch', async (req, res, next) => {
  try {
    const siteCode = requireSite(req);
    const etiquetas = batchTags(req.body?.etiquetas);
    if (!etiquetas.length) return res.status(400).json({ ok: false, error: 'No llegó ningún equipo.' });
    const validation = validateLoanPayload(req.body);
    if (validation) return res.status(400).json({ ok: false, error: validation });
    const byTag = await inventoryByTag(siteCode);
    const states = [];
    const results = etiquetas.map(etiqueta => {
      const device = byTag.get(etiqueta);
      if (!device) return { etiqueta, ok: false, error: `No existe el dispositivo ${etiqueta}.` };
      if (!isAvailableState(device.estado)) return { etiqueta, ok: false, error: `${deviceDisplayLabel(device, etiqueta)} está ${device.estado || 'no disponible'}.` };
      states.push(registerLend(siteCode, device, etiqueta, req.body));
      return { etiqueta, ok: true };
    });
    res.locals.inventoryPatched = patchStates(siteCode, states, 'loan-lend-batch');
    res.json({ ok: true, results, done: results.filter(item => item.ok).length });
  } catch (error) {
    next(error);
  }
});

loansRouter.post('/loans/return-batch', async (req, res, next) => {
  try {
    const siteCode = requireSite(req);
    const etiquetas = batchTags(req.body?.etiquetas);
    if (!etiquetas.length) return res.status(400).json({ ok: false, error: 'No llegó ningún equipo.' });
    const byTag = await inventoryByTag(siteCode);
    const states = [];
    const results = etiquetas.map(etiqueta => {
      const device = byTag.get(etiqueta);
      if (!device) return { etiqueta, ok: false, error: `No existe el dispositivo ${etiqueta}.` };
      // Igual que la devolución suelta: si ya estaba devuelto no es un error.
      if (!isLoanedState(device.estado)) return { etiqueta, ok: true, idempotent: true };
      states.push(registerReturn(siteCode, device, etiqueta, req.body));
      return { etiqueta, ok: true };
    });
    res.locals.inventoryPatched = patchStates(siteCode, states, 'loan-return-batch');
    res.json({ ok: true, results, done: results.filter(item => item.ok).length });
  } catch (error) {
    next(error);
  }
});

function batchTags(value) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map(normalizeEtiqueta).filter(Boolean))].slice(0, 300);
}

async function inventoryByTag(siteCode) {
  return new Map((await getCurrentInventory(siteCode)).map(item => [normalizeEtiqueta(item.etiqueta), item]));
}

/** Parcha el inventario cacheado equipo por equipo; si alguno no se pudo, ya quedó invalidado. */
function patchStates(siteCode, states, reason) {
  let patched = true;
  for (const state of states) if (!patchInventoryState(siteCode, state, reason)) patched = false;
  if (!states.length) return true;
  return patched;
}

function registerLend(siteCode, device, etiqueta, body) {
  const fechaPrestado = nowIso();
  const loanSessionId = crypto.randomUUID();
  const accessories = normalizeAccessories(body.accessories);
  const state = setLocalState(etiqueta, {
    estado: 'Prestado',
    prestadoA: body.person || '',
    rol: body.role || '',
    ubicacion: body.location || '',
    ubicacionDetalle: body.locationDetail || '',
    curso: formatCourse(body),
    motivo: body.reason || '',
    motivoDetalle: body.reasonDetail || '',
    comentarios: body.comment || '',
    loanedAt: fechaPrestado,
    returnedAt: '',
    siteCode
  });
  const label = deviceDisplayLabel(device, etiqueta);
  addLocalMovement({ tipo: 'préstamo', descripcion: `${label} prestada a ${body.person || ''}`, operador: body.operator, origen: 'Local', etiqueta, siteCode });
  addLoanEvent({
    siteCode, tipo: 'prestamo', etiqueta,
    alias: device.aliasOperativo || '', filtro: device.filtro || device.categoria || '',
    persona: body.person || '', rol: body.role || '',
    ubicacion: body.location || '', ubicacionDetalle: body.locationDetail || '',
    curso: formatCourse(body), motivo: body.reason || '', motivoDetalle: body.reasonDetail || '',
    comentarios: body.comment || '', operador: body.operator || '', timestamp: fechaPrestado
    , loanSessionId, accessories
  });
  return state;
}

function registerReturn(siteCode, device, etiqueta, body) {
  const fechaDevuelto = nowIso();
  const activeLoan = findActiveLoanEvent(siteCode, etiqueta);
  const returnedAccessories = normalizeAccessories(body.returnedAccessories ?? body.accessories);
  const expectedAccessories = parseAccessories(activeLoan?.accessories_json);
  const state = setLocalState(etiqueta, {
    estado: 'Disponible',
    prestadoA: '',
    rol: '',
    ubicacion: '',
    ubicacionDetalle: '',
    curso: '',
    motivo: '',
    motivoDetalle: '',
    comentarios: '',
    loanedAt: '',
    returnedAt: fechaDevuelto,
    siteCode
  });
  addLocalMovement({ tipo: 'devolución', descripcion: `${deviceDisplayLabel(device, etiqueta)} devuelta`, operador: body.operator, origen: 'Local', etiqueta, siteCode });
  // device se capturó antes de limpiar local_states, así que conserva los datos del préstamo.
  addLoanEvent({
    siteCode, tipo: 'devolucion', etiqueta,
    alias: device.aliasOperativo || '', filtro: device.filtro || device.categoria || '',
    persona: device.prestadoA || '', rol: device.rol || '',
    ubicacion: device.ubicacion || '', motivo: device.motivo || '',
    comentarios: body.comment || '', operador: body.operator || '', timestamp: fechaDevuelto
    , loanSessionId: activeLoan?.loan_session_id || '', accessories: returnedAccessories, expectedAccessories
  });
  return state;
}

loansRouter.post('/loans/return', async (req, res, next) => {
  try {
    const etiqueta = normalizeEtiqueta(req.body.etiqueta);
    const siteCode = requireSite(req);
    if (!etiqueta) return res.status(400).json({ ok: false, error: 'Etiqueta inválida.' });
    const device = await currentDevice(siteCode, etiqueta);
    if (!device) return res.status(404).json({ ok: false, error: `No existe el dispositivo ${etiqueta}.` });
    if (!isLoanedState(device.estado)) {
      return res.json({
        ok: true,
        synced: true,
        syncing: false,
        idempotent: true,
        message: `${deviceDisplayLabel(device, etiqueta)} ya estaba ${isAvailableState(device.estado) ? 'disponible' : device.estado || 'no disponible'}. No se registró otra devolución.`
      });
    }
    const state = registerReturn(siteCode, device, etiqueta, req.body);
    res.locals.inventoryPatched = patchInventoryState(siteCode, state, 'loan-return');
    res.json({ ok: true, synced: true, syncing: false, message: 'Devolución registrada en base local.' });
  } catch (error) {
    next(error);
  }
});

loansRouter.get('/loans/:etiqueta/accessories', (req, res) => {
  const siteCode = requireSite(req);
  const etiqueta = normalizeEtiqueta(req.params.etiqueta);
  if (!etiqueta) return res.status(400).json({ ok: false, error: 'Etiqueta inválida.' });
  const event = findActiveLoanEvent(siteCode, etiqueta);
  res.json({
    ok: true,
    loanSessionId: event?.loan_session_id || '',
    accessories: parseAccessories(event?.accessories_json),
    registered: Boolean(event)
  });
});

// Recomendador: sugiere personas conocidas (match flexible) con su rol/ubicación/
// motivo/curso más usados y la fecha del último préstamo. Sale del directorio
// en memoria (services/loanPeople.service.js): 0 consultas por pedido.
loansRouter.get('/loans/suggest', (req, res) => {
  const siteCode = requireSite(req);
  const suggestions = searchLoanPeople(getLoanPeople(siteCode), req.query.q, 8).map(({ key, ...person }) => person);
  res.json({ ok: true, suggestions });
});

// Directorio completo de personas de la sede (mismo formato que /loans/suggest,
// más `key` = nombre normalizado). El front lo baja una vez al abrir el
// formulario y filtra localmente en cada tecla: sugerencias sin esperar la red.
// ETag sobre la versión de loan_events: si no cambió, 304 sin cuerpo.
loansRouter.get('/loans/people', (req, res) => {
  const siteCode = requireSite(req);
  const people = getLoanPeople(siteCode);
  sendWithEtag(req, res, { ok: true, people }, `${siteCode}:${getLoanEventsVersion()}:${people.length}:${people[0]?.lastAt || ''}`);
});

// Préstamos del último día con préstamos antes de hoy. Antes leía TODOS los
// préstamos de la sede en cada pedido (miles de filas por la red en producción);
// ahora busca ese día con una consulta indexada (site_code, timestamp) y trae
// solo sus filas, y el resultado queda en memoria hasta que cambie loan_events
// o el día.
const previousDayCache = new Map(); // site -> { key, payload }
loansRouter.get('/loans/previous-day', (req, res) => {
  const siteCode = requireSite(req);
  const today = localDateKey(new Date());
  const cacheKey = `${today}|${getLoanEventsVersion()}`;
  const hit = previousDayCache.get(siteCode);
  if (hit && hit.key === cacheKey) return res.json(hit.payload);
  const db = getDb();
  // Inicio de hoy en Argentina (UTC−3, sin horario de verano) como ISO UTC: los timestamps se guardan en ISO.
  const startOfToday = new Date(`${today}T00:00:00-03:00`).toISOString();
  const latest = db.prepare(`
    SELECT timestamp FROM loan_events
    WHERE site_code=? AND tipo='prestamo' AND timestamp < ?
    ORDER BY timestamp DESC LIMIT 1
  `).get(siteCode, startOfToday);
  const date = (latest && localDateKey(latest.timestamp)) || previousLocalDateKey();
  const dayStart = new Date(`${date}T00:00:00-03:00`);
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  const rows = db.prepare(`
    SELECT id, etiqueta, alias, filtro, persona, rol, ubicacion, curso, motivo, operador, accessories_json, timestamp
    FROM loan_events
    WHERE site_code=? AND tipo='prestamo' AND timestamp >= ? AND timestamp < ?
    ORDER BY timestamp DESC, id DESC
  `).all(siteCode, dayStart.toISOString(), dayEnd.toISOString());
  const items = rows
    .filter(row => localDateKey(row.timestamp) === date)
    .map(row => ({
      id: row.id,
      etiqueta: row.etiqueta || '',
      alias: row.alias || '',
      filtro: row.filtro || '',
      persona: row.persona || '',
      rol: row.rol || '',
      ubicacion: row.ubicacion || '',
      curso: row.curso || '',
      motivo: row.motivo || '',
      operador: row.operador || '',
      accessories: parseAccessories(row.accessories_json),
      timestamp: row.timestamp || ''
    }));
  const payload = { ok: true, date, items };
  previousDayCache.set(siteCode, { key: cacheKey, payload });
  res.json(payload);
});

function findActiveLoanEvent(siteCode, etiqueta) {
  const latest = getDb().prepare(`
    SELECT id, tipo, loan_session_id, accessories_json, timestamp
    FROM loan_events
    WHERE site_code=? AND upper(etiqueta)=upper(?)
    ORDER BY timestamp DESC, id DESC
    LIMIT 1
  `).get(siteCode, etiqueta);
  return latest?.tipo === 'prestamo' ? latest : null;
}

function normalizeAccessories(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))].slice(0, 30);
}

function parseAccessories(value) {
  try { return normalizeAccessories(JSON.parse(String(value || '[]'))); } catch { return []; }
}

function previousLocalDateKey() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return localDateKey(date);
}

function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function normalizeEtiqueta(value) {
  const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  const number = raw.match(/^D?0*(\d{1,5})$/)?.[1];
  return number ? `D${number.padStart(4, '0')}` : raw;
}

// Del inventario cacheado (0 consultas si está vigente; antes se rearmaba
// entero, 3 consultas y ~400 JSON.parse, para buscar un equipo).
async function currentDevice(siteCode, etiqueta) {
  return (await getCurrentInventory(siteCode)).find(item => normalizeEtiqueta(item.etiqueta) === normalizeEtiqueta(etiqueta));
}

function deviceDisplayLabel(device, etiqueta) {
  const tag = normalizeEtiqueta(device?.etiqueta || etiqueta);
  return device?.aliasOperativo ? `${tag} · ${device.aliasOperativo}` : tag;
}

function validateLoanPayload(body) {
  if (!String(body.person || '').trim()) return 'Completá la persona que recibe el equipo.';
  if (isPlaceholder(body.role, 'Seleccionar rol')) return 'Seleccioná un rol.';
  if (isPlaceholder(body.location, 'Seleccionar ubicación')) return 'Seleccioná una ubicación.';
  if (String(body.location || '').trim().toLowerCase() === 'aula' && isPlaceholder(body.schoolLevel, 'Seleccionar nivel')) return 'Seleccioná si es EP o ES.';
  if (String(body.location || '').trim().toLowerCase() === 'aula' && isPlaceholder(body.course, 'Seleccionar curso')) return 'Seleccioná grado, año o curso.';
  return '';
}

function formatCourse(body) {
  return [body.schoolLevel, body.course]
    .map(value => String(value || '').trim())
    .filter(value => value && value !== 'Seleccionar nivel' && value !== 'Seleccionar curso')
    .join(' · ');
}

function isPlaceholder(value, placeholder) {
  const clean = String(value || '').trim();
  return !clean || clean.toLowerCase() === placeholder.toLowerCase();
}

// Misma regla que getLoanState en src/utils/deviceState.ts: si cambia una, cambiar la otra.
function isAvailableState(value) {
  const state = normalizeState(value);
  if (state.includes('prest') || state.includes('retir')) return false;
  // "No disponible" contiene "disponible": antes se podía prestar.
  if (state.includes('no disponible')) return false;
  return !state || state.includes('disponible') || state.includes('devuelto') || state.includes('sin revisar');
}

function normalizeState(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
