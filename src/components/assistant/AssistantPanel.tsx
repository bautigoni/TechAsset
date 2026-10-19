import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft, Mic, Plus, Send, Square, Volume2, X } from 'lucide-react';
import { sendAssistantMessage, transcribeAssistantAudio, type AssistantContext, type AssistantResponse } from '../../services/assistantApi';
import { Spinner } from '../../ui/icons';
import { TruncatedText } from '../../ui/Truncated';
import './assistant.css';

export const ASSISTANT_LOGO = '/assistant-logo.png';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  response?: AssistantResponse;
}

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

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/>\s+/g, '')
    .replace(/[-*+]\s+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function preferredRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return [
    'audio/webm;codecs=opus',
    'audio/mp4',
    'audio/webm',
    'audio/ogg;codecs=opus'
  ].find(type => MediaRecorder.isTypeSupported(type));
}

function spanishVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  return voices.find(voice => /^es-AR$/i.test(voice.lang))
    || voices.find(voice => /^es-/i.test(voice.lang));
}

/**
 * Asistente de IA como COLUMNA a la derecha que empuja el contenido (desktop)
 * o como vista propia (mobile y anchos chicos). Nunca flota encima: se abre
 * con el botón "Asistente" de la barra superior o desde Ctrl K. Se queda
 * montado aunque se cierre, así la conversación sobrevive a cambios de vista
 * (se pierde con F5 o al salir, como antes).
 */
export function AssistantPanel({ open, onClose, mode, backLabel, onNavigate, onOpenDevice, canEdit, context, question }: {
  open: boolean;
  onClose: () => void;
  /** 'column' = al costado; 'view' = ocupa el lugar del contenido. */
  mode: 'column' | 'view';
  /** "Volver a Préstamos" en la vista propia. */
  backLabel: string;
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
  const [voiceState, setVoiceState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [speakingMessage, setSpeakingMessage] = useState<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingTimeoutRef = useRef<number | null>(null);
  const cancelRecordingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const lastQuestion = useRef(0);

  const hasStarted = messages.length > 0;
  const suggestions = canEdit ? STAFF_SUGGESTIONS : VIEWER_SUGGESTIONS;

  // Al abrir: foco en el campo (sin mover la página).
  useEffect(() => {
    if (open) inputRef.current?.focus({ preventScroll: true });
  }, [open]);

  // Siempre al último mensaje (scroll interno del historial, no de la página).
  useEffect(() => {
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [messages, loading]);

  useEffect(() => () => {
    if (recordingTimeoutRef.current) window.clearTimeout(recordingTimeoutRef.current);
    cancelRecordingRef.current = true;
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach(track => track.stop());
    window.speechSynthesis?.cancel();
  }, []);

  // Cerrar cancela una grabación en curso (sin enviarla) y corta la voz.
  useEffect(() => {
    if (open) return;
    if (recorderRef.current?.state === 'recording') {
      cancelRecordingRef.current = true;
      recorderRef.current.stop();
    }
    window.speechSynthesis?.cancel();
    setSpeakingMessage(null);
  }, [open]);

  const send = async (text: string) => {
    const clean = text.trim();
    if (!clean || loading) return;
    setInput('');
    setLoading(true);
    const newMessages = [...messages, { role: 'user' as const, content: clean }];
    setMessages(newMessages);
    try {
      const response = await sendAssistantMessage(
        newMessages.slice(-12).map(m => ({ role: m.role, content: m.content })), context
      );
      setMessages(prev => [...prev, { role: 'assistant', content: stripMarkdown(response.reply), response }]);
      if (response.suggestedDevice && onOpenDevice?.(response.suggestedDevice)) {
        onClose();
      } else if (response.suggestedRoute) {
        onNavigate(response.suggestedRoute);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'No pude procesar el pedido. ¿Querés intentar de nuevo?' }]);
    } finally {
      setLoading(false);
    }
  };

  // Pregunta enviada desde Ctrl K.
  useEffect(() => {
    if (!question || question.nonce === lastQuestion.current) return;
    lastQuestion.current = question.nonce;
    void send(question.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question]);

  const stopRecording = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  };

  const startRecording = async () => {
    if (loading || voiceState === 'transcribing') return;
    if (voiceState === 'recording') {
      stopRecording();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Este navegador no permite grabar audio. Podés escribirme el pedido.' }]);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mimeType = preferredRecorderMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      cancelRecordingRef.current = false;
      recorder.ondataavailable = event => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        if (recordingTimeoutRef.current) window.clearTimeout(recordingTimeoutRef.current);
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' });
        chunksRef.current = [];
        if (cancelRecordingRef.current) {
          cancelRecordingRef.current = false;
          setVoiceState('idle');
          return;
        }
        if (!blob.size) {
          setVoiceState('idle');
          return;
        }
        setVoiceState('transcribing');
        try {
          const transcript = await transcribeAssistantAudio(blob);
          setVoiceState('idle');
          await send(transcript);
        } catch (error) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: error instanceof Error ? error.message : 'No pude procesar el audio. Probá de nuevo.'
          }]);
          setVoiceState('idle');
        }
      };
      recorder.start(250);
      setVoiceState('recording');
      // Corte automático a los 60 s.
      recordingTimeoutRef.current = window.setTimeout(stopRecording, 60000);
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'No pude acceder al micrófono. Revisá el permiso del navegador y probá de nuevo.'
      }]);
      setVoiceState('idle');
      streamRef.current?.getTracks().forEach(track => track.stop());
    }
  };

  const toggleSpeech = (index: number, text: string) => {
    if (!window.speechSynthesis) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Este navegador no puede reproducir respuestas por voz.' }]);
      return;
    }
    if (speakingMessage === index) {
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
    setSpeakingMessage(index);
    window.speechSynthesis.speak(utterance);
  };

  const newConversation = () => {
    if (recorderRef.current?.state === 'recording') {
      cancelRecordingRef.current = true;
      recorderRef.current.stop();
    }
    window.speechSynthesis?.cancel();
    setSpeakingMessage(null);
    setMessages([]);
    setInput('');
    inputRef.current?.focus({ preventScroll: true });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

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
      <div className="asst-feed" ref={feedRef} aria-live="polite">
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
        {messages.map((msg, i) => (
          <div key={i} className={`asst-msg asst-msg--${msg.role}`}>
            <p>{msg.content}</p>
            {msg.role === 'assistant' && (
              <button
                type="button"
                className={`asst-listen${speakingMessage === i ? ' is-speaking' : ''}`}
                onClick={() => toggleSpeech(i, msg.content)}
                aria-label={speakingMessage === i ? 'Detener audio' : 'Escuchar respuesta'}
              >
                {speakingMessage === i ? <Square size={12} strokeWidth={1.8} aria-hidden="true" /> : <Volume2 size={13} strokeWidth={1.6} aria-hidden="true" />}
                <span>{speakingMessage === i ? 'Detener' : 'Escuchar'}</span>
              </button>
            )}
          </div>
        ))}
        {loading && (
          <div className="asst-msg asst-msg--assistant asst-typing" aria-label="El asistente está escribiendo">
            <span /><span /><span />
          </div>
        )}
      </div>
      <form className="asst-form" onSubmit={e => { e.preventDefault(); void send(input); }}>
        <input
          ref={inputRef}
          className="asst-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={voiceState === 'recording' ? 'Te escucho…' : voiceState === 'transcribing' ? 'Transcribiendo audio…' : 'Escribí tu pedido…'}
          aria-label="Pedido para el asistente"
          disabled={loading || voiceState !== 'idle'}
        />
        <button
          type="button"
          className={`shell-icon-btn asst-mic${voiceState === 'recording' ? ' is-recording' : ''}`}
          onClick={startRecording}
          disabled={loading || voiceState === 'transcribing'}
          aria-label={voiceState === 'recording' ? 'Detener y enviar audio' : voiceState === 'transcribing' ? 'Transcribiendo audio' : 'Hablar con el asistente'}
        >
          {voiceState === 'transcribing' ? <Spinner size={16} /> : voiceState === 'recording' ? <Square size={14} strokeWidth={1.8} aria-hidden="true" /> : <Mic size={16} strokeWidth={1.6} aria-hidden="true" />}
        </button>
        <button type="submit" className="asst-send" disabled={loading || voiceState !== 'idle' || !input.trim()} aria-label="Enviar">
          <Send size={16} strokeWidth={1.6} aria-hidden="true" />
        </button>
      </form>
    </aside>
  );
}
