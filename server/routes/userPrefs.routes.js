import { Router } from 'express';
import { getDb, nowIso } from '../db.js';

export const userPrefsRouter = Router();

// req.user.id es el id de la tabla `users` (sesiones), no el de `allowed_users`:
// buscar por id leía y guardaba las preferencias en la fila de OTRO usuario. El
// vínculo entre las dos tablas es el mail.
function userEmail(req) {
  return String(req.user?.email || '').trim().toLowerCase();
}

function readPrefs(email) {
  const row = getDb().prepare('SELECT prefs_json FROM allowed_users WHERE lower(email) = @email').get({ email });
  if (!row?.prefs_json) return {};
  try {
    const parsed = JSON.parse(row.prefs_json);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

userPrefsRouter.get('/user/prefs', (req, res) => {
  const email = userEmail(req);
  if (!req.user?.id || !email) return res.status(401).json({ ok: false, error: 'No autenticado' });
  res.json({ ok: true, prefs: readPrefs(email) });
});

userPrefsRouter.patch('/user/prefs', (req, res) => {
  const email = userEmail(req);
  if (!req.user?.id || !email) return res.status(401).json({ ok: false, error: 'No autenticado' });
  // operator/operador los agrega el middleware de index.js a toda escritura: no son preferencias.
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const { operator: _operator, operador: _operador, ...patch } = body;
  const merged = { ...readPrefs(email), ...patch };
  delete merged.operator;
  delete merged.operador;
  getDb().prepare('UPDATE allowed_users SET prefs_json = @prefs, updated_at = @ts WHERE lower(email) = @email').run({
    prefs: JSON.stringify(merged),
    ts: nowIso(),
    email
  });
  res.json({ ok: true, prefs: merged });
});
