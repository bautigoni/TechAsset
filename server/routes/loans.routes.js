import { Router } from 'express';
import crypto from 'node:crypto';
import { addLocalMovement, addLoanEvent, getDb, nowIso, setLocalState } from '../db.js';
import { buildLocalInventory, getMergedDevices, invalidateDeviceInventoryCache } from '../services/deviceInventory.service.js';
import { requireSite } from '../services/siteContext.service.js';
import { invalidateLoanPeople, searchLoanPeople } from '../services/loanPeople.service.js';
import { findRosterPerson, normalizePersonName, searchRoster } from '../services/peopleRoster.service.js';

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
    registerLend(siteCode, device, etiqueta, req.body);
    invalidateDeviceInventoryCache('loan-lend', siteCode);
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
    const byTag = inventoryByTag(siteCode);
    const results = etiquetas.map(etiqueta => {
      const device = byTag.get(etiqueta);
      if (!device) return { etiqueta, ok: false, error: `No existe el dispositivo ${etiqueta}.` };
      if (!isAvailableState(device.estado)) return { etiqueta, ok: false, error: `${deviceDisplayLabel(device, etiqueta)} está ${device.estado || 'no disponible'}.` };
      registerLend(siteCode, device, etiqueta, req.body);
      return { etiqueta, ok: true };
    });
    invalidateDeviceInventoryCache('loan-lend-batch', siteCode);
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
    const byTag = inventoryByTag(siteCode);
    const results = etiquetas.map(etiqueta => {
      const device = byTag.get(etiqueta);
      if (!device) return { etiqueta, ok: false, error: `No existe el dispositivo ${etiqueta}.` };
      // Igual que la devolución suelta: si ya estaba devuelto no es un error.
      if (!isLoanedState(device.estado)) return { etiqueta, ok: true, idempotent: true };
      registerReturn(siteCode, device, etiqueta, req.body);
      return { etiqueta, ok: true };
    });
    invalidateDeviceInventoryCache('loan-return-batch', siteCode);
    res.json({ ok: true, results, done: results.filter(item => item.ok).length });
  } catch (error) {
    next(error);
  }
});

// "Devolver y prestar": el equipo figura prestado a otra persona (el turno de la
// tarde no lo devolvió y quedó en la oficina) y se pasa directo al receptor
// nuevo. Queda en el historial como dos movimientos, devolución y préstamo, en
// una sola transacción: o se registran los dos o ninguno.
loansRouter.post('/loans/relend', async (req, res, next) => {
  try {
    const etiqueta = normalizeEtiqueta(req.body.etiqueta);
    const siteCode = requireSite(req);
    if (!etiqueta) return res.status(400).json({ ok: false, error: 'Etiqueta inválida.' });
    const device = await currentDevice(siteCode, etiqueta);
    if (!device) return res.status(404).json({ ok: false, error: `No existe el dispositivo ${etiqueta}.` });
    if (!isLoanedState(device.estado)) {
      return res.status(409).json({ ok: false, error: `${deviceDisplayLabel(device, etiqueta)} no figura prestado: usá Prestar.` });
    }
    const validation = validateLoanPayload(req.body);
    if (validation) return res.status(400).json({ ok: false, error: validation });
    const previous = String(device.prestadoA || '').trim();
    const receiver = String(req.body.person || '').trim();
    const db = getDb();
    db.transaction(() => {
      registerReturn(siteCode, device, etiqueta, {
        operator: req.body.operator,
        comment: `Devuelto al pasarlo directo a ${receiver || 'otro receptor'}.`,
        returnedAccessories: req.body.accessories
      });
      registerLend(siteCode, device, etiqueta, req.body);
    })();
    invalidateDeviceInventoryCache('loan-relend', siteCode);
    res.json({
      ok: true,
      synced: true,
      syncing: false,
      message: `${deviceDisplayLabel(device, etiqueta)}: devuelto${previous ? ` por ${previous}` : ''} y prestado a ${receiver || 'sin nombre (ver comentario)'}.`
    });
  } catch (error) {
    next(error);
  }
});

function batchTags(value) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map(normalizeEtiqueta).filter(Boolean))].slice(0, 300);
}

function inventoryByTag(siteCode) {
  return new Map(buildLocalInventory(siteCode).map(item => [normalizeEtiqueta(item.etiqueta), item]));
}

function registerLend(siteCode, device, etiqueta, body) {
  const fechaPrestado = nowIso();
  const loanSessionId = crypto.randomUUID();
  const accessories = normalizeAccessories(body.accessories);
  const person = String(body.person || '').trim();
  setLocalState(etiqueta, {
    estado: 'Prestado',
    // Sin nombre (se prestó sin saber a quién): el comentario dice lo que se sabe.
    prestadoA: person || 'Sin nombre',
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
  invalidateLoanPeople(siteCode);
  const label = deviceDisplayLabel(device, etiqueta);
  addLocalMovement({ tipo: 'préstamo', descripcion: `${label} prestada a ${person || 'sin nombre (ver comentario)'}`, operador: body.operator, origen: 'Local', etiqueta, siteCode });
  addLoanEvent({
    siteCode, tipo: 'prestamo', etiqueta,
    alias: device.aliasOperativo || '', filtro: device.filtro || device.categoria || '',
    persona: body.person || '', rol: body.role || '',
    ubicacion: body.location || '', ubicacionDetalle: body.locationDetail || '',
    curso: formatCourse(body), motivo: body.reason || '', motivoDetalle: body.reasonDetail || '',
    comentarios: body.comment || '', operador: body.operator || '', timestamp: fechaPrestado
    , loanSessionId, accessories
  });
}

function registerReturn(siteCode, device, etiqueta, body) {
  const fechaDevuelto = nowIso();
  const activeLoan = findActiveLoanEvent(siteCode, etiqueta);
  const returnedAccessories = normalizeAccessories(body.returnedAccessories ?? body.accessories);
  const expectedAccessories = parseAccessories(activeLoan?.accessories_json);
  setLocalState(etiqueta, {
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
    registerReturn(siteCode, device, etiqueta, req.body);
    invalidateDeviceInventoryCache('loan-return', siteCode);
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
// motivo/curso más usados y la fecha del último préstamo, y después las de la
// lista de docentes y alumnos de la sede que coinciden por nombre o apellido
// aunque nunca hayan pedido nada. Alimenta el autocompletado del LoanForm.
loansRouter.get('/loans/suggest', (req, res) => {
  const siteCode = requireSite(req);
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ ok: true, suggestions: [] });
  const fromHistory = searchLoanPeople(siteCode, q, 8).map(group => {
    const listed = findRosterPerson(siteCode, group.persona);
    return {
      persona: group.persona,
      count: group.count,
      lastAt: group.lastAt,
      rol: group.rol || rosterRole(listed),
      ubicacion: group.ubicacion,
      curso: group.curso || listed?.curso || '',
      motivo: group.motivo,
      source: 'historial'
    };
  });
  const known = new Set(fromHistory.map(item => normalizePersonName(item.persona)));
  const fromRoster = searchRoster(siteCode, q, { limit: 8 })
    .filter(person => !known.has(normalizePersonName(person.nombre)))
    .map(person => ({
      persona: person.nombre,
      count: 0,
      lastAt: '',
      rol: rosterRole(person),
      ubicacion: '',
      curso: person.curso || '',
      motivo: '',
      source: 'lista'
    }));
  // Primero el historial (lo que más se usa), pero siempre con lugar para la lista.
  const suggestions = [...fromHistory.slice(0, fromRoster.length ? 5 : 8), ...fromRoster].slice(0, 10);
  res.json({ ok: true, suggestions });
});

loansRouter.get('/loans/previous-day', (req, res) => {
  const siteCode = requireSite(req);
  const today = localDateKey(new Date());
  const rows = getDb().prepare(`
    SELECT id, etiqueta, alias, filtro, persona, rol, ubicacion, curso, motivo, operador, accessories_json, timestamp
    FROM loan_events
    WHERE site_code=? AND tipo='prestamo' AND timestamp >= ?
    ORDER BY timestamp DESC, id DESC
  `).all(siteCode, new Date(Date.now() - 21 * 86400000).toISOString());
  // "Ayer" estricto queda vacío después de fines de semana o feriados; se muestra
  // el último día previo a hoy que tuvo préstamos (la fecha viaja en la respuesta).
  const date = rows
    .map(row => localDateKey(row.timestamp))
    .filter(key => key && key < today)
    .reduce((max, key) => (key > max ? key : max), '') || previousLocalDateKey();
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
  res.json({ ok: true, date, items });
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

// Un solo formateador: crearlo por fila costaba ~1,7 s con 10.000 préstamos.
const AR_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Argentina/Buenos_Aires',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '';
  return AR_DAY.format(date);
}

// Rol para la sugerencia que sale de la lista de personas.
function rosterRole(person) {
  if (!person) return '';
  return person.tipo === 'docente' ? 'Docente' : 'Alumno';
}

function normalizeEtiqueta(value) {
  const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  const number = raw.match(/^D?0*(\d{1,5})$/)?.[1];
  return number ? `D${number.padStart(4, '0')}` : raw;
}


// Usa el inventario cacheado de la sede (se invalida con cada escritura de
// equipos/préstamos) en vez de armarlo entero desde la base en cada préstamo.
async function currentDevice(siteCode, etiqueta) {
  const tag = normalizeEtiqueta(etiqueta);
  const { items } = await getMergedDevices({ siteCode });
  return items.find(item => normalizeEtiqueta(item.etiqueta) === tag);
}

function deviceDisplayLabel(device, etiqueta) {
  const tag = normalizeEtiqueta(device?.etiqueta || etiqueta);
  return device?.aliasOperativo ? `${tag} · ${device.aliasOperativo}` : tag;
}

// Ningún campo es obligatorio (pedido de Préstamos: a veces se presta sin saber
// el nombre ni el curso). Solo se exige algo que identifique a quién: la persona
// o un comentario con lo que se sepa. Misma regla que validateLoanFields del front.
function validateLoanPayload(body) {
  if (!String(body.person || '').trim() && !String(body.comment || '').trim()) {
    return 'Anotá la persona o, si no la sabés, un comentario con lo que sepas (curso, cómo es, etc.).';
  }
  return '';
}

function formatCourse(body) {
  return [body.schoolLevel, body.course]
    .map(value => String(value || '').trim())
    .filter(value => value && value !== 'Seleccionar nivel' && value !== 'Seleccionar curso')
    .join(' · ');
}

function isLoanedState(value) {
  const state = normalizeState(value);
  return state.includes('prest') || state.includes('retir');
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
