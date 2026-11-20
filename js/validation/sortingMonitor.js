/**
 * sortingMonitor.js — Observa la simulación y mueve cada figura entre sus estados FÍSICOS.
 *
 * Cada cuadro, para cada figura que no está sujeta ni clasificada:
 *   - Dentro del volumen útil de un recipiente → "en validación". Si permanece
 *     settleMs casi quieta (o el motor la durmió), se llama a game.deposit(), que la
 *     clasifica o registra el error y pide expulsarla.
 *   - Fuera de los recipientes y moviéndose → "en caída".
 *   - Fuera de los recipientes y en reposo → "disponible" (sobre una mesa o el
 *     mostrador) o "recuperable" (en el suelo; se recoge con el rayo).
 *   - Fuera de la sala (debajo del suelo o muy lejos) → vuelve a su lugar en la mesa.
 *
 * La expulsión es un IMPULSO físico real hacia arriba y hacia el usuario, no una animación.
 */
import { findBinContaining, accumulateSettle } from './sortingRules.js';
import { OBJECT_STATUS } from '../core/state.js';

const EJECT_SLIPPERY_MS = 600;
const SLEEPING = 2; // CANNON.Body.SLEEPING

export function createSortingMonitor({ objects, bins, store, game, rules, physics }) {
  const track = new Map(objects.list.map((o) => [o.id, { binMs: 0, restMs: 0, binId: null, ejectMs: 0 }]));
  const setStatus = (id, status) => store.setObjectStatus(id, status);

  return {
    update(deltaSeconds) {
      const deltaMs = deltaSeconds * 1000;
      for (const obj of objects.list) {
        const t = track.get(obj.id);
        const status = store.getObject(obj.id).status;
        const p = obj.body.position;

        // Fin de la expulsión: la figura recupera su fricción normal.
        if (t.ejectMs > 0) {
          t.ejectMs -= deltaMs;
          if (t.ejectMs <= 0) physics.setEjecting(obj.body, false);
        }

        if (status === OBJECT_STATUS.HELD || status === OBJECT_STATUS.SORTED) {
          t.binMs = 0; t.restMs = 0; t.binId = null;
          continue;
        }

        // Recuperación segura: una figura fuera de la sala vuelve a su mesa y cae desde 1 cm.
        if (p.y < rules.respawnBelowY || Math.hypot(p.x, p.z) > rules.respawnRadius) {
          objects.respawn(obj.id);
          t.binMs = 0; t.restMs = 0; t.binId = null; t.ejectMs = 0;
          setStatus(obj.id, OBJECT_STATUS.FALLING);
          continue;
        }

        const sleeping = obj.body.sleepState === SLEEPING;
        const speed = sleeping ? 0 : obj.body.velocity.length();
        const bin = findBinContaining(p, bins);

        if (bin) {
          if (t.binId !== bin.id) { t.binMs = 0; t.binId = bin.id; }
          t.restMs = 0;
          setStatus(obj.id, OBJECT_STATUS.VALIDATING);
          t.binMs = sleeping ? rules.settleMs : accumulateSettle(t.binMs, speed, deltaMs, rules.settleSpeed);
          if (t.binMs >= rules.settleMs) {
            t.binMs = 0;
            game.deposit(obj.id, bin.id); // → clasificada, o error + expulsión (en caída)
          }
          continue;
        }

        t.binMs = 0; t.binId = null;
        t.restMs = accumulateSettle(t.restMs, speed, deltaMs, rules.settleSpeed);
        if (t.restMs >= rules.settleMs) {
          setStatus(obj.id, p.y < rules.floorZoneY ? OBJECT_STATUS.RECOVERABLE : OBJECT_STATUS.AVAILABLE);
        } else if (speed >= rules.settleSpeed) {
          setStatus(obj.id, OBJECT_STATUS.FALLING);
        }
      }
    },

    /**
     * Expulsión (la dispara el hook onEject del juego). Se fija un cambio de velocidad
     * instantáneo, que equivale a un impulso J = m·Δv; desde ahí la gravedad y las
     * colisiones gobiernan la trayectoria. Durante EJECT_SLIPPERY_MS la figura usa un
     * material sin fricción para no quedar encajada contra la pared u otra figura.
     */
    eject(objectId, binId) {
      const obj = objects.get(objectId);
      const bin = bins.find((b) => b.id === binId);
      const body = obj.body;
      // Hacia el usuario (+Z) y un poco hacia fuera del centro del mostrador, para que
      // no caiga en el recipiente vecino.
      const sideways = bin ? Math.sign(bin.x || 1) * 0.15 : 0;
      physics.setEjecting(body, true);
      track.get(objectId).ejectMs = EJECT_SLIPPERY_MS;
      body.wakeUp();
      body.velocity.set(sideways, rules.ejectUp, rules.ejectForward);
      body.angularVelocity.set(1, 0, 0.5);
    },

    reset() {
      for (const [id, t] of track) {
        if (t.ejectMs > 0) physics.setEjecting(objects.get(id).body, false);
        t.binMs = 0; t.restMs = 0; t.binId = null; t.ejectMs = 0;
      }
    },
  };
}
