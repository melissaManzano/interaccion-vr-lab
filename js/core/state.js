/**
 * state.js — Estado central ÚNICO de la aplicación.
 *
 * Aquí vive todo: figuras, recipientes (avance y tiempo de llenado), aciertos,
 * errores, intentos, fase, cronómetro, sesión XR, manos y mensajes.
 *
 * FICHA ÚNICA POR FIGURA (una sola fuente de verdad):
 *   { id, classId, targetBinId, originTableId, status, heldBy, lastBinId, mesh, body }
 * - id / classId / targetBinId: identidad, categoría y recipiente asignado.
 * - originTableId: mesa donde apareció en la distribución actual.
 * - status / heldBy / lastBinId: estado lógico observable.
 * - mesh / body: referencias a la malla de Three.js y al cuerpo de cannon-es
 *   (se enlazan con bindRuntime al crear la escena; este módulo no las usa,
 *   así sigue siendo comprobable con Node sin Three.js ni cannon-es).
 *
 * Los totales (clasificadas X/20, avance por recipiente, intentos) se CALCULAN a
 * partir del estado, así nunca se duplican ni se desincronizan.
 *
 * Los demás módulos LEEN con getState() y MODIFICAN solo mediante los métodos del store.
 */
import * as timer from '../logic/timer.js';
import { accuracy } from '../validation/sortingRules.js';

/**
 * Estados observables de una figura:
 *
 *   disponible ──pinza──▶ sujeta ──abrir dedos──▶ en vuelo ──reposa fuera──▶ disponible
 *        ▲                  ▲                        │    └──reposa en el suelo──▶ recuperable
 *        │                  └─────── pinza ──────────┤
 *        │                                           └──entra a un recipiente──▶ estabilizándose
 *        │                                                 │ quieta 350 ms
 *        │                            recipiente correcto ──┴── recipiente equivocado
 *        │                                   ▼                         ▼
 *        └──── reinicio ◀───────────── clasificada            error (expulsión) ──▶ en vuelo
 *
 * Solo "sujeta" y "clasificada" impiden tomarla con otra pinza.
 */
export const OBJECT_STATUS = Object.freeze({
  AVAILABLE: 'available', // en reposo sobre una mesa o el mostrador
  HELD: 'held', // en una mano (cuerpo cinemático)
  FLYING: 'flying', // liberada / en vuelo (cuerpo dinámico en movimiento)
  SETTLING: 'settling', // dentro de un recipiente, estabilizándose
  SORTED: 'sorted', // clasificada correctamente (bloqueada)
  ERROR: 'error', // depósito equivocado confirmado; el recipiente la expulsa
  RECOVERABLE: 'recoverable', // en reposo en el suelo: se recoge con el rayo
});

export const OBJECT_STATUS_LABEL = Object.freeze({
  available: 'Disponible',
  held: 'Sujeta',
  flying: 'Liberada / en vuelo',
  settling: 'Estabilizándose',
  sorted: 'Clasificada',
  error: 'Error',
  recoverable: 'Recuperable',
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
 * @param {Array<{id:string, classId:string}>} p.bins  un recipiente por categoría
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

  const binOfClass = new Map(bins.map((b) => [b.classId, b.id]));
  for (const o of objects) {
    if (state.objects.has(o.id)) throw new Error(`ID de figura duplicado: ${o.id}`);
    if (!binOfClass.has(o.classId)) throw new Error(`La figura ${o.id} no tiene recipiente para su clase ${o.classId}`);
    state.objects.set(o.id, {
      id: o.id,
      classId: o.classId,
      targetBinId: binOfClass.get(o.classId),
      originTableId: null,
      status: OBJECT_STATUS.AVAILABLE,
      heldBy: null,
      lastBinId: null,
      mesh: null,
      body: null,
    });
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
    /** Intentos de clasificación confirmados = aciertos + errores. */
    attempts: () => state.stats.correct + state.stats.errors,

    /** Enlaza la malla y el cuerpo físico a la ficha de la figura (una vez, al crear la escena). */
    bindRuntime(id, { mesh, body }) {
      const obj = getObject(id);
      obj.mesh = mesh;
      obj.body = body;
    },

    /** Mesa de origen en la distribución actual (la fija el reinicio aleatorio). */
    setOriginTable(id, tableId) {
      getObject(id).originTableId = tableId;
    },
    accuracy: () => accuracy(state.stats.correct, state.stats.errors),

    setObjectStatus(id, status, heldBy = null) {
      if (!VALID_STATUS.has(status)) throw new Error(`Estado de figura inválido: ${status}`);
      const obj = getObject(id);
      if (obj.status === status && status !== OBJECT_STATUS.HELD) return; // sin cambios: no se emite
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

    /** Cuántas figuras hay en cada estado (para el marcador y la portada). */
    countByStatus() {
      const counts = Object.fromEntries(Object.values(OBJECT_STATUS).map((s) => [s, 0]));
      for (const obj of state.objects.values()) counts[obj.status] += 1;
      return counts;
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
        obj.status = OBJECT_STATUS.AVAILABLE;
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
