import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { InventoryItem } from '../../types';
import { createInventoryItem, updateInventoryItem, uploadInventoryImage } from '../../services/inventoryApi';
import { Button, Collapse, FileDrop, Input, NumberField, Textarea } from '../../ui';
import { compareText, FORM_CATEGORIES } from './inventoryEntries';
import { Chip, ChipGroup, ConditionChips, errorText, readFileAsDataUrl } from './inventoryParts';

type Draft = {
  nombre: string;
  categoria: string;
  subcategoria: string;
  cantidad: number | null;
  unidad: string;
  minStock: number | null;
  condicion: string;
  observaciones: string;
  imagenUrl: string;
};

const fromItem = (item?: InventoryItem | null, categoria?: string): Draft => ({
  nombre: item?.nombre || '',
  categoria: item?.categoria || categoria || 'Otro',
  subcategoria: item?.subcategoria || '',
  cantidad: item ? Number(item.cantidad || 0) : 1,
  unidad: item?.unidad || 'unidades',
  minStock: item ? Number(item.minStock ?? 3) : 3,
  condicion: item?.condicion || '',
  observaciones: item?.observaciones || '',
  imagenUrl: item?.imagenUrl || ''
});

/**
 * Alta y edición de un recurso, en línea (el alta arriba de la página, la
 * edición dentro de la ficha abierta). Foto obligatoria, subida con el
 * FileDrop propio; una foto ya cargada se puede cambiar, no quitar.
 * Enter en un campo guarda, Escape cancela.
 */
export function ResourceForm({ item, items, defaultCategory, consultationMode, onSaved, onCancel }: {
  /** Si viene, es edición. */
  item?: InventoryItem | null;
  items: InventoryItem[];
  defaultCategory?: string;
  consultationMode: boolean;
  onSaved: (item: InventoryItem, created: boolean) => void;
  onCancel: () => void;
}) {
  const editing = Boolean(item);
  const [draft, setDraft] = useState<Draft>(() => fromItem(item, defaultCategory && FORM_CATEGORIES.includes(defaultCategory) ? defaultCategory : undefined));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [photoError, setPhotoError] = useState(false);
  const initialPhoto = useRef(item?.imagenUrl || '');
  const set = (patch: Partial<Draft>) => { setDraft(current => ({ ...current, ...patch })); setError(''); };

  const categorias = useMemo(() => {
    const all = new Set([...FORM_CATEGORIES, ...items.map(entry => entry.categoria).filter(Boolean), draft.categoria]);
    return [...all].sort(compareText);
  }, [items, draft.categoria]);

  const subcategorias = useMemo(() => {
    const all = new Set(items.filter(entry => entry.categoria === draft.categoria).map(entry => entry.subcategoria || '').filter(Boolean));
    return [...all].sort(compareText);
  }, [items, draft.categoria]);

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    if (consultationMode || busy || uploading) return;
    if (!draft.imagenUrl.trim()) { setPhotoError(true); setError('Subí una foto del recurso: es obligatoria.'); return; }
    if (!draft.nombre.trim()) { setError('Escribí el nombre del recurso.'); return; }
    setBusy(true);
    setError('');
    const payload: Partial<InventoryItem> = {
      nombre: draft.nombre.trim(),
      categoria: draft.categoria,
      subcategoria: draft.subcategoria.trim(),
      cantidad: Math.max(0, draft.cantidad ?? 0),
      unidad: draft.unidad.trim() || 'unidades',
      minStock: Math.max(0, draft.minStock ?? 3),
      condicion: draft.condicion,
      observaciones: draft.observaciones,
      imagenUrl: draft.imagenUrl
    };
    try {
      const response = item ? await updateInventoryItem(item.id, payload) : await createInventoryItem(payload);
      onSaved(response.item, !item);
    } catch (reason) {
      setError(errorText(reason, 'No se pudo guardar el recurso.'));
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };

  const upload = async (file: File) => {
    setUploading(true);
    setPhotoError(false);
    try {
      const response = await uploadInventoryImage({ fileName: file.name, dataUrl: await readFileAsDataUrl(file) });
      set({ imagenUrl: response.url });
      return response;
    } finally {
      setUploading(false);
    }
  };

  return (
    <form className="ivt-form" onSubmit={save} onKeyDown={onKeyDown} data-scanner-ignore="" aria-label={editing ? 'Editar recurso' : 'Agregar recurso'} noValidate>
      <div className="ivt-form-head">
        <h3>{editing ? 'Editar recurso' : 'Agregar recurso'}</h3>
        <span className="ivt-help">
          {editing
            ? 'Una foto cargada se puede cambiar, no quitar. Cambiar la condición cuenta como revisión.'
            : 'Foto y nombre son obligatorios. Enter guarda, Esc cancela.'}
        </span>
      </div>
      <div className="ivt-form-body">
        <div className="ivt-form-photo">
          <div className={`ivt-photo${draft.imagenUrl ? ' has-photo' : ''}${photoError ? ' is-error' : ''}`}>
            {draft.imagenUrl ? <img src={draft.imagenUrl} alt="" /> : <span>Sin foto</span>}
          </div>
          <FileDrop
            accept="image/png,image/jpeg,image/webp"
            label={draft.imagenUrl ? 'Cambiar foto' : 'Subir foto'}
            title={draft.imagenUrl ? 'Cambiar foto' : 'Subir foto'}
            hint="Obligatoria · PNG, JPG o WEBP"
            disabled={consultationMode || busy}
            upload={upload}
            onRemove={() => set({ imagenUrl: initialPhoto.current })}
            className="ivt-filedrop"
          />
        </div>
        <div className="ivt-form-grid">
          <Input
            className="ivt-full"
            label="Nombre"
            required
            autoComplete="off"
            value={draft.nombre}
            placeholder="Ej. Placa Arduino Uno"
            onValueChange={nombre => set({ nombre })}
            disabled={consultationMode}
          />
          <div className="ivt-field ivt-full">
            <span className="ivt-label">Categoría</span>
            <ChipGroup label="Categoría">
              {categorias.map(categoria => (
                <Chip
                  key={categoria}
                  pressed={draft.categoria === categoria}
                  disabled={consultationMode}
                  onClick={() => set({ categoria, subcategoria: categoria === draft.categoria ? draft.subcategoria : '' })}
                >
                  {categoria}
                </Chip>
              ))}
            </ChipGroup>
          </div>
          <Input label="Subcategoría" autoComplete="off" value={draft.subcategoria} placeholder="Opcional" onValueChange={subcategoria => set({ subcategoria })} disabled={consultationMode} />
          <NumberField label="Cantidad" min={0} value={draft.cantidad} onChange={cantidad => set({ cantidad })} disabled={consultationMode} />
          <Input label="Unidad" autoComplete="off" value={draft.unidad} placeholder="unidades" onValueChange={unidad => set({ unidad })} disabled={consultationMode} />
          <NumberField label="Stock mínimo" min={0} value={draft.minStock} onChange={minStock => set({ minStock })} disabled={consultationMode} />
          {/* Cambian con la categoría elegida: entran y salen suaves. */}
          <Collapse open={subcategorias.length > 0} outerClassName="ivt-full ivt-form-fold" className="ivt-field ivt-inline-chips" reveal={false}>
              <span className="ivt-help">Subcategorías usadas:</span>
              <ChipGroup label="Subcategorías usadas">
                {subcategorias.map(sub => (
                  <Chip key={sub} pressed={draft.subcategoria === sub} disabled={consultationMode} onClick={() => set({ subcategoria: sub })}>{sub}</Chip>
                ))}
              </ChipGroup>
          </Collapse>
          <div className="ivt-field ivt-full">
            <span className="ivt-label">Condición</span>
            <ConditionChips value={draft.condicion} onChange={condicion => set({ condicion })} disabled={consultationMode} />
          </div>
          <Textarea className="ivt-full" label="Observaciones" minRows={3} value={draft.observaciones} placeholder="Opcional" onValueChange={observaciones => set({ observaciones })} disabled={consultationMode} />
        </div>
      </div>
      <Collapse open={Boolean(error)}>
        <div className="ivt-error" role="alert">{error}</div>
      </Collapse>
      <div className="ivt-actions">
        <Button type="submit" variant="primary" loading={busy} loadingLabel="Guardando…" disabled={consultationMode || uploading}>
          {editing ? 'Guardar cambios' : 'Agregar recurso'}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>Cancelar</Button>
      </div>
    </form>
  );
}
