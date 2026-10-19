/**
 * Mobile = pantalla fija (decisión del dueño, docs/redesign/PLAN.md §5.1): en el
 * celular no se puede hacer zoom con dos dedos.
 *
 * El viewport de index.html ya dice `maximum-scale=1, user-scalable=no`, y con
 * eso alcanza en Android. Safari de iPhone lo IGNORA a propósito, así que acá se
 * cancelan los gestos de pinza (`gesture*`, propios de WebKit) y cualquier
 * `touchmove` con dos o más dedos. Tiene que ser `passive: false` para que el
 * `preventDefault` valga.
 *
 * Excepción: el plano de aulas y el Canvas tienen (o van a tener) su propio zoom
 * dentro de su recuadro, así que ahí no se cancela nada.
 */
const PINCH_ZONES = '.classroom-model-canvas, .infinite-canvas, [data-allow-pinch]';

function inPinchZone(target: EventTarget | null) {
  return target instanceof Element && target.closest(PINCH_ZONES) !== null;
}

function isIos() {
  const nav = navigator;
  // iPadOS se presenta como Mac: se distingue por la pantalla táctil.
  return /iP(hone|ad|od)/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

let installed = false;

export function installMobileZoomLock() {
  if (installed || typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!isIos()) return;
  installed = true;
  const options: AddEventListenerOptions = { passive: false };

  const cancelGesture = (event: Event) => {
    if (!inPinchZone(event.target)) event.preventDefault();
  };
  document.addEventListener('gesturestart', cancelGesture, options);
  document.addEventListener('gesturechange', cancelGesture, options);
  document.addEventListener('gestureend', cancelGesture, options);

  document.addEventListener('touchmove', (event: TouchEvent) => {
    if (event.touches.length > 1 && !inPinchZone(event.target)) event.preventDefault();
  }, options);

  // Si igual quedó agrandada (por ejemplo, al volver de otra app), se reescribe
  // el viewport para que Safari vuelva a escala 1.
  const viewport = window.visualViewport;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!viewport || !meta) return;
  const content = meta.content;
  const resetScale = () => {
    if (document.visibilityState !== 'visible' || Math.abs(viewport.scale - 1) < 0.01) return;
    meta.content = `${content}, minimum-scale=1`;
    window.requestAnimationFrame(() => { meta.content = content; });
  };
  document.addEventListener('visibilitychange', resetScale);
  window.addEventListener('pageshow', resetScale);
}
