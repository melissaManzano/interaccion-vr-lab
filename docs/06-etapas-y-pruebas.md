# 6. Bitácora por etapas, instrucciones de prueba y limitaciones (3.2 Interacción virtual)

El Anexo A pide trabajar en siete etapas verificables y reportar en cada una:

- qué archivos se modificaron;
- cuál era el riesgo;
- qué decisiones se tomaron;
- cómo comprobarlas;
- qué fallas quedan abiertas.

Esta bitácora resume ese trabajo. El historial completo está en los commits del repositorio.

---

## Etapa 1 — Diagnóstico de la práctica 3.1

| | |
|---|---|
| **Archivos** | Solo lectura: todo `js/`, `index.html`, `README.md`, `docs/` |
| **Qué se conserva** | Sesión `immersive-vr` (`xrSession.js`, sustituye a VRButton), manos y rayo (`hands.js`), pinza con histéresis (`pinchDetector.js`), selección con prioridad (`selectables.js`), botones 3D, técnica del HUD por canvas, portada, favicon, créditos, rutas relativas y `.nojekyll`. Detalle en [docs/05](05-diseno-de-la-actividad.md#12-módulos-reutilizados) |
| **Problemas detectados** | La validación con *snap* y el arrastre que movía `mesh.position` directamente están prohibidos en la 3.2. El HUD y las reglas estaban pensados para 5 piezas fijas |
| **Riesgo** | Romper el seguimiento de manos ya probado en el visor |
| **Decisión** | No tocar `xr/`; reemplazar solo validación, arrastre y HUD |
| **Comprobación** | La 3.1 queda intacta en su repositorio y en la etiqueta `practica-3.1` |
| **Abierto** | — |

## Etapa 2 — Arquitectura, categorías, distribución y puntuación

| | |
|---|---|
| **Archivos** | `js/config.js`; carpetas nuevas `physics/`, `objects/`, `validation/`; [esquema-laboratorio.svg](esquema-laboratorio.svg) |
| **Decisiones** | Capas separadas (renderizado, física, generación, interacción, validación, marcador). Categorías: cubo, esfera, cilindro y prisma triangular, 5 de cada una. Cuatro mesas a los lados, un mostrador central con cuatro botes y el marcador detrás. Acierto solo con la pieza en reposo dentro del bote correcto. Una ficha única por figura |
| **Riesgo** | Una estructura monolítica difícil de probar |
| **Comprobación** | La lógica pura (`state`, `gameMachine`, `sortingRules`, `layoutGenerator`) se prueba con Node sin Three.js ni cannon-es |
| **Abierto** | — |

## Etapa 3 — Motor físico y colisionadores

| | |
|---|---|
| **Archivos** | `index.html` (import map con `cannon-es@0.20.0`), `physics/physicsWorld.js`, `physics/colliders.js`, `objects/objectFactory.js`, `objects/layoutGenerator.js`, `scene/labBuilder.js` |
| **Decisiones** | cannon-es (ES module sin dependencias). Paso fijo de 1/90 s con interpolación. Materiales por par. Colisionadores primitivos o convexos. Mesas con borde. Botes con base y 4 paredes. Las figuras aparecen 1 cm sobre la mesa |
| **Riesgo** | Explosiones por figuras encimadas; túneles a través de paredes delgadas |
| **Comprobación** | Las 20 figuras caen y quedan en reposo sobre la mesa (0.0 mm de desviación); 25 semillas sin solapes |
| **Falla encontrada y corregida** | cannon-es escribe valores por defecto en el objeto de opciones de `ContactMaterial`, y la configuración estaba congelada: la app no arrancaba. Se pasa una copia |
| **Abierto** | Sin CCD (ver limitaciones) |

## Etapa 4 — Pinza y manos ↔ cuerpos físicos

| | |
|---|---|
| **Archivos** | `physics/holdController.js`, `interaction/dragController.js`, `interaction/interactionManager.js`, `interaction/selectables.js`, `debug/desktopPreview.js` |
| **Decisiones** | Dinámico → **cinemático** al sujetar (sigue a la mano por velocidad) → dinámico al soltar, con velocidad promedio limitada. Barrido con rayo contra los estáticos. Agarre cercano (7 cm) y a distancia con "carrete" |
| **Riesgo** | Un cuerpo cinemático atraviesa mesas y paredes; lanzamientos extremos por el ruido del tracking |
| **Comprobación** | `body.type` 4 al sujetar y 1 al soltar. Empujada contra la mesa, su centro queda en la superficie (0.780 m) |
| **Abierto** | El barrido usa un rayo central: puede rozar esquinas unos milímetros. **NO PROBADO con manos reales** |

## Etapa 5 — Validación, errores, recuperación y marcador

| | |
|---|---|
| **Archivos** | `validation/sortingRules.js`, `validation/sortingMonitor.js`, `logic/gameMachine.js`, `core/state.js`, `ui/scoreboard.js`, `ui/binDisplays.js`, `audio/soundFx.js` |
| **Decisiones** | 7 estados observables. Validación tras 350 ms de reposo dentro del volumen útil. Error una sola vez por intento, con expulsión física. Precisión = aciertos ÷ intentos × 100 (0 % sin intentos). Tiempo por bote en segundos desde *Comenzar* («pendiente» antes). Recuperables en el suelo |
| **Fallas encontradas y corregidas** | (1) Las figuras expulsadas quedaban encajadas: 5 de 5 fallaban; con el material sin fricción, 6 de 6 salen. (2) Las esferas rodaban más de 2.6 m; con amortiguamiento, ~0.6 m. (3) Una torre de cubos sobresalía del borde y no contaba; se amplió el margen superior |
| **Comprobación** | 35 pruebas de lógica; 3 errores sin sumar aciertos; 20/20 con los cuatro tiempos |
| **Abierto** | — |

## Etapa 6 — Pruebas técnicas, instrucciones, favicon y créditos

| | |
|---|---|
| **Archivos** | `index.html`, `ui/landingUI.js`, `README.md`, `docs/`, `tests/logic.test.mjs` |
| **Decisiones** | Portada «3.2 Interacción virtual» con: compatibilidad (incluye cannon-es), botón *Reiniciar laboratorio*, preferencia de sonido (localStorage), referencia a la 3.1 y vista previa rotulada «NO inmersiva» |
| **Comprobación** | Chrome headless con el sitio **en una subruta**: 0 errores y 0 advertencias de consola y red |
| **Abierto** | — |

## Etapa 7 — Publicación y preparación de la validación en el Quest 3

| | |
|---|---|
| **Archivos** | Repositorio [interaccion-vr-lab](https://github.com/melissaManzano/interaccion-vr-lab) |
| **Comprobación** | El repositorio y https://melissamanzano.github.io/interaccion-vr-lab/ responden 200. El sitio publicado se cargó en Chrome sin errores |
| **Abierto** | **Pruebas 2, 3 y la parte VR de 10 y 18: NO PROBADAS** hasta ejecutarlas en el visor |

---

## Instrucciones de implementación y pruebas

**En la computadora:**

1. Abre la carpeta en VS Code → clic derecho en `index.html` → **Open with Live Server**.
2. F12 → **Console** (sin errores en rojo) y **Network** (`three.module.js`, `cannon-es.js` y los módulos de `js/` en 200).
3. En la **vista previa (NO inmersiva)**:
   - clic en *Comenzar*;
   - mantén el clic izquierdo sobre una figura;
   - usa la rueda para alejarla o acercarla;
   - suéltala sobre su recipiente.
4. Opcional: `node --test tests/logic.test.mjs` (debe dar 35/35).

**En el Meta Quest 3:**

1. Activa el seguimiento de manos (*Configuración → Movimiento → Seguimiento de manos*) y deja los mandos.
2. Abre https://melissamanzano.github.io/interaccion-vr-lab/ en Meta Quest Browser → **Entrar a VR**.
3. Recorre la matriz del README: pruebas 2, 3, 10 y 18 con las manos, y repite 8–17 a escala real.
4. Para ver la consola del visor: modo desarrollador + USB + `chrome://inspect` en la PC. FPS: *OVR Metrics Tool*.
5. Graba o captura:
   - las figuras sobre las mesas;
   - un depósito correcto;
   - tres errores;
   - una figura recuperada del suelo;
   - el panel final.

## Limitaciones técnicas pendientes

- **Sin CCD en cannon-es:** un lanzamiento muy rápido podría atravesar una pared de 2 cm. Se mitiga limitando la velocidad y recuperando las figuras que escapan.
- **Barrido de un solo rayo** en el agarre cinemático: puede haber un roce de milímetros en esquinas; el solver separa la figura al soltarla.
- **Manos sin colisionador propio:** las manos no empujan figuras; solo la figura sujeta lo hace.
- **Resistencia a la rodadura simulada** con amortiguamiento (cannon-es no la modela).
- **Paso fijo de 1/90 s** en lugar de los ~1/60 s sugeridos (justificado en docs/04; se cambia en la configuración).
- **Sin probar en el visor:** sensación del agarre cercano y del "carrete", sensibilidad de la pinza, filtro del gesto del sistema, recentrado de la vista y rendimiento real.

## Problemas reales (material para tus conclusiones)

La prueba 20 pide que **tú** describas dos problemas reales y escribas tus conclusiones. Estos son casos que ocurrieron durante el desarrollo, con datos medidos, para que elijas y los redactes con tus palabras:

1. **La física dejaba "atorada" la figura equivocada.**
   - Al expulsar una figura del bote equivocado, la fricción contra la pared y otra figura frenaba su subida (pasaba de 2.4 m/s a 0.84 m/s en un cuadro): 5 de 5 expulsiones fallaron.
   - Diagnóstico: registrar la trayectoria y la velocidad cuadro a cuadro.
   - Solución: un material sin fricción durante 0.6 s de la expulsión. Resultado: 6 de 6 salen.
2. **Las esferas rodaban por toda la sala.**
   - cannon-es no modela la resistencia a la rodadura: a 1 m/s una esfera recorría más de 2.6 m y seguía moviéndose a los 12 s.
   - Solución: amortiguamiento lineal 0.4 y angular 0.6 solo para esferas. Ahora se detiene en ~0.6 m.
3. **El cuerpo cinemático atraviesa los estáticos.**
   - Al cumplir el requisito de sujetar en modo cinemático, la figura dejaba de chocar con mesas y paredes.
   - Solución: un barrido con rayo que elimina la componente de la velocidad que entra en la superficie.
4. **La app no arrancaba por un detalle de la biblioteca.** cannon-es modifica el objeto de opciones que recibe, y la configuración estaba congelada (`Object.freeze`).

**Ideas para tus conclusiones:**

- diferencia entre ver un objeto (malla) y simularlo (cuerpo y colisionador);
- por qué validar en reposo y no al soltar;
- el valor de medir antes de ajustar parámetros;
- qué cambió al probar con manos reales en el visor.
