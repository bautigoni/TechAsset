/**
 * "Escanear" de la barra inferior (mobile): antes de pedir la cámara se mira si
 * hay una que se pueda usar. Si no, se va directo a escribir el código a mano
 * con un aviso en criollo (sin "HTTPS", "permisos del navegador" ni un panel
 * de cámara que queda pegado). Solo lecturas: no pide permiso ni prende nada.
 */
export type CameraBlocker = 'none' | 'denied' | 'insecure' | null;

export async function cameraBlocker(): Promise<CameraBlocker> {
  if (typeof navigator === 'undefined') return 'none';
  const media = navigator.mediaDevices;
  if (!window.isSecureContext) {
    const host = window.location.hostname;
    if (!(host === 'localhost' || host === '127.0.0.1' || host === '::1')) return 'insecure';
  }
  if (!media?.getUserMedia) return 'none';
  try {
    const status = await navigator.permissions?.query({ name: 'camera' as PermissionName });
    if (status?.state === 'denied') return 'denied';
  } catch { /* el navegador no deja consultar el permiso de cámara: se sigue */ }
  try {
    // Sin permiso todavía, igual lista una entrada por tipo (sin nombre): alcanza para saber si hay cámara.
    const devices = await media.enumerateDevices();
    if (!devices.some(device => device.kind === 'videoinput')) return 'none';
  } catch { /* sin lista: que lo intente la pantalla de Préstamos */ }
  return null;
}

export function cameraBlockerText(reason: Exclude<CameraBlocker, null>, example: string) {
  const type = `escribí el número del equipo${example ? ` (por ejemplo, ${example})` : ''}`;
  if (reason === 'denied') return `El navegador tiene bloqueada la cámara: ${type} o habilitala en los ajustes del navegador.`;
  if (reason === 'insecure') return `En esta dirección la cámara no está disponible: ${type}.`;
  return `No encontramos una cámara en este dispositivo: ${type}.`;
}

/**
 * Lleva el foco al campo del código de Préstamos apenas aparece (la vista puede
 * estar cargando su chunk). Lo deja a la vista sin mover la página de golpe.
 */
export function focusLoanCode(timeoutMs = 4000) {
  const started = performance.now();
  const tick = () => {
    const field = document.querySelector<HTMLInputElement>('#lo-code, [data-loan-code]');
    if (field && !field.disabled && field.offsetParent !== null) {
      field.focus({ preventScroll: true });
      field.scrollIntoView({ block: 'nearest', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      return;
    }
    if (performance.now() - started < timeoutMs) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
