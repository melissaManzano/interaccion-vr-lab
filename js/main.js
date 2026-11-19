/**
 * main.js — Punto de entrada. Crea los módulos, los conecta y ejecuta el ciclo de render.
 *
 * Flujo de cada frame:
 *   fuentes (manos o mouse) → eventos de pinza → interacción (hover/arrastre)
 *   → apariencia → panel → render
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { createStore, PHASE_LABEL, MESSAGE_KIND } from './core/state.js';
import { createSceneContext } from './scene/sceneSetup.js';
import { buildLab } from './scene/labBuilder.js';
import { createGameMachine } from './logic/gameMachine.js';
import { formatTime } from './logic/timer.js';
import { createSelectableRegistry, CATEGORY } from './interaction/selectables.js';
import { createDragController } from './interaction/dragController.js';
import { createInteractionManager } from './interaction/interactionManager.js';
import { createHandTracking } from './xr/hands.js';
import { detectXrSupport, createXrSessionController, describeXrError } from './xr/xrSession.js';
import { createVrPanel } from './ui/vrPanel.js';
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
  ui.renderObjectives(CONFIG.pieces);

  // --- Escena ---------------------------------------------------------------
  const { renderer, scene, camera, dispose: disposeScene } = createSceneContext({
    container: ui.previewContainer,
    cameraPosition: CONFIG.desktopCamera.position,
    cameraTarget: CONFIG.desktopCamera.target,
  });
  const lab = buildLab(scene, CONFIG);

  // --- Estado, sonido y reglas ----------------------------------------------
  const store = createStore(CONFIG.pieces);
  const sound = createSoundFx();

  const game = createGameMachine({
    store,
    pieceDefs: CONFIG.pieces,
    targets: lab.ruleTargets,
    rules: CONFIG.rules,
    now,
    hooks: {
      onSuccess: (pieceId) => { lab.snapToTarget(pieceId); sound.success(); },
      onError: (pieceId, outcome) => {
        lab.flashError(pieceId, outcome.targetId, now() + CONFIG.rules.errorFlashMs);
        sound.error();
      },
      onReturnHome: (pieceId) => lab.returnHome(pieceId),
      onComplete: () => sound.complete(),
      onReset: () => lab.resetAll(),
    },
  });

  // --- HUD y botones 3D -----------------------------------------------------
  const panel = createVrPanel({
    parent: scene, store, title: CONFIG.app.title, position: CONFIG.panel.position, width: CONFIG.panel.width,
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
        interaction.abortAll(); // Suelta cualquier pieza en mano antes de restaurar.
        game.reset();
      } else if (id === 'exit') {
        if (xr.isActive()) xr.exit();
        else game.notify('El botón "Salir de VR" funciona dentro del visor.', MESSAGE_KIND.INFO);
      }
    },
  });

  // --- Seleccionables (lista cerrada con prioridad) --------------------------
  const registry = createSelectableRegistry();
  buttons.entries.forEach((b) => registry.register(b.mesh, CATEGORY.BUTTON, b.id));
  lab.pieces.forEach((p) => registry.register(p.mesh, CATEGORY.PIECE, p.id, () => game.canGrab(p.id)));

  const drag = createDragController(CONFIG.drag);
  interaction = createInteractionManager({ registry, drag, game, buttons, lab, rayConfig: CONFIG.ray });

  // --- Manos (XR) y vista previa (escritorio) -------------------------------
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

  // --- Sesión immersive-vr --------------------------------------------------
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
    await sound.unlock(); // El audio necesita el mismo gesto del usuario.
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

  // --- Ciclo de animación (compatible con WebXR) -----------------------------
  let lastTime = now();
  let lastSummaryAt = 0;
  const getStatus = (id) => store.getPiece(id).status;

  function onFrame() {
    const t = now();
    const dt = Math.min(MAX_DELTA_SECONDS, (t - lastTime) / 1000);
    lastTime = t;

    const sources = renderer.xr.isPresenting ? hands.update(camera) : [preview.getSource()];
    interaction.handleEvents(sources);
    const feedback = interaction.update(sources, dt);
    if (renderer.xr.isPresenting) hands.applyFeedback(feedback);
    else preview.applyFeedback(feedback);

    lab.updateVisuals(t, getStatus);
    buttons.update(t);
    panel.update(t);

    if (t - lastSummaryAt > SUMMARY_INTERVAL_MS) {
      lastSummaryAt = t;
      const state = store.getState();
      ui.renderSummary({
        progress: `${store.placedCount()}/${store.totalPieces()}`,
        phase: PHASE_LABEL[state.phase],
        time: formatTime(store.elapsedMs(t), false),
      });
    }

    renderer.render(scene, camera);
  }

  renderer.setAnimationLoop(onFrame);
  window.__labBooted = true;

  // --- Liberación de recursos al abandonar la página -------------------------
  window.addEventListener('pagehide', () => {
    renderer.setAnimationLoop(null);
    xr.dispose();
    hands.dispose();
    preview.dispose();
    buttons.dispose();
    panel.dispose();
    lab.dispose();
    sound.dispose();
    disposeScene();
  }, { once: true });

  // Acceso de depuración desde la consola (no expone secretos).
  window.lab = Object.freeze({ store, game, config: CONFIG });
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
