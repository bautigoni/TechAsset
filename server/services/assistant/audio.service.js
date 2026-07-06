import OpenAI, { toFile } from 'openai';
import { config } from '../../config.js';

const MAX_AUDIO_BYTES = 6 * 1024 * 1024;
const MIME_EXTENSIONS = new Map([
  ['audio/aac', 'aac'],
  ['audio/flac', 'flac'],
  ['audio/m4a', 'm4a'],
  ['audio/mp3', 'mp3'],
  ['audio/mp4', 'mp4'],
  ['audio/mpeg', 'mp3'],
  ['audio/ogg', 'ogg'],
  ['audio/wav', 'wav'],
  ['audio/webm', 'webm']
]);

let client;

function openaiClient() {
  if (!config.openaiApiKey) return null;
  if (!client) client = new OpenAI({ apiKey: config.openaiApiKey });
  return client;
}

function normalizeMimeType(value) {
  return String(value || 'audio/webm').split(';')[0].trim().toLowerCase();
}

function decodeAudio(audioBase64, mimeType) {
  const clean = String(audioBase64 || '').replace(/^data:[^;]+;base64,/, '').trim();
  if (!clean) throw new Error('No se recibió ningún audio.');
  if (!MIME_EXTENSIONS.has(mimeType)) throw new Error('Ese formato de audio no es compatible.');

  const buffer = Buffer.from(clean, 'base64');
  if (!buffer.length) throw new Error('El audio está vacío.');
  if (buffer.length > MAX_AUDIO_BYTES) throw new Error('El audio es demasiado largo. Probá con un mensaje de hasta un minuto.');
  return buffer;
}

export async function transcribeAssistantAudio({ audioBase64, mimeType: rawMimeType }) {
  const openai = openaiClient();
  if (!openai) throw new Error('El asistente de voz no está configurado en este servidor.');

  const mimeType = normalizeMimeType(rawMimeType);
  const buffer = decodeAudio(audioBase64, mimeType);
  const extension = MIME_EXTENSIONS.get(mimeType);
  const file = await toFile(buffer, `mensaje.${extension}`, { type: mimeType });
  const result = await openai.audio.transcriptions.create({
    file,
    model: 'gpt-4o-mini-transcribe',
    language: 'es',
    prompt: 'Conversación sobre soporte TIC escolar, dispositivos, préstamos, devoluciones, tareas y agenda.'
  });
  const text = String(result?.text || '').trim();
  if (!text) throw new Error('No pude entender el audio. Probá de nuevo hablando un poco más cerca del micrófono.');
  return { text };
}
