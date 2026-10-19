import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Classroom, Ticket, TicketSource, TicketState, TicketTemplate } from '../../types';
import { createTicket, updateTicket, uploadTicketImage } from '../../services/ticketsApi';
import {
  Button, Collapse, Combobox, Eyebrow, FileDrop, Input, RadioGroup, Segmented, Select, TagInput, Textarea, StatusSlot, useStatusLine
} from '../../ui';
import { IconAlert, IconFile } from '../../ui/icons';
import { fold } from '../../ui/util';
import { StepList } from './StepList';
import {
  ESTADOS, ORIGENES, PRIORIDADES, errorText, externalLink, fileNameOf, isPdf, normalizeReference, readFileAsDataUrl, systemLabel, ticketNumber,
  type LinkBases
} from './ticketUtils';

type Draft = {
  origen: TicketSource;
  numero: string;
  estado: TicketState;
  prioridad: string;
  titulo: string;
  categoria: string;
  descripcion: string;
  responsables: string[];
  school: string;
  classroom: string;
  classroomKey: string;
  tags: string[];
  checklist: string[];
  imagenUrl: string;
  templateId?: number;
  nota: string;
};

const EMPTY: Draft = { origen: 'tik', numero: '', estado: 'No hecho', prioridad: 'Media', titulo: '', categoria: '', descripcion: '', responsables: [], school: '', classroom: '', classroomKey: '', tags: [], checklist: [], imagenUrl: '', nota: '' };

function fromTicket(ticket: Ticket): Draft {
  return {
    origen: ticket.origen || 'tik',
    numero: ticket.numero || '',
    estado: ticket.estado,
    prioridad: ticket.prioridad || 'Media',
    titulo: ticket.titulo || '',
    categoria: ticket.categoria || '',
    descripcion: ticket.descripcion || '',
    responsables: ticket.responsables || [],
    school: ticket.school || '',
    classroom: ticket.classroom || '',
    classroomKey: ticket.classroomKey || '',
    tags: ticket.tags || [],
    checklist: [],
    imagenUrl: ticket.imagenUrl || '',
    templateId: ticket.templateId || undefined,
    // `nota` no tiene control propio: se conserva al editar (el server la usa en la actividad).
    nota: ticket.nota || ''
  };
}

const MAX_MB = 7.5;

/**
 * Alta y edición del ticket EN EL LUGAR de la ficha (sin modal). Todos los
 * campos de antes: origen y plantilla, número (solo dígitos en Tiknology) o
 * referencia libre (Handing), estado, prioridad, título, categoría,
 * descripción, responsables y tags que se tipean de corrido, escuela, aula
 * (con "Dato anterior"), checklist inicial, link de prueba y el archivo
 * exportado.
 */
export function TicketForm({ initial, templates, classrooms, assistants, tickets, bases, onCancel, onSaved, onDirtyChange }: {
  initial?: Ticket;
  templates: TicketTemplate[];
  classrooms: Classroom[];
  assistants: string[];
  tickets: Ticket[];
  bases: LinkBases;
  onCancel: () => void;
  onSaved: (ticket: Ticket, created: boolean) => void;
  /** Avisa si hay cambios sin guardar (para no perderlos al navegar). */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const editing = Boolean(initial);
  const [draft, setDraft] = useState<Draft>(() => (initial ? fromTicket(initial) : EMPTY));
  const [numError, setNumError] = useState('');
  const [aulaError, setAulaError] = useState('');
  const [error, setError] = useState('');
  const lastError = useRef(error);
  if (error) lastError.current = error;
  const [saving, setSaving] = useState(false);
  // Doble click / doble Enter: el segundo envío no sale (el estado tarda un render).
  const savingRef = useRef(false);
  const [uploads, setUploads] = useState(0);
  const [replacing, setReplacing] = useState(false);
  const [aulaText, setAulaText] = useState(() => {
    if (!initial) return '';
    const room = classrooms.find(item => item.roomKey === initial.classroomKey);
    return room?.nombre || (initial.classroomKey ? initial.classroom || '' : '');
  });
  const tplStatus = useStatusLine();
  const numRef = useRef<HTMLInputElement | null>(null);
  const set = (patch: Partial<Draft>) => setDraft(current => ({ ...current, ...patch }));
  const [pristine] = useState(() => JSON.stringify([initial ? fromTicket(initial) : EMPTY, aulaText]));
  const dirty = JSON.stringify([draft, aulaText]) !== pristine;
  const dirtyRef = useRef(onDirtyChange);
  dirtyRef.current = onDirtyChange;
  useEffect(() => { dirtyRef.current?.(dirty); }, [dirty]);
  useEffect(() => () => dirtyRef.current?.(false), []);

  // Sugerencias: lo que ya se usa en la sede (sin inventar datos).
  const categories = useMemo(() => uniq(tickets.map(item => item.categoria)), [tickets]);
  const tagSuggestions = useMemo(() => uniq(tickets.flatMap(item => item.tags || [])), [tickets]);
  const people = useMemo(() => uniq([...assistants, ...tickets.flatMap(item => item.responsables || [])]), [assistants, tickets]);
  const schools = useMemo(() => uniq(tickets.map(item => item.school || '')), [tickets]);

  // Aulas: el nombre es lo que se ve; si se repite entre pisos, se aclara el piso.
  const roomOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const room of classrooms) counts.set(fold(room.nombre), (counts.get(fold(room.nombre)) || 0) + 1);
    return classrooms.map(room => ({
      value: (counts.get(fold(room.nombre)) || 0) > 1 && room.piso ? `${room.nombre} (${room.piso})` : room.nombre,
      label: (counts.get(fold(room.nombre)) || 0) > 1 && room.piso ? `${room.nombre} (${room.piso})` : room.nombre,
      hint: room.piso || undefined,
      key: room.roomKey
    }));
  }, [classrooms]);
  const roomByLabel = useMemo(() => new Map(roomOptions.map(option => [fold(option.value), option])), [roomOptions]);
  const legacyAula = !draft.classroomKey && draft.classroom ? draft.classroom : '';

  const reference = normalizeReference(draft.numero, draft.origen);
  const testLink = reference ? externalLink({ numero: reference, origen: draft.origen }, bases) : '';

  const applyTemplate = (value: string) => {
    if (!value) { set({ templateId: undefined }); tplStatus.clear(); return; }
    const template = templates.find(item => String(item.id) === value);
    if (!template) return;
    const before = draft;
    setDraft(current => ({
      ...current,
      templateId: template.id,
      titulo: template.title,
      descripcion: template.description,
      prioridad: template.priority,
      categoria: template.category,
      responsables: template.suggestedAssignee ? [template.suggestedAssignee] : [],
      checklist: template.checklist,
      tags: template.tags
    }));
    tplStatus.show({
      tone: 'info',
      message: `Se completó con «${template.title}»: título, descripción, prioridad, categoría, responsables, checklist y tags.`,
      undo: { onUndo: () => { setDraft(before); tplStatus.clear(); }, seconds: 12 }
    });
  };

  const upload = async (file: File, progress: (ratio: number) => void) => {
    setUploads(count => count + 1);
    setError('');
    try {
      progress(0.15);
      const dataUrl = await readFileAsDataUrl(file);
      progress(0.45);
      const response = await uploadTicketImage({ fileName: file.name, dataUrl });
      progress(1);
      set({ imagenUrl: response.url });
      setReplacing(false);
      return response;
    } finally {
      setUploads(count => count - 1);
    }
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (savingRef.current) return;
    setError('');
    const numero = normalizeReference(draft.numero, draft.origen);
    let invalid = false;
    if (draft.origen === 'tik' && !numero) {
      setNumError('Falta el número de ticket de InVgate (solo dígitos, sin #).');
      invalid = true;
    }
    // El aula se elige de la lista: un texto que no es un aula no se guarda como si lo fuera.
    let classroomKey = draft.classroomKey;
    let classroom = draft.classroom;
    const typed = aulaText.trim();
    if (typed) {
      const match = roomByLabel.get(fold(typed));
      if (match) { classroomKey = match.key; classroom = classrooms.find(room => room.roomKey === match.key)?.nombre || match.value; }
      else if (!(legacyAula && fold(typed) === fold(legacyAula))) { setAulaError('Elegí un aula de la lista o dejá el campo vacío.'); invalid = true; }
    } else if (draft.classroomKey) {
      classroomKey = '';
      classroom = '';
    }
    if (invalid) {
      if (draft.origen === 'tik' && !numero) numRef.current?.focus();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const payload: Partial<Ticket> = {
        ...draft,
        numero,
        classroomKey,
        classroom,
        templateId: draft.templateId ?? null,
        ...(editing ? {} : { checklist: draft.checklist.map(step => step.trim()).filter(Boolean) })
      };
      if (editing) delete payload.checklist;
      const response = editing && initial ? await updateTicket(initial.id, payload) : await createTicket(payload);
      onSaved(response.item, !editing);
    } catch (reason) {
      setError(errorText(reason, 'No se pudo guardar el ticket.'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const fileUrl = draft.imagenUrl;
  return (
    <form className="tkx-form" onSubmit={submit} data-scanner-ignore="" aria-label={editing ? 'Editar ticket' : 'Cargar ticket'} noValidate>
      <div className="tkx-pane-head">
        <div className="tkx-grow">
          <Eyebrow>{editing && initial ? `Editar · ${ticketNumber(initial)}` : 'Nuevo ticket'}</Eyebrow>
          <h2 className="tkx-pane-title tkx-ell" tabIndex={-1}>{editing ? (initial?.titulo || 'Ticket sin título') : 'Cargar ticket'}</h2>
        </div>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
      </div>

      <RadioGroup<TicketSource>
        label="Origen"
        direction="row"
        value={draft.origen}
        onChange={origen => setDraft(current => ({ ...current, origen, numero: normalizeReference(current.numero, origen) }))}
        options={ORIGENES.map(item => ({ value: item.key, label: item.label, hint: item.helper }))}
        className="tkx-origin"
      />

      {!editing && templates.length > 0 && (
        <div className="tkx-field-block">
          <Select
            label="Usar plantilla"
            value={String(draft.templateId || '')}
            onChange={applyTemplate}
            options={[{ value: '', label: 'Sin plantilla' }, ...templates.map(item => ({ value: String(item.id), label: item.title, hint: [item.category, item.priority].filter(Boolean).join(' · ') }))]}
            searchable="auto"
          />
          <StatusSlot status={tplStatus} />
        </div>
      )}

      <div className="tkx-fgrid">
        <Input
          ref={numRef}
          label={draft.origen === 'handing' ? 'Referencia de ticket (Handing)' : 'Número de ticket (InVgate)'}
          required={draft.origen === 'tik'}
          className="tkx-mono-field"
          value={draft.numero}
          inputMode={draft.origen === 'handing' ? 'text' : 'numeric'}
          placeholder={draft.origen === 'handing' ? 'Ej. HDMI-2103' : 'Ej. 2103'}
          autoFocus={!editing}
          autoComplete="off"
          error={numError || undefined}
          hint={draft.origen === 'handing' ? 'No usa número: podés dejarlo vacío o escribir una referencia interna.' : 'Solo el número, sin # (ej. 2103).'}
          onValueChange={value => { setNumError(''); set({ numero: normalizeReference(value, draft.origen) }); }}
        />
        <div className="ui-field">
          <span className="ui-label"><span className="ui-label-text">Probar link</span></span>
          {testLink
            ? <a className="ui-btn ui-btn--secondary tkx-linkbtn" href={testLink} target="_blank" rel="noreferrer"><span className="ui-btn-label">Abrir en {systemLabel(draft.origen)} ↗</span></a>
            : <span className="ui-help ui-help--hint">Cargá la referencia para probar el link al sistema externo.</span>}
        </div>
        <Segmented<TicketState> label="Estado" value={draft.estado} onChange={estado => set({ estado })} options={ESTADOS.map(value => ({ value, label: value }))} />
        <Segmented label="Prioridad" value={draft.prioridad} onChange={prioridad => set({ prioridad })} options={PRIORIDADES.map(value => ({ value, label: value }))} />
        <Input className="tkx-full" label="Título" value={draft.titulo} placeholder="Ej. Proyector sin imagen" onValueChange={titulo => set({ titulo })} />
        <Combobox label="Categoría" value={draft.categoria} onChange={categoria => set({ categoria })} options={categories} placeholder="Hardware, cuenta, conectividad…" />
        <Combobox label="Escuela" value={draft.school} onChange={school => set({ school })} options={schools} placeholder="Sede o escuela" />
        <Textarea className="tkx-full" label="Descripción" minRows={3} value={draft.descripcion} placeholder="Detalle breve del problema o pedido" onValueChange={descripcion => set({ descripcion })} />
        <TagInput
          className="tkx-full"
          label="Responsables"
          value={draft.responsables}
          onChange={responsables => set({ responsables })}
          suggestions={people}
          placeholder="Nombre y Enter (o coma)"
          hint="Escribí de corrido: coma o Enter cierra cada nombre."
        />
        <div className="tkx-full">
          <Combobox
            label="Aula (opcional)"
            value={aulaText}
            onChange={value => { setAulaError(''); setAulaText(value); const match = roomByLabel.get(fold(value)); set(match ? { classroomKey: match.key, classroom: classrooms.find(room => room.roomKey === match.key)?.nombre || match.value } : { classroomKey: '' }); }}
            options={roomOptions}
            placeholder="Buscar aula: 6F, LAB, 3ero N…"
            emptyText="Ningún aula coincide."
            error={aulaError || undefined}
            hint={legacyAula ? `Dato anterior: ${legacyAula} (texto libre, sin aula vinculada)` : 'Vincula el ticket con el aula del plano.'}
          />
        </div>
        <TagInput
          className="tkx-full"
          label="Tags"
          value={draft.tags}
          onChange={tags => set({ tags })}
          suggestions={tagSuggestions}
          placeholder="tag, tag…"
          hint="Coma o Enter cierra el tag; Borrar con el campo vacío quita el último."
        />
        {!editing && (
          <div className="ui-field tkx-full">
            <span className="ui-label"><span className="ui-label-text">Checklist inicial</span></span>
            <StepList label="Checklist inicial" value={draft.checklist} onChange={checklist => set({ checklist })} placeholder="Escribí un paso y Enter (queda listo para el siguiente)" />
          </div>
        )}
        <div className="ui-field tkx-full">
          <span className="ui-label"><span className="ui-label-text">Ticket exportado (PDF o foto)</span></span>
          {fileUrl && !replacing ? (
            <div className="tkx-file">
              <span className="tkx-file-icon" aria-hidden="true">{isPdf(fileUrl) ? <span className="tkx-mono">PDF</span> : <IconFile size={16} />}</span>
              <span className="tkx-grow tkx-file-text">
                <span className="tkx-ell">{fileNameOf(fileUrl)}</span>
                <span className="tkx-muted tkx-small">{isPdf(fileUrl) ? 'PDF' : 'Imagen'}</span>
              </span>
              <span className="tkx-actions">
                <a className="ui-btn ui-btn--ghost ui-btn--sm" href={fileUrl} target="_blank" rel="noreferrer"><span className="ui-btn-label">Abrir ↗</span></a>
                <Button size="sm" variant="secondary" onClick={() => setReplacing(true)}>Reemplazar</Button>
                <Button size="sm" variant="ghost" onClick={() => set({ imagenUrl: '' })}>Quitar</Button>
              </span>
            </div>
          ) : (
            <>
              <FileDrop
                accept="application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp"
                maxSizeMB={MAX_MB}
                upload={upload}
                title="Arrastrá el PDF o la foto acá, o pegala con Ctrl V"
                hint="PDF, PNG, JPG o WEBP · hasta 7,5 MB"
                label="Subir PDF o foto"
              />
              {replacing && <Button size="sm" variant="ghost" onClick={() => setReplacing(false)}>Dejar el archivo actual</Button>}
            </>
          )}
        </div>
      </div>

      <Collapse open={Boolean(error)}>
        <div className="ui-error" role="alert">
          <span className="ui-status-icon" aria-hidden="true"><IconAlert size={14} /></span>
          <span className="ui-error-msg">{error || lastError.current}</span>
        </div>
      </Collapse>
      <div className="tkx-actions">
        <Button type="submit" variant="primary" loading={saving} loadingLabel="Guardando…" disabled={uploads > 0}>{uploads > 0 ? 'Subiendo archivo…' : 'Guardar ticket'}</Button>
        <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
      </div>
    </form>
  );
}

function uniq(values: string[]) {
  const seen = new Map<string, string>();
  for (const value of values) {
    const clean = String(value || '').trim();
    if (clean && !seen.has(fold(clean))) seen.set(fold(clean), clean);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'es'));
}
