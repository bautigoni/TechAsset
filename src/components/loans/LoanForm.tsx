import { useEffect, useMemo, useRef, useState } from 'react';
import type { Device } from '../../types';
import { parseScannedCode, resolveDeviceMatches } from '../../utils/normalizeSearch';
import { getOperationalAlias, operationalTypeLabel } from '../../utils/classifyDevice';
import { Button } from '../layout/Button';
import { ScannerPanel } from './ScannerPanel';
import { getSiteSettings } from '../../services/authApi';

type ScanItem = {
  id: string;
  etiqueta: string;
  alias: string;
  tipo: string;
  estado: string;
  disponible: boolean;
  motivo?: string;
};

type LoanActionResult = { synced?: boolean; message?: string } | void;
type LoanUiState = 'available' | 'loaned' | 'blocked' | 'unknown';
type BarcodeDetectorInstance = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>>;
};
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorInstance;

const DEFAULT_GRADE_OPTIONS = [
  '1N', '1F', '1S',
  '2N', '2F', '2S',
  '3N', '3F', '3S',
  '4N', '4F', '4S',
  '5N', '5F', '5S',
  '6N', '6F', '6S'
];
const SCHOOL_LEVEL_OPTIONS = ['EP', 'ES'];

export function LoanForm({ devices, onLend, onReturn, consultationMode, initialCode = '' }: { devices: Device[]; onLend: (payload: Record<string, unknown>) => Promise<LoanActionResult>; onReturn: (payload: Record<string, unknown>) => Promise<LoanActionResult>; consultationMode: boolean; initialCode?: string }) {
  const [code, setCode] = useState('');
  const [person, setPerson] = useState('');
  const [role, setRole] = useState('');
  const [location, setLocation] = useState('');
  const [reason, setReason] = useState('');
  const [locationDetail, setLocationDetail] = useState('');
  const [reasonDetail, setReasonDetail] = useState('');
  const [course, setCourse] = useState('');
  const [schoolLevel, setSchoolLevel] = useState('');
  const [comment, setComment] = useState('');
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [continuousScan, setContinuousScan] = useState(false);
  const [scanItems, setScanItems] = useState<ScanItem[]>([]);
  const [scanMessage, setScanMessage] = useState<{ tone: 'info' | 'warn' | 'error'; text: string } | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const codeInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanFrameRef = useRef<number | null>(null);
  const lastQrRef = useRef('');
  const matches = useMemo(() => code ? resolveDeviceMatches(devices, code) : [], [devices, code]);
  const selected = matches.length === 1 ? matches[0] : undefined;
  const selectedLoanState = getLoanUiState(selected);
  const unavailableMessage = selected && selectedLoanState === 'blocked'
    ? `${selected.etiqueta} está ${selected.estado || 'no disponible'}. No se puede prestar ni devolver desde esta pantalla.`
    : '';
  const roleOptions = normalizeStringOptions(settings['loan.roles'], ['DOE', 'Alumno', 'Maestra', 'Profesor', 'Directivo', 'Preceptor', 'Otro']);
  const locationOptions = (settings['loan.locations'] as Array<{ label: string; requiresDetail?: boolean; requiresCourse?: boolean }>) || [{ label: 'Aula', requiresCourse: true }, { label: 'DOE' }, { label: 'Planificación móvil' }, { label: 'Otro', requiresDetail: true }];
  const motiveOptions = (settings['loan.motives'] as Array<{ label: string; requiresDetail?: boolean }>) || [{ label: 'Planificación' }, { label: 'Préstamo autorizado' }, { label: 'Otro', requiresDetail: true }];
  const gradeOptions = mergeStringOptions(settings['loan.gradeOptions'], DEFAULT_GRADE_OPTIONS);
  const selectedLocation = locationOptions.find(item => item.label === location);
  const selectedReason = motiveOptions.find(item => item.label === reason);
  const requiresSchoolCourse = Boolean(selectedLocation?.requiresCourse);

  useEffect(() => {
    if (initialCode) setCode(initialCode);
  }, [initialCode]);

  useEffect(() => {
    getSiteSettings().then(r => setSettings(r.settings || {})).catch(() => {});
  }, []);

  useEffect(() => () => stopCamera(), []);

  useEffect(() => {
    if (!cameraOpen || !videoRef.current || !streamRef.current) return;
    const video = videoRef.current;
    video.srcObject = streamRef.current;
    void video.play().then(() => startQrScan()).catch(() => undefined);
  }, [cameraOpen]);

  const payload = () => ({ etiqueta: selected?.etiqueta, person, role, location, locationDetail, course, schoolLevel, reason, reasonDetail, comment });

  const reset = () => {
    setCode(''); setPerson(''); setRole(''); setLocation(''); setLocationDetail(''); setCourse(''); setSchoolLevel(''); setReason(''); setReasonDetail(''); setComment('');
    codeInputRef.current?.focus();
  };

  const handleLend = async () => {
    if (busyRef.current || consultationMode || selectedLoanState !== 'available') return;
    const validation = validateLoanFields();
    if (validation) {
      setScanMessage({ tone: 'error', text: validation });
      return;
    }
    const data = payload();
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await onLend(data);
      setScanMessage({ tone: result && result.synced === false ? 'warn' : 'info', text: result?.message || 'Préstamo registrado.' });
      reset();
    } catch (error) {
      setScanMessage({ tone: 'error', text: error instanceof Error ? error.message : 'No se pudo registrar el préstamo.' });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const handleReturn = async () => {
    if (busyRef.current || consultationMode || selectedLoanState !== 'loaned') return;
    const data = payload();
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await onReturn(data);
      setScanMessage({ tone: result && result.synced === false ? 'warn' : 'info', text: result?.message || 'Devolución registrada.' });
      reset();
    } catch (error) {
      setScanMessage({ tone: 'error', text: error instanceof Error ? error.message : 'No se pudo registrar la devolución.' });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const validateLoanFields = () => {
    if (!person.trim()) return 'Completá la persona que recibe el equipo.';
    if (!role.trim() || role === 'Seleccionar rol') return 'Seleccioná un rol.';
    if (!location.trim() || location === 'Seleccionar ubicación') return 'Seleccioná una ubicación.';
    if (requiresSchoolCourse && (!schoolLevel.trim() || schoolLevel === 'Seleccionar nivel')) return 'Seleccioná si es EP o ES.';
    if (requiresSchoolCourse && (!course.trim() || course === 'Seleccionar curso')) return 'Seleccioná grado, año o curso.';
    if (selectedLocation?.requiresDetail && !locationDetail.trim()) return 'Especificá la ubicación.';
    if (selectedReason?.requiresDetail && !reasonDetail.trim()) return 'Especificá el motivo.';
    return '';
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
    const disponible = getLoanUiState(device) === 'available';
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

  const openCamera = async () => {
    setCameraError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('No se pudo abrir la cámara. Este navegador no permite acceso a cámara.');
      return;
    }
    if (!window.isSecureContext) {
      const host = window.location.hostname;
      const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
      if (!local) {
        setCameraError('No se pudo abrir la cámara. Verificá permisos del navegador o usá HTTPS/localhost.');
        return;
      }
    }
    try {
      stopCamera();
      lastQrRef.current = '';
      const stream = await openPreferredCamera();
      streamRef.current = stream;
      setCameraOpen(true);
      if (!barcodeDetectorClass()) setCameraError('El escaneo QR no está disponible en este navegador. Podés ingresar el código manualmente.');
    } catch {
      setCameraError('No se pudo abrir la cámara. Verificá permisos del navegador o usá HTTPS/localhost.');
      setCameraOpen(false);
    }
  };

  const stopCamera = () => {
    if (scanFrameRef.current !== null) window.cancelAnimationFrame(scanFrameRef.current);
    scanFrameRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOpen(false);
  };

  const startQrScan = () => {
    const Detector = barcodeDetectorClass();
    const video = videoRef.current;
    if (!Detector || !video) return;
    const detector = new Detector({ formats: ['qr_code'] });
    const scan = async () => {
      if (!streamRef.current || !videoRef.current) return;
      try {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          const codes = await detector.detect(video);
          const raw = codes.find(item => item.rawValue)?.rawValue || '';
          const parsed = parseScannedCode(raw);
          if (parsed && parsed !== lastQrRef.current) {
            lastQrRef.current = parsed;
            setCode(parsed);
            setScanMessage({ tone: 'info', text: `QR detectado: ${parsed}` });
            stopCamera();
            codeInputRef.current?.focus();
            return;
          }
        }
      } catch {
        setCameraError('No se pudo leer el QR. Podés ingresar el código manualmente.');
      }
      scanFrameRef.current = window.requestAnimationFrame(scan);
    };
    scanFrameRef.current = window.requestAnimationFrame(scan);
  };

  const handleConfirmMultipleLoan = async () => {
    if (consultationMode || !validScanItems.length) return;
    if (!person.trim() || !location.trim() || location === 'Seleccionar ubicación' || (selectedLocation?.requiresDetail && !locationDetail.trim()) || (requiresSchoolCourse && (!schoolLevel.trim() || !course.trim())) || (selectedReason?.requiresDetail && !reasonDetail.trim())) {
      setScanMessage({ tone: 'error', text: 'Completá persona y ubicación antes de confirmar.' });
      return;
    }
    setBusy(true);
    try {
      const errors: string[] = [];
      for (const item of validScanItems) {
        try {
          const result = await onLend({ etiqueta: item.etiqueta, person, role, location, locationDetail, course, schoolLevel, reason, reasonDetail, comment });
          if (result?.synced === false) errors.push(`${item.etiqueta}: ${result.message || 'no se pudo registrar'}`);
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
      setPerson(''); setRole(''); setLocation(''); setLocationDetail(''); setCourse(''); setSchoolLevel(''); setReason(''); setReasonDetail(''); setComment('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={event => event.preventDefault()}>
      <label>Etiqueta 2023 o código</label>
      <div className="scan-input-row">
        <input ref={codeInputRef} className="input" value={code} onChange={event => setCode(event.target.value)} onKeyDown={onCodeKeyDown} placeholder={continuousScan ? 'Escanear y Enter (o agregar a lista)' : 'Ej. D1436 o QR'} autoComplete="off" />
        {continuousScan
          ? <Button type="button" variant="primary" onClick={handleAddCurrent} disabled={!code.trim()}>Agregar a lista</Button>
          : <Button type="button" onClick={() => codeInputRef.current?.focus()}>Foco scanner</Button>}
      </div>
      {!continuousScan && <ScannerPanel device={selected} message={matches.length > 1 ? 'Hay más de un equipo posible. Especificá mejor.' : undefined} />}
      {!continuousScan && (cameraOpen || cameraError) && (
        <div className="camera-panel">
          {cameraOpen && <video ref={videoRef} className="camera-preview" playsInline muted autoPlay />}
          {cameraError && <div className="tool-error">{cameraError}</div>}
          {cameraOpen && <p className="muted">Cámara activa. Escaneá el QR con tu lector habitual o usala como apoyo visual.</p>}
        </div>
      )}
      {!continuousScan && scanMessage && <div className={`tool-${scanMessage.tone === 'error' ? 'error' : scanMessage.tone === 'warn' ? 'warning' : 'info'}`}>{scanMessage.text}</div>}
      {!continuousScan && unavailableMessage && <div className="tool-warning">{unavailableMessage}</div>}
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
        <label>Rol<select className="input" value={role} onChange={event => setRole(event.target.value)}><option>Seleccionar rol</option>{roleOptions.map(item => <option key={item}>{item}</option>)}</select></label>
      </div>
      <div className="grid-2">
        <label>Ubicación<select className="input" value={location} onChange={event => setLocation(event.target.value)}><option>Seleccionar ubicación</option>{locationOptions.map(item => <option key={item.label}>{item.label}</option>)}</select></label>
        <label>Motivo<select className="input" value={reason} onChange={event => setReason(event.target.value)}><option>Sin motivo</option>{motiveOptions.map(item => <option key={item.label}>{item.label}</option>)}</select></label>
      </div>
      {(requiresSchoolCourse || selectedLocation?.requiresDetail || selectedReason?.requiresDetail) && (
        <div className="grid-2">
          {requiresSchoolCourse && <label>Nivel<select className="input" value={schoolLevel} onChange={event => setSchoolLevel(event.target.value)}><option>Seleccionar nivel</option>{SCHOOL_LEVEL_OPTIONS.map(item => <option key={item}>{item}</option>)}</select></label>}
          {requiresSchoolCourse && <label>Grado / Año / Curso<select className="input" value={course} onChange={event => setCourse(event.target.value)}><option>Seleccionar curso</option>{gradeOptions.map(item => <option key={item}>{item}</option>)}</select></label>}
          {selectedLocation?.requiresDetail && <label>Especificar ubicación<input className="input" value={locationDetail} onChange={event => setLocationDetail(event.target.value)} /></label>}
          {selectedReason?.requiresDetail && <label>Especificar motivo<input className="input" value={reasonDetail} onChange={event => setReasonDetail(event.target.value)} /></label>}
        </div>
      )}
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
            {selectedLoanState === 'available' && <Button type="button" variant="primary" disabled={consultationMode || busy} onClick={handleLend}>{busy ? 'Prestando...' : 'Prestar'}</Button>}
            {selectedLoanState === 'loaned' && <Button type="button" variant="success" disabled={consultationMode || busy} onClick={handleReturn}>{busy ? 'Devolviendo...' : 'Devolver'}</Button>}
            <Button type="button" onClick={openCamera} disabled={cameraOpen}>Abrir cámara</Button>
            <Button type="button" onClick={stopCamera} disabled={!cameraOpen}>Cerrar cámara</Button>
          </>
        )}
      </div>
    </form>
  );
}

async function openPreferredCamera() {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
  } catch {
    return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
}

function barcodeDetectorClass(): BarcodeDetectorConstructor | undefined {
  return (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
}

function getLoanUiState(device?: Device): LoanUiState {
  if (!device) return 'unknown';
  const state = normalizeState(device.estado);
  if (!state || state === 'disponible' || state === 'devuelto') return 'available';
  if (state.includes('prest') || state.includes('retir')) return 'loaned';
  return 'blocked';
}

function normalizeState(value?: string) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function normalizeStringOptions(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .map(item => typeof item === 'string' ? { label: item, activo: true } : item as { label?: string; nombre?: string; activo?: boolean })
    .filter(item => item && item.activo !== false)
    .map(item => String(item.label || item.nombre || '').trim())
    .filter(Boolean);
  return items.length ? items : fallback;
}

function mergeStringOptions(value: unknown, defaults: string[]) {
  const configured = normalizeStringOptions(value, []);
  const seen = new Set<string>();
  return [...defaults, ...configured].filter(item => {
    const key = item.trim().toLowerCase();
    if (SCHOOL_LEVEL_OPTIONS.some(level => level.toLowerCase() === key)) return false;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
