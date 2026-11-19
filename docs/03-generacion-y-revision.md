# 3. Generar la aplicación con un agente de IA y revisar la primera versión

Registro de cómo se generó la aplicación con un agente de IA (Claude, en Visual Studio Code), qué se verificó, qué errores se encontraron, qué se corrigió y cómo se comprobó cada cambio.

Fecha de la revisión: 19 de noviembre de 2026.

---

## 8. Uso del prompt de desarrollo con el agente

### 8.1 y 8.2 Prompt y propuesta de arquitectura

> **Completar por la autora.** Pega aquí, o enlaza, el prompt del ANEXO A que se entregó al agente, y resume la propuesta de arquitectura y el plan de desarrollo que devolvió, junto con las decisiones que aceptaste o cambiaste. El ANEXO A no está en el repositorio, así que esta revisión no pudo contrastarse línea por línea con él.

La arquitectura resultante y su justificación están en [02-webxr-y-arquitectura.md](02-webxr-y-arquitectura.md#7-arquitectura-y-flujo-de-interacción). La estructura de archivos la propuso el agente; la práctica no la impuso.

### 8.3 Cumplimiento de las restricciones

Cada restricción se verificó en el código, no en la descripción del agente:

| Restricción | Cómo se verificó | Resultado |
|---|---|---|
| **VR exclusiva** (`immersive-vr`, sin AR ni passthrough) | Búsqueda de `immersive-ar`, `passthrough` y cámaras en `js/` | ✅ Solo se pide `immersive-vr` ([xrSession.js](../js/xr/xrSession.js)); `immersive-ar` aparece únicamente en un comentario que dice que no se usa |
| **Meta Quest 3 con manos** | Revisión de [hands.js](../js/xr/hands.js) | ✅ `hand-tracking` como función opcional; los mandos se detectan y se ignoran con un aviso |
| **WebXR** | Revisión de la detección de soporte | ✅ `navigator.xr.isSessionSupported`, sin user-agent |
| **Bootstrap 5** | `index.html` y Network | ✅ Bootstrap 5.3.3 (CSS y JS) desde jsDelivr con `integrity` (SRI) |
| **JavaScript modular** | Auditoría de imports | ✅ 20 módulos ES; todos los imports relativos resuelven a archivos existentes, con las mayúsculas exactas |
| **GitHub Pages** | Rutas en HTML, CSS y JS; archivo `.nojekyll` | ✅ Todas las rutas son relativas (ninguna empieza por `/`); `.nojekyll` existe |
| **Sin backend** | Búsqueda de `fetch(`, `XMLHttpRequest`, `WebSocket`, `localStorage` | ✅ Ninguna llamada a servidor; todo son archivos estáticos |
| **Sin herramientas de compilación** | Búsqueda de `package.json`, `node_modules`, configs de Vite/Webpack | ✅ No existen. Las pruebas usan `node --test`, que viene con Node, y no forman parte de la app publicada |

### 8.4 Generación por etapas

> **Completar por la autora.** Anota las etapas en que pediste los archivos (por ejemplo: portada → escena → manos → reglas → HUD → pruebas) y lo que explicó el agente en cada una.

Cada módulo explica sus decisiones en un comentario de cabecera (por ejemplo, la histéresis en [pinchDetector.js](../js/xr/pinchDetector.js) o el *offset* de arrastre en [dragController.js](../js/interaction/dragController.js)). La forma de verificar cada parte está en la [sección 7.4 del documento 02](02-webxr-y-arquitectura.md#74-cómo-se-comprueba-que-el-proyecto-cumple-en-lugar-de-asumirlo).

---

## 9. El import map

### 9.1 El import map generado

```html
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"
  }
}
</script>
```

Está en el `<head>` de [index.html](../index.html), **antes** de `<script type="module" src="js/main.js">`.

### 9.2 Qué resuelve y por qué la versión debe ser compatible

**El problema.** El código escribe `import * as THREE from 'three'`. Para el navegador, `'three'` no es una ruta ni una URL, sino un *especificador desnudo* (*bare specifier*). Sin más información, el navegador no sabe qué descargar y lanza `Failed to resolve module specifier "three"`. En un proyecto con npm, un *bundler* traduce ese nombre a un archivo de `node_modules`. Aquí no hay npm ni *bundler*.

**La solución.** El import map es una tabla de traducción que el navegador consulta antes de resolver cada import:

| El código escribe | El navegador descarga |
|---|---|
| `'three'` | `https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js` |
| `'three/addons/webxr/XRHandModelFactory.js'` | `…/three@0.170.0/examples/jsm/webxr/XRHandModelFactory.js` |
| `'three/addons/controls/OrbitControls.js'` | `…/three@0.170.0/examples/jsm/controls/OrbitControls.js` |

- La entrada `"three"` es una **coincidencia exacta**.
- La entrada `"three/addons/"` termina en `/`, así que es un **prefijo**: lo que sigue se añade a la URL.
- Los imports relativos propios (`./config.js`, `../core/state.js`) **no** pasan por el mapa; se resuelven respecto al archivo que importa.

**Por qué conservar una versión compatible:**

1. **Una sola copia del núcleo.** Los addons importan `'three'` internamente, y el mismo mapa los dirige a la **misma** URL. Si el núcleo fuera 0.170.0 y los addons de otra versión (o de otro CDN), se cargarían dos copias de Three.js. Las comprobaciones `instanceof` fallarían entre ellas y aparecería el aviso *"Multiple instances of Three.js being imported"*.
2. **Las APIs cambian entre versiones.** Three.js no sigue versionado semántico: cada versión *r* puede renombrar o quitar funciones. Con una versión **fija** (`@0.170.0`, no `@latest`), el sitio funciona igual hoy y dentro de un año.
3. **Caché y reproducibilidad.** Una URL con versión fija siempre entrega el mismo archivo.

### 9.3 Organización modular, nombres y rutas

| Criterio | Resultado |
|---|---|
| Responsabilidades separadas | ✅ 9 carpetas por responsabilidad (`core`, `logic`, `scene`, `xr`, `interaction`, `ui`, `audio`, `debug`) más `config.js` y `main.js` |
| Nombres claros | ✅ `camelCase` descriptivo (`pinchDetector.js`, `assemblyRules.js`); funciones fábrica con el prefijo `create…` |
| Rutas relativas | ✅ Ninguna ruta interna empieza por `/` |
| Mayúsculas consistentes (GitHub Pages las distingue) | ✅ La auditoría automática no encontró ningún import cuyo nombre difiera del archivo real |
| Assets | ✅ Solo `assets/icons/favicon.svg`. Las piezas se generan con Three.js y los sonidos con Web Audio, así que no hay archivos que puedan dar 404 |
| Módulos huérfanos | ✅ Ninguno: todos los módulos se importan, salvo `main.js` y `bootGuard.js`, que carga `index.html` |

Observación menor: `distance3`, `findNearestTarget` (en `assemblyRules.js`) y `SESSION_INIT` (en `xrSession.js`) se exportan pero solo se usan dentro de su propio archivo. Se conservan porque documentan la API de las reglas y facilitan probarlas desde la consola.

### 9.4 Licencias, secretos, dependencias y duplicados

**Licencias:**

| Recurso | Licencia | Dónde se acredita |
|---|---|---|
| Código del proyecto | MIT (© 2026 Melissa Manzano) | `LICENSE` |
| Three.js r170 | MIT | README y pie de la portada |
| Bootstrap 5.3.3 | MIT | README y pie de la portada |
| Modelos de mano (WebXR Input Profiles) | MIT | README y pie de la portada |
| Favicon | Propio (SVG escrito para el proyecto) | — |
| Sonidos | Sintetizados en tiempo de ejecución; sin archivos de terceros | README |

**Resto de comprobaciones:**

- **Secretos.** Se buscaron `api_key`, `token`, `secret`, `password`, `bearer` y `sk-`: no hay ninguno. La única coincidencia es un comentario que dice "no expone secretos".
- **Dependencias externas.** Solo tres: Three.js, Bootstrap y los perfiles de mano que carga `XRHandModelFactory`. No hay librerías que no se usen.
- **Código duplicado.** El texto sobre canvas está centralizado en [canvasText.js](../js/ui/canvasText.js); las geometrías se comparten entre cada pieza y su silueta; manos y mouse comparten la misma lógica de interacción mediante "fuentes de puntero". No se encontraron bloques repetidos.

---

## 10. Ejecución, revisión y mejora

### 10.1 y 10.2 Revisión en el navegador (Console y Network)

**Método.** El sitio se sirvió en `http://127.0.0.1:5500/`, el mismo origen que usa Live Server, y se abrió en Chrome controlado por el protocolo de DevTools. Así se registraron automáticamente los mensajes de **Console**, las respuestas de **Network** y capturas de pantalla, y la comprobación se puede repetir. El mismo procedimiento se puede hacer a mano con F12.

**Resultados:**

| Comprobación | Resultado |
|---|---|
| Errores en Console | **0** errores y 0 excepciones |
| Respuestas de Network | **35 recursos, todos con 200** (sin 404 ni CORS) |
| Versión de Three.js | `three@0.170.0`; la portada muestra "Cargado (r170)" |
| Copias del núcleo | `three.module.js` se descarga **1 sola vez** |
| Addons resueltos por el import map | `OrbitControls`, `XRHandModelFactory`, `XRHandMeshModel`, `XRHandPrimitiveModel`, `GLTFLoader`, `BufferGeometryUtils` (todos 0.170.0) |
| Bootstrap | CSS y JS 5.3.3 con 200; el acordeón funciona (`bootstrap.Collapse` disponible) |
| Favicon | `assets/icons/favicon.svg` con 200 |
| Compatibilidad en PC | Three.js ✓, contexto seguro ✓, WebXR ✓, immersive-vr ⚠ "No disponible en este dispositivo", botón "VR no disponible aquí" (comportamiento esperado sin visor) |
| Responsivo (390 px de ancho) | Sin desbordamiento horizontal (`scrollWidth` = 390) |
| Vista previa 3D | Mesa, 5 piezas, 5 siluetas, panel HUD y botones visibles; lienzo de 1114×626 |
| Estado → portada | Al tomar una pieza: "0/5 · Activo · 00:01"; una segunda mano no puede tomarla; al reiniciar: "0/5 · Pendiente · 00:00" |
| Pruebas de lógica | `node --test tests/logic.test.mjs`: **20/20** |

### 10.3 Errores encontrados y correcciones

#### Cambio 1. Las etiquetas de los destinos quedaban tapadas y una era ilegible

- **Qué se observó.** En la vista previa, las letras flotantes de las piezas (A–E) tapaban las etiquetas de los destinos ("C · Cono", "A · Cubo"…). Además, "E · Prisma triangular" se comprimía hasta no poder leerse.
- **Por qué importa.** El requisito pide que cada pieza y su destino se reconozcan por **forma, color y letra**. Si la etiqueta no se lee, falta una de las tres señales.
- **Causa.** La etiqueta estaba sobre la mesa, **entre** la fila de piezas y la de destinos, y las letras de las piezas flotan más alto. Cuanto más baja está la vista, más se solapan. El cálculo con la geometría de [config.js](../js/config.js) muestra que de pie (ojos a ~1.6 m) no se solapan: las letras se ven a ~57° hacia abajo y las etiquetas a ~49°. **Sentado** (ojos a ~1.2 m), que la portada declara como postura válida, sí se solapan: ~32° frente a ~29°. Lo de "Prisma triangular" se debía a que el texto no cabía en un lienzo de 320 px y `fillText` lo comprimía.
- **Qué cambió** ([labBuilder.js](../js/scene/labBuilder.js), `createTarget`). La etiqueta pasó a ser un **rótulo elevado** a 20 cm sobre la mesa, 4 cm detrás del centro de la silueta e inclinado hacia el usuario. Así queda por encima de la pieza más alta (10 cm) y del indicador ✓. Se ensanchó de 15 a 19 cm (lienzo de 400×96, fuente de 36 px); con destinos separados 22 cm, quedan 3 cm entre rótulos.
- **Cómo se comprobó.** Con una captura de la vista previa antes y después: las cinco etiquetas se leen completas y nada las tapa. Por cálculo, el rótulo queda separado de las letras de las piezas y del ✓, tanto de pie como sentado.
- **Pendiente.** Confirmarlo en el Quest, de pie y sentado.

#### Cambio 2. El botón deshabilitado parecía una acción disponible

- **Qué se observó.** "VR no disponible aquí" conservaba el color de acción (cian) con 65 % de opacidad y se confundía con un botón activo.
- **Qué cambió** ([styles.css](../css/styles.css)). Cuando el botón está deshabilitado y **no** está cargando (`:disabled:not([aria-busy="true"])`), se muestra en escala de grises y con 55 % de opacidad. Mientras carga o inicia la sesión conserva el color, para indicar progreso.
- **Cómo se comprobó.** El estilo calculado en el navegador da `opacity: 0.55` con el botón deshabilitado; la captura muestra el botón en gris.

#### Cambio 3. El README mencionaba pruebas automatizadas que no existían

- **Qué cambió.** Se añadió [tests/logic.test.mjs](../tests/logic.test.mjs) con 20 pruebas de las reglas de negocio, y se actualizó el README con el comando para ejecutarlas.
- **Cómo se comprobó.** `node --test tests/logic.test.mjs` da 20/20, antes y después de los cambios 1 y 2.

### 10.4 Revisión inicial de requisitos antes de usar el visor

| Requisito | Estado | Evidencia |
|---|---|---|
| Portada responsiva con favicon, créditos y compatibilidad | ✅ Verificado en escritorio | Capturas a 1280 px y 390 px; Network 200 |
| Carga sin errores con Live Server | ✅ Verificado | Console: 0 errores; Network: 35/35 con 200 |
| Import map con Three.js 0.170.0 y addons | ✅ Verificado | Network: una sola copia del núcleo |
| 5 piezas y 5 destinos distinguibles (forma, color, letra) | ✅ Verificado en la vista previa (tras el cambio 1) | Captura de la mesa |
| Reglas: acierto, destino incorrecto, distancia excesiva, fuera de zona | ✅ Verificado por pruebas | 7 pruebas de `assemblyRules` |
| Contador sin duplicados, bloqueo, cronómetro, Reiniciar | ✅ Verificado por pruebas y en la portada | 8 pruebas de estado y máquina; flujo en el navegador |
| Detección de soporte VR | ✅ En PC indica correctamente "no disponible" | Lista de compatibilidad |
| Publicación en GitHub Pages | ⏳ Pendiente | Aún no hay repositorio (`git init` sin hacer) |
| Sesión VR real, manos, pinza, arrastre, botones 3D | ⏳ Pendiente: requiere el Quest | Matriz del README, pruebas 5–7 y 9–14 |
| Legibilidad de los rótulos sentado y de pie | ⏳ Pendiente: requiere el Quest | Cambio 1 |
| Sensibilidad de la pinza y filtro de la palma | ⏳ Pendiente: requiere el Quest | `config.js → pinch` |

**Conclusión:** la primera versión está lista para pasar a la prueba inmersiva. Todo lo que se puede verificar sin visor está verificado, y lo que falta está identificado y depende del hardware o de la publicación.
