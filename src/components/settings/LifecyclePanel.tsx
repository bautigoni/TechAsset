import { useEffect, useState } from 'react';
import { getLifecycleDefaults, updateLifecycleDefault, type LifecycleDefault } from '../../services/devicesApi';
import { Button } from '../layout/Button';

// Vida útil esperada por clase de activo. La cadena es: override por equipo →
// este override por sede → baseline global. Una sede nueva funciona sin cargar
// nada acá; guardar en blanco vuelve al valor global.
export function LifecyclePanel({ consultationMode }: { consultationMode: boolean }) {
  const [rows, setRows] = useState<LifecycleDefault[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = () => getLifecycleDefaults()
    .then(response => {
      setRows(response.items);
      setDrafts(Object.fromEntries(response.items.map(item => [item.assetClass, item.origen === 'global' ? '' : String(item.meses)])));
    })
    .catch(err => setError(err instanceof Error ? err.message : 'No se pudo cargar la vida útil.'));

  useEffect(() => { void load(); }, []);

  const save = async (assetClass: string) => {
    setBusy(assetClass);
    setError('');
    setMessage('');
    try {
      const raw = drafts[assetClass];
      await updateLifecycleDefault({ assetClass, meses: raw ? Number(raw) : 0 });
      setMessage(`${assetClass} actualizado.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h3>Vida útil esperada</h3>
        <span className="muted">Por clase de activo, en meses</span>
      </div>
      <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>
        Dejalo vacío para usar el valor por defecto del sistema. Un equipo puntual puede tener su propio valor desde su perfil.
      </p>
      {message && <div className="tool-info">{message}</div>}
      {error && <div className="tool-error">{error}</div>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Clase</th><th>Meses</th><th>Origen</th><th /></tr></thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.assetClass}>
                <td>{row.assetClass}</td>
                <td>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    placeholder={String(row.meses)}
                    value={drafts[row.assetClass] ?? ''}
                    disabled={consultationMode}
                    onChange={event => setDrafts(current => ({ ...current, [row.assetClass]: event.target.value }))}
                  />
                </td>
                <td className="muted">{row.origen === 'sede' ? `${row.meses} (esta sede)` : `${row.meses} (por defecto)`}</td>
                <td>
                  <Button type="button" disabled={consultationMode || busy === row.assetClass} onClick={() => void save(row.assetClass)}>
                    {busy === row.assetClass ? 'Guardando...' : 'Guardar'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
