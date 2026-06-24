# Plan: correcciones TechAsset + features nuevas

> Documento de planificación. Estado base: commit `3578808`.  
> Generado a partir de las correcciones pedidas en `TECHASSET.pdf` y de los commits recientes del proyecto.

---

## Resumen ejecutivo

Ocho puntos del PDF (correcciones de UX/bugs) + un sistema de notificaciones nuevo (in-app + mail + broadcast de release). Todo respetando multi-sede (`site_code`), `consultationMode`, la estética oscura actual y SQLite como fuente de verdad.

**Estado actual del repo** (commit `3578808`):
- No hay `manifest.json` ni service worker → hace falta PWA desde cero.
- No hay tablas de `notifications` ni `push_subscriptions` en `db.js`.
- `modules.enabled` ya existe en `site_settings` (toggleable por sede funciona).
- `tickets.routes.js` ya guarda `numero` + arma link con `tickets.invgateUrl` (configurable, default `tikno.sd.cloud.invgate.net`).
- `AnalyticsPage.tsx` y `TicketsPage.tsx` están en `src/components/{analytics,tickets}/`.
- `TasksPage` → `TaskModal.tsx` arma `assignOptions` con un único `"name1,name2"` cuando hay >1; falta el caso "asignar solo a los dos asistentes sin incluir al jefe".
- `.env.example` tiene `HANDING_TICKET_URL=https://northfield-puertos.handing.co/...` que debe migrar a `techasset.bauhub.online` (PDF punto 3).

---

## Lista de TODOs

### A. Tickets / InVgate (PDF #1 y #2)

- [ ] **A1.** En `TicketsPage.tsx`, agregar placeholder y mensaje helper al input `Número de ticket`: texto visible "Solo el número, sin `#` — ej. `2103`" y validación que strippee `#` si lo llega a tener, normalizando a dígitos antes de armar el link.
- [ ] **A2.** Cambiar el `DEFAULT_INVGATE` y el de settings (key `tickets.invgateUrl`) al nuevo `techasset.bauhub.online/requests/show/index/id/` (reemplaza también el `tikno.sd.cloud.invgate.net` y `handingTicketUrl` viejo del `.env.example` y `mailTemplates.js`).
- [ ] **A3.** En `TicketsPage.tsx`, agregar input de búsqueda al lado del filtro por estado: filtra por `numero`, `titulo`, `descripcion`, `categoria`, `responsables` y `creadoPor`. Debajo del filtro, una barra de chips con los estados (estilo bento/pill) + un contador de resultados.
- [ ] **A4.** Reemplazar el `iframe` gigante del PDF por un preview **inline más compacto**: thumbnail + "Ver PDF" como link. Usar `<embed>` o `<object>` solo cuando el usuario hace click "Expandir" (modal con scroll). Mantener la imagen clickeable para no-imágenes.
- [ ] **A5.** Estilo: rehacer la card de ticket con header limpio (badge estado, link `#numero` en azul destacado), acciones agrupadas abajo, miniaturas pequeñas (`max-width: 120px`, `border-radius: 10px`).
- [ ] **A6.** Migrar cualquier referencia restante a `handing.co` o `work.gd` (buscar con `Grep`) → `techasset.bauhub.online`.

### B. Analítica — Bento box (PDF #4)

- [ ] **B1.** En `AnalyticsPage.tsx`, rediseñar layout como **bento grid**: CSS grid `grid-template-areas` o `grid-auto-flow: dense` con tarjetas de distintos tamaños:
  - Fila 1: 2 KPI grandes (Préstamos período / Devoluciones período) — span 2 columnas.
  - Fila 2: 1 chart ancho (Préstamos en el tiempo) — span full width.
  - Fila 3: 2×2 mix de: Personas que más piden, Préstamos por tipo, Ubicaciones, Roles — 1 chart mediano cada uno.
  - Fila 4: Motivos + Cursos en cards 1×1 chicas.
- [ ] **B2.** Tarjetas: bordes redondeados (`14px`), padding interno generoso (`20px`), `gap: 14px`, sombras suaves, separadores sutiles entre celdas, paleta consistente con el tema oscuro existente.
- [ ] **B3.** Refactorizar `ChartCard` (`src/components/analytics/ChartCard.tsx`) para soportar `size: 'sm' | 'md' | 'lg' | 'wide'` que mapee a spans del grid.
- [ ] **B4.** Quitar las `StatCard` redundantes del bloque KPI (las del PDF se quejan de "horrendo"), reemplazarlas por cards bento con icono + label + valor grande + delta opcional.

### C. Tareas — asignación flexible (PDF #5)

- [ ] **C1.** En `TaskModal.tsx`, reemplazar el `<select>` único por un **selector con chips multi-select**:
  - Lista de asistentes del sitio (`getSiteAssistants`) + rol activo del usuario.
  - Cada chip clickeable, marcar/desmarcar.
  - Si hay 2+ seleccionados, mostrar chip resumen `"X e Y"` con `responsables_json = ["X","Y"]`.
  - El operador actual puede asignarse a sí mismo o no según toggle.
- [ ] **C2.** Reglas de visibilidad:
  - Si el usuario logueado es **Jefe TIC / Superadmin**, ve a los dos asistentes + a sí mismo, y puede elegir combinación libre (incluyendo "solo los dos asistentes").
  - Si es **Asistente**, ve solo al jefe + al otro asistente + a sí mismo.
  - Si es **Consulta**, el modal sigue bloqueado por `consultationMode`.
- [ ] **C3.** Persistir como `responsables_json` (array). Si el JSON tiene >1, `responsable` legacy queda como `"Ambos"`. Backend en `tasks.routes.js` ya soporta esto (`normalizeTaskPayload`), no tocar.

### D. Configuración de sede — toggles lindos (PDF #6)

- [ ] **D1.** Refactorizar `ModulesPanel.tsx` (en `src/components/settings/`) a un grid de tarjetas toggleables estilo iOS Settings:
  - Cada módulo en una card con icono (lucide-react ya está como dep), título, descripción corta ("Tickets de InVgate cargados desde la app"), switch a la derecha.
  - Agrupar por categoría: **Operación** (Dispositivos, Préstamos, Inventario), **Análisis** (Analítica), **Planificación** (Agenda, Tareas), **Aulas y soporte** (Estado aulas, Tickets, Herramientas), **Comunicaciones** (Accesos rápidos).
- [ ] **D2.** Estilo: switches custom CSS (palillo + bolita, colores del tema), orden de cards alfabético dentro de cada categoría.
- [ ] **D3.** Agregar confirmación visual tipo toast al guardar (reemplazar el "Guardado ✓" actual por un toast).

### E. PWA + install prompt (PDF #7)

- [ ] **E1.** Crear `public/manifest.webmanifest` con:
  - `name`: "TechAsset", `short_name`: "TechAsset".
  - `start_url`: `/`, `display`: `standalone`, `theme_color` y `background_color` del tema oscuro.
  - Iconos `192x192` y `512x512` (PNG, usar `/favicon.png` actual si no hay otros).
- [ ] **E2.** En `index.html`, agregar `<link rel="manifest" href="/manifest.webmanifest">`, `<meta name="theme-color">`, `<meta name="apple-mobile-web-app-capable" content="yes">`, apple-touch-icon.
- [ ] **E3.** Crear `public/sw.js` con:
  - Pre-cache del shell (`/`, `/index.html`, `/manifest.webmanifest`, `/favicon.png`).
  - Cache-first para assets estáticos, network-first para `/api/*`.
  - Listener `push` para notificaciones push (lo usa la sección F).
- [ ] **E4.** Registrar SW desde `src/main.tsx` (solo en prod y si `serviceWorker` en navigator).
- [ ] **E5.** Banner "Instalar app" en mobile: detectar `beforeinstallprompt`, mostrar card fija abajo en `App.tsx` con botones "Instalar" / "Más tarde". Solo aparece en móvil (viewport width < 768px) y si no está ya instalada.

### F. Sistema de notificaciones (in-app + mail + release broadcast)

#### F.1 Backend

- [ ] **F1.1.** En `db.js`, agregar 3 tablas idempotentes:
  - `notifications(id INTEGER PK, site_code, user_email TEXT, kind TEXT, title TEXT, body TEXT, link TEXT, read INTEGER DEFAULT 0, created_at, payload_json TEXT)`. Indexado por `(site_code, user_email, read)`.
  - `push_subscriptions(id INTEGER PK, user_email TEXT, site_code TEXT, endpoint TEXT UNIQUE, p256dh TEXT, auth TEXT, created_at, last_seen_at)`.
  - `release_notes(version TEXT PK, title TEXT, body_md TEXT, sent_at, sent_by)`.
- [ ] **F1.2.** Crear `server/services/notifications.service.js`:
  - `notifyUser({ siteCode, email, kind, title, body, link })` → inserta en `notifications`.
  - `notifySiteAdmins({ siteCode, kind, ... })` → busca Jefes TIC + Superadmin del site y manda.
  - `broadcastRelease({ version, title, body })` → para cada `users` activo, manda mail + inserta in-app.
  - `sendPush(subscription, payload)` → usa `web-push` (agregar dep). Si no hay VAPID configurado, cae gracefully a solo in-app + mail.
- [ ] **F1.3.** Crear `server/routes/notifications.routes.js`:
  - `GET /api/notifications?unread=1` → items del usuario en sede activa.
  - `PATCH /api/notifications/:id/read`.
  - `POST /api/notifications/read-all`.
  - `POST /api/push/subscribe` y `DELETE /api/push/subscribe` (gestiona `push_subscriptions`).
- [ ] **F1.4.** Hooks de eventos (en `tasks.routes.js`, `tickets.routes.js`):
  - POST `/api/tasks` → `notifySiteAdmins({ kind: 'task.created', title: 'Nueva tarea: '+titulo, body: operador, link: `/sede/${site}/tareas` })` (no bloqueante).
  - POST `/api/tickets` → mismo patrón con `kind: 'ticket.created'`.
  - PATCH estado tarea → notifica al asignado si cambió.
- [ ] **F1.5.** Plantilla `buildReleaseBroadcastMail({ version, title, bodyMd, appUrl })` en `mailTemplates.js` con el formato card-style. Incluir la lista de features nuevas del release notes en `bodyMd` (markdown básico → HTML en la plantilla).
- [ ] **F1.6.** Endpoint admin: `POST /api/admin/release-notes` (solo Superadmin) → guarda versión + dispara `broadcastRelease` que manda mail a todos los `users.activo=1` + inserta in-app.

#### F.2 Frontend

- [ ] **F2.1.** Componente `NotificationBell.tsx` en `src/components/layout/`:
  - Icono campana en `Topbar.tsx`, badge con contador de unread.
  - Click abre popover (no modal) con lista de últimas 20, cada item clickeable navega a `link`.
  - Botón "Marcar todas como leídas".
- [ ] **F2.2.** Hook `useNotifications()` en `src/hooks/`:
  - Polling cada 30s (o SSE si querés más prolijo).
  - Dispara un **toast popup** (esquina inferior derecha) cuando llega una nueva in-app: titulo + body + "Ver".
- [ ] **F2.3.** En `App.tsx`, montar `<NotificationBell user={user} activeSite={activeSite} />` al lado del account menu en Topbar.
- [ ] **F2.4.** "Qué hay de nuevo" modal: la primera vez que el user entra después de un release nuevo, mostrar un modal con `release_notes.body_md` del último release que no haya visto (guardar último visto en `localStorage` key `techasset_last_seen_release`).

### G. Release actual (para enviar a todos)

Las features a comunicar en el broadcast `v1.4.0`:

- Sistema de **tickets InVgate** integrado: cargar número → te arma el link directo + previsualización del PDF/foto exportado.
- **Búsqueda por número de ticket** en la sección Tickets.
- **Analítica renovada** con layout bento (más legible, más prolijo).
- **Asignación flexible de tareas**: ahora podés elegir uno o varios responsables con chips, sin obligarte a asignarte a vos mismo.
- **Configuración de sede con toggles** ordenados por categoría: apagá las secciones que no usen.
- **PWA**: ahora se puede **instalar en el celular** como app (banner aparece abajo).
- **Notificaciones in-app + mail** cuando cargan tareas o tickets.
- **Bug fixes**: link InVgate correcto (`techasset.bauhub.online`), validación de número sin `#`, vista previa de PDF más compacta.

> Nota: estas features corresponden a los commits `3578808 commit tenants, tickets fix analitica` → `5627bd1 Version funcional en celu y linda` → `f9ec28c VFINAL` → `1a96075 Version Multisede`. El broadcast debe redactarse en rioplatense ("¡Ya podés instalar la app en tu celu!"), no en español neutro.

---

## Archivos a tocar (resumen)

### Backend nuevos

- `server/services/notifications.service.js`
- `server/routes/notifications.routes.js`
- `public/sw.js`
- `public/manifest.webmanifest`

### Backend modificados

- `server/db.js` — 3 tablas + columnas `notifications`.
- `server/index.js` — montar `/api/notifications`.
- `server/routes/tickets.routes.js` — hook de notify + helper strip `#`.
- `server/routes/tasks.routes.js` — hook de notify.
- `server/routes/sites.routes.js` — admin release-notes.
- `server/services/mailTemplates.js` — plantilla release broadcast.
- `server/services/mail.service.js` — puede quedar igual, ya respeta `MODO_PRUEBA`.
- `server/config.js` — nuevas vars `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
- `.env.example` — reemplazar `HANDING_TICKET_URL` por `TECHASSET_PUBLIC_URL=https://techasset.bauhub.online`.

### Frontend nuevos

- `src/components/layout/NotificationBell.tsx`
- `src/hooks/useNotifications.ts`
- `src/components/common/ReleaseNotesModal.tsx`

### Frontend modificados

- `src/components/tickets/TicketsPage.tsx` — A1–A5.
- `src/components/analytics/AnalyticsPage.tsx` + `ChartCard.tsx` — B1–B4.
- `src/components/tasks/TaskModal.tsx` — C1–C3.
- `src/components/settings/ModulesPanel.tsx` — D1–D3.
- `src/components/layout/Topbar.tsx` — montar bell.
- `src/App.tsx` — banner install PWA + release modal.
- `src/main.tsx` — registro SW.
- `index.html` — manifest link + meta PWA.

### Dependencias nuevas

- `web-push` (push notifications server-side).

---

## Orden sugerido de ejecución (slices chiquitos para review)

1. **Slice 1 — Tickets & link InVgate (A1, A2, A6).** Migración rápida del dominio + búsqueda básica. PR ~150 líneas.
2. **Slice 2 — Tareas flexible (C1, C2, C3).** Cambio aislado en TaskModal. PR ~200 líneas.
3. **Slice 3 — Settings toggles (D1, D2, D3).** Solo frontend, refactor visual. PR ~180 líneas.
4. **Slice 4 — Analítica bento (B1–B4).** Frontend puro, redesño de layout. PR ~300 líneas (más por el CSS).
5. **Slice 5 — PWA shell (E1–E5).** Manifest + SW + banner install. PR ~150 líneas.
6. **Slice 6 — Notificaciones in-app + mail (F1.1–F2.3).** Backend + frontend nuevo. PR grande (~500 líneas). Es el corazón del cambio.
7. **Slice 7 — Release broadcast + modal (F1.5, F1.6, F2.4).** Dispara el mail a todos los usuarios con las features de los slices 1–6. PR chico (~120 líneas).
8. **Slice 8 — Polish final.** Banner install en mobile, validación `#`, búsqueda tickets, etc.

Cada slice puede ir como PR aparte (ver skill `chained-pr` si querés mantener reviews chicas).

---

## Riesgos / cosas a vigilar

- **Push notifications sin HTTPS** no funcionan salvo en localhost. Verificar que el deploy de `techasset.bauhub.online` esté bajo HTTPS (Caddy reverse proxy ya lo hace).
- **VAPID keys**: si no están configuradas, las push fallan silenciosamente — el sistema ya está pensado para caer a in-app + mail sin romper el flujo (mismo patrón que el `MODO_PRUEBA` del mail).
- **Multi-sede**: cualquier endpoint nuevo debe filtrar por `requireSite(req)` y validar que el `user_email` de la notificación pertenezca a esa sede (anti-leak entre NFPT y NFND).
- **Broadcast "App actualizada"** se manda una vez por versión. Guardar `release_notes.sent_at` para no duplicar envíos si se vuelve a llamar el endpoint.
- **Modo consulta** ya bloquea ediciones, pero hay que validar que el `NotificationBell` siga visible (es lectura, no edición).
- **Tema oscuro**: el PDF dice "horrendo" de la analítica actual, pero no quiere un redesign destructivo — mantener la paleta/variables existentes, solo redistribuir.

---

## Próximos pasos

1. Confirmar por cuál slice arrancar.
2. Definir el copy del mail broadcast (¿lo redacto yo o me lo pasás vos?).
3. Decidir si esta primera versión incluye push real (VAPID) o solo in-app + mail.