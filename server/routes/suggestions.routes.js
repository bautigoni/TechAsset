import { Router } from 'express';
import { getDb, nowIso } from '../db.js';
import { canEditModule, canViewModule, requireSite } from '../services/siteContext.service.js';
import { notifySiteAdmins, notifyUser } from '../services/notifications.service.js';

export const suggestionsRouter = Router();

const STATUSES = new Set(['Proposed', 'Under Review', 'Planned', 'In Progress', 'Implemented', 'Rejected']);

suggestionsRouter.get('/suggestions', (req, res) => {
  const siteCode = requireSite(req);
  if (!canViewModule(req, 'suggestions', siteCode)) return forbidden(res);
  const status = String(req.query.status || '').trim();
  const category = String(req.query.category || '').trim();
  const sort = String(req.query.sort || 'newest');
  const conditions = ["s.site_code=?", 's.active=1', "COALESCE(s.deleted_at,'')=''" ];
  const args = [siteCode];
  if (status && STATUSES.has(status)) { conditions.push('s.status=?'); args.push(status); }
  if (category) { conditions.push('lower(s.category)=lower(?)'); args.push(category); }
  const order = sort === 'most_voted' ? 'vote_count DESC, s.created_at DESC' : 's.created_at DESC';
  const rows = getDb().prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM suggestion_votes v WHERE v.site_code=s.site_code AND v.suggestion_id=s.id) AS vote_count,
      (SELECT COUNT(*) FROM suggestion_comments c WHERE c.site_code=s.site_code AND c.suggestion_id=s.id AND COALESCE(c.deleted_at,'')='') AS comment_count,
      EXISTS(SELECT 1 FROM suggestion_votes v WHERE v.site_code=s.site_code AND v.suggestion_id=s.id AND lower(v.user_email)=lower(?)) AS has_voted
    FROM suggestions s
    WHERE ${conditions.join(' AND ')}
    ORDER BY ${order}, s.id DESC
  `).all(req.user?.email || '', ...args);
  const canManage = canEditModule(req, 'suggestions', siteCode);
  const items = rows.map(row => rowToSuggestion(row, req.user?.email, canManage));
  const all = getDb().prepare("SELECT id,status FROM suggestions WHERE site_code=? AND active=1 AND COALESCE(deleted_at,'')='' ").all(siteCode);
  const top = getDb().prepare(`SELECT s.id,s.title,COUNT(v.id) AS votes FROM suggestions s LEFT JOIN suggestion_votes v ON v.site_code=s.site_code AND v.suggestion_id=s.id WHERE s.site_code=? AND s.active=1 AND COALESCE(s.deleted_at,'')='' GROUP BY s.id,s.title ORDER BY votes DESC,s.created_at DESC LIMIT 1`).get(siteCode);
  res.json({
    ok: true, items, canManage,
    categories: [...new Set(getDb().prepare("SELECT category FROM suggestions WHERE site_code=? AND active=1 AND COALESCE(deleted_at,'')='' ORDER BY category").all(siteCode).map(row => row.category).filter(Boolean))],
    stats: { total: all.length, mostVoted: top ? { id: Number(top.id), title: top.title, votes: Number(top.votes || 0) } : null, implemented: all.filter(row => row.status === 'Implemented').length, pendingReview: all.filter(row => row.status === 'Proposed' || row.status === 'Under Review').length }
  });
});

suggestionsRouter.post('/suggestions', (req, res) => {
  const siteCode = requireSite(req);
  if (!canViewModule(req, 'suggestions', siteCode)) return forbidden(res);
  const item = normalizePayload(req.body);
  if (!item.title || !item.description) return res.status(400).json({ ok: false, error: 'Completá título y descripción.' });
  const ts = nowIso();
  const info = getDb().prepare(`INSERT INTO suggestions (site_code,title,description,category,status,author_email,author_name,active,created_at,updated_at) VALUES (?,?,?,?, 'Proposed',?,?,1,?,?)`)
    .run(siteCode, item.title, item.description, item.category, req.user?.email || '', actor(req), ts, ts);
  try { notifySiteAdmins({ siteCode, kind: 'suggestion.created', title: 'Nueva sugerencia', body: item.title, link: `/sede/${siteCode}/suggestions`, exceptEmail: req.user?.email }); } catch { /* noop */ }
  res.json({ ok: true, item: readSuggestion(info.lastInsertRowid, siteCode, req) });
});

suggestionsRouter.get('/suggestions/:id/comments', (req, res) => {
  const siteCode = requireSite(req);
  if (!canViewModule(req, 'suggestions', siteCode)) return forbidden(res);
  const rows = getDb().prepare("SELECT * FROM suggestion_comments WHERE site_code=? AND suggestion_id=? AND COALESCE(deleted_at,'')='' ORDER BY id").all(siteCode, req.params.id);
  res.json({ ok: true, items: rows.map(rowToComment) });
});

suggestionsRouter.post('/suggestions/:id/comments', (req, res) => {
  const siteCode = requireSite(req);
  if (!canViewModule(req, 'suggestions', siteCode)) return forbidden(res);
  const suggestion = getSuggestion(req.params.id, siteCode);
  if (!suggestion) return notFound(res);
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ ok: false, error: 'El comentario está vacío.' });
  const ts = nowIso();
  const info = getDb().prepare('INSERT INTO suggestion_comments (site_code,suggestion_id,body,author_email,author_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(siteCode, suggestion.id, body, req.user?.email || '', actor(req), ts, ts);
  if (String(suggestion.author_email).toLowerCase() !== String(req.user?.email || '').toLowerCase()) {
    try { notifyUser({ siteCode, email: suggestion.author_email, kind: 'suggestion.comment', title: `Nuevo comentario: ${suggestion.title}`, body: body.slice(0, 160), link: `/sede/${siteCode}/suggestions` }); } catch { /* noop */ }
  }
  res.json({ ok: true, item: rowToComment(getDb().prepare('SELECT * FROM suggestion_comments WHERE id=?').get(info.lastInsertRowid)) });
});

suggestionsRouter.post('/suggestions/:id/vote', (req, res) => {
  const siteCode = requireSite(req);
  if (!canViewModule(req, 'suggestions', siteCode)) return forbidden(res);
  const suggestion = getSuggestion(req.params.id, siteCode);
  if (!suggestion) return notFound(res);
  const email = String(req.user?.email || '').toLowerCase();
  const existing = getDb().prepare('SELECT id FROM suggestion_votes WHERE site_code=? AND suggestion_id=? AND lower(user_email)=?').get(siteCode, suggestion.id, email);
  if (existing) getDb().prepare('DELETE FROM suggestion_votes WHERE id=?').run(existing.id);
  else getDb().prepare('INSERT INTO suggestion_votes (site_code,suggestion_id,user_email,created_at) VALUES (?,?,?,?)').run(siteCode, suggestion.id, email, nowIso());
  const votes = Number(getDb().prepare('SELECT COUNT(*) AS total FROM suggestion_votes WHERE site_code=? AND suggestion_id=?').get(siteCode, suggestion.id).total || 0);
  res.json({ ok: true, voted: !existing, votes });
});

suggestionsRouter.patch('/suggestions/:id', (req, res) => {
  const siteCode = requireSite(req);
  if (!canViewModule(req, 'suggestions', siteCode)) return forbidden(res);
  const old = getSuggestion(req.params.id, siteCode);
  if (!old) return notFound(res);
  const canManage = canEditModule(req, 'suggestions', siteCode);
  const owns = String(old.author_email || '').toLowerCase() === String(req.user?.email || '').toLowerCase();
  if (!owns && !canManage) return res.status(403).json({ ok: false, error: 'Solo podés editar tus propias sugerencias.' });
  const item = normalizePayload({ ...old, ...req.body });
  if (!item.title || !item.description) return res.status(400).json({ ok: false, error: 'Completá título y descripción.' });
  const requestedStatus = String(req.body?.status ?? old.status);
  const status = canManage && STATUSES.has(requestedStatus) ? requestedStatus : old.status;
  getDb().prepare('UPDATE suggestions SET title=?,description=?,category=?,status=?,updated_at=? WHERE id=? AND site_code=?').run(item.title, item.description, item.category, status, nowIso(), old.id, siteCode);
  if (status !== old.status) notifySuggestionFollowers(old, siteCode, status, req.user?.email || '');
  res.json({ ok: true, item: readSuggestion(old.id, siteCode, req) });
});

suggestionsRouter.delete('/suggestions/:id', (req, res) => {
  const siteCode = requireSite(req);
  const old = getSuggestion(req.params.id, siteCode);
  if (!old) return notFound(res);
  const canManage = canEditModule(req, 'suggestions', siteCode);
  const owns = String(old.author_email || '').toLowerCase() === String(req.user?.email || '').toLowerCase();
  if (!owns && !canManage) return res.status(403).json({ ok: false, error: 'Solo podés borrar tus propias sugerencias.' });
  const result = getDb().prepare('UPDATE suggestions SET active=0,deleted_at=?,deleted_by=?,updated_at=? WHERE id=? AND site_code=?').run(nowIso(), actor(req), nowIso(), old.id, siteCode);
  res.json({ ok: true, deleted: result.changes > 0 });
});

function readSuggestion(id, siteCode, req) {
  const row = getDb().prepare(`SELECT s.*,(SELECT COUNT(*) FROM suggestion_votes v WHERE v.site_code=s.site_code AND v.suggestion_id=s.id) AS vote_count,(SELECT COUNT(*) FROM suggestion_comments c WHERE c.site_code=s.site_code AND c.suggestion_id=s.id AND COALESCE(c.deleted_at,'')='') AS comment_count,EXISTS(SELECT 1 FROM suggestion_votes v WHERE v.site_code=s.site_code AND v.suggestion_id=s.id AND lower(v.user_email)=lower(?)) AS has_voted FROM suggestions s WHERE s.id=? AND s.site_code=?`).get(req.user?.email || '', id, siteCode);
  return rowToSuggestion(row, req.user?.email, canEditModule(req, 'suggestions', siteCode));
}
function getSuggestion(id, siteCode) { return getDb().prepare("SELECT * FROM suggestions WHERE id=? AND site_code=? AND active=1 AND COALESCE(deleted_at,'')='' ").get(id, siteCode); }
function rowToSuggestion(row, email, canManage) { const owns = String(row.author_email || '').toLowerCase() === String(email || '').toLowerCase(); return { id:Number(row.id),title:row.title,description:row.description,category:row.category||'General',status:row.status||'Proposed',authorEmail:row.author_email||'',authorName:row.author_name||'',voteCount:Number(row.vote_count||0),commentCount:Number(row.comment_count||0),hasVoted:Boolean(row.has_voted),canEdit:owns||canManage,canDelete:owns||canManage,createdAt:row.created_at||'',updatedAt:row.updated_at||'' }; }
function rowToComment(row) { return { id:Number(row.id),suggestionId:Number(row.suggestion_id),body:row.body,authorEmail:row.author_email||'',authorName:row.author_name||'',createdAt:row.created_at||'' }; }
function normalizePayload(raw={}) { return { title:String(raw.title||'').trim().slice(0,180),description:String(raw.description||'').trim(),category:String(raw.category||'General').trim().slice(0,80)||'General' }; }
function notifySuggestionFollowers(suggestion, siteCode, status, exceptEmail) { const rows=getDb().prepare(`SELECT author_email AS email FROM suggestions WHERE id=? AND site_code=? UNION SELECT user_email FROM suggestion_votes WHERE suggestion_id=? AND site_code=? UNION SELECT author_email FROM suggestion_comments WHERE suggestion_id=? AND site_code=?`).all(suggestion.id,siteCode,suggestion.id,siteCode,suggestion.id,siteCode); const except=String(exceptEmail).toLowerCase(); for(const row of rows){const email=String(row.email||'').toLowerCase();if(email&&email!==except) try{notifyUser({siteCode,email,kind:'suggestion.status',title:`Sugerencia: ${status}`,body:suggestion.title,link:`/sede/${siteCode}/suggestions`});}catch{/* noop */}} }
function actor(req) { return req.user?.nombre || req.user?.email || 'Usuario'; }
function forbidden(res) { return res.status(403).json({ ok:false,error:'No tenés permiso para ver sugerencias.' }); }
function notFound(res) { return res.status(404).json({ ok:false,error:'Sugerencia no encontrada.' }); }
