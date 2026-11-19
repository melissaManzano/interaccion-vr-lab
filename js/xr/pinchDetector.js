/**
 * pinchDetector.js — Detección de pinza (índice + pulgar) con HISTÉRESIS.
 *
 * ¿Por qué histéresis? Con un solo umbral, cuando la distancia ronda ese valor el
 * estado alterna cerrado/abierto varias veces por segundo por el ruido del tracking.
 * Con dos umbrales (cerrar < 2 cm, abrir > 3.5 cm), la zona intermedia conserva el
 * estado anterior y el agarre es estable.
 *
 * Gesto del sistema Meta: la pinza con la PALMA HACIA EL USUARIO abre el menú del
 * visor. Ese gesto se ignora para no iniciar acciones de la app.
 */
export const PINCH_EVENT = Object.freeze({ START: 'start', END: 'end' });

export function createPinchDetector({ closeDistance, openDistance, ignorePalmFacing = true }) {
  if (!(closeDistance > 0) || !(openDistance > closeDistance)) {
    throw new RangeError('Pinza: se requiere 0 < closeDistance < openDistance.');
  }
  let pinching = false;

  return {
    isPinching: () => pinching,

    /**
     * @param {{distance:number, palmFacing:boolean}} sample
     * @returns {'start'|'end'|null}
     */
    update({ distance, palmFacing }) {
      if (!Number.isFinite(distance)) return null;
      if (!pinching) {
        const blockedBySystemGesture = ignorePalmFacing && palmFacing;
        if (distance < closeDistance && !blockedBySystemGesture) {
          pinching = true;
          return PINCH_EVENT.START;
        }
        return null;
      }
      if (distance > openDistance) {
        pinching = false;
        return PINCH_EVENT.END;
      }
      return null;
    },

    /** Fuerza la liberación (p. ej. por pérdida de tracking). Devuelve true si estaba cerrada. */
    forceRelease() {
      const was = pinching;
      pinching = false;
      return was;
    },
  };
}
