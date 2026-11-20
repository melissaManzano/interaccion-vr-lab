/**
 * state.js — Estado central ÚNICO de la aplicación.
 *
 * Aquí vive todo: figuras (quién sostiene cada una y si ya está clasificada),
 * recipientes (avance y tiempo de llenado), aciertos, errores, fase, cronómetro,
 * sesión XR, manos y mensajes.
 *
 * Los totales (clasificadas X/20, avance por recipiente) se CALCULAN a partir del
 * estado de las figuras y recipientes, así nunca se duplican ni se desincronizan.
 *
 * Los demás módulos LEEN con getState() y MODIFICAN solo mediante los métodos del store.
 * La posición física de cada figura NO vive aquí: es del motor de física.
 */
import * as timer from '../logic/timer.js';
import { accuracy } from '../validation/sortingRules.js';

export const OBJECT_STATUS = Object.freeze({
  FREE: 'free', // sobre una mesa, el piso o rodando: se puede tomar
  HELD: 'held', // en una mano
  SORTED: 'sorted', // clasificada correctamente (bloqueada)
});

export const PHASE = Object.freeze({
  PENDING: 'pending',
  ACTIVE: 'active',
  COMPLETED: 'completed',
});

/** Textos compartidos dentro y fuera de VR para mantener la consistencia. */
export const PHASE_LABEL = Object.freeze({
  pending: 'Pendiente',
  active: 'Activo',
  completed: 'Completado',
});

export const MESSAGE_KIND = Object.freeze({
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
});

const VALID_STATUS = new Set(Object.values(OBJECT_STATUS));
const VALID_PHASE = new Set(Object.values(PHASE));
const VALID_KIND = new Set(Object.values(MESSAGE_KIND));
const HAND_SIDES = new Set(['left', 'right']);

/**
 * @param {object} p
 * @param {Array<{id:string, classId:string}>} p.objects
 * @param {Array<{id:string, classId:string}>} p.bins
 * @param {number} p.capacity  figuras por recipiente (5)
 */
export function createStore({ objects, bins, capacity }) {
  if (!Array.isArray(objects) || objects.length === 0) throw new TypeError('createStore: se requiere una lista de figuras.');
  if (!Array.isArray(bins) || bins.length === 0) throw new TypeError('createStore: se requiere una lista de recipientes.');
  if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('createStore: capacity inválida.');

  const state = {
    phase: PHASE.PENDING,
    objects: new Map(),
    bins: new Map(),
    stats: { correct: 0, errors: 0 },
    timer: timer.createTimerState(),
    xr: { presenting: false, hands: { left: false, right: false } },
    message: { text: '', kind: MESSAGE_KIND.INFO, expiresAt: null },
  };

  for (const o of objects) {
    if (state.objects.has(o.id)) throw new Error(`ID de figura duplicado: ${o.id}`);
    state.objects.set(o.id, { id: o.id, classId: o.classId, status: OBJECT_STATUS.FREE, heldBy: null, lastBinId: null });
  }
  for (const b of bins) {
    if (state.bins.has(b.id)) throw new Error(`ID de recipiente duplicado: ${b.id}`);
    state.bins.set(b.id, { id: b.id, classId: b.classId, count: 0, capacity, completedAtMs: null });
  }

  const listeners = new Set();

  function emit(reason) {
    for (const listener of listeners) {
      try {
        listener(state, reason);
      } catch (err) {
        console.error('[store] Error en un suscriptor:', err);
      }
    }
  }

  function getObject(id) {
    const obj = state.objects.get(id);
    if (!obj) throw new Error(`Figura desconocida: ${id}`);
    return obj;
  }

  function getBin(id) {
    const bin = state.bins.get(id);
    if (!bin) throw new Error(`Recipiente desconocido: ${id}`);
    return bin;
  }

  function sortedCount() {
    let count = 0;
    for (const bin of state.bins.values()) count += bin.count;
    return count;
  }

  return Object.freeze({
    /** Devuelve el estado. Trátalo como SOLO LECTURA. */
    getState: () => state,

    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('subscribe: se esperaba una función.');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getObject,
    getBin,
    sortedCount,
    totalObjects: () => state.objects.size,
    accuracy: () => accuracy(state.stats.correct, state.stats.errors),

    setObjectStatus(id, status, heldBy = null) {
      if (!VALID_STATUS.has(status)) throw new Error(`Estado de figura inválido: ${status}`);
      const obj = getObject(id);
      obj.status = status;
      obj.heldBy = status === OBJECT_STATUS.HELD ? heldBy : null;
      if (status === OBJECT_STATUS.HELD) obj.lastBinId = null; // un nuevo intento
      emit('object');
    },

    /** Recuerda en qué recipiente se evaluó la figura (evita contar dos veces el mismo intento). */
    setLastBin(id, binId) {
      getObject(id).lastBinId = binId;
    },

    /** Registra un acierto. Devuelve true si con él se llenó el recipiente. */
    recordCorrect(objectId, binId, nowElapsedMs) {
      const obj = getObject(objectId);
      const bin = getBin(binId);
      if (obj.status === OBJECT_STATUS.SORTED) return false; // nunca se cuenta dos veces
      if (bin.count >= bin.capacity) return false;
      obj.status = OBJECT_STATUS.SORTED;
      obj.heldBy = null;
      obj.lastBinId = binId;
      bin.count += 1;
      state.stats.correct += 1;
      const filled = bin.count === bin.capacity;
      if (filled) bin.completedAtMs = nowElapsedMs;
      emit('correct');
      return filled;
    },

    recordError(objectId, binId) {
      getObject(objectId).lastBinId = binId;
      state.stats.errors += 1;
      emit('error');
    },

    setPhase(phase) {
      if (!VALID_PHASE.has(phase)) throw new Error(`Fase inválida: ${phase}`);
      if (state.phase === phase) return;
      state.phase = phase;
      emit('phase');
    },

    setMessage(text, kind = MESSAGE_KIND.INFO, expiresAt = null) {
      if (!VALID_KIND.has(kind)) throw new Error(`Tipo de mensaje inválido: ${kind}`);
      state.message = { text: String(text ?? ''), kind, expiresAt };
      emit('message');
    },

    setXrPresenting(presenting) {
      state.xr.presenting = Boolean(presenting);
      emit('xr');
    },

    setHandTracked(side, tracked) {
      if (!HAND_SIDES.has(side)) return;
      if (state.xr.hands[side] === Boolean(tracked)) return;
      state.xr.hands[side] = Boolean(tracked);
      emit('hands');
    },

    startTimer(now) {
      timer.startTimer(state.timer, now);
      emit('timer');
    },

    pauseTimer(now) {
      timer.pauseTimer(state.timer, now);
      emit('timer');
    },

    isTimerRunning: () => timer.isTimerRunning(state.timer),
    elapsedMs: (now) => timer.elapsedMs(state.timer, now),

    /** Restaura figuras, recipientes, estadísticas, fase y cronómetro. */
    resetProgress() {
      for (const obj of state.objects.values()) {
        obj.status = OBJECT_STATUS.FREE;
        obj.heldBy = null;
        obj.lastBinId = null;
      }
      for (const bin of state.bins.values()) {
        bin.count = 0;
        bin.completedAtMs = null;
      }
      state.stats.correct = 0;
      state.stats.errors = 0;
      state.phase = PHASE.PENDING;
      timer.resetTimer(state.timer);
      emit('reset');
    },
  });
}
