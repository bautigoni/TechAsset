import { getDb } from '../db.js';

export function searchKnowledgeArticles(siteCode, query = '', limit = 8) {
  const rows = getDb().prepare('SELECT * FROM knowledge_articles WHERE site_code=? AND active=1 ORDER BY updated_at DESC,id DESC').all(siteCode);
  const tokens = normalize(query).split(/\s+/).filter(token => token.length > 2);
  return rows
    .map(row => ({ item: rowToKnowledgeArticle(row), score: scoreArticle(row, tokens) }))
    .filter(entry => !tokens.length || entry.score > 0)
    .sort((a, b) => b.score - a.score || String(b.item.updatedAt).localeCompare(String(a.item.updatedAt)))
    .slice(0, Math.max(1, Math.min(20, Number(limit) || 8)))
    .map(entry => ({ ...entry.item, score: entry.score }));
}

export function rowToKnowledgeArticle(row) {
  return { id: Number(row.id), title: row.title, content: row.content || '', contentText: stripHtml(row.content || ''), category: row.category || '', tags: safeArray(row.tags_json), attachments: safeArray(row.attachments_json), createdBy: row.created_by || '', updatedBy: row.updated_by || '', createdAt: row.created_at || '', updatedAt: row.updated_at || '' };
}

export function sanitizeKnowledgeHtml(value) {
  let html = String(value || '').slice(0, 100000);
  html = html.replace(/<(script|style|iframe|object|embed|form)[^>]*>[\s\S]*?<\/\1>/gi, '');
  html = html.replace(/<(script|style|iframe|object|embed|form)[^>]*\/?>/gi, '');
  html = html.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  html = html.replace(/\s(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, '');
  return html.trim();
}

function scoreArticle(row, tokens) {
  if (!tokens.length) return 1;
  const title = normalize(row.title); const category = normalize(row.category); const tags = normalize(row.tags_json); const content = normalize(stripHtml(row.content));
  return tokens.reduce((score, token) => score + (title.includes(token) ? 12 : 0) + (tags.includes(token) ? 8 : 0) + (category.includes(token) ? 5 : 0) + (content.includes(token) ? 2 : 0), 0);
}
function normalize(value) { return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function stripHtml(value) { return String(value || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim(); }
function safeArray(value) { try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
