# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandos

```bash
npm install          # primera vez
npm run db:init      # crea/seedea SQLite (data/techasset.db)
npm run dev          # backend (8000) + Vite (5173) en paralelo
npm run server       # solo backend
npm run build        # tsc -b && vite build (verificación principal antes de mergear)
npm run start        # producción local (sirve dist/ desde Express en 8000)
npm run preview      # vite preview de dist/
```

`npm run build` debe pasar antes de cerrar cualquier cambio. No hay tests configurados.

Engine fijado: **Node 22** (`engines.node: ">=22 <23"`). El Dockerfile usa `node:22-bookworm-slim` (no Alpine — `better-sqlite3` necesita glibc).

## Arquitectura — SQLite-first

La regla más importante de este repo: **SQLite es la fuente de verdad**. Google Sheets / CSV publicado se usan **solo para importación manual** de inventario, nunca para sincronización viva. Prestar/devolver no escribe en planillas. Si Google falla, la app sigue funcionando.

- Frontend: React 19 + Vite 6 + TypeScript en `src/`.
- Backend: Express en `server/`, base `better-sqlite3` en `data/techasset.db`.
- En producción Express sirve `dist/` y la API en el mismo `:8000`. En desarrollo Vite proxea `/api/*` y `/sheet.csv` al backend (ver `vite.config.ts`).
- Volumen persistente: `./data/` (db, cache CSV, `tmp/`, uploads).

## Multi-sede

Todo dato operativo (dispositivos, préstamos, tareas, agenda, aulas, inventario maker, etc.) está particionado por `site_code` (ej. `NFPT`, `NFND`). **NFPT y NFND nunca cruzan datos.** Identidad de dispositivo: `site_code + etiqueta`.

- Sede activa del usuario: cookie de sesión + `siteContext.service.js`. Helpers `requireSite(req)`, `isSuperadmin(req.user)`, `isSiteManager(req, siteCode)`.
- Componentes que dependen de la sede leen `activeSite` desde props (ej. `ClassroomStatusPage` muestra el plano real solo en `NFPT` y un placeholder "Próximamente" en `NFND`).
- Roles: `Superadmin` (toda la app) > `Jefe TIC` (su sede) > asistentes y consulta. Tabla `allowed_users` + `allowed_user_sites` define el acceso. Estado de un usuario: `Pendiente | Activo | Rechazado | Inactivo`. Borrado de usuarios = soft delete (`activo=0`, `deleted_at`, `deleted_by`); no se borra historial.

## Auth y mails

- Login por mail autorizado (sin password); registro queda en estado `Pendiente`.
- `server/routes/auth.routes.js`:
  - `POST /api/auth/register` → crea `allowed_users` con `Pendiente`, dispara `notifyRegistration` (no bloqueante).
  - `POST /api/auth/login` → rechaza pendientes/rechazados/inactivos con mensajes específicos.
- `server/routes/sites.routes.js` `POST /api/allowed-users/:id/:action` (`approve|reject|deactivate|delete`) dispara `notifyAllowedUserAction`.
- Mail bot: `server/services/mail.service.js` (`sendMail`) + plantillas card-style en `server/services/mailTemplates.js` (`buildRegistrationUserMail`, `buildRegistrationAdminMail`, `buildUserApprovedMail`, `buildUserRejectedMail`, `buildUserDeactivatedMail`).
- Variables `.env` que controlan envíos:
  - `APP_BASE_URL` (fallback `http://127.0.0.1:8000`) — usado para el botón "Revisar solicitud" → `{APP_BASE_URL}/sede/{site_code}/configuracion/usuarios`.
  - `SUPERADMIN_EMAILS` (CSV).
  - `SMTP_*`, `MAIL_FROM`, `MODO_PRUEBA`. Si `MODO_PRUEBA=true` se loguea en consola pero **no se envía**. Si SMTP está incompleto o falla, el flujo (registro/aprobación) **no se rompe**.
- Settings de mail también editables vía UI (`PATCH /api/settings/mail`) y persisten en SQLite (`app_settings` table) sobreescribiendo los valores de `.env`.

## Dispositivos / inventario

- `server/services/deviceInventory.service.js` mergea: padrón estático del CSV (`data/cache_sheet.csv`) + estado vivo de SQLite (`local_states` / `local_devices`). Tiene caché en memoria con TTL (`SHEET_CACHE_TTL_MS`, default 5 s) y stale-while-revalidate.
- Bug histórico a no repetir: si el fetch externo fallaba, la caché en memoria quedaba congelada. Ahora el fallback a `buildFromLocalCsvCache` actualiza `inventoryCache`. No volver a romper ese fix.
- Merge de estado (`mergeStateOverrides`): cuando la planilla dice `Prestado | No encontrada | Fuera de servicio` y `local_states` dice `Disponible | Devuelto | vacío`, **gana la planilla** salvo que el local tenga `updated_at` con menos de 90 segundos (ventana para tolerar sync en curso). Esto evita que filas viejas de `local_states` pisen ediciones manuales en la hoja.
- Importación CSV: Borrar dispositivo = ocultar (`activo=0`, `deleted_at`). Reimportar el mismo `site_code+etiqueta` lo reactiva (`activo=1`, `deleted_at=NULL`). No hay blacklist permanente.
- Alias operativo: `Filtro + Numero Operativo` (ej. `Touch 34`). Función central `getOperationalAlias` en `src/utils/classifyDevice.ts`. Se autonumeran los `PLANI` que no tengan número (estable por etiqueta) en `withOperationalAliases` desde `useDevices`.
- Búsqueda flexible (`src/utils/normalizeSearch.ts`): debe encontrar `touch 34`, `touch34`, `34touch`, `D1436`, `plani 5`, `planificación 5`, etc. — usa `normalizeAlias`, `flexibleDeviceKey`, `parseOperationalAlias`. Si tocás esto, mantener todos los formatos.
- Tabla en `data/techasset.db`. Endpoint `POST /api/devices/sync-from-sheet` borra entradas triviales (`Disponible/Devuelto/vacío`) de `local_states` para forzar a la planilla como fuente; útil cuando se acumulan restos de pruebas.

## Estado de aulas (planos)

`src/components/classrooms/`:
- `ClassroomStatusPage.tsx` orquesta selector de pisos + modal de aula (`ClassroomInfoPanel`). Filtra por sede activa: NFPT muestra los modelos reales, NFND muestra placeholder "Próximamente".
- Modelos SVG en `models/`: `PrimerPisoModel.jsx` (planta baja real), `FloorMapPrimerPiso.jsx` (1er piso real, exporta `default` + `ROOMS`), `SecondFloorModel` (2do piso). `PrimerPisoModel.jsx` es el barrel que expone `PrimerPisoModel`, `FirstFloorModel`, `SecondFloorModel` y `ALL_FLOOR_ROOMS`.
- Convención de IDs por piso para que no colisionen entre plantas: `room_*` (planta baja), `pp_*` (1er piso), `p2_*` (2do piso).
- Equipamiento por aula es array dinámico (`equipment_json` en `classrooms`). Estados válidos: `OK | Con falla | No tiene | En reparación | Sin revisar`. `'No encontrado'` está deprecado; al leer se migra a `'Con falla'` (`migrateLegacyClassroomData` corre una vez al startup).
- Modal usa el wrapper `.modal` global (centrado, scroll interno, bloquea scroll de fondo con `body.modal-open`, cierra con backdrop / X / Escape).

## Tareas TIC

- Tabla `tasks` con columnas extra: `responsables_json` (array `["Bauti","Equi"]`), `turno`. `responsable` (string) se mantiene por compatibilidad: `"Ambos"` cuando hay dos. Asignar a ambos asistentes guarda en ambos.
- Subtareas: tabla `task_items`, endpoints `GET/POST/PATCH/DELETE /api/tasks/:id/items`. Cada cambio queda en `task_history`.
- Edición de tareas: `TaskModal` se abre tanto para crear como para editar (recibe `initial`).
- Notas internas tipo chat / Traspaso TIC: `internal_notes` table + `/api/internal-notes` CRUD. Renderizado en la tab "Traspaso TIC" dentro de `TasksPage`.

## Próxima agenda

`GET /api/agenda/upcoming` calcula correctamente: actividad en curso (Entregado/Pendiente y horario actual entre `desde`/`hasta`), si no la próxima del día, si no la próxima de la semana. Cancelado/Realizado nunca aparecen como próxima.

## Loans (préstamos)

- `LoanForm.tsx` soporta escaneo continuo: toggle abre tabla de equipos escaneados, agrega por scanner USB (Enter) o manual, marca duplicados / no disponibles, y un único form de persona/rol/ubicación/motivo aplica al lote.
- `POST /api/loans/lend` y `/return` actualizan SQLite y registran en `local_movements`. **No** hacen llamadas externas a Apps Script. Si alguien introduce esa dependencia de nuevo, romper la review.

## Cierre del día

`/api/daily-closures` (GET/POST + `/preview/today`) genera un resumen automático: préstamos activos, tareas pendientes/en proceso/hechas hoy, agenda del día y sus incidencias, aulas con problema, notas importantes. El operador agrega observaciones desde `DailyClosureModal` y se persiste en `daily_closures`.

## Accesos rápidos

`quick_links` table + `/api/quick-links` CRUD. Validación de URL: solo `http(s)://`, rechaza `javascript:`, `data:`, `vbscript:`. La tabla incluye links institucionales fijos + ediciones desde la UI. Archivos `.bat` administrativos viven en `public/downloads/` y se sirven como descarga (no se ejecutan desde la web).

## Generador de tarjetas (Glifing / Santillana)

`server/routes/tools.routes.js` genera HTML imprimible (A4, ~8 tarjetas/página, 2×4) con templates embebidos como data URL para que la imagen aparezca al imprimir. Templates en `public/templates/` (`glifing-template.png`, `template_santillana.jpeg`). `print-color-adjust: exact` en `html, body` para que el background salga en print.

## Deployment

- `Dockerfile` (Node 22 Debian, instala `python3 make g++` para compilar `better-sqlite3`).
- `docker-compose.yml` no expone puertos al host: el ingreso pasa por Caddy (u otro reverse proxy) que comparte la red `proxy-network` (driver bridge). El servicio interno escucha `:8000`. Caddy debe declarar la red como `external: true` y proxear `reverse_proxy techasset:8000`.
- Volumen `./data:/app/data` obligatorio para persistir SQLite, cache CSV y temp.

## Convenciones

- Mantener tema oscuro, sidebar/topbar/cards/responsive existentes. No refactor destructivo.
- Migraciones SQLite idempotentes en `server/db.js` (`ensureColumn`, `CREATE TABLE IF NOT EXISTS`). Datos legacy: traducir, no borrar (ej. `'No encontrado' → 'Con falla'`, `piso='Primer piso' → 'Planta baja'`).
- Cualquier feature operativa nueva debe respetar `consultationMode` (vista jefe = bloquea ediciones).
- En español rioplatense (`vos`, `acordate`). Encoding UTF-8 — vigilar mojibake `Ã©`/`prÃ³xima` en CSVs y mails.
- Logs: `[devices/perf]` está silenciado salvo que `DEBUG_DEVICE_PERF=1`. No volver a llenar la consola por default.
