/**
 * main.js — Punto de entrada. Crea los módulos, los conecta y ejecuta el ciclo de cada cuadro.
 *
 * Capas (cada una en su carpeta):
 *   scene/       renderizado (Three.js): sala, mesas, mostrador, recipientes
 *   physics/     motor de física (cannon-es): mundo, colisionadores, agarre por velocidad
 *   objects/     generación de las 20 figuras y su distribución aleatoria
 *   interaction/ manos/mouse → rayo, agarre cercano, botones
 *   validation/  reglas de clasificación y monitor de depósitos
 *   ui/          marcador 3D, pantallas de recipientes, botones 3D y portada
 *
 * Flujo de cada cuadro:
 *   fuentes (manos o mouse) → eventos de pinza → objetivos de agarre
 *   → física (paso fijo) → sincronizar mallas → validar depósitos → apariencia → render
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { createStore, PHASE_LABEL, MESSAGE_KIND } from './core/state.js';
import { createSceneContext } from './scene/sceneSetup.js';
import { buildLab } from './scene/labBuilder.js';
import { createPhysicsWorld } from './physics/physicsWorld.js';
import { createHoldController } from './physics/holdController.js';
import { createObjectSet } from './objects/objectFactory.js';
import { generateLayout } from './objects/layoutGenerator.js';
import { buildBinVolumes, formatAccuracy } from './validation/sortingRules.js';
import { createSortingMonitor } from './validation/sortingMonitor.js';
import { createGameMachine } from './logic/gameMachine.js';
import { formatTime } from './logic/timer.js';
import { createSelectableRegistry, CATEGORY } from './interaction/selectables.js';
import { createDragController } from './interaction/dragController.js';
import { createInteractionManager } from './interaction/interactionManager.js';
import { createHandTracking } from './xr/hands.js';
import { detectXrSupport, createXrSessionController, describeXrError } from './xr/xrSession.js';
import { createScoreboard } from './ui/scoreboard.js';
import { createBinDisplays } from './ui/binDisplays.js';
import { createVrButtons } from './ui/vrButtons.js';
import { createLandingUI } from './ui/landingUI.js';
import { createSoundFx } from './audio/soundFx.js';
import { createDesktopPreview } from './debug/desktopPreview.js';

const now = () => performance.now();
const MAX_DELTA_SECONDS = 0.1;
const SUMMARY_INTERVAL_MS = 250;

async function main() {
  const ui = createLandingUI(document);
  ui.setCheck('three', 'ok', `Cargado (r${THREE.REVISION})`);
  ui.setCheck('physics', 'ok', 'cannon-es 0.20.0 cargado');
  ui.renderObjectives(CONFIG.classes, CONFIG.bins, CONFIG.perClass);

  // --- Renderizado ---------------------------------------------------------------
  const { renderer, scene, camera, dispose: disposeScene } = createSceneContext({
    container: ui.previewContainer,
    cameraPosition: CONFIG.desktopCamera.position,
    cameraTarget: CONFIG.desktopCamera.target,
  });
  const lab = buildLab(scene, CONFIG);

  // --- Física ------------------------------------------------------------------------
  const physics = createPhysicsWorld(CONFIG);
  const hold = createHoldController({ physics, ...CONFIG.hold });
  const sound = createSoundFx();

  // --- Figuras (generación) ----------------------------------------------------------
  const objects = createObjectSet({
    parent: scene,
    physics,
    classes: CONFIG.classes,
    perClass: CONFIG.perClass,
    tableTopY: CONFIG.table.topY,
    dropHeight: CONFIG.spawn.dropHeight,
    sphereAngularDamping: CONFIG.physics.sphereAngularDamping,
    onImpact: (speed) => sound.impact(speed),
  });

  // --- Estado, validación y reglas ----------------------------------------------------
  const store = createStore({ objects: objects.list, bins: CONFIG.bins, capacity: CONFIG.perClass });
  const binVolumes = buildBinVolumes(CONFIG);
  let monitor = null; // se crea tras el juego (se necesitan mutuamente a través de hooks)

  function randomizeLayout() {
    const layout = generateLayout({ objects: objects.list, tables: CONFIG.tables, spawn: CONFIG.spawn });
    objects.applyLayout(layout);
    monitor?.reset();
    lab.resetVisuals();
  }

  const game = createGameMachine({
    store,
    classes: CONFIG.classes,
    bins: CONFIG.bins,
    perClass: CONFIG.perClass,
    rules: CONFIG.rules,
    now,
    hooks: {
      onCorrect: (objectId, binId) => {
        const until = now() + CONFIG.rules.successFlashMs;
        objects.flash(objectId, 'success', until);
        lab.flashBin(binId, 'success', until);
        sound.success();
      },
      onWrong: (objectId, binId) => {
        const until = now() + CONFIG.rules.errorFlashMs;
        objects.flash(objectId, 'error', until);
        lab.flashBin(binId, 'error', until);
        sound.error();
      },
      onEject: (objectId, binId) => monitor.eject(objectId, binId),
      onBinFilled: () => sound.binFilled(),
      onComplete: () => sound.complete(),
      onReset: () => randomizeLayout(),
    },
  });
  monitor = createSortingMonitor({ objects, bins: binVolumes, store, game, rules: CONFIG.rules, physics });
  randomizeLayout();

  // --- Marcador, pantallas de recipientes y botones 3D -----------------------------------
  const scoreboard = createScoreboard({
    parent: scene, store, classes: CONFIG.classes, bins: CONFIG.bins, title: CONFIG.app.title,
    position: CONFIG.scoreboard.position, width: CONFIG.scoreboard.width,
  });
  const binDisplays = createBinDisplays({
    lab, classes: CONFIG.classes, store, binHeight: CONFIG.bin.height, binOuter: CONFIG.bin.outer,
  });

  let xr = null; // se asigna más abajo; los botones lo usan al pulsar.
  let interaction = null;

  const buttons = createVrButtons({
    parent: scene,
    definitions: CONFIG.buttons,
    now,
    onPress: (id) => {
      sound.click();
      if (id === 'reset') {
        interaction.abortAll(); // suelta cualquier figura en mano antes de redistribuir
        game.reset();
      } else if (id === 'exit') {
        if (xr.isActive()) xr.exit();
        else game.notify('El botón "Salir de VR" funciona dentro del visor.', MESSAGE_KIND.INFO);
      }
    },
  });

  // --- Interacción (lista cerrada de seleccionables con prioridad) -------------------------
  const registry = createSelectableRegistry();
  buttons.entries.forEach((b) => registry.register(b.mesh, CATEGORY.BUTTON, b.id));
  objects.list.forEach((o) => registry.register(o.mesh, CATEGORY.OBJECT, o.id, () => game.canGrab(o.id)));

  const drag = createDragController(CONFIG.drag);
  interaction = createInteractionManager({
    registry, drag, hold, objects, game, buttons, rayConfig: CONFIG.ray, nearRadius: CONFIG.drag.nearRadius,
  });

  // --- Manos (XR) y vista previa (escritorio) ----------------------------------------
  const hands = createHandTracking({
    renderer,
    scene,
    pinchConfig: CONFIG.pinch,
    modelProfile: CONFIG.hands.modelProfile,
    onHandStatus: (side, tracked) => store.setHandTracked(side, tracked),
    onControllerDetected: () => game.notify(
      'Se detectaron mandos. Esta práctica usa SOLO las manos: déjalos y muestra tus manos.',
      MESSAGE_KIND.WARNING,
    ),
  });

  const preview = createDesktopPreview({
    camera, domElement: renderer.domElement,
    position: CONFIG.desktopCamera.position, target: CONFIG.desktopCamera.target,
  });
  renderer.domElement.addEventListener('pointerdown', () => sound.unlock(), { once: true });

  // --- Sesión immersive-vr ----------------------------------------------------------
  xr = createXrSessionController({
    renderer,
    onStart(session) {
      preview.setEnabled(false);
      store.setXrPresenting(true);
      game.onSessionStart();
      ui.setPresenting(true);
      ui.setEnterState({ enabled: false, label: 'En VR…' });
      ui.setStatus('Sesión VR activa. Para salir usa el botón 3D "Salir de VR" o el menú del visor.');
      const features = session.enabledFeatures;
      if (Array.isArray(features) && !features.includes('hand-tracking')) {
        game.notify('El visor no habilitó el seguimiento de manos. Actívalo en Configuración → Movimiento.', MESSAGE_KIND.WARNING, null);
      }
    },
    onEnd() {
      interaction.cancelAll('session-end');
      hands.resetAll();
      game.onSessionEnd();
      store.setXrPresenting(false);
      preview.restoreCamera();
      preview.setEnabled(true);
      ui.setPresenting(false);
      ui.setEnterState({ enabled: true, label: 'Entrar a VR' });
      ui.setStatus('Sesión VR finalizada. Tu progreso se conserva; puedes volver a entrar.');
    },
    onError(err) {
      ui.showError(describeXrError(err));
      ui.setEnterState({ enabled: true, label: 'Entrar a VR' });
    },
  });

  ui.onEnterClick(async () => {
    ui.clearError();
    ui.setEnterState({ enabled: false, label: 'Iniciando…', busy: true });
    await sound.unlock(); // el audio necesita el mismo gesto del usuario
    await xr.enter();
    if (!xr.isActive()) ui.setEnterState({ enabled: true, label: 'Entrar a VR' });
  });

  // No se espera (await): el render arranca aunque la consulta de soporte tarde.
  reportSupport(ui).catch((err) => {
    console.error('[main] Falló la detección de compatibilidad:', err);
    ui.showError(`No se pudo comprobar la compatibilidad WebXR: ${err.message}`);
  });

  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    ui.showError('Se perdió el contexto WebGL (memoria de GPU). Recarga la página.');
  });

  // --- Ciclo de animación (compatible con WebXR) -------------------------------------
  let lastTime = now();
  let lastSummaryAt = 0;
  const headPosition = new THREE.Vector3();
  const getStatus = (id) => store.getObject(id).status;
  const getBinState = (id) => store.getBin(id);

  function onFrame() {
    const t = now();
    const dt = Math.min(MAX_DELTA_SECONDS, (t - lastTime) / 1000);
    lastTime = t;

    // 1) Entrada
    const presenting = renderer.xr.isPresenting;
    const sources = presenting ? hands.update(camera) : [preview.getSource()];
    camera.getWorldPosition(headPosition);
    interaction.handleEvents(sources);
    const feedback = interaction.update(sources, headPosition);
    if (presenting) hands.applyFeedback(feedback);
    else preview.applyFeedback(feedback);

    // 2) Física
    hold.apply();
    physics.step(dt);
    objects.sync();

    // 3) Validación
    monitor.update(dt);

    // 4) Apariencia y marcador
    objects.updateVisuals(t, getStatus);
    lab.updateVisuals(t, getBinState);
    binDisplays.update();
    buttons.update(t);
    scoreboard.update(t);

    if (t - lastSummaryAt > SUMMARY_INTERVAL_MS) {
      lastSummaryAt = t;
      const state = store.getState();
      ui.renderSummary({
        progress: `${store.sortedCount()}/${store.totalObjects()}`,
        errors: String(state.stats.errors),
        accuracy: formatAccuracy(store.accuracy()),
        phase: PHASE_LABEL[state.phase],
        time: formatTime(store.elapsedMs(t), false),
        bins: CONFIG.bins.map((b) => {
          const s = store.getBin(b.id);
          return { id: b.id, count: s.count, capacity: s.capacity, time: s.completedAtMs === null ? null : formatTime(s.completedAtMs) };
        }),
      });
    }

    // 5) Render
    renderer.render(scene, camera);
  }

  renderer.setAnimationLoop(onFrame);
  window.__labBooted = true;

  // --- Liberación de recursos al abandonar la página ----------------------------------
  window.addEventListener('pagehide', () => {
    renderer.setAnimationLoop(null);
    xr.dispose();
    hands.dispose();
    preview.dispose();
    buttons.dispose();
    scoreboard.dispose();
    binDisplays.dispose();
    hold.dispose();
    objects.dispose();
    physics.dispose();
    lab.dispose();
    sound.dispose();
    disposeScene();
  }, { once: true });

  // Acceso de depuración desde la consola (no expone secretos).
  window.lab = Object.freeze({ store, game, config: CONFIG, physics, objects, camera });
}

async function reportSupport(ui) {
  const support = await detectXrSupport();
  ui.setCheck('secure', support.secure ? 'ok' : 'fail',
    support.secure ? 'Sí (HTTPS o localhost)' : 'No: WebXR requiere HTTPS');
  ui.setCheck('webxr', support.hasWebXR ? 'ok' : 'fail',
    support.hasWebXR ? 'API disponible' : 'Este navegador no tiene WebXR');

  if (support.vrSupported) {
    ui.setCheck('vr', 'ok', 'immersive-vr disponible');
    ui.setCheck('hands', 'pending', 'Se comprueba al entrar (actívalo en el visor)');
    ui.setEnterState({ enabled: true, label: 'Entrar a VR' });
    ui.setStatus('Listo. Ponte el visor y pulsa "Entrar a VR".');
  } else {
    ui.setCheck('vr', 'warn', support.error ? `Error: ${support.error.message}` : 'No disponible en este dispositivo');
    ui.setCheck('hands', 'warn', 'Requiere Meta Quest 3');
    ui.setEnterState({ enabled: false, label: 'VR no disponible aquí' });
    ui.setStatus('Abre esta página en Meta Quest Browser (HTTPS) para entrar a VR. Abajo tienes una vista previa de depuración.');
  }
}

main().catch((err) => {
  console.error('[main] Error fatal al iniciar:', err);
  if (window.labBootGuard) window.labBootGuard.fail(`Error al iniciar la aplicación: ${err.message}`);
});
