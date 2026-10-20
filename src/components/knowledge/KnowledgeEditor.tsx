import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Bold, ExternalLink, Heading, Italic, List } from 'lucide-react';
import { uploadKnowledgeAttachment } from '../../services/knowledgeApi';
import { Button, Collapse, Combobox, FileDrop, IconButton, Input, TagInput, TruncatedText, cx, icons, useStatusLine, type FileDropItem } from '../../ui';
import { hasArticleContent, sanitizeArticleHtml } from './sanitize';
import { errorText, fileKind, guessMime, readFileAsDataUrl, writeDraft, type KbAttachment, type KbDraft } from './knowledgeModel';

/**
 * Editor en la página (antes era un modal). El área de texto es un
 * contentEditable NO controlado: el HTML se carga una sola vez al abrir y React
 * nunca lo vuelve a escribir, así el cursor no salta al inicio al tipear (el bug
 * del editor viejo, que reescribía innerHTML en cada tecla). El contenido se lee
 * del DOM al guardar y se sanitiza con lista blanca (y el server lo vuelve a
 * limpiar). Negrita, cursiva, título y lista usan los comandos de edición del
 * navegador sobre la selección (con su deshacer nativo, Ctrl Z); Ctrl B / Ctrl I
 * y Ctrl S (guardar) funcionan con el foco en el texto.
 */

type Fmt = { bold: boolean; italic: boolean; heading: boolean; list: boolean };
const NO_FMT: Fmt = { bold: false, italic: false, heading: false, list: false };
const ACCEPT = 'image/png,image/jpeg,image/webp,.pdf,.txt,.docx,.xlsx';

function exec(command: string, value?: string) {
  try {
    // Deprecado en la especificación pero soportado por todos los navegadores, y
    // es lo único que conserva el deshacer nativo del campo editable.
    return document.execCommand(command, false, value);
  } catch {
    return false;
  }
}

function readFmt(): Fmt {
  try {
    const block = String(document.queryCommandValue('formatBlock') || '').toLowerCase();
    return {
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      heading: block === 'h2' || block === 'h3',
      list: document.queryCommandState('insertUnorderedList')
    };
  } catch {
    return NO_FMT;
  }
}

export type KnowledgeEditorProps = {
  draft: KbDraft;
  /** true = arranca con cambios (borrador recuperado). */
  startDirty?: boolean;
  siteCode: string;
  categories: string[];
  tagSuggestions: string[];
  onSave: (draft: KbDraft) => Promise<void>;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
  /** Confirmación "cambios sin guardar" que arma la página (va arriba del editor). */
  leaveConfirm?: ReactNode;
};

export function KnowledgeEditor({ draft, startDirty = false, siteCode, categories, tagSuggestions, onSave, onCancel, onDirtyChange, leaveConfirm }: KnowledgeEditorProps) {
  const [title, setTitle] = useState(draft.title);
  const [category, setCategory] = useState(draft.category || 'General');
  const [tags, setTags] = useState<string[]>(draft.tags);
  const [attachments, setAttachments] = useState<KbAttachment[]>(draft.attachments);
  const [sessionUrls, setSessionUrls] = useState<Set<string>>(() => new Set());
  const [dirty, setDirty] = useState(startDirty);
  const [htmlTick, setHtmlTick] = useState(0);
  const [titleError, setTitleError] = useState('');
  const [contentError, setContentError] = useState('');
  const [fileHint, setFileHint] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploads, setUploads] = useState(0);
  const [fmt, setFmt] = useState<Fmt>(NO_FMT);
  const status = useStatusLine();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const rangeRef = useRef<Range | null>(null);
  const savingRef = useRef(false);
  const isNew = draft.id === null;

  // El HTML se pone UNA vez (al montar). Después el DOM es del usuario.
  useLayoutEffect(() => {
    if (bodyRef.current) bodyRef.current.innerHTML = sanitizeArticleHtml(draft.html);
    try { exec('defaultParagraphSeparator', 'p'); } catch { /* noop */ }
    if (isNew) titleRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const touch = useCallback(() => setDirty(true), []);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  // Borrador a salvo (localStorage) mientras hay cambios: sobrevive a cambiar de
  // pantalla, a un error o a recargar.
  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => {
      writeDraft(siteCode, { id: draft.id, title, category, tags, attachments, html: bodyRef.current?.innerHTML || '', savedAt: Date.now() });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [dirty, title, category, tags, attachments, htmlTick, siteCode, draft.id]);

  // Estado de la barra de formato según dónde está el cursor.
  useEffect(() => {
    const onSelection = () => {
      const body = bodyRef.current;
      const selection = document.getSelection();
      if (!body || !selection?.rangeCount || !body.contains(selection.anchorNode)) return;
      rangeRef.current = selection.getRangeAt(0).cloneRange();
      setFmt(readFmt());
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  }, []);

  const restoreSelection = () => {
    const body = bodyRef.current;
    if (!body) return;
    const selection = document.getSelection();
    if (selection && selection.rangeCount && body.contains(selection.anchorNode)) return;
    body.focus({ preventScroll: true });
    if (rangeRef.current && selection) {
      selection.removeAllRanges();
      selection.addRange(rangeRef.current);
    }
  };

  const format = (kind: keyof Fmt) => {
    restoreSelection();
    if (kind === 'bold') exec('bold');
    else if (kind === 'italic') exec('italic');
    else if (kind === 'list') exec('insertUnorderedList');
    else exec('formatBlock', readFmt().heading ? '<p>' : '<h3>');
    setFmt(readFmt());
    setHtmlTick(value => value + 1);
    setContentError('');
    touch();
  };

  const onBodyInput = () => {
    setHtmlTick(value => value + 1);
    if (contentError) setContentError('');
    touch();
  };

  const onBodyPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const data = event.clipboardData;
    const html = data.getData('text/html');
    const text = data.getData('text/plain');
    event.preventDefault();
    if (!html && !text && data.files.length) {
      setFileHint('Las imágenes y archivos van en Adjuntos: pegalos o soltalos en el recuadro de abajo.');
      return;
    }
    if (html) exec('insertHTML', sanitizeArticleHtml(html));
    else exec('insertText', text);
    onBodyInput();
  };

  const onBodyDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    setFileHint('Las imágenes y archivos van en Adjuntos: soltalos en el recuadro de abajo.');
  };

  const save = async () => {
    if (savingRef.current) return;
    const html = sanitizeArticleHtml(bodyRef.current?.innerHTML || '');
    const cleanTitle = title.trim();
    const missingTitle = !cleanTitle;
    const missingBody = !hasArticleContent(html);
    setTitleError(missingTitle ? 'Falta el título. Sin título no se puede guardar.' : '');
    setContentError(missingBody ? 'Falta el contenido. Escribí al menos un párrafo.' : '');
    if (missingTitle) { titleRef.current?.focus(); return; }
    if (missingBody) { bodyRef.current?.focus(); return; }
    if (uploads > 0) {
      status.show({ tone: 'warn', message: 'Esperá a que terminen de subir los adjuntos y volvé a guardar.' });
      return;
    }
    savingRef.current = true;
    setSaving(true);
    status.clear();
    try {
      await onSave({ id: draft.id, title: cleanTitle, category: category.trim() || 'General', tags, attachments, html, savedAt: Date.now() });
    } catch (reason) {
      status.show({ tone: 'bad', message: `No se pudo guardar: ${errorText(reason)} Tus cambios siguen acá.`, retry: { onRetry: save } });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void save();
    }
  };

  const upload = useCallback(async (file: File) => {
    setUploads(value => value + 1);
    try {
      const base64 = await readFileAsDataUrl(file);
      const response = await uploadKnowledgeAttachment({ name: file.name, mimeType: file.type || guessMime(file.name), base64 });
      setAttachments(current => [...current, response.attachment]);
      setSessionUrls(current => new Set(current).add(response.attachment.url));
      setDirty(true);
      return response.attachment;
    } catch (reason) {
      const message = errorText(reason, 'No se pudo subir.');
      throw new Error(/413|too large|entity/i.test(message) ? 'Pesa demasiado para subirlo (hasta 7 MB).' : message);
    } finally {
      setUploads(value => value - 1);
    }
  }, []);

  const onRemoveUpload = useCallback((item: FileDropItem) => {
    const url = (item.result as KbAttachment | undefined)?.url;
    if (!url) return;
    setAttachments(current => current.filter(file => file.url !== url));
    setDirty(true);
  }, []);

  const kept = attachments.filter(file => !sessionUrls.has(file.url));
  const categoryOptions = Array.from(new Set(['General', ...categories])).sort((a, b) => (a === 'General' ? -1 : b === 'General' ? 1 : a.localeCompare(b, 'es')));
  const fmtButtons: Array<{ key: keyof Fmt; label: string; icon: ReactNode; keys?: string }> = [
    { key: 'bold', label: 'Negrita', icon: <Bold size={14} />, keys: 'Control+B' },
    { key: 'italic', label: 'Cursiva', icon: <Italic size={14} />, keys: 'Control+I' },
    { key: 'heading', label: 'Título', icon: <Heading size={14} /> },
    { key: 'list', label: 'Lista', icon: <List size={14} /> }
  ];

  return (
    <section className="kb-card kb-editor" aria-labelledby="kb-edit-title" data-scanner-ignore="" onKeyDown={onKeyDown}>
      <header className="kb-editor-head">
        <div className="kb-editor-titles">
          <span className="kb-eyebrow">{isNew ? 'Nuevo artículo' : 'Editando'}</span>
          <h2 id="kb-edit-title" className="kb-editor-title">{title.trim() || (isNew ? 'Artículo sin título' : 'Sin título')}</h2>
        </div>
        <span className={cx('kb-dirty', dirty && 'is-on')} aria-live="polite">{dirty ? 'Cambios sin guardar' : 'Sin cambios'}</span>
      </header>

      {leaveConfirm}

      <div className="kb-form">
        <Input
          ref={titleRef}
          id="kb-title"
          label="Título"
          required
          value={title}
          maxLength={200}
          placeholder="Ej.: Cómo conectar el proyector del aula 12"
          error={titleError || undefined}
          onValueChange={value => { setTitle(value); if (titleError && value.trim()) setTitleError(''); touch(); }}
        />
        <div className="kb-two">
          <Combobox
            label="Categoría"
            value={category}
            options={categoryOptions}
            hint="Elegí una o escribí una nueva."
            placeholder="General"
            onChange={value => { setCategory(value); touch(); }}
          />
          <TagInput
            label="Tags"
            value={tags}
            suggestions={tagSuggestions}
            placeholder="Agregar tag y Enter"
            hint="Enter o coma para agregar; se tipean de corrido."
            transform={tag => tag.replace(/^#/, '').toLowerCase()}
            max={30}
            onChange={next => { setTags(next); touch(); }}
          />
        </div>

        <div className="kb-body-field">
          <span className="kb-label" id="kb-body-label">Contenido <span aria-hidden="true" className="kb-req">*</span></span>
          <div className={cx('kb-rich', contentError && 'is-error')}>
            <div className="kb-toolbar" role="toolbar" aria-label="Formato">
              {fmtButtons.map(button => (
                <button
                  key={button.key}
                  type="button"
                  className={cx('kb-fmt', fmt[button.key] && 'is-on')}
                  aria-pressed={fmt[button.key]}
                  aria-label={button.label}
                  aria-keyshortcuts={button.keys}
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => format(button.key)}
                >
                  {button.icon}
                  <span>{button.label}</span>
                </button>
              ))}
              <span className="kb-toolbar-keys" aria-hidden="true">Ctrl B · Ctrl I · Ctrl S guarda</span>
            </div>
            <div
              ref={bodyRef}
              className="kb-art kb-rich-body"
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              aria-labelledby="kb-body-label"
              aria-invalid={contentError ? true : undefined}
              aria-describedby="kb-body-help"
              data-placeholder="Escribí el procedimiento…"
              spellCheck
              onInput={onBodyInput}
              onPaste={onBodyPaste}
              onDrop={onBodyDrop}
              onBlur={() => setFmt(NO_FMT)}
            />
          </div>
          <span id="kb-body-help" className={cx('kb-help', contentError && 'is-bad')} role={contentError ? 'alert' : undefined}>
            {contentError || fileHint || 'Podés pegar desde Docs o Word: se conservan negrita, cursiva, listas y títulos. Al guardar se quitan scripts, estilos, iframes y formularios.'}
          </span>
        </div>

        <div className="kb-attach">
          <div className="kb-att-head">
            <span className="kb-label">Adjuntos</span>
            <span className="kb-count g-num">{attachments.length}</span>
          </div>
          {/* Al quitar el último adjunto guardado la lista se pliega (no desaparece de golpe). */}
          <Collapse open={kept.length > 0} lazy={false} anchor={false} reveal={false} gap="var(--g-s-2)">
            <ul className="kb-att-list">
              {kept.map(file => (
                <li key={file.url} className="kb-att-row">
                  <icons.IconFile size={16} className="kb-att-icon" />
                  <TruncatedText className="kb-att-name">{file.name}</TruncatedText>
                  <span className="kb-att-kind">{fileKind(file.name, file.mimeType)}</span>
                  <a className="kb-att-open" href={file.url} target="_blank" rel="noreferrer" aria-label={`Abrir ${file.name} en una pestaña nueva`}>
                    Abrir <ExternalLink size={12} aria-hidden="true" />
                  </a>
                  <IconButton
                    size="sm"
                    label={`Quitar ${file.name}`}
                    icon={<icons.IconX size={14} />}
                    onClick={() => { setAttachments(current => current.filter(item => item.url !== file.url)); touch(); }}
                  />
                </li>
              ))}
            </ul>
          </Collapse>
          <FileDrop
            multiple
            accept={ACCEPT}
            maxSizeMB={7}
            upload={upload}
            onRemove={onRemoveUpload}
            label="Adjuntar archivo"
            title="Arrastrá archivos acá, pegá una imagen o tocá para elegir"
            hint="PNG, JPG, WEBP, PDF, TXT, DOCX o XLSX, hasta 7 MB."
          />
        </div>

        {status.element}

        <div className="kb-editor-foot">
          <span className="kb-foot-note">Se guarda en {siteCode}. El Asistente lo empieza a consultar apenas lo guardás.</span>
          <div className="kb-foot-actions">
            <Button variant="ghost" disabled={saving} onClick={onCancel}>Cancelar</Button>
            <Button variant="primary" loading={saving} loadingLabel="Guardando…" onClick={() => void save()}>Guardar artículo</Button>
          </div>
        </div>
      </div>
    </section>
  );
}
