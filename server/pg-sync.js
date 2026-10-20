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
const RPC_TIMEOUT_MS = Math.max(5000, Number(process.env.PG_SYNC_TIMEOUT_MS || 30000));

// Tablas SIN columna `id` autonumérica: no se les puede pedir RETURNING id.
const NO_ID_TABLES = new Set([
  'local_devices', 'local_states', 'hidden_devices', 'app_settings',
  'classrooms', 'user_sessions', 'petty_cash_config', 'device_ai_summaries',
  'ai_usage_daily'
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

  let worker;
  const startWorker = () => {
    const next = new Worker(new URL('./pgworker.js', import.meta.url), {
      workerData: { connectionString, ctrlSab, dataSab }
    });
    next.on('error', (e) => { console.error('[pg-sync worker]', e); });
    return next;
  };
  const resetWorker = () => {
    try { void worker?.terminate(); } catch { /* noop */ }
    Atomics.store(ctrl, 0, 0);
    worker = startWorker();
  };
  worker = startWorker();

  function rpc(method, sql, params) {
    Atomics.store(ctrl, 0, 0);
    worker.postMessage({ method, sql, params });
    const deadline = Date.now() + RPC_TIMEOUT_MS;
    while (Atomics.load(ctrl, 0) === 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 0 || Atomics.wait(ctrl, 0, 0, remaining) === 'timed-out') {
        resetWorker();
        const error = new Error(`Postgres no respondió dentro de ${RPC_TIMEOUT_MS} ms; la conexión fue reiniciada.`);
        error.code = 'PG_SYNC_TIMEOUT';
        throw error;
      }
    }
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

  // Esquema en caché. `ensureColumn` (db.js) pregunta PRAGMA table_info por
  // cada columna que migra: ~150 consultas a information_schema en cada arranque,
  // ~22 ms cada una contra Supabase (ver docs/redesign/bench/produccion-diagnostico.md).
  // Ahora la primera pregunta trae TODAS las tablas del esquema en una sola
  // consulta y las siguientes salen de memoria. Toda DDL pasa por exec() o
  // run(): las tablas que toca quedan "sucias" y se releen solas (una consulta
  // por tabla, como antes). Solo mira los esquemas del search_path: antes una
  // tabla homónima de otro esquema (auth.users en Supabase) mezclaba columnas.
  const SCHEMA_COLUMNS = `
        SELECT c.table_name AS tbl, c.column_name AS name, c.ordinal_position AS cid,
               CASE WHEN c.is_nullable='NO' THEN 1 ELSE 0 END AS notnull,
               c.column_default AS dflt_value,
               CASE WHEN pk.column_name IS NOT NULL THEN 1 ELSE 0 END AS pk
        FROM information_schema.columns c
        LEFT JOIN (
          SELECT kcu.table_schema, kcu.table_name, kcu.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema AND tc.table_name = kcu.table_name
          WHERE tc.constraint_type='PRIMARY KEY'
        ) pk ON pk.table_schema = c.table_schema AND pk.table_name = c.table_name AND pk.column_name = c.column_name
        WHERE c.table_schema = ANY(current_schemas(false))`;
  let schema = null;        // Map<tabla, filas de table_info>
  const dirty = new Set();  // tablas tocadas por una DDL desde que se cargó el esquema

  function tableInfo(table) {
    const key = table.toLowerCase();
    if (!schema) {
      const next = new Map();
      for (const row of rpc('query', `${SCHEMA_COLUMNS} ORDER BY c.table_name, c.ordinal_position`).rows) {
        if (!next.has(row.tbl)) next.set(row.tbl, []);
        next.get(row.tbl).push(row);
      }
      schema = next;
      dirty.clear();
    }
    if (dirty.has(key) || !schema.has(key)) {
      schema.set(key, rpc('query', `${SCHEMA_COLUMNS} AND c.table_name = $1 ORDER BY c.ordinal_position`, [key]).rows);
      dirty.delete(key);
    }
    return schema.get(key).map(({ tbl, ...row }) => row);
  }

  const DDL_TABLE = /\b(CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE(\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE(?:\s+IF\s+EXISTS)?(?:\s+ONLY)?|DROP\s+TABLE(?:\s+IF\s+EXISTS)?|RENAME\s+TO)\s+["'`]?(\w+)/gi;
  function noteDdl(sql) {
    if (!schema) return;
    for (const [, , ifNotExists, name] of String(sql).matchAll(DDL_TABLE)) {
      const key = name.toLowerCase();
      // CREATE TABLE IF NOT EXISTS sobre una tabla que ya existe no cambia nada.
      if (ifNotExists && schema.has(key)) continue;
      dirty.add(key);
    }
  }

  function doPragma(str) {
    const s = String(str).trim().replace(/;$/, '');
    const m = /^(?:PRAGMA\s+)?table_info\(\s*["'`]?(\w+)["'`]?\s*\)/i.exec(s);
    if (m) return tableInfo(m[1]);
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
    const isDdl = /^\s*(?:CREATE|ALTER|DROP)\b/i.test(text);
    return {
      get: (...params) => rpc('query', text, buildParams(compiled, params)).rows[0],
      all: (...params) => rpc('query', text, buildParams(compiled, params)).rows,
      run: (...params) => {
        if (isDdl) noteDdl(text);
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
      noteDdl(s);
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
