# Laboratorio virtual de manipulación y ensamblaje 3D

Aplicación web de **realidad virtual inmersiva** para **Meta Quest 3**. Con **seguimiento de manos** (sin mandos), el usuario selecciona, arrastra y ensambla cinco piezas geométricas en sus cinco destinos.

- **Materia:** Desarrollo de Ambientes Virtuales — 3.1 Introducción a las aplicaciones VR
- **Autora:** Melissa Manzano
- **Tecnologías:** HTML5, CSS3, Bootstrap 5.3.3, JavaScript (módulos ES), Three.js r170, WebXR Device API
- **Sitio publicado:** https://melissamanzano.github.io/laboratorio-vr-ensamblaje/
- **Repositorio:** https://github.com/melissaManzano/laboratorio-vr-ensamblaje
- **Video de demostración:** *(agregar enlace)*

---

## 1. Requisitos

| Para | Necesitas |
|---|---|
| Desarrollar | Visual Studio Code, la extensión **Live Server** y Git |
| Publicar | Una cuenta de GitHub (repositorio público) |
| Probar en VR | Meta Quest 3, **Meta Quest Browser** actualizado y el **seguimiento de manos activado** (*Configuración → Movimiento → Seguimiento de manos*) |

**No se usan** Node.js, npm, bundlers, frameworks ni backend. Todo son archivos estáticos.

## 2. Ejecutar en local (Live Server)

1. Abre la carpeta del proyecto en VS Code.
2. Haz clic derecho en `index.html` y elige **Open with Live Server** (o pulsa **Go Live**).
3. Se abre `http://127.0.0.1:5500/`.

> No abras `index.html` con doble clic (`file://`): los módulos ES y el import map fallan por CORS.

En la PC, el botón muestra **"VR no disponible aquí"**, y es lo normal. La sección **Vista previa de depuración** permite probar la lógica con el mouse:

- **Clic izquierdo** toma o suelta piezas y pulsa botones.
- **Clic derecho y arrastrar** gira la cámara.
- **La rueda** acerca o aleja.

> ⚠️ El `localhost` de la PC **no es** el `localhost` del visor. Las pruebas con manos se hacen en el Quest **con la URL HTTPS de GitHub Pages**.
> (Opcional) La extensión **Immersive Web Emulator** de Meta para Chrome simula un visor en el escritorio.

## 3. Publicar en GitHub Pages

```bash
git init -b main
git add .
git commit -m "Laboratorio VR de ensamblaje 3D"
git remote add origin https://github.com/<usuario>/laboratorio-vr-ensamblaje.git
git push -u origin main
```

1. En GitHub, ve a **Settings → Pages**.
2. En **Source** elige **Deploy from a branch**, **Branch: `main`**, carpeta **`/ (root)`** y pulsa **Save**.
3. Espera uno o dos minutos y abre `https://<usuario>.github.io/laboratorio-vr-ensamblaje/`.
4. En el Quest, abre esa URL en Meta Quest Browser y pulsa **Entrar a VR**.

El archivo `.nojekyll` (vacío) evita que GitHub Pages procese el sitio con Jekyll.

### Rutas en GitHub Pages

GitHub Pages publica el sitio bajo `/laboratorio-vr-ensamblaje/`. Por eso **todas** las rutas internas son relativas, como `css/styles.css`, `js/main.js` o `assets/icons/favicon.svg`. Si una ruta empezara con `/`, apuntaría a la raíz del dominio y daría **404**.

GitHub Pages **distingue mayúsculas de minúsculas** y Windows no. Un import `./Ui/vrPanel.js` funciona en Windows y falla al publicar.

## 4. Controles (dentro de VR)

| Acción | Gesto |
|---|---|
| Apuntar | Cada mano proyecta un rayo desde el punto entre el pulgar y el índice |
| Tomar | Pinza (índice + pulgar) mientras apuntas a una pieza |
| Arrastrar | Mantén la pinza y mueve la mano |
| Soltar y validar | Abre los dedos |
| Reiniciar o salir | Apunta al botón 3D y haz la pinza |

Colores del rayo: **blanco** sin objetivo, **celeste** sobre una pieza, **amarillo** sobre un botón y **verde** mientras arrastras.

> La pinza con la **palma hacia ti** es el gesto del sistema Meta (abre el menú). La app la ignora.

## 5. Reglas del laboratorio

| Pieza | Forma | Color | Destino |
|---|---|---|---|
| A | Cubo | Naranja | Silueta de cubo + "A · Cubo" |
| B | Esfera | Azul | Silueta de esfera + "B · Esfera" |
| C | Cono | Amarillo | Silueta de cono + "C · Cono" |
| D | Cilindro | Rosa | Silueta de cilindro + "D · Cilindro" |
| E | Prisma triangular | Morado | Silueta de prisma + "E · Prisma triangular" |

Cada pieza se reconoce por **forma, color y letra**, no solo por color. El rojo y el verde se reservan para error y acierto.

La validación ocurre **solo al soltar**. Primero se busca el destino más cercano dentro de `detectionRadius`:

| Resultado | Condición | Efecto |
|---|---|---|
| ✅ Acierto | Destino correcto y distancia ≤ `tolerance` | Snap de posición y orientación, sonido, verde y ✓, pieza bloqueada, +1 |
| ❌ Destino incorrecto | El destino más cercano no es el suyo | Destello rojo, sonido grave y mensaje. No suma |
| ❌ Distancia excesiva | Es su destino, pero la distancia está entre `tolerance` y `detectionRadius` | Destello rojo y mensaje con los cm. No suma |
| ↩ Fuera de zona | No hay ningún destino cerca | La pieza vuelve a su lugar |

**Qué mide la distancia:** la separación euclidiana 3D, en metros, entre el **centro de la pieza** y el **punto de anclaje** del destino, que es donde quedaría el centro de la pieza bien colocada.

Los valores se ajustan en `js/config.js`, sin tocar la lógica:

```js
rules: { tolerance: 0.08, detectionRadius: 0.2, errorFlashMs: 1200, messageMs: 3500 }
```

**Indicadores:**

- **Contador:** va de 0/5 a 5/5. Se calcula a partir del estado de las piezas, así que no puede duplicarse.
- **Cronómetro:** arranca con el primer agarre, se pausa fuera de VR y se detiene al completar.
- **Estados:** Pendiente, Activo, Error (breve) y Completado.

## 6. Arquitectura

```
index.html              Portada Bootstrap + import map + carga de módulos
css/styles.css          Estilos propios de la portada
assets/icons/           Favicon (SVG)
js/
├── bootGuard.js        Script clásico: muestra un error si el CDN o los módulos fallan
├── main.js             Punto de entrada: conecta módulos y ejecuta el ciclo de render
├── config.js           Medidas, reglas, piezas y destinos (un solo lugar para ajustar)
├── core/state.js       Estado central único (piezas, fase, cronómetro, XR, mensajes)
├── logic/
│   ├── assemblyRules.js  Validación PURA al soltar (sin Three.js; se puede probar sola)
│   ├── gameMachine.js    Máquina de estados del reto
│   └── timer.js          Cronómetro con pausa/reanudación
├── scene/
│   ├── sceneSetup.js     Renderer, cámara, luces, piso delimitado y sala
│   └── labBuilder.js     Mesa, piezas, destinos y su apariencia
├── xr/
│   ├── xrSession.js      Detección de soporte y ciclo de vida de immersive-vr
│   ├── hands.js          Manos izq./der., modelos, rayos y pérdida de tracking
│   └── pinchDetector.js  Pinza por articulaciones con histéresis + filtro del gesto del sistema
├── interaction/
│   ├── selectables.js    Lista cerrada de objetos seleccionables con prioridad (botón > pieza)
│   ├── dragController.js Arrastre con offset, suavizado y límites
│   └── interactionManager.js  Une manos/mouse, raycast, botones y juego
├── ui/
│   ├── vrPanel.js        HUD 3D (canvas → textura): título, 0/5, tiempo, estado, mensajes
│   ├── vrButtons.js      Botones 3D Reiniciar / Salir de VR
│   ├── canvasText.js     Utilidades de texto en canvas
│   └── landingUI.js      Portada HTML: compatibilidad, errores, objetivos, resumen
├── audio/soundFx.js    Sonidos sintetizados con Web Audio (sin archivos)
└── debug/desktopPreview.js  Vista previa con mouse (solo escritorio)
tests/logic.test.mjs    Pruebas de reglas de negocio con Node (no se publican como parte de la app)
docs/                   Documentos de diseño (WebXR, seguimiento de manos, arquitectura y verificación)
```

El razonamiento de esta arquitectura y el flujo de interacción están en [docs/02-webxr-y-arquitectura.md](docs/02-webxr-y-arquitectura.md). La revisión de la primera versión (restricciones, import map, licencias, Console/Network y correcciones) está en [docs/03-generacion-y-revision.md](docs/03-generacion-y-revision.md).

**Decisiones principales:**

- **Las reglas no dependen de Three.js.** Son funciones puras, así que se prueban sin visor y es fácil razonar sobre ellas.
- **Hay un solo estado central.** El HUD y la portada solo leen; nadie guarda su propio contador.
- **Manos y mouse son "fuentes de puntero" con la misma forma.** Toda la interacción se programa una sola vez.
- **No se descargan modelos.** Todo se genera con Three.js, salvo la malla de las manos, que viene de WebXR Input Profiles. Si ese CDN falla, en `config.js` se cambia `hands.modelProfile` a `'spheres'`.
- **Los sonidos se sintetizan.** No hay archivos que puedan dar 404 ni licencias que gestionar.

### El import map

```html
<script type="importmap">
{ "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"
} }
</script>
```

El navegador no sabe qué es `import * as THREE from 'three'`, porque `'three'` es un nombre y no una ruta. El import map le dice a qué URL corresponde.

- **Prefijo de addons.** La entrada `"three/addons/"` termina en `/`, así que funciona como prefijo: `three/addons/webxr/XRHandModelFactory.js` se convierte en `…/examples/jsm/webxr/XRHandModelFactory.js`.
- **Una sola copia del núcleo.** Los addons también importan `'three'` internamente y el mapa los manda a la **misma** URL. Si hubiera dos versiones distintas, aparecería "Multiple instances of Three.js".
- **Posición en el HTML.** Debe ir **antes** de cualquier `<script type="module">`.
- **Imports propios.** Los imports locales (`./config.js`, `../core/state.js`) son relativos al archivo que importa y no pasan por el mapa.

## 7. Seguimiento de manos: detalles técnicos

- **Sesión.** Se usa `immersive-vr` con `optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking']`. Las manos son *opcionales* para que la sesión abra igual y el HUD pueda avisar si no hay manos. No se usa AR, passthrough ni cámaras.
- **Pinza.** Se calcula la distancia entre las articulaciones `index-finger-tip` y `thumb-tip`:
  - se **cierra** por debajo de 2 cm y se **abre** por encima de 3.5 cm (histéresis);
  - no depende de `selectstart`/`selectend`; la consola registra `selectstart nativo` solo para diagnóstico.
- **Gesto del sistema.** Si la palma apunta hacia la cabeza (eje −Y de la muñeca · dirección a la cabeza > 0.6), la pinza se ignora. Si en el visor bloquea pinzas normales, se ajusta `pinch.palmFacingDot` o se desactiva con `pinch.ignorePalmFacing` en `config.js`.
- **Arrastre.** Al agarrar se guarda la distancia del rayo y el offset del punto de agarre. La posición se suaviza con un filtro exponencial y se limita a un volumen sobre la mesa.
- **Exclusividad.** Una pieza solo puede estar en una mano. Una pieza colocada no se puede volver a tomar.
- **Pérdida de tracking.** Se toleran unos 10 frames. Si la mano no vuelve, la pieza se libera **sin validar** y regresa a su lugar.
- **Salida del sistema.** Si la sesión termina por el menú del visor, se cancelan los arrastres, se limpian las manos, se pausa el cronómetro y se restaura la portada.

## 8. Rendimiento y depuración

**Optimizaciones aplicadas:**

- **Iluminación:** sin sombras dinámicas, sin posprocesado y con solo dos luces.
- **Geometría:** piezas de pocos polígonos, con la geometría compartida entre cada pieza y su silueta.
- **Panel 3D:** solo se redibuja cuando cambia el texto. Mientras corre el reto, el tiempo se muestra en segundos (alrededor de un redibujo por segundo).
- **Memoria:** el ciclo de cada frame reutiliza vectores, así que casi no genera basura.
- **Limpieza:** al salir de la página (`pagehide`) se liberan escuchas, geometrías, materiales y texturas.

**Cómo verificar:**

- **Errores:** abre DevTools (F12). En **Console** busca errores en rojo. En **Network**, filtra por JS y comprueba que todo responda 200 (sin 404 ni CORS).
- **Rendimiento real en el Quest:** usa la depuración remota. Conecta el visor por USB con el modo desarrollador activado y abre `chrome://inspect` en la PC. También sirve el *OVR Metrics Tool* de Meta.

> No se reportan FPS porque no se han medido en el dispositivo.

## 9. Matriz de pruebas de aceptación

| # | Requisito | Cómo probar | Resultado esperado | Resultado observado | Evidencia |
|---|---|---|---|---|---|
| 1 | Portada responsiva, favicon, créditos, compatibilidad | Escritorio y modo dispositivo de DevTools | Sin cortes, favicon visible, checks correctos | | |
| 2 | Live Server sin errores | Console y Network | 0 errores, todo 200 | | |
| 3 | Import map | Network: three.module.js + addons | Cargan desde jsDelivr 0.170.0 | | |
| 4 | Despliegue Pages main/(root) | Abrir la URL HTTPS | Carga igual que en local | | |
| 5 | Sesión VR real y salida segura | Quest → Entrar a VR → Salir de VR | Fondo virtual opaco, regresa a la portada | | |
| 6 | Mano izq. y der. | HUD "Izquierda ✓ Derecha ✓" | Ambas detectadas | | |
| 7 | Apuntar, resaltar, pinza, arrastrar, soltar | Con cada mano | Pieza se ilumina, se mueve estable | | |
| 8 | 5 objetos y 5 destinos distintos | Observación | Forma + color + letra | | |
| 9 | Error de destino y de distancia | Soltar A en C; soltar A a ~12 cm de su centro | Rojo + mensaje, contador sin cambio | | |
| 10 | 5 aciertos | Colocar las 5 | Snap, verde, sonido, bloqueo | | |
| 11 | 0/5 → 5/5, cronómetro, mensaje final | Completar | Tiempo se detiene, mensaje con tiempo | | |
| 12 | Reiniciar durante y después | Botón Reiniciar | Todo vuelve a 0/5, 00:00, posiciones iniciales | | |
| 13 | Salir y reentrar | Salir (botón y menú del sistema) y volver | Progreso conservado, sin piezas pegadas | | |
| 14 | Botones e info 3D en el visor | Usar Reiniciar/Salir con pinza | Responden con cambio visual | | |
| 15 | Modularidad, assets, créditos | Revisión del código y README | Estructura documentada | | |

**Probado solo en escritorio:**

- Las reglas, el estado, el cronómetro, la máquina de estados y la pinza, con pruebas automatizadas de lógica: `node --test tests/logic.test.mjs` (Node 18+, sin npm).
- La carga de módulos y CDN, y el render de la escena, en Chrome headless.

**Se debe validar físicamente en el Quest:** pruebas 5 a 7, 9 a 14 y la sensibilidad de la pinza.

## 10. Limitaciones conocidas

- El filtro de "palma hacia el usuario" usa la convención de ejes de WebXR Hand Input. Hay que verificarlo en el visor.
- Si el CDN de WebXR Input Profiles no responde, las mallas de las manos no aparecen, aunque los rayos sí. Solución: `hands.modelProfile: 'spheres'`.
- La vista previa de escritorio no simula manos; solo sirve para depurar la lógica.

## 11. Créditos y licencias

- **Código del proyecto:** © 2026 Melissa Manzano, licencia MIT (ver `LICENSE`).
- **[Three.js](https://threejs.org/) r170:** MIT. La técnica de apuntar y arrastrar se inspira en el ejemplo oficial `webxr_vr_handinput_pointerdrag`, sin copiar su diseño ni su estructura.
- **[Bootstrap](https://getbootstrap.com/) 5.3.3:** MIT.
- **Modelos de manos:** [WebXR Input Profiles](https://github.com/immersive-web/webxr-input-profiles), MIT, cargados por `XRHandModelFactory`.
- **Sonidos:** sintetizados en tiempo de ejecución con Web Audio API (sin archivos de terceros).
- **Desarrollo:** asistido por un agente de IA (Claude) bajo la supervisión de la autora.
