# Diagnóstico de producción (solo lectura) — 19/10/2026

Fuente: logs del servicio `techasset` en la VM (journalctl, últimos 7 días) y `pg_stat_statements` de la base de producción (Supabase, pooler de sesión `aws-1-sa-east-1.pooler.supabase.com:5432`), estadísticas acumuladas desde el 24/06/2026 (incluyen código anterior a PR #5). Conexión en modo `default_transaction_read_only = on`; no se escribió nada.

## Logs (7 días)

- **Archivos faltantes en disco**: los logos de las dos sedes (`data/uploads/site-logos/nfpt-d337d05a9b2534b8.webp`, `nfnd-d337d05a9b2534b8.webp`) y un adjunto de ticket de NFND (`uploads/tickets/NFND/1784214484904-aba4a96d-ticket.png`) están referenciados en la base pero no existen en la VM → cada carga que los pide genera un `ENOENT` en el log. Probablemente se perdieron en la migración a la VM (julio). Acción en la app: responder 404 limpio sin ensuciar el log y que el front caiga al logo por defecto; acción operativa (dueño): volver a subir los logos.
- Sin reinicios del servicio (`NRestarts=0`), sin errores de base ni de conexión ("conexión perdida" = 0 en 3 días).

## Queries con más tiempo total (top)

| Llamadas | Total (s) | Media (ms) | Query (resumida) | Lectura |
|---:|---:|---:|---|---|
| 20 145 | 439 | 21,8 | `information_schema.columns` (emulación de `PRAGMA table_info` en `server/pg-sync.js:143`) | La usan las migraciones `ensureColumn` al arrancar; ~150 por arranque × 22 ms ≈ 3 s de arranque. Verificar que no se llame en runtime; cachear el esquema por tabla en el arranque (1 query por tabla o 1 query total). |
| 639 198 | 223 | 0,35 | `pgbouncer.get_auth` | Autenticación del pooler por conexión; puede incluir otros clientes del proyecto. Revisar si la app abre conexiones de más (pgworker mantiene 1 Client). |
| 753 182 | 114 | 0,15 | sesión por token (`user_sessions JOIN users`) | Previo a la caché de sesión de PR #5 (30 s); confirmar que hoy bajó. |
| 270 | 110 | 407,9 | `pg_timezone_names` | No sale del código de la app (no hay referencias); probablemente el dashboard de Supabase o un cliente externo. Ignorar salvo que aparezca en la app. |
| 201 263 | 95 | 0,47 | notificaciones por `lower(user_email)` ORDER BY created_at | Endpoint polleado; índice por `lower(user_email), created_at` si no existe. |
| 327 545 ×3 | 66 + 62 + 44 | 0,1–0,2 | movimientos (task_history, local_movements, agenda_history) ORDER BY id DESC LIMIT | Feed de movimientos polleado; ya es UNION ALL desde PR #5; revisar frecuencia de polling y ETag. |
| 878 041 | 66 | 0,08 | `notification_outbox` pendientes | Worker de outbox cada pocos segundos; cada tick es un viaje sincrónico que frena el proceso: espaciar o hacerlo condicional. |
| 878 041 | 12 | 0,01 | `reminders` vencidos | Mismo patrón de tick: idem. |
| 753 066 | 62 | 0,08 | `UPDATE user_sessions SET last_seen_at` | Previo a PR #5 (ahora cada 5 min); confirmar. |
| 139 911 + 49 184 | 37 + 21 | 0,26–0,43 | `local_devices` payload por sede | Arma el inventario; caché por sede de 60 s. |
| 809 | 7,7 | 9,5 | `SELECT DISTINCT curso FROM loan_events` | Lento por query; índice o lista materializada de cursos. |
| 2 854 | 5,4 | 1,9 | sugerencias de persona en `loan_events` (`TRIM(persona)…`) | Es la búsqueda rápida de personas: candidata a índice / tabla de personas normalizada (ver DIRECTIVA §6). |

Conclusión: la base responde rápido (casi todo < 1 ms); el costo real en producción es la **cantidad de viajes sincrónicos** (cada uno bloquea el proceso con la latencia de red a Supabase, ~15 ms o más). Prioridades para la pasada 1: (1) ticks de background (outbox, recordatorios) y polling del front; (2) emulación de esquema al arrancar; (3) búsquedas de personas/cursos sobre `loan_events`; (4) 404 limpio para archivos faltantes.
