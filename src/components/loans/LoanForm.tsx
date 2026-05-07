import { useEffect, useMemo, useRef, useState } from 'react';
import type { Device } from '../../types';
import { resolveDeviceMatches } from '../../utils/normalizeSearch';
import { getOperationalAlias, operationalTypeLabel } from '../../utils/classifyDevice';
import { Button } from '../layout/Button';
import { ScannerPanel } from './ScannerPanel';

type ScanItem = {
  id: string;
  etiqueta: string;
  alias: string;
  tipo: string;
  estado: string;
  disponible: boolean;
  motivo?: string;
};

export function LoanForm({ devices, onLend, onReturn, consultationMode, initialCode = '' }: { devices: Device[]; onLend: (payload: Record<string, unknown>) => Promise<void>; onReturn: (payload: Record<string, unknown>) => Promise<void>; consultationMode: boolean; initialCode?: string }) {
  const [code, setCode] = useState('');
  const [person, setPerson] = useState('');
  const [role, setRole] = useState('');
  const [location, setLocation] = useState('');
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [continuousScan, setContinuousScan] = useState(false);
  const [scanItems, setScanItems] = useState<ScanItem[]>([]);
  const [scanMessage, setScanMessage] = useState<{ tone: 'info' | 'warn' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const codeInputRef = useRef<HTMLInputElement | null>(null);
  const matches = useMemo(() => code ? resolveDeviceMatches(devices, code) : [], [devices, code]);
  const selected = matches.length === 1 ? matches[0] : undefined;
  const blocked = consultationMode || !selected;

  useEffect(() => {
    if (initialCode) setCode(initialCode);
  }, [initialCode]);

  const payload = () => ({ etiqueta: selected?.etiqueta, person, role, location, reason, comment });

  const reset = () => {
    setCode(''); setPerson(''); setRole(''); setLocation(''); setReason(''); setComment('');
    codeInputRef.current?.focus();
  };

  const handleLend = async () => {
    const data = payload();
    await onLend(data);
    reset();
  };

  const handleReturn = async () => {
    const data = payload();
    await onReturn(data);
    reset();
  };

  const addToContinuousScan = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const found = resolveDeviceMatches(devices, trimmed);
    if (found.length === 0) {
      setScanMessage({ tone: 'error', text: `No se encontró ningún equipo para "${trimmed}".` });
      return;
    }
    if (found.length > 1) {
      setScanMessage({ tone: 'warn', text: `Hay más de un equipo posible para "${trimmed}". Especificá mejor.` });
      return;
    }
    const device = found[0];
    if (scanItems.some(item => item.id === device.id)) {
      setScanMessage({ tone: 'warn', text: `${device.etiqueta} ya estaba en la lista.` });
      return;
    }
    const disponible = device.estado === 'Disponible';
    const motivo = disponible ? '' : `No disponible (${device.estado || 'sin estado'})`;
    setScanItems(items => [...items, {
      id: device.id,
      etiqueta: device.etiqueta,
      alias: getOperationalAlias(device),
      tipo: operationalTypeLabel(device),
      estado: String(device.estado || ''),
      disponible,
      motivo
    }]);
    setScanMessage({ tone: disponible ? 'info' : 'warn', text: disponible ? `Agregado: ${device.etiqueta}` : `Agregado con error: ${device.etiqueta} (${device.estado})` });
    setCode('');
    codeInputRef.current?.focus();
  };

  const onCodeKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!continuousScan || event.key !== 'Enter') return;
    event.preventDefault();
    addToContinuousScan(code);
  };

  const handleAddCurrent = () => {
    if (!code.trim()) return;
    addToContinuousScan(code);
  };

  const removeScanItem = (id: string) => {
    setScanItems(items => items.filter(item => item.id !== id));
  };

  const clearScanList = () => {
    setScanItems([]);
    setScanMessage(null);
  };

  const cancelContinuousScan = () => {
    setContinuousScan(false);
    if (scanItems.length && !window.confirm('¿Querés conservar la lista de escaneados?')) {
      setScanItems([]);
    }
    setScanMessage(null);
  };

  const toggleContinuous = () => {
    if (continuousScan) {
      cancelContinuousScan();
    } else {
      setContinuousScan(true);
      setScanMessage({ tone: 'info', text: 'Escaneo continuo activado. Escaneá los equipos uno detrás del otro.' });
      codeInputRef.current?.focus();
    }
  };

  const validScanItems = scanItems.filter(item => item.disponible);
  const invalidScanItems = scanItems.filter(item => !item.disponible);

  const handleConfirmMultipleLoan = async () => {
    if (consultationMode || !validScanItems.length) return;
    if (!person.trim() || !location.trim() || location === 'Seleccionar ubicacion') {
      setScanMessage({ tone: 'error', text: 'Completá persona y ubicación antes de confirmar.' });
      return;
    }
    setBusy(true);
    try {
      const errors: string[] = [];
      for (const item of validScanItems) {
        try {
          await onLend({ etiqueta: item.etiqueta, person, role, location, reason, comment });
        } catch (error) {
          errors.push(`${item.etiqueta}: ${error instanceof Error ? error.message : 'error'}`);
        }
      }
      const okCount = validScanItems.length - errors.length;
      setScanMessage({
        tone: errors.length ? 'warn' : 'info',
        text: errors.length
          ? `Se prestaron ${okCount} de ${validScanItems.length}. Errores: ${errors.join('; ')}`
          : `Se prestaron ${okCount} equipos correctamente.`
      });
      setScanItems(items => items.filter(item => !item.disponible));
      setPerson(''); setRole(''); setLocation(''); setReason(''); setComment('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={event => event.preventDefault()}>
      <label>Etiqueta 2023 o codigo</label>
      <div className="scan-input-row">
        <input ref={codeInputRef} className="input" value={code} onChange={event => setCode(event.target.value)} onKeyDown={onCodeKeyDown} placeholder={continuousScan ? 'Escanear y Enter (o agregar a lista)' : 'Ej. D1436 o QR'} autoComplete="off" />
        {continuousScan
          ? <Button type="button" variant="primary" onClick={handleAddCurrent} disabled={!code.trim()}>Agregar a lista</Button>
          : <Button type="button" onClick={() => codeInputRef.current?.focus()}>Foco scanner</Button>}
      </div>
      {!continuousScan && <ScannerPanel device={selected} message={matches.length > 1 ? 'Hay mas de un equipo posible. Especifica mejor.' : undefined} />}
      <button className={`toggle-row toggle-row-button ${continuousScan ? 'active' : ''}`} type="button" role="switch" aria-checked={continuousScan} onClick={toggleContinuous}>
        <span className="toggle-pill"><span /></span>
        <strong>Escaneo continuo</strong>
        <span className="muted">{continuousScan ? 'Activado' : 'Desactivado'}</span>
      </button>

      {continuousScan && (
        <div className="continuous-scan-panel">
          {scanMessage && <div className={`tool-${scanMessage.tone === 'error' ? 'error' : scanMessage.tone === 'warn' ? 'warning' : 'info'}`}>{scanMessage.text}</div>}
          <div className="continuous-scan-summary">
            <span>Total: <strong>{scanItems.length}</strong></span>
            <span>Disponibles: <strong>{validScanItems.length}</strong></span>
            <span>Con error: <strong>{invalidScanItems.length}</strong></span>
          </div>
          <div className="table-wrap continuous-scan-table">
            <table className="compact-table">
              <thead><tr><th>Etiqueta</th><th>Alias</th><th>Tipo</th><th>Estado</th><th>Disponible</th><th></th></tr></thead>
              <tbody>
                {scanItems.map(item => (
                  <tr key={item.id} className={item.disponible ? '' : 'row-error'}>
                    <td>{item.etiqueta}</td>
                    <td>{item.alias}</td>
                    <td>{item.tipo}</td>
                    <td>{item.estado || '-'}</td>
                    <td>{item.disponible ? 'Sí' : (item.motivo || 'No')}</td>
                    <td><Button className="mini-action-btn" type="button" onClick={() => removeScanItem(item.id)}>Quitar</Button></td>
                  </tr>
                ))}
                {!scanItems.length && <tr><td colSpan={6} className="empty-state">Aún no escaneaste ningún equipo.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid-2">
        <label>Persona<input className="input" value={person} onChange={event => setPerson(event.target.value)} placeholder="Nombre de quien recibe" /></label>
        <label>Rol<select className="input" value={role} onChange={event => setRole(event.target.value)}><option>Seleccionar rol</option><option>DOE</option><option>Alumno</option><option>Maestra</option><option>Profesor</option></select></label>
      </div>
      <div className="grid-2">
        <label>Ubicacion<select className="input" value={location} onChange={event => setLocation(event.target.value)}><option>Seleccionar ubicacion</option><option>Aula</option><option>DOE</option><option>Preceptoria</option><option>Planificacion</option></select></label>
        <label>Motivo<select className="input" value={reason} onChange={event => setReason(event.target.value)}><option>Sin motivo</option><option>Glifing</option><option>Matific</option><option>Programacion</option><option>Prestamo temporal</option></select></label>
      </div>
      <label>Comentario<input className="input" value={comment} onChange={event => setComment(event.target.value)} placeholder="Comentario opcional" /></label>
      <div className="actions">
        {continuousScan ? (
          <>
            <Button type="button" variant="primary" onClick={handleConfirmMultipleLoan} disabled={consultationMode || busy || !validScanItems.length}>Confirmar préstamo múltiple ({validScanItems.length})</Button>
            <Button type="button" onClick={clearScanList} disabled={busy || !scanItems.length}>Limpiar lista</Button>
            <Button type="button" onClick={cancelContinuousScan} disabled={busy}>Cancelar escaneo continuo</Button>
          </>
        ) : (
          <>
            <Button type="button" variant="primary" disabled={blocked} onClick={handleLend}>Prestar</Button>
            <Button type="button" variant="success" disabled={blocked} onClick={handleReturn}>Devolver</Button>
            <Button type="button">Abrir camara</Button>
            <Button type="button">Cerrar camara</Button>
          </>
        )}
      </div>
    </form>
  );
}
