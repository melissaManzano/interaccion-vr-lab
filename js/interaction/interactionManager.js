/**
 * interactionManager.js — Une fuentes de puntero (manos o mouse), raycast, botones,
 * arrastre, física de agarre y reglas del juego.
 *
 * Una "fuente" es { id, active, ray, event, reach? }. La mano izquierda, la derecha y el
 * mouse de la vista previa tienen la misma forma, así la lógica es una sola.
 *
 * Garantías:
 *  - Una pinza activa UNA sola cosa: un botón (prioridad) o una figura.
 *  - Una figura solo puede estar en una mano (game.canGrab lo verifica).
 *  - Una figura clasificada no se puede volver a tomar.
 *  - Soltar NO valida: la figura cae por gravedad y la validación ocurre cuando
 *    reposa dentro de un recipiente (sortingMonitor).
 */
import * as THREE from 'three';
import { CATEGORY } from './selectables.js';

export function createInteractionManager({ registry, drag, hold, objects, game, buttons, rayConfig, nearRadius }) {
  const raycaster = new THREE.Raycaster();
  const hovered = new Set();
  const hoveredButtons = new Set();
  const feedback = new Map();
  const head = new THREE.Vector3();

  /**
   * Alcance de la fuente: en VR, distancia cabeza–mano (estirar el brazo aleja la figura).
   * El mouse no tiene mano: la vista previa entrega su propio `reach` (rueda del mouse).
   */
  const reachOf = (source) => source.reach ?? head.distanceTo(source.ray.origin);

  function startHolding(source, objectId, hitPoint, near) {
    if (!game.grab(objectId, source.id)) return;
    const obj = objects.get(objectId);
    drag.begin(source.id, {
      objectId, objectPosition: obj.mesh.position, ray: source.ray, hitPoint, near, reach: reachOf(source),
    });
    hold.begin(obj.body, obj.probeRadius);
  }

  function pointerDown(source) {
    if (drag.has(source.id)) return;

    // 1) Agarre cercano: la pinza se cerró junto a una figura (tomar "con la mano").
    const near = registry.nearest(source.ray.origin, nearRadius, CATEGORY.OBJECT);
    if (near) {
      startHolding(source, near.id, source.ray.origin.clone(), true);
      return;
    }

    // 2) Rayo: botón (prioridad) o figura a distancia.
    const hit = registry.raycast(raycaster, source.ray, rayConfig.maxLength);
    if (!hit) return;
    if (hit.category === CATEGORY.BUTTON) {
      buttons.press(hit.id);
      return;
    }
    startHolding(source, hit.id, hit.point, false);
  }

  function pointerUp(sourceId, reason) {
    const finished = drag.end(sourceId);
    if (!finished) return;
    hold.end(objects.get(finished.objectId).body);
    if (reason === 'lost') game.cancel(finished.objectId, 'tracking-lost');
    else game.release(finished.objectId);
  }

  return {
    /** Procesa los eventos de pinza o clic del cuadro. */
    handleEvents(sources) {
      for (const source of sources) {
        if (source.event === 'start' && source.active) pointerDown(source);
        else if (source.event === 'end') pointerUp(source.id, 'release');
        else if (source.event === 'lost') pointerUp(source.id, 'lost');
      }
    },

    /**
     * Actualiza resaltado y objetivos de agarre. Devuelve la retroalimentación por fuente.
     * @param {THREE.Vector3} headPosition  cabeza en VR o cámara en escritorio
     */
    update(sources, headPosition) {
      head.copy(headPosition);
      hovered.clear();
      hoveredButtons.clear();
      feedback.clear();

      for (const source of sources) {
        if (!source.active) continue;

        if (drag.has(source.id)) {
          const info = drag.update(source.id, source.ray, reachOf(source));
          if (info) {
            const obj = objects.get(info.objectId);
            hold.setTarget(obj.body, info.target);
            feedback.set(source.id, { state: 'drag', length: source.ray.origin.distanceTo(obj.mesh.position) });
          }
          continue;
        }

        const near = registry.nearest(source.ray.origin, nearRadius, CATEGORY.OBJECT);
        if (near) {
          hovered.add(near.id);
          feedback.set(source.id, { state: 'hover', category: CATEGORY.OBJECT, length: 0.05 });
          continue;
        }

        const hit = registry.raycast(raycaster, source.ray, rayConfig.maxLength);
        if (!hit) {
          feedback.set(source.id, { state: 'idle', length: rayConfig.idleLength });
          continue;
        }
        (hit.category === CATEGORY.BUTTON ? hoveredButtons : hovered).add(hit.id);
        feedback.set(source.id, { state: 'hover', category: hit.category, length: hit.distance });
      }

      objects.setHovered(hovered);
      buttons.setHovered(hoveredButtons);
      return feedback;
    },

    /** Suelta todo SIN pasar por el juego (lo usa el reinicio, que restaura todo). */
    abortAll() {
      drag.endAll();
      hold.endAll();
    },

    /** Suelta todo y deja caer las figuras (fin de sesión). */
    cancelAll(reason) {
      for (const d of drag.endAll()) {
        hold.end(objects.get(d.objectId).body);
        game.cancel(d.objectId, reason);
      }
    },
  };
}
