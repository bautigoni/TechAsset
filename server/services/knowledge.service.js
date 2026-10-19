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

/**
 * Listado paginado para la pantalla de Conocimiento. searchKnowledgeArticles
 * (arriba) es para el asistente: corta en 20 y descarta palabras cortas.
 *
 * - Sin búsqueda: orden por actualización, paginado en SQL (una sola query: el
 *   total viaja con COUNT(*) OVER()).
 * - Con búsqueda: sin acentos ni mayúsculas, cada palabra tiene que aparecer en
 *   título, categoría, etiquetas o texto (igual que el filtro que hacía el front);
 *   ordena por relevancia y después por actualización.
 *
 * El cursor es el offset (string) del próximo bloque; '' cuando no hay más.
 */
export function listKnowledgeArticles(siteCode, { q = '', limit = 50, cursor = '' } = {}) {
  const size = Math.max(1, Math.min(200, Math.floor(Number(limit)) || 50));
  const offset = Math.max(0, Math.floor(Number(cursor)) || 0);
  const tokens = normalize(q).split(/\s+/).filter(Boolean).slice(0, 12);
  if (!tokens.length) {
    const rows = getDb().prepare('SELECT *, COUNT(*) OVER() AS total_count FROM knowledge_articles WHERE site_code=? AND active=1 ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?').all(siteCode, size, offset);
    // Pasado el final no vuelven filas (ni el total): se cuenta aparte, caso raro.
    const total = rows.length
      ? Number(rows[0].total_count || 0)
      : Number(getDb().prepare('SELECT COUNT(*) AS total FROM knowledge_articles WHERE site_code=? AND active=1').get(siteCode)?.total || 0);
    return { items: rows.map(rowToKnowledgeArticle), total, nextCursor: offset + rows.length < total ? String(offset + rows.length) : '' };
  }
  const matches = getDb().prepare('SELECT * FROM knowledge_articles WHERE site_code=? AND active=1 ORDER BY updated_at DESC, id DESC').all(siteCode)
    .map(row => {
      const haystack = normalize(`${row.title || ''} ${row.category || ''} ${safeArray(row.tags_json).join(' ')} ${stripHtml(row.content || '')}`);
      return { row, matches: tokens.every(token => haystack.includes(token)), score: scoreArticle(row, tokens) };
    })
    .filter(entry => entry.matches)
    .sort((a, b) => b.score - a.score || String(b.row.updated_at || '').localeCompare(String(a.row.updated_at || '')) || Number(b.row.id) - Number(a.row.id));
  const page = matches.slice(offset, offset + size);
  return {
    items: page.map(entry => rowToKnowledgeArticle(entry.row)),
    total: matches.length,
    nextCursor: offset + page.length < matches.length ? String(offset + page.length) : ''
  };
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
