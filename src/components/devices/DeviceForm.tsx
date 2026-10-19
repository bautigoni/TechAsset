import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Device } from '../../types';
import { Button, Collapse, ErrorState, Eyebrow, IconButton, Input, Segmented, Textarea, icons } from '../../ui';
import { getDeviceCategories } from '../../services/devicesApi';
import { errorMessage } from '../layout/Feedback';
import { MANUAL_STATES, isLoaned, stateLabel } from './deviceView';

const BASE_CATEGORIES = ['Tablet', 'Notebook', 'Chromebook', 'Plani', 'Touch', 'TIC', 'Dell', 'Cámara', 'Proyector', 'Router', 'Impresora', 'Otro'];
const FILTERS = ['Touch', 'Dell', 'TIC', 'Tablet', 'Plani'];
const NEW_STATES = ['Disponible', 'Prestado', 'No encontrada', 'Fuera de servicio', 'En reparación', 'Sin revisar'];

/** Igual que `normalizeTag` del server: 1436 → D1436, d 01436 → D1436. */
export function normalizeTagInput(value: string) {
  const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  const number = raw.match(/^D?0*(\d{1,5})$/)?.[1];
  return number ? `D${number.padStart(4, '0')}` : raw;
}

export type DeviceFormSave = Partial<Device> & { originalEtiqueta?: string };

type Draft = {
  etiqueta: string; numero: string; categoria: string; filtro: string; dispositivo: string;
  marca: string; modelo: string; sn: string; mac: string; estado: string; aliasOperativo: string; comentarios: string;
};

/**
 * Alta y edición de un equipo, en línea (debajo de su fila o arriba de la
 * lista). Etiqueta y categoría obligatorias; Enter guarda, Esc cancela.
 * Cambiar el estado de un equipo existente se aplica de verdad (antes el
 * estado guardado en el equipo perdía contra el último préstamo/devolución y
 * parecía que no guardaba): `estadoChanged` le avisa a la página.
 */
export function DeviceForm({ initial, existingTags, saving, onSave, onCancel }: {
  initial?: Device;
  existingTags: Set<string>;
  saving?: boolean;
  onSave: (device: DeviceFormSave, estadoChanged: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const editing = Boolean(initial);
  const loaned = initial ? isLoaned(initial) : false;
  const [draft, setDraft] = useState<Draft>(() => ({
    etiqueta: initial?.etiqueta || '',
    numero: initial?.numero || initial?.numeroOperativo || '',
    categoria: initial?.categoria || (initial ? '' : 'Chromebook'),
    filtro: initial?.filtro || '',
    dispositivo: initial?.dispositivo || (initial ? '' : 'Chromebook'),
    marca: initial?.marca || '',
    modelo: initial?.modelo || '',
    sn: initial?.sn || '',
    mac: initial?.mac || '',
    estado: initial ? stateLabel(initial) : 'Disponible',
    aliasOperativo: initial?.aliasOperativo || '',
    comentarios: initial?.comentarios || ''
  }));
  const [categories, setCategories] = useState<string[]>(BASE_CATEGORIES);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const firstRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    firstRef.current?.focus({ preventScroll: true });
    // Las sugerencias no son críticas: si fallan quedan las fijas.
    getDeviceCategories()
      .then(response => setCategories(current => Array.from(new Set([...current, ...response.items.map(item => item.nombre).filter(Boolean)])).sort((a, b) => a.localeCompare(b, 'es'))))
      .catch(() => undefined);
  }, []);

  const set = (key: keyof Draft) => (value: string) => setDraft(current => ({ ...current, [key]: value }));
  const tag = normalizeTagInput(draft.etiqueta);
  const original = initial?.etiqueta || '';
  const renaming = editing && tag && tag !== normalizeTagInput(original);
  const duplicate = Boolean(tag) && (!editing || renaming) && existingTags.has(tag);
  const tagError = touched && !tag ? 'La etiqueta es obligatoria.' : duplicate ? `${tag} ya existe en esta sede: se van a pisar sus datos.` : '';
  const catError = touched && !draft.categoria.trim() ? 'Elegí o escribí una categoría.' : '';
  const tagHint = tag && tag !== draft.etiqueta.trim() ? `Se guarda como ${tag}` : 'Ej. D1436 o 1436';

  const catChips = useMemo(() => {
    const needle = draft.categoria.trim().toLowerCase();
    // Con una categoría ya elegida se ofrecen las otras; tipeando, las que coinciden.
    const chosen = categories.some(item => item.toLowerCase() === needle);
    const list = categories.filter(item => item.toLowerCase() !== needle && (!needle || chosen || item.toLowerCase().includes(needle)));
    return list.slice(0, 8);
  }, [categories, draft.categoria]);

  const stateOptions = (editing ? (loaned ? [stateLabel(initial!)] : [...MANUAL_STATES]) : NEW_STATES)
    .map(value => ({ value, label: value }));
  if (editing && !loaned && !stateOptions.some(option => option.value === draft.estado)) stateOptions.unshift({ value: draft.estado, label: draft.estado });

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    setTouched(true);
    setError('');
    if (!tag || !draft.categoria.trim()) return;
    setBusy(true);
    try {
      const payload: DeviceFormSave = { ...draft, etiqueta: tag, numeroOperativo: draft.numero, ...(editing ? { originalEtiqueta: original } : {}) };
      if (loaned) delete payload.estado;
      await onSave(payload, editing && !loaned && draft.estado !== stateLabel(initial!));
    } catch (reason) {
      setError(errorMessage(reason, 'No se pudo guardar el dispositivo.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="dv-form"
      aria-label={editing ? `Editar ${original}` : 'Añadir dispositivo'}
      data-scanner-ignore=""
      noValidate
      onSubmit={submit}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); } }}
    >
      <div className="dv-block-head">
        <div className="dv-block-title">
          <Eyebrow>{editing ? 'Editar equipo' : 'Alta de equipo'}</Eyebrow>
          <h3 className="dv-h3">{editing ? `Editar ${original}` : 'Añadir dispositivo'}</h3>
        </div>
        <IconButton label="Cerrar sin guardar" icon={<icons.IconX size={16} />} onClick={onCancel} />
      </div>
      <div className="dv-form-grid">
        <Input ref={firstRef} label="Etiqueta" required className="dv-mono-field" value={draft.etiqueta} onValueChange={set('etiqueta')} placeholder="D1436 o 1436" autoComplete="off" error={tagError || undefined} hint={tagError ? undefined : tagHint} />
        <Input label="Número operativo" value={draft.numero} onValueChange={set('numero')} placeholder="34" inputMode="numeric" autoComplete="off" />
        <div className="dv-field-chips">
          <Input label="Categoría / tipo" required value={draft.categoria} onValueChange={set('categoria')} placeholder="Chromebook" autoComplete="off" error={catError || undefined} />
          {catChips.length > 0 && (
            <div className="dv-chips" role="group" aria-label="Categorías sugeridas">
              {catChips.map(item => <button key={item} type="button" className="dv-chip" onClick={() => set('categoria')(item)}>{item}</button>)}
            </div>
          )}
        </div>
        <div className="dv-field-chips">
          <Input label="Filtro (define el alias)" value={draft.filtro} onValueChange={set('filtro')} placeholder="Touch, Dell, TIC, Tablet, Plani…" autoComplete="off" />
          <div className="dv-chips" role="group" aria-label="Filtros frecuentes">
            {FILTERS.map(item => <button key={item} type="button" className="dv-chip" aria-pressed={draft.filtro === item} onClick={() => set('filtro')(item)}>{item}</button>)}
          </div>
        </div>
        <Input label="Dispositivo" value={draft.dispositivo} onValueChange={set('dispositivo')} placeholder="Chromebook, Tablet, Router…" autoComplete="off" />
        <Input label="Marca" value={draft.marca} onValueChange={set('marca')} autoComplete="off" />
        <Input label="Modelo" value={draft.modelo} onValueChange={set('modelo')} autoComplete="off" />
        <Input label="Serial" className="dv-mono-field" value={draft.sn} onValueChange={set('sn')} autoComplete="off" />
        <Input label="MAC" className="dv-mono-field" value={draft.mac} onValueChange={set('mac')} autoComplete="off" />
        <Input label="Alias operativo (opcional)" value={draft.aliasOperativo} onValueChange={set('aliasOperativo')} placeholder="TIC1, TIC 1, 1TIC" hint="Varios, separados por coma." autoComplete="off" />
      </div>
      <div className="dv-form-state">
        <Segmented label="Estado" value={loaned ? stateLabel(initial!) : draft.estado} onChange={set('estado')} options={stateOptions} disabled={loaned} size="sm" />
        {loaned && <span className="dv-note">Tiene un préstamo activo: para cambiar el estado, devolvelo primero.</span>}
      </div>
      <Textarea label="Observaciones" minRows={2} value={draft.comentarios} onValueChange={set('comentarios')} placeholder="Opcional: lo que haya que saber del equipo" />
      <Collapse open={Boolean(renaming)}>
        <p className="dv-note dv-note--warn" role="status">
          Vas a renombrar {original} → {tag}. La condición, la clase y la vida útil pasan a {tag}; el historial de préstamos, el estado guardado y el grupo quedan con {original}.
        </p>
      </Collapse>
      {error && <ErrorState message={error} />}
      <div className="dv-form-actions">
        <Button type="submit" variant="primary" loading={busy || saving} loadingLabel="Guardando…">{editing ? 'Guardar cambios' : 'Añadir dispositivo'}</Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancelar</Button>
        <span className="dv-help">Enter guarda · Esc cancela</span>
      </div>
    </form>
  );
}
