import { useState } from 'react';
import type { Device } from '../../types';
import type { LoanBatchResponse } from '../../services/loansApi';
import { deleteDevice, restoreDevice, updateDeviceStatus } from '../../services/devicesApi';
import { getLoanState } from '../../utils/deviceState';
import { Button } from '../layout/Button';
import { SelectionBar } from '../layout/Selection';
import { confirmDialog, errorMessage, promptDialog, toast } from '../layout/Feedback';

const STATES = ['Disponible', 'Fuera de servicio', 'En reparación', 'No encontrada', 'Sin revisar'];

/**
 * Acciones sobre varios equipos marcados en la tabla de Dispositivos: prestar
 * (los manda a la lista de Préstamos), devolver, cambiar estado y borrar (con
 * "Deshacer"). Cada acción toma solo los equipos para los que tiene sentido.
 */
export function DeviceBulkBar({ selectedDevices, operator, onClear, onLoanBatch, onReturnBatch, onChanged }: {
  selectedDevices: Device[];
  operator: string;
  onClear: () => void;
  onLoanBatch?: (etiquetas: string[]) => void;
  onReturnBatch?: (etiquetas: string[]) => Promise<LoanBatchResponse>;
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const toLend = selectedDevices.filter(device => getLoanState(device.estado) === 'available');
  const toReturn = selectedDevices.filter(device => getLoanState(device.estado) === 'loaned');
  // Cambiar estado a mano sobre un prestado le borraría el préstamo sin
  // registrar la devolución: esos se devuelven con su botón.
  const notLoaned = selectedDevices.filter(device => getLoanState(device.estado) !== 'loaned');

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (reason) {
      toast({ message: errorMessage(reason), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const returnAll = () => run(async () => {
    if (!onReturnBatch) return;
    if (!(await confirmDialog({ title: `Devolver ${toReturn.length} equipos`, message: toReturn.map(device => device.etiqueta).join(', '), confirmLabel: 'Devolver' }))) return;
    const response = await onReturnBatch(toReturn.map(device => device.etiqueta));
    const failed = response.results.filter(item => !item.ok);
    toast(failed.length
      ? { message: `Se devolvieron ${response.done} de ${toReturn.length}. ${failed.map(item => `${item.etiqueta}: ${item.error}`).join('; ')}`, tone: 'warn' }
      : { message: `Se devolvieron ${response.done} equipos.`, tone: 'ok' });
    onClear();
  });

  const changeState = () => run(async () => {
    const estado = await promptDialog({
      title: `Cambiar estado de ${notLoaned.length} equipos`,
      message: toReturn.length ? `Los ${toReturn.length} prestados no se tocan: devolvelos primero.` : undefined,
      label: 'Nuevo estado',
      options: STATES,
      confirmLabel: 'Cambiar'
    });
    if (!estado) return;
    const failed: string[] = [];
    for (const device of notLoaned) {
      try {
        await updateDeviceStatus({ etiqueta: device.etiqueta, estado, operator });
      } catch (reason) {
        failed.push(`${device.etiqueta}: ${errorMessage(reason, 'error')}`);
      }
    }
    await onChanged();
    toast(failed.length
      ? { message: `Cambiaron ${notLoaned.length - failed.length} de ${notLoaned.length}. ${failed.join('; ')}`, tone: 'warn' }
      : { message: `${notLoaned.length} equipos ahora están "${estado}".`, tone: 'ok' });
    onClear();
  });

  const removeAll = () => run(async () => {
    if (!(await confirmDialog({ title: `Borrar ${selectedDevices.length} equipos`, message: 'Se ocultan de la app sin borrar su historial. Se pueden restaurar desde la papelera.', confirmLabel: 'Borrar', danger: true }))) return;
    const removed: string[] = [];
    for (const device of selectedDevices) {
      try {
        await deleteDevice(device.etiqueta, operator);
        removed.push(device.etiqueta);
      } catch (reason) {
        toast({ message: `${device.etiqueta}: ${errorMessage(reason, 'no se pudo borrar')}`, tone: 'error' });
      }
    }
    await onChanged();
    onClear();
    toast({
      message: `${removed.length} equipos se movieron a la papelera.`,
      action: {
        label: 'Deshacer',
        onClick: async () => {
          // Antes los errores se tragaban y avisaba "restaurados" igual.
          const failed: string[] = [];
          for (const etiqueta of removed) {
            try {
              await restoreDevice(etiqueta);
            } catch (reason) {
              failed.push(`${etiqueta}: ${errorMessage(reason, 'no se pudo restaurar')}`);
            }
          }
          await onChanged();
          toast(failed.length
            ? { message: `Se restauraron ${removed.length - failed.length} de ${removed.length}. ${failed.join('; ')}`, tone: 'error' }
            : { message: `${removed.length} equipos restaurados.`, tone: 'ok' });
        }
      }
    });
  });

  return (
    <SelectionBar count={selectedDevices.length} onClear={onClear} floating>
      {onLoanBatch && toLend.length > 0 && <Button variant="primary" disabled={busy} onClick={() => onLoanBatch(toLend.map(device => device.etiqueta))}>Prestar {toLend.length}</Button>}
      {onReturnBatch && toReturn.length > 0 && <Button variant="success" disabled={busy} onClick={() => void returnAll()}>Devolver {toReturn.length}</Button>}
      {notLoaned.length > 0 && <Button disabled={busy} onClick={() => void changeState()}>Cambiar estado</Button>}
      <Button variant="danger" disabled={busy} onClick={() => void removeAll()}>Borrar</Button>
    </SelectionBar>
  );
}
