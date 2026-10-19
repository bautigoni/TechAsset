import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Device } from '../../types';
import { parseScannedCode, resolveDeviceMatches } from '../../utils/normalizeSearch';
import { getDeviceNumber, getOperationalAlias, operationalTypeLabel } from '../../utils/classifyDevice';
import { getLoanState } from '../../utils/deviceState';
import { formatLoanDateTime, loanAgeDays } from '../../utils/formatters';
import { getSiteSettings } from '../../services/authApi';
import { getActiveLoanAccessories, getLoanSuggestions, type LoanBatchResponse, type LoanSuggestion } from '../../services/loansApi';
import { Button, Kbd } from '../../ui/Button';
import { Input } from '../../ui/Field';
import { Switch } from '../../ui/Toggle';
import { StatusText, ageTone, type StatusTextTone } from '../../ui/Data';
import { useStatusLine } from '../../ui/Status';
import { TruncatedText } from '../../ui/Truncated';
import { IconLock, IconSearch, IconX } from '../../ui/icons';
import { cx } from '../../ui/util';
import { AccessoryToggles, GradeGrid, OptionGroup, toggleList } from './ChipPanelKit';
import { SuggestInput } from './PersonSuggestInput';
import { ScanMessage, SuccessCheck } from './ScanMessage';

type LoanActionResult = { synced?: boolean; message?: string; idempotent?: boolean } | void;
type BarcodeDetectorInstance = { detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>> };
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorInstance;
type LocationOption = { label: string; requiresDetail?: boolean; requiresCourse?: boolean };
type MotiveOption = { label: string; requiresDetail?: boolean };
type Msg = { tone: 'info' | 'warn' | 'error'; text: string; success?: boolean };

export type UndoFn = (etiquetas: string[], action: 'return' | 'lend') => Promise<LoanBatchResponse>;

const DEFAULT_GRADE_OPTIONS = ['1N', '1F', '1S', '2N', '2F', '2S', '3N', '3F', '3S', '4N', '4F', '4S', '5N', '5F', '5S', '6N', '6F', '6S'];
const SCHOOL_LEVEL_OPTIONS = ['EP', 'ES'];
const DEFAULT_ACCESSORIES = ['Cargador', 'Mouse', 'Bolso', 'Cable HDMI', 'Adaptador', 'Lápiz óptico', 'Auriculares'];
const DEFAULT_ROLES = ['DOE', 'Alumno', 'Maestra', 'Profesor', 'Directivo', 'Preceptor', 'Otro'];
const DEFAULT_LOCATIONS: LocationOption[] = [{ label: 'Aula', requiresCourse: true }, { label: 'DOE' }, { label: 'Planificación móvil' }, { label: 'Otro', requiresDetail: true }];
const DEFAULT_MOTIVES: MotiveOption[] = [{ label: 'Planificación' }, { label: 'Préstamo autorizado' }, { label: 'Otro', requiresDetail: true }];
const UNDO_SECONDS = 8;

/**
 * Prestar o devolver: un campo para escanear o tipear (motor flexible:
 * D1436, 1436, touch 34, 34touch, plani 5, SN, MAC, QR) y el resultado en
 * línea con LA acción que corresponde: prestado → Devolver (Enter);
 * libre → los datos del préstamo en línea (Enter en el código va a Persona).
 *
 * Escaneo continuo: cada Enter suma a la lista (duplicados, no disponibles y
 * ambiguos avisados) y un único formulario presta todos los disponibles en
 * UN request (`lend-batch`).
 *
 * Todo lo que antes era modal o toast va en línea: la pregunta al salir del
 * continuo, la cámara, los avisos y el Deshacer.
 */
export function LoanForm({ devices, onLend, onReturn, onLendBatch, onUndo, consultationMode, seed, batchSeed, scanRequest = 0 }: {
  devices: Device[];
  onLend: (payload: Record<string, unknown>) => Promise<LoanActionResult>;
  onReturn: (payload: Record<string, unknown>) => Promise<LoanActionResult>;
  onLendBatch: (payload: Record<string, unknown> & { etiquetas: string[] }) => Promise<LoanBatchResponse>;
  onUndo: UndoFn;
  consultationMode: boolean;
  seed?: { code: string; nonce: number };
  batchSeed?: { etiquetas: string[]; nonce: number };
  scanRequest?: number;
}) {
  const [code, setCode] = useState('');
  const [continuous, setContinuous] = useState(false);
  const [queue, setQueue] = useState<Array<{ id: string; etiqueta: string }>>([]);
  const [scanMessage, setScanMessage] = useState<Msg | null>(null);
  const [askExit, setAskExit] = useState(false);
  const [person, setPerson] = useState('');
  const [role, setRole] = useState('');
  const [location, setLocation] = useState('');
  const [locationDetail, setLocationDetail] = useState('');
  const [schoolLevel, setSchoolLevel] = useState('');
  const [course, setCourse] = useState('');
  const [reason, setReason] = useState('');
  const [reasonDetail, setReasonDetail] = useState('');
  const [comment, setComment] = useState('');
  const [loanAccessories, setLoanAccessories] = useState<string[]>([]);
  const [extraAccessories, setExtraAccessories] = useState<string[]>([]);
  const [customAccessory, setCustomAccessory] = useState('');
  const [accessoriesOpen, setAccessoriesOpen] = useState(false);
  const [returnedAccessories, setReturnedAccessories] = useState<string[]>([]);
  const [expectedAccessories, setExpectedAccessories] = useState<string[] | null>(null);
  const [formError, setFormError] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const codeInputRef = useRef<HTMLInputElement | null>(null);
  const personInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanFrameRef = useRef<number | null>(null);
  const lastQrRef = useRef('');
  const status = useStatusLine();

  const trimmed = code.trim();
  const matches = useMemo(() => (!continuous && trimmed ? resolveDeviceMatches(devices, trimmed) : []), [devices, trimmed, continuous]);
  const selected = matches.length === 1 ? matches[0] : undefined;
  const selectedState = selected ? getLoanState(selected.estado) : 'unknown';
  const queueDevices = useMemo(() => {
    const byId = new Map(devices.map(device => [device.id, device]));
    return queue.map(item => byId.get(item.id)).filter((device): device is Device => Boolean(device));
  }, [devices, queue]);
  const queueAvailable = queueDevices.filter(device => getLoanState(device.estado) === 'available');
  const lendOpen = continuous ? queueAvailable.length > 0 : selectedState === 'available';

  const roleOptions = normalizeStringOptions(settings['loan.roles'], DEFAULT_ROLES);
  const locationOptions = normalizeObjectOptions<LocationOption>(settings['loan.locations'], DEFAULT_LOCATIONS);
  const motiveOptions = normalizeObjectOptions<MotiveOption>(settings['loan.motives'], DEFAULT_MOTIVES);
  const gradeOptions = mergeStringOptions(settings['loan.gradeOptions'], DEFAULT_GRADE_OPTIONS);
  const selectedLocation = locationOptions.find(item => item.label === location);
  const selectedReason = motiveOptions.find(item => item.label === reason);
  const requiresSchoolCourse = Boolean(selectedLocation?.requiresCourse);

  const focusCode = (select = false) => window.setTimeout(() => {
    codeInputRef.current?.focus();
    if (select) codeInputRef.current?.select();
  }, 0);

  useEffect(() => {
    getSiteSettings().then(response => setSettings(response.settings || {})).catch(() => {
      // Sin settings de la sede: quedan los valores por defecto.
    });
  }, []);

  // Semilla (chip libre, "Revisar", Ctrl K, escáner global, botón Prestar de
  // otra pantalla): carga la etiqueta y deja el campo seleccionado, así el
  // próximo escaneo la reemplaza en vez de pegarse atrás. Con el continuo
  // prendido, el equipo se suma directo a la lista.
  useEffect(() => {
    if (!seed?.code) return;
    if (continuous) {
      addToContinuousScan(seed.code);
      return;
    }
    setCode(seed.code);
    setFormError('');
    setScanMessage(null);
    focusCode(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.nonce]);

  // "Escanear" de la barra inferior (mobile): en touch abre la cámara; con
  // teclado/lector, deja el foco en el campo del código.
  useEffect(() => {
    if (!scanRequest) return;
    if (!consultationMode && !continuous && window.matchMedia?.('(pointer: coarse)').matches) void openCamera();
    else focusCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanRequest]);

  // Lote de la grilla o de Dispositivos: entra a la lista del continuo (sin
  // duplicar), así persona/rol/ubicación se cargan una sola vez para todos.
  useEffect(() => {
    if (!batchSeed?.etiquetas.length) return;
    const found = batchSeed.etiquetas
      .map(etiqueta => devices.find(device => device.etiqueta === etiqueta))
      .filter((device): device is Device => Boolean(device));
    setContinuous(true);
    setAskExit(false);
    stopCamera();
    setCode('');
    setQueue(items => {
      const known = new Set(items.map(item => item.id));
      return [...items, ...found.filter(device => !known.has(device.id)).map(device => ({ id: device.id, etiqueta: device.etiqueta }))];
    });
    setScanMessage({ tone: 'info', text: `${found.length} ${found.length === 1 ? 'equipo agregado' : 'equipos agregados'} desde la grilla. Completá persona y confirmá.` });
    window.setTimeout(() => (personInputRef.current || codeInputRef.current)?.focus(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchSeed?.nonce]);

  // "/" lleva al campo del código desde cualquier lugar de la pantalla.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"]'))) return;
      event.preventDefault();
      codeInputRef.current?.focus();
      codeInputRef.current?.select();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => () => stopCamera(), []);

  useEffect(() => {
    if (!cameraOpen || !videoRef.current || !streamRef.current) return;
    const video = videoRef.current;
    video.srcObject = streamRef.current;
    void video.play().then(() => startQrScan()).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOpen]);

  // Accesorios que se entregaron con el préstamo activo: los que tienen que volver.
  useEffect(() => {
    let cancelled = false;
    setExpectedAccessories(null);
    setReturnedAccessories([]);
    if (!selected?.etiqueta || selectedState !== 'loaned') return () => { cancelled = true; };
    getActiveLoanAccessories(selected.etiqueta)
      .then(response => { if (!cancelled) setExpectedAccessories(response.accessories || []); })
      .catch(() => { if (!cancelled) setExpectedAccessories([]); });
    return () => { cancelled = true; };
  }, [selected?.etiqueta, selectedState]);

  const resetFields = () => {
    setPerson(''); setRole(''); setLocation(''); setLocationDetail(''); setCourse(''); setSchoolLevel(''); setReason(''); setReasonDetail(''); setComment('');
    setLoanAccessories([]); setReturnedAccessories([]); setCustomAccessory(''); setAccessoriesOpen(false); setFormError('');
  };

  const showError = (text: string) => {
    setFormError(text);
    setErrorKey(value => value + 1);
  };

  const applySuggestion = (suggestion: LoanSuggestion) => {
    setPerson(suggestion.persona);
    if (suggestion.rol && roleOptions.includes(suggestion.rol)) setRole(suggestion.rol);
    if (suggestion.ubicacion && locationOptions.some(item => item.label === suggestion.ubicacion)) setLocation(suggestion.ubicacion);
    if (suggestion.motivo && motiveOptions.some(item => item.label === suggestion.motivo)) setReason(suggestion.motivo);
    if (suggestion.curso) {
      const parts = suggestion.curso.split('·').map(part => part.trim()).filter(Boolean);
      const level = parts.find(part => SCHOOL_LEVEL_OPTIONS.includes(part));
      const grade = parts.find(part => gradeOptions.includes(part));
      if (level) setSchoolLevel(level);
      if (grade) setCourse(grade);
    }
    setFormError('');
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

  const whereText = () => {
    if (requiresSchoolCourse) return [[schoolLevel, course].filter(Boolean).join(' '), location].filter(Boolean).join(' · ');
    if (selectedLocation?.requiresDetail && locationDetail.trim()) return `${location} · ${locationDetail.trim()}`;
    return location;
  };

  const loanPayload = () => ({
    person: person.trim(), role, location, locationDetail, course, schoolLevel, reason, reasonDetail, comment, accessories: loanAccessories
  });

  // Deshacer: vuelve atrás lo recién hecho (re-presta con los mismos datos o deja libre).
  const runUndo = async (etiquetas: string[], action: 'return' | 'lend', text: string) => {
    try {
      const response = await onUndo(etiquetas, action);
      const errors = response.results.filter(item => !item.ok).map(item => item.error || item.etiqueta);
      if (errors.length) status.show({ tone: 'bad', message: `No se pudo deshacer: ${errors.join('; ')}` });
      else status.show({ tone: 'info', message: `Se deshizo: ${text}` });
    } catch (error) {
      status.show({ tone: 'bad', message: error instanceof Error ? error.message : 'No se pudo deshacer.' });
    }
  };

  const handleLend = async () => {
    if (busyRef.current || consultationMode || !selected || selectedState !== 'available') return;
    const validation = validateLoanFields();
    if (validation) { showError(validation); return; }
    const device = selected;
    const text = `${getOperationalAlias(device) || device.etiqueta} (${device.etiqueta}) prestado a ${person.trim()} · ${whereText()}`;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await onLend({ etiqueta: device.etiqueta, ...loanPayload() });
      const synced = !(result && result.synced === false);
      status.show(synced
        ? { tone: 'ok', icon: <SuccessCheck />, message: text, undo: { seconds: UNDO_SECONDS, onUndo: () => runUndo([device.etiqueta], 'lend', text) } }
        : { tone: 'warn', message: result?.message || 'Préstamo registrado sin sincronizar.' });
      setCode('');
      setScanMessage(null);
      resetFields();
      focusCode();
    } catch (error) {
      showError(error instanceof Error ? error.message : 'No se pudo registrar el préstamo.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const handleReturn = async () => {
    if (busyRef.current || consultationMode || !selected || selectedState !== 'loaned') return;
    const device = selected;
    const text = `${getOperationalAlias(device) || device.etiqueta} (${device.etiqueta}) devuelto${device.prestadoA ? ` · lo tenía ${device.prestadoA}` : ''}`;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await onReturn({ etiqueta: device.etiqueta, returnedAccessories });
      const synced = !(result && result.synced === false);
      if (result && result.idempotent) status.show({ tone: 'warn', message: result.message || `${device.etiqueta} ya estaba disponible.` });
      else status.show(synced
        ? { tone: 'ok', icon: <SuccessCheck />, message: text, undo: { seconds: UNDO_SECONDS, onUndo: () => runUndo([device.etiqueta], 'return', text) } }
        : { tone: 'warn', message: result?.message || 'Devolución registrada sin sincronizar.' });
      setCode('');
      setScanMessage(null);
      resetFields();
      focusCode();
    } catch (error) {
      setScanMessage({ tone: 'error', text: error instanceof Error ? error.message : 'No se pudo registrar la devolución.' });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const handleConfirmMultipleLoan = async () => {
    if (busyRef.current || consultationMode || !queueAvailable.length) return;
    // Mismas validaciones que el préstamo suelto.
    const validation = validateLoanFields();
    if (validation) { showError(validation); return; }
    const targets = queueAvailable.map(device => device.etiqueta);
    const who = person.trim();
    const where = whereText();
    busyRef.current = true;
    setBusy(true);
    try {
      let failed: Array<{ etiqueta: string; error: string }> = [];
      try {
        // Un solo request para todo el lote.
        const response = await onLendBatch({ etiquetas: targets, ...loanPayload() });
        failed = response.results.filter(item => !item.ok).map(item => ({ etiqueta: item.etiqueta, error: item.error || 'no se pudo registrar' }));
      } catch (error) {
        failed = targets.map(etiqueta => ({ etiqueta, error: error instanceof Error ? error.message : 'error' }));
      }
      const failedTags = new Set(failed.map(item => item.etiqueta));
      const done = targets.filter(etiqueta => !failedTags.has(etiqueta));
      setScanMessage(failed.length
        ? { tone: done.length ? 'warn' : 'error', text: `Se prestaron ${done.length} de ${targets.length}. Errores: ${failed.map(item => `${item.etiqueta}: ${item.error}`).join('; ')}` }
        : { tone: 'info', text: `Se prestaron ${done.length} equipos correctamente.` });
      if (done.length) {
        const text = `Se ${done.length === 1 ? 'prestó 1 equipo' : `prestaron ${done.length} equipos`} a ${who} · ${where}`;
        status.show({ tone: failed.length ? 'warn' : 'ok', icon: failed.length ? undefined : <SuccessCheck />, message: text, undo: { seconds: UNDO_SECONDS, onUndo: () => runUndo(done, 'lend', text) } });
        // Salen de la lista los que se prestaron; los que fallaron quedan para reintentar.
        setQueue(items => items.filter(item => !done.includes(item.etiqueta)));
        resetFields();
      }
      focusCode();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const addToContinuousScan = (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    setCode('');
    focusCode();
    const found = resolveDeviceMatches(devices, value);
    if (found.length === 0) { setScanMessage({ tone: 'error', text: `No se encontró ningún equipo para "${value}".` }); return; }
    if (found.length > 1) { setScanMessage({ tone: 'warn', text: `Hay más de un equipo posible para "${value}". Especificá mejor.` }); return; }
    const device = found[0];
    if (queue.some(item => item.id === device.id)) { setScanMessage({ tone: 'warn', text: `${device.etiqueta} ya estaba en la lista.` }); return; }
    setQueue(items => [...items, { id: device.id, etiqueta: device.etiqueta }]);
    const disponible = getLoanState(device.estado) === 'available';
    setScanMessage(disponible
      ? { tone: 'info', text: `Agregado: ${device.etiqueta} · ${getOperationalAlias(device) || operationalTypeLabel(device)}` }
      : { tone: 'error', text: `Agregado con error: ${device.etiqueta} (${device.estado || 'sin estado'})` });
  };

  const onCodeKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (code) { event.preventDefault(); setCode(''); setFormError(''); }
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (continuous) { addToContinuousScan(code); return; }
    // Enter hace LA acción: prestado → devuelve; libre → a completar la persona.
    if (selectedState === 'loaned') void handleReturn();
    else if (selectedState === 'available') personInputRef.current?.focus();
  };

  const toggleContinuous = (next: boolean) => {
    if (next) {
      stopCamera();
      setContinuous(true);
      setAskExit(false);
      setCode('');
      setFormError('');
      setScanMessage({ tone: 'info', text: 'Escaneo continuo activado. Escaneá los equipos uno detrás del otro.' });
      focusCode();
      return;
    }
    if (queue.length) { setAskExit(true); return; }
    exitContinuous(false);
  };

  const exitContinuous = (keepList: boolean) => {
    if (!keepList) setQueue([]);
    setContinuous(false);
    setAskExit(false);
    setScanMessage(null);
    setFormError('');
    focusCode();
  };

  /* ── Cámara / QR ─────────────────────────────────────────────────────── */

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
        setCameraError('No se pudo abrir la cámara: hace falta HTTPS (o localhost). Verificá los permisos del navegador.');
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

  function stopCamera() {
    if (scanFrameRef.current !== null) window.cancelAnimationFrame(scanFrameRef.current);
    scanFrameRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOpen(false);
  }

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
            setCameraError('');
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

  /* ── Vista ───────────────────────────────────────────────────────────── */

  const idle = !continuous && !trimmed;
  const accessoryList = [...new Set([...DEFAULT_ACCESSORIES, ...extraAccessories, ...loanAccessories])];
  const addCustomAccessory = () => {
    const item = customAccessory.trim();
    if (!item) return;
    setExtraAccessories(list => (list.includes(item) || DEFAULT_ACCESSORIES.includes(item) ? list : [...list, item]));
    setLoanAccessories(list => [...new Set([...list, item])]);
    setCustomAccessory('');
  };
  const onLendKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void (continuous ? handleConfirmMultipleLoan() : handleLend());
  };
  const submitLend = () => void (continuous ? handleConfirmMultipleLoan() : handleLend());
  const nErr = queueDevices.length - queueAvailable.length;

  return (
    <section className="lo-card lo-form" aria-labelledby="lo-form-title" data-loan-form="">
      <div className="lo-card-head lo-form-head">
        <h2 id="lo-form-title" className="lo-h2">Prestar o devolver</h2>
        <div className="lo-form-tools">
          <Switch className="lo-cont-switch" checked={continuous} onCheckedChange={toggleContinuous} label="Escaneo continuo" />
          <Button size="sm" variant="ghost" icon={<IconSearch size={14} />} onClick={() => { codeInputRef.current?.focus(); codeInputRef.current?.select(); }}>Foco lector</Button>
          {!continuous && (
            <Button size="sm" variant="ghost" aria-expanded={cameraOpen} onClick={() => (cameraOpen ? stopCamera() : void openCamera())}>
              {cameraOpen ? 'Cerrar cámara' : 'Cámara'}
            </Button>
          )}
        </div>
      </div>

      <div className="lo-form-body">
        {consultationMode && (
          <div className="lo-consult" role="note">
            <IconLock size={14} />
            <span>Modo consulta: solo lectura. Podés buscar equipos, pero no prestar ni devolver.</span>
          </div>
        )}

        {status.element}

        {askExit && continuous && (
          <div className="lo-ask ui-enter" role="group" aria-label="Salir del escaneo continuo">
            <span className="lo-ask-text">Hay {queue.length} {queue.length === 1 ? 'equipo' : 'equipos'} en la lista. ¿Los conservás para la próxima vez?</span>
            <span className="lo-ask-actions">
              <Button size="sm" variant="secondary" onClick={() => exitContinuous(true)}>Conservar lista</Button>
              <Button size="sm" variant="secondary" onClick={() => exitContinuous(false)}>Vaciar lista</Button>
              <Button size="sm" variant="ghost" onClick={() => { setAskExit(false); focusCode(); }}>Seguir escaneando</Button>
            </span>
          </div>
        )}

        {!continuous && (cameraOpen || cameraError) && (
          <div className="lo-camera ui-enter">
            {cameraOpen && <video ref={videoRef} className="lo-camera-video" playsInline muted autoPlay aria-label="Vista de la cámara trasera" />}
            <div className="lo-camera-text">
              {cameraOpen && <span className="lo-camera-title">Apuntá al QR del equipo</span>}
              {cameraOpen && <span className="lo-muted">Cámara trasera. Al leer el código lo carga arriba y se cierra sola.</span>}
              {cameraError && <ScanMessage tone="warn" text={cameraError} />}
            </div>
          </div>
        )}

        <div className="lo-code-row">
          <label htmlFor="lo-code" className="ui-sr">Etiqueta, número o alias del equipo</label>
          <Input
            id="lo-code"
            ref={codeInputRef}
            className="lo-code"
            prefix={<IconSearch size={16} />}
            suffix={(
              <>
                {code && <button type="button" className="lo-code-clear" aria-label="Limpiar (Esc)" onClick={() => { setCode(''); setFormError(''); codeInputRef.current?.focus(); }}><IconX size={14} /></button>}
                <Kbd className="lo-hide-touch">/</Kbd>
              </>
            )}
            value={code}
            onValueChange={next => { setCode(next); setFormError(''); }}
            onKeyDown={onCodeKeyDown}
            placeholder={continuous ? 'Escaneá uno tras otro: cada Enter suma a la lista' : 'Escaneá o escribí: D1436, touch 34, plani 5'}
            autoComplete="off"
            spellCheck={false}
            data-loan-code=""
          />
          {continuous && (
            <Button className="lo-code-add" variant="secondary" disabled={!trimmed} onClick={() => addToContinuousScan(code)} iconEnd={<Kbd>↵</Kbd>}>
              Agregar a la lista
            </Button>
          )}
        </div>

        {!continuous && scanMessage && <ScanMessage tone={scanMessage.tone} text={scanMessage.text} success={scanMessage.success} />}

        {idle && (
          <p className="lo-help">Escaneá con el lector o escribí etiqueta, número o alias. <Kbd>Enter</Kbd> hace la acción: devuelve si está prestado, abre el préstamo si está libre.</p>
        )}

        {!continuous && selected && (
          <FoundDevice
            device={selected}
            state={selectedState}
            busy={busy}
            consultationMode={consultationMode}
            onReturn={() => void handleReturn()}
          />
        )}

        {!continuous && selected && selectedState === 'loaned' && (
          <div className="lo-frow">
            <span className="lo-flabel">Accesorios</span>
            <div className="lo-fcontrol">
              {expectedAccessories === null
                ? <span className="lo-muted">Buscando los accesorios del préstamo…</span>
                : expectedAccessories.length ? (
                  <>
                    <AccessoryToggles label="Accesorios entregados originalmente" items={expectedAccessories} checked={returnedAccessories} prefixOn="Volvió: " onToggle={item => setReturnedAccessories(list => toggleList(list, item))} />
                    <span className="lo-muted">Marcá lo que vuelve. No es obligatorio.</span>
                  </>
                ) : <span className="lo-muted">No se registraron accesorios para este préstamo.</span>}
            </div>
          </div>
        )}

        {!continuous && selected && selectedState === 'blocked' && (
          <div className="lo-msg lo-msg--error" role="alert">
            <span className="lo-msg-text">{getOperationalAlias(selected) || selected.etiqueta} · {selected.etiqueta} está {selected.estado || 'no disponible'}. No se puede prestar ni devolver desde acá.</span>
          </div>
        )}

        {!continuous && trimmed && matches.length > 1 && (
          <div className="lo-multi">
            <span className="lo-multi-text">Hay más de un equipo posible para "{trimmed}". Elegí uno:</span>
            <div className="lo-multi-list">
              {matches.slice(0, 8).map(device => (
                <Button key={device.id || device.etiqueta} size="sm" variant="secondary" onClick={() => { setCode(device.etiqueta); codeInputRef.current?.focus(); }}>
                  {getOperationalAlias(device) || device.etiqueta}<span className="lo-multi-tag g-num">{device.etiqueta}</span>
                </Button>
              ))}
              {matches.length > 8 && <span className="lo-muted">y {matches.length - 8} más: especificá mejor.</span>}
            </div>
          </div>
        )}

        {!continuous && trimmed && matches.length === 0 && (
          <NotFound devices={devices} query={trimmed} onPick={etiqueta => { setCode(etiqueta); codeInputRef.current?.focus(); }} />
        )}

        {continuous && (
          <div className="lo-queue" data-scan-list="">
            {scanMessage && <ScanMessage tone={scanMessage.tone} text={scanMessage.text} success={scanMessage.success} className="lo-scan-msg" />}
            <div className="lo-queue-head">
              <span className="lo-queue-sum g-num">Total {queueDevices.length} · Disponibles {queueAvailable.length} · Con error {nErr}</span>
              <Button size="sm" variant="ghost" disabled={!queueDevices.length || busy} onClick={() => { setQueue([]); setScanMessage(null); }}>Limpiar lista</Button>
            </div>
            <div className="lo-queue-list">
              {queueDevices.map(device => {
                const ok = getLoanState(device.estado) === 'available';
                return (
                  <div className={cx('lo-qrow', !ok && 'is-error')} key={device.id} data-queue-tag={device.etiqueta}>
                    <span className="lo-qrow-name">
                      <span className="lo-qrow-alias">{getOperationalAlias(device) || device.etiqueta}</span>
                      <span className="lo-qrow-tag g-num">{device.etiqueta}</span>
                    </span>
                    <span className="lo-qrow-type">{operationalTypeLabel(device)}</span>
                    <StatusText tone={ok ? 'normal' : 'bad'} className="lo-qrow-state">{ok ? 'Disponible' : `No disponible (${device.estado || 'sin estado'})`}</StatusText>
                    <Button size="sm" variant="ghost" aria-label={`Quitar ${getOperationalAlias(device) || device.etiqueta} de la lista`} onClick={() => setQueue(items => items.filter(item => item.id !== device.id))}>Quitar</Button>
                  </div>
                );
              })}
              {!queueDevices.length && <div className="lo-empty">Aún no escaneaste ningún equipo.</div>}
            </div>
          </div>
        )}

        {lendOpen && (
          <div className="lo-lend ui-enter" data-lend-form="">
            <div className="lo-lend-title">
              {continuous
                ? `Datos del préstamo · uno para ${queueAvailable.length === 1 ? 'el disponible' : `los ${queueAvailable.length} disponibles`} de la lista`
                : `Prestar ${selected ? getOperationalAlias(selected) || selected.etiqueta : ''}`}
            </div>

            <div className="lo-frow">
              <label htmlFor="lo-persona" className="lo-flabel">Persona</label>
              <div className="lo-fcontrol">
                <SuggestInput<LoanSuggestion>
                  id="lo-persona"
                  inputRef={personInputRef}
                  value={person}
                  onChange={next => { setPerson(next); setFormError(''); }}
                  placeholder="Nombre (escribí 2 letras para ver sugerencias)"
                  listLabel="Personas que ya pidieron equipos"
                  footer="Enter elige la marcada. Completa rol, ubicación, curso y motivo más usados."
                  fetcher={q => getLoanSuggestions(q).then(response => response.suggestions || [])}
                  itemKey={item => item.persona}
                  row={item => ({
                    name: item.persona,
                    hint: [item.rol, item.curso ? `${item.curso} · ${item.ubicacion}` : item.ubicacion, item.motivo].filter(Boolean).join(' · ') || 'sin datos previos',
                    times: `${item.count}×`
                  })}
                  onPick={applySuggestion}
                  onEnter={submitLend}
                />
              </div>
            </div>

            <div className="lo-frow">
              <span className="lo-flabel">Rol</span>
              <OptionGroup label="Rol" options={roleOptions.map(value => ({ value, label: value }))} value={role} onChange={value => { setRole(value); setFormError(''); }} />
            </div>

            <div className="lo-frow">
              <span className="lo-flabel">Ubicación</span>
              <div className="lo-fcontrol">
                <OptionGroup label="Ubicación" options={locationOptions.map(item => ({ value: item.label, label: item.label }))} value={location} onChange={value => { setLocation(value); setFormError(''); }} />
                {selectedLocation?.requiresDetail && (
                  <Input aria-label="Especificar ubicación" value={locationDetail} onValueChange={setLocationDetail} onKeyDown={onLendKey} placeholder="Especificá la ubicación" autoComplete="off" />
                )}
              </div>
            </div>

            {requiresSchoolCourse && (
              <div className="lo-frow">
                <span className="lo-flabel">Nivel y curso</span>
                <div className="lo-fcontrol">
                  <OptionGroup label="Nivel" mono options={SCHOOL_LEVEL_OPTIONS.map(value => ({ value, label: value }))} value={schoolLevel} onChange={value => { setSchoolLevel(value); setFormError(''); }} />
                  <GradeGrid label="Grado, año o curso" grades={gradeOptions} value={course} onChange={value => { setCourse(value); setFormError(''); }} />
                </div>
              </div>
            )}

            <div className="lo-frow">
              <span className="lo-flabel">Motivo</span>
              <div className="lo-fcontrol">
                <OptionGroup label="Motivo" allowEmpty={false} options={[{ value: '', label: 'Sin motivo' }, ...motiveOptions.map(item => ({ value: item.label, label: item.label }))]} value={reason} onChange={value => { setReason(value); setFormError(''); }} />
                {selectedReason?.requiresDetail && (
                  <Input aria-label="Especificar motivo" value={reasonDetail} onValueChange={setReasonDetail} onKeyDown={onLendKey} placeholder="Especificá el motivo" autoComplete="off" />
                )}
              </div>
            </div>

            <div className="lo-frow">
              <label htmlFor="lo-comment" className="lo-flabel">Comentario</label>
              <Input id="lo-comment" className="lo-fcontrol" value={comment} onValueChange={setComment} onKeyDown={onLendKey} placeholder="Opcional" autoComplete="off" />
            </div>

            <div className="lo-frow">
              <span className="lo-flabel">Accesorios</span>
              <div className="lo-fcontrol">
                <Button size="sm" variant="ghost" className="lo-acc-toggle" disabled={consultationMode} aria-expanded={accessoriesOpen} onClick={() => setAccessoriesOpen(value => !value)}>
                  {loanAccessories.length ? `Accesorios de entrega · ${loanAccessories.join(', ')}` : 'Agregar accesorios de entrega (opcional)'}
                </Button>
                {accessoriesOpen && (
                  <div className="lo-acc ui-enter">
                    <AccessoryToggles label="Accesorios de entrega" items={accessoryList} checked={loanAccessories} onToggle={item => setLoanAccessories(list => toggleList(list, item))} />
                    <div className="lo-acc-add">
                      <Input aria-label="Agregar otro accesorio" value={customAccessory} onValueChange={setCustomAccessory} placeholder="Agregar otro accesorio" autoComplete="off" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addCustomAccessory(); } }} />
                      <Button variant="secondary" onClick={addCustomAccessory} disabled={!customAccessory.trim()}>Agregar</Button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="lo-lend-actions">
              <Button
                variant="primary"
                disabled={consultationMode || (continuous && !queueAvailable.length)}
                loading={busy}
                loadingLabel="Prestando…"
                onClick={submitLend}
                iconEnd={<Kbd>↵</Kbd>}
              >
                {continuous ? `Confirmar préstamo múltiple (${queueAvailable.length})` : 'Prestar'}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => { resetFields(); if (!continuous) setCode(''); focusCode(); }}>Cancelar</Button>
              {formError && <span key={errorKey} className="lo-form-error t-msg-enter t-input is-shaking" role="alert">{formError}</span>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** Resultado en línea del equipo identificado: alias, etiqueta, estado y LA acción. */
function FoundDevice({ device, state, busy, consultationMode, onReturn }: { device: Device; state: string; busy: boolean; consultationMode: boolean; onReturn: () => void }) {
  const alias = getOperationalAlias(device) || operationalTypeLabel(device);
  let stateText = device.estado || 'Sin estado';
  let tone: StatusTextTone = 'normal';
  let detail = '';
  if (state === 'loaned') {
    const days = loanAgeDays(device.loanedAt);
    stateText = days ? `Prestado · hace ${days === 1 ? '1 día' : `${days} días`}` : 'Prestado';
    tone = days ? ageTone(days) : 'info';
    const where = [device.ubicacion, device.curso].filter(Boolean).join(' · ');
    const since = device.loanedAt ? `desde ${formatLoanDateTime(device.loanedAt)}` : '';
    detail = [device.prestadoA || 'Sin persona', device.rol, where, since].filter(Boolean).join(' · ');
  } else if (state === 'available') {
    stateText = 'Libre';
    detail = `${[device.dispositivo || 'Chromebook', device.marca, device.modelo].filter(Boolean).join(' ')} · en el mostrador`;
  } else {
    tone = 'bad';
    detail = [device.dispositivo, device.marca, device.modelo].filter(Boolean).join(' ') || '—';
  }
  return (
    <div className="lo-found ui-enter" data-found-tag={device.etiqueta}>
      <div className="lo-found-text">
        <div className="lo-found-line">
          <span className="lo-found-alias">{alias}</span>
          <span className="lo-found-tag g-num">{device.etiqueta}</span>
          <StatusText tone={tone} className="lo-found-state">{stateText}</StatusText>
        </div>
        <TruncatedText className="lo-found-detail">{detail}</TruncatedText>
      </div>
      {state === 'loaned' && (
        <Button variant="primary" className="lo-found-action" disabled={consultationMode} loading={busy} loadingLabel="Devolviendo…" onClick={onReturn} iconEnd={<Kbd>↵</Kbd>}>
          Devolver
        </Button>
      )}
    </div>
  );
}

/** Sin resultados: el aviso y, si hay, equipos con ese mismo número ("¿Quisiste decir…?"). */
function NotFound({ devices, query, onPick }: { devices: Device[]; query: string; onPick: (etiqueta: string) => void }) {
  const digits = query.replace(/\D+/g, '');
  const suggestions = digits
    ? devices.filter(device => getDeviceNumber(device) === digits || String(device.etiqueta || '').replace(/\D+/g, '').replace(/^0+/, '') === digits.replace(/^0+/, '')).slice(0, 4)
    : [];
  return (
    <div className="lo-notfound">
      <span className="lo-notfound-text" role="alert">No se encontró ningún equipo para "{query}".</span>
      {suggestions.length > 0 && (
        <span className="lo-notfound-sug">
          <span className="lo-muted">¿Quisiste decir</span>
          {suggestions.map(device => (
            <Button key={device.id || device.etiqueta} size="sm" variant="secondary" onClick={() => onPick(device.etiqueta)}>{getOperationalAlias(device) || device.etiqueta}</Button>
          ))}
          <span className="lo-muted">?</span>
        </span>
      )}
    </div>
  );
}

async function openPreferredCamera() {
  try {
    return await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  } catch {
    return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
}

function barcodeDetectorClass(): BarcodeDetectorConstructor | undefined {
  return (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
}

function normalizeStringOptions(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .map(item => (typeof item === 'string' ? { label: item, activo: true } : item as { label?: string; nombre?: string; activo?: boolean }))
    .filter(item => item && item.activo !== false)
    .map(item => String(item.label || item.nombre || '').trim())
    .filter(Boolean);
  return items.length ? items : fallback;
}

/** Ubicaciones y motivos: objetos {label, requiresDetail?, requiresCourse?} (tolera strings). */
function normalizeObjectOptions<T extends { label: string }>(value: unknown, fallback: T[]): T[] {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .map(item => (typeof item === 'string' ? { label: item } : item) as T & { nombre?: string; activo?: boolean })
    .filter(item => item && item.activo !== false)
    .map(item => ({ ...item, label: String(item.label || item.nombre || '').trim() }))
    .filter(item => item.label);
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
