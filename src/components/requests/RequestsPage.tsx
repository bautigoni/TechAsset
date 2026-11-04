import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft, Paperclip, RotateCcw, SendHorizontal, X } from 'lucide-react';
import { Button } from '../layout/Button';
import { Modal } from '../layout/Modal';
import { confirmDialog, errorMessage, toast } from '../layout/Feedback';
import { DATE_ONLY, TIME_HM, formatDate } from '../../utils/formatters';
import {
  KIND_LABEL,
  REQUEST_LIMITS,
  STATUS_LABEL,
  askReply,
  deleteRequest,
  getRequest,
  imageUrl,
  listRequests,
  openDraft,
  prepareImage,
  sendMessage,
  submitRequest,
  withdrawRequest,
  type ChangeRequest,
  type RequestListItem,
  type RequestMessage
} from '../../services/requestsApi';

// «Pedidos de cambios»: la persona le cuenta a la IA qué quiere cambiar, la IA
// pregunta lo que falta y arma un resumen, y desde acá se envía y se sigue.
// Lo enviado lo lee cualquier cuenta; un pedido ajeno se ve sin cuadro de escribir
// ni acciones (`mine`), y los borradores son solo de su dueño.
// URL: /sede/<sede>/pedidos (lista) y /sede/<sede>/pedidos/<id> (pedido).

function idFromUrl() {
  return window.location.pathname.match(/\/pedidos\/([^/]+)/i)?.[1] || '';
}

function listUrl() {
  return window.location.pathname.replace(/\/pedidos(\/.*)?$/i, '/pedidos');
}

export function RequestsPage() {
  const [selectedId, setSelectedId] = useState(() => idFromUrl());

  useEffect(() => {
    const onPop = () => setSelectedId(idFromUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const open = useCallback((id: string) => {
    const next = id ? `${listUrl()}/${id}` : listUrl();
    if (window.location.pathname !== next) window.history.pushState(null, '', next);
    setSelectedId(id);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  return selectedId
    ? <RequestDetail key={selectedId} id={selectedId} onBack={() => open('')} />
    : <RequestList onOpen={open} />;
}

// ---------- Lista ----------

function StatusPill({ status }: { status: ChangeRequest['status'] }) {
  return <span className={`request-pill request-pill-${status}`}>{STATUS_LABEL[status]}</span>;
}

function RequestList({ onOpen }: { onOpen: (id: string) => void }) {
  const [items, setItems] = useState<RequestListItem[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    listRequests()
      .then(data => { setItems(data.items); setTruncated(data.truncated); })
      .catch(reason => { setItems([]); setError(errorMessage(reason, 'No se pudieron cargar los pedidos.')); });
  }, []);

  const start = async () => {
    setCreating(true);
    try {
      const draft = await openDraft();
      onOpen(draft.id);
    } catch (reason) {
      toast({ message: errorMessage(reason, 'No se pudo abrir un pedido nuevo.'), tone: 'error' });
      setCreating(false);
    }
  };

  return (
    <section className="view active requests-page">
      <div className="card-head requests-head">
        <div>
          <h2>Pedidos de cambios</h2>
          <p className="muted">Correcciones, cambios y cosas nuevas para la app, sin audios ni mensajes sueltos.</p>
        </div>
        <Button variant="primary" onClick={() => void start()} disabled={creating}>{creating ? 'Abriendo…' : 'Nuevo pedido'}</Button>
      </div>

      <ol className="requests-how" aria-label="Cómo funciona">
        <li><span className="requests-how-num" aria-hidden="true">1</span><div><strong>Contalo como se lo contarías a alguien</strong><p>Con tus palabras. Si ayuda, sumá una captura de la pantalla.</p></div></li>
        <li><span className="requests-how-num" aria-hidden="true">2</span><div><strong>La IA te pregunta lo que falta</strong><p>Y va armando un resumen claro de lo que necesitás.</p></div></li>
        <li><span className="requests-how-num" aria-hidden="true">3</span><div><strong>Lo enviás y lo seguís desde acá</strong><p>Lo enviado lo lee cualquier cuenta, con la charla y las capturas. Vas a ver cuándo está en curso y cuándo está hecho.</p></div></li>
      </ol>

      {error && <div className="tool-error" role="alert">{error}</div>}

      {items === null && <div className="requests-list" aria-busy="true">{[0, 1].map(key => <div key={key} className="request-row request-skeleton" />)}</div>}

      {items && !items.length && !error && (
        <div className="requests-empty">
          <h3>Todavía no hay pedidos</h3>
          <p className="muted">Cuando algo no funcione o se te ocurra una mejora, empezá por acá.</p>
          <Button variant="primary" onClick={() => void start()} disabled={creating}>Empezar un pedido</Button>
        </div>
      )}

      {items && items.length > 0 && (
        <ul className="requests-list" aria-label="Pedidos de todos">
          {items.map(item => (
            <li key={item.id}>
              <button type="button" className={`request-row request-row-${item.status}`} onClick={() => onOpen(item.id)}>
                <span className="request-row-main">
                  <span className="request-row-title">{item.title || item.summary.title || 'Pedido sin título'}</span>
                  <span className="request-row-meta">
                    <span className="request-row-author">{item.mine ? 'Vos' : item.requester.nombre}</span>
                    {' · '}{KIND_LABEL[item.summary.kind] || KIND_LABEL.change} · {formatDate(item.submittedAt || item.createdAt, DATE_ONLY)}
                    {item.status === 'draft' && ' · Solo lo ves vos'}
                  </span>
                  {item.note && <span className="request-row-note"><strong>Respuesta del equipo:</strong> {item.note}</span>}
                </span>
                <StatusPill status={item.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {truncated && items && <p className="muted requests-truncated">Se muestran los {items.length} pedidos más recientes.</p>}
    </section>
  );
}

// ---------- Pedido ----------

const isTouch = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

function formatMessageTime(at: string) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date().toDateString() === date.toDateString();
  return today ? formatDate(date, TIME_HM) : `${formatDate(date, DATE_ONLY)} ${formatDate(date, TIME_HM)}`;
}

type Attachment = { file: File; url: string };

function RequestDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [request, setRequest] = useState<ChangeRequest | null>(null);
  const [loadError, setLoadError] = useState('');
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState('');
  const [sending, setSending] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [replyFailed, setReplyFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState<{ src: string; name: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const chatRef = useRef<HTMLDivElement | null>(null);
  const summaryRef = useRef<HTMLElement | null>(null);
  const scrolledOnce = useRef(false);
  const textareaId = useId();

  useEffect(() => {
    getRequest(id)
      .then(item => { setRequest(item); setReplyFailed(item.mine && item.awaitingReply); })
      .catch(reason => setLoadError(errorMessage(reason, 'No se pudo abrir el pedido.')));
  }, [id]);

  // Las vistas previas usan object URLs: se liberan al sacarlas o al salir.
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  useEffect(() => () => attachmentsRef.current.forEach(item => URL.revokeObjectURL(item.url)), []);

  const messages = request?.messages || [];
  const mine = Boolean(request?.mine);
  const open = request ? request.status === 'draft' || request.status === 'pending' : false;
  const canWrite = mine && open;
  const firstMessage = (request?.userMessages || 0) === 0;
  const imagesLeft = REQUEST_LIMITS.imagesPerRequest - (request?.images?.length || 0) - attachments.length;

  // Hay una sola barra de scroll, la de la página. Al abrir (sin animación) y con
  // cada mensaje se baja hasta el final del chat; si ya está listo, hasta el resumen.
  // Un pedido ajeno se lee desde arriba: título, de quién es y nota del equipo.
  const readyToSend = Boolean(request?.ready) && request?.status === 'draft' && !thinking;
  useEffect(() => {
    if (messages.length < 2 || !mine) return;
    const target = readyToSend ? summaryRef.current : chatRef.current;
    target?.scrollIntoView({ block: 'end', behavior: scrolledOnce.current ? 'smooth' : 'instant' });
    scrolledOnce.current = true;
  }, [messages.length, thinking, readyToSend, mine]);

  // La caja crece de 2 a 10 líneas.
  useLayoutEffect(() => {
    const area = textareaRef.current;
    if (!area) return;
    const line = parseFloat(getComputedStyle(area).lineHeight) || 22;
    const padding = area.offsetHeight - area.clientHeight + parseFloat(getComputedStyle(area).paddingTop) + parseFloat(getComputedStyle(area).paddingBottom);
    area.style.height = 'auto';
    area.style.height = `${Math.min(Math.max(area.scrollHeight, line * 2 + padding), line * 10 + padding)}px`;
  }, [text, request?.status]);

  const runReply = useCallback(async () => {
    setThinking(true);
    setReplyFailed(false);
    try {
      setRequest(await askReply(id));
    } catch {
      setReplyFailed(true);
    } finally {
      setThinking(false);
    }
  }, [id]);

  const addFiles = async (list: FileList | null) => {
    setAttachError('');
    const files = Array.from(list || []);
    if (!files.length) return;
    const perMessageLeft = REQUEST_LIMITS.imagesPerMessage - attachments.length;
    const room = Math.min(perMessageLeft, imagesLeft);
    if (room <= 0) {
      setAttachError(perMessageLeft <= 0
        ? `Podés adjuntar hasta ${REQUEST_LIMITS.imagesPerMessage} capturas por mensaje.`
        : `Este pedido ya tiene el máximo de ${REQUEST_LIMITS.imagesPerRequest} capturas.`);
      return;
    }
    if (files.length > room) setAttachError(`Solo entran ${room} captura${room === 1 ? '' : 's'} más: ${perMessageLeft < imagesLeft ? `hasta ${REQUEST_LIMITS.imagesPerMessage} por mensaje` : `hasta ${REQUEST_LIMITS.imagesPerRequest} por pedido`}.`);
    const ready: Attachment[] = [];
    for (const file of files.slice(0, room)) {
      try {
        const prepared = await prepareImage(file);
        ready.push({ file: prepared, url: URL.createObjectURL(prepared) });
      } catch (reason) {
        setAttachError(errorMessage(reason, 'No se pudo adjuntar la captura.'));
      }
    }
    setAttachments(current => [...current, ...ready]);
  };

  const removeAttachment = (url: string) => {
    URL.revokeObjectURL(url);
    setAttachments(current => current.filter(item => item.url !== url));
    setAttachError('');
  };

  const send = async () => {
    const clean = text.trim();
    if (!request || sending || thinking || (!clean && !attachments.length)) return;
    if (clean.length > REQUEST_LIMITS.textChars) {
      toast({ message: `El mensaje puede tener hasta ${REQUEST_LIMITS.textChars} caracteres.`, tone: 'warn' });
      return;
    }
    setSending(true);
    try {
      const saved = await sendMessage(request.id, clean, attachments.map(item => item.file));
      attachments.forEach(item => URL.revokeObjectURL(item.url));
      setAttachments([]);
      setAttachError('');
      setText('');
      setRequest(saved);
      setSending(false);
      textareaRef.current?.focus();
      await runReply();
    } catch (reason) {
      // Lo escrito y las capturas quedan donde estaban para reintentar.
      toast({ message: errorMessage(reason, 'No se pudo enviar el mensaje.'), tone: 'error' });
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || isTouch()) return;
    event.preventDefault();
    void send();
  };

  const submit = async () => {
    if (!request) return;
    setBusy(true);
    try {
      setRequest(await submitRequest(request.id));
      toast({ message: 'Pedido enviado. ¡Gracias! Vas a ver acá cuando esté en curso y cuando esté hecho.', tone: 'ok', durationMs: 6000 });
    } catch (reason) {
      toast({ message: errorMessage(reason, 'No se pudo enviar el pedido.'), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    if (!request) return;
    if (!(await confirmDialog({ title: 'Descartar el borrador', message: 'Se borra la conversación y las capturas. No se puede deshacer.', confirmLabel: 'Descartar', danger: true }))) return;
    setBusy(true);
    try {
      await deleteRequest(request.id);
      toast({ message: 'Borrador descartado.', tone: 'info' });
      onBack();
    } catch (reason) {
      toast({ message: errorMessage(reason, 'No se pudo descartar.'), tone: 'error' });
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (!request) return;
    if (!(await confirmDialog({ title: 'Cancelar el pedido', message: 'El equipo no lo va a trabajar. Si después lo necesitás, podés empezar uno nuevo.', confirmLabel: 'Cancelar pedido', cancelLabel: 'Volver', danger: true }))) return;
    setBusy(true);
    try {
      setRequest(await withdrawRequest(request.id));
      toast({ message: 'Pedido cancelado.', tone: 'info' });
    } catch (reason) {
      toast({ message: errorMessage(reason, 'No se pudo cancelar.'), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const imageName = useMemo(() => new Map((request?.images || []).map(image => [image.id, image.name])), [request?.images]);

  if (loadError) {
    return (
      <section className="view active requests-page">
        <button type="button" className="requests-back" onClick={onBack}><ArrowLeft size={16} /> Pedidos de cambios</button>
        <div className="requests-empty"><h3>{loadError}</h3><Button onClick={onBack}>Volver a los pedidos</Button></div>
      </section>
    );
  }

  if (!request) {
    return (
      <section className="view active requests-page" aria-busy="true">
        <button type="button" className="requests-back" onClick={onBack}><ArrowLeft size={16} /> Pedidos de cambios</button>
        <div className="request-layout"><div className="request-chat request-skeleton" /><div className="request-summary request-skeleton" /></div>
      </section>
    );
  }

  const resolved = request.status === 'done' || request.status === 'discarded';
  const title = request.title || request.summary.title || 'Nuevo pedido';
  const requester = request.requester.nombre;

  return (
    <section className="view active requests-page">
      <button type="button" className="requests-back" onClick={onBack}><ArrowLeft size={16} /> Pedidos de cambios</button>
      <div className="request-titlebar">
        <h2>{title}</h2>
        <StatusPill status={request.status} />
      </div>
      {!mine && (
        <p className="request-byline muted">
          Pedido de <strong>{requester}</strong>{request.submittedAt && ` · ${formatDate(request.submittedAt, DATE_ONLY)}`}
        </p>
      )}

      {request.note && (
        <div className={`request-note request-note-${request.status}`} role="status">
          <strong>{request.status === 'done' ? 'Listo' : request.status === 'discarded' ? 'Respuesta del equipo' : 'Nota del equipo'}</strong>
          <p>{request.note}</p>
        </div>
      )}

      <div className="request-layout">
        <div className="request-chat" ref={chatRef}>
          <div className="request-messages" aria-live="polite" aria-label="Conversación">
            {messages.map((message, index) => (
              <ChatBubble key={`${message.at}-${index}`} message={message} author={mine ? 'Vos' : requester} requestId={request.id} imageName={imageName} onZoom={setZoom} />
            ))}
            {thinking && (
              <div className="request-bubble request-bubble-assistant request-typing" aria-label="La IA está escribiendo">
                <span /><span /><span />
              </div>
            )}
            {replyFailed && !thinking && canWrite && (
              <div className="request-retry" role="alert">
                <span>La IA no pudo responder. Tu mensaje quedó guardado.</span>
                <Button onClick={() => void runReply()}><RotateCcw size={15} /> Reintentar</Button>
              </div>
            )}
          </div>

          {canWrite ? (
            <div className="request-composer">
              {attachments.length > 0 && (
                <ul className="request-attachments" aria-label="Capturas para enviar">
                  {attachments.map(item => (
                    <li key={item.url}>
                      <img src={item.url} alt={item.file.name} />
                      <button type="button" aria-label={`Quitar ${item.file.name}`} onClick={() => removeAttachment(item.url)}><X size={14} /></button>
                    </li>
                  ))}
                </ul>
              )}
              {attachError && <p className="request-attach-error" role="alert">{attachError}</p>}
              <div className="request-composer-row">
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={event => { void addFiles(event.target.files); event.target.value = ''; }} />
                <button type="button" className="request-icon-btn" aria-label="Adjuntar captura" title="Adjuntar captura" onClick={() => fileRef.current?.click()} disabled={sending || imagesLeft <= 0}>
                  <Paperclip size={18} />
                </button>
                <label htmlFor={textareaId} className="sr-only">Tu mensaje</label>
                <textarea
                  id={textareaId}
                  ref={textareaRef}
                  className="request-textarea"
                  rows={2}
                  value={text}
                  maxLength={REQUEST_LIMITS.textChars}
                  placeholder={firstMessage ? 'Ej.: En Préstamos quiero poder elegir el curso de una lista en vez de escribirlo…' : 'Respondé acá…'}
                  onChange={event => setText(event.target.value)}
                  onKeyDown={onKeyDown}
                  disabled={sending}
                />
                <button type="button" className="request-send" aria-label="Enviar mensaje" onClick={() => void send()} disabled={sending || thinking || (!text.trim() && !attachments.length)}>
                  <SendHorizontal size={18} />
                </button>
              </div>
            </div>
          ) : (
            <p className="request-closed muted">
              {!mine
                ? `Este pedido es de ${requester}: podés leerlo, pero solo esa persona puede sumarle cosas.`
                : request.status === 'in_progress'
                ? 'El equipo ya está trabajando en este pedido. Si querés sumar algo, empezá uno nuevo.'
                : 'Este pedido está cerrado. Si querés sumar algo, empezá uno nuevo.'}
            </p>
          )}
        </div>

        <aside className="request-summary" ref={summaryRef} aria-label="Resumen del pedido">
          <SummaryCard request={request} />
          {mine && !resolved && (
            <div className="request-actions">
              {request.status === 'draft' && (
                <>
                  <Button variant="primary" onClick={() => void submit()} disabled={busy || thinking || sending || firstMessage}>
                    {request.ready ? 'Enviar pedido' : 'Enviar así'}
                  </Button>
                  <Button variant="ghost" onClick={() => void discard()} disabled={busy}>Descartar</Button>
                </>
              )}
              {request.status === 'pending' && (
                <Button variant="ghost" onClick={() => void withdraw()} disabled={busy}>Cancelar pedido</Button>
              )}
              {request.status === 'draft' && !request.ready && !firstMessage && (
                <p className="muted request-actions-hint">La IA todavía tiene alguna pregunta, pero si ya está todo dicho podés enviarlo así.</p>
              )}
              {request.status === 'draft' && (
                <p className="muted request-actions-hint">Hasta que lo envíes solo lo ves vos. Después lo puede leer cualquier cuenta, con la conversación y las capturas.</p>
              )}
            </div>
          )}
        </aside>
      </div>

      {zoom && (
        <Modal title={zoom.name} size="wide" onClose={() => setZoom(null)}>
          <img className="request-zoom" src={zoom.src} alt={zoom.name} />
        </Modal>
      )}
    </section>
  );
}

function ChatBubble({ message, author, requestId, imageName, onZoom }: {
  message: RequestMessage;
  author: string;
  requestId: string;
  imageName: Map<string, string>;
  onZoom: (image: { src: string; name: string }) => void;
}) {
  const fromUser = message.role === 'user';
  return (
    <div className={`request-bubble request-bubble-${fromUser ? 'user' : 'assistant'}`}>
      <span className="sr-only">{fromUser ? `${author}:` : 'Asistente:'}</span>
      {message.text && <p>{message.text}</p>}
      {message.imageIds.length > 0 && (
        <div className="request-thumbs">
          {message.imageIds.map(imageId => {
            const src = imageUrl(requestId, imageId);
            const name = imageName.get(imageId) || 'Captura';
            return (
              <button key={imageId} type="button" className="request-thumb" onClick={() => onZoom({ src, name })} aria-label={`Agrandar ${name}`}>
                <img src={src} alt={name} loading="lazy" />
              </button>
            );
          })}
        </div>
      )}
      <time dateTime={message.at}>{formatMessageTime(message.at)}</time>
    </div>
  );
}

function SummaryCard({ request }: { request: ChangeRequest }) {
  const summary = request.summary;
  // Hasta la primera respuesta de la IA no hay nada entendido que mostrar.
  const empty = !summary.title;
  return (
    <div className="request-summary-card">
      <div className="request-summary-head">
        <h3>Resumen</h3>
        {!empty && <span className={`request-kind request-kind-${summary.kind}`}>{KIND_LABEL[summary.kind] || KIND_LABEL.change}</span>}
      </div>
      {empty ? (
        <p className="muted">{request.mine ? 'Acá va a aparecer lo que la IA entendió de tu pedido, y se actualiza con cada respuesta.' : 'La IA no llegó a armar un resumen de este pedido: está todo en la conversación.'}</p>
      ) : (
        <dl className="request-summary-fields">
          <div><dt>Título</dt><dd>{summary.title || '—'}</dd></div>
          <div><dt>Dónde</dt><dd>{summary.screen || 'Todavía no está claro'}</dd></div>
          {summary.kind !== 'new' && <div><dt>Hoy</dt><dd>{summary.today || '—'}</dd></div>}
          <div><dt>{request.mine ? 'Lo que querés' : 'Lo que pide'}</dt><dd>{summary.desired || '—'}</dd></div>
          {summary.details.length > 0 && (
            <div><dt>Detalles</dt><dd><ul>{summary.details.map((detail, index) => <li key={index}>{detail}</li>)}</ul></dd></div>
          )}
        </dl>
      )}
    </div>
  );
}
