# Banco de pruebas de rendimiento

Dos herramientas, las dos sobre **copias descartables** de `data/techasset.db` (nunca la base real ni Postgres).

## API: queries y latencia

```bash
npx -p node@22 node server/scripts/bench/bench-api.mjs 15 5
```

Levanta el server real con `latency-preload.mjs`, que cuenta cada query y le suma una demora sincrónica (15 ms en el ejemplo). Simula producción, donde `pg-sync` bloquea el proceso en cada viaje a Supabase. Mide queries, tiempo y tamaño por endpoint, el "arranque" (los 13 pedidos que hace la app al abrir, 6 en paralelo), y verifica que prestar/devolver se vea al instante pese a las cachés.

## Frontend: arranque, pantallas y scroll

```bash
npx -p node@22 node server/scripts/bench/record-api.mjs perf/.out/perf-fixtures.json
npx vite build --config perf/vite.config.ts --outDir perf/.out/dist
PERF_FIXTURES=perf/.out/perf-fixtures.json node perf/run.mjs perf/.out/dist 4 5
```

`perf/harness.tsx` es la app real compilada en producción, con `fetch` respondiendo desde las respuestas grabadas. `perf/run.mjs` la abre en Edge/Chrome headless con la CPU 4× más lenta (≈ notebook escolar o celular de gama media) y mide:

- arranque en frío (DCL, FCP, app lista, tareas largas);
- abrir cada pantalla del menú por primera vez y de nuevo;
- scroll de las pantallas largas (frames y tareas largas);
- desglose del hilo principal (script, estilos, layout, pintado) con un trace.

Con `PERF_PROFILE=1` (y el build con `PERF_NO_MINIFY=1`) agrega las funciones con más tiempo propio de CPU.

`perf/.out/` tiene datos reales de la base local: no se commitea.

## Postgres real

```bash
docker run -d --rm --name techasset-pgtest -e POSTGRES_PASSWORD=pgtest -e POSTGRES_DB=techasset -p 127.0.0.1:55432:5432 postgres:17-alpine
PG_TEST_URL="postgresql://postgres:pgtest@127.0.0.1:55432/techasset?sslmode=disable" node server/scripts/bench/pg-smoke.mjs
```

Levanta el server en modo Postgres contra ese contenedor y recorre los endpoints (préstamos sueltos y en lote, historial paginado, papelera, agenda, tareas, cierre del día, login). Atrapa SQL que SQLite acepta y Postgres no. Se niega a correr contra Supabase: nunca apuntarlo a producción.
