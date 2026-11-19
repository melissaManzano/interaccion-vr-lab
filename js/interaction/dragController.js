/**
 * dragController.js — Arrastre estable de piezas a lo largo del rayo.
 *
 * Al agarrar se guardan:
 *   - la distancia del origen del rayo al punto de impacto, y
 *   - el OFFSET entre el punto de impacto y el centro de la pieza.
 * En cada frame, posición deseada = origen + dirección·distancia + offset.
 * Así la pieza no "salta" al centro del rayo.
 *
 * Estabilidad: la posición se suaviza con un filtro exponencial independiente de
 * los FPS y se limita a un volumen sobre la mesa (no atraviesa la mesa ni se aleja).
 * La orientación no cambia durante el arrastre; el snap la corrige al acertar.
 */
import * as THREE from 'three';

export function createDragController({ bounds, smoothing, minDistance, maxDistance, moveThreshold }) {
  const active = new Map(); // sourceId → datos del arrastre
  const desired = new THREE.Vector3();

  function clampToBounds(v) {
    v.x = THREE.MathUtils.clamp(v.x, bounds.minX, bounds.maxX);
    v.y = THREE.MathUtils.clamp(v.y, bounds.minY, bounds.maxY);
    v.z = THREE.MathUtils.clamp(v.z, bounds.minZ, bounds.maxZ);
    return v;
  }

  return {
    has: (sourceId) => active.has(sourceId),

    isPieceDragged(pieceId) {
      for (const d of active.values()) if (d.pieceId === pieceId) return true;
      return false;
    },

    begin(sourceId, { pieceId, object, ray, hitPoint }) {
      if (active.has(sourceId)) throw new Error(`La fuente ${sourceId} ya está arrastrando.`);
      const distance = THREE.MathUtils.clamp(ray.origin.distanceTo(hitPoint), minDistance, maxDistance);
      active.set(sourceId, {
        pieceId,
        object,
        distance,
        offset: object.position.clone().sub(hitPoint),
        startPosition: object.position.clone(),
        moving: false,
      });
    },

    /** @returns {{pieceId, startedMoving:boolean, distance:number} | null} */
    update(sourceId, ray, deltaSeconds) {
      const drag = active.get(sourceId);
      if (!drag) return null;
      ray.at(drag.distance, desired).add(drag.offset);
      clampToBounds(desired);
      const alpha = 1 - Math.exp(-smoothing * Math.max(0, deltaSeconds));
      drag.object.position.lerp(desired, alpha);

      let startedMoving = false;
      if (!drag.moving && drag.object.position.distanceTo(drag.startPosition) > moveThreshold) {
        drag.moving = true;
        startedMoving = true;
      }
      return { pieceId: drag.pieceId, startedMoving, distance: ray.origin.distanceTo(drag.object.position) };
    },

    /** Termina el arrastre de una fuente y devuelve sus datos (o null). */
    end(sourceId) {
      const drag = active.get(sourceId) ?? null;
      active.delete(sourceId);
      return drag;
    },

    /** Termina todos los arrastres y los devuelve. */
    endAll() {
      const all = [...active.values()];
      active.clear();
      return all;
    },
  };
}
