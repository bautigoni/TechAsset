import { Router } from 'express';
import { addLocalMovement, nowIso, setLocalState } from '../db.js';
import { buildLocalInventory, invalidateDeviceInventoryCache } from '../services/deviceInventory.service.js';
import { requireSite } from '../services/siteContext.service.js';

export const loansRouter = Router();

loansRouter.post('/loans/lend', async (req, res, next) => {
  try {
    const etiqueta = normalizeEtiqueta(req.body.etiqueta);
    const siteCode = requireSite(req);
    if (!etiqueta) return res.status(400).json({ ok: false, error: 'Etiqueta inválida.' });
    const device = currentDevice(siteCode, etiqueta);
    if (!device) return res.status(404).json({ ok: false, error: `No existe el dispositivo ${etiqueta}.` });
    if (!isAvailableState(device.estado)) {
      return res.status(409).json({ ok: false, error: `${deviceLabel(siteCode, etiqueta)} está ${device.estado || 'no disponible'} y no se puede prestar.` });
    }
    const validation = validateLoanPayload(req.body);
    if (validation) return res.status(400).json({ ok: false, error: validation });
    const fechaPrestado = nowIso();
    setLocalState(etiqueta, {
      estado: 'Prestado',
      prestadoA: req.body.person || '',
      rol: req.body.role || '',
      ubicacion: req.body.location || '',
      ubicacionDetalle: req.body.locationDetail || '',
      curso: formatCourse(req.body),
      motivo: req.body.reason || '',
      motivoDetalle: req.body.reasonDetail || '',
      comentarios: req.body.comment || '',
      loanedAt: fechaPrestado,
      returnedAt: '',
      siteCode
    });
    invalidateDeviceInventoryCache('loan-lend', siteCode);
    const label = deviceDisplayLabel(device, etiqueta);
    addLocalMovement({ tipo: 'préstamo', descripcion: `${label} prestada a ${req.body.person || ''}`, operador: req.body.operator, origen: 'Local', etiqueta, siteCode });
    res.json({ ok: true, synced: true, syncing: false, message: 'Préstamo registrado en base local.' });
  } catch (error) {
    next(error);
  }
});

loansRouter.post('/loans/return', async (req, res, next) => {
  try {
    const etiqueta = normalizeEtiqueta(req.body.etiqueta);
    const siteCode = requireSite(req);
    if (!etiqueta) return res.status(400).json({ ok: false, error: 'Etiqueta inválida.' });
    const device = currentDevice(siteCode, etiqueta);
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
    const fechaDevuelto = nowIso();
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
    invalidateDeviceInventoryCache('loan-return', siteCode);
    addLocalMovement({ tipo: 'devolución', descripcion: `${deviceDisplayLabel(device, etiqueta)} devuelta`, operador: req.body.operator, origen: 'Local', etiqueta, siteCode });
    res.json({ ok: true, synced: true, syncing: false, message: 'Devolución registrada en base local.' });
  } catch (error) {
    next(error);
  }
});

function normalizeEtiqueta(value) {
  const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  const number = raw.match(/^D?0*(\d{1,5})$/)?.[1];
  return number ? `D${number.padStart(4, '0')}` : raw;
}

function deviceLabel(siteCode, etiqueta) {
  return deviceDisplayLabel(currentDevice(siteCode, etiqueta), etiqueta);
}

function currentDevice(siteCode, etiqueta) {
  return buildLocalInventory(siteCode).find(item => normalizeEtiqueta(item.etiqueta) === normalizeEtiqueta(etiqueta));
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

function isLoanedState(value) {
  const state = normalizeState(value);
  return state.includes('prest') || state.includes('retir');
}

function isAvailableState(value) {
  const state = normalizeState(value);
  return !state || state.includes('disponible') || state.includes('devuelto') || state.includes('sin revisar');
}

function normalizeState(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
