import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft, Mic, Plus, Send, Square, Volume2, X } from 'lucide-react';
import {
  streamAssistantMessage, undoAssistantAction,
  type AssistantAction, type AssistantContext, type AssistantResponse
} from '../../services/assistantApi';
import { ApiError } from '../../services/apiClient';
import { useSpeechDictation } from '../../hooks/useSpeechDictation';
import { Spinner } from '../../ui/icons';
import { InlineConfirm, StatusLine } from '../../ui/Inline';
import { TruncatedText } from '../../ui/Truncated';
import './assistant.css';

export const ASSISTANT_LOGO = '/assistant-logo.png';

type PendingConfirmation = NonNullable<AssistantResponse['pendingConfirmation']>;

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  /** Respuesta en curso (texto parcial del stream). */
  streaming?: boolean;
  /** Herramienta corriendo ahora ("Buscando…", "Prestando…"). */
  tool?: string | null;
  actions?: AssistantAction[];
  confirmation?: PendingConfirmation;
  /** La confirmación ya se contestó (o se canceló): no se vuelve a mostrar. */
  confirmationSettled?: boolean;
  /** Falló el pedido: se muestra en línea con Reintentar. */
  error?: string;
  /** Destino sugerido que en la vista propia no se abre solo (enlace debajo). */
  link?: { route?: string; device?: string };
}

/** Estado del Deshacer de cada acción, por id de acción. */
type UndoState =
  | { status: 'busy' }
  | { status: 'done'; message: string }
  | { status: 'error'; message: string; retryable: boolean };

const STAFF_SUGGESTIONS = [
  'Prestale el Touch 34 a Mili en DOE, ¿me confirmás los datos?',
  '¿Qué dispositivos están disponibles hoy para prestar y cuántos hay de cada tipo?',
  'Mostrame las tareas pendientes de esta semana ordenadas por prioridad',
  '¿Quién tiene el D1436 prestado, desde cuándo y cuándo se vence?',
  'Creá una tarea urgente para revisar los proyectores de todas las aulas del primer piso, asignada a Equi',
  '¿Qué actividades hay en la agenda de hoy y quién las pidió?',
  'Repará el D1432 de Mili, me dijo que no prende la pantalla, se lo prestaste ayer'
];

const VIEWER_SUGGESTIONS = [
  '¿Cuántos dispositivos hay disponibles ahora y cuántos están prestados?',
  '¿Dónde está el D1436 y quién lo tiene hace cuánto tiempo?',
  '¿Cuáles son las tareas pendientes con prioridad alta para esta semana?',
  '¿Qué dice la agenda de hoy? Mostrame los detalles de cada actividad.',
  '¿Qué aulas tienen problemas y cuál es el estado general de cada una?',
  '¿Hay algún equipo prestado hace más de 30 días?'
];

/** Lo que se ve mientras corre cada herramienta del server (tools.js). */
const TOOL_LABELS: Record<string, string> = {
  base_conocimiento: 'Buscando en la base de conocimiento…',
  buscar_dispositivos: 'Buscando equipos…',
  detalle_dispositivo: 'Buscando el equipo…',
  buscar_persona: 'Buscando a la persona…',
  prestamos_activos: 'Revisando los préstamos…',
  historial_prestamos: 'Revisando el historial…',
  tareas_tic: 'Revisando las tareas…',
  agenda_tic: 'Revisando la agenda…',
  resumen_sitio: 'Armando el resumen…',
  procedimiento: 'Buscando el procedimiento…',
  abrir_seccion: 'Buscando la sección…',
  registrar_prestamo: 'Prestando…',
  registrar_devolucion: 'Devolviendo…',
  crear_tarea: 'Creando la tarea…',
  crear_evento_agenda: 'Agendando…',
  crear_recordatorio: 'Creando el recordatorio…'
};

/** Nombre de la sección para el enlace "Abrir …" (las que sugiere el server). */
const ROUTE_LABELS: Record<string, string> = {
  dashboard: 'Inicio', devices: 'Dispositivos', loans: 'Préstamos', analytics: 'Analítica', tasks: 'Tareas TIC',
  agenda: 'Agenda TIC', reminders: 'Recordatorios', classrooms: 'Estado aulas', tickets: 'Tickets',
  knowledge: 'Base de conocimiento', inventory: 'Inventario TIC', schedules: 'Horarios', history: 'Historial'
};

const CONFIRM_TEXT = 'sí, confirmo';
const FAILED_REPLY = 'No pude procesar el pedido.';

function spanishVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  return voices.find(voice => /^es-AR$/i.test(voice.lang))
    || voices.find(voice => /^es-/i.test(voice.lang));
}

/**
 * Texto en vivo sin marcas: la respuesta final (`done.reply`) ya viene limpia
 * del server, pero los deltas llegan crudos y un "**" se vería un instante.
 */
function livePlainText(text: string): string {
  return text
    .replace(/\*\*|__/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '');
}

function mergeActions(current: AssistantAction[] = [], incoming: AssistantAction[] = []): AssistantAction[] {
  const seen = new Set(current.map(action => action.id));
  return [...current, ...incoming.filter(action => !seen.has(action.id))];
}

function joinText(base: string, extra: string): string {
  return [base.trim(), extra.trim()].filter(Boolean).join(' ');
}

let nextMessageId = 1;

/**
 * Asistente de IA como COLUMNA a la derecha que empuja el contenido (desktop)
 * o como vista propia (mobile y anchos chicos). Nunca flota encima: se abre
 * con el botón "Asistente" de la barra superior o desde Ctrl K. Se queda
 * montado aunque se cierre, así la conversación sobrevive a cambios de vista
 * (se pierde con F5 o al salir, como antes).
 *
 * La respuesta llega en vivo (SSE): el texto aparece mientras se genera, una
 * línea dice qué herramienta corre, y cada acción queda como línea de estado
 * con Deshacer. El dictado es del navegador (useSpeechDictation): sin Web
 * Speech API (Firefox) el micrófono no aparece.
 */
export function AssistantPanel({ open, onClose, mode, backLabel, currentView, onNavigate, onOpenDevice, canEdit, context, question }: {
  open: boolean;
  onClose: () => void;
  /** 'column' = al costado; 'view' = ocupa el lugar del contenido. */
  mode: 'column' | 'view';
  /** "Volver a Préstamos" en la vista propia. */
  backLabel: string;
  /** Vista abierta detrás: no se ofrece "Abrir" hacia la misma. */
  currentView?: string;
  onNavigate: (view: string) => void;
  onOpenDevice?: (deviceTag: string) => boolean;
  canEdit?: boolean;
  context?: AssistantContext | null;
  /** Pregunta que llega desde Ctrl K ("Preguntar al asistente"). */
  question?: { text: string; nonce: number } | null;
}) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [speakingMessage, setSpeakingMessage] = useState<number | null>(null);
  const [undoStates, setUndoStates] = useState<Record<number, UndoState>>({});
  const inputRef = useRef<HTMLInputElement | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const lastQuestion = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);
  const undoingRef = useRef(new Set<number>());
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const currentViewRef = useRef(currentView);
  currentViewRef.current = currentView;
  // Dictado: lo que había escrito antes de hablar + lo que se reconoce.
  const dictationBase = useRef('');
  const discardDictation = useRef(false);

  const dictation = useSpeechDictation({
    onFinal: text => {
      if (discardDictation.current) { discardDictation.current = false; return; }
      setInput(joinText(dictationBase.current, text));
      // Se revisa antes de enviar: el asistente puede prestar o devolver.
      window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0);
    }
  });
  const listening = dictation.listening;
  const shownInput = listening ? joinText(dictationBase.current, dictation.transcript) : input;

  const hasStarted = messages.length > 0;
  const suggestions = canEdit ? STAFF_SUGGESTIONS : VIEWER_SUGGESTIONS;

  // Al abrir: foco en el campo (sin mover la página).
  useEffect(() => {
    if (open) inputRef.current?.focus({ preventScroll: true });
  }, [open]);

  // Pegado al último mensaje mientras el usuario no haya subido a leer
  // (scroll interno del historial, no de la página). En layout effect: se
  // pega antes de pintar, sin un frame con el texto nuevo cortado abajo.
  useLayoutEffect(() => {
    const feed = feedRef.current;
    if (feed && stickToBottom.current) feed.scrollTop = feed.scrollHeight;
  }, [messages, loading, undoStates]);
  // Lo que crece sin que cambien los mensajes (el texto que se reacomoda, la
  // entrada animada de una burbuja, una línea de estado): mismo pegado.
  const messageCount = messages.length;
  useEffect(() => {
    const feed = feedRef.current;
    if (!feed || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => { if (stickToBottom.current) feed.scrollTop = feed.scrollHeight; });
    for (const child of Array.from(feed.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [messageCount, loading]);

  // Teclado en el celular: al achicarse la ventana visible, el último mensaje sigue a la vista.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!open || !vv) return;
    const onResize = () => {
      const feed = feedRef.current;
      if (feed && stickToBottom.current) feed.scrollTop = feed.scrollHeight;
    };
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, [open]);

  const onFeedScroll = () => {
    const feed = feedRef.current;
    if (feed) stickToBottom.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 48;
  };

  const stopDictation = useCallback((discard: boolean) => {
    if (!dictation.listening) return;
    discardDictation.current = discard;
    dictation.stop();
  }, [dictation]);

  useEffect(() => () => {
    abortRef.current?.abort();
    window.speechSynthesis?.cancel();
  }, []);

  // Cerrar corta el dictado (lo dicho queda en el campo) y la voz.
  useEffect(() => {
    if (open) return;
    stopDictation(false);
    window.speechSynthesis?.cancel();
    setSpeakingMessage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const patchMessage = (id: number, patch: (message: ChatMessage) => Partial<ChatMessage>) => {
    setMessages(prev => prev.map(message => (message.id === id ? { ...message, ...patch(message) } : message)));
  };

  const send = async (text: string, { history }: { history?: ChatMessage[] } = {}) => {
    const clean = text.trim();
    // Un doble Enter (o doble toque) no manda dos veces: el estado tarda un render.
    if (!clean || loading || sendingRef.current) return;
    sendingRef.current = true;
    stopDictation(true);
    // Se vacía solo si el campo tenía lo que se manda: una sugerencia o Ctrl K no pisan lo escrito.
    setInput(prev => (prev.trim() === clean ? '' : prev));
    setLoading(true);
    stickToBottom.current = true;
    const base = history ?? messagesRef.current;
    // Una confirmación pendiente se da por contestada con cualquier mensaje nuevo.
    const previous = base.map(message => (message.confirmation && !message.confirmationSettled ? { ...message, confirmationSettled: true } : message));
    const userMessage: ChatMessage = { id: nextMessageId++, role: 'user', content: clean };
    const replyId = nextMessageId++;
    const conversation = [...previous, userMessage];
    setMessages([...conversation, { id: replyId, role: 'assistant', content: '', streaming: true, tool: null }]);

    const controller = new AbortController();
    abortRef.current = controller;
    let streamedActions = 0;
    const toolsSeen: string[] = [];
    try {
      const response = await streamAssistantMessage(
        conversation
          .filter(message => message.content && !message.error)
          .slice(-12)
          .map(message => ({ role: message.role, content: message.content })),
        context,
        {
          signal: controller.signal,
          onDelta: delta => patchMessage(replyId, message => ({ content: message.content + delta, tool: null })),
          onTool: name => {
            toolsSeen.push(name);
            patchMessage(replyId, () => ({ tool: TOOL_LABELS[name] || 'Buscando…' }));
          },
          onAction: action => {
            streamedActions += 1;
            patchMessage(replyId, message => ({ actions: mergeActions(message.actions, [action]) }));
          }
        }
      );
      if (controller.signal.aborted) return;
      const actions = response.actions || [];
      const acted = actions.length > 0 || streamedActions > 0;
      // En la vista propia (mobile) ir a otra sección cierra el asistente: salvo
      // que haya pedido abrir una sección, la respuesta se queda a la vista y
      // el destino sugerido va como enlace debajo.
      const stay = modeRef.current === 'view' && !toolsSeen.includes('abrir_seccion');
      const linkRoute = response.suggestedRoute && response.suggestedRoute !== currentViewRef.current ? response.suggestedRoute : undefined;
      const linkDevice = acted ? undefined : response.suggestedDevice || undefined;
      const link = stay && (linkRoute || linkDevice) ? { route: linkRoute, device: linkDevice } : undefined;
      patchMessage(replyId, message => ({
        content: response.reply,
        streaming: false,
        tool: null,
        actions: mergeActions(message.actions, actions),
        confirmation: response.pendingConfirmation,
        link
      }));
      if (stay) return;
      // Si hizo algo, el panel queda abierto para que se vea el Deshacer.
      if (!acted && response.suggestedDevice && onOpenDevice?.(response.suggestedDevice)) {
        onClose();
      } else if (response.suggestedRoute) {
        onNavigate(response.suggestedRoute);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const reason = error instanceof TypeError
        ? 'No hay conexión con el servidor. Probá de nuevo.'
        : error instanceof Error && error.message ? error.message : FAILED_REPLY;
      patchMessage(replyId, message => ({ streaming: false, tool: null, error: reason, content: message.actions?.length ? message.content : '' }));
      // Lo escrito no se pierde: vuelve al campo (si no se empezó otro pedido).
      setInput(prev => (prev.trim() ? prev : clean));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      sendingRef.current = false;
      setLoading(false);
    }
  };

  // Reintentar: saca el pedido fallido y su respuesta, y lo vuelve a mandar.
  const retry = (failedId: number) => {
    const list = messagesRef.current;
    const index = list.findIndex(message => message.id === failedId);
    const userMessage = index > 0 ? list[index - 1] : null;
    if (!userMessage || userMessage.role !== 'user') return;
    void send(userMessage.content, { history: list.slice(0, index - 1) });
  };

  // Pregunta enviada desde Ctrl K.
  useEffect(() => {
    if (!question || question.nonce === lastQuestion.current) return;
    lastQuestion.current = question.nonce;
    void send(question.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question]);

  const undo = async (action: AssistantAction) => {
    // Nunca dos veces: ni doble click ni un click mientras corre.
    if (!action.undo || undoingRef.current.has(action.id)) return;
    undoingRef.current.add(action.id);
    setUndoStates(prev => ({ ...prev, [action.id]: { status: 'busy' } }));
    try {
      const result = await undoAssistantAction(action.undo.actionId);
      setUndoStates(prev => ({ ...prev, [action.id]: { status: 'done', message: result.mensaje || `Deshecho: ${action.label}` } }));
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 0;
      const message = error instanceof Error && error.message ? error.message : 'No pude deshacerlo.';
      // 403 (sin permiso), 404 (no existe o es de otra sede), 409 (ya cambió o se deshizo): reintentar no sirve.
      const retryable = ![403, 404, 409, 410].includes(status);
      setUndoStates(prev => ({ ...prev, [action.id]: { status: 'error', message, retryable } }));
      if (retryable) undoingRef.current.delete(action.id);
    }
  };

  const toggleSpeech = (id: number, text: string) => {
    if (!window.speechSynthesis) return;
    if (speakingMessage === id) {
      window.speechSynthesis.cancel();
      setSpeakingMessage(null);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-AR';
    utterance.rate = 1;
    const voice = spanishVoice();
    if (voice) utterance.voice = voice;
    utterance.onend = () => setSpeakingMessage(null);
    utterance.onerror = () => setSpeakingMessage(null);
    setSpeakingMessage(id);
    window.speechSynthesis.speak(utterance);
  };

  const toggleDictation = () => {
    if (listening) { stopDictation(false); return; }
    if (loading) return;
    dictationBase.current = input;
    dictation.start();
  };

  const newConversation = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    stopDictation(true);
    dictation.reset();
    window.speechSynthesis?.cancel();
    setSpeakingMessage(null);
    setMessages([]);
    setUndoStates({});
    undoingRef.current.clear();
    sendingRef.current = false;
    setLoading(false);
    setInput('');
    inputRef.current?.focus({ preventScroll: true });
  };

  const openLinkedDevice = (tag?: string) => {
    if (tag && onOpenDevice?.(tag)) onClose();
  };

  const settleConfirmation =(id: number) => patchMessage(id, () => ({ confirmationSettled: true }));

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    if (listening) { stopDictation(true); return; }
    onClose();
  };

  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const lastId = messages[messages.length - 1]?.id;

  return (
    <aside
      className={`asst asst--${mode}`}
      aria-label="Asistente TechAsset"
      hidden={!open}
      data-scanner-ignore=""
      onKeyDown={onKeyDown}
    >
      <header className="asst-head">
        {mode === 'view' && (
          <button type="button" className="shell-icon-btn" aria-label={backLabel} onClick={onClose}>
            <ArrowLeft size={16} strokeWidth={1.6} aria-hidden="true" />
          </button>
        )}
        <div className="asst-title">
          <h2>Asistente</h2>
          <span>Datos de tu sede en tiempo real</span>
        </div>
        {hasStarted && (
          <button type="button" className="asst-text-btn" onClick={newConversation}>
            <Plus size={14} strokeWidth={1.6} aria-hidden="true" />
            <span>Nueva</span>
          </button>
        )}
        {mode === 'column'
          ? (
            <button type="button" className="shell-icon-btn" aria-label="Cerrar asistente" onClick={onClose}>
              <X size={16} strokeWidth={1.6} aria-hidden="true" />
            </button>
          )
          : <button type="button" className="asst-text-btn" onClick={onClose}>{backLabel}</button>}
      </header>
      <div className="asst-feed" ref={feedRef} onScroll={onFeedScroll} aria-live="polite" aria-busy={loading}>
        {!hasStarted && (
          <div className="asst-welcome">
            <p>Preguntá sobre equipos, préstamos, agenda o tareas. Responde con lo que hay en la base{canEdit ? ' y puede registrar préstamos, devoluciones y tareas' : ''}.</p>
            <ul className="asst-suggestions">
              {suggestions.map(s => (
                <li key={s}><button type="button" className="asst-suggestion" onClick={() => void send(s)}><TruncatedText>{s}</TruncatedText></button></li>
              ))}
            </ul>
          </div>
        )}
        {messages.map(msg => {
          if (msg.role === 'user') {
            return <div key={msg.id} className="asst-msg asst-msg--user"><p>{msg.content}</p></div>;
          }
          const waiting = msg.streaming && !msg.content && !msg.tool;
          const showConfirm = msg.confirmation && !msg.confirmationSettled && !msg.streaming && msg.id === lastId && !loading;
          return (
            <div key={msg.id} className="asst-turn" data-state={msg.streaming ? 'streaming' : msg.error ? 'error' : 'done'}>
              {waiting && (
                <div className="asst-msg asst-msg--assistant asst-typing" aria-label="El asistente está escribiendo">
                  <span /><span /><span />
                </div>
              )}
              {(msg.content || (msg.streaming && msg.tool)) && (
                <div className="asst-msg asst-msg--assistant">
                  {msg.content && <p>{msg.streaming ? livePlainText(msg.content) : msg.content}</p>}
                  {msg.streaming && msg.tool && (
                    <p className="asst-tool" role="status"><Spinner size={12} /> <span>{msg.tool}</span></p>
                  )}
                  {!msg.streaming && msg.content && (canSpeak || msg.link) && (
                    <div className="asst-msg-tools">
                      {canSpeak && (
                        <button
                          type="button"
                          className={`asst-listen${speakingMessage === msg.id ? ' is-speaking' : ''}`}
                          onClick={() => toggleSpeech(msg.id, msg.content)}
                          aria-label={speakingMessage === msg.id ? 'Detener audio' : 'Escuchar respuesta'}
                        >
                          {speakingMessage === msg.id ? <Square size={12} strokeWidth={1.8} aria-hidden="true" /> : <Volume2 size={13} strokeWidth={1.6} aria-hidden="true" />}
                          <span>{speakingMessage === msg.id ? 'Detener' : 'Escuchar'}</span>
                        </button>
                      )}
                      {msg.link?.device && (
                        <button type="button" className="asst-listen" onClick={() => openLinkedDevice(msg.link?.device)}>
                          <span>Ver ficha de {msg.link.device}</span>
                        </button>
                      )}
                      {msg.link?.route && (
                        <button type="button" className="asst-listen" onClick={() => onNavigate(msg.link?.route || '')}>
                          <span>Abrir {ROUTE_LABELS[msg.link.route] || 'la sección'}</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              {msg.actions?.map(action => {
                const state = undoStates[action.id];
                if (state?.status === 'done') {
                  return <StatusLine key={action.id} className="asst-action" tone="info" message={state.message} autoHideMs={0} />;
                }
                if (state?.status === 'error') {
                  return (
                    <StatusLine
                      key={action.id}
                      className="asst-action"
                      tone="bad"
                      message={`${action.label}. No se pudo deshacer: ${state.message}`}
                      retry={state.retryable ? { onRetry: () => undo(action), label: 'Reintentar' } : undefined}
                    />
                  );
                }
                return (
                  <StatusLine
                    key={action.id}
                    className="asst-action"
                    tone="ok"
                    message={action.label}
                    autoHideMs={0}
                    action={action.undo
                      ? { label: state?.status === 'busy' ? 'Deshaciendo…' : 'Deshacer', onClick: () => { if (state?.status !== 'busy') void undo(action); } }
                      : undefined}
                  />
                );
              })}
              {showConfirm && msg.confirmation && (
                <InlineConfirm
                  className="asst-confirm"
                  message={`Son ${msg.confirmation.cantidad} equipos. ¿Confirmás?`}
                  detail={msg.confirmation.equipos.length ? msg.confirmation.equipos.join(', ') : undefined}
                  confirmLabel="Sí, confirmo"
                  cancelLabel="No"
                  onConfirm={() => { settleConfirmation(msg.id); void send(CONFIRM_TEXT); }}
                  onCancel={() => { settleConfirmation(msg.id); inputRef.current?.focus({ preventScroll: true }); }}
                />
              )}
              {msg.error && (
                <StatusLine
                  className="asst-action"
                  tone="bad"
                  message={msg.error}
                  retry={msg.id === lastId && !loading ? { onRetry: () => retry(msg.id) } : undefined}
                />
              )}
            </div>
          );
        })}
      </div>
      {dictation.error && (
        <StatusLine className="asst-dictation-error" tone="warn" message={dictation.error} onDismiss={dictation.reset} />
      )}
      <form className="asst-form" onSubmit={e => { e.preventDefault(); void send(input); }}>
        <input
          ref={inputRef}
          className="asst-input"
          value={shownInput}
          onChange={e => setInput(e.target.value)}
          readOnly={listening}
          placeholder={listening ? 'Te escucho…' : 'Escribí tu pedido…'}
          aria-label="Pedido para el asistente"
          disabled={loading}
        />
        {dictation.supported && (
          <button
            type="button"
            className={`shell-icon-btn asst-mic${listening ? ' is-recording' : ''}`}
            onClick={toggleDictation}
            disabled={loading && !listening}
            aria-pressed={listening}
            aria-label={listening ? 'Dejar de dictar' : 'Dictar el pedido'}
          >
            {listening ? <Square size={14} strokeWidth={1.8} aria-hidden="true" /> : <Mic size={16} strokeWidth={1.6} aria-hidden="true" />}
          </button>
        )}
        <button type="submit" className="asst-send" disabled={loading || listening || !input.trim()} aria-label="Enviar">
          <Send size={16} strokeWidth={1.6} aria-hidden="true" />
        </button>
      </form>
    </aside>
  );
}
