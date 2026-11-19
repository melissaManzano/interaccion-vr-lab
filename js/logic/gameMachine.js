/**
 * gameMachine.js — Máquina de estados del reto.
 *
 * Fases:   pendiente ──(primer agarre)──▶ activo ──(5/5)──▶ completado
 *              ▲                                              │
 *              └──────────────── Reiniciar ◀──────────────────┘
 *
 * Pieza:   disponible ─(pinza)─▶ seleccionada ─(se mueve)─▶ en movimiento
 *              ▲                                              │ (soltar)
 *              └──── error / fuera de zona ◀── validar ──▶ colocada (bloqueada)
 *
 * No toca Three.js: los efectos visuales y de sonido se delegan en "hooks".
 */
import { PIECE_STATUS, PHASE, MESSAGE_KIND } from '../core/state.js';
import { evaluateDrop, validateRuleConfig, DROP_RESULT } from './assemblyRules.js';
import { formatTime } from './timer.js';

const HELD = new Set([PIECE_STATUS.SELECTED, PIECE_STATUS.DRAGGING]);

export function createGameMachine({ store, pieceDefs, targets, rules, hooks = {}, now = () => performance.now() }) {
  validateRuleConfig(rules);
  if (!Array.isArray(targets) || targets.length !== pieceDefs.length) {
    throw new Error('Debe existir exactamente un destino por pieza.');
  }

  const defs = new Map(pieceDefs.map((d) => [d.id, d]));
  const labelByTarget = new Map(pieceDefs.map((d) => [d.targetId, d.label]));

  function callHook(name, ...args) {
    const fn = hooks[name];
    if (typeof fn !== 'function') return;
    try {
      fn(...args);
    } catch (err) {
      console.error(`[game] Error en hook "${name}":`, err);
    }
  }

  /** Publica un mensaje. durationMs = null lo deja fijo. */
  function notify(text, kind = MESSAGE_KIND.INFO, durationMs = rules.messageMs) {
    const expiresAt = durationMs === null ? null : now() + durationMs;
    store.setMessage(text, kind, expiresAt);
  }

  function describe(pieceId) {
    const def = defs.get(pieceId);
    return def ? `${def.name} (${def.label})` : pieceId;
  }

  function canGrab(pieceId) {
    const piece = store.getPiece(pieceId);
    return store.getState().phase !== PHASE.COMPLETED
      && piece.status === PIECE_STATUS.AVAILABLE
      && piece.heldBy === null;
  }

  function grab(pieceId, sourceId) {
    if (!canGrab(pieceId)) return false;
    if (store.getState().phase === PHASE.PENDING) store.setPhase(PHASE.ACTIVE);
    store.startTimer(now());
    store.setPieceStatus(pieceId, PIECE_STATUS.SELECTED, sourceId);
    notify(`Sostienes: ${describe(pieceId)}. Suéltala en su destino.`, MESSAGE_KIND.INFO);
    callHook('onGrab', pieceId);
    return true;
  }

  function markMoving(pieceId) {
    const piece = store.getPiece(pieceId);
    if (piece.status === PIECE_STATUS.SELECTED) {
      store.setPieceStatus(pieceId, PIECE_STATUS.DRAGGING, piece.heldBy);
    }
  }

  function complete() {
    const t = now();
    store.pauseTimer(t);
    store.setPhase(PHASE.COMPLETED);
    const time = formatTime(store.elapsedMs(t));
    notify(`¡Laboratorio completado! Tiempo: ${time}`, MESSAGE_KIND.SUCCESS, null);
    callHook('onComplete', store.elapsedMs(t));
  }

  /** Valida al SOLTAR. Devuelve el resultado de evaluateDrop o null si no aplica. */
  function release(pieceId, position) {
    const piece = store.getPiece(pieceId);
    if (!HELD.has(piece.status)) return null;

    const outcome = evaluateDrop({ pieceTargetId: piece.targetId, position, targets, rules });
    const name = describe(pieceId);

    switch (outcome.result) {
      case DROP_RESULT.SUCCESS:
        store.setPieceStatus(pieceId, PIECE_STATUS.PLACED);
        callHook('onSuccess', pieceId, outcome.targetId);
        if (store.placedCount() === store.totalPieces()) {
          complete();
        } else {
          notify(`¡Correcto! ${name} ensamblado. ${store.placedCount()}/${store.totalPieces()}`, MESSAGE_KIND.SUCCESS);
        }
        break;

      case DROP_RESULT.WRONG_TARGET:
        store.setPieceStatus(pieceId, PIECE_STATUS.AVAILABLE);
        callHook('onError', pieceId, outcome);
        notify(`Destino incorrecto: ${name} va en el destino ${labelByTarget.get(piece.targetId)}.`, MESSAGE_KIND.ERROR);
        break;

      case DROP_RESULT.TOO_FAR: {
        store.setPieceStatus(pieceId, PIECE_STATUS.AVAILABLE);
        callHook('onError', pieceId, outcome);
        const cm = (outcome.distance * 100).toFixed(1);
        const max = (rules.tolerance * 100).toFixed(0);
        notify(`Casi: quedó a ${cm} cm del centro (máx. ${max} cm). Acércala más.`, MESSAGE_KIND.ERROR);
        break;
      }

      case DROP_RESULT.OUT_OF_ZONE:
      default:
        store.setPieceStatus(pieceId, PIECE_STATUS.AVAILABLE);
        callHook('onReturnHome', pieceId);
        notify(`${name} no estaba cerca de ningún destino y volvió a su lugar.`, MESSAGE_KIND.INFO);
        break;
    }
    return outcome;
  }

  /** Libera una pieza SIN validar (pérdida de tracking, fin de sesión). */
  function cancel(pieceId, reason) {
    const piece = store.getPiece(pieceId);
    if (!HELD.has(piece.status)) return;
    store.setPieceStatus(pieceId, PIECE_STATUS.AVAILABLE);
    callHook('onReturnHome', pieceId);
    if (reason === 'tracking-lost') {
      notify(`Se perdió el seguimiento de la mano. ${describe(pieceId)} volvió a su lugar.`, MESSAGE_KIND.WARNING);
    }
  }

  function reset() {
    store.resetProgress();
    callHook('onReset');
    notify('Laboratorio reiniciado. Pellizca una pieza para comenzar.', MESSAGE_KIND.INFO);
  }

  function onSessionStart() {
    if (store.getState().phase === PHASE.ACTIVE) store.startTimer(now());
  }

  function onSessionEnd() {
    if (store.getState().phase === PHASE.ACTIVE) store.pauseTimer(now());
  }

  return Object.freeze({
    canGrab, grab, markMoving, release, cancel, reset, notify, onSessionStart, onSessionEnd,
  });
}
