import { useEffect, useState } from 'react';
import { createDailyClosure, fetchDailyClosurePreview, fetchDailyClosures } from '../../services/operationsApi';
import { Button } from '../layout/Button';
import { Modal } from '../layout/Modal';

export function DailyClosurePanel({ operator, consultationMode }: { operator: string; consultationMode: boolean }) {
  const [open, setOpen] = useState(false);
  const [resumen, setResumen] = useState<Record<string, unknown> | null>(null);
  const [observaciones, setObservaciones] = useState('');
  const [history, setHistory] = useState<Array<Record<string, unknown>>>([]);
  const [info, setInfo] = useState('');

  const load = async () => {
    const [preview, closures] = await Promise.all([fetchDailyClosurePreview(), fetchDailyClosures()]);
    if (preview.ok) setResumen(preview.resumen);
    if (closures.ok) setHistory(closures.items);
  };

  useEffect(() => { if (open) load().catch(() => {}); }, [open]);

  const text = resumen ? renderClosureText(resumen, observaciones, operator) : '';

  return (
    <>
      <Button onClick={() => setOpen(true)}>Cierre del día</Button>
      {open && (
        <Modal title="Cierre del día TIC" onClose={() => setOpen(false)}>
          <div className="stack">
            <pre className="closure-preview">{text || 'Cargando resumen...'}</pre>
            <label>Observaciones manuales<textarea className="input" rows={4} value={observaciones} onChange={event => setObservaciones(event.target.value)} /></label>
            <div className="actions">
              <Button disabled={!text} onClick={() => navigator.clipboard?.writeText(text).then(() => setInfo('Copiado al portapapeles.'))}>Copiar</Button>
              <Button variant="primary" disabled={consultationMode || !resumen} onClick={async () => {
                await createDailyClosure({ operator, observaciones, resumen: resumen || {} });
                setInfo('Cierre guardado.');
                await load();
              }}>Generar cierre</Button>
            </div>
            {info && <div className="tool-info">{info}</div>}
            <details>
              <summary>Historial ({history.length})</summary>
              <div className="closure-history">
                {history.map(item => <div key={String(item.id)} className="list-item">{String(item.fecha)} · {String(item.operador || '')}</div>)}
              </div>
            </details>
          </div>
        </Modal>
      )}
    </>
  );
}

function renderClosureText(resumen: Record<string, unknown>, observaciones: string, operator: string) {
  const agenda = Array.isArray(resumen.agendaDelDia) ? resumen.agendaDelDia : [];
  const aulas = Array.isArray(resumen.aulasConProblemas) ? resumen.aulasConProblemas : [];
  const notes = Array.isArray(resumen.notasImportantes) ? resumen.notasImportantes : [];
  return [
    `Cierre TIC - ${new Date().toLocaleString()}`,
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
