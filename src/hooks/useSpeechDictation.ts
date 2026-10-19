import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Dictado con el reconocimiento de voz del navegador (Web Speech API).
 * El server no transcribe audio: no pasa por el server ni usa keys.
 * En Chrome/Edge el audio lo procesa el proveedor del navegador; en Firefox no
 * existe la API y `supported` queda en false (el botón de micrófono se oculta).
 *
 * Uso en el panel del asistente:
 *   const dictation = useSpeechDictation({ onFinal: text => setDraft(text) });
 *   {dictation.supported && <button onClick={dictation.listening ? dictation.stop : dictation.start}>…</button>}
 *   // mientras habla: mostrar dictation.transcript (incluye lo provisorio)
 *   // al terminar: onFinal(texto) con el resultado definitivo; dictation.error si falló
 */

interface SpeechRecognitionAlternativeLike { transcript: string }
interface SpeechRecognitionResultLike { isFinal: boolean; length: number; [index: number]: SpeechRecognitionAlternativeLike }
interface SpeechRecognitionEventLike { resultIndex: number; results: { length: number; [index: number]: SpeechRecognitionResultLike } }
interface SpeechRecognitionErrorEventLike { error: string }
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'No hay permiso para usar el micrófono. Habilitalo en el navegador.',
  'service-not-allowed': 'El navegador no permite el dictado en esta página.',
  'no-speech': 'No escuché nada. Probá de nuevo, un poco más cerca del micrófono.',
  'audio-capture': 'No encontré un micrófono conectado.',
  network: 'El dictado del navegador necesita conexión a internet.',
  'language-not-supported': 'El navegador no reconoce español en el dictado.'
};

export interface SpeechDictationOptions {
  /** Idioma del reconocimiento. Por defecto español de Argentina. */
  lang?: string;
  /** Seguir escuchando entre pausas hasta que se llame a stop(). Por defecto false (corta solo al callarse). */
  continuous?: boolean;
  /** Se llama una vez, al terminar, con el texto definitivo (si hubo). */
  onFinal?: (text: string) => void;
}

export interface SpeechDictation {
  /** false en navegadores sin Web Speech API (Firefox): ocultar el micrófono. */
  supported: boolean;
  listening: boolean;
  /** Texto reconocido hasta ahora, incluidos los resultados intermedios. */
  transcript: string;
  /** Mensaje listo para mostrar si algo falló; null si no. */
  error: string | null;
  start: () => void;
  stop: () => void;
  /** Limpia transcript y error. */
  reset: () => void;
}

export function useSpeechDictation(options: SpeechDictationOptions = {}): SpeechDictation {
  const { lang = 'es-AR', continuous = false } = options;
  const [supported] = useState(() => getRecognitionCtor() !== null);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTextRef = useRef('');
  const onFinalRef = useRef(options.onFinal);
  onFinalRef.current = options.onFinal;

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const reset = useCallback(() => {
    finalTextRef.current = '';
    setTranscript('');
    setError(null);
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor || recognitionRef.current) return;
    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = continuous;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    finalTextRef.current = '';
    setTranscript('');
    setError(null);

    recognition.onresult = event => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript || '';
        if (result.isFinal) finalTextRef.current = `${finalTextRef.current} ${text}`.trim();
        else interim += text;
      }
      setTranscript(`${finalTextRef.current} ${interim}`.trim());
    };
    recognition.onerror = event => {
      // "aborted" es el stop/abort propio: no es un error para mostrar.
      if (event.error === 'aborted') return;
      setError(ERROR_MESSAGES[event.error] || 'No pude usar el dictado. Probá de nuevo o escribí el pedido.');
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      const text = finalTextRef.current.trim();
      if (text) {
        setTranscript(text);
        onFinalRef.current?.(text);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setError('No pude iniciar el dictado. Probá de nuevo.');
    }
  }, [lang, continuous]);

  // Al desmontar, cortar sin disparar onFinal.
  useEffect(() => () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    recognition.onend = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.abort();
    recognitionRef.current = null;
  }, []);

  return { supported, listening, transcript, error, start, stop, reset };
}
