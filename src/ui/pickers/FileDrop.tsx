import { useCallback, useEffect, useId, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Button, IconButton } from '../Button';
import { IconAlert, IconCheck, IconFile, IconRetry, IconUpload, IconX, Spinner } from '../icons';
import { cx } from '../util';

/**
 * Un solo patrón para subir archivos (reemplaza los 4 `input type=file` de
 * hoy): arrastrar y soltar, click (o Enter/Espacio) para elegir, pegar con
 * Ctrl V. Cada archivo muestra su estado en línea: subiendo con porcentaje,
 * listo, o error con Reintentar; siempre se puede quitar.
 */

export type FileDropStatus = 'ready' | 'uploading' | 'done' | 'error';
export type FileDropItem = { id: string; file: File; status: FileDropStatus; progress: number; error?: string; result?: unknown };

export type FileDropProps = {
  /** Igual que el atributo accept: 'image/*,.pdf'. */
  accept?: string;
  multiple?: boolean;
  /** Tamaño máximo por archivo en MB. */
  maxSizeMB?: number;
  /** Si viene, cada archivo se sube al agregarlo; `onProgress(0..1)` alimenta el porcentaje. */
  upload?: (file: File, onProgress: (ratio: number) => void) => Promise<unknown>;
  /** Lista vigente de archivos válidos (listos o subidos), para formularios sin subida inmediata. */
  onFilesChange?: (files: File[]) => void;
  /** Al quitar uno (p. ej. borrar el adjunto ya subido). */
  onRemove?: (item: FileDropItem) => void;
  title?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  /** Aceptar pegar con Ctrl V cuando la zona tiene foco (default true). */
  pasteable?: boolean;
  label?: string;
  className?: string;
  /** Archivos ya presentes al montar (p. ej. adjuntos de un ticket que se edita). */
  defaultItems?: FileDropItem[];
};

let counter = 0;
const newId = () => `f${Date.now().toString(36)}${(counter += 1)}`;

function matchesAccept(file: File, accept?: string) {
  if (!accept) return true;
  const name = file.name.toLowerCase();
  const type = (file.type || '').toLowerCase();
  return accept.split(',').map(part => part.trim().toLowerCase()).filter(Boolean).some(rule => {
    if (rule.startsWith('.')) return name.endsWith(rule);
    if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

export function FileDrop({ accept, multiple = false, maxSizeMB, upload, onFilesChange, onRemove, title, hint, disabled, pasteable = true, label = 'Adjuntar archivo', className, defaultItems = [] }: FileDropProps) {
  const [items, setItems] = useState<FileDropItem[]>(defaultItems);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hintId = useId();
  const changeRef = useRef(onFilesChange);
  changeRef.current = onFilesChange;

  useEffect(() => {
    changeRef.current?.(items.filter(item => item.status === 'ready' || item.status === 'done').map(item => item.file));
  }, [items]);

  const patch = (id: string, change: Partial<FileDropItem>) => setItems(current => current.map(item => (item.id === id ? { ...item, ...change } : item)));

  const start = useCallback(async (item: FileDropItem) => {
    if (!upload) return;
    patch(item.id, { status: 'uploading', progress: 0, error: undefined });
    try {
      const result = await upload(item.file, ratio => patch(item.id, { progress: Math.max(0, Math.min(1, ratio)) }));
      patch(item.id, { status: 'done', progress: 1, result });
    } catch (reason) {
      patch(item.id, { status: 'error', error: reason instanceof Error && reason.message ? reason.message : 'No se pudo subir.' });
    }
  }, [upload]);

  const add = (list: FileList | File[] | null) => {
    if (!list || disabled) return;
    const files = Array.from(list).slice(0, multiple ? undefined : 1);
    const next: FileDropItem[] = files.map(file => {
      let error: string | undefined;
      if (!matchesAccept(file, accept)) error = 'Tipo de archivo no permitido';
      else if (maxSizeMB && file.size > maxSizeMB * 1024 * 1024) error = `Pesa más de ${maxSizeMB} MB`;
      return { id: newId(), file, status: error ? 'error' : 'ready', progress: 0, error };
    });
    setItems(current => (multiple ? [...current, ...next] : next));
    next.filter(item => item.status === 'ready').forEach(item => { void start(item); });
  };

  const remove = (item: FileDropItem) => {
    setItems(current => current.filter(entry => entry.id !== item.id));
    onRemove?.(item);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    add(event.dataTransfer.files);
  };
  const onPaste = (event: ClipboardEvent) => {
    if (!pasteable || !event.clipboardData.files.length) return;
    event.preventDefault();
    add(event.clipboardData.files);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inputRef.current?.click(); }
  };

  const showZone = multiple || !items.length;

  return (
    <div className={cx('ui-filedrop', className)}>
      {showZone && (
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled || undefined}
          aria-label={label}
          aria-describedby={hintId}
          className={cx('ui-drop', over && 'is-over', disabled && 'is-disabled')}
          onClick={() => { if (!disabled) inputRef.current?.click(); }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onDragEnter={event => { event.preventDefault(); if (!disabled) setOver(true); }}
          onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = disabled ? 'none' : 'copy'; }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false); }}
          onDrop={onDrop}
        >
          <span className="ui-drop-icon" aria-hidden="true"><IconUpload size={20} /></span>
          <span className="ui-drop-title">{title || (over ? 'Soltalo acá' : `Arrastrá ${multiple ? 'los archivos' : 'el archivo'} acá o tocá para elegir`)}</span>
          <span className="ui-drop-hint" id={hintId}>
            {hint || [accept && `Acepta ${accept.replace(/,/g, ', ')}`, maxSizeMB && `hasta ${maxSizeMB} MB`, pasteable && 'también podés pegar con Ctrl V'].filter(Boolean).join(' · ')}
          </span>
          <input
            ref={inputRef}
            type="file"
            className="ui-sr"
            tabIndex={-1}
            aria-hidden="true"
            accept={accept}
            multiple={multiple}
            disabled={disabled}
            onChange={event => { add(event.target.files); event.target.value = ''; }}
          />
        </div>
      )}
      {items.length > 0 && (
        <ul className="ui-files" aria-label="Archivos">
          {items.map(item => (
            <li key={item.id} className={cx('ui-file', `is-${item.status}`)}>
              <span className="ui-file-icon" aria-hidden="true">
                {item.status === 'uploading' ? <Spinner /> : item.status === 'error' ? <IconAlert size={16} /> : item.status === 'done' ? <IconCheck size={16} /> : <IconFile size={16} />}
              </span>
              <span className="ui-file-text">
                <span className="ui-file-name">{item.file.name}</span>
                <span className="ui-file-meta" role={item.status === 'error' ? 'alert' : undefined} aria-live="polite">
                  {item.status === 'uploading' && <>Subiendo… <span className="g-num">{Math.round(item.progress * 100)} %</span></>}
                  {item.status === 'done' && <>Subido · {formatSize(item.file.size)}</>}
                  {item.status === 'ready' && formatSize(item.file.size)}
                  {item.status === 'error' && item.error}
                </span>
              </span>
              <span className="ui-file-actions">
                {item.status === 'error' && upload && matchesAccept(item.file, accept) && !(maxSizeMB && item.file.size > maxSizeMB * 1024 * 1024) && (
                  <Button size="sm" variant="secondary" icon={<IconRetry size={14} />} onClick={() => void start(item)}>Reintentar</Button>
                )}
                {!multiple && item.status !== 'uploading' && (
                  <Button size="sm" variant="ghost" onClick={() => inputRef.current?.click()}>Cambiar</Button>
                )}
                <IconButton size="sm" label={`Quitar ${item.file.name}`} icon={<IconX size={14} />} disabled={item.status === 'uploading'} onClick={() => remove(item)} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {!showZone && (
        <input
          ref={inputRef}
          type="file"
          className="ui-sr"
          tabIndex={-1}
          aria-hidden="true"
          accept={accept}
          disabled={disabled}
          onChange={event => { add(event.target.files); event.target.value = ''; }}
        />
      )}
    </div>
  );
}
