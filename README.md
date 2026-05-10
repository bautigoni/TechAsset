# TechAsset

TechAsset es una app interna para gestión tecnológica escolar por sede. Está pensada para operar dispositivos, préstamos/devoluciones, movimientos, agenda, tareas TIC, aulas, inventario maker y configuración sin depender de servicios externos para el trabajo diario.

## Versión actual: SQLite-first

SQLite es la fuente principal de verdad. Google Sheets o archivos CSV se usan solo para importación manual de inventario, no para sincronización viva.

- Prestar y devolver dispositivos actualiza SQLite.
- Dashboard, Dispositivos y Préstamos leen desde SQLite.
- Los movimientos se registran localmente.
- La identidad de un equipo es `site_code + etiqueta`.
- Una importación en NFND no toca NFPT, y una importación en NFPT no toca NFND.

## Funciones

- Login y registro.
- Multi-sede y usuarios por sede.
- Roles: `Superadmin`, `Jefe TIC`, asistentes y consulta.
- Dashboard por sede.
- Dispositivos, préstamos, devoluciones y movimientos.
- Inventario TIC / Recursos Maker.
- Agenda TIC y Tareas TIC.
- Estado de aulas.
- Accesos rápidos y herramientas auxiliares.
- Configuración de sedes y usuarios permitidos.
- Importación manual de dispositivos desde CSV.
- Exportación CSV de inventario, resumen, movimientos y préstamos activos.
- Exportación PDF QR de dispositivos.

## Arquitectura

- Frontend: React + Vite + TypeScript.
- Backend: Node.js + Express.
- Base de datos: SQLite con `better-sqlite3`.
- Persistencia local: carpeta `data/`.
- Google Sheets: opcional, solo como fuente de CSV para importación manual.

## Desarrollo

```bash
npm install
npm run db:init
npm run build
npm run start
```

Modo desarrollo:

```bash
npm run dev
```

URL habitual:

```txt
http://127.0.0.1:8000
```

## Variables de entorno

Usar `.env.example` como base:

```env
PORT=8000
APP_NAME=TechAsset
DEFAULT_SITE_CODE=NFPT
BOOTSTRAP_SITES=NFPT:Northfield Puertos,NFND:Northfield Nordelta
AUTH_ALLOWED_EMAILS=admin@northfield.local
SQLITE_DB_PATH=./data/techasset.db
GOOGLE_SHEET_CSV_URL=
CACHE_CSV_PATH=./data/cache_sheet.csv
DEVICES_APP_CSV_PATH=./data/devices_app.csv
AUTO_REFRESH_SECONDS=5
TOOLS_TEMP_DIR=./data/tmp
MAX_UPLOAD_MB=10
MODO_PRUEBA=true
MICROSOFT_LOGIN_URL=
HANDING_TICKET_URL=
```

`GOOGLE_SHEET_CSV_URL` es opcional y solo sirve como fuente de importación manual. No se usa para prestar, devolver ni modificar estados.

## Acceso inicial / Superadmin

Si no hay usuarios configurados, definí al menos un usuario en:

```env
AUTH_ALLOWED_EMAILS=admin@northfield.local
```

Desde Configuración > Usuarios permitidos se pueden asignar roles y sedes.

- `Superadmin`: administra toda la plataforma, crea sedes, asigna usuarios/roles y configura URLs CSV por sede.
- `Jefe TIC`: administra solo su sede.
- Usuarios comunes o de consulta: no ven ni administran otras sedes.

En producción conviene reemplazar `admin@northfield.local` por mails reales del colegio y no dejar cuentas de prueba activas.

## Importar dispositivos

La importación se hace desde Dispositivos > Importar CSV.

Opciones:

- Pegar una URL CSV publicada.
- Dejar vacío el prompt para usar la URL CSV configurada en la sede.

Columnas soportadas:

- `Modelo`
- `Etiqueta 2023`, `Etiqueta`, `Código`, `Codigo`, `ID`
- `Número`, `N°`, `Numero operativo`, `Número operativo`
- `Devuelto`, `Estado`
- `Comentarios`
- `Prestada`
- `Fecha pres`
- `Fecha dev`
- `Última mod`
- `Rol`
- `Ubicación`
- `Motivo`
- `Marca`
- `S/N`
- `MAC`

Al importar:

- Se normalizan etiquetas como `d1188` a `D1188`.
- Los nuevos dispositivos se crean para la sede activa.
- Los dispositivos existentes se actualizan por `site_code + etiqueta`.
- No se borran movimientos históricos.
- Los préstamos activos locales se conservan como estado operativo.
- Se muestra un resumen con leídos, nuevos, actualizados, omitidos y errores.

## Exportar datos

Desde Dispositivos:

- Exportar inventario CSV.
- Exportar resumen CSV por categoría/estado.
- Exportar movimientos CSV.
- Exportar préstamos activos CSV.
- Exportar PDF QR.

Los CSV se generan desde SQLite y respetan la sede activa.

## Producción / VPS / Docker

Si se usa Docker o VPS, la carpeta `data/` debe persistir como volumen porque contiene la base SQLite y archivos locales.

Comando típico si existe `docker-compose.yml`:

```bash
docker compose up -d --build
```

## Notas operativas

- La app debe seguir funcionando aunque internet, Google Sheets o un CSV externo fallen.
- El indicador superior muestra el estado de la base local y la última importación, no una sincronización viva.
- No existe escritura automática a planillas al prestar o devolver.
