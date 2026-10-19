# Pruebas de punta a punta (e2e)

Red de seguridad del rediseño (PLAN §7): corre la app **actual** de verdad y verifica los flujos críticos antes y después de cada etapa.

```bash
npm run e2e                        # todo: funcionales (a–h) + línea base (i, j) · ~1,5 min
npm run e2e -- --no-baseline       # solo funcionales · ~30 s
npm run e2e -- --only=prestamos    # filtra por grupo o nombre (sin tildes ni mayúsculas)
npm run e2e -- --no-build          # usa dist/ como esté, aunque sea más viejo que src/
npm run e2e -- --build             # buildea sí o sí
npm run e2e -- --headful --keep    # navegador a la vista y conserva la copia de la base
npm run e2e -- --only=asistente --ai  # el server de prueba usa la IA del .env (gasta tokens)
npm run check:ui                   # guardia de controles nativos (scripts/check-ui.mjs)
```

## Qué hace

1. **Build:** si `dist/` no existe o es más viejo que `src/`/`public/`, corre `vite build` (sin `tsc`: el chequeo de tipos es de `npm run build`).
2. **Base:** copia `data/techasset.db` a un temporal con la API de backup de SQLite. **Nunca** toca la base real ni Postgres. En la copia: sesión para el superadmin existente, un usuario de **solo consulta** (lo crea si no hay), un equipo puesto *Fuera de servicio* para el chip bloqueado, `mail.modoPrueba=true` y sin suscripciones push.
3. **Server:** `node server/index.js` en un puerto libre de `127.0.0.1`, con `DATABASE_URL`, SMTP, Resend, OpenAI, Google, VAPID y la planilla vacíos y `MODO_PRUEBA=true`: no sale ningún mail, push ni llamada externa.
4. **Navegador:** Chrome (si no, Edge; `E2E_BROWSER=<ruta>` lo pisa) con `puppeteer-core`, sin `--hide-scrollbars` para que las barras ocupen lugar como en la vida real. Cada grupo usa un contexto aislado con la cookie de sesión y la sede `NFPT`.
5. **Salida:** tabla en consola, `e2e/last-run.json` con todo el detalle (incluye las muestras de layout por vista y ancho) y capturas de las pruebas que fallan en `e2e/.out/fallas/`.

**Exit code 1** si falla alguna prueba funcional (a–h). Las de línea base (i, j) se reportan con conteos y no cambian el exit code.

## Qué garantiza

Cada prueba verifica el efecto en la base (vía API), no solo lo que se ve.

| | Pruebas |
|---|---|
| a | Préstamos: prestar y devolver por formulario; escaneo continuo con Enter (duplicado avisado, no disponible en rojo, lote de 2 en un request); **Ctrl, Meta y Shift+Click** en chips de equipos prenden la selección sin prestar; barra con *Prestar N* / *Devolver N*; *Prestar N* pasa el lote al escaneo continuo; chip bloqueado no responde; click simple en prestado lo devuelve; cartelitos con los tres modificadores (*Entregar N* / *Devolver N*) |
| b | Escáner global: tipear rápido fuera de inputs lleva a Préstamos con la etiqueta; dentro de un campo o con foco en un diálogo no navega |
| c | Búsqueda flexible en Dispositivos: `touch N`, `touchN`, `Ntouch`, `D####`, `####`, `plani N`, `planificación N` (toma alias que existan en la copia) |
| d | Borrar → Deshacer; borrar → papelera → Restaurar |
| e | Mover una tarea de columna (drag & drop con `DataTransfer`); cambiar el estado de un ticket (lo crea en la copia si no hay) |
| f | Alta de agenda con conflicto de capacidad: aparece el aviso y no se guarda |
| g | Modo consulta en Inicio, Préstamos y Dispositivos: ningún botón de escritura habilitado, chips y casillas deshabilitados; el server responde 403 |
| h | `/sede/NFPT/<vista>` abre la vista correcta para cada ítem del menú; un 401 vuelve al login |
| k | Asistente: sin `SpeechRecognition` el micrófono no aparece y con él el dictado deja el resultado intermedio y el final en el campo; un pedido de solo lectura ("¿cuántos equipos hay prestados?") llega por el stream con respuesta (modo local en el banco; IA real con `--ai`); stream simulado en la página: texto en vivo sin markdown + línea "Prestando…", `done.reply` al final, acciones con Deshacer (ok y 409 en línea) y confirmación del lote que envía "sí, confirmo". Con `--ai`, además un préstamo real por el asistente y su Deshacer, verificado por API |
| l | Herramientas, Accesos rápidos y Caja chica (`tests/tools.mjs`): alta de acceso con sugerencia `https://` y Enter, editar en la fila (Esc no guarda), borrar → Deshacer, ordenar; CSV con columnas faltantes, vista previa con contraseña oculta, tarjetas y reporte que se abren dos veces; Enviar exige validar; gasto con importe `1.234,50` y control de saldo; aprobar con alta en Inventario TIC; rechazar con nota editable; modo consulta en las tres; abrir/cerrar paneles no mueve el encabezado |
| m | Configuración (`tests/settings.mjs`): Usuarios aprobar → Deshacer (el mail en espera se cancela) y borrar con confirmación en línea → Deshacer; Módulos (conteo de cambios, aviso al salir, Descartar, reordenar y menú); Roles (Editar marca Ver, eliminar con confirmación); Invitaciones (link, revocar); Sedes (409); Avanzado (JSON inválido, el server valida); links viejos `/tenants`, `/adminusers`, `/configuracion/usuarios` y Atrás; cerrar un panel en línea no mueve el encabezado; rol sin admin |
| i | **Línea base de layout** por vista a 360/768/1024/1280/1366/1440: scroll horizontal de la página, barra de la página, barras visibles en contenedores, botones con el texto partido, hermanos que se pisan (> 2 px) |
| j | **Línea base mobile** (iPhone 13): pinza con dos dedos (`Input.dispatchTouchEvent`), swipe horizontal, doble toque y foco en un campo dejan escala 1 y `scrollX` 0; campos con texto ≥ 16 px. Incluye un control: la misma pinza tiene que hacer zoom en una página que no lo bloquea |

## Notas

- Las pruebas reparten equipos libres distintos entre sí y miran el estado actual por API, así no dependen de etiquetas fijas.
- La línea base de layout cuenta problemas por ancho; en consola: `1024: XP/3/0/94` = scroll horizontal, barra de página, 3 barras en contenedores, 0 botones partidos, 94 solapamientos. Las muestras de cada uno están en `last-run.json` → `layout.<vista>.<ancho>`.
- `last-run.json` y `.out/` tienen datos de la base local: no se commitean.
