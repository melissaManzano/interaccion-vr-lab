/**
 * gameMachine.js — Máquina de estados del reto de clasificación.
 *
 * Fases:   pendiente ──(botón Iniciar)──▶ activo ──(20/20)──▶ completado
 *              ▲                                                 │
 *              └──────────── Reinicio aleatorio ◀────────────────┘
 *
 * Los estados de cada figura (disponible, sujeta, en caída, en validación,
 * clasificada, recuperable) están descritos en core/state.js.
 *
 * La validación NO ocurre al soltar: ocurre cuando la física deja la figura en
 * reposo dentro de un recipiente (ver sortingMonitor.js). Así un rebote que la saca
 * del bote no cuenta, y una figura lanzada que cae dentro sí cuenta.
 *
 * No toca Three.js ni cannon-es: los efectos se delegan en "hooks".
 */
import { OBJECT_STATUS, PHASE, MESSAGE_KIND } from '../core/state.js';
import { evaluateDeposit, validateSortingConfig, DEPOSIT_RESULT } from '../validation/sortingRules.js';
import { formatTime } from './timer.js';

export function createGameMachine({ store, classes, bins, perClass, rules, hooks = {}, now = () => performance.now() }) {
  validateSortingConfig({ classes, bins, perClass });

  const classById = new Map(classes.map((c) => [c.id, c]));
  const binById = new Map(bins.map((b) => [b.id, b]));
  const binByClass = new Map(bins.map((b) => [b.classId, b]));

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

  const className = (classId) => classById.get(classId)?.name ?? classId;
  const binName = (binId) => {
    const bin = binById.get(binId);
    const cls = bin && classById.get(bin.classId);
    return cls ? `${cls.label} · ${cls.plural}` : binId;
  };

  const GRABBABLE = new Set([
    OBJECT_STATUS.AVAILABLE, OBJECT_STATUS.FALLING, OBJECT_STATUS.VALIDATING, OBJECT_STATUS.RECOVERABLE,
  ]);

  /** Solo se juega en fase ACTIVA: antes hay que pulsar "Iniciar". */
  function canGrab(objectId) {
    const obj = store.getObject(objectId);
    return store.getState().phase === PHASE.ACTIVE
      && GRABBABLE.has(obj.status)
      && obj.heldBy === null;
  }

  /** Inicio explícito (botón 3D "Iniciar"): arranca el cronómetro. */
  function start() {
    if (store.getState().phase !== PHASE.PENDING) return false;
    store.setPhase(PHASE.ACTIVE);
    store.startTimer(now());
    notify('¡Comienza! Toma una figura de cualquier mesa y llévala a su recipiente.', MESSAGE_KIND.INFO);
    callHook('onStart');
    return true;
  }

  function grab(objectId, sourceId) {
    if (!canGrab(objectId)) return false;
    store.setObjectStatus(objectId, OBJECT_STATUS.HELD, sourceId);
    const cls = store.getObject(objectId).classId;
    const target = binByClass.get(cls);
    notify(`Sostienes: ${className(cls)}. Llévalo al recipiente ${binName(target.id)}.`, MESSAGE_KIND.INFO);
    callHook('onGrab', objectId);
    return true;
  }

  /** Al abrir los dedos: la figura cae y la física decide dónde termina. */
  function release(objectId) {
    const obj = store.getObject(objectId);
    if (obj.status !== OBJECT_STATUS.HELD) return false;
    store.setObjectStatus(objectId, OBJECT_STATUS.FALLING);
    callHook('onRelease', objectId);
    return true;
  }

  /** Libera sin intención del usuario (pérdida de tracking o fin de sesión). */
  function cancel(objectId, reason) {
    if (!release(objectId)) return;
    if (reason === 'tracking-lost') {
      notify('Se perdió el seguimiento de la mano: la figura se soltó y cayó por gravedad.', MESSAGE_KIND.WARNING);
    }
  }

  function complete() {
    const t = now();
    store.pauseTimer(t);
    store.setPhase(PHASE.COMPLETED);
    const total = formatTime(store.elapsedMs(t));
    const { errors } = store.getState().stats;
    notify(`¡Laboratorio completado en ${total}! Errores: ${errors}. Pulsa "Reinicio aleatorio" para otra ronda.`,
      MESSAGE_KIND.SUCCESS, null);
    callHook('onComplete', store.elapsedMs(t));
  }

  /**
   * Una figura quedó EN REPOSO dentro de un recipiente. Lo llama sortingMonitor.
   * @returns {'correct'|'wrong'|null}  null si ya se evaluó ese intento
   */
  function deposit(objectId, binId) {
    const obj = store.getObject(objectId);
    if (obj.status === OBJECT_STATUS.HELD || obj.status === OBJECT_STATUS.SORTED) return null;
    const bin = binById.get(binId);
    if (!bin) throw new Error(`Recipiente desconocido: ${binId}`);

    // Mismo intento ya evaluado en este recipiente: no se vuelve a contar.
    // (Si una figura equivocada recae en el mismo bote, solo se vuelve a expulsar.)
    if (obj.lastBinId === binId) {
      if (evaluateDeposit(obj.classId, bin) === DEPOSIT_RESULT.WRONG) {
        store.setObjectStatus(objectId, OBJECT_STATUS.FALLING);
        callHook('onEject', objectId, binId);
      }
      return null;
    }
    if (store.getState().phase === PHASE.COMPLETED) return null;

    const result = evaluateDeposit(obj.classId, bin);
    if (result === DEPOSIT_RESULT.CORRECT) {
      const filled = store.recordCorrect(objectId, binId, store.elapsedMs(now()));
      callHook('onCorrect', objectId, binId);
      const binState = store.getBin(binId);
      if (store.sortedCount() === store.totalObjects()) {
        if (filled) callHook('onBinFilled', binId, binState.completedAtMs);
        complete();
      } else if (filled) {
        callHook('onBinFilled', binId, binState.completedAtMs);
        notify(`¡Recipiente ${binName(binId)} completo en ${formatTime(binState.completedAtMs)}!`, MESSAGE_KIND.SUCCESS);
      } else {
        notify(`¡Correcto! ${className(obj.classId)} en ${binName(binId)} (${binState.count}/${binState.capacity}). Total ${store.sortedCount()}/${store.totalObjects()}`,
          MESSAGE_KIND.SUCCESS);
      }
    } else {
      store.recordError(objectId, binId);
      store.setObjectStatus(objectId, OBJECT_STATUS.FALLING); // la expulsión la pone en movimiento
      callHook('onWrong', objectId, binId);
      callHook('onEject', objectId, binId);
      const target = binByClass.get(obj.classId);
      notify(`Error: ${className(obj.classId)} no va en ${binName(binId)}. Su recipiente es ${binName(target.id)}.`,
        MESSAGE_KIND.ERROR);
    }
    return result;
  }

  function reset() {
    store.resetProgress();
    callHook('onReset');
    notify('Reinicio aleatorio: nueva distribución. Pulsa "Iniciar" para comenzar.', MESSAGE_KIND.INFO);
  }

  function onSessionStart() {
    if (store.getState().phase === PHASE.ACTIVE) store.startTimer(now());
  }

  function onSessionEnd() {
    if (store.getState().phase === PHASE.ACTIVE) store.pauseTimer(now());
  }

  return Object.freeze({
    canGrab, start, grab, release, cancel, deposit, reset, notify, onSessionStart, onSessionEnd,
  });
}
