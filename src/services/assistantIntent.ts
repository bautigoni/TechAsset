export type AssistantIntentName = 'loan_device' | 'return_device' | 'create_task' | 'create_agenda' | 'navigate' | 'show_details' | 'unknown';

export interface AssistantDraft {
  intent: AssistantIntentName;
  confidence: number;
  text: string;
  deviceCode?: string;
  aliasOperativo?: string;
  person?: string;
  location?: string;
  title?: string;
  view?: string;
}

function clean(value: string | undefined) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function extractPerson(raw: string): string | undefined {
  const match = raw.match(/\ba\s+(.+?)(?:\s+del\b|\s+de la\b|\s+en\b|\s+va\s+a\s+estar\b|,|\.|$)/i);
  if (match) return clean(match[1]);
  // Try person name at start: "mili prestale touch 30"
  const start = raw.replace(/^(prestale|prestar|prestame)\s+/i, '').trim();
  const nameMatch = start.match(/^([A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){0,2})/);
  if (nameMatch) {
    const candidate = nameMatch[1].trim();
    if (!/^(en|del|para|por|como|doe|docente|alumno|touch|plani|nuc|d\s*\d)$/i.test(candidate) && candidate.length >= 2) {
      return candidate;
    }
  }
  return undefined;
}

function extractLocation(raw: string): string | undefined {
  const explicit = raw.match(/(?:va\s+a\s+estar\s+)?en\s*:?\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\s]{0,30}?)(?:\s+por\b|\s+para\b|\s+va\b|\s+y\b|,|\.|$)/i);
  if (explicit) return clean(explicit[1]);
  const deMatch = raw.match(/\bdel?\s+([A-Za-zÀ-ÿ]{2,20})(?:\s+por\b|\s+para\b|\s+va\b|,|\.|$)/i);
  if (deMatch) return clean(deMatch[1]);
  return undefined;
}

export function detectAssistantIntent(text: string): AssistantDraft {
  const raw = clean(text);
  const lower = raw.toLowerCase();
  const device = raw.match(/\bD\s*0*\d{1,5}\b/i)?.[0]?.replace(/\s+/g, '').toUpperCase();
  const aliasOp = raw.match(/\b(Touch|Plani|NUC|Notebook|PC)\s+(\d{1,3})\b/i);
  const person = extractPerson(raw);
  const location = extractLocation(raw);

  if (/(prestale|prestar|prestamo|pr[eé]stamo)/i.test(raw)) {
    return {
      intent: 'loan_device', confidence: .9, text: raw,
      deviceCode: device, aliasOperativo: aliasOp?.[0], person, location
    };
  }
  if (/(devolvela|devolver|devuelve|devolucion|devoluci[oó]n)/i.test(raw)) {
    return { intent: 'return_device', confidence: .88, text: raw, deviceCode: device };
  }
  if (/(tarea|arreglar|revisar|pendiente)/i.test(raw)) {
    return { intent: 'create_task', confidence: .78, text: raw, title: raw };
  }
  if (/(agenda|actividad|reservar|glifing|matific|programacion|programaci[oó]n)/i.test(raw)) {
    return { intent: 'create_agenda', confidence: .76, text: raw, title: raw };
  }
  if (/(ir a|abrir|mostrar)\s+(dashboard|dispositivos|prestamos|pr[eé]stamos|analitica|anal[ií]tica|agenda|tareas|configuracion|configuraci[oó]n)/i.test(lower)) {
    return { intent: 'navigate', confidence: .82, text: raw, view: lower };
  }
  if (device) return { intent: 'show_details', confidence: .65, text: raw, deviceCode: device };
  if (aliasOp) return { intent: 'show_details', confidence: .6, text: raw, deviceCode: aliasOp[0] };
  if (person && /touch|plani|nuc/i.test(raw)) return { intent: 'loan_device', confidence: .7, text: raw, person, location };
  return { intent: 'unknown', confidence: .2, text: raw };
}
