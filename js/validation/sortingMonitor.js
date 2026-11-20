/**
 * sortingMonitor.js — Observa la simulación y decide CUÁNDO una figura quedó depositada.
 *
 * Cada cuadro, para cada figura libre (ni en la mano ni ya clasificada):
 *   1. ¿Su centro está dentro del volumen interior de algún recipiente? (sortingRules)
 *   2. ¿Lleva settleMs casi quieta (o el motor la durmió)?
 *   → entonces se llama a game.deposit(figura, recipiente).
 *
 * Si el recipiente era el equivocado, el juego pide expulsarla (hook onEject) y aquí
 * se aplica un IMPULSO físico real hacia arriba y hacia el usuario: no es una animación.
 *
 * También recupera figuras que salieron de la sala (por debajo del suelo o muy lejos).
 */
import { findBinContaining, accumulateSettle } from './sortingRules.js';
import { OBJECT_STATUS } from '../core/state.js';

const EJECT_SLIPPERY_MS = 600;

export function createSortingMonitor({ objects, bins, store, game, rules, physics }) {
  const settle = new Map(objects.list.map((o) => [o.id, { ms: 0, binId: null, ejectMs: 0 }]));

  return {
    update(deltaSeconds) {
      const deltaMs = deltaSeconds * 1000;
      for (const obj of objects.list) {
        const s = settle.get(obj.id);
        const status = store.getObject(obj.id).status;
        const p = obj.body.position;

        // Fin de la expulsión: la figura recupera su fricción normal.
        if (s.ejectMs > 0) {
          s.ejectMs -= deltaMs;
          if (s.ejectMs <= 0) physics.setEjecting(obj.body, false);
        }

        // Recuperación: una figura fuera de la sala vuelve a su mesa.
        if (status !== OBJECT_STATUS.HELD
          && (p.y < rules.respawnBelowY || Math.hypot(p.x, p.z) > rules.respawnRadius)) {
          objects.respawn(obj.id);
          s.ms = 0;
          s.ejectMs = 0;
          continue;
        }

        if (status !== OBJECT_STATUS.FREE) { s.ms = 0; s.binId = null; continue; }

        const bin = findBinContaining(p, bins);
        if (!bin) { s.ms = 0; s.binId = null; continue; }
        if (s.binId !== bin.id) { s.ms = 0; s.binId = bin.id; }

        const sleeping = obj.body.sleepState === 2; // CANNON.Body.SLEEPING
        s.ms = sleeping ? rules.settleMs : accumulateSettle(s.ms, obj.body.velocity.length(), deltaMs, rules.settleSpeed);
        if (s.ms >= rules.settleMs) {
          s.ms = 0;
          game.deposit(obj.id, bin.id);
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
      settle.get(objectId).ejectMs = EJECT_SLIPPERY_MS;
      body.wakeUp();
      body.velocity.set(sideways, rules.ejectUp, rules.ejectForward);
      body.angularVelocity.set(1, 0, 0.5);
    },

    reset() {
      for (const [id, s] of settle) {
        if (s.ejectMs > 0) physics.setEjecting(objects.get(id).body, false);
        s.ms = 0; s.binId = null; s.ejectMs = 0;
      }
    },
  };
}
