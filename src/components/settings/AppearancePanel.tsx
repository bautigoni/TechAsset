import type { KeyboardEvent, ReactNode } from 'react';
import { cx } from '../../ui/util';
import { setAppearance, useAppearance, type Density, type TextSize, type ThemePref } from '../../utils/theme';
import { Card, CardBody, CardFoot } from './settingsKit';

const THEME_OPTIONS: Array<{ value: ThemePref; label: string; desc: string }> = [
  { value: 'dark', label: 'Oscuro', desc: 'Grafito. El de todos los días.' },
  { value: 'light', label: 'Claro', desc: 'Fondo claro, el mismo orden y los mismos colores de estado.' },
  { value: 'system', label: 'Sistema', desc: 'Sigue el modo de tu computadora o celular.' }
];

const DENSITY_OPTIONS: Array<{ value: Density; label: string; desc: string }> = [
  { value: 'comfortable', label: 'Cómoda', desc: 'Filas de 40 px y botones de 36. Lo de siempre.' },
  { value: 'compact', label: 'Compacta', desc: 'Filas de 34 px: entran más equipos por pantalla.' }
];

const TEXT_SIZE_OPTIONS: Array<{ value: TextSize; label: string; desc: string }> = [
  { value: 'normal', label: 'Normal', desc: '100 %' },
  { value: 'large', label: 'Grande', desc: '110 %' },
  { value: 'xlarge', label: 'Muy grande', desc: '120 %' }
];

/** Vista previa en miniatura con los colores reales del tema (clases g-theme-*). */
function ThemePreview({ theme }: { theme: ThemePref }) {
  if (theme === 'system') {
    return (
      <span className="cfg-prv is-split" aria-hidden="true">
        <span className="cfg-prv-half g-theme-dark"><span className="cfg-prv-side" /><span className="cfg-prv-main"><span className="cfg-prv-line" /><span className="cfg-prv-card" /></span></span>
        <span className="cfg-prv-half g-theme-light"><span className="cfg-prv-side" /><span className="cfg-prv-main"><span className="cfg-prv-line" /><span className="cfg-prv-card" /></span></span>
      </span>
    );
  }
  return (
    <span className={`cfg-prv g-theme-${theme}`} aria-hidden="true">
      <span className="cfg-prv-side" />
      <span className="cfg-prv-main"><span className="cfg-prv-line" /><span className="cfg-prv-card" /><span className="cfg-prv-line is-short" /></span>
    </span>
  );
}

/** Radios grandes (tarjetas) con flechas: la selección sigue al foco. */
function OptionCards<V extends string>({ label, value, options, onChange, render, columns }: {
  label: string;
  value: V;
  options: Array<{ value: V; label: string; desc: string }>;
  onChange: (value: V) => void;
  render?: (value: V) => ReactNode;
  columns: 2 | 3;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = options.findIndex(option => option.value === value);
    let next = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % options.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    if (next < 0) return;
    event.preventDefault();
    onChange(options[next].value);
    (event.currentTarget.children[next] as HTMLElement | undefined)?.focus();
  };
  return (
    <div className={cx('cfg-opts', columns === 3 ? 'is-3' : 'is-2')} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map(option => {
        const on = option.value === value;
        return (
          // div y no button: la tarjeta lleva varias líneas de texto (un botón no se parte).
          <div
            key={option.value}
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className={cx('cfg-opt', on && 'is-on')}
            onClick={() => onChange(option.value)}
            onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); onChange(option.value); } }}
          >
            {render?.(option.value)}
            <span className="cfg-opt-h">
              <span className="cfg-strong">{option.label}</span>
              {on && <span className="cfg-t3">Elegido</span>}
            </span>
            <span className="cfg-t2 cfg-opt-d">{option.desc}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Configuración › Apariencia: Tema, Densidad y Tamaño de texto (etapa 1). Es
 * una preferencia de cada usuario (localStorage + /api/user/prefs), no de la
 * sede: funciona también en modo consulta.
 */
export function AppearancePanel({ header }: { header: (actions?: ReactNode) => ReactNode }) {
  const { theme, density, textSize } = useAppearance();
  return (
    <>
      {header()}
      <Card title="Tema">
        <CardBody>
          <OptionCards label="Tema" columns={3} value={theme} options={THEME_OPTIONS} onChange={next => setAppearance({ theme: next })} render={value => <ThemePreview theme={value} />} />
        </CardBody>
      </Card>
      <Card title="Densidad">
        <CardBody>
          <OptionCards label="Densidad" columns={2} value={density} options={DENSITY_OPTIONS} onChange={next => setAppearance({ density: next })} />
        </CardBody>
      </Card>
      <Card title="Tamaño de texto">
        <CardBody>
          <OptionCards label="Tamaño de texto" columns={3} value={textSize} options={TEXT_SIZE_OPTIONS} onChange={next => setAppearance({ textSize: next })} />
        </CardBody>
        <CardFoot status="Se guarda en tu usuario: lo ves igual en cualquier computadora o celular." />
      </Card>
    </>
  );
}
