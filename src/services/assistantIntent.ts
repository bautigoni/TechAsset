export type AssistantIntentName = 'loan_device' | 'return_device' | 'create_task' | 'create_agenda' | 'navigate' | 'show_details' | 'unknown';

export interface AssistantDraft {
  intent: AssistantIntentName;
  confidence: number;
  text: string;
  deviceCode?: string;
  person?: string;
  location?: string;
  title?: string;
  view?: string;
}

function clean(value: string | undefined) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function extractPerson(raw: string) {
  return clean(raw.match(/\ba\s+(.+?)(?:\s+del\b|\s+en\b|\s+va\s+a\s+estar\b|,|$)/i)?.[1]);
}

function extractLocation(raw: string) {
  return clean(raw.match(/\bva\s+a\s+estar\s+en\s+(.+?)(?:,|\.|$)/i)?.[1]
    || raw.match(/\ben\s+(.+?)(?:,|\.|$)/i)?.[1]);
}

export function detectAssistantIntent(text: string): AssistantDraft {
  const raw = clean(text);
  const lower = raw.toLowerCase();
  const device = raw.match(/\bD\s*0*\d{1,5}\b/i)?.[0]?.replace(/\s+/g, '').toUpperCase();
  const person = extractPerson(raw);
  const location = extractLocation(raw);

  if (/(prestale|prestar|prestamo|prestamos|pr[eé]stamo|pr[eé]stamos)/i.test(raw)) {
    return { intent: 'loan_device', confidence: .9, text: raw, deviceCode: device, person, location };
  }
  if (/(devolvela|devolver|devuelve|devolucion|devoluciones|devoluci[oó]n)/i.test(raw)) {
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
  return { intent: 'unknown', confidence: .2, text: raw };
}
