import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft, MessageSquarePlus, Paperclip, SendHorizontal, X } from 'lucide-react';
import '../../styles/screens/requests.css';
import { Button, EmptyState, ErrorState, Eyebrow, IconButton, SkeletonRows, StatusText, scrollParentOf, useInlineConfirm, type StatusTextTone } from '../../ui';
import { pickFiles } from '../../ui/pickFiles';
import { pushStatus } from '../../ui/Status';
import { errorMessage } from '../layout/Feedback';
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
  type RequestMessage
} from '../../services/requestsApi';

// «Pedidos de cambios»: la persona le cuenta a la IA qué quiere cambiar, la IA
// pregunta lo que falta y arma un resumen, y desde acá se envía y se sigue.
// URL: /sede/<sede>/pedidos (lista) y /sede/<sede>/pedidos/<id> (pedido).
// Una sola columna centrada y un solo scroll, el del contenido.

const STATUS_TONE: Record<ChangeRequest['status'], StatusTextTone> = {
  draft: 'muted',
  pending: 'info',
  in_progress: 'warn',
  done: 'ok',
  discarded: 'muted'
};

function idFromUrl() {
  return window.location.pathname.match(/\/pedidos\/([^/]+)/i)?.[1] || '';
}

function listUrl() {
  return window.location.pathname.replace(/\/pedidos(\/.*)?$/i, '/pedidos');
}

export function RequestsPage() {
  const [selectedId, setSelectedId] = useState(() => idFromUrl());
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPop = () => setSelectedId(idFromUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const open = useCallback((id: string) => {
    const next = id ? `${listUrl()}/${id}` : listUrl();
    if (window.location.pathname !== next) window.history.pushState(null, '', next);
    setSelectedId(id);
    scrollParentOf(rootRef.current).scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  return (
    <div ref={rootRef} className="rq-page">
      {selectedId
        ? <RequestDetail key={selectedId} id={selectedId} onBack={() => open('')} />
        : <RequestList onOpen={open} />}
    </div>
  );
}

// ---------- Lista ----------

function StatusPill({ status }: { status: ChangeRequest['status'] }) {
  return <StatusText tone={STATUS_TONE[status]} strong>{STATUS_LABEL[status]}</StatusText>;
}

function RequestList({ onOpen }: { onOpen: (id: string) => void }) {
  const [items, setItems] = useState<ChangeRequest[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setError('');
    listRequests().then(setItems).catch(reason => { setItems([]); setError(errorMessage(reason, 'No se pudieron cargar tus pedidos.')); });
  }, []);
  useEffect(load, [load]);

  const start = async () => {
    setCreating(true);
    try {
      const draft = await openDraft();
      onOpen(draft.id);
    } catch (reason) {
      pushStatus({ tone: 'bad', message: errorMessage(reason, 'No se pudo abrir un pedido nuevo.') });
      setCreating(false);
    }
  };

  return (
    <>
      <header className="rq-head">
        <p className="rq-head-text">Correcciones, cambios y cosas nuevas para la app, sin audios ni mensajes sueltos.</p>
        <Button variant="primary" icon={<MessageSquarePlus size={16} strokeWidth={1.8} />} loading={creating} loadingLabel="Abriendo…" onClick={() => void start()}>Nuevo pedido</Button>
      </header>

      <ol className="rq-how" aria-label="Cómo funciona">
        <li><span className="rq-how-num" aria-hidden="true">1</span><span><b>Contalo con tus palabras</b><span className="rq-how-desc">Si ayuda, sumá una captura de la pantalla.</span></span></li>
        <li><span className="rq-how-num" aria-hidden="true">2</span><span><b>La IA pregunta lo que falta</b><span className="rq-how-desc">Y arma un resumen claro de lo que necesitás.</span></span></li>
        <li><span className="rq-how-num" aria-hidden="true">3</span><span><b>Lo enviás y lo seguís desde acá</b><span className="rq-how-desc">Vas a ver cuándo está en curso y cuándo está hecho.</span></span></li>
      </ol>

      {error && <ErrorState message={error} onRetry={load} />}
      {items === null && <SkeletonRows rows={3} />}

      {items && !items.length && !error && (
        <EmptyState
          center
          icon={<MessageSquarePlus size={22} strokeWidth={1.6} />}
          title="Todavía no hiciste pedidos"
          description="Cuando algo no funcione o se te ocurra una mejora, empezá por acá."
        />
      )}

      {items && items.length > 0 && (
        <ul className="rq-list">
          {items.map(item => (
            <li key={item.id}>
              <button type="button" className="rq-row" onClick={() => onOpen(item.id)}>
                <span className="rq-row-main">
                  <span className="rq-row-title">{item.title || item.summary.title || 'Pedido sin título'}</span>
                  <span className="rq-row-meta">{KIND_LABEL[item.summary.kind] || KIND_LABEL.change} · {formatDate(item.submittedAt || item.createdAt, DATE_ONLY)}</span>
                  {item.note && <span className="rq-row-note"><b>Respuesta del equipo:</b> {item.note}</span>}
                </span>
                <StatusPill status={item.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const chatRef = useRef<HTMLDivElement | null>(null);
  const summaryRef = useRef<HTMLElement | null>(null);
  const scrolledOnce = useRef(false);
  const confirm = useInlineConfirm();
  const textareaId = useId();

  useEffect(() => {
    getRequest(id)
      .then(item => { setRequest(item); setReplyFailed(item.awaitingReply); })
      .catch(reason => setLoadError(errorMessage(reason, 'No se pudo abrir el pedido.')));
  }, [id]);

  // Las vistas previas usan object URLs: se liberan al sacarlas o al salir.
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  useEffect(() => () => attachmentsRef.current.forEach(item => URL.revokeObjectURL(item.url)), []);

  const messages = request?.messages || [];
  const open = request ? request.status === 'draft' || request.status === 'pending' : false;
  const firstMessage = (request?.userMessages || 0) === 0;
  const imagesLeft = REQUEST_LIMITS.imagesPerRequest - (request?.images?.length || 0) - attachments.length;

  // Al abrir (sin animación) y con cada mensaje se baja hasta el final del chat;
  // si ya está listo, hasta el resumen, que es lo que sigue.
  const readyToSend = Boolean(request?.ready) && request?.status === 'draft' && !thinking;
  useEffect(() => {
    if (messages.length < 2) return;
    const target = readyToSend ? summaryRef.current : chatRef.current;
    target?.scrollIntoView({ block: 'end', behavior: scrolledOnce.current ? 'smooth' : 'instant' });
    scrolledOnce.current = true;
  }, [messages.length, thinking, readyToSend]);

  // La caja crece de 2 a 10 líneas.
  useLayoutEffect(() => {
    const area = textareaRef.current;
    if (!area) return;
    const style = getComputedStyle(area);
    const line = parseFloat(style.lineHeight) || 22;
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
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
    setSending(true);
    try {
      const saved = await sendMessage(request.id, clean, attachments.map(item => item.file));
      attachments.forEach(item => URL.revokeObjectURL(item.url));
      setAttachments([]);
      setAttachError('');
      setText('');
      setRequest(saved);
      setSending(false);
      textareaRef.current?.focus({ preventScroll: true });
      await runReply();
    } catch (reason) {
      // Lo escrito y las capturas quedan donde estaban para reintentar.
      pushStatus({ tone: 'bad', message: errorMessage(reason, 'No se pudo enviar el mensaje.') });
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
      pushStatus({ tone: 'ok', message: 'Pedido enviado. Vas a ver acá cuando esté en curso y cuando esté hecho.', autoHideMs: 6000 });
    } catch (reason) {
      pushStatus({ tone: 'bad', message: errorMessage(reason, 'No se pudo enviar el pedido.') });
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    if (!request) return;
    if (!(await confirm.ask({ message: '¿Descartar el borrador?', detail: 'Se borra la conversación y las capturas. No se puede deshacer.', confirmLabel: 'Descartar', danger: true }))) return;
    setBusy(true);
    try {
      await deleteRequest(request.id);
      pushStatus({ tone: 'info', message: 'Borrador descartado.', autoHideMs: 4000 });
      onBack();
    } catch (reason) {
      pushStatus({ tone: 'bad', message: errorMessage(reason, 'No se pudo descartar.') });
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (!request) return;
    if (!(await confirm.ask({ message: '¿Cancelar el pedido?', detail: 'El equipo no lo va a trabajar. Si después lo necesitás, podés empezar uno nuevo.', confirmLabel: 'Cancelar pedido', cancelLabel: 'Volver', danger: true }))) return;
    setBusy(true);
    try {
      setRequest(await withdrawRequest(request.id));
      pushStatus({ tone: 'info', message: 'Pedido cancelado.', autoHideMs: 4000 });
    } catch (reason) {
      pushStatus({ tone: 'bad', message: errorMessage(reason, 'No se pudo cancelar.') });
    } finally {
      setBusy(false);
    }
  };

  const imageName = useMemo(() => new Map((request?.images || []).map(image => [image.id, image.name])), [request?.images]);

  const back = <button type="button" className="rq-back" onClick={onBack}><ArrowLeft size={16} strokeWidth={1.6} aria-hidden="true" /> Mis pedidos</button>;

  if (loadError) return <>{back}<ErrorState message={loadError} /></>;

  if (!request) return <div aria-busy="true">{back}<SkeletonRows rows={5} /></div>;

  const resolved = request.status === 'done' || request.status === 'discarded';
  const title = request.title || request.summary.title || 'Nuevo pedido';

  return (
    <>
      {back}
      <div className="rq-titlebar">
        <h2>{title}</h2>
        <StatusPill status={request.status} />
      </div>

      {request.note && (
        <div className="rq-note" role="status">
          <Eyebrow>{request.status === 'done' ? 'Listo' : request.status === 'discarded' ? 'Respuesta del equipo' : 'Nota del equipo'}</Eyebrow>
          <p>{request.note}</p>
        </div>
      )}

      <div className="rq-chat" ref={chatRef}>
        <div className="rq-messages" aria-live="polite" aria-label="Conversación">
          {messages.map((message, index) => (
            <ChatBubble key={`${message.at}-${index}`} message={message} requestId={request.id} imageName={imageName} />
          ))}
          {thinking && (
            <div className="rq-bubble rq-bubble-assistant rq-typing" aria-label="La IA está escribiendo">
              <span /><span /><span />
            </div>
          )}
          {replyFailed && !thinking && open && (
            <ErrorState message="La IA no pudo responder. Tu mensaje quedó guardado." onRetry={() => void runReply()} />
          )}
        </div>

        {open ? (
          <div className="rq-composer">
            {attachments.length > 0 && (
              <ul className="rq-attachments" aria-label="Capturas para enviar">
                {attachments.map(item => (
                  <li key={item.url}>
                    <img src={item.url} alt={item.file.name} />
                    <button type="button" aria-label={`Quitar ${item.file.name}`} onClick={() => removeAttachment(item.url)}><X size={14} aria-hidden="true" /></button>
                  </li>
                ))}
              </ul>
            )}
            {attachError && <p className="rq-attach-error" role="alert">{attachError}</p>}
            <div className="rq-composer-row">
              <IconButton
                label="Adjuntar captura"
                icon={<Paperclip size={18} strokeWidth={1.6} />}
                onClick={() => pickFiles({ accept: 'image/jpeg,image/png,image/webp', multiple: true, onPick: list => void addFiles(list) })}
                disabled={sending || imagesLeft <= 0}
              />
              <label htmlFor={textareaId} className="ui-sr">Tu mensaje</label>
              <textarea
                id={textareaId}
                ref={textareaRef}
                className="rq-input"
                rows={2}
                value={text}
                maxLength={REQUEST_LIMITS.textChars}
                placeholder={firstMessage ? 'Ej.: En Préstamos quiero poder elegir el curso de una lista…' : 'Respondé acá…'}
                onChange={event => setText(event.target.value)}
                onKeyDown={onKeyDown}
                disabled={sending}
              />
              <Button variant="primary" icon={<SendHorizontal size={16} strokeWidth={1.8} />} onClick={() => void send()} disabled={sending || thinking || (!text.trim() && !attachments.length)}>Enviar</Button>
            </div>
          </div>
        ) : (
          <p className="rq-closed">
            {request.status === 'in_progress'
              ? 'El equipo ya está trabajando en este pedido. Si querés sumar algo, empezá uno nuevo.'
              : 'Este pedido está cerrado. Si querés sumar algo, empezá uno nuevo.'}
          </p>
        )}
      </div>

      <section className="rq-summary" ref={summaryRef} aria-label="Resumen del pedido">
        <SummaryCard request={request} />
        {confirm.element}
        {!resolved && !confirm.pending && (
          <div className="rq-actions">
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
          </div>
        )}
        {request.status === 'draft' && !request.ready && !firstMessage && !confirm.pending && (
          <p className="rq-hint">La IA todavía tiene alguna pregunta, pero si ya está todo dicho podés enviarlo así.</p>
        )}
      </section>
    </>
  );
}

function ChatBubble({ message, requestId, imageName }: {
  message: RequestMessage;
  requestId: string;
  imageName: Map<string, string>;
}) {
  const mine = message.role === 'user';
  return (
    <div className={`rq-bubble rq-bubble-${mine ? 'user' : 'assistant'}`}>
      <span className="ui-sr">{mine ? 'Vos:' : 'Asistente:'}</span>
      {message.text && <p>{message.text}</p>}
      {message.imageIds.length > 0 && (
        <div className="rq-thumbs">
          {message.imageIds.map(imageId => {
            const src = imageUrl(requestId, imageId);
            const name = imageName.get(imageId) || 'Captura';
            return (
              <a key={imageId} className="rq-thumb" href={src} target="_blank" rel="noreferrer" aria-label={`Abrir ${name} en otra pestaña`}>
                <img src={src} alt={name} loading="lazy" />
              </a>
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
    <div className="rq-summary-card">
      <div className="rq-summary-head">
        <h3>Resumen</h3>
        {!empty && <StatusText tone={summary.kind === 'fix' ? 'bad' : summary.kind === 'new' ? 'ok' : 'warn'}>{KIND_LABEL[summary.kind] || KIND_LABEL.change}</StatusText>}
      </div>
      {empty ? (
        <p className="rq-muted">Acá va a aparecer lo que la IA entendió de tu pedido, y se actualiza con cada respuesta.</p>
      ) : (
        <dl className="rq-fields">
          <div><dt><Eyebrow>Título</Eyebrow></dt><dd>{summary.title || '—'}</dd></div>
          <div><dt><Eyebrow>Dónde</Eyebrow></dt><dd>{summary.screen || 'Todavía no está claro'}</dd></div>
          {summary.kind !== 'new' && <div><dt><Eyebrow>Hoy</Eyebrow></dt><dd>{summary.today || '—'}</dd></div>}
          <div><dt><Eyebrow>Lo que querés</Eyebrow></dt><dd>{summary.desired || '—'}</dd></div>
          {summary.details.length > 0 && (
            <div><dt><Eyebrow>Detalles</Eyebrow></dt><dd><ul>{summary.details.map((detail, index) => <li key={index}>{detail}</li>)}</ul></dd></div>
          )}
        </dl>
      )}
    </div>
  );
}
