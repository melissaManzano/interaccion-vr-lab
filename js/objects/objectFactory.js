/**
 * objectFactory.js — Genera las 20 figuras: malla (Three.js) + cuerpo rígido (cannon-es).
 *
 * - Cada clase comparte UNA geometría; cada figura tiene su propio material para
 *   poder resaltarla de forma individual (hover, en mano, error, acierto).
 * - applyLayout() coloca las figuras según una distribución aleatoria (layoutGenerator)
 *   un centímetro sobre su mesa: la gravedad las asienta.
 * - sync() copia cada cuadro la pose INTERPOLADA del cuerpo a la malla.
 *   La física manda; la malla solo la refleja (nada se anima "a mano").
 */
import * as THREE from 'three';
import { OBJECT_STATUS } from '../core/state.js';
import { getCollider } from '../physics/colliders.js';

const COLORS = Object.freeze({
  hover: 0xffffff,
  held: 0x60a5fa,
  success: 0x22c55e,
  error: 0xef4444,
  recoverable: 0xf59e0b, // ámbar: "estoy en el suelo, recógeme"
});
const HOVER_SCALE = 1.08;

export function createObjectSet({
  parent, physics, classes, perClass, tableTopY, dropHeight, sphereDamping, onImpact = () => {},
}) {
  const group = new THREE.Group();
  group.name = 'Figuras';
  parent.add(group);

  const geometries = [];
  const objects = [];

  for (const cls of classes) {
    const collider = getCollider(cls.collider);
    const geometry = collider.geometry(cls.size);
    geometries.push(geometry);
    const halfHeight = collider.halfHeight(cls.size);
    const probeRadius = collider.probeRadius(cls.size);

    for (let i = 1; i <= perClass; i += 1) {
      const id = `${cls.id}-${i}`;
      const material = new THREE.MeshStandardMaterial({
        color: cls.color, roughness: 0.45, metalness: 0.05, flatShading: collider.flatShading,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `${cls.name} ${i}`;
      mesh.userData = { kind: 'object', id };
      group.add(mesh);

      const body = physics.createDynamicBody({
        shape: collider.shape(cls.size),
        mass: cls.mass,
        // undefined = amortiguamiento por defecto de config.physics
        ...(cls.collider === 'sphere' ? sphereDamping : {}),
      });
      body.userData = { id };
      body.addEventListener('collide', (event) => {
        const speed = Math.abs(event.contact?.getImpactVelocityAlongNormal?.() ?? 0);
        onImpact(speed);
      });

      objects.push({
        id, classId: cls.id, cls, mesh, material, body, halfHeight, probeRadius,
        home: { x: 0, y: 0, z: 0, yaw: 0 },
        flashUntil: 0, flashColor: 0,
      });
    }
  }

  const byId = new Map(objects.map((o) => [o.id, o]));
  let hovered = new Set();

  function require(id) {
    const obj = byId.get(id);
    if (!obj) throw new Error(`objectFactory: figura desconocida ${id}`);
    return obj;
  }

  return {
    list: objects,
    byId,
    get: require,

    /** Coloca todas las figuras según la distribución aleatoria. */
    applyLayout(layout) {
      for (const obj of objects) {
        const slot = layout.get(obj.id);
        if (!slot) throw new Error(`La distribución no incluye la figura ${obj.id}`);
        obj.home = { x: slot.x, y: tableTopY + obj.halfHeight + dropHeight, z: slot.z, yaw: slot.yaw };
        physics.teleport(obj.body, obj.home);
        obj.mesh.scale.setScalar(1);
        obj.flashUntil = 0;
      }
      this.sync();
    },

    /** Devuelve una figura perdida (fuera de la sala) a su lugar de origen. */
    respawn(id) {
      const obj = require(id);
      physics.teleport(obj.body, obj.home);
    },

    /** Copia la pose física (interpolada) a las mallas. */
    sync() {
      for (const obj of objects) {
        obj.mesh.position.copy(obj.body.interpolatedPosition);
        obj.mesh.quaternion.copy(obj.body.interpolatedQuaternion);
      }
    },

    setHovered(ids) { hovered = ids; },

    flash(id, kind, until) {
      const obj = require(id);
      obj.flashUntil = until;
      obj.flashColor = kind === 'success' ? COLORS.success : COLORS.error;
    },

    /** Apariencia según el estado. Barato (20 figuras) y se ejecuta cada cuadro. */
    updateVisuals(now, getStatus) {
      for (const obj of objects) {
        const status = getStatus(obj.id);
        let hex = 0x000000;
        let intensity = 0;
        if (now < obj.flashUntil) { hex = obj.flashColor; intensity = 0.85; }
        else if (status === OBJECT_STATUS.SORTED) { hex = COLORS.success; intensity = 0.3; }
        else if (status === OBJECT_STATUS.HELD) { hex = COLORS.held; intensity = 0.45; }
        else if (hovered.has(obj.id)) { hex = COLORS.hover; intensity = 0.25; }
        else if (status === OBJECT_STATUS.RECOVERABLE) {
          // Pulso lento (≈1 Hz): una figura caída se distingue sin buscarla.
          hex = COLORS.recoverable;
          intensity = 0.25 + 0.2 * Math.sin(now * 0.006);
        }
        obj.material.emissive.setHex(hex);
        obj.material.emissiveIntensity = intensity;
        const grow = hovered.has(obj.id) && status !== OBJECT_STATUS.HELD;
        obj.mesh.scale.setScalar(grow ? HOVER_SCALE : 1);
      }
    },

    dispose() {
      parent.remove(group);
      for (const obj of objects) {
        physics.world.removeBody(obj.body);
        obj.material.dispose();
      }
      geometries.forEach((g) => g.dispose());
    },
  };
}
