import { useMemo, useRef, useState } from 'react';
import { BotMessageSquare, ExternalLink, Pencil, Trash2 } from 'lucide-react';
import type { KnowledgeArticle } from '../../types';
import { Button, InlineConfirm, TruncatedText, icons } from '../../ui';
import { SmoothCollapse } from '../common/SmoothCollapse';
import { sanitizeArticleHtml } from './sanitize';
import { articleDate, categoryOf, fileKind } from './knowledgeModel';

export function KnowledgeReader({ article, consultationMode, onEdit, onDelete, onTag }: {
  article: KnowledgeArticle;
  consultationMode: boolean;
  onEdit: () => void;
  /** Devuelve cuando terminó (o tira el error para mostrarlo acá). */
  onDelete: () => Promise<void>;
  onTag: (tag: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const headRef = useRef<HTMLElement | null>(null);
  const deleteRef = useRef<HTMLButtonElement | null>(null);
  const html = useMemo(() => sanitizeArticleHtml(article.content), [article.content]);
  const by = article.updatedBy || article.createdBy;

  const remove = async () => {
    if (deleting) return;
    setDeleting(true);
    setError('');
    try {
      await onDelete();
    } catch (reason) {
      setError(reason instanceof Error && reason.message ? reason.message : 'No se pudo eliminar.');
      setDeleting(false);
    }
  };

  return (
    <article className="kb-card kb-reader" aria-labelledby="kb-read-title">
      <header className="kb-reader-head" ref={headRef}>
        <div className="kb-meta">
          <span className="kb-meta-cat">{categoryOf(article)}</span>
          {by && <span className="kb-meta-by">Editado por {by}</span>}
          <span className="kb-meta-date g-num">{articleDate(article.updatedAt)}</span>
        </div>
        <div className="kb-reader-titlerow">
          <h2 id="kb-read-title" className="kb-reader-title">{article.title}</h2>
          {!consultationMode && (
            <div className="kb-actions">
              <Button size="sm" icon={<Pencil size={14} />} onClick={onEdit}>Editar</Button>
              <Button
                ref={deleteRef}
                size="sm"
                variant="ghost"
                icon={<Trash2 size={14} />}
                aria-expanded={confirming}
                onClick={() => { setError(''); setConfirming(value => !value); }}
              >
                Eliminar
              </Button>
            </div>
          )}
        </div>
        <p className="kb-assist-note">
          <BotMessageSquare size={14} aria-hidden="true" />
          <span>Mientras lo leés, el Asistente lo toma como contexto.</span>
        </p>
      </header>

      <SmoothCollapse open={confirming && !consultationMode} anchorRef={headRef}>
        <div className="kb-confirm">
          <InlineConfirm
            danger
            message="¿Eliminar este artículo?"
            detail="Deja de verse en la base y el Asistente no lo consulta más. Podés deshacerlo enseguida."
            confirmLabel="Eliminar artículo"
            busy={deleting}
            onConfirm={() => void remove()}
            onCancel={() => { setConfirming(false); deleteRef.current?.focus({ preventScroll: true }); }}
          />
          {error && <p className="kb-error" role="alert">{error}</p>}
        </div>
      </SmoothCollapse>

      {html ? <div className="kb-art" dangerouslySetInnerHTML={{ __html: html }} /> : <p className="kb-muted">Este artículo no tiene texto.</p>}

      {article.tags.length > 0 && (
        <div className="kb-tags" role="group" aria-label="Tags">
          <span className="kb-tags-label">Tags</span>
          {article.tags.map(tag => (
            <button key={tag} type="button" className="kb-tag" aria-label={`Buscar artículos con el tag ${tag}`} onClick={() => onTag(tag)}>#{tag}</button>
          ))}
        </div>
      )}

      {article.attachments.length > 0 && (
        <section className="kb-att" aria-label="Adjuntos">
          <div className="kb-att-head">
            <h3 className="kb-att-title">Adjuntos</h3>
            <span className="kb-count g-num">{article.attachments.length}</span>
          </div>
          <ul className="kb-att-list">
            {article.attachments.map((file, index) => (
              <li key={`${file.url}-${index}`} className="kb-att-row">
                <icons.IconFile size={16} className="kb-att-icon" />
                <TruncatedText className="kb-att-name">{file.name}</TruncatedText>
                <span className="kb-att-kind">{fileKind(file.name, file.mimeType)}</span>
                <a className="kb-att-open" href={file.url} target="_blank" rel="noreferrer" aria-label={`Abrir ${file.name} en una pestaña nueva`}>
                  Abrir <ExternalLink size={12} aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
