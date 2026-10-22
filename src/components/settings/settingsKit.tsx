import { createContext, useId, useContext, useEffect, useState, type ReactNode } from 'react';
import { Button, Checkbox, Segmented, Select } from '../../ui';
import { IconCheck } from '../../ui/icons';
import { Reveal, useSmoothHeight } from './Reveal';
import { cx } from '../../ui/util';
import { ApiError } from '../../services/apiClient';

/* ═══════════════════════════════════════════════════════════════════════
   Piezas compartidas de Configuración (etapa 8b).
   ═══════════════════════════════════════════════════════════════════════ */

/** Mensaje de error para mostrar en línea: el motivo real del server (incluido el de un 403). */
export function errorText(reason: unknown, fallback: string) {
  if (reason instanceof ApiError) {
    if (reason.status === 403) return reason.message && !/^HTTP 403/.test(reason.message) ? reason.message : 'No tenés permiso para hacer esto.';
    if (reason.status === 429) return reason.message;
    return reason.message || fallback;
  }
  if (reason instanceof Error && reason.message) {
    if (/Failed to fetch|NetworkError|Load failed/i.test(reason.message)) return `${fallback} Revisá la conexión y probá de nuevo.`;
    return reason.message;
  }
  return fallback;
}

/* ── Card, filas de ajuste y pie con estado ───────────────────────────────── */

export function Card({ title, meta, actions, children, className, labelledBy, ariaLabel, heightKey }: {
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
  ariaLabel?: string;
  /**
   * Cuando cambia (p. ej. de cargando a cargado), la tarjeta pasa de su alto
   * al nuevo con transición en vez de saltar.
   */
  heightKey?: unknown;
}) {
  const headId = `cfg-h${useId().replace(/:/g, '')}`;
  const smooth = useSmoothHeight<HTMLElement>(heightKey);
  return (
    <section ref={heightKey === undefined ? undefined : smooth} className={cx('cfg-card', className)} aria-labelledby={title ? labelledBy || headId : undefined} aria-label={title ? undefined : ariaLabel}>
      {(title || meta || actions) && (
        <div className="cfg-card-h">
          {title && <h3 id={labelledBy || headId} className="cfg-card-t">{title}</h3>}
          {meta && <span className="cfg-card-meta">{meta}</span>}
          {actions && <div className="cfg-card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('cfg-card-b', className)}>{children}</div>;
}

/** Pie de card: estado a la izquierda (aria-live), acciones a la derecha. */
export function CardFoot({ status, tone, children }: { status?: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'muted'; children?: ReactNode }) {
  return (
    <div className="cfg-card-f">
      <div className={cx('cfg-card-fs', tone && `is-${tone}`)} aria-live="polite">
        {tone === 'ok' && status ? <IconCheck size={14} /> : null}
        {status}
      </div>
      {children && <div className="cfg-card-fa">{children}</div>}
    </div>
  );
}

/** Fila de ajuste: nombre y descripción a la izquierda, control a la derecha (bajan en angosto). */
export function SettingRow({ name, desc, children, nameId }: { name: ReactNode; desc?: ReactNode; children?: ReactNode; nameId?: string }) {
  return (
    <div className="cfg-row">
      <div className="cfg-row-t">
        <div className="cfg-row-n" id={nameId}>{name}</div>
        {desc && <div className="cfg-row-d">{desc}</div>}
      </div>
      {children !== undefined && <div className="cfg-row-c">{children}</div>}
    </div>
  );
}

export { Reveal } from './Reveal';

/** Aviso fijo de un bloque (no flota): una línea con borde arriba. */
export function Notice({ tone, children, role }: { tone?: 'warn' | 'bad' | 'ok' | 'info'; children: ReactNode; role?: 'status' | 'alert' }) {
  return <div className={cx('cfg-notice', tone && `is-${tone}`)} role={role}>{children}</div>;
}

/* ── Copiar al portapapeles con respuesta en el mismo botón ─────────────── */

export function CopyButton({ text, label = 'Copiar link', size = 'sm' }: { text: string; label?: string; size?: 'sm' | 'md' }) {
  const [state, setState] = useState<'idle' | 'ok' | 'error'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = window.setTimeout(() => setState('idle'), 2400);
    return () => window.clearTimeout(timer);
  }, [state]);
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('sin portapapeles');
      await navigator.clipboard.writeText(text);
      setState('ok');
    } catch {
      setState('error');
    }
  };
  return (
    <span className="cfg-copy">
      <Button size={size} variant="secondary" icon={state === 'ok' ? <IconCheck size={14} /> : undefined} onClick={() => void copy()}>
        {state === 'ok' ? 'Copiado' : label}
      </Button>
      <Reveal when={state === 'error'} row>
        <span className="cfg-copy-err" role="alert">No se pudo copiar: seleccioná el link y copialo a mano.</span>
      </Reveal>
    </span>
  );
}

/* ── Cambios sin guardar ──────────────────────────────────────────────────
   Cada panel avisa si tiene cambios; la página pide confirmar en línea antes
   de cambiar de panel y el navegador avisa antes de recargar o cerrar. Si
   igual se sale de Configuración (menú), el borrador queda guardado en memoria
   y se recupera al volver. */

/**
 * `source` distingue varios formularios del mismo panel (la edición de dos
 * usuarios a la vez): el panel queda "sin guardar" mientras alguno lo esté.
 */
type DirtyApi = { setDirty: (key: string, dirty: boolean, source?: string) => void };
export const DirtyContext = createContext<DirtyApi>({ setDirty: () => undefined });

export function useDirty(key: string, dirty: boolean) {
  const { setDirty } = useContext(DirtyContext);
  const source = useId();
  useEffect(() => { setDirty(key, dirty, source); }, [key, dirty, setDirty, source]);
  useEffect(() => () => setDirty(key, false, source), [key, setDirty, source]);
}

// Borradores en memoria por sede y sección (compartidos con Caja chica, Accesos y Herramientas).
export { peekDraft, dropDraft, useKeepDraft } from '../../utils/drafts';

/**
 * Casilla con nombre y descripción largos: la casilla es el control y el texto
 * va en un <label> aparte (así el texto puede ocupar dos líneas sin que el
 * botón "se parta"; tocar el texto también marca).
 */
export function CheckField({ checked, onChange, label, description, disabled, className }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const id = `cfg-ck${useId().replace(/:/g, '')}`;
  return (
    <div className={cx('cfg-checkf', disabled && 'is-disabled', className)}>
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={next => onChange(next)} />
      <label htmlFor={id} className="cfg-checkf-t">
        <span className="cfg-checkf-l">{label}</span>
        {description && <span className="cfg-checkf-d">{description}</span>}
      </label>
    </div>
  );
}

/**
 * Elegir uno entre pocos (rol, turno, estado): segmentado que envuelve si son
 * pocos y cortos; con muchos o largos, el Select propio (lista en línea).
 */
export function ChoiceField({ label, value, options, onChange, disabled, hint }: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
  hint?: ReactNode;
}) {
  const compact = options.length <= 5 && options.every(option => option.label.length <= 22);
  return (
    <div className="cfg-choice">
      {compact
        ? <Segmented label={label} value={value} options={options} onChange={onChange} disabled={disabled} />
        : <Select label={label} value={value} options={options} onChange={onChange} disabled={disabled} />}
      {hint && <span className="cfg-hint">{hint}</span>}
    </div>
  );
}
