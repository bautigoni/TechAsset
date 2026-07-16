import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { getDb, nowIso } from '../db.js';
import { canEditModule, canViewModule, requireSite } from '../services/siteContext.service.js';
import { notifySiteAdmins } from '../services/notifications.service.js';
import { rowToKnowledgeArticle, sanitizeKnowledgeHtml, searchKnowledgeArticles } from '../services/knowledge.service.js';

export const knowledgeRouter = Router();
const MIME_EXT = new Map([
  ['image/png','png'],['image/jpeg','jpg'],['image/webp','webp'],['application/pdf','pdf'],['text/plain','txt'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document','docx'],['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','xlsx']
]);

knowledgeRouter.get('/knowledge/articles', (req, res) => {
  const siteCode = requireSite(req);
  if (!canViewModule(req, 'knowledge', siteCode)) return forbidden(res);
  res.json({ ok: true, items: searchKnowledgeArticles(siteCode, String(req.query.q || ''), Number(req.query.limit || 50)) });
});

knowledgeRouter.get('/knowledge/articles/:id', (req, res) => {
  const siteCode = requireSite(req);
  if (!canViewModule(req, 'knowledge', siteCode)) return forbidden(res);
  const row = getDb().prepare('SELECT * FROM knowledge_articles WHERE id=? AND site_code=? AND active=1').get(req.params.id, siteCode);
  if (!row) return res.status(404).json({ ok: false, error: 'Artículo no encontrado.' });
  res.json({ ok: true, item: rowToKnowledgeArticle(row) });
});

knowledgeRouter.post('/knowledge/articles', (req, res) => {
  const siteCode = requireSite(req);
  if (!canEditModule(req, 'knowledge', siteCode)) return forbidden(res);
  const item = normalize(req.body);
  if (!item.title || !item.content) return res.status(400).json({ ok: false, error: 'Completá título y contenido.' });
  const ts = nowIso(); const user = req.user?.nombre || req.user?.email || '';
  const info = getDb().prepare('INSERT INTO knowledge_articles (site_code,title,content,category,tags_json,attachments_json,created_by,updated_by,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,1,?,?)').run(siteCode,item.title,item.content,item.category,JSON.stringify(item.tags),JSON.stringify(item.attachments),user,user,ts,ts);
  try { notifySiteAdmins({ siteCode, kind:'knowledge.created', title:`Nuevo artículo: ${item.title}`, body:`Creado por ${user}`, link:`/sede/${siteCode}/knowledge`, exceptEmail:req.user?.email }); } catch { /* noop */ }
  res.json({ ok:true, item:rowToKnowledgeArticle(getDb().prepare('SELECT * FROM knowledge_articles WHERE id=?').get(info.lastInsertRowid)) });
});

knowledgeRouter.patch('/knowledge/articles/:id', (req, res) => {
  const siteCode=requireSite(req); if(!canEditModule(req,'knowledge',siteCode)) return forbidden(res);
  const old=getDb().prepare('SELECT * FROM knowledge_articles WHERE id=? AND site_code=? AND active=1').get(req.params.id,siteCode); if(!old) return res.status(404).json({ok:false,error:'Artículo no encontrado.'});
  const item=normalize({...rowToKnowledgeArticle(old),...req.body}); const user=req.user?.nombre||req.user?.email||'';
  getDb().prepare('UPDATE knowledge_articles SET title=?,content=?,category=?,tags_json=?,attachments_json=?,updated_by=?,updated_at=? WHERE id=? AND site_code=?').run(item.title,item.content,item.category,JSON.stringify(item.tags),JSON.stringify(item.attachments),user,nowIso(),req.params.id,siteCode);
  res.json({ok:true,item:rowToKnowledgeArticle(getDb().prepare('SELECT * FROM knowledge_articles WHERE id=?').get(req.params.id))});
});

knowledgeRouter.delete('/knowledge/articles/:id',(req,res)=>{const siteCode=requireSite(req);if(!canEditModule(req,'knowledge',siteCode))return forbidden(res);const result=getDb().prepare('UPDATE knowledge_articles SET active=0,updated_by=?,updated_at=? WHERE id=? AND site_code=?').run(req.user?.nombre||req.user?.email||'',nowIso(),req.params.id,siteCode);res.json({ok:true,deleted:result.changes>0});});

knowledgeRouter.post('/knowledge/upload',(req,res)=>{const siteCode=requireSite(req);if(!canEditModule(req,'knowledge',siteCode))return forbidden(res);const mimeType=String(req.body?.mimeType||'').toLowerCase();const ext=MIME_EXT.get(mimeType);const raw=String(req.body?.base64||'').replace(/^data:[^;]+;base64,/,'');if(!ext||!raw)return res.status(400).json({ok:false,error:'Tipo de archivo no permitido.'});const buffer=Buffer.from(raw,'base64');if(!buffer.length||buffer.length>config.maxUploadMb*1024*1024)return res.status(400).json({ok:false,error:`El archivo supera ${config.maxUploadMb} MB.`});const dir=path.join(config.rootDir,'data','uploads','knowledge',siteCode);fs.mkdirSync(dir,{recursive:true});const stored=`${Date.now()}-${crypto.randomBytes(5).toString('hex')}.${ext}`;fs.writeFileSync(path.join(dir,stored),buffer);res.json({ok:true,attachment:{name:String(req.body?.name||stored).slice(0,180),url:`/uploads/knowledge/${siteCode}/${stored}`,mimeType}});});

function normalize(raw={}){return{title:String(raw.title||'').trim().slice(0,200),content:sanitizeKnowledgeHtml(raw.content),category:String(raw.category||'').trim().slice(0,100),tags:strings(raw.tags),attachments:Array.isArray(raw.attachments)?raw.attachments.filter(item=>item&&typeof item==='object').slice(0,20):[]};}
function strings(value){return[...new Set((Array.isArray(value)?value:String(value||'').split(',')).map(item=>String(item).trim()).filter(Boolean))].slice(0,30);}
function forbidden(res){return res.status(403).json({ok:false,error:'No tenés permiso para usar la base de conocimiento.'});}
