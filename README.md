# TechAsset - NFS / NFPT

Migración técnica de TechAsset a una arquitectura moderna con frontend React + Vite y backend Node.js, conservando la apariencia visual de la app actual.

## Arquitectura

- Frontend: React, Vite, TypeScript, componentes separados, hooks y servicios.
- Backend: Node.js, Express, rutas REST y SQLite local.
- Google Sheets + Apps Script se mantienen para inventario, préstamos, devoluciones, movimientos y sincronización NFPT.
- SQLite local se usa para Agenda TIC, Tareas TIC, historiales, panel Ahora y datos operativos.

## Instalar

```bash
npm install
```

## Desarrollo

```bash
npm run dev
```

Levanta el backend en `http://127.0.0.1:8000` y Vite en `http://127.0.0.1:5173`.

## Producción local

```bash
npm run build
npm run start
```

Luego abrir `http://127.0.0.1:8000`.

## Docker

La app se puede correr en VPS con Docker. La imagen usa Node 22 sobre Debian (no Alpine, para que `better-sqlite3` compile sin problemas) y persiste la base SQLite en el volumen `./data`.

Antes de levantar:

```bash
cp .env.example .env
# editar .env con los valores reales (sin subirlo al repo)
```

Comandos:

```bash
docker compose build           # construir la imagen
docker compose up -d           # levantar la app en segundo plano
docker compose logs -f techasset   # ver logs en vivo
docker compose restart techasset   # reiniciar el contenedor
docker compose down            # detener y limpiar
```

Dentro del contenedor el server escucha en el puerto **8000**. El servicio **no expone puertos al host**: el ingreso entra por Caddy (u otro reverse proxy) que comparte la red Docker `proxy-network`. Caddy proxea hacia `techasset:8000`.

Si necesitás probar el contenedor directo desde el VPS sin Caddy, agregá temporalmente al `docker-compose.yml`:

```yaml
    ports:
      - "8001:8000"
```

y la app queda accesible en `http://IP_DEL_SERVIDOR:8001`.

Red compartida:

- El compose define `proxy-network` (driver bridge).
- Caddy debe declarar la misma red en su propio compose (`external: true` si Caddy vive en otro stack, o sumando el servicio al mismo `docker-compose.yml`).

Persistencia:

- La base SQLite vive en `./data/techasset.db` del host (volumen `./data:/app/data`).
- Reconstruir la imagen no borra datos.
- Cache CSV (`./data/cache_sheet.csv`) y archivos temporales (`./data/tmp`) también persisten.

Si cambiás dependencias (`package.json`), volver a correr `docker compose build` y luego `docker compose up -d`.

## Configuración

Copiar `.env.example` a `.env` y completar:

- `GOOGLE_SHEET_CSV_URL`: URL CSV publicada de la hoja de inventario.
- `APPS_SCRIPT_URL`: endpoint de Apps Script para escribir préstamos, devoluciones y estados.
- `SQLITE_DB_PATH`: por defecto `./data/techasset.db`.
- `CACHE_CSV_PATH`: por defecto `./data/cache_sheet.csv`.

Si Google Sheets falla, el servidor usa `data/cache_sheet.csv`.

## Acceso inicial / Superadmin

Al inicializar la base, TechAsset crea usuarios permitidos a partir de `AUTH_ALLOWED_EMAILS`.

Si todavía no existe ningún usuario con rol `Superadmin`, el primer mail de `AUTH_ALLOWED_EMAILS` queda como Superadmin bootstrap. Si `AUTH_ALLOWED_EMAILS` está vacío, se usa este mail de desarrollo:

```env
admin@northfield.local
```

Para definir usuarios iniciales reales, configurar en `.env`:

```env
AUTH_ALLOWED_EMAILS=mail1@dominio.com,mail2@dominio.com
```

El rol `Superadmin` puede crear sedes, editar sedes, administrar URLs de Spreadsheet/Apps Script por sede y asignar usuarios/roles en todas las sedes. El rol `Jefe TIC` administra solo su sede asignada.

Los demás usuarios de `AUTH_ALLOWED_EMAILS` se crean como `Jefe TIC` para la sede `DEFAULT_SITE_CODE` y luego se pueden administrar desde Configuración → Usuarios permitidos. En producción conviene cargar mails institucionales reales, asignar el Superadmin definitivo, revisar sedes/roles desde la pantalla de Usuarios permitidos y no dejar accesos de prueba activos.

## SQLite

Inicializar o verificar la base:

```bash
npm run db:init
```

La base está en `data/techasset.db`. Para backup usar `scripts/backup-db.bat`.

## Túnel local

Para que la app esté siempre publicada en `https://techasset-nfpt.loca.lt`:

```bash
npm run tunnel
```

El script reintenta automáticamente si localtunnel cae o no concede el subdominio.

Para levantar backend + túnel en simultáneo:

```bash
npm run serve
```

Variables opcionales: `TUNNEL_SUBDOMAIN`, `TUNNEL_PORT`, `TUNNEL_HOST`, `TUNNEL_RETRY_MS`.

También está disponible `scripts\start-tunnel.bat` para Windows.

## Endpoints principales

- `GET /api/devices`
- `GET /api/devices/state`
- `POST /api/devices/add`
- `POST /api/devices/status`
- `POST /api/loans/lend`
- `POST /api/loans/return`
- `GET /api/movements`
- `GET /api/agenda`
- `POST /api/agenda`
- `PATCH /api/agenda/:id`
- `DELETE /api/agenda/:id`
- `GET /api/tasks`
- `POST /api/tasks`
- `PATCH /api/tasks/:id`
- `DELETE /api/tasks/:id`
- `GET /api/tasks/analytics`

## Agenda TIC

La vista **Agenda TIC** es solo lectura/visualización del cronograma semanal. Sirve para consultar horarios de actividades y marcar el estado operativo (entregado, cancelado, nota, computadoras retiradas), pero no se usa como sistema de reservas. Las reservas reales se gestionan fuera de la app, en la planilla compartida del cronograma.

## Pruebas rápidas

- Agenda: consultar el cronograma del día y de la semana, alternar el filtro de turno (Mañana / Tarde / Completo).
- Tareas: crear tarea, mover entre Pendiente, En proceso y Hecha.
- Préstamos: configurar `APPS_SCRIPT_URL` y probar prestar/devolver con una etiqueta real.
- Búsqueda: probar `189`, `D189`, `D0189`, QR `TA|D0189|SERIAL|MAC`, `tic 1`, `plani 5`, `touch 32`.

## Errores comunes

- Sin inventario: revisar `GOOGLE_SHEET_CSV_URL` o `data/cache_sheet.csv`.
- Escritura no impacta en hoja: revisar `APPS_SCRIPT_URL`.
- SQLite bloqueado: cerrar otras instancias y respaldar `data/techasset.db`.
- Puerto ocupado: cambiar `PORT` en `.env`.

## Asistente TIC

La vista `Asistente TIC` agrega un chatbot operativo dentro de la app. Puede consultar datos vivos y preparar acciones sobre tareas, préstamos, devoluciones y dispositivos. La Agenda TIC es solo de visualización: el asistente puede leerla pero no se usa para reservar recursos.

El asistente distingue:

- Datos vivos de la app: dispositivos, prestamos, devoluciones, tareas, agenda e historial.
- Documentos de procedimiento: archivos internos en `data/procedimientos`.
- Acciones que modifican datos: siempre piden confirmacion antes de guardar.

Funciona sin API externa con reglas simples. Si mas adelante se configura `OPENAI_API_KEY` y `OPENAI_MODEL`, las llamadas deben seguir saliendo desde backend, nunca desde frontend.

### Endpoints del asistente y operacion TIC

- `POST /api/asistente/chat`
- `GET /api/procedimientos/search?q=texto`
- `GET /api/prestamos`
- `GET /api/prestamos/:id`
- `POST /api/prestamos`
- `PUT /api/prestamos/:id`
- `DELETE /api/prestamos/:id`
- `POST /api/prestamos/:id/devolver`
- `GET /api/devoluciones`
- `GET /api/devoluciones/:id`
- `POST /api/devoluciones`
- Alias de tareas en castellano: `GET /api/tareas`, `GET /api/tareas/:id`, `POST /api/tareas`, `PUT /api/tareas/:id`, `DELETE /api/tareas/:id`

### Documentos de procedimiento

Los documentos internos van en:

```bash
data/procedimientos
```

Formatos iniciales: `.md`, `.txt`, `.json`.

Ejemplo:

```bash
GET /api/procedimientos/search?q=falta%20cargador
```

Si no hay informacion suficiente en documentos cargados, el asistente lo dice claramente y recomienda validar con coordinacion o responsable TIC.

### Pruebas rapidas del Asistente TIC

- `Creá una tarea urgente para revisar el proyector de 3A.`
- `¿Qué hago si falta el cargador?`
- `¿Está disponible D1433?`
- `Prestale D1433 a Juan Pérez hasta mañana responsable Bauti`
- `Registrá la devolución de D1433`
