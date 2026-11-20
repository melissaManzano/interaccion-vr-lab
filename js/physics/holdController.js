/**
 * holdController.js — Sostener figuras con la mano SIN romper la física.
 *
 * La figura sostenida sigue siendo un cuerpo DINÁMICO: no se teletransporta ni se
 * convierte en cinemático. En cada subpaso se le asigna una velocidad proporcional a
 * la distancia hasta el punto objetivo de la mano:
 *
 *     v = (objetivo − posición) · stiffness      (limitada a maxSpeed)
 *
 * Como el solver de contactos corre DESPUÉS de fijar esa velocidad, la figura choca
 * de verdad: no atraviesa mesas, paredes de los recipientes ni otras figuras, y
 * empuja a las que encuentra.
 *
 * Al soltar se conserva la velocidad de la mano (limitada a maxReleaseSpeed), así que
 * se puede dejar caer o lanzar con suavidad.
 */
import * as CANNON from 'cannon-es';

export function createHoldController({ physics, stiffness, maxSpeed, maxReleaseSpeed, heldAngularDamping }) {
  const held = new Map(); // body → { target: CANNON.Vec3, angularDamping, allowSleep }
  const error = new CANNON.Vec3();

  function drive() {
    for (const [body, h] of held) {
      h.target.vsub(body.position, error);
      error.scale(stiffness, body.velocity);
      const speed = body.velocity.length();
      if (speed > maxSpeed) body.velocity.scale(maxSpeed / speed, body.velocity);
      body.wakeUp();
    }
  }
  const unsubscribe = physics.onSubStep(drive);

  return {
    begin(body) {
      if (held.has(body)) return;
      held.set(body, {
        target: body.position.clone(),
        angularDamping: body.angularDamping,
        allowSleep: body.allowSleep,
      });
      body.angularDamping = heldAngularDamping;
      body.allowSleep = false;
      body.wakeUp();
    },

    /** target: cualquier objeto {x, y, z} (por ejemplo, un THREE.Vector3). */
    setTarget(body, target) {
      const h = held.get(body);
      if (h) h.target.set(target.x, target.y, target.z);
    },

    end(body) {
      const h = held.get(body);
      if (!h) return;
      held.delete(body);
      body.angularDamping = h.angularDamping;
      body.allowSleep = h.allowSleep;
      const speed = body.velocity.length();
      if (speed > maxReleaseSpeed) body.velocity.scale(maxReleaseSpeed / speed, body.velocity);
      body.wakeUp();
    },

    endAll() {
      for (const body of [...held.keys()]) this.end(body);
    },

    isHeld: (body) => held.has(body),

    /** Se llama una vez por cuadro ANTES de physics.step (los subpasos siguientes los cubre onSubStep). */
    apply: drive,

    dispose() {
      unsubscribe();
      held.clear();
    },
  };
}
