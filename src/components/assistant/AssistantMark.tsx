import './mark.css';

export type AssistantMarkVariant = 'orb' | 'ring' | 'duo';
export type AssistantMarkState = 'idle' | 'thinking' | 'listening' | 'speaking';

/**
 * Marca del asistente: inspirada en el "orb" del agente de voz de ElevenLabs,
 * en versión sobria (docs/redesign/ESTETICA-ELEVENLABS.md). Una esfera chica en
 * los tonos del acento con sombreado tonal mínimo: sin halo, sin glow, sin
 * colores fuera de la familia del acento. Quieta por defecto; se mueve lento
 * solo mientras el asistente piensa, escucha o habla, y nunca con
 * `prefers-reduced-motion: reduce`.
 *
 * `variant` (las tres están en Componentes UI para que el dueño elija):
 *   orb  = esfera con un brillo que gira despacio (la elegida por defecto)
 *   ring = anillo fino con núcleo que respira
 *   duo  = dos esferas que se superponen y orbitan
 *
 * Solo CSS (sin canvas ni WebGL): va en la barra superior, pesa nada.
 */
export function AssistantMark({ size = 18, state = 'idle', variant = 'orb', className }: {
  size?: number;
  state?: AssistantMarkState;
  variant?: AssistantMarkVariant;
  className?: string;
}) {
  return (
    <span
      className={`asst-mark asst-mark--${variant}${className ? ` ${className}` : ''}`}
      data-state={state}
      style={{ ['--mark-size' as string]: `${size}px` }}
      aria-hidden="true"
    >
      <span className="asst-mark-core" />
    </span>
  );
}
