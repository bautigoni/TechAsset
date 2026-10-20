import { useRef, useState, type FormEvent } from 'react';
import { IconPlus as Plus } from '../../ui/icons';
import type { TicketTemplate } from '../../types';
import { createTicketTemplate, deleteTicketTemplate, restoreTicketTemplate, updateTicketTemplate } from '../../services/ticketsApi';
import { Button, EmptyState, ErrorState, Eyebrow, InlineConfirm, Input, Segmented, TagInput, Textarea, StatusSlot, useStatusLine } from '../../ui';
import { StepList } from './StepList';
import { Collapse } from '../../ui';
import { PRIORIDADES, errorText } from './ticketUtils';
import { ListItemMotion, useListMotion } from '../../utils/motion';

type Draft = { title: string; description: string; priority: string; category: string; suggestedAssignee: string; checklist: string[]; tags: string[] };
const EMPTY: Draft = { title: '', description: '', priority: 'Media', category: '', suggestedAssignee: '', checklist: [], tags: [] };

/**
 * Plantillas de incidentes frecuentes, en el lugar de la ficha (sin modal):
 * crear arriba, editar dentro de la tarjeta, eliminar con confirmación en
 * línea y Deshacer.
 */
export function TicketTemplates({ templates, loadError, canEdit, onReload, onClose, closeLabel }: {
  templates: TicketTemplate[];
  loadError: string;
  canEdit: boolean;
  onReload: () => Promise<void>;
  onClose: () => void;
  closeLabel: string;
}) {
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [asking, setAsking] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const status = useStatusLine();
  const newRef = useRef<HTMLButtonElement | null>(null);
  const rows = useListMotion(templates, template => String(template.id));

  const remove = async (template: TicketTemplate) => {
    if (busy) return;
    setBusy(true);
    try {
      await deleteTicketTemplate(template.id);
      setAsking(null);
      await onReload();
      status.show({
        tone: 'ok',
        message: `Plantilla «${template.title}» eliminada.`,
        undo: {
          onUndo: async () => {
            try {
              await restoreTicketTemplate(template.id);
              await onReload();
              status.show({ tone: 'info', message: `Plantilla «${template.title}» recuperada.` });
            } catch (reason) {
              status.show({ tone: 'bad', message: errorText(reason, 'No se pudo recuperar la plantilla.') });
            }
          }
        }
      });
    } catch (reason) {
      status.show({ tone: 'bad', message: errorText(reason, 'No se pudo eliminar la plantilla.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tkx-templates" data-scanner-ignore="">
      <div className="tkx-pane-head">
        <div className="tkx-grow">
          <Eyebrow>Incidentes frecuentes</Eyebrow>
          <h2 className="tkx-pane-title" tabIndex={-1}>Plantillas</h2>
        </div>
        <div className="tkx-actions">
          {canEdit && editing !== 'new' && (
            <Button ref={newRef} size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => { setEditing('new'); setAsking(null); }}>Nueva plantilla</Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>{closeLabel}</Button>
        </div>
      </div>
      <p className="tkx-para tkx-muted">Guardá incidentes frecuentes con prioridad, categoría, responsable sugerido, tags y checklist. Al cargar un ticket, elegís la plantilla y completa todo.</p>
      <StatusSlot status={status} />
      <Collapse open={Boolean(loadError)}>
        <ErrorState message={loadError || 'No se pudieron cargar las plantillas.'} onRetry={() => void onReload()} />
      </Collapse>

      <Collapse open={editing === 'new'} unmountOnClose>
        <TemplateForm
          heading="Nueva plantilla"
          onCancel={() => { setEditing(null); requestAnimationFrame(() => newRef.current?.focus()); }}
          onSave={async draft => {
            await createTicketTemplate(draft);
            await onReload();
            setEditing(null);
            status.show({ tone: 'ok', message: `Plantilla «${draft.title}» creada.` });
          }}
        />
      </Collapse>

      {rows.entries.length ? (
        <ul className="tkx-tpl-list">
          {rows.entries.map(entry => {
            const template = entry.item;
            return (
            <li key={entry.key}>
            <ListItemMotion entry={entry} release={rows.release}>
            <div className="tkx-tpl">
              <div className="tkx-tpl-head">
                <span className="tkx-strong tkx-ell tkx-grow">{template.title}</span>
                {canEdit && (
                  <span className="tkx-actions">
                    <Button size="sm" variant="ghost" aria-expanded={editing === template.id} onClick={() => { setEditing(editing === template.id ? null : template.id); setAsking(null); }}>Editar</Button>
                    <Button size="sm" variant="ghost" aria-expanded={asking === template.id} onClick={() => { setAsking(asking === template.id ? null : template.id); setEditing(null); }}>Eliminar</Button>
                  </span>
                )}
              </div>
              <span className="tkx-small tkx-muted">{template.category || 'Sin categoría'} · {template.priority}{template.suggestedAssignee ? ` · sugerido: ${template.suggestedAssignee}` : ''}</span>
              {template.description && <p className="tkx-para">{template.description}</p>}
              {template.checklist.length > 0 && (
                <span className="tkx-small tkx-muted">{template.checklist.length} {template.checklist.length === 1 ? 'paso' : 'pasos'} · {template.checklist.join(' · ')}</span>
              )}
              {template.tags.length > 0 && <span className="tkx-chips">{template.tags.map(tag => <span key={tag} className="tkx-chip">{tag}</span>)}</span>}
              <Collapse open={asking === template.id} unmountOnClose>
                <InlineConfirm
                  danger
                  busy={busy}
                  message={`¿Eliminar la plantilla «${template.title}»?`}
                  detail="Los tickets ya cargados no cambian. Vas a poder deshacerlo."
                  confirmLabel="Eliminar"
                  onConfirm={() => void remove(template)}
                  onCancel={() => setAsking(null)}
                />
              </Collapse>
              <Collapse open={editing === template.id} unmountOnClose>
                <TemplateForm
                  heading="Editar plantilla"
                  initial={template}
                  onCancel={() => setEditing(null)}
                  onSave={async draft => {
                    await updateTicketTemplate(template.id, draft);
                    await onReload();
                    setEditing(null);
                    status.show({ tone: 'ok', message: `Plantilla «${draft.title}» guardada.` });
                  }}
                />
              </Collapse>
            </div>
            </ListItemMotion>
            </li>
            );
          })}
        </ul>
      ) : !loadError && editing !== 'new' ? (
        <EmptyState
          title="Todavía no hay plantillas."
          description="Sirven para cargar en un paso los incidentes que se repiten (proyector sin imagen, cuenta bloqueada…)."
          action={canEdit ? <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => setEditing('new')}>Nueva plantilla</Button> : undefined}
        />
      ) : null}
    </div>
  );
}

function TemplateForm({ heading, initial, onSave, onCancel }: { heading: string; initial?: TicketTemplate; onSave: (draft: Draft) => Promise<void>; onCancel: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => (initial ? {
    title: initial.title, description: initial.description, priority: initial.priority || 'Media', category: initial.category,
    suggestedAssignee: initial.suggestedAssignee, checklist: [...initial.checklist], tags: [...initial.tags]
  } : EMPTY));
  const [titleError, setTitleError] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const set = (patch: Partial<Draft>) => setDraft(current => ({ ...current, ...patch }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    if (!draft.title.trim()) { setTitleError('Poné un título para guardar la plantilla.'); return; }
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await onSave({ ...draft, title: draft.title.trim(), checklist: draft.checklist.map(step => step.trim()).filter(Boolean) });
    } catch (reason) {
      setError(errorText(reason, 'No se pudo guardar la plantilla.'));
      setSaving(false);
    } finally {
      savingRef.current = false;
    }
  };
  return (
    <form className="tkx-tpl-form" onSubmit={submit} aria-label={heading} noValidate>
      <span className="tkx-strong">{heading}</span>
      <div className="tkx-fgrid">
        <Input label="Título" required autoFocus value={draft.title} error={titleError || undefined} placeholder="Ej. Proyector sin imagen" onValueChange={title => { setTitleError(''); set({ title }); }} />
        <Input label="Categoría" value={draft.category} placeholder="Hardware" onValueChange={category => set({ category })} />
        <Textarea className="tkx-full" label="Descripción" minRows={2} value={draft.description} onValueChange={description => set({ description })} />
        <Segmented label="Prioridad" value={draft.priority} onChange={priority => set({ priority })} options={PRIORIDADES.map(value => ({ value, label: value }))} />
        <Input label="Responsable sugerido" value={draft.suggestedAssignee} placeholder="Ej. Bauti G." onValueChange={suggestedAssignee => set({ suggestedAssignee })} />
        <div className="ui-field tkx-full">
          <span className="ui-label"><span className="ui-label-text">Checklist</span></span>
          <StepList label="Checklist de la plantilla" value={draft.checklist} onChange={checklist => set({ checklist })} placeholder="Paso y Enter" />
        </div>
        <TagInput className="tkx-full" label="Tags" value={draft.tags} onChange={tags => set({ tags })} placeholder="tag, tag…" />
      </div>
      <Collapse open={Boolean(error)}>
        <ErrorState message={error || 'No se pudo guardar la plantilla.'} />
      </Collapse>
      <div className="tkx-actions">
        <Button type="submit" size="sm" variant="primary" loading={saving} loadingLabel="Guardando…">{initial ? 'Guardar cambios' : 'Guardar plantilla'}</Button>
        <Button size="sm" variant="ghost" disabled={saving} onClick={onCancel}>Cancelar</Button>
      </div>
    </form>
  );
}
