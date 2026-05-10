import { Router } from 'express';
import { addLocalMovement, nowIso, setLocalState } from '../db.js';
import { buildLocalInventory, invalidateDeviceInventoryCache } from '../services/deviceInventory.service.js';
import { requireSite } from '../services/siteContext.service.js';

export const loansRouter = Router();

loansRouter.post('/loans/lend', async (req, res, next) => {
  try {
    const etiqueta = normalizeEtiqueta(req.body.etiqueta);
    const siteCode = requireSite(req);
    const fechaPrestado = nowIso();
    setLocalState(etiqueta, {
      estado: 'Prestado',
      prestadoA: req.body.person || '',
      rol: req.body.role || '',
      ubicacion: req.body.location || '',
      ubicacionDetalle: req.body.locationDetail || '',
      curso: req.body.course || '',
      motivo: req.body.reason || '',
      motivoDetalle: req.body.reasonDetail || '',
      comentarios: req.body.comment || '',
      loanedAt: fechaPrestado,
      returnedAt: '',
      siteCode
    });
    invalidateDeviceInventoryCache('loan-lend', siteCode);
    const label = deviceLabel(siteCode, etiqueta);
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
    const fechaDevuelto = nowIso();
    setLocalState(etiqueta, {
      estado: 'Disponible',
      prestadoA: '',
      rol: '',
      ubicacion: '',
      motivo: '',
      comentarios: '',
      loanedAt: '',
      returnedAt: fechaDevuelto,
      siteCode
    });
    invalidateDeviceInventoryCache('loan-return', siteCode);
    addLocalMovement({ tipo: 'devolución', descripcion: `${deviceLabel(siteCode, etiqueta)} devuelta`, operador: req.body.operator, origen: 'Local', etiqueta, siteCode });
    res.json({ ok: true, synced: true, syncing: false, message: 'Devolución registrada en base local.' });
  } catch (error) {
    next(error);
  }
});

function normalizeEtiqueta(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function deviceLabel(siteCode, etiqueta) {
  const device = buildLocalInventory(siteCode).find(item => normalizeEtiqueta(item.etiqueta) === normalizeEtiqueta(etiqueta));
  return device?.aliasOperativo ? `${etiqueta} · ${device.aliasOperativo}` : etiqueta;
}
