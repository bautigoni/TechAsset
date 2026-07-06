import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ThemeProfile } from '../../utils/themeProfile';
import { sendAssistantMessage, type AssistantResponse } from '../../services/assistantApi';

export const ASSISTANT_LOGO = '/assistant-logo.png';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  response?: AssistantResponse;
}

const STAFF_SUGGESTIONS = [
  'prestar Touch 34 a mili en DOE',
  'qué dispositivos están disponibles',
  'qué tareas tengo pendientes',
  'quién tiene prestado el D1436',
  'crear tarea revisar proyectores',
  'ver agenda de hoy'
];

const VIEWER_SUGGESTIONS = [
  'qué dispositivos hay disponibles',
  'dónde está el D1436',
  'qué tareas están pendientes',
  'ver agenda de hoy'
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

export function AssistantPanel({ onNavigate, canEdit, open: openProp, onOpenChange, themeProfile = 'classic' }: {
  onNavigate: (view: string) => void;
  canEdit?: boolean;
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
        newMessages.slice(-12).map(m => ({ role: m.role, content: m.content }))
      );
      setMessages(prev => [...prev, { role: 'assistant', content: stripMarkdown(response.reply), response }]);
      if (response.suggestedRoute) {
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
          placeholder="Escribí tu pedido..."
          disabled={loading}
        />
        <button type="submit" className="assistant-send" disabled={loading || !input.trim()} aria-label="Enviar">
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
