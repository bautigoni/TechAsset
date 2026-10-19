import { useState, type FormEvent, type ReactNode } from 'react';
import type { Device } from '../../types';
import { Button, IconButton, Input, icons, useStatusLine } from '../../ui';
import { downloadDevicesCsv, importDevicesFromCsv } from '../../services/devicesApi';
import { errorMessage } from '../layout/Feedback';
import { printDeviceQrs } from './qrPrint';

/** Panel en línea (empuja la lista): título, aclaración y cerrar. */
export function DevicePanel({ title, note, onClose, children, label }: { title: string; note?: ReactNode; onClose: () => void; children: ReactNode; label?: string }) {
  return (
    <section
      className="dv-panel"
      aria-label={label || title}
      data-scanner-ignore=""
      onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.stopPropagation(); onClose(); } }}
    >
      <div className="dv-panel-head">
        <h3 className="dv-h3 dv-nowrap">{title}</h3>
        {note && <span className="dv-muted dv-panel-note">{note}</span>}
        <IconButton label={`Cerrar ${title.toLowerCase()}`} icon={<icons.IconX size={16} />} onClick={onClose} />
      </div>
      {children}
    </section>
  );
}

/** Importar CSV publicado: URL opcional (vacía = la planilla de la sede). */
export function ImportPanel({ operator, onImported, onClose }: { operator: string; onImported: () => Promise<unknown> | void; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const status = useStatusLine();

  const run = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    status.show({ tone: 'info', message: 'Importando dispositivos a la base…', autoHideMs: 0 });
    try {
      const { summary } = await importDevicesFromCsv({ csvUrl: url.trim(), operator });
      status.show({
        tone: summary.errors ? 'warn' : 'ok',
        autoHideMs: 0,
        message: <>Importación terminada: <span className="ui-mono">{summary.read} leídos · {summary.created} nuevos · {summary.updated} actualizados · {summary.reactivated || 0} reactivados · {summary.skipped} omitidos · {summary.errors} errores</span>{summary.errorDetails?.length ? ` (${summary.errorDetails.slice(0, 3).join('; ')})` : ''}</>
      });
      await onImported();
    } catch (reason) {
      status.show({ tone: 'bad', message: errorMessage(reason, 'No se pudo importar el CSV.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DevicePanel title="Importar desde un CSV publicado" label="Importar CSV" onClose={onClose}>
      <form className="dv-panel-row" onSubmit={run}>
        <Input
          label="URL del CSV (opcional)"
          className="dv-grow dv-mono-field"
          value={url}
          onValueChange={setUrl}
          placeholder="Vacío = la planilla publicada de la sede"
          inputMode="url"
          autoComplete="off"
          autoFocus
        />
        <Button type="submit" variant="primary" loading={busy} loadingLabel="Importando…">Importar</Button>
      </form>
      <p className="dv-muted">Actualiza por etiqueta, agrega los nuevos y reactiva los que estén en la papelera. No borra nada.</p>
      {status.element}
    </DevicePanel>
  );
}

const EXPORTS = [
  { key: 'inventory', title: 'Inventario', sub: 'Todos los equipos de la sede, 20 columnas', path: '/api/devices/export/inventory.csv', file: 'techasset_inventario.csv' },
  { key: 'summary', title: 'Resumen', sub: 'Cantidad por filtro y estado', path: '/api/devices/export/summary.csv', file: 'techasset_resumen.csv' },
  { key: 'movements', title: 'Movimientos', sub: 'Todo lo registrado en la sede', path: '/api/movements/export.csv', file: 'techasset_movimientos.csv' },
  { key: 'loans', title: 'Préstamos activos', sub: 'Quién tiene qué ahora', path: '/api/loans/export/active.csv', file: 'techasset_prestamos_activos.csv' }
];

/** Exportar: los cuatro CSV del server y la hoja de QR de lo visible. */
export function ExportPanel({ visible, siteCode, onClose }: { visible: Device[]; siteCode: string; onClose: () => void }) {
  const [busy, setBusy] = useState('');
  const status = useStatusLine();

  const csv = async (item: typeof EXPORTS[number]) => {
    setBusy(item.key);
    try {
      await downloadDevicesCsv(item.path, item.file);
      status.show({ tone: 'ok', message: `Se descargó ${item.file} (con BOM, abre bien en Excel).` });
    } catch (reason) {
      status.show({ tone: 'bad', message: errorMessage(reason, 'No se pudo exportar el CSV.') });
    } finally {
      setBusy('');
    }
  };

  const qr = async () => {
    setBusy('qr');
    try {
      await printDeviceQrs(visible, siteCode);
      status.show({ tone: 'ok', message: `Hoja de QR de ${visible.length} equipos lista: elegí la impresora o "Guardar como PDF".` });
    } catch (reason) {
      status.show({ tone: 'bad', message: errorMessage(reason, 'No se pudieron generar los códigos QR.') });
    } finally {
      setBusy('');
    }
  };

  return (
    <DevicePanel title="Exportar" onClose={onClose}>
      <div className="dv-export-grid">
        {EXPORTS.map(item => (
          <button key={item.key} type="button" className="dv-export" disabled={Boolean(busy)} aria-busy={busy === item.key || undefined} onClick={() => void csv(item)}>
            <span className="dv-ell dv-export-title">{item.title} <span className="dv-muted">CSV</span></span>
            <span className="dv-ell dv-muted">{busy === item.key ? 'Descargando…' : item.sub}</span>
          </button>
        ))}
        <button type="button" className="dv-export" disabled={Boolean(busy) || !visible.length} aria-busy={busy === 'qr' || undefined} onClick={() => void qr()}>
          <span className="dv-ell dv-export-title">Códigos QR <span className="dv-muted">PDF</span></span>
          <span className="dv-ell dv-muted">{busy === 'qr' ? 'Preparando…' : `Los ${visible.length} equipos visibles, para imprimir`}</span>
        </button>
      </div>
      {status.element}
    </DevicePanel>
  );
}
