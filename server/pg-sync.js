// Adaptador SÍNCRONO sobre Postgres con la misma API que better-sqlite3
// (prepare().get/all/run, exec, pragma, transaction). Permite migrar la app a
// Supabase sin reescribir los 23 archivos de rutas: solo cambia el motor.
//
// Cómo logra ser síncrono: un worker thread corre las queries async contra PG y
// el hilo principal se bloquea con Atomics.wait hasta que el worker deja el
// resultado en un SharedArrayBuffer. La app es de baja concurrencia (equipo TIC
// de un colegio), así que serializar queries es perfectamente aceptable.
import { Worker } from 'node:worker_threads';

const CTRL_BYTES = 8;                 // Int32Array[2]
const DATA_BYTES = 16 * 1024 * 1024;  // 16MB para el payload de resultados

// Tablas SIN columna `id` autonumérica: no se les puede pedir RETURNING id.
const NO_ID_TABLES = new Set([
  'local_devices', 'local_states', 'hidden_devices', 'app_settings',
  'classrooms', 'user_sessions', 'petty_cash_config', 'device_ai_summaries'
]);

function translateDialect(sql) {
  let s = sql;
  // datetime('now','-30 days') -> (now() - interval '30 days')
  s = s.replace(/datetime\(\s*'now'\s*,\s*'([+-]?\d+)\s+(\w+?)s?'\s*\)/gi, (_, num, unit) => {
    const n = parseInt(num, 10);
    return `(now() ${n < 0 ? '-' : '+'} interval '${Math.abs(n)} ${unit.toLowerCase()}')`;
  });
  s = s.replace(/datetime\(\s*'now'\s*\)/gi, 'now()');
  // Postgres pasa los alias sin comillas a minúsculas (rompe `AS siteCode`, que
  // SQLite preserva). Citamos solo los alias camelCase (tienen mayúscula y
  // minúscula) para preservar el case; no toca tipos de CAST (INTEGER, TEXT...).
  s = s.replace(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)/g, (m, id) =>
    (/[a-z]/.test(id) && /[A-Z]/.test(id)) ? `AS "${id}"` : m);
  return s;
}

// Compila el SQL estilo better-sqlite3 a Postgres: reemplaza placeholders ?
// (posicionales) y @nombre / :nombre (nombrados) por $1,$2..., respetando los
// literales entre comillas simples. Devuelve el orden de parámetros para poder
// armar el array de valores desde varargs (posicional) o desde un objeto (nombrado).
function compileSql(rawSql) {
  const sql = translateDialect(rawSql);
  let out = '';
  let n = 1;
  let inStr = false;
  const order = []; // cada item: {pos:true} o {named:'campo'}
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inStr) {
      out += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") { out += "'"; i++; } else { inStr = false; }
      }
      continue;
    }
    if (ch === "'") { inStr = true; out += ch; continue; }
    if (ch === '?') { out += '$' + (n++); order.push({ pos: true }); continue; }
    if (ch === '@' || (ch === ':' && sql[i - 1] !== ':' && /[a-zA-Z_]/.test(sql[i + 1] || ''))) {
      const m = /^[@:]([a-zA-Z_][a-zA-Z0-9_]*)/.exec(sql.slice(i));
      if (m) { out += '$' + (n++); order.push({ named: m[1] }); i += m[0].length - 1; continue; }
    }
    out += ch;
  }
  return { text: out, order, isNamed: order.some(o => o.named) };
}

function coerce(v) {
  return typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v;
}

function buildParams(compiled, args) {
  if (compiled.isNamed) {
    const obj = args[0] || {};
    return compiled.order.map(o => coerce(obj[o.named]));
  }
  return args.map(coerce);
}

function tableOfInsert(sql) {
  const m = /^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+["'`]?(\w+)/i.exec(sql);
  return m ? m[1].toLowerCase() : null;
}

export function createPgSync(connectionString) {
  const ctrlSab = new SharedArrayBuffer(CTRL_BYTES);
  const dataSab = new SharedArrayBuffer(DATA_BYTES);
  const ctrl = new Int32Array(ctrlSab);
  const data = new Uint8Array(dataSab);
  const dec = new TextDecoder();

  const worker = new Worker(new URL('./pgworker.js', import.meta.url), {
    workerData: { connectionString, ctrlSab, dataSab }
  });
  worker.on('error', (e) => { console.error('[pg-sync worker]', e); });

  function rpc(method, sql, params) {
    Atomics.store(ctrl, 0, 0);
    worker.postMessage({ method, sql, params });
    while (Atomics.load(ctrl, 0) === 0) Atomics.wait(ctrl, 0, 0);
    const status = Atomics.load(ctrl, 0);
    const len = Atomics.load(ctrl, 1);
    const payload = JSON.parse(dec.decode(data.subarray(0, len)));
    Atomics.store(ctrl, 0, 0);
    if (status === 2) {
      const err = new Error(payload.message || 'Error Postgres');
      err.code = payload.code;
      throw err;
    }
    return payload; // { rows, rowCount }
  }

  const returningCache = new Map();

  function doPragma(str) {
    const s = String(str).trim().replace(/;$/, '');
    const m = /^(?:PRAGMA\s+)?table_info\(\s*["'`]?(\w+)["'`]?\s*\)/i.exec(s);
    if (m) {
      return rpc('query', `
        SELECT c.column_name AS name, c.ordinal_position AS cid,
               CASE WHEN c.is_nullable='NO' THEN 1 ELSE 0 END AS notnull,
               c.column_default AS dflt_value,
               CASE WHEN pk.column_name IS NOT NULL THEN 1 ELSE 0 END AS pk
        FROM information_schema.columns c
        LEFT JOIN (
          SELECT kcu.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
          WHERE tc.constraint_type='PRIMARY KEY' AND tc.table_name = $1
        ) pk ON pk.column_name = c.column_name
        WHERE c.table_name = $1
        ORDER BY c.ordinal_position`, [m[1]]).rows;
    }
    return []; // journal_mode, foreign_keys, index_list, index_info -> no aplican en PG
  }

  function makeStatement(rawSql) {
    if (/^\s*PRAGMA\s+/i.test(rawSql)) {
      const arg = rawSql.trim().replace(/^PRAGMA\s+/i, '');
      const rows = () => doPragma(arg);
      return { all: rows, get: () => rows()[0], run: () => ({ changes: 0, lastInsertRowid: undefined }) };
    }
    const compiled = compileSql(rawSql);
    const text = compiled.text;
    const insertTable = tableOfInsert(text);
    const canReturn = insertTable && !NO_ID_TABLES.has(insertTable) && !/\bRETURNING\b/i.test(text);
    return {
      get: (...params) => rpc('query', text, buildParams(compiled, params)).rows[0],
      all: (...params) => rpc('query', text, buildParams(compiled, params)).rows,
      run: (...params) => {
        const p = buildParams(compiled, params);
        if (canReturn && returningCache.get(text) !== false) {
          try {
            const r = rpc('query', text + ' RETURNING id', p);
            returningCache.set(text, true);
            return { changes: r.rowCount, lastInsertRowid: r.rows[0] ? r.rows[0].id : undefined };
          } catch (e) {
            if (e.code === '42703') returningCache.set(text, false); // sin columna id
            else throw e;
          }
        }
        const r = rpc('query', text, p);
        return { changes: r.rowCount, lastInsertRowid: undefined };
      }
    };
  }

  return {
    isPg: true,
    prepare(sql) { return makeStatement(sql); },
    exec(sql) {
      let s = translateDialect(sql);
      s = s.replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, 'BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY');
      s = s.replace(/\bAUTOINCREMENT\b/gi, '');
      s = s.replace(/ALTER\s+TABLE\s+(\S+)\s+ADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)/gi, 'ALTER TABLE $1 ADD COLUMN IF NOT EXISTS ');
      rpc('exec', s);
    },
    pragma(str) { return doPragma(str); },
    transaction(fn) {
      return (...args) => {
        rpc('query', 'BEGIN');
        try {
          const result = fn(...args);
          rpc('query', 'COMMIT');
          return result;
        } catch (e) {
          try { rpc('query', 'ROLLBACK'); } catch { /* ignore */ }
          throw e;
        }
      };
    },
    close() { worker.terminate(); }
  };
}
