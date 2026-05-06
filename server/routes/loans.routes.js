import { Router } from 'express';
import { proxyAppsScript } from '../services/appsScript.service.js';
import { addLocalMovement, setLocalState } from '../db.js';
import { invalidateDeviceInventoryCache } from '../services/deviceInventory.service.js';

export const loansRouter = Router();

loansRouter.post('/loans/lend', async (req, res, next) => {
  try {
    const etiqueta = req.body.etiqueta;
    const payload = {
      ...req.body,
      estado: 'Prestado',
      fechaPrestado: new Date().toISOString()
    };
    setLocalState(etiqueta, {
      estado: 'Prestado',
      prestadoA: req.body.person || '',
      rol: req.body.role || '',
      ubicacion: req.body.location || '',
      motivo: req.body.reason || '',
      comentarios: req.body.comment || '',
      loanedAt: payload.fechaPrestado,
      returnedAt: ''
    });
    invalidateDeviceInventoryCache('loan-lend');
    addLocalMovement({ tipo: 'préstamo', descripcion: `${etiqueta} prestada a ${req.body.person || ''}`, operador: req.body.operator, origen: 'Local', etiqueta });
    res.json({ ok: true, syncing: true });
    proxyAppsScript('lend', payload).catch(error => console.warn('[loans/lend sync]', error?.message || error));
  } catch (error) {
    next(error);
  }
});

loansRouter.post('/loans/return', async (req, res, next) => {
  try {
    const etiqueta = req.body.etiqueta;
    const payload = {
      ...req.body,
      estado: 'Devuelto',
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
      returnedAt: payload.fechaDevuelto
    });
    invalidateDeviceInventoryCache('loan-return');
    addLocalMovement({ tipo: 'devolución', descripcion: `${etiqueta} devuelta`, operador: req.body.operator, origen: 'Local', etiqueta });
    res.json({ ok: true, syncing: true });
    proxyAppsScript('return', payload).catch(error => console.warn('[loans/return sync]', error?.message || error));
  } catch (error) {
    next(error);
  }
});
