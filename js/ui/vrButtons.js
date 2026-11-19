/**
 * vrButtons.js — Botones 3D (Reiniciar y Salir de VR) que se activan con rayo + pinza.
 *
 * Retroalimentación: al apuntar, el botón crece y se ilumina; al pulsar, se hunde
 * un instante. Un antirrebote evita dobles activaciones.
 */
import * as THREE from 'three';
import { createLabelTexture, FONT_STACK } from './canvasText.js';

const PRESS_FEEDBACK_MS = 180;
const DEBOUNCE_MS = 500;

export function createVrButtons({ parent, definitions, onPress, now = () => performance.now() }) {
  if (typeof onPress !== 'function') throw new TypeError('vrButtons: onPress es obligatorio.');
  const boxGeometry = new THREE.BoxGeometry(0.3, 0.09, 0.03);
  const labelGeometry = new THREE.PlaneGeometry(0.28, 0.084);
  const disposables = [boxGeometry, labelGeometry];
  let hovered = new Set();

  const entries = definitions.map((def) => {
    const material = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.5 });
    const mesh = new THREE.Mesh(boxGeometry, material);
    mesh.name = `Botón ${def.label}`;
    mesh.position.fromArray(def.position);
    mesh.userData = { kind: 'button', id: def.id };

    const texture = createLabelTexture({
      text: def.label, width: 320, height: 96, background: 'rgba(0,0,0,0)', color: '#ffffff',
      font: `700 44px ${FONT_STACK}`,
    });
    const labelMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
    const label = new THREE.Mesh(labelGeometry, labelMaterial);
    label.position.z = 0.0155;
    mesh.add(label);
    parent.add(mesh);
    disposables.push(material, texture, labelMaterial);

    return { id: def.id, def, mesh, material, basePosition: mesh.position.clone(), pressedUntil: 0, lastPressAt: -Infinity };
  });

  const byId = new Map(entries.map((e) => [e.id, e]));

  return {
    entries,

    press(id) {
      const entry = byId.get(id);
      if (!entry) return;
      const t = now();
      if (t - entry.lastPressAt < DEBOUNCE_MS) return;
      entry.lastPressAt = t;
      entry.pressedUntil = t + PRESS_FEEDBACK_MS;
      try {
        onPress(id);
      } catch (err) {
        console.error(`[botones] Error al ejecutar "${id}":`, err);
      }
    },

    setHovered(ids) { hovered = ids; },

    update(t) {
      for (const entry of entries) {
        const pressed = t < entry.pressedUntil;
        const isHovered = hovered.has(entry.id);
        entry.mesh.scale.setScalar(pressed ? 0.94 : isHovered ? 1.08 : 1);
        entry.mesh.position.z = entry.basePosition.z - (pressed ? 0.01 : 0);
        entry.material.emissive.setHex(pressed || isHovered ? 0xffffff : 0x000000);
        entry.material.emissiveIntensity = pressed ? 0.35 : isHovered ? 0.18 : 0;
      }
    },

    dispose() {
      entries.forEach((e) => parent.remove(e.mesh));
      disposables.forEach((r) => r.dispose());
    },
  };
}
