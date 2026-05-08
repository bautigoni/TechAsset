import { Router } from 'express';
import { proxyAppsScript } from '../services/appsScript.service.js';
import { addLocalMovement, setLocalState } from '../db.js';
import { invalidateDeviceInventoryCache } from '../services/deviceInventory.service.js';
import { requireSite } from '../services/siteContext.service.js';

export const loansRouter = Router();

loansRouter.post('/loans/lend', async (req, res, next) => {
  try {
    const etiqueta = req.body.etiqueta;
    const siteCode = requireSite(req);
    const payload = {
      ...req.body,
      siteCode,
      estado: 'Prestado',
      prestada: req.body.person || '',
      prestadoA: req.body.person || '',
      persona: req.body.person || '',
      fechaPrestado: new Date().toISOString()
    };
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
      loanedAt: payload.fechaPrestado,
      returnedAt: '',
      siteCode
    });
    invalidateDeviceInventoryCache('loan-lend', siteCode);
    addLocalMovement({ tipo: 'prestamo', descripcion: `${etiqueta} prestada a ${req.body.person || ''}`, operador: req.body.operator, origen: 'Local', etiqueta, siteCode });
    res.json({ ok: true, syncing: true });
    proxyAppsScript('lend', payload, 'POST', { siteCode }).catch(error => console.warn(`[loans/lend sync:${siteCode}]`, error?.message || error));
  } catch (error) {
    next(error);
  }
});

loansRouter.post('/loans/return', async (req, res, next) => {
  try {
    const etiqueta = req.body.etiqueta;
    const siteCode = requireSite(req);
    const payload = {
      ...req.body,
      siteCode,
      estado: 'Devuelto',
      prestada: '',
      prestadoA: '',
      persona: '',
      person: '',
      comment: '',
      role: '',
      location: '',
      reason: '',
      fechaDevuelto: new Date().toISOString()
    };
    setLocalState(etiqueta, {
      estado: 'Disponible',
      prestadoA: '',
      rol: '',
      ubicacion: '',
      motivo: '',
      comentarios: '',
      loanedAt: '',
      returnedAt: payload.fechaDevuelto,
      siteCode
    });
    invalidateDeviceInventoryCache('loan-return', siteCode);
    addLocalMovement({ tipo: 'devolucion', descripcion: `${etiqueta} devuelta`, operador: req.body.operator, origen: 'Local', etiqueta, siteCode });
    res.json({ ok: true, syncing: true });
    proxyAppsScript('return', payload, 'POST', { siteCode }).catch(error => console.warn(`[loans/return sync:${siteCode}]`, error?.message || error));
  } catch (error) {
    next(error);
  }
});
