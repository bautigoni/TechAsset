import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ThemeProfile } from '../../utils/themeProfile';
import { sendAssistantMessage, transcribeAssistantAudio, type AssistantContext, type AssistantResponse } from '../../services/assistantApi';

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

export function AssistantPanel({ onNavigate, onOpenDevice, canEdit, context, open: openProp, onOpenChange, themeProfile = 'classic' }: {
  onNavigate: (view: string) => void;
  onOpenDevice?: (deviceTag: string) => boolean;
  canEdit?: boolean;
  context?: AssistantContext | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  themeProfile?: ThemeProfile;
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (value: boolean) => {
    setOpenState(value);
    onOpenChange?.(value);
  };
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [voiceState, setVoiceState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [speakingMessage, setSpeakingMessage] = useState<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingTimeoutRef = useRef<number | null>(null);
  const cancelRecordingRef = useRef(false);

  const suggestions = canEdit ? STAFF_SUGGESTIONS : VIEWER_SUGGESTIONS;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

  useEffect(() => {
    if (!open && recorderRef.current?.state === 'recording') {
      cancelRecordingRef.current = true;
      recorderRef.current.stop();
    }
    if (!open) {
      window.speechSynthesis?.cancel();
      setSpeakingMessage(null);
    }
  }, [open]);

  const send = async (text: string) => {
    const clean = text.trim();
    if (!clean || loading) return;
    setInput('');
    setHasStarted(true);
    setLoading(true);
    const newMessages = [...messages, { role: 'user' as const, content: clean }];
    setMessages(newMessages);
    try {
      const response = await sendAssistantMessage(
        newMessages.slice(-12).map(m => ({ role: m.role, content: m.content })), context
      );
      setMessages(prev => [...prev, { role: 'assistant', content: stripMarkdown(response.reply), response }]);
      if (response.suggestedDevice && onOpenDevice?.(response.suggestedDevice)) {
        setOpen(false);
      } else if (response.suggestedRoute) {
        onNavigate(response.suggestedRoute);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'No pude procesar el pedido. ¿Querés intentar de nuevo?' }]);
    } finally {
      setLoading(false);
    }
  };

  const handleBackdrop = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget) setOpen(false);
  };

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
      setHasStarted(true);
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
          setHasStarted(true);
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: error instanceof Error ? error.message : 'No pude procesar el audio. Probá de nuevo.'
          }]);
          setVoiceState('idle');
        }
      };
      recorder.start(250);
      setVoiceState('recording');
      recordingTimeoutRef.current = window.setTimeout(stopRecording, 60000);
    } catch {
      setHasStarted(true);
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

  const chatEl = (
    <div className="assistant-backdrop" onClick={handleBackdrop}>
    <section className="assistant-panel" aria-label="Asistente TechAsset">
      <header className="assistant-panel-head">
        <div className="assistant-panel-brand">
          <img className="assistant-logo" src={ASSISTANT_LOGO} alt="" aria-hidden="true" />
          <div>
            <strong>Asistente TechAsset</strong>
            <span>Datos de tu sede en tiempo real</span>
          </div>
        </div>
        <button type="button" className="assistant-close" onClick={() => setOpen(false)} aria-label="Cerrar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </header>
      <div className="assistant-feed">
        {!hasStarted && (
          <div className="assistant-welcome">
            <img className="assistant-welcome-logo" src={ASSISTANT_LOGO} alt="" aria-hidden="true" />
            <p>Decime qué necesitás hacer y lo ordenamos.</p>
            <div className="assistant-suggestions">
              {suggestions.map(s => (
                <button key={s} type="button" className="assistant-suggestion-btn" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`chat-msg ${msg.role}`}>
            {msg.role === 'assistant' && (
              <div className="chat-avatar">
                <img src={ASSISTANT_LOGO} alt="" aria-hidden="true" />
              </div>
            )}
            <div className="chat-bubble">
              <p>{msg.content}</p>
              {msg.role === 'assistant' && (
                <button
                  type="button"
                  className={`assistant-listen${speakingMessage === i ? ' is-speaking' : ''}`}
                  onClick={() => toggleSpeech(i, msg.content)}
                  aria-label={speakingMessage === i ? 'Detener audio' : 'Escuchar respuesta'}
                >
                  {speakingMessage === i ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18 5a9 9 0 0 1 0 14"/></svg>
                  )}
                  <span>{speakingMessage === i ? 'Detener' : 'Escuchar'}</span>
                </button>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="chat-msg assistant">
            <div className="chat-avatar">
              <img src={ASSISTANT_LOGO} alt="" aria-hidden="true" />
            </div>
            <div className="chat-bubble">
              <div className="chat-typing">
                <span /><span /><span />
              </div>
            </div>
          </div>
        )}
      </div>
      <form className="assistant-input-form" onSubmit={e => { e.preventDefault(); send(input); }}>
        <input
          className="assistant-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={voiceState === 'recording' ? 'Te escucho…' : voiceState === 'transcribing' ? 'Transcribiendo audio…' : 'Escribí tu pedido…'}
          disabled={loading || voiceState !== 'idle'}
        />
        <button
          type="button"
          className={`assistant-mic${voiceState === 'recording' ? ' is-recording' : ''}`}
          onClick={startRecording}
          disabled={loading || voiceState === 'transcribing'}
          aria-label={voiceState === 'recording' ? 'Detener y enviar audio' : voiceState === 'transcribing' ? 'Transcribiendo audio' : 'Hablar con el asistente'}
          title={voiceState === 'recording' ? 'Detener y enviar' : 'Hablar'}
        >
          {voiceState === 'transcribing' ? (
            <span className="assistant-mic-loader" aria-hidden="true" />
          ) : voiceState === 'recording' ? (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
          ) : (
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v5"/><path d="M8 22h8"/></svg>
          )}
        </button>
        <button type="submit" className="assistant-send" disabled={loading || voiceState !== 'idle' || !input.trim()} aria-label="Enviar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </form>
    </section>
    </div>
  );

  const showFab = true;

  return (
    <>
      {showFab && (
        <button className="assistant-trigger" type="button" onClick={() => setOpen(true)} aria-label="Abrir Asistente TechAsset">
          <img className="assistant-logo" src={ASSISTANT_LOGO} alt="" aria-hidden="true" />
          <span className="assistant-trigger-label">Asistente de IA</span>
        </button>
      )}
      {open && createPortal(chatEl, document.body)}
    </>
  );
}
