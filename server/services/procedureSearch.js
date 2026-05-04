import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import { config } from '../config.js';

const PROCEDURE_DIR = path.join(config.rootDir, 'data', 'procedimientos');
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.json', '.csv']);
const IGNORED_EXTENSIONS = new Set(['.png', '.mp4', '.webm']);

let index = null;

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function words(value) {
  return normalize(value).split(/[^a-z0-9]+/).filter(word => word.length > 2);
}

async function readProcedureFile(fullPath, ext) {
  if (TEXT_EXTENSIONS.has(ext)) return readFile(fullPath, 'utf8');
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: fullPath });
    return result.value || '';
  }
  return '';
}

async function buildIndex() {
  const status = {
    ok: true,
    directory: PROCEDURE_DIR,
    indexedFiles: 0,
    indexedFragments: 0,
    ignoredFiles: 0,
    supportedExtensions: ['.md', '.txt', '.csv', '.json', '.docx'],
    lastIndexedAt: new Date().toISOString()
  };
  const fragments = [];
  let files = [];
  try {
    files = await readdir(PROCEDURE_DIR);
  } catch {
    index = { fragments, status: { ...status, ok: false } };
    return index;
  }

  for (const file of files) {
    const fullPath = path.join(PROCEDURE_DIR, file);
    const entry = await stat(fullPath).catch(() => null);
    if (!entry?.isFile()) continue;
    const ext = path.extname(file).toLowerCase();
    if (IGNORED_EXTENSIONS.has(ext) || (!TEXT_EXTENSIONS.has(ext) && ext !== '.docx')) {
      status.ignoredFiles += 1;
      continue;
    }
    const content = (await readProcedureFile(fullPath, ext).catch(() => '')).trim();
    if (!content) continue;
    status.indexedFiles += 1;
    for (const paragraph of content.split(/\n\s*\n|(?<=\.)\s+(?=[A-ZÁÉÍÓÚÑ])/).map(part => part.trim()).filter(Boolean)) {
      fragments.push({ source: file, excerpt: paragraph.slice(0, 900), words: words(paragraph) });
    }
  }
  status.indexedFragments = fragments.length;
  index = { fragments, status };
  return index;
}

export async function reindexProcedures() {
  index = null;
  return buildIndex();
}

export async function procedureStatus() {
  const current = index || await buildIndex();
  return current.status;
}

export async function searchProcedures(query, limit = 4) {
  const queryWords = new Set(words(query));
  if (!queryWords.size) return [];
  const current = index || await buildIndex();
  const results = [];
  for (const fragment of current.fragments) {
    const score = fragment.words.reduce((sum, word) => sum + (queryWords.has(word) ? 1 : 0), 0);
    if (score > 0) results.push({ source: fragment.source, excerpt: fragment.excerpt, score });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit).map(({ source, excerpt }) => ({ source, excerpt }));
}
