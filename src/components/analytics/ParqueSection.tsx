import { useEffect, useMemo, useState } from 'react';
import { getParque, type ParqueResponse } from '../../services/analyticsApi';
import { csvCell } from '../../utils/formatters';
import { Button } from '../layout/Button';
import { ChartCard } from './ChartCard';

// Snapshot del parque: no se filtra por período porque es estado presente
// (condición actual y vida útil restante), no eventos dentro de un rango.
export function ParqueSection() {
  const [data, setData] = useState<ParqueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getParque()
      .then(response => { if (!cancelled) { setData(response); setLoading(false); } })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'No se pudo cargar el parque.');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Viene del backend cubriendo equipos + recursos: si se calculara solo con
  // condicionPorClase (equipos), la barra no cerraría con el total mostrado.
  const condicionRows = data?.condicionTotales ?? [];

  const peoresClases = useMemo(() => {
    if (!data) return [];
    return data.condicionPorClase
      .map(row => ({ label: row.label, value: row.Regular + row.Malo }))
      .filter(row => row.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [data]);

  const exportRenewals = () => {
    if (!data) return;
    const headers = ['Etiqueta', 'Alias', 'Clase', 'Condición', 'Alta', 'Renovación', 'Meses restantes', 'Fecha estimada'];
    const rows = data!.aRenovar.map(item => [
      item.etiqueta, item.alias, item.assetClass, item.condition || 'Sin revisar',
      item.fechaAlta, item.fechaRenovacion, item.mesesRestantes ?? '', item.estimada ? 'sí' : 'no'
    ]);
    const blob = new Blob([[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `a-renovar-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (error) return <div className="tool-error">{error}</div>;

  // Mientras carga se dibuja la estructura con placeholders, no un "Cargando..."
  // que deja el bloque en blanco y hace saltar la página cuando llega el dato.
  const summary = data?.summary ?? { equipos: 0, recursos: 0, equiposMalos: 0, recursosMalos: 0, vencidos: 0, aRenovar12: 0, bajoStock: 0, cobertura: 0 };
  const placeholder = loading && !data;

  return (
    <section className="parque-section">
      <div className="card-head">
        <h3>Parque y vida útil</h3>
        <span className="muted">Estado actual, sin filtro de período</span>
      </div>

      {!placeholder && summary.cobertura < 60 && (
        <div className="tool-info">
          Solo el {summary.cobertura}% del inventario tiene condición cargada. Corré la revisión desde Inventario para que estos números sean confiables.
        </div>
      )}

      <div className={`inv-kpis ${placeholder ? 'is-loading' : ''}`}>
        <div className={summary.equiposMalos ? 'is-warn' : ''}><span>Equipos regular/malo</span><strong>{placeholder ? '·' : summary.equiposMalos}</strong></div>
        <div className={summary.recursosMalos ? 'is-warn' : ''}><span>Recursos regular/malo</span><strong>{placeholder ? '·' : summary.recursosMalos}</strong></div>
        <div className={summary.vencidos ? 'is-bad' : ''}><span>Vida útil vencida</span><strong>{placeholder ? '·' : summary.vencidos}</strong></div>
        <div className={summary.aRenovar12 ? 'is-warn' : ''}><span>A renovar 12 meses</span><strong>{placeholder ? '·' : summary.aRenovar12}</strong></div>
        <div className={summary.bajoStock ? 'is-warn' : ''}><span>Bajo stock</span><strong>{placeholder ? '·' : summary.bajoStock}</strong></div>
        <div><span>Revisado</span><strong>{placeholder ? '·' : `${summary.cobertura}%`}</strong></div>
      </div>

      {/* La condición se lee mejor como barra apilada que como donut: con casi
          todo "Sin revisar", el donut quedaba un círculo con astillas de color. */}
      {!placeholder && <ConditionBar rows={condicionRows} total={summary.equipos + summary.recursos} />}

      {!placeholder && (
        <div className="analytics-bento">
          <ChartCard title="Renovaciones por año" rows={data!.renovacionPorAnio} type="vertical" size="wide" />
          <ChartCard title="Vida útil consumida" rows={data!.vidaConsumida} type="bar" size="md" />
          <ChartCard title="Clases con más deterioro" rows={peoresClases} type="bar" size="md" />
        </div>
      )}

      {!placeholder && (
      <section className="card">
        <div className="card-head">
          <h3>A renovar</h3>
          <div className="actions">
            <Button onClick={exportRenewals} disabled={!data!.aRenovar.length}>Exportar CSV</Button>
          </div>
        </div>
        {!data!.aRenovar.length && <p className="muted">Ningún equipo vence en los próximos 12 meses.</p>}
        {data!.aRenovar.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Equipo</th><th>Clase</th><th>Condición</th><th>Renovación</th><th>Restan</th></tr>
              </thead>
              <tbody>
                {data!.aRenovar.map(item => (
                  <tr key={item.etiqueta}>
                    <td>{item.alias || item.etiqueta}<br /><small className="muted">{item.etiqueta}</small></td>
                    <td>{item.assetClass}</td>
                    <td>{item.condition || 'Sin revisar'}</td>
                    <td>{item.fechaRenovacion}{item.estimada && <small className="muted"> · estimada</small>}</td>
                    <td>{item.vencido ? 'Vencida' : `${item.mesesRestantes} meses`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      )}
    </section>
  );
}

// Barra apilada de condición: una sola línea que se entiende de un vistazo.
function ConditionBar({ rows, total }: { rows: Array<{ label: string; value: number }>; total: number }) {
  const colors: Record<string, string> = {
    Excelente: 'var(--green)', Bueno: 'var(--blue)', Regular: 'var(--yellow)', Malo: 'var(--red)', 'Sin revisar': 'var(--border)'
  };
  const visibles = rows.filter(row => row.value > 0);
  if (!total || !visibles.length) return null;
  return (
    <section className="card parque-condition">
      <div className="card-head"><h3>Condición del parque</h3><span className="muted">{total} activos</span></div>
      <div className="parque-bar">
        {visibles.map(row => (
          <i key={row.label} style={{ width: `${(row.value / total) * 100}%`, background: colors[row.label] || 'var(--border)' }} title={`${row.label}: ${row.value}`} />
        ))}
      </div>
      <ul className="parque-legend">
        {visibles.map(row => (
          <li key={row.label}><i style={{ background: colors[row.label] || 'var(--border)' }} />{row.label}<strong>{row.value}</strong></li>
        ))}
      </ul>
    </section>
  );
}
