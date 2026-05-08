import { useMemo, useState } from 'react';
import { Button } from '../layout/Button';
import { sendAssistantMessage, type AssistantChatResponse } from '../../services/assistantApi';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  response?: AssistantChatResponse;
}

const QUICK_ACTIONS: Record<string, string> = {
  'Registrar préstamo': 'start_loan',
  'Registrar devolución': 'start_return',
  'Crear tarea': 'start_task',
  'Crear evento': 'start_agenda',
  'Ver agenda': 'show_agenda',
  'Consultar procedimiento': 'procedure_search'
};

export function AssistantPanel({ onNavigate, onLoanDraft }: { onNavigate: (view: string) => void; onLoanDraft?: (deviceCode: string) => void }) {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [input, setInput] = useState('');
  const [pendingAction, setPendingAction] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const conversationId = useMemo(() => `techasset-${Date.now()}-${Math.random().toString(36).slice(2)}`, []);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', text: 'Hola, soy el Asistente TechAsset. Decime que necesitas hacer y lo ordenamos.' }
  ]);

  const send = async (text = input, action?: string) => {
    const clean = text.trim();
    if (!clean || loading) return;
    setInput('');
    setLoading(true);
    setMessages(current => [...current, { role: 'user', text: clean }]);
    try {
      const response = await sendAssistantMessage({ message: clean, action, conversationId, context: { pendingAction } });
      setPendingAction(response.pendingAction || null);
      setMessages(current => [...current, { role: 'assistant', text: response.reply, response }]);
    } catch (error) {
      setMessages(current => [...current, { role: 'assistant', text: error instanceof Error ? error.message : 'No pude procesar el pedido.' }]);
    } finally {
      setLoading(false);
    }
  };

  const close = () => {
    setOpen(false);
    setMinimized(false);
  };

  const confirm = () => send('confirmo');
  const cancel = () => {
    setPendingAction(null);
    setMessages(current => [...current, { role: 'assistant', text: 'Listo, cancele la accion pendiente. No modifique datos.' }]);
  };

  return (
    <>
      <button className="assistant-fab" type="button" onClick={() => { setOpen(true); setMinimized(false); }} aria-label="Abrir Asistente TechAsset">
        <span className="assistant-fab-icon" aria-hidden="true" />
        <span>Asistente TechAsset</span>
      </button>
      {open && !minimized && (
        <section className="assistant-popup" aria-label="Asistente TechAsset">
          <header className="assistant-popup-head">
            <div>
              <strong>Asistente TechAsset</strong>
              <span>Chat operativo</span>
            </div>
            <div className="assistant-popup-actions">
              <button type="button" onClick={() => setMinimized(true)} aria-label="Minimizar">_</button>
              <button type="button" onClick={close} aria-label="Cerrar">x</button>
            </div>
          </header>
          <div className="assistant-popup-feed">
            {messages.map((message, index) => (
              <article className={`chat-message ${message.role}`} key={`${message.role}-${index}`}>
                <p>{message.text}</p>
                {Array.isArray(message.response?.data?.items) && (
                  <div className="assistant-result-list">
                    {(message.response.data.items as Array<Record<string, unknown>>).slice(0, 5).map((item, itemIndex) => (
                      <div className="assistant-result-card" key={String(item.id || itemIndex)}>
                        <strong>{String(item.titulo || item.codigo_dispositivo || item.curso || item.etiqueta || item.id || 'Resultado')}</strong>
                        <span>{String(item.estado || item.actividad || item.usuario_nombre || item.descripcion || '')}</span>
                      </div>
                    ))}
                  </div>
                )}
                {message.response?.needsConfirmation && (
                  <div className="assistant-confirm-actions">
                    <Button variant="primary" onClick={confirm}>Confirmar</Button>
                    <Button onClick={cancel}>Cancelar</Button>
                  </div>
                )}
                {Boolean(message.response?.suggestedActions?.length) && (
                  <div className="assistant-suggestions">
                    {message.response?.suggestedActions.map(label => (
                      <button type="button" key={label} onClick={() => send(label, QUICK_ACTIONS[label])}>{label}</button>
                    ))}
                  </div>
                )}
                {message.response?.intent === 'loan_flow' && message.response.pendingAction && (
                  <div className="assistant-confirm-actions">
                    <Button onClick={() => {
                      const payload = message.response?.pendingAction?.payload as { codigo_dispositivo?: string } | undefined;
                      if (payload?.codigo_dispositivo) onLoanDraft?.(payload.codigo_dispositivo);
                    }}>Abrir en Préstamos</Button>
                  </div>
                )}
              </article>
            ))}
            {loading && <article className="chat-message assistant"><p>Estoy revisando...</p></article>}
          </div>
          <form className="assistant-popup-form" onSubmit={event => { event.preventDefault(); send(); }}>
            <input className="input" value={input} onChange={event => setInput(event.target.value)} placeholder="Escribi tu pedido..." />
            <Button variant="primary" type="submit" disabled={loading}>Enviar</Button>
          </form>
        </section>
      )}
    </>
  );
}
