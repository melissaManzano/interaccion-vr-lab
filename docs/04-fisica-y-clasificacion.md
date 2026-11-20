# 4. Física, clasificación y marcador (práctica 3.2)

Documento técnico de la ampliación **3.2 Interacción virtual**. Explica la elección del motor de física, las versiones fijadas y el import map, los colisionadores de cada figura, cómo se sostiene una figura sin romper la física, cómo se validan aciertos y errores, y qué se verificó.

La práctica 3.1 (sesión WebXR, seguimiento de manos, pinza) sigue documentada en [02-webxr-y-arquitectura.md](02-webxr-y-arquitectura.md) y [03-generacion-y-revision.md](03-generacion-y-revision.md). Esos módulos se conservaron sin cambios: `xr/hands.js`, `xr/pinchDetector.js` y `xr/xrSession.js`.

---

## 1. Elección del motor de física

| Criterio | **cannon-es 0.20.0** (elegido) | Rapier (`@dimforge/rapier3d-compat`) | ammo.js | Oimo.js |
|---|---|---|---|---|
| Carga sin bundler | ✅ Un solo archivo ES module en jsDelivr | ⚠️ Necesita inicializar WASM (`await RAPIER.init()`) | ❌ Build Emscripten, no es ES module | ⚠️ Sin build ESM oficial |
| Dependencias | Ninguna | Ninguna (WASM incrustado, ~1.5 MB) | Ninguna (~1.9 MB) | Ninguna |
| Tamaño | ~340 KB sin comprimir | ~1.5 MB | ~1.9 MB | ~200 KB |
| API | JavaScript, unidades SI, ejes iguales a Three.js | Excelente, pero más verbosa | API de C++ traducida (gestión manual de memoria) | Simple |
| Mantenimiento | Fork mantenido por pmndrs (de cannon.js) | Activo | Poco activo | Abandonado |
| Licencia | MIT | Apache-2.0 | zlib | MIT |

**Por qué cannon-es:**

- Se importa con una línea en el import map, sin `npm`, sin bundler y sin un paso asíncrono de inicialización. Cumple la restricción de publicar solo archivos estáticos en GitHub Pages.
- Tiene todo lo que pide la práctica: gravedad, cuerpos rígidos dinámicos y estáticos, fricción y rebote por par de materiales, cuerpos compuestos (para recipientes abiertos y mesas con borde), sueño de cuerpos en reposo y eventos de colisión.
- Usa metros, kilogramos y segundos, y su eje Y apunta hacia arriba, igual que Three.js y WebXR (`local-floor`). Las posiciones se copian sin conversiones.
- Con 20 cuerpos dinámicos y 10 estáticos, su costo por cuadro es muy bajo en el Quest 3.

**Desventaja conocida:** es menos preciso que Rapier con objetos muy rápidos (no tiene CCD). Se mitiga con paso fijo de 1/90 s, paredes de 2 cm, una velocidad máxima al sostener (5 m/s) y otra al soltar (3.5 m/s). Además, cualquier figura que escape de la sala se recupera.

## 2. Versiones fijadas e import map

```html
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/",
    "cannon-es": "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js"
  }
}
</script>
```

| Biblioteca | Versión | Por qué esa versión |
|---|---|---|
| Three.js | 0.170.0 (r170) | La misma de la práctica 3.1: no se cambia lo que ya se probó con manos en el visor |
| cannon-es | 0.20.0 | Última versión publicada; `dist/cannon-es.js` es ES module y no importa nada más |
| Bootstrap | 5.3.3 | Portada (con SRI `integrity`) |

- **Sin rangos** (`@0.20`, `@latest`): una versión nueva no puede romper el sitio publicado.
- **Mismo CDN** para todo: un solo origen que revisar en *Network*.
- cannon-es no importa a Three.js ni al revés, así que no hay riesgo de duplicar núcleos.
- Si el CDN de cannon-es falla, `bootGuard.js` marca *Motor de física* en rojo en la portada y muestra un mensaje.

## 3. Arquitectura por capas

```
js/
├── scene/        RENDERIZADO      sceneSetup.js (renderer, luces, sala) · labBuilder.js (mesas, mostrador, recipientes)
├── physics/      FÍSICA           physicsWorld.js (mundo, materiales, estáticos) · colliders.js · holdController.js
├── objects/      GENERACIÓN       objectFactory.js (malla + cuerpo por figura) · layoutGenerator.js (reparto aleatorio)
├── interaction/  INTERACCIÓN      selectables.js · dragController.js · interactionManager.js
├── validation/   VALIDACIÓN       sortingRules.js (funciones puras) · sortingMonitor.js (observa la física)
├── ui/           MARCADOR         scoreboard.js · binDisplays.js · vrButtons.js · landingUI.js
├── logic/        gameMachine.js (máquina de estados) · timer.js
├── core/         state.js (estado único)
└── xr/           hands.js · pinchDetector.js · xrSession.js  (sin cambios desde 3.1)
```

**Regla de dependencias:**

- `validation/sortingRules.js`, `objects/layoutGenerator.js`, `logic/*` y `core/state.js` no importan Three.js ni cannon-es. Se prueban con Node.
- `physics/` no importa Three.js (salvo `colliders.js`, que crea la malla y el colisionador juntos para que no diverjan).
- La **física manda** sobre la posición: la malla solo copia la pose interpolada del cuerpo (`objects.sync()`). Nada se anima "a mano".

**Ciclo de cada cuadro** (`main.js`):

```
manos/mouse → pinza → objetivos de agarre → hold.apply() → physics.step(dt)
→ objects.sync() → monitor.update(dt) → apariencia, marcador → render
```

## 4. Figuras y colisionadores

Clases elegidas: **cubo, esfera, cilindro y prisma triangular**, con 5 figuras de cada una (20 en total). Cada clase se identifica por **forma + color + letra**, y se evitan el rojo y el verde puros, reservados para error y acierto.

| Clase | Medidas | Masa | Malla (Three.js) | Colisionador (cannon-es) | Exactitud |
|---|---|---|---|---|---|
| A · Cubo (naranja) | lado 6 cm | 120 g | `BoxGeometry(0.06³)` | `Box(0.03, 0.03, 0.03)` | Exacto |
| B · Esfera (azul) | radio 3.4 cm | 100 g | `SphereGeometry(r, 24, 16)` | `Sphere(0.034)` | Exacto (analítico) |
| C · Cilindro (rosa) | r 3 cm, h 7 cm | 110 g | `CylinderGeometry(r, r, h, 16)` | `Cylinder(r, r, h, 16)` | Poliedro de 16 lados = misma malla |
| D · Prisma triangular (morado) | r 4.2 cm, h 6 cm | 100 g | `CylinderGeometry(r, r, h, 3)` | `Cylinder(r, r, h, 3)` | Exacto: mismos 3 vértices (0°, 120°, 240°) |

**Por qué no Trimesh:** cannon-es no resuelve bien el contacto entre dos mallas arbitrarias. Las primitivas y los poliedros convexos son estables y baratos.

**Estáticos:**

| Elemento | Colisionador | Material |
|---|---|---|
| Suelo | `Plane` infinito (girado −90° en X) | suelo |
| 4 mesas 55 × 55 cm | Cuerpo compuesto: tablero `Box` + 4 bordes `Box` de 2.5 cm (evitan que las esferas rueden fuera) | mesa |
| Mostrador 130 × 45 cm | `Box` | mesa |
| 4 recipientes abiertos 27 × 27 × 14 cm | Cuerpo compuesto: fondo + 4 paredes `Box` de 2 cm, **sin tapa** | recipiente |

**Fricción y rebote** (`config.physics.materials`):

| Par | Fricción | Rebote |
|---|---|---|
| figura–figura | 0.40 | 0.25 |
| figura–mesa | 0.50 | 0.20 |
| figura–recipiente | 0.45 | 0.15 |
| figura–suelo | 0.60 | 0.35 |

La esfera tiene más amortiguamiento angular (0.35) para que no ruede indefinidamente.

## 5. Sostener una figura sin romper la física

Hay tres formas de mover un objeto físico con la mano:

| Opción | Problema |
|---|---|
| Copiar la posición de la mano al cuerpo | Atraviesa mesas y paredes; al soltar no tiene velocidad (no se puede lanzar) |
| Convertirlo en cuerpo cinemático | Empuja a los demás, pero nada lo detiene: atraviesa los estáticos |
| **Controlarlo por velocidad** (elegida) | Ninguno relevante |

[holdController.js](../js/physics/holdController.js) mantiene la figura como cuerpo **dinámico** y, antes de **cada subpaso** (evento `postStep` de cannon-es), le asigna:

```
v = (objetivo − posición) × 18   (máximo 5 m/s)
```

El solver de contactos corre después, así que la figura choca de verdad contra mesas, paredes y otras figuras, y las empuja. Al soltar conserva la velocidad de la mano (máximo 3.5 m/s).

**De dónde sale el objetivo** ([dragController.js](../js/interaction/dragController.js)):

- **Agarre cercano:** si la pinza se cierra a menos de 7 cm del centro de una figura, se toma directamente "con la mano" y queda pegada a los dedos.
- **Agarre a distancia (rayo):** la distancia del rayo queda fija al agarrar, y **estirar o recoger el brazo** la cambia ×2.5 (técnica de "carrete"). Así una figura de una mesa lateral se trae hasta los recipientes sin caminar. En la vista previa de escritorio, la rueda del mouse cumple el mismo papel.

## 6. Validación: aciertos, errores y tiempos

**Soltar no valida.** La figura cae por gravedad y [sortingMonitor.js](../js/validation/sortingMonitor.js) la observa cada cuadro. Se considera depositada cuando se cumplen dos condiciones:

1. su centro está dentro del volumen interior de un recipiente (con 10 cm de margen sobre el borde, por si queda en una pila), y
2. lleva **350 ms** casi quieta (velocidad < 0.12 m/s) o el motor ya la durmió.

Así, un rebote que la saca del recipiente no cuenta, y una figura lanzada que cae dentro sí cuenta.

| Resultado | Efecto |
|---|---|
| ✅ Recipiente correcto | +1 total y +1 en el recipiente, destello verde en figura y borde, sonido, figura bloqueada |
| ❌ Recipiente equivocado | +1 error, destello rojo, sonido grave, mensaje con el recipiente correcto y **expulsión física** |
| 🏁 Recipiente lleno (5/5) | Se guarda su **tiempo de llenado** (cronómetro global en ese momento), borde verde y sonido |
| 🏆 20/20 | Fase *Completado*, se detiene el cronómetro y se muestra el resumen |

**Expulsión.** Es un impulso real (Δv de 2.4 m/s hacia arriba y 0.8 m/s hacia el usuario), no una animación. Durante 0.6 s la figura usa un material **sin fricción**. Sin él, en las pruebas la figura quedaba encajada entre otra figura y la pared, y la fricción lateral frenaba su subida: 5 de 5 expulsiones fallaban. Con él, 6 de 6 salieron.

**Sin dobles conteos:**

- Una figura clasificada no se puede volver a tomar ni contar.
- Un error se cuenta **una vez por intento**: si la figura equivocada recae en el mismo recipiente, se vuelve a expulsar sin sumar otro error. Volver a tomarla abre un intento nuevo.

**Precisión** = aciertos ÷ (aciertos + errores). Antes del primer intento muestra "—", no 0 %.

## 7. Reinicio aleatorio

[layoutGenerator.js](../js/objects/layoutGenerator.js) baraja las 20 figuras con Fisher–Yates y las reparte 5 por mesa. En cada mesa elige 5 de 6 ranuras al azar y les añade ±1.5 cm de variación y un giro aleatorio. Las ranuras están separadas 15–17 cm, así que las figuras nunca aparecen encimadas (no hay "explosiones" de física). Aparecen 1 cm sobre la mesa y la gravedad las asienta.

El generador aleatorio se inyecta: la app usa `Math.random` y las pruebas usan una semilla fija (`createRng`) para obtener resultados reproducibles.

## 8. Marcador 3D

- **Panel principal** ([scoreboard.js](../js/ui/scoreboard.js)), sobre el mostrador:
  - estado del reto;
  - **clasificadas X/20**, **tiempo global**, **errores** y **precisión**;
  - una fila por recipiente con letra y color, barra de 5 segmentos, **0/5** y **tiempo de llenado**;
  - mensaje de retroalimentación y estado de las manos.
- **Pantalla por recipiente** ([binDisplays.js](../js/ui/binDisplays.js)): 0/5 y tiempo de llenado justo donde se mira al depositar.
- **Rendimiento:** los canvas solo se redibujan cuando cambia el texto.

## 9. Accesibilidad y comodidad

- **Identificación redundante:** forma, color, letra, nombre y silueta flotante en cada recipiente. No depende solo del color.
- **Sin rojo ni verde** en las clases: esos colores se reservan para error y acierto. Además, el resultado también se comunica con sonido y texto.
- **Alcance sin moverse:** todo se puede hacer de pie o sentado, gracias al rayo y al "carrete". No hay locomoción artificial (evita mareo).
- **Texto grande y de alto contraste** en el marcador. Los mensajes indican qué hacer, no solo qué falló.
- **Portada:** lista de clases y resumen (con avance por recipiente) en HTML accesible, `aria-live` en el estado y foco visible.

## 10. Verificación realizada

**Pruebas de lógica.** `node --test tests/logic.test.mjs`: **31 pruebas, 31 pasan** (Node 24). Cubren:

- configuración 4 × 5;
- volumen de los recipientes;
- acierto y error;
- no contar dos veces;
- expulsión repetida sin otro error;
- precisión;
- tiempo de llenado;
- flujo 0/20 → 20/20;
- reinicio;
- pausa al salir de VR;
- distribución reproducible y sin encimarse (25 semillas);
- pinza.

**Prueba en navegador real.** Chrome headless controlado por el protocolo DevTools, con la app servida en local:

| Comprobación | Resultado observado |
|---|---|
| Carga de módulos e import map | Sin errores de consola ni de red; *Three.js* y *cannon-es* en verde |
| Gravedad | Las 20 figuras caen y se asientan sobre las mesas (desviación 0.0 mm) y se duermen; 5 por mesa |
| Agarre real con el mouse | Rayo → *en mano* → la figura viaja por velocidad de la mesa 4 al recipiente A → se suelta, cae y cuenta como acierto (1/20, cronómetro en marcha) |
| Colisión con el borde | Una figura soltada 3 mm sobre la pared frontal se volcó hacia afuera y cayó al suelo (física correcta, no cuenta) |
| Error y expulsión | Esfera y 5 cilindros en el recipiente de cubos: 6 errores contados una vez cada uno; las 6 figuras salieron del recipiente |
| Llenado | 5 cubos en R1 → 5/5 con tiempo de llenado registrado y borde verde |
| Reinicio aleatorio | 0/20, 0 errores, recipientes en 0, fase *Pendiente*, cronómetro en 0, distribución distinta, las 20 sobre las mesas |

**Pendiente de verificar en el Quest 3** (requiere el visor): sensación del agarre cercano y del "carrete", estabilidad con las manos reales, FPS (*OVR Metrics Tool*) y que la expulsión no moleste al usuario. Ver la matriz del README.

## 11. Licencias de recursos

| Recurso | Licencia | Uso |
|---|---|---|
| Three.js r170 | MIT | Renderizado, WebXR, manos |
| cannon-es 0.20.0 | MIT | Física |
| Bootstrap 5.3.3 | MIT | Portada |
| WebXR Input Profiles | MIT | Mallas de las manos (vía `XRHandModelFactory`) |
| Figuras, mesas, recipientes | Propios | Geometría generada en código, sin modelos descargados |
| Sonidos | Propios | Sintetizados con Web Audio API, sin archivos |
