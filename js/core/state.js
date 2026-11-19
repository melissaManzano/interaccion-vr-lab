/**
 * state.js — Estado central ÚNICO de la aplicación.
 *
 * Toda la información de la actividad vive aquí: piezas, quién sostiene cada una,
 * fase, cronómetro, sesión XR, manos y mensajes. El contador de piezas colocadas
 * NO se guarda: se calcula a partir del estado de las piezas, así nunca se duplica.
 *
 * Los demás módulos LEEN con getState() y MODIFICAN solo mediante los métodos del store.
 */
import * as timer from '../logic/timer.js';

export const PIECE_STATUS = Object.freeze({
  AVAILABLE: 'available',
  SELECTED: 'selected',
  DRAGGING: 'dragging',
  PLACED: 'placed',
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

const VALID_STATUS = new Set(Object.values(PIECE_STATUS));
const VALID_PHASE = new Set(Object.values(PHASE));
const VALID_KIND = new Set(Object.values(MESSAGE_KIND));
const HAND_SIDES = new Set(['left', 'right']);

export function createStore(pieceDefs) {
  if (!Array.isArray(pieceDefs) || pieceDefs.length === 0) {
    throw new TypeError('createStore: se requiere una lista de piezas.');
  }

  const state = {
    phase: PHASE.PENDING,
    pieces: new Map(),
    timer: timer.createTimerState(),
    xr: { presenting: false, hands: { left: false, right: false } },
    message: { text: '', kind: MESSAGE_KIND.INFO, expiresAt: null },
  };

  for (const def of pieceDefs) {
    if (state.pieces.has(def.id)) throw new Error(`ID de pieza duplicado: ${def.id}`);
    state.pieces.set(def.id, {
      id: def.id,
      targetId: def.targetId,
      status: PIECE_STATUS.AVAILABLE,
      heldBy: null,
    });
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

  function getPiece(id) {
    const piece = state.pieces.get(id);
    if (!piece) throw new Error(`Pieza desconocida: ${id}`);
    return piece;
  }

  function placedCount() {
    let count = 0;
    for (const piece of state.pieces.values()) {
      if (piece.status === PIECE_STATUS.PLACED) count += 1;
    }
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

    getPiece,
    placedCount,
    totalPieces: () => state.pieces.size,

    setPieceStatus(id, status, heldBy = null) {
      if (!VALID_STATUS.has(status)) throw new Error(`Estado de pieza inválido: ${status}`);
      const piece = getPiece(id);
      const holding = status === PIECE_STATUS.SELECTED || status === PIECE_STATUS.DRAGGING;
      piece.status = status;
      piece.heldBy = holding ? heldBy : null;
      emit('piece');
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

    /** Restaura piezas, fase y cronómetro al estado inicial. */
    resetProgress() {
      for (const piece of state.pieces.values()) {
        piece.status = PIECE_STATUS.AVAILABLE;
        piece.heldBy = null;
      }
      state.phase = PHASE.PENDING;
      timer.resetTimer(state.timer);
      emit('reset');
    },
  });
}
