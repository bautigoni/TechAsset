import { useEffect, useMemo, useRef, useState } from 'react';
import type { Device } from '../../types';
import { resolveDeviceMatches } from '../../utils/normalizeSearch';
import { Button } from '../layout/Button';
import { ScannerPanel } from './ScannerPanel';

export function LoanForm({ devices, onLend, onReturn, consultationMode, initialCode = '' }: { devices: Device[]; onLend: (payload: Record<string, unknown>) => Promise<void>; onReturn: (payload: Record<string, unknown>) => Promise<void>; consultationMode: boolean; initialCode?: string }) {
  const [code, setCode] = useState('');
  const [person, setPerson] = useState('');
  const [role, setRole] = useState('');
  const [location, setLocation] = useState('');
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [continuousScan, setContinuousScan] = useState(false);
  const codeInputRef = useRef<HTMLInputElement | null>(null);
  const matches = useMemo(() => code ? resolveDeviceMatches(devices, code) : [], [devices, code]);
  const selected = matches.length === 1 ? matches[0] : undefined;
  const blocked = consultationMode || !selected;

  useEffect(() => {
    if (initialCode) setCode(initialCode);
  }, [initialCode]);

  const payload = () => ({ etiqueta: selected?.etiqueta, person, role, location, reason, comment });

  return (
    <form className="stack" onSubmit={event => event.preventDefault()}>
      <label>Etiqueta 2023 o codigo</label>
      <div className="scan-input-row">
        <input ref={codeInputRef} className="input" value={code} onChange={event => setCode(event.target.value)} placeholder="Ej. D1436 o QR" autoComplete="off" />
        <Button type="button" onClick={() => codeInputRef.current?.focus()}>Foco scanner</Button>
      </div>
      <ScannerPanel device={selected} message={matches.length > 1 ? 'Hay mas de un equipo posible. Especifica mejor.' : undefined} />
      <button className={`toggle-row toggle-row-button ${continuousScan ? 'active' : ''}`} type="button" role="switch" aria-checked={continuousScan} onClick={() => setContinuousScan(current => !current)}>
        <span className="toggle-pill"><span /></span>
        <strong>Escaneo continuo</strong>
        <span className="muted">{continuousScan ? 'Activado' : 'Desactivado'}</span>
      </button>
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
        <Button type="button" variant="primary" disabled={blocked} onClick={() => onLend(payload())}>Prestar</Button>
        <Button type="button" variant="success" disabled={blocked} onClick={() => onReturn(payload())}>Devolver</Button>
        <Button type="button">Cierre del dia</Button>
        <Button type="button">Abrir camara</Button>
        <Button type="button">Cerrar camara</Button>
      </div>
    </form>
  );
}
