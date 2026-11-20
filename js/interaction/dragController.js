/**
 * dragController.js — Calcula DÓNDE quiere la mano que esté la figura sostenida.
 *
 * Ya no mueve mallas: entrega un punto objetivo por cuadro y la física (holdController)
 * lleva el cuerpo hacia allí respetando las colisiones.
 *
 * Dos modos de agarre:
 *  - Cercano: la pinza se cerró junto a la figura. El objetivo es el punto de pinza
 *    más el offset inicial: la figura va "pegada" a los dedos.
 *  - A distancia (rayo): se guarda la distancia del rayo y el offset del impacto.
 *    Objetivo = origen + dirección·distancia + offset. Además, alejar o acercar la mano
 *    del cuerpo cambia esa distancia (×reelGain): así se puede traer una figura de una
 *    mesa lejana hasta los recipientes sin caminar.
 *
 * El objetivo se limita a un volumen de la sala (bounds).
 */
import * as THREE from 'three';

export function createDragController({ bounds, minDistance, maxDistance, reelGain }) {
  const active = new Map(); // sourceId → datos del arrastre
  const target = new THREE.Vector3();

  function clampToBounds(v) {
    v.x = THREE.MathUtils.clamp(v.x, bounds.minX, bounds.maxX);
    v.y = THREE.MathUtils.clamp(v.y, bounds.minY, bounds.maxY);
    v.z = THREE.MathUtils.clamp(v.z, bounds.minZ, bounds.maxZ);
    return v;
  }

  return {
    has: (sourceId) => active.has(sourceId),

    /**
     * @param {string} sourceId
     * @param {object} p
     * @param {string} p.objectId
     * @param {THREE.Vector3} p.objectPosition  centro actual de la figura
     * @param {THREE.Ray} p.ray
     * @param {THREE.Vector3} p.hitPoint        punto de impacto (o el centro, en agarre cercano)
     * @param {boolean} p.near
     * @param {number} p.reach                   alcance de la mano (distancia cabeza–mano)
     */
    begin(sourceId, { objectId, objectPosition, ray, hitPoint, near, reach }) {
      if (active.has(sourceId)) throw new Error(`La fuente ${sourceId} ya está arrastrando.`);
      const rawDistance = ray.origin.distanceTo(hitPoint);
      const distance = near ? rawDistance : THREE.MathUtils.clamp(rawDistance, minDistance, maxDistance);
      active.set(sourceId, {
        objectId,
        near,
        distance,
        startReach: reach,
        offset: objectPosition.clone().sub(hitPoint),
      });
    },

    /**
     * @returns {{objectId, target:THREE.Vector3, length:number} | null}
     *   target se reutiliza entre llamadas: cópialo si necesitas guardarlo.
     */
    update(sourceId, ray, reach) {
      const drag = active.get(sourceId);
      if (!drag) return null;
      let distance = drag.distance;
      if (!drag.near) {
        distance = THREE.MathUtils.clamp(drag.distance + (reach - drag.startReach) * reelGain, minDistance, maxDistance);
      }
      ray.at(distance, target).add(drag.offset);
      clampToBounds(target);
      return { objectId: drag.objectId, target, length: distance };
    },

    end(sourceId) {
      const drag = active.get(sourceId) ?? null;
      active.delete(sourceId);
      return drag;
    },

    endAll() {
      const all = [...active.values()];
      active.clear();
      return all;
    },
  };
}
