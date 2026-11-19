/**
 * interactionManager.js — Une fuentes de puntero (manos o mouse), raycast, botones,
 * arrastre y reglas del juego.
 *
 * Una "fuente" es { id, active, ray, event }. La mano izquierda, la derecha y el
 * mouse de la vista previa son fuentes con la misma forma, así la lógica es una sola.
 *
 * Garantías:
 *  - Una pinza activa UNA sola cosa: el botón (prioridad) o una pieza.
 *  - Una pieza solo puede estar en una mano (game.canGrab lo verifica).
 *  - Una pieza colocada no se puede volver a tomar.
 *  - La validación ocurre solo al SOLTAR.
 */
import * as THREE from 'three';
import { CATEGORY } from './selectables.js';

export function createInteractionManager({ registry, drag, game, buttons, lab, rayConfig }) {
  const raycaster = new THREE.Raycaster();
  const hoveredPieces = new Set();
  const hoveredButtons = new Set();
  const feedback = new Map();

  function pointerDown(source) {
    if (drag.has(source.id)) return;
    const hit = registry.raycast(raycaster, source.ray, rayConfig.maxLength);
    if (!hit) return;
    if (hit.category === CATEGORY.BUTTON) {
      buttons.press(hit.id);
      return;
    }
    if (hit.category === CATEGORY.PIECE && game.grab(hit.id, source.id)) {
      drag.begin(source.id, { pieceId: hit.id, object: hit.object, ray: source.ray, hitPoint: hit.point });
    }
  }

  function pointerUp(sourceId, reason) {
    const finished = drag.end(sourceId);
    if (!finished) return;
    if (reason === 'lost') {
      game.cancel(finished.pieceId, 'tracking-lost');
    } else {
      game.release(finished.pieceId, finished.object.position);
    }
  }

  return {
    /** Procesa los eventos de pinza o clic del frame. */
    handleEvents(sources) {
      for (const source of sources) {
        if (source.event === 'start' && source.active) pointerDown(source);
        else if (source.event === 'end') pointerUp(source.id, 'release');
        else if (source.event === 'lost') pointerUp(source.id, 'lost');
      }
    },

    /** Actualiza el resaltado y los arrastres. Devuelve la retroalimentación por fuente. */
    update(sources, deltaSeconds) {
      hoveredPieces.clear();
      hoveredButtons.clear();
      feedback.clear();

      for (const source of sources) {
        if (!source.active) continue;

        if (drag.has(source.id)) {
          const info = drag.update(source.id, source.ray, deltaSeconds);
          if (info?.startedMoving) game.markMoving(info.pieceId);
          feedback.set(source.id, { state: 'drag', length: info?.distance ?? rayConfig.idleLength });
          continue;
        }

        const hit = registry.raycast(raycaster, source.ray, rayConfig.maxLength);
        if (!hit) {
          feedback.set(source.id, { state: 'idle', length: rayConfig.idleLength });
          continue;
        }
        (hit.category === CATEGORY.BUTTON ? hoveredButtons : hoveredPieces).add(hit.id);
        feedback.set(source.id, { state: 'hover', category: hit.category, length: hit.distance });
      }

      lab.setHovered(hoveredPieces);
      buttons.setHovered(hoveredButtons);
      return feedback;
    },

    /** Descarta arrastres SIN pasar por el juego (lo usa Reiniciar, que restaura todo). */
    abortAll() {
      drag.endAll();
    },

    /** Libera todos los arrastres devolviendo las piezas a su lugar (fin de sesión). */
    cancelAll(reason) {
      for (const d of drag.endAll()) game.cancel(d.pieceId, reason);
    },
  };
}
