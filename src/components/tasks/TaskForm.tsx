import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Lock, Paperclip, Users, X } from 'lucide-react';
import type { TaskItem } from '../../types';
import { Button, Collapse, DatePicker, FileDrop, IconButton, Input, Textarea, cx, type FileDropItem } from '../../ui';
import { uploadTaskAttachment } from '../../services/tasksApi';
import { OptionChips } from './TaskBits';
import { PRIORITIES, TIPOS_BASE, TURNOS, joinNames, responsablesOf } from './taskModel';

type Attachment = { name: string; url: string; mimeType?: string };
type Person = { name: string; email?: string };

type Draft = {
  visibility: 'team' | 'private';
  titulo: string;
  descripcion: string;
  comentario: string;
  responsables: string[];
  prioridad: string;
  turno: string;
  tipo: string;
  fechaVencimiento: string;
  attachments: Attachment[];
};

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,.doc,.docx,.xls,.xlsx';
// El server acepta MAX_UPLOAD_MB (10) de archivo, pero viaja en base64 dentro
// de un JSON de hasta 10 MB: en la práctica el tope real es ~7 MB. Mejor
// avisarlo acá que recibir un 413 sin explicación.
const MAX_MB = 7;

function initialDraft(initial: Partial<TaskItem> | undefined, visibility: 'team' | 'private', operator: string): Draft {
  const people = initial ? responsablesOf({ responsables: initial.responsables, responsable: initial.responsable || '' }).filter(name => name !== 'Sin asignar') : [operator];
  const due = String(initial?.fechaVencimiento || '').slice(0, 10);
  return {
    visibility: initial?.visibility || visibility,
    titulo: initial?.titulo || '',
    descripcion: initial?.descripcion || '',
    comentario: initial?.comentario || '',
    responsables: people.filter(Boolean),
    prioridad: initial?.prioridad || 'Media',
    turno: initial?.turno || 'Sin turno',
    tipo: initial?.tipo || '',
    fechaVencimiento: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : '',
    attachments: (initial?.attachments || []).slice()
  };
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
}

function mimeFromName(name: string) {
  const extension = name.split('.').pop()?.toLowerCase();
  return ({ doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf', txt: 'text/plain', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' } as Record<string, string>)[extension || ''] || 'application/octet-stream';
}

/**
 * Alta (en línea arriba del tablero) y edición (página /tareas/<id>/editar)
 * de una tarea, con todos los campos de siempre. Reemplaza al modal.
 */
export function TaskForm({ mode, initial, defaultVisibility, operator, people: sitePeople, tipos, firstColumn, isMobile, onCancel, onSubmit }: {
  mode: 'create' | 'edit';
  initial?: TaskItem;
  defaultVisibility: 'team' | 'private';
  operator: string;
  people: Person[];
  tipos: string[];
  firstColumn?: string;
  isMobile: boolean;
  onCancel: () => void;
  onSubmit: (payload: Partial<TaskItem>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(initial, defaultVisibility, operator));
  const [titleError, setTitleError] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(0);
  const uploaded = useRef(new Set<string>());
  const titleRef = useRef<HTMLInputElement | null>(null);
  const isNew = mode === 'create';

  useEffect(() => { titleRef.current?.focus({ preventScroll: true }); }, []);
  // Al cambiar la visibilidad desde el "+" (grupo / privada) con el alta abierta.
  useEffect(() => { if (isNew) setDraft(current => ({ ...current, visibility: defaultVisibility })); }, [defaultVisibility, isNew]);

  const patch = (change: Partial<Draft>) => setDraft(current => ({ ...current, ...change }));

  // Personas de la sede + vos + las que ya estaban elegidas (aunque no sean de la sede).
  const people = useMemo(() => Array.from(new Set([operator, ...sitePeople.map(person => person.name), ...draft.responsables].map(name => String(name || '').trim()).filter(Boolean))), [operator, sitePeople, draft.responsables]);
  const toggle = (name: string) => patch({ responsables: draft.responsables.includes(name) ? draft.responsables.filter(item => item !== name) : [...draft.responsables, name] });
  const tipoSuggestions = useMemo(() => {
    const base = Array.from(new Set([...TIPOS_BASE, ...tipos].filter(Boolean)));
    const q = draft.tipo.trim().toLowerCase();
    return base.filter(tipo => tipo.toLowerCase() !== q && (!q || tipo.toLowerCase().includes(q))).slice(0, 6);
  }, [tipos, draft.tipo]);

  const upload = async (file: File) => {
    setUploading(count => count + 1);
    try {
      const base64 = await readFileAsDataUrl(file);
      const response = await uploadTaskAttachment({ name: file.name, mimeType: file.type || mimeFromName(file.name), base64 });
      uploaded.current.add(response.attachment.url);
      setDraft(current => ({ ...current, attachments: [...current.attachments, response.attachment] }));
      return response.attachment;
    } finally {
      setUploading(count => count - 1);
    }
  };
  const onRemoveUpload = (item: FileDropItem) => {
    const result = item.result as Attachment | undefined;
    if (!result?.url) return;
    setDraft(current => ({ ...current, attachments: current.attachments.filter(attachment => attachment.url !== result.url) }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (!draft.titulo.trim()) {
      setTitleError('Poné un título.');
      titleRef.current?.focus();
      return;
    }
    if (uploading > 0) { setError('Esperá a que termine de subir el archivo.'); return; }
    const responsables = draft.responsables.length ? draft.responsables : ['Sin asignar'];
    const assigneeEmails = sitePeople.filter(person => responsables.includes(person.name)).map(person => person.email || '').filter(Boolean);
    const payload: Partial<TaskItem> = {
      ...(initial || {}),
      titulo: draft.titulo.trim(),
      descripcion: draft.descripcion,
      comentario: draft.comentario,
      responsables,
      responsable: responsables.join(','),
      assigneeEmails,
      prioridad: draft.prioridad,
      turno: draft.turno,
      tipo: draft.tipo.trim() || 'Soporte',
      fechaVencimiento: draft.fechaVencimiento,
      attachments: draft.attachments
    };
    if (isNew) payload.visibility = draft.visibility;
    setSaving(true);
    setError('');
    try {
      await onSubmit(payload);
    } catch (reason) {
      setError(reason instanceof Error && reason.message ? reason.message : 'No se pudo guardar la tarea.');
      setSaving(false);
    }
  };

  const listed = draft.attachments.filter(attachment => !uploaded.current.has(attachment.url));
  const title = isNew ? (draft.titulo.trim() || 'Nueva tarea') : (draft.titulo.trim() || 'Sin título');
  const eyebrow = isNew ? (draft.visibility === 'private' ? 'Nueva tarea privada' : 'Nueva tarea del grupo') : 'Editar tarea';

  return (
    <form
      className="tk-form ui-enter"
      aria-label={title}
      data-scanner-ignore=""
      onSubmit={submit}
      onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onCancel(); } }}
    >
      <header className="tk-form-head">
        <div className="tk-form-titles">
          <span className="tk-eyebrow">{eyebrow}</span>
          <h2 className="tk-h2">{title}</h2>
        </div>
        <IconButton label="Cancelar" icon={<X size={16} />} onClick={onCancel} />
      </header>

      {isNew ? (
        <div className="tk-vis" role="radiogroup" aria-label="Visibilidad">
          <button type="button" role="radio" aria-checked={draft.visibility === 'team'} className={cx('tk-vis-opt', draft.visibility === 'team' && 'is-on')} onClick={() => patch({ visibility: 'team' })}>
            <Users size={16} aria-hidden="true" />
            <span className="tk-vis-text"><span className="tk-vis-title">Tarea del grupo</span><span className="tk-vis-desc">La ve toda la sede</span></span>
          </button>
          <button type="button" role="radio" aria-checked={draft.visibility === 'private'} className={cx('tk-vis-opt', draft.visibility === 'private' && 'is-on')} onClick={() => patch({ visibility: 'private' })}>
            <Lock size={16} aria-hidden="true" />
            <span className="tk-vis-text"><span className="tk-vis-title">Mi tarea</span><span className="tk-vis-desc">Solo visible para vos</span></span>
          </button>
        </div>
      ) : (
        <p className="tk-form-note">
          {draft.visibility === 'private' ? 'Mi tarea: solo visible para vos' : 'Tarea del grupo: la ve toda la sede'}
          <span className="tk-muted"> · la visibilidad no se cambia al editar</span>
        </p>
      )}

      <div className="tk-form-grid">
        <div className="tk-form-col">
          <Input
            ref={titleRef}
            label="Título"
            required
            value={draft.titulo}
            placeholder="Ej. Revisar proyector de 4to B"
            error={titleError || undefined}
            onValueChange={value => { patch({ titulo: value }); if (titleError) setTitleError(''); }}
          />
          <Textarea label="Descripción" minRows={4} value={draft.descripcion} placeholder="Qué pasa, dónde y qué hay que hacer" onValueChange={value => patch({ descripcion: value })} />
          <Textarea label="Nota" minRows={3} value={draft.comentario} placeholder="Algo para el que la retome" onValueChange={value => patch({ comentario: value })} />
          <div className="tk-field">
            <span className="tk-label">Adjuntos</span>
            {listed.map(attachment => (
              <div className="tk-attach" key={attachment.url}>
                <Paperclip size={14} aria-hidden="true" className="tk-muted" />
                <a className="tk-ell" href={attachment.url} target="_blank" rel="noreferrer">{attachment.name}</a>
                <IconButton size="sm" label={`Quitar ${attachment.name}`} icon={<X size={14} />} onClick={() => patch({ attachments: draft.attachments.filter(item => item.url !== attachment.url) })} />
              </div>
            ))}
            <FileDrop
              multiple
              accept={ACCEPT}
              maxSizeMB={MAX_MB}
              label="Adjuntar archivo"
              hint={`PNG, JPG, WEBP, GIF, PDF, TXT, DOC, XLS · hasta ${MAX_MB} MB · también podés pegar con Ctrl V`}
              upload={upload}
              onRemove={onRemoveUpload}
            />
          </div>
        </div>

        <div className="tk-form-col">
          <div className="tk-field">
            <span className="tk-label">Responsables</span>
            <OptionChips
              multiple
              ariaLabel="Responsables"
              value={draft.responsables}
              onChange={toggle}
              options={people.map(name => ({ value: name, label: `${name}${name === operator ? ' (vos)' : ''}` }))}
            />
            <span className="tk-hint">Asignado a: <span className="tk-text-2">{joinNames(draft.responsables)}</span> · les llega un aviso a los asignados con mail</span>
          </div>
          <div className="tk-field">
            <span className="tk-label">Prioridad</span>
            <OptionChips ariaLabel="Prioridad" grid={isMobile} value={draft.prioridad} onChange={value => patch({ prioridad: value })} options={[...PRIORITIES].reverse().map(value => ({ value, label: value }))} />
          </div>
          <div className="tk-field">
            <span className="tk-label">Turno</span>
            <OptionChips ariaLabel="Turno" grid={isMobile} value={draft.turno} onChange={value => patch({ turno: value })} options={TURNOS.map(value => ({ value, label: value }))} />
          </div>
          <div className="tk-form-pair">
            <div className="tk-field">
              <Input label="Tipo" value={draft.tipo} placeholder="Soporte, Aula, Agenda…" onValueChange={value => patch({ tipo: value })} />
              {/* Las sugerencias aparecen y se van al tipear: con el colapso, sin saltos. */}
              <Collapse open={tipoSuggestions.length > 0} lazy={false} anchor={false} reveal={false}>
                <span className="tk-suggest" aria-label="Sugerencias de tipo">
                  {tipoSuggestions.map(tipo => <button key={tipo} type="button" className="tk-link tk-link--muted" onClick={() => patch({ tipo })}>{tipo}</button>)}
                </span>
              </Collapse>
            </div>
            <DatePicker
              label="Vencimiento"
              value={draft.fechaVencimiento}
              onChange={iso => patch({ fechaVencimiento: iso })}
              shortcuts
              clearable
            />
          </div>
        </div>
      </div>

      <Collapse open={Boolean(error)}><p className="tk-error" role="alert">{error}</p></Collapse>

      <footer className="tk-form-foot">
        <Button variant="primary" type="submit" loading={saving} loadingLabel="Guardando…" block={isMobile}>{isNew ? 'Crear tarea' : 'Guardar cambios'}</Button>
        <Button variant="ghost" onClick={onCancel} block={isMobile}>Cancelar</Button>
        <span className="tk-hint">{isNew ? `Arranca en «${firstColumn || 'Pendiente'}». ` : ''}Enter en un campo de una línea también guarda.</span>
      </footer>
    </form>
  );
}
