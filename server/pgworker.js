// Worker thread: ejecuta las queries Postgres de forma asíncrona y le devuelve
// el resultado al hilo principal por SharedArrayBuffer (que el main lee de forma
// síncrona con Atomics.wait). Mantiene UN solo Client para preservar transacciones.
import { parentPort, workerData } from 'node:worker_threads';
import pg from 'pg';

// BIGINT (oid 20) y NUMERIC (1700) -> Number, para igualar el comportamiento de
// better-sqlite3 (ids como números, no strings). Los ids caben en 53 bits.
pg.types.setTypeParser(20, v => (v === null ? null : parseInt(v, 10)));
pg.types.setTypeParser(1700, v => (v === null ? null : parseFloat(v)));

const { connectionString, ctrlSab, dataSab } = workerData;
const ctrl = new Int32Array(ctrlSab); // [0]=status (0 idle,1 ok,2 error), [1]=byteLength
const data = new Uint8Array(dataSab);
const enc = new TextEncoder();

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
const ready = client.connect();

function respond(status, payloadObj) {
  let bytes = enc.encode(JSON.stringify(payloadObj));
  if (bytes.length > data.length) {
    bytes = enc.encode(JSON.stringify({ message: 'Resultado demasiado grande para el buffer compartido' }));
    status = 2;
  }
  data.set(bytes);
  Atomics.store(ctrl, 1, bytes.length);
  Atomics.store(ctrl, 0, status);
  Atomics.notify(ctrl, 0);
}

parentPort.on('message', async (req) => {
  try {
    await ready;
    if (req.method === 'exec') {
      await client.query(req.sql);
      respond(1, { rows: [], rowCount: 0 });
    } else {
      const res = await client.query(req.sql, req.params || []);
      respond(1, { rows: res.rows, rowCount: res.rowCount });
    }
  } catch (e) {
    respond(2, { message: e.message, code: e.code });
  }
});
