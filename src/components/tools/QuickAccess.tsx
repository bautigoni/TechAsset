import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ClipboardList, ExternalLink, FileSpreadsheet, FileText, Folder, Globe, Mail, Pencil, Presentation, Ticket, Trash2, Video } from 'lucide-react';
import type { QuickLink } from '../../types';
import { Button, Combobox, IconButton, Input, TruncatedText, icons } from '../../ui';
import { peekDraft, useKeepDraft } from '../../utils/drafts';
import { Reveal } from '../settings/Reveal';

export { useQuickLinks, groupLinks } from './quickLinks';

/* ── Ícono por dominio (local: no se le pregunta a ningún tercero) ───────── */

export function hostOf(url: string) {
  return String(url || '').replace(/^https?:\/\//i, '').split(/[/?#]/)[0].replace(/^www\./, '');
}

export function linkIcon(url: string): ReactNode {
  const u = String(url || '').toLowerCase();
  const props = { size: 16, strokeWidth: 1.6 } as const;
  if (/docs\.google\.com\/spreadsheets|sheets\.|\.xlsx?\b/.test(u)) return <FileSpreadsheet {...props} />;
  if (/docs\.google\.com\/presentation/.test(u)) return <Presentation {...props} />;
  if (/docs\.google\.com\/forms|forms\.gle|forms\.office/.test(u)) return <ClipboardList {...props} />;
  if (/docs\.google\.com\/document|\.docx?\b/.test(u)) return <FileText {...props} />;
  if (/drive\.google\.com|sharepoint|onedrive|dropbox/.test(u)) return <Folder {...props} />;
  if (/invgate|handing|ticket|incident|soporte|helpdesk/.test(u)) return <Ticket {...props} />;
  if (/mail\.|outlook|gmail/.test(u)) return <Mail {...props} />;
  if (/meet\.google|zoom\.us|teams\.microsoft/.test(u)) return <Video {...props} />;
  return <Globe {...props} />;
}

/* ── Validación del link ────────────────────────────────────────────────── */

const DANGEROUS = /^\s*(javascript|data|vbscript|file):/i;
const HTTP = /^https?:\/\/[^\s/$.?#][^\s]*$/i;
const LOOKS_DOMAIN = /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]\S*)?$/;

export function checkUrl(raw: string): { error?: string; suggest?: string } {
  const value = raw.trim();
  if (!value) return { error: 'Poné el link.' };
  if (DANGEROUS.test(value)) return { error: 'Solo se permiten links http:// o https://.' };
  if (HTTP.test(value)) return {};
  if (LOOKS_DOMAIN.test(value)) return { error: 'Le falta https:// al principio.', suggest: `https://${value}` };
  if (/^\/\//.test(value) && LOOKS_DOMAIN.test(value.slice(2))) return { error: 'Le falta https: al principio.', suggest: `https:${value}` };
  return { error: 'Poné un link que empiece con https:// (o http://).' };
}

export type LinkDraft = { titulo: string; url: string; descripcion: string; categoria: string };

/**
 * Alta / edición en línea (reemplaza el modal). Enter guarda, Esc cancela.
 * Los valores no se pierden ante un error del server (quedan en el form) y si
 * hay cambios sin guardar, cerrar la pestaña pide confirmación.
 */
export function LinkForm({ initial, categories, title, submitLabel, onSubmit, onCancel, autoFocus = true, draftKey }: {
  initial: LinkDraft;
  categories: string[];
  title?: string;
  submitLabel: string;
  onSubmit: (draft: LinkDraft) => Promise<void>;
  onCancel: () => void;
  autoFocus?: boolean;
  /** Si viene, lo tipeado sobrevive a salir de la pantalla por el menú (borrador en memoria). */
  draftKey?: string;
}) {
  const [draft, setDraft] = useState<LinkDraft>(() => (draftKey && peekDraft<LinkDraft>(draftKey)) || initial);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState('');
  const firstRef = useRef<HTMLInputElement | null>(null);
  const dirty = draft.titulo !== initial.titulo || draft.url !== initial.url || draft.descripcion !== initial.descripcion || draft.categoria !== initial.categoria;
  // Cancelar o guardar desmonta el form "limpio" (onCancel/onSubmit lo marcan): solo queda el borrador si se salió sin cerrar.
  const closed = useRef(false);
  useKeepDraft(draftKey || '', draft, () => dirty && !closed.current);
  const cancel = () => { closed.current = true; onCancel(); };

  useEffect(() => { if (autoFocus) firstRef.current?.focus({ preventScroll: true }); }, [autoFocus]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const urlCheck = checkUrl(draft.url);
  const titleError = !draft.titulo.trim() ? 'Poné un nombre.' : '';
  const set = (patch: Partial<LinkDraft>) => { closed.current = false; setDraft(current => ({ ...current, ...patch })); setServerError(''); };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    setTouched(true);
    if (titleError || urlCheck.error) return;
    setBusy(true);
    setServerError('');
    try {
      closed.current = true; // si sale bien, el form se cierra: no queda borrador
      await onSubmit({ titulo: draft.titulo.trim(), url: draft.url.trim(), descripcion: draft.descripcion.trim(), categoria: draft.categoria.trim() || 'Sin categoría' });
    } catch (reason) {
      closed.current = false;
      setServerError(reason instanceof Error && reason.message ? reason.message : 'No se pudo guardar. Reintentá.');
    } finally {
      setBusy(false);
    }
  };

  const showUrlError = (touched || (draft.url.trim().length > 3 && Boolean(urlCheck.suggest))) && urlCheck.error;

  return (
    <form
      className="qa-form"
      onSubmit={submit}
      noValidate
      data-scanner-ignore=""
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); } }}
    >
      {title && (
        <div className="qa-form-head">
          <h2 className="qa-form-title">{title}</h2>
          <span className="qa-form-keys">Enter guarda · Esc cancela</span>
        </div>
      )}
      <div className="qa-form-grid">
        <Input ref={firstRef} label="Nombre" required value={draft.titulo} onValueChange={titulo => set({ titulo })} placeholder="Ej.: Listas EP" error={touched && titleError ? titleError : undefined} autoComplete="off" />
        <div className="qa-url">
          <Input
            label="Link"
            required
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={draft.url}
            onValueChange={url => set({ url })}
            onBlur={() => { if (draft.url.trim()) setTouched(true); }}
            placeholder="https://…"
            error={showUrlError || undefined}
          />
          <Reveal when={showUrlError && urlCheck.suggest}>
            {showUrlError && urlCheck.suggest && (
              <span className="qa-suggest">
                <span className="qa-suggest-text">¿Querés decir <span className="qa-mono">{urlCheck.suggest}</span>?</span>
                <Button size="sm" variant="ghost" onClick={() => set({ url: urlCheck.suggest || '' })}>Usar</Button>
              </span>
            )}
          </Reveal>
        </div>
        <Input label="Descripción (opcional)" value={draft.descripcion} onValueChange={descripcion => set({ descripcion })} placeholder="Para qué sirve" autoComplete="off" />
        <Combobox label="Categoría" value={draft.categoria} onChange={categoria => set({ categoria })} options={categories} placeholder="Institucionales, Personalizados…" />
      </div>
      <div className="qa-form-actions">
        {!title && <span className="qa-form-keys">Enter guarda · Esc cancela</span>}
        <Button variant="ghost" onClick={cancel} disabled={busy}>Cancelar</Button>
        <Button variant="primary" type="submit" loading={busy} loadingLabel="Guardando…">{submitLabel}</Button>
      </div>
      <Reveal when={serverError}>{serverError && <p className="qa-error" role="alert"><icons.IconAlert size={14} /><span>{serverError}</span></p>}</Reveal>
    </form>
  );
}

/* ── Una tarjeta de acceso (vista) ─────────────────────────────────────── */

export function LinkTile({ link, editable, sorting, isFirst, isLast, editing, confirming, onEdit, onDelete, onMove, registerMove }: {
  link: QuickLink;
  editable: boolean;
  sorting: boolean;
  isFirst: boolean;
  isLast: boolean;
  editing: boolean;
  confirming: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  registerMove: (dir: -1 | 1, node: HTMLButtonElement | null) => void;
}) {
  const domain = hostOf(link.url);
  return (
    <div className="qa-tile">
      <a className="qa-open" href={link.url} target="_blank" rel="noreferrer" aria-label={`${link.titulo} (abre en una pestaña nueva)`}>
        <span className="qa-icon" aria-hidden="true">{linkIcon(link.url)}</span>
        <span className="qa-text">
          <TruncatedText className="qa-title" lines={3}>{link.titulo}</TruncatedText>
          {link.descripcion && <TruncatedText className="qa-desc" lines={2}>{link.descripcion}</TruncatedText>}
          <TruncatedText className="qa-domain" lines={2}>{domain}</TruncatedText>
        </span>
        <ExternalLink className="qa-ext" size={14} strokeWidth={1.6} aria-hidden="true" />
      </a>
      {editable && (
        <div className="qa-acts">
          {sorting ? (
            <>
              <IconButton ref={node => registerMove(-1, node)} size="sm" label={`Subir ${link.titulo}`} icon={<icons.IconChevronUp size={16} />} disabled={isFirst} onClick={() => onMove(-1)} />
              <IconButton ref={node => registerMove(1, node)} size="sm" label={`Bajar ${link.titulo}`} icon={<icons.IconChevronDown size={16} />} disabled={isLast} onClick={() => onMove(1)} />
            </>
          ) : (
            <>
              <IconButton size="sm" label={editing ? `Cerrar la edición de ${link.titulo}` : `Editar ${link.titulo}`} pressed={editing} icon={<Pencil size={15} strokeWidth={1.6} />} onClick={onEdit} />
              <IconButton size="sm" label={`Borrar ${link.titulo}`} pressed={confirming} icon={<Trash2 size={15} strokeWidth={1.6} />} onClick={onDelete} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
