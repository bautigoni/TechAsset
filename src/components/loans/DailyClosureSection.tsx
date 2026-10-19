import { useCallback, useEffect, useState } from 'react';
import { createDailyClosure, fetchDailyClosurePreview, fetchDailyClosures } from '../../services/operationsApi';
import { formatDate } from '../../utils/formatters';
import { Button } from '../../ui/Button';
import { Textarea } from '../../ui/Field';
import { ErrorState, Eyebrow, SkeletonText } from '../../ui/Data';
import { TruncatedText } from '../../ui/Truncated';

type Closure = { id: number | string; fecha?: string; operador?: string; observaciones?: string; createdAt?: string };

/**
 * Cierre del día TIC, en línea arriba de Préstamos (antes era un modal).
 * Vista previa armada en el cliente (se actualiza al escribir observaciones),
 * Copiar, Generar cierre (deshabilitado en consulta) e historial de cierres
 * con fecha, operador y observaciones.
 */
export function DailyClosureSection({ operator, consultationMode, onClose }: { operator: string; consultationMode: boolean; onClose: () => void }) {
  const [resumen, setResumen] = useState<Record<string, unknown> | null>(null);
  const [history, setHistory] = useState<Closure[]>([]);
  const [observaciones, setObservaciones] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [preview, closures] = await Promise.all([fetchDailyClosurePreview(), fetchDailyClosures()]);
      if (preview.ok) setResumen(preview.resumen);
      if (closures.ok) setHistory(closures.items as Closure[]);
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : 'No se pudo cargar el resumen del día.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const text = resumen ? renderClosureText(resumen, observaciones, operator) : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setInfo({ tone: 'ok', text: 'Copiado al portapapeles.' });
    } catch {
      setInfo({ tone: 'bad', text: 'No se pudo copiar. Seleccioná el texto y copialo a mano.' });
    }
  };

  const generate = async () => {
    if (consultationMode || !resumen) return;
    setSaving(true);
    setInfo(null);
    try {
      await createDailyClosure({ operator, observaciones, resumen });
      setInfo({ tone: 'ok', text: 'Cierre guardado.' });
      const closures = await fetchDailyClosures().catch(() => null);
      if (closures?.ok) setHistory(closures.items as Closure[]);
    } catch (reason) {
      setInfo({ tone: 'bad', text: reason instanceof Error ? reason.message : 'No se pudo guardar el cierre.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section id="lo-cierre" className="lo-card lo-closure ui-enter" aria-labelledby="lo-cierre-title" data-scanner-ignore="">
      <div className="lo-card-head">
        <div className="lo-head-text">
          <Eyebrow>Cierre del día TIC</Eyebrow>
          <h2 id="lo-cierre-title" className="lo-h2">{capitalize(formatDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long' }))}</h2>
        </div>
        <div className="lo-head-actions">
          <Button size="sm" variant="ghost" aria-expanded={historyOpen} onClick={() => setHistoryOpen(value => !value)}>
            {historyOpen ? 'Ocultar historial' : `Historial (${history.length})`}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>Cerrar</Button>
        </div>
      </div>

      {historyOpen && (
        <div className="lo-closure-history ui-enter">
          {history.map(item => (
            <div className="lo-closure-hrow" key={String(item.id)}>
              <span className="lo-closure-hwhen g-num">{item.fecha || formatDate(item.createdAt)}</span>
              <span className="lo-closure-hop">{item.operador || 'Sin operador'}</span>
              <TruncatedText className="lo-closure-hobs">{item.observaciones || 'Sin observaciones.'}</TruncatedText>
            </div>
          ))}
          {!history.length && <span className="lo-muted">Todavía no hay cierres guardados en esta sede.</span>}
        </div>
      )}

      {loadError && <ErrorState message={loadError} onRetry={() => void load()} retrying={loading} />}

      <div className="lo-closure-grid">
        <div className="lo-closure-preview">
          <span className="lo-flabel">Vista previa</span>
          {text
            ? <div className="lo-closure-text g-num" aria-live="polite">{text}</div>
            : loading ? <SkeletonText lines={8} /> : <span className="lo-muted">Sin datos para armar el cierre.</span>}
        </div>
        <div className="lo-closure-side">
          <Textarea label="Observaciones manuales" minRows={5} value={observaciones} onValueChange={setObservaciones} placeholder="Lo que el próximo turno tiene que saber…" />
          <div className="lo-lend-actions">
            <Button variant="secondary" disabled={!text} onClick={() => void copy()}>Copiar</Button>
            <Button variant="primary" disabled={consultationMode || !resumen} loading={saving} loadingLabel="Guardando…" onClick={() => void generate()}>Generar cierre</Button>
            {info && <span className={info.tone === 'ok' ? 'lo-ok-text' : 'lo-form-error'} role={info.tone === 'ok' ? 'status' : 'alert'}>{info.text}</span>}
          </div>
        </div>
      </div>
    </section>
  );
}

function capitalize(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function renderClosureText(resumen: Record<string, unknown>, observaciones: string, operator: string) {
  const agenda = Array.isArray(resumen.agendaDelDia) ? resumen.agendaDelDia : [];
  const aulas = Array.isArray(resumen.aulasConProblemas) ? resumen.aulasConProblemas : [];
  const notes = Array.isArray(resumen.notasImportantes) ? resumen.notasImportantes : [];
  return [
    `Cierre TIC - ${formatDate(new Date())}`,
    `Operador: ${operator}`,
    '',
    `Préstamos activos: ${resumen.prestamosActivos ?? 0}`,
    `Dispositivos no devueltos: ${Array.isArray(resumen.dispositivosNoDevueltos) ? resumen.dispositivosNoDevueltos.join(', ') || 'Sin datos' : 'Sin datos'}`,
    `Tareas pendientes: ${resumen.tareasPendientes ?? 0}`,
    `Tareas en proceso: ${resumen.tareasEnProceso ?? 0}`,
    `Tareas hechas hoy: ${resumen.tareasHechasHoy ?? 0}`,
    `Agenda del día: ${agenda.length}`,
    `Canceladas: ${resumen.actividadesCanceladas ?? 0}`,
    `Con faltantes: ${resumen.actividadesConFaltantes ?? 0}`,
    `Aulas con problemas/observaciones: ${aulas.length}`,
    `Notas importantes: ${notes.length}`,
    '',
    'Observaciones:',
    observaciones || 'Sin observaciones.'
  ].join('\n');
}
