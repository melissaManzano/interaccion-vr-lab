/**
 * hands.js — Seguimiento de ambas manos con WebXR Hand Input.
 *
 * Para cada mano:
 *  - Modelo visible de la mano (XRHandModelFactory).
 *  - Rayo de apuntado: nace en el punto medio entre la punta del índice y la del
 *    pulgar, con la orientación del "target ray" que entrega el navegador.
 *  - Detección de pinza por articulaciones, con histéresis y filtro del gesto del sistema.
 *  - Detección de conexión, desconexión y pérdida temporal de tracking.
 *
 * Los mandos físicos se IGNORAN: esta práctica se usa solo con las manos.
 *
 * Cada frame, update() devuelve "fuentes de puntero":
 *   { id: 'left'|'right', active: boolean, ray: THREE.Ray, event: 'start'|'end'|'lost'|null }
 */
import * as THREE from 'three';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { createPinchDetector } from './pinchDetector.js';

const RAY_COLORS = Object.freeze({ idle: 0xe2e8f0, hover: 0x38bdf8, button: 0xfacc15, drag: 0x22c55e });

export function createHandTracking({
  renderer, scene, pinchConfig, modelProfile = 'mesh', onHandStatus = () => {}, onControllerDetected = () => {},
}) {
  const factory = new XRHandModelFactory();
  const rayGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
  const cursorGeometry = new THREE.SphereGeometry(0.01, 12, 8);

  // Vectores reutilizables (evitan crear objetos en cada frame).
  const indexPos = new THREE.Vector3();
  const thumbPos = new THREE.Vector3();
  const wristPos = new THREE.Vector3();
  const headPos = new THREE.Vector3();
  const palmNormal = new THREE.Vector3();
  const toHead = new THREE.Vector3();
  const rayQuat = new THREE.Quaternion();
  const wristQuat = new THREE.Quaternion();

  const entries = [0, 1].map(createEntry);

  function createEntry(index) {
    const controller = renderer.xr.getController(index);
    const hand = renderer.xr.getHand(index);
    hand.add(factory.createHandModel(hand, modelProfile));
    scene.add(controller, hand);

    const rayMaterial = new THREE.LineBasicMaterial({ color: RAY_COLORS.idle, transparent: true, opacity: 0.85 });
    const cursorMaterial = new THREE.MeshBasicMaterial({ color: RAY_COLORS.idle });
    const rayLine = new THREE.Line(rayGeometry, rayMaterial);
    const cursor = new THREE.Mesh(cursorGeometry, cursorMaterial);
    const rayGroup = new THREE.Group();
    rayGroup.name = `Rayo mano ${index}`;
    rayGroup.add(rayLine, cursor);
    rayGroup.visible = false;
    scene.add(rayGroup);

    const entry = {
      index,
      id: `hand${index}`,
      side: null,
      controller,
      hand,
      connected: false,
      tracked: false,
      lostFrames: 0,
      pendingLost: false,
      pinch: createPinchDetector(pinchConfig),
      ray: new THREE.Ray(),
      rayGroup, rayLine, rayMaterial, cursor, cursorMaterial,
    };

    entry.onConnected = (event) => {
      const source = event.data;
      if (!source) return;
      if (!source.hand) {
        entry.connected = false;
        onControllerDetected(source.handedness);
        return;
      }
      entry.connected = true;
      entry.side = source.handedness;
      entry.id = source.handedness === 'left' || source.handedness === 'right' ? source.handedness : `hand${index}`;
      entry.lostFrames = 0;
      setTracked(entry, true);
      console.info(`[manos] Mano conectada: ${entry.id}`);
    };

    entry.onDisconnected = () => {
      if (!entry.connected) return;
      entry.connected = false;
      if (entry.pinch.forceRelease()) entry.pendingLost = true;
      setTracked(entry, false);
      entry.rayGroup.visible = false;
      console.info(`[manos] Mano desconectada: ${entry.id}`);
    };

    // Solo para diagnóstico: confirma si el navegador emite select con las manos.
    entry.onSelectStart = () => console.debug(`[manos] selectstart nativo (${entry.id})`);

    hand.addEventListener('connected', entry.onConnected);
    hand.addEventListener('disconnected', entry.onDisconnected);
    controller.addEventListener('selectstart', entry.onSelectStart);
    return entry;
  }

  function setTracked(entry, tracked) {
    if (entry.tracked === tracked) return;
    entry.tracked = tracked;
    if (entry.side === 'left' || entry.side === 'right') onHandStatus(entry.side, tracked);
  }

  function computePalmFacing(entry) {
    const wrist = entry.hand.joints?.wrist;
    if (!wrist || !wrist.visible) return false;
    wrist.getWorldPosition(wristPos);
    wrist.getWorldQuaternion(wristQuat);
    // En WebXR Hand Input, el eje -Y de cada articulación apunta hacia el lado de la palma.
    palmNormal.set(0, -1, 0).applyQuaternion(wristQuat);
    toHead.subVectors(headPos, wristPos).normalize();
    return palmNormal.dot(toHead) > pinchConfig.palmFacingDot;
  }

  function updateEntry(entry) {
    const output = { id: entry.id, active: false, ray: entry.ray, event: null };

    if (entry.pendingLost) {
      entry.pendingLost = false;
      output.event = 'lost';
      return output;
    }
    if (!entry.connected) return output;

    const joints = entry.hand.joints ?? {};
    const indexTip = joints['index-finger-tip'];
    const thumbTip = joints['thumb-tip'];
    const poseOk = indexTip?.visible && thumbTip?.visible && entry.controller.visible;

    if (!poseOk) {
      entry.lostFrames += 1;
      entry.rayGroup.visible = false;
      // Pérdida breve: se tolera unos frames. Pérdida prolongada: se libera con seguridad.
      if (entry.lostFrames > pinchConfig.lostFramesLimit) {
        if (entry.pinch.forceRelease()) output.event = 'lost';
        setTracked(entry, false);
      }
      return output;
    }

    entry.lostFrames = 0;
    setTracked(entry, true);

    indexTip.getWorldPosition(indexPos);
    thumbTip.getWorldPosition(thumbPos);
    entry.controller.getWorldQuaternion(rayQuat);
    entry.ray.origin.copy(indexPos).add(thumbPos).multiplyScalar(0.5);
    entry.ray.direction.set(0, 0, -1).applyQuaternion(rayQuat).normalize();

    const palmFacing = computePalmFacing(entry);
    output.event = entry.pinch.update({ distance: indexPos.distanceTo(thumbPos), palmFacing });
    output.active = true;

    entry.rayGroup.position.copy(entry.ray.origin);
    entry.rayGroup.quaternion.copy(rayQuat);
    entry.rayGroup.visible = true;
    return output;
  }

  return {
    /** Lee las manos del frame actual. `camera` se usa para saber dónde está la cabeza. */
    update(camera) {
      camera.getWorldPosition(headPos);
      return entries.map(updateEntry);
    },

    /** Ajusta la longitud y el color del rayo según lo que apunta cada mano. */
    applyFeedback(feedback) {
      for (const entry of entries) {
        if (!entry.rayGroup.visible) continue;
        const fb = feedback.get(entry.id);
        const state = fb?.state ?? 'idle';
        const length = Math.max(0.05, fb?.length ?? 1.2);
        entry.rayLine.scale.z = length;
        entry.cursor.position.set(0, 0, -length);
        entry.cursor.visible = state !== 'idle';
        entry.cursor.scale.setScalar(entry.pinch.isPinching() ? 0.7 : 1);
        const color = state === 'drag' ? RAY_COLORS.drag
          : state === 'hover' && fb.category === 'button' ? RAY_COLORS.button
            : state === 'hover' ? RAY_COLORS.hover : RAY_COLORS.idle;
        entry.rayMaterial.color.setHex(color);
        entry.cursorMaterial.color.setHex(color);
      }
    },

    /** Limpia el estado al terminar una sesión. */
    resetAll() {
      for (const entry of entries) {
        entry.pinch.forceRelease();
        entry.pendingLost = false;
        entry.connected = false;
        entry.lostFrames = 0;
        setTracked(entry, false);
        entry.rayGroup.visible = false;
      }
    },

    dispose() {
      for (const entry of entries) {
        entry.hand.removeEventListener('connected', entry.onConnected);
        entry.hand.removeEventListener('disconnected', entry.onDisconnected);
        entry.controller.removeEventListener('selectstart', entry.onSelectStart);
        scene.remove(entry.rayGroup, entry.controller, entry.hand);
        entry.rayMaterial.dispose();
        entry.cursorMaterial.dispose();
      }
      rayGeometry.dispose();
      cursorGeometry.dispose();
    },
  };
}
