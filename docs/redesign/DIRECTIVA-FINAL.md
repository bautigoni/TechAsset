# Directiva del dueño: finalización completa, optimización y auditoría (19/10/2026)

Texto del dueño, tal cual (resumen operativo al final). Manda sobre el orden de trabajo hasta la entrega final.

## 1. Objetivo general
Actuar como orquestador principal, arquitecto de software, desarrollador senior y responsable de calidad. Llevar la aplicación desde su estado actual hasta una versión FINAL, completamente funcional, optimizada, estable, coherente y preparada para producción. No detenerse después de completar una etapa ni pedir que continúe manualmente. Autorización para trabajar de manera autónoma, tomar decisiones técnicas, crear subagentes, modificar archivos, ejecutar pruebas, corregir errores, realizar commits y hacer push cuando corresponda. Usar todo el tiempo y los tokens disponibles; priorizar la calidad real sobre la velocidad. No sacrificar funcionalidades existentes para simplificar el desarrollo.

## 2. Ejecución continua de todas las etapas
Al terminar la etapa 2, continuar automáticamente con la 3, 4, 5… hasta completar todas las etapas del plan. Reglas: revisar el plan y determinar qué etapas están terminadas, incompletas o faltan; no repetir trabajo bien hecho; no saltear etapas ni funcionalidades; no detenerse a pedir autorización; resolver problemas antes de seguir (salvo dependencia técnica que justifique otro orden); mantener la arquitectura y comportamientos que funcionan; verificar que lo anterior siga funcionando; no declarar terminada una etapa solo porque se escribió el código (debe estar integrado y probado); implementar mejoras necesarias no contempladas cuando tengan sentido; continuar hasta la última etapa. Se puede reorganizar internamente el trabajo respetando dependencias y objetivos.

## 3. Autonomía y toma de decisiones
No pedir confirmación por cada cambio. Autorizado a: crear, modificar, reorganizar y eliminar código obsoleto justificado; corregir bugs, problemas visuales y comportamientos inconsistentes; refactorizar; optimizar consultas, endpoints, procesos y estructuras de datos; incorporar pruebas automatizadas; crear y coordinar subagentes; instalar dependencias razonables; ejecutar builds y benchmarks; commits y push en las ramas correspondientes; introducir mejoras funcionales y de UX con valor real. Preguntar solo ante una decisión crítica que pueda provocar pérdida de datos, un problema grave de seguridad o un cambio irreversible.

## 4. Preservación total de funcionalidades
Comprender cómo funciona la app antes de modificar: módulos, pantallas y subpantallas, flujos principales y secundarios, roles y permisos, interacciones entre módulos, formularios, filtros y búsquedas, integraciones externas, comportamientos especiales y accesos rápidos, estados de carga/vacío/error/éxito, operaciones críticas sobre la base. No perder funcionalidades ni pequeños detalles de interacción. Cada modificación importante con pruebas de regresión. Un botón que funcionaba y deja de funcionar es un error a corregir.

## 5. Tres pasadas completas de optimización de rendimiento
Después de implementar todas las etapas y antes de la auditoría de los 10 subagentes, tres pasadas independientes con el objetivo: *"Tu trabajo es hacer esta aplicación más rápida. Mejorá el tiempo de inicio, qué tan rápido se abre cada pantalla, qué tan rápido se carga su contenido y el desplazamiento, para que todo se sienta más ligero y el contenido antiguo se cargue más rápido. Encontrá dónde está la verdadera brecha de rendimiento, aplicá las correcciones y hacé benchmarks antes y después de cada una para determinar si realmente existe una mejora."*
- **Pasada 1 — Diagnóstico y optimización general**: carga inicial, tiempo a interactivo, bundles, renders innecesarios, carga de componentes, navegación, latencia de API, consultas lentas, listas/tablas/históricos, memoria, bloqueos del hilo principal, red innecesaria. Cuellos reales por medición; correcciones de mayor impacto; benchmarks antes/después.
- **Pasada 2 — Optimización profunda**: volver a medir; índices, consultas redundantes, N+1, caché con invalidación correcta, lazy loading, code splitting, precarga selectiva, virtualización, paginación, filtros, componentes pesados, estado, tiempo de respuesta del backend. Solo optimizaciones justificadas por medición.
- **Pasada 3 — Final y experiencia percibida**: como ingeniero externo; fluidez visual, scroll de listas y tablas, cambio entre módulos, apertura de formularios, respuesta inmediata de botones, búsqueda y autocompletado, histórico, estados de carga, sesiones largas, grandes volúmenes, dispositivos de menor potencia.
Cada pasada: diagnóstico, correcciones, benchmarks comparativos y verificación de regresiones; tres ciclos reales sobre el resultado de la anterior.

## 6. Optimización especial de la búsqueda rápida
Mejorar significativamente la búsqueda rápida de personas y equivalentes: al escribir ~3 caracteres aparecen sugerencias casi inmediatas; se actualizan fluidamente; sin Enter; sin congelar la UI; resultados viejos no pisan a los nuevos; selección rápida con teclado y mouse; nombres, apellidos y combinaciones; tolerante a mayúsculas/minúsculas y acentos; respeta permisos y filtros. Investigar de punta a punta (SQL, índices, descarga excesiva, filtrado en el front, renders, peticiones redundantes, red, debounce, caché, autocompletado) y justificar técnicamente cada caché o índice. Objetivo: sugerencias en < 200 ms desde el disparo efectivo con datos representativos; si no se logra, documentar por qué y el tiempo real. Probar pocos/muchos registros, coincidencias parciales, nombres repetidos y sin resultados. Incluida en las tres pasadas y validada otra vez en la auditoría.

## 7. Auditoría final con 10 subagentes
Después de las etapas y las tres pasadas. **Contexto obligatorio** para cada subagente: para qué existe la app, qué problema resuelve, usuarios, roles y permisos, módulos y para qué sirve cada uno, relaciones, flujos importantes, comportamientos correctos, funcionalidades que no pueden perderse, y el contexto técnico para probar. **Los 10 recorren TODOS los módulos, pantallas y botones** (no una distribución por módulo), y además cada uno tiene una especialidad:
1. Funcionalidad general. 2. Experiencia de usuario. 3. Diseño visual. 4. Rendimiento. 5. Errores y casos extremos. 6. Integración frontend/backend. 7. Roles, permisos y seguridad. 8. Datos y consistencia. 9. Accesibilidad y dispositivos. 10. Auditor crítico independiente.

## 8. Metodología obligatoria de pruebas
Pruebas reales (automatización de navegador, e2e, API), no leer código y deducir. Datos de prueba aislados. Verificar módulos y rutas, pantallas, botones y resultados, formularios, campos, selectores y calendarios, búsquedas, filtros, menús, diálogos, confirmaciones, errores, vacíos, guardado y modificación, eliminación, navegación, carga, interacciones especiales, permisos y roles. Un botón no está probado por encontrarlo en el código. Acciones no seguras: entorno aislado o simulación controlada. **Matriz de cobertura**: inventario de módulos, rutas, pantallas, componentes interactivos y flujos; cada agente registra qué verificó y con qué resultado (probado OK, problemas, mejoras, bloqueadas, sin cobertura real). No declarar cobertura completa si hubo acciones sin probar.

## 9. Informe individual de cada subagente
A. Problemas funcionales (dónde, cómo reproducir, qué debería pasar). B. Diseño. C. Usabilidad. D. Rendimiento (con mediciones). E. Inconsistencias entre módulos. F. Recomendaciones. G. Priorización: Crítico / Alto / Medio / Bajo / Mejora opcional. Evidencia verificable (pasos, capturas, logs, tests, mediciones). Nada genérico.

## 10. Orquestación y corrección de los hallazgos
Consolidar, deduplicar, comparar contradicciones, identificar problemas reales y reproducibles, priorizar, evaluar recomendaciones de UX, decidir qué tiene sentido, rechazar lo innecesario o perjudicial con justificación, implementar las correcciones aprobadas y probar después de cada cambio importante. No implementar ciegamente. Corregir todos los críticos y altos reproducibles y los medios que tengan sentido. Ninguna mejora estética puede romper funcionalidad ni una optimización reducir la integridad de los datos.

## 11. Segunda validación
Volver a recorrer con los 10 subagentes: problemas solucionados, sin errores nuevos, funciones originales operativas, tiempos buenos, interfaz coherente, punta a punta OK; foco en zonas modificadas. Si aparecen problemas nuevos, corregir y repetir. El objetivo es una aplicación realmente terminada.

## 12. Commits, push y reglas de Git
Commits y push autorizados. **NO HACER MERGE** (el merge final lo hace el dueño). Inspeccionar el estado de git; identificar la rama y su relación con `main`; conservar historial; commits descriptivos (por etapa, optimización, auditoría); push a la rama de trabajo; no merge a `main`; no sobrescribir cambios ajenos; no force push salvo razón excepcional y segura; no tocar la rama de producción. Verificar la configuración real del autodeploy antes de hacer push (verificado el 19/10: ver PROGRESO.md). Al final, todo commiteado y pusheado en la rama de trabajo.

## 13. Benchmarks obligatorios antes y después
Números concretos (medianas, p95, tamaño de muestra): inicio de la app, primera carga del dashboard, navegación entre módulos, carga de contenido, búsqueda rápida, sugerencias con 3 letras, carga de historial, endpoints principales, scroll en listas extensas, operaciones frecuentes. Tabla obligatoria:

| Operación | Antes | Después | Mejora |
|---|---|---|---|
| Inicio de aplicación | | | |
| Carga de dashboard | | | |
| Cambio de módulo | | | |
| Búsqueda rápida | | | |
| Sugerencias con 3 letras | | | |
| Carga de historial | | | |
| Consulta API | | | |
| Renderizado de listas | | | |

Sin números inventados ni estimados; condiciones comparables. Conservar: 1) estado inicial, 2) tras optimización 1, 3) tras 2, 4) tras 3, 5) versión final tras la auditoría. Si algo empeora, investigar y corregir o revertir. Declarar explícitamente lo que no se pudo medir.

## 14. Criterios para considerar la aplicación finalizada
- [ ] Todas las etapas del plan están completas.
- [ ] Las funcionalidades existentes fueron preservadas.
- [ ] Todos los módulos están integrados.
- [ ] No existen botones conocidos que no cumplan su función.
- [ ] Los formularios y filtros funcionan correctamente.
- [ ] Las búsquedas funcionan y responden con rapidez.
- [ ] Los roles y permisos están correctamente aplicados.
- [ ] Las consultas y operaciones de base de datos mantienen su integridad.
- [ ] Las tres pasadas de rendimiento fueron realizadas.
- [ ] Existen benchmarks comparativos reales.
- [ ] Los 10 subagentes realizaron su auditoría.
- [ ] Los informes fueron consolidados.
- [ ] Los problemas críticos y altos reproducibles fueron corregidos.
- [ ] Se realizó la segunda ronda de validación.
- [ ] Los tests automatizados relevantes pasan.
- [ ] La aplicación compila correctamente.
- [ ] No existen errores graves conocidos sin documentar.
- [ ] Los cambios están commiteados.
- [ ] Los commits están pusheados en la rama correcta.
- [ ] No se realizó ningún merge a `main`.
Lo que no se pueda cumplir: explicar cuál, por qué y qué evidencia falta; no marcarlo.

## 15. Entrega final
Registro interno del progreso (PROGRESO.md). Informe final: 1) estado final (etapas y funcionalidades), 2) cambios (funcionales, visuales, arquitectónicos, técnicos), 3) auditoría de los 10 subagentes, 4) correcciones aplicadas, 5) rendimiento (tabla completa antes/después de las tres pasadas, ms y %), 6) búsqueda rápida (cómo se optimizó, qué tenía, cuánto tarda), 7) validación final (pruebas, cobertura, pendientes, limitaciones), 8) git (rama, commits, push, autodeploy, confirmación de que no hubo merge), 9) veredicto (si está lista para merge y deploy; no declarar éxito con críticos o pruebas esenciales pendientes).

## 16. Orden definitivo
1. Terminar la etapa 2. 2. Continuar con todas las etapas restantes. 3. Completar e integrar el sistema. 4. Primera pasada de rendimiento con benchmarks. 5. Segunda. 6. Tercera. 7. Optimizar y validar la búsqueda rápida. 8. Lanzar los 10 subagentes con cobertura completa. 9. Recibir y consolidar informes. 10. Implementar las correcciones justificadas. 11. Segunda validación con los subagentes. 12. Corregir lo restante y repetir pruebas. 13. Validación técnica y de rendimiento final. 14. Commits y push a la rama. 15. **NO HACER MERGE.** 16. Informe final con resultados verificables.

No detenerse entre etapas, no pedir confirmaciones innecesarias, no dar por finalizado porque compile. Ante límites de herramientas, tiempo o contexto: conservar el progreso verificable y dejar instrucciones precisas para reanudar. Nunca afirmar haber ejecutado tareas no realizadas. La única intervención reservada al dueño es el merge final.

## Agregado del 19/10: reglas de UX/UI
Todas las pantallas y la auditoría deben cumplir `docs/redesign/REGLAS-UX.md` (cosas que jamás tienen que pasar en una web + reglas innegociables de calidad y proceso de verificación).
