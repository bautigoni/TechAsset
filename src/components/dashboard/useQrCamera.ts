import { useCallback, useEffect, useRef, useState } from 'react';
import { parseScannedCode } from '../../utils/normalizeSearch';

/*
 * Cámara para leer el QR de un equipo (botón de cámara de la barra del Inicio
 * en mobile). Misma mecánica que Préstamos: cámara trasera preferida, aviso
 * si no hay HTTPS o permisos, BarcodeDetector si el navegador lo tiene; al
 * leer un QR nuevo lo entrega y cierra la cámara.
 */

type Detector = { detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>> };
type DetectorClass = new (options?: { formats?: string[] }) => Detector;

const detectorClass = () => (window as Window & { BarcodeDetector?: DetectorClass }).BarcodeDetector;

async function openPreferredCamera() {
  try {
    return await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  } catch {
    return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
}

export function useQrCamera(onCode: (code: string) => void) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  const stop = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setOpen(false);
  }, []);

  const start = useCallback(async () => {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Este navegador no permite usar la cámara. Escribí el código.');
      return;
    }
    const host = window.location.hostname;
    if (!window.isSecureContext && !['localhost', '127.0.0.1', '::1'].includes(host)) {
      setError('La cámara necesita HTTPS. Escribí el código.');
      return;
    }
    try {
      stop();
      streamRef.current = await openPreferredCamera();
      setOpen(true);
      if (!detectorClass()) setError('Este navegador no lee QR: la cámara queda de apoyo y el código se escribe a mano.');
    } catch {
      setError('No se pudo abrir la cámara. Revisá los permisos del navegador.');
      setOpen(false);
    }
  }, [stop]);

  useEffect(() => {
    if (!open || !videoRef.current || !streamRef.current) return;
    const video = videoRef.current;
    video.srcObject = streamRef.current;
    let cancelled = false;
    void video.play().then(() => {
      const Detector = detectorClass();
      if (!Detector || cancelled) return;
      const detector = new Detector({ formats: ['qr_code'] });
      const scan = async () => {
        if (cancelled || !streamRef.current) return;
        try {
          if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            const codes = await detector.detect(video);
            const parsed = parseScannedCode(codes.find(item => item.rawValue)?.rawValue || '');
            if (parsed) { stop(); onCodeRef.current(parsed); return; }
          }
        } catch {
          setError('No se pudo leer el QR. Escribí el código.');
        }
        frameRef.current = requestAnimationFrame(() => { void scan(); });
      };
      void scan();
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [open, stop]);

  useEffect(() => stop, [stop]);

  return { open, error, videoRef, start, stop, clearError: () => setError('') };
}
