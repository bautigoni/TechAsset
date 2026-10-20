# Protocolo de las pasadas de rendimiento

Manda `docs/redesign/DIRECTIVA-FINAL.md` §5, §6 y §13 (incluye el agregado del dueño con los 5 ejes y "medir antes y después de cada optimización"). Cada pasada trabaja sobre el resultado de la anterior.

## Medición

- **Suite**: `node perf/suite.mjs --repo=<checkout> --label=<etiqueta> --db=<snapshot>` (ver encabezado del script). Usar SIEMPRE el mismo snapshot de base (`docs/redesign/bench/snapshot.db` si existe; si no, crear uno la primera vez copiando `data/techasset.db` con el backup de SQLite y SEMBRÁNDOLE volumen realista: ≥ 300 equipos, ≥ 5.000 eventos de préstamo, ≥ 300 personas distintas con nombres repetidos y con/sin acentos, ≥ 500 tareas/tickets/movimientos de agenda; commitear el script de siembra, no la base si pesa mucho).
- **Comparaciones A/B**: alternar corridas de la versión anterior y la nueva (worktree de cada commit con junction de node_modules) con la máquina lo más quieta posible (no correr con otros agentes midiendo a la vez); n ≥ 7, mediana y p95.
- **Etiquetas**: `00-inicial` (main), `03-pre-pasada1` (HEAD al empezar), `04-pasada1`, `05-pasada2`, `06-pasada3`, `07-final`. Re-medir `00-inicial` en las mismas condiciones que las demás (el primero se tomó con otros agentes corriendo).
- **Producción (solo lectura)**: `docs/redesign/bench/produccion-diagnostico.md`. Si hace falta, más lecturas de `pg_stat_statements`/logs por SSH (`ssh -i /d/Descargas/oracle-bauhub.key -o IdentitiesOnly=yes ubuntu@168.75.68.75`), siempre con `default_transaction_read_only = on` y sin tocar el servicio.

## Los 5 ejes (en cada pasada)

1. Renders innecesarios (React Profiler en build de perfilado, conteo de commits por interacción y por tick de polling).
2. Bundle y lazy loading (tamaño por chunk, cobertura de código no usado al inicio, presupuesto de PLAN §7).
3. Requests y caching (pedidos por pantalla y por minuto de polling, duplicados, ETag/304, `apiGet`, prefetch).
4. Queries lentas y N+1 (queries por request con `bench-api.mjs`, EXPLAIN en SQLite y Postgres; ticks de background del server).
5. Imágenes, fuentes y scripts (formatos y tamaños, `font-display`, preload, orden de carga).

Más la **búsqueda rápida de personas** (DIRECTIVA §6): sugerencias < 200 ms desde el disparo efectivo tras 3 letras, sin congelar la UI, resultados viejos que no pisan nuevos, nombres/apellidos/combinaciones, sin distinción de mayúsculas/acentos, permisos de sede; probar pocos/muchos registros, parciales, repetidos y sin resultados.

## Regla de cada cambio

Hipótesis (con la medición que la motiva) → cambio → misma medición después → si no mejora o empeora otra métrica más de 5 %, se revierte. Registrar cada intento (también los revertidos) en `docs/redesign/bench/pasada<N>.md` con antes/después. Al final de la pasada: `npm run e2e` (con la sonda UX) en verde, `npm run check:ui`, pg-smoke en Postgres, y la suite completa con la etiqueta de la pasada.
