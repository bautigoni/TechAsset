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

  const condicionRows = useMemo(() => {
    if (!data) return [];
    const totales = { Excelente: 0, Bueno: 0, Regular: 0, Malo: 0, 'Sin revisar': 0 };
    for (const row of data.condicionPorClase) {
      totales.Excelente += row.Excelente;
      totales.Bueno += row.Bueno;
      totales.Regular += row.Regular;
      totales.Malo += row.Malo;
      totales['Sin revisar'] += row['Sin revisar'];
    }
    return Object.entries(totales).map(([label, value]) => ({ label, value }));
  }, [data]);

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
    const rows = data.aRenovar.map(item => [
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

  if (loading) return <section className="card"><div className="card-head"><h3>Parque y vida útil</h3></div><p className="muted">Cargando...</p></section>;
  if (error) return <div className="tool-error">{error}</div>;
  if (!data) return null;

  const { summary } = data;

  return (
    <section className="parque-section">
      <div className="card-head">
        <h3>Parque y vida útil</h3>
        <span className="muted">Estado actual, sin filtro de período</span>
      </div>

      {summary.cobertura < 60 && (
        <div className="tool-info">
          Solo el {summary.cobertura}% del inventario tiene condición cargada. Corré la revisión desde Inventario para que estos números sean confiables.
        </div>
      )}

      <div className="inventory-kpis">
        <div className={summary.equiposMalos ? 'is-warn' : ''}><span>Equipos regular/malo</span><strong>{summary.equiposMalos}</strong></div>
        <div className={summary.recursosMalos ? 'is-warn' : ''}><span>Recursos regular/malo</span><strong>{summary.recursosMalos}</strong></div>
        <div className={summary.vencidos ? 'is-bad' : ''}><span>Vida útil vencida</span><strong>{summary.vencidos}</strong></div>
        <div className={summary.aRenovar12 ? 'is-warn' : ''}><span>A renovar 12 meses</span><strong>{summary.aRenovar12}</strong></div>
        <div className={summary.bajoStock ? 'is-warn' : ''}><span>Bajo stock</span><strong>{summary.bajoStock}</strong></div>
        <div><span>Revisado</span><strong>{summary.cobertura}%</strong></div>
      </div>

      <div className="analytics-bento">
        <ChartCard title="Condición del parque" rows={condicionRows} type="donut" size="md" />
        <ChartCard title="Clases con más deterioro" rows={peoresClases} type="bar" size="md" />
        <ChartCard title="Renovaciones por año" rows={data.renovacionPorAnio} type="vertical" size="wide" />
        <ChartCard title="Vida útil consumida" rows={data.vidaConsumida} type="bar" size="md" />
      </div>

      <section className="card">
        <div className="card-head">
          <h3>A renovar</h3>
          <div className="actions">
            <Button onClick={exportRenewals} disabled={!data.aRenovar.length}>Exportar CSV</Button>
          </div>
        </div>
        {!data.aRenovar.length && <p className="muted">Ningún equipo vence en los próximos 12 meses.</p>}
        {data.aRenovar.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Equipo</th><th>Clase</th><th>Condición</th><th>Renovación</th><th>Restan</th></tr>
              </thead>
              <tbody>
                {data.aRenovar.map(item => (
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
    </section>
  );
}
