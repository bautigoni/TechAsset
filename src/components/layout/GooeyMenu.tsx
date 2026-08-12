import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export type GooeyMenuItem = {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
};

export type GooeyDirection = 'up' | 'down' | 'left' | 'right';

// Radio del abanico, en px del viewBox (que es 1:1 con px de CSS).
const FAN_RADIUS = 64;

// Centro del abanico dentro del viewBox de 200×200, por dirección. El lienzo
// es cuadrado para que el abanico horizontal tenga tanto lugar como el
// vertical. Se corre el centro en vez de voltear el SVG con un transform:
// las pasadas de sombra del filtro tienen `dy` con signo y quedarían
// apuntando al revés.
const FAN_CENTER: Record<GooeyDirection, [number, number]> = {
  up: [100, 160],
  down: [100, 40],
  left: [160, 100],
  right: [40, 100]
};
// Apertura por satélite, en grados. Con 3 satélites da exactamente el abanico
// de la receta: (-54,-34) / (0,-64) / (54,-34).
const STEP_DEG = 58;
const MAX_SPAN_DEG = 116;

/**
 * Receta `gooey-plus-menu` (Pro) de transitions.dev, portada a TS.
 *
 * Un botón "+" que se parte en satélites líquidos y vuelve a fusionarse. El
 * efecto sale de un filtro SVG de dos capas: abajo van círculos que espejan la
 * geometría de los botones 1:1 y reciben el filtro (blur → golpe de contraste
 * de alpha → composite del original), y arriba van los botones reales sin
 * filtrar, para que los íconos queden nítidos. El mismo filtro deriva la
 * sombra de la silueta ya fusionada, así una sola sombra sigue al líquido en
 * todos los estados.
 *
 * Cosas del original que parecen prolijables y NO lo son:
 * - El filtro se aplica adentro del <svg> con <g filter>, nunca con CSS
 *   `filter: url(#id)` sobre HTML: WebKit lo renderiza mal.
 * - `transform` clásico en vez de la propiedad `translate:`, y `animation-*`
 *   en longhand en vez del shorthand: en WebKit el abanico se desincroniza y
 *   la anticipación corre en 0s.
 * - `openRef` duplica el estado porque los listeners de documento se atan una
 *   sola vez y leerían un `open` viejo.
 */
export function GooeyMenu({ items, ariaLabel = 'Acciones rápidas', direction = 'left' }: { items: GooeyMenuItem[]; ariaLabel?: string; direction?: GooeyDirection }) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const blurRef = useRef<SVGFEGaussianBlurElement | null>(null);
  const matrixRef = useRef<SVGFEColorMatrixElement | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const openRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [anticipating, setAnticipating] = useState(false);
  // El id del filtro es global al documento: derivarlo de useId permite tener
  // más de un menú en pantalla sin que se pisen.
  const filterId = `t-goo-filter-${useId().replace(/:/g, '')}`;

  // --goo-blur y --goo-contrast son atributos SVG, no propiedades CSS, así que
  // hay que espejarlos a mano sobre las primitivas en cada toggle.
  const applyGooKnobs = useCallback(() => {
    const blur = readNum('--goo-blur', 6);
    const slope = readNum('--goo-contrast', 18);
    // El intercept escala con la pendiente para que el umbral del goo quede en
    // el mismo cruce de alpha (el par clásico es 18 / -7).
    const intercept = -((slope * 7) / 18);
    blurRef.current?.setAttribute('stdDeviation', String(blur));
    matrixRef.current?.setAttribute('values', `1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${slope} ${intercept}`);
  }, []);

  const setMenuOpen = useCallback((next: boolean) => {
    if (openRef.current === next) return;
    openRef.current = next;
    applyGooKnobs();
    setOpen(next);
    window.clearTimeout(timerRef.current);
    if (next) { setAnticipating(false); return; }
    // Al cerrar, el conjunto hace un amague hacia abajo contra la inercia de
    // los satélites que vuelven.
    setAnticipating(true);
    timerRef.current = window.setTimeout(() => setAnticipating(false), readNum('--goo-anticip-dur', 700) + 50);
  }, [applyGooKnobs]);

  useEffect(() => {
    applyGooKnobs();
    return () => window.clearTimeout(timerRef.current);
  }, [applyGooKnobs]);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [setMenuOpen]);

  const fan = items.map((_, index) => fanOffset(index, items.length, direction));
  // El ancla mide lo que el botón (40px) y el abanico desborda. La capa del
  // goo se corre a mano para que su centro en el viewBox caiga justo sobre el
  // centro del botón, que en coordenadas del ancla es (20, 20).
  const [blobCx, blobCy] = FAN_CENTER[direction];
  const layerStyle: CSSProperties = { left: 20 - blobCx, top: 20 - blobCy };

  // Con un solo satélite la silueta fusionada no se lee como un cuerpo
  // líquido: es un botón que escupe otro botón. En ese caso no va nada — la
  // acción ya vive en la barra de la página. (Pasa cuando los ítems dependen
  // de permisos y al usuario le queda uno solo.)
  if (items.length < 2) return null;

  return (
    <div
      ref={anchorRef}
      className={`t-goo-anchor${anticipating ? ' is-anticipating' : ''}`}
      data-open={open ? 'true' : 'false'}
    >
      <svg className="t-goo-layer" style={layerStyle} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
        <defs>
          {/* colorInterpolationFilters="sRGB" es obligatorio: con el linearRGB
              por defecto la caída de la sombra no coincide con la del
              box-shadow de CSS que está reproduciendo. */}
          <filter id={filterId} x="-60%" y="-60%" width="220%" height="220%" colorInterpolationFilters="sRGB">
            <feGaussianBlur ref={blurRef} in="SourceGraphic" stdDeviation="6" result="blur" />
            <feColorMatrix ref={matrixRef} in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" result="goo" />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" result="shape" />

            {/* Sombra emulada adentro del MISMO filtro para que abrace la
                silueta fusionada, puentes incluidos. Cada pasada se arma
                aparte desde `shape` y se mergea detrás, igual que pinta el
                box-shadow. Encadenar feDropShadow haría que cada una
                sombreara el resultado anterior y se compondrían. */}
            <feColorMatrix in="shape" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 60 -29.5" result="ring-solid" />
            <feMorphology in="ring-solid" operator="dilate" radius="1" result="ring-a" />
            <feFlood floodColor="#000000" floodOpacity="0.06" result="ring-c" />
            <feComposite in="ring-c" in2="ring-a" operator="in" result="ring" />
            <feGaussianBlur in="shape" stdDeviation="3" result="s2-b" />
            <feOffset in="s2-b" dy="2" result="s2-o" />
            <feFlood floodColor="#000000" floodOpacity="0.05" result="s2-c" />
            <feComposite in="s2-c" in2="s2-o" operator="in" result="s2" />
            <feGaussianBlur in="shape" stdDeviation="21" result="s3-b" />
            <feOffset in="s3-b" dy="4" result="s3-o" />
            <feFlood floodColor="#000000" floodOpacity="0.06" result="s3-c" />
            <feComposite in="s3-c" in2="s3-o" operator="in" result="s3" />
            <feMerge>
              <feMergeNode in="s3" />
              <feMergeNode in="s2" />
              <feMergeNode in="ring" />
              <feMergeNode in="shape" />
            </feMerge>
          </filter>
        </defs>
        <g filter={`url(#${filterId})`}>
          {items.map((item, index) => (
            <circle key={item.id} className="t-goo-blob" cx={blobCx} cy={blobCy} r="20" style={fan[index]} />
          ))}
          <circle className="t-goo-blob t-goo-blob-main" cx={blobCx} cy={blobCy} r="20" />
        </g>
      </svg>

      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          className="t-goo-item"
          style={fan[index]}
          aria-label={item.label}
          title={item.label}
          // Inalcanzables por teclado mientras están apilados debajo del botón
          // principal; con el menú abierto sí entran en el orden de tabulado.
          tabIndex={open ? 0 : -1}
          onClick={() => { item.onSelect(); setMenuOpen(false); }}
        >
          {item.icon}
        </button>
      ))}

      {/* El "+" girado 45° ES la X: un solo ícono cubre los dos estados. */}
      <button
        type="button"
        className="t-goo-main"
        aria-expanded={open}
        aria-label={open ? 'Cerrar acciones' : ariaLabel}
        onClick={event => { event.stopPropagation(); setMenuOpen(!openRef.current); }}
      >
        <span className="t-goo-swap">
          <span className="t-goo-icon">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <path d="M10 4V16M4 10H16" />
            </svg>
          </span>
        </span>
      </button>
    </div>
  );
}

/**
 * Reparte los satélites en un arco simétrico de radio constante por encima del
 * botón. Calcularlo (en vez de hardcodear offsets) es lo que permite que el
 * mismo componente sirva para 2, 3 o 4 sin que la silueta fusionada deje de
 * leerse como un solo cuerpo.
 */
function fanOffset(index: number, count: number, direction: GooeyDirection): CSSProperties {
  const span = count <= 1 ? 0 : Math.min(MAX_SPAN_DEG, STEP_DEG * (count - 1));
  // Desvío respecto del eje principal: los satélites se reparten simétricos
  // alrededor de la dirección elegida.
  const deg = count <= 1 ? 0 : -span / 2 + (span / (count - 1)) * index;
  const rad = (deg * Math.PI) / 180;
  const along = Math.round(Math.cos(rad) * FAN_RADIUS);
  const across = Math.round(Math.sin(rad) * FAN_RADIUS);
  const horizontal = direction === 'left' || direction === 'right';
  const sign = direction === 'up' || direction === 'left' ? -1 : 1;
  return {
    '--fx': `${horizontal ? sign * along : across}px`,
    '--fy': `${horizontal ? across : sign * along}px`,
    '--i': index
  } as CSSProperties;
}

// Lee una custom property numérica de :root, con unidades ms/s.
function readNum(name: string, fallback: number) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return fallback;
  if (raw.endsWith('ms')) return parseFloat(raw);
  if (raw.endsWith('s')) return parseFloat(raw) * 1000;
  const value = parseFloat(raw);
  return Number.isNaN(value) ? fallback : value;
}
