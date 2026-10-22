# QA de lanzamiento — ronda 1 (22/10/2026)

5 usuarios nuevos (impaciente IMP, escéptico ESC, móvil 375 px + Slow 3G + CPU 4× MOV, no nativo NN, destructor DES) en la sede de prueba `QA` (entorno aislado, `qa/README.md`; copia de la base, sin mails reales, sin producción). Diarios y capturas en `qa/.out/<persona>/diario.md` y `caps/` (no versionados). Además: SETUP = lo que vio el agente que armó el entorno.

Los 5 llegaron al primer éxito (registrarse, entrar, prestar y devolver). Nadie logró doble préstamo, 5xx, XSS ni ver otra sede.

## Lista ordenada por cuántos usuarios lo golpean

| # | Usuarios | Problema | Frente |
|---|---|---|---|
| 1 | 4 (ESC-15, NN-05, IMP-P4, MOV-P13) | Leyenda de cartelitos en Préstamos: "12 Libre · 12 Prestado…" se lee como cantidades | B |
| 2 | 3 (NN-01/02/03, IMP-P2/P3/P6, MOV-P03) | Formulario de préstamo: valida de a un campo, no marca obligatorios, error fuera de la vista, "EP/ES" y cursos "1N…6S" sin explicar, la lista de cursos no se filtra por nivel y abre corrida | B |
| 3 | 3 (DES-3, MOV-P08, ESC-21/MOV-P09) | Errores técnicos crudos: "Failed to fetch" en inglés sin red; aviso de cámara "usá HTTPS/localhost" | B (+ D cámara de la barra) |
| 4 | 2 (IMP-P1, MOV-P05) | Inicio "Afuera ahora": la línea "prestado/devuelto · Deshacer" mueve la página al aparecer/irse, aparece fuera de la vista; un clic cayó en otra fila | C |
| 5 | 2 (IMP-P9, MOV-P02) + MOV-P01 | Sin sesión la landing baja el código del Inicio y pollea `/api/agenda`, `/api/tasks`, `/api/settings/shifts`, `/api/movements` (401); landing en frío con Slow 3G: 18,1 s de pantalla gris sin nada | A |
| 6 | 2 (ESC-19, NN-27) | "Olvidé mi contraseña o es mi primera vez" confunde (y manda mail sin preguntar) | A |
| 7 | 2 (ESC-03/04, SETUP) | Mails de registro: dicen "pendiente de aprobación" con la cuenta ya activa, código de sede en vez de nombre, hora 02:18 (12 h sin a. m./p. m.), "Turno: Todo el día" no pedido | A |
| 8 | 2 (IMP-P7, ESC-09) | Después de crear la cuenta hay que volver a tocar Ingresar y la contraseña aparece cargada sin explicación | A |
| 9 | 2 (NN-11, MOV-P11) | Íconos de la barra superior sin nombre visible/tooltip; objetivos táctiles chicos en mobile (casillas 16 px, "Mostrar" 28 px, botones 38, campos 42) | D |
| 10 | 1 (ESC-01/02/05/07) | No hay términos, privacidad ni quién opera; URLs inexistentes muestran la landing sin decir que no existen; "sin seguimiento" contradice que todo queda firmado | A |
| 11 | 1 (ESC-10) | No se puede cambiar la contraseña desde adentro; no dice cómo pedir la baja ni qué datos se guardan | A |
| 12 | 1 (ESC-08) | Acepta `123456` como contraseña | A |
| 13 | 1 (DES-1/2, ESC-20) | Sin tope de largo en campos (mail de 5000 chars crea cuenta y quema la invitación; 20 000 chars en tareas); controles bidi/RTL en nombres falsean el Historial | A (server, global) |
| 14 | 1 (ESC-11/12/13/14) | Asistente: no dice si usa IA ni qué datos salen; el chip de ejemplo manda un préstamo a una persona que el usuario no escribió; cambia la vista sin avisar; ejemplos con equipos que no existen en la sede | D |
| 15 | 1 (ESC-17) | Cerrar sesión no confirma y deja el nombre en `localStorage` (`techasset_operator`) | A |
| 16 | 1 (ESC-18, ESC-22) | Configuración › Cuenta: "Base local SQLite…" (jerga e infraestructura); Notificaciones: "El servidor no tiene push configurado" con botón "Activar" | A |
| 17 | 1 (MOV-P04, MOV-P14) | Inicio: mientras carga dice "Sin actividades hoy" / "Sin movimientos" y contadores en 0 (falso vacío); cada vuelta al Inicio vuelve a esqueletos 4 s | C |
| 18 | 1 (IMP-P5) | Tarea "venció el 22/10" en el Inicio y "Vence hoy" en el tablero el mismo día | C |
| 19 | 1 (NN-08) | "Afuera ahora" sigue de título con la pestaña "Disponibles" | C |
| 20 | 1 (MOV-P06) | Buscar `10` ofrece equipos cuyo serie contiene 10 pero no Touch 10 | B |
| 21 | 1 (MOV-P07) | Franja "Instalá TechAsset" ocupa ~128 px en mobile en cada pantalla | D |
| 22 | 1 (MOV-P10) | "Más" sin URL propia: Atrás saca de la vista en vez de cerrarlo | D |
| 23 | 1 (NN-17/18/19, MOV-P12) | Agenda: "Mañana" ambiguo, "Entregado · Sin retirar · Retirar" confuso, tocar "✓ Entregado" deshace sin aviso, "4 pendientes" vs filtro "Pendientes 6", primer pantallazo solo controles | E |
| 24 | 1 (NN-12/13) | Tareas: el "+" ofrece "Equipo · Privada · Columna" ("equipo" = dispositivo en la app); la casilla de la tarjeta parece "completar" pero selecciona y ofrece Borrar; hora "2:15 p. m." vs "14:15" | E |
| 25 | SETUP | Estado aulas de una sede nueva sin planos: vacío sin explicar | E |
| 26 | 1 (NN varios, "molesta") | Textos: "TIC/Jefe TIC/DOE" sin explicar, "Revisar" junto a "Devolver", "Ingresar/Entrá/iniciar sesión" mezclados, "marca varias/varios", "Sincronizar" vs "Actualizar", tema sin rótulo | cada frente en sus pantallas |
| 27 | 1 (MOV-P15, sin confirmar) | Una vez, texto de Persona cayó en el campo del código y se cerró el formulario | B (investigar) |

## Frentes del arreglo (un pase, en paralelo, archivos disjuntos)

- **A — Ingreso, cuenta, privacidad, mails y server**: 5, 6, 7, 8, 10, 11, 12, 13, 15, 16.
- **B — Préstamos**: 1, 2, 3 (errores de red globales y cámara de Préstamos), 20, 27.
- **C — Inicio**: 4, 17, 18, 19.
- **D — Shell, mobile y asistente**: 3 (cámara de la barra), 9, 14, 21, 22.
- **E — Agenda, Tareas, Aulas**: 23, 24, 25.

Después: integración, e2e completo + sonda UX + pg-smoke, y re-corrida de los 5 usuarios (ronda 2) con `--fresh`.
