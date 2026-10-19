import { Router } from 'express';
import { addLocalMovement, getDb, setLocalState } from '../db.js';
import { buildLocalInventory, invalidateDeviceInventoryCache, isLoanedState } from '../services/deviceInventory.service.js';
import { requireSite } from '../services/siteContext.service.js';

/**
 * Deshacer inmediato de un préstamo o una devolución (la línea de estado
 * "Deshacer" de Préstamos y del Inicio).
 *
 *   POST /api/loans/undo  { etiqueta | etiquetas[], action: 'return' | 'lend' }
 *
 * - action 'return': deshace una devolución. Vuelve a dejar el equipo prestado
 *   con los MISMOS datos del préstamo (persona, rol, ubicación, curso, motivo,
 *   accesorios y la hora original del préstamo, así no pierde antigüedad).
 * - action 'lend': deshace un préstamo recién hecho. El equipo vuelve a quedar
 *   disponible como si no se hubiera prestado.
 *
 * Es un deshacer, no una operación nueva: el evento de `loan_events` que se
 * deshace se borra (si quedara, el recomendador, "Último día con préstamos" y
 * Analítica contarían un préstamo o una devolución que no existieron). Por eso
 * solo vale para el ÚLTIMO evento del equipo y dentro de UNDO_WINDOW_MS; lo que
 * pasó queda auditado en `local_movements` ("Se deshizo la devolución de …").
 *
 * Pasa por requireEditor + requireModuleEditor (prefijo /loans) igual que
 * prestar y devolver, y el hook global de server/index.js invalida el inventario.
 */
export const loansUndoRouter = Router();

const UNDO_WINDOW_MS = 10 * 60 * 1000;

loansUndoRouter.post('/loans/undo', (req, res, next) => {
  try {
    const siteCode = requireSite(req);
    const action = String(req.body?.action || '');
    if (action !== 'return' && action !== 'lend') return res.status(400).json({ ok: false, error: 'Acción inválida: tiene que ser "return" o "lend".' });
    const raw = Array.isArray(req.body?.etiquetas) ? req.body.etiquetas : [req.body?.etiqueta];
    const etiquetas = [...new Set(raw.map(normalizeEtiqueta).filter(Boolean))].slice(0, 300);
    if (!etiquetas.length) return res.status(400).json({ ok: false, error: 'No llegó ningún equipo.' });
    const byTag = new Map(buildLocalInventory(siteCode).map(item => [normalizeEtiqueta(item.etiqueta), item]));
    const results = etiquetas.map(etiqueta => {
      const device = byTag.get(etiqueta);
      if (!device) return { etiqueta, ok: false, error: `No existe el dispositivo ${etiqueta}.` };
      return action === 'return'
        ? undoReturn(siteCode, device, etiqueta, req.body)
        : undoLend(siteCode, device, etiqueta, req.body);
    });
    invalidateDeviceInventoryCache('loan-undo', siteCode);
    const done = results.filter(item => item.ok).length;
    res.json({ ok: true, results, done });
  } catch (error) {
    next(error);
  }
});

function latestEvent(siteCode, etiqueta) {
  return getDb().prepare(`
    SELECT * FROM loan_events
    WHERE site_code=? AND upper(etiqueta)=upper(?)
    ORDER BY timestamp DESC, id DESC
    LIMIT 1
  `).get(siteCode, etiqueta);
}

function tooOld(event) {
  const time = Date.parse(String(event?.timestamp || ''));
  return !Number.isFinite(time) || Date.now() - time > UNDO_WINDOW_MS;
}

function label(device, etiqueta) {
  return device?.aliasOperativo ? `${etiqueta} · ${device.aliasOperativo}` : etiqueta;
}

function undoReturn(siteCode, device, etiqueta, body) {
  const last = latestEvent(siteCode, etiqueta);
  if (!last || last.tipo !== 'devolucion') return { etiqueta, ok: false, error: `${label(device, etiqueta)} no tiene una devolución para deshacer.` };
  if (tooOld(last)) return { etiqueta, ok: false, error: `La devolución de ${label(device, etiqueta)} ya no se puede deshacer.` };
  if (isLoanedState(device.estado)) return { etiqueta, ok: false, error: `${label(device, etiqueta)} ya está prestado otra vez.` };
  // El préstamo que se había cerrado: el de la misma sesión o, si no hay sesión, el anterior.
  const loan = (last.loan_session_id
    ? getDb().prepare(`SELECT * FROM loan_events WHERE site_code=? AND upper(etiqueta)=upper(?) AND tipo='prestamo' AND loan_session_id=? ORDER BY timestamp DESC, id DESC LIMIT 1`).get(siteCode, etiqueta, last.loan_session_id)
    : null)
    || getDb().prepare(`SELECT * FROM loan_events WHERE site_code=? AND upper(etiqueta)=upper(?) AND tipo='prestamo' AND id<? ORDER BY timestamp DESC, id DESC LIMIT 1`).get(siteCode, etiqueta, last.id);
  if (!loan) return { etiqueta, ok: false, error: `No encontré el préstamo original de ${label(device, etiqueta)}.` };
  const tx = getDb().transaction(() => {
    setLocalState(etiqueta, {
      estado: 'Prestado',
      prestadoA: loan.persona || '',
      rol: loan.rol || '',
      ubicacion: loan.ubicacion || '',
      ubicacionDetalle: loan.ubicacion_detalle || '',
      curso: loan.curso || '',
      motivo: loan.motivo || '',
      motivoDetalle: loan.motivo_detalle || '',
      comentarios: loan.comentarios || '',
      loanedAt: loan.timestamp || '',
      returnedAt: '',
      siteCode
    });
    getDb().prepare('DELETE FROM loan_events WHERE id=? AND site_code=?').run(last.id, siteCode);
    addLocalMovement({ tipo: 'deshacer', descripcion: `Se deshizo la devolución de ${label(device, etiqueta)} (vuelve a ${loan.persona || 'quien lo tenía'})`, operador: body.operator, origen: 'Local', etiqueta, siteCode });
  });
  tx();
  return { etiqueta, ok: true, persona: loan.persona || '' };
}

function undoLend(siteCode, device, etiqueta, body) {
  const last = latestEvent(siteCode, etiqueta);
  if (!last || last.tipo !== 'prestamo') return { etiqueta, ok: false, error: `${label(device, etiqueta)} no tiene un préstamo para deshacer.` };
  if (tooOld(last)) return { etiqueta, ok: false, error: `El préstamo de ${label(device, etiqueta)} ya no se puede deshacer.` };
  if (!isLoanedState(device.estado)) return { etiqueta, ok: false, error: `${label(device, etiqueta)} ya no está prestado.` };
  const tx = getDb().transaction(() => {
    setLocalState(etiqueta, {
      estado: 'Disponible',
      prestadoA: '', rol: '', ubicacion: '', ubicacionDetalle: '', curso: '', motivo: '', motivoDetalle: '', comentarios: '',
      loanedAt: '',
      returnedAt: '',
      siteCode
    });
    getDb().prepare('DELETE FROM loan_events WHERE id=? AND site_code=?').run(last.id, siteCode);
    addLocalMovement({ tipo: 'deshacer', descripcion: `Se deshizo el préstamo de ${label(device, etiqueta)} a ${last.persona || 'sin persona'}`, operador: body.operator, origen: 'Local', etiqueta, siteCode });
  });
  tx();
  return { etiqueta, ok: true };
}

function normalizeEtiqueta(value) {
  const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  const number = raw.match(/^D?0*(\d{1,5})$/)?.[1];
  return number ? `D${number.padStart(4, '0')}` : raw;
}
