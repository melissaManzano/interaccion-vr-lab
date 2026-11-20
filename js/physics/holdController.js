/**
 * holdController.js — Sostener figuras con la mano: DINÁMICO → CINEMÁTICO → DINÁMICO.
 *
 * 1. Al agarrar, el cuerpo pasa a KINEMATIC: deja de sentir gravedad y colisiones
 *    (masa efectiva infinita), pero se sigue moviendo por VELOCIDAD y empuja a las
 *    figuras dinámicas que encuentra. Nunca se teletransporta.
 *
 *        v = (objetivo − posición) · stiffness      (limitada a maxSpeed)
 *
 * 2. Un cuerpo cinemático no es detenido por los estáticos (atravesaría mesas y
 *    paredes). Por eso, antes de cada subpaso se hace un BARRIDO: un rayo en la
 *    dirección del movimiento contra los colisionadores estáticos. Si el cuerpo
 *    tocaría uno, se elimina la componente de la velocidad que entra en la superficie
 *    y la figura se DESLIZA sobre ella (sobre la mesa, a lo largo de la pared).
 *
 * 3. Al soltar, el cuerpo vuelve a DYNAMIC con su masa, recibe una velocidad de
 *    liberación ESTABLE (promedio de los últimos subpasos, limitada a maxReleaseSpeed)
 *    y desde ahí manda la física: gravedad, rebotes, fricción y colisiones.
 */
import * as CANNON from 'cannon-es';

const RELEASE_SAMPLES = 6; // ≈ 66 ms a 90 Hz: filtra el temblor del tracking

export function createHoldController({ physics, stiffness, maxSpeed, maxReleaseSpeed }) {
  const held = new Map(); // body → estado del agarre
  const error = new CANNON.Vec3();
  const from = new CANNON.Vec3();
  const to = new CANNON.Vec3();
  const dir = new CANNON.Vec3();

  function sweep(body, h, dt) {
    const v = body.velocity;
    // Dos pasadas: si tras deslizar sobre una superficie aparece otra (rincón), también se respeta.
    for (let pass = 0; pass < 2; pass += 1) {
      const speed = v.length();
      if (speed < 1e-6) return;
      const travel = speed * dt;
      v.scale(1 / speed, dir);
      from.copy(body.position);
      dir.scale(travel + h.probeRadius, to);
      to.vadd(from, to);
      const hit = physics.raycastStatic(from, to);
      if (!hit || hit.distance - h.probeRadius > travel) return;
      const into = v.dot(hit.normal);
      if (into >= 0) return;
      // Quita la componente normal (entrante): la figura se desliza sobre la superficie.
      v.x -= hit.normal.x * into;
      v.y -= hit.normal.y * into;
      v.z -= hit.normal.z * into;
    }
  }

  function drive(dt) {
    for (const [body, h] of held) {
      h.target.vsub(body.position, error);
      error.scale(stiffness, body.velocity);
      const speed = body.velocity.length();
      if (speed > maxSpeed) body.velocity.scale(maxSpeed / speed, body.velocity);
      sweep(body, h, dt);
      body.angularVelocity.setZero();
      // Historial para la velocidad de liberación.
      h.samples[h.next].copy(body.velocity);
      h.next = (h.next + 1) % RELEASE_SAMPLES;
      h.count = Math.min(RELEASE_SAMPLES, h.count + 1);
    }
  }
  const unsubscribe = physics.onSubStep(drive);

  return {
    /** probeRadius: distancia del centro a la superficie de la figura (para el barrido). */
    begin(body, probeRadius) {
      if (held.has(body)) return;
      held.set(body, {
        target: body.position.clone(),
        probeRadius,
        allowSleep: body.allowSleep,
        samples: Array.from({ length: RELEASE_SAMPLES }, () => new CANNON.Vec3()),
        next: 0,
        count: 0,
      });
      body.allowSleep = false;
      body.wakeUp();
      body.type = CANNON.Body.KINEMATIC; // dinámico → cinemático
      body.updateSolveMassProperties();
      body.velocity.setZero();
      body.angularVelocity.setZero();
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
      // Velocidad de liberación estable: promedio de los últimos subpasos.
      const release = new CANNON.Vec3();
      for (let i = 0; i < h.count; i += 1) release.vadd(h.samples[i], release);
      if (h.count > 0) release.scale(1 / h.count, release);
      const speed = release.length();
      if (speed > maxReleaseSpeed) release.scale(maxReleaseSpeed / speed, release);

      body.type = CANNON.Body.DYNAMIC; // cinemático → dinámico
      body.updateSolveMassProperties();
      body.allowSleep = h.allowSleep;
      body.velocity.copy(release);
      body.angularVelocity.setZero();
      body.wakeUp();
    },

    endAll() {
      for (const body of [...held.keys()]) this.end(body);
    },

    isHeld: (body) => held.has(body),

    /** Se llama una vez por cuadro ANTES de physics.step (los subpasos siguientes los cubre onSubStep). */
    apply: (dt) => drive(dt),

    dispose() {
      unsubscribe();
      held.clear();
    },
  };
}
