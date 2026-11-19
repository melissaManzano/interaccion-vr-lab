/**
 * logic.test.mjs — Pruebas automatizadas de las reglas de negocio (sin visor ni Three.js).
 *
 * Ejecutar desde la raíz del proyecto (requiere Node 18+; no usa npm ni dependencias):
 *   node --test tests/
 *
 * Cubren lo que se puede comprobar sin hardware: validación al soltar, estado único,
 * máquina de estados, cronómetro y la histéresis de la pinza. La interacción con
 * manos reales se valida en el Quest con la matriz de pruebas del README.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../js/config.js';
import { evaluateDrop, validateRuleConfig, DROP_RESULT } from '../js/logic/assemblyRules.js';
import { createStore, PIECE_STATUS, PHASE } from '../js/core/state.js';
import { createGameMachine } from '../js/logic/gameMachine.js';
import * as timer from '../js/logic/timer.js';
import { createPinchDetector, PINCH_EVENT } from '../js/xr/pinchDetector.js';

const ANCHOR_Y = 0.85;
const RULES = CONFIG.rules;
const TARGETS = CONFIG.targets.map((t) => ({ id: t.id, anchor: { x: t.x, y: ANCHOR_Y, z: t.z } }));
const anchorOf = (targetId) => TARGETS.find((t) => t.id === targetId).anchor;
const offset = (p, dx) => ({ x: p.x + dx, y: p.y, z: p.z });

function setup() {
  let clock = 0;
  const calls = [];
  const store = createStore(CONFIG.pieces);
  const hooks = new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args]) });
  const game = createGameMachine({
    store, pieceDefs: CONFIG.pieces, targets: TARGETS, rules: RULES, hooks, now: () => clock,
  });
  return { store, game, calls, tick: (ms) => { clock += ms; } };
}

describe('Reglas de validación al soltar (assemblyRules)', () => {
  test('acierto: destino correcto dentro de la tolerancia', () => {
    const r = evaluateDrop({ pieceTargetId: 'T1', position: offset(anchorOf('T1'), 0.03), targets: TARGETS, rules: RULES });
    assert.equal(r.result, DROP_RESULT.SUCCESS);
    assert.equal(r.targetId, 'T1');
  });

  test('límite: exactamente a la tolerancia sigue siendo acierto', () => {
    const r = evaluateDrop({ pieceTargetId: 'T1', position: offset(anchorOf('T1'), RULES.tolerance), targets: TARGETS, rules: RULES });
    assert.equal(r.result, DROP_RESULT.SUCCESS);
  });

  test('distancia excesiva: su destino, pero entre tolerance y detectionRadius', () => {
    // Se desplaza en Y para no acercarse a los destinos vecinos (están a 22 cm en X).
    const a = anchorOf('T1');
    const r = evaluateDrop({ pieceTargetId: 'T1', position: { x: a.x, y: a.y + 0.12, z: a.z }, targets: TARGETS, rules: RULES });
    assert.equal(r.result, DROP_RESULT.TOO_FAR);
    assert.ok(Math.abs(r.distance - 0.12) < 1e-9);
  });

  test('destino incorrecto: el más cercano no es el suyo', () => {
    const r = evaluateDrop({ pieceTargetId: 'T1', position: anchorOf('T3'), targets: TARGETS, rules: RULES });
    assert.equal(r.result, DROP_RESULT.WRONG_TARGET);
    assert.equal(r.targetId, 'T3');
  });

  test('fuera de zona: ningún destino dentro de detectionRadius', () => {
    const r = evaluateDrop({ pieceTargetId: 'T1', position: { x: 0, y: 1.5, z: 0 }, targets: TARGETS, rules: RULES });
    assert.equal(r.result, DROP_RESULT.OUT_OF_ZONE);
  });

  test('configuración incoherente se rechaza con un error claro', () => {
    assert.throws(() => validateRuleConfig({ tolerance: 0.3, detectionRadius: 0.2 }), RangeError);
    assert.throws(() => validateRuleConfig({ tolerance: 0, detectionRadius: 0.2 }), RangeError);
  });

  test('cada pieza tiene un destino propio y distinto (5 ↔ 5)', () => {
    const targetIds = CONFIG.pieces.map((p) => p.targetId);
    assert.equal(new Set(targetIds).size, 5);
    assert.deepEqual([...targetIds].sort(), CONFIG.targets.map((t) => t.id).sort());
  });
});

describe('Estado único y acciones duplicadas (store + gameMachine)', () => {
  test('una pieza no puede tomarse con dos manos a la vez', () => {
    const { game, store } = setup();
    assert.equal(game.grab('P1', 'left'), true);
    assert.equal(game.grab('P1', 'right'), false);
    assert.equal(store.getPiece('P1').heldBy, 'left');
  });

  test('soltar dos veces no cuenta dos veces', () => {
    const { game, store } = setup();
    game.grab('P1', 'left');
    assert.equal(game.release('P1', anchorOf('T1')).result, DROP_RESULT.SUCCESS);
    assert.equal(game.release('P1', anchorOf('T1')), null);
    assert.equal(store.placedCount(), 1);
  });

  test('una pieza colocada queda bloqueada', () => {
    const { game, store } = setup();
    game.grab('P1', 'left');
    game.release('P1', anchorOf('T1'));
    assert.equal(store.getPiece('P1').status, PIECE_STATUS.PLACED);
    assert.equal(game.grab('P1', 'right'), false);
  });

  test('un error no suma y la pieza vuelve a estar disponible', () => {
    const { game, store } = setup();
    game.grab('P1', 'left');
    game.release('P1', anchorOf('T3'));
    assert.equal(store.placedCount(), 0);
    assert.equal(store.getPiece('P1').status, PIECE_STATUS.AVAILABLE);
  });

  test('pérdida de tracking: libera sin validar y no suma', () => {
    const { game, store, calls } = setup();
    game.grab('P1', 'left');
    game.cancel('P1', 'tracking-lost');
    assert.equal(store.placedCount(), 0);
    assert.equal(store.getPiece('P1').status, PIECE_STATUS.AVAILABLE);
    assert.ok(calls.some(([name]) => name === 'onReturnHome'));
  });

  test('flujo completo: pendiente → activo → completado (5/5) y cronómetro detenido', () => {
    const { game, store, tick } = setup();
    assert.equal(store.getState().phase, PHASE.PENDING);
    for (const p of CONFIG.pieces) {
      tick(1000);
      assert.equal(game.grab(p.id, 'right'), true);
      assert.equal(store.getState().phase, PHASE.ACTIVE);
      game.markMoving(p.id);
      assert.equal(store.getPiece(p.id).status, PIECE_STATUS.DRAGGING);
      tick(1000);
      game.release(p.id, anchorOf(p.targetId));
    }
    assert.equal(store.placedCount(), 5);
    assert.equal(store.getState().phase, PHASE.COMPLETED);
    assert.equal(store.isTimerRunning(), false);
    const final = store.elapsedMs(0);
    tick(5000);
    assert.equal(store.elapsedMs(999999), final, 'el tiempo no avanza tras completar');
  });

  test('reiniciar restaura 0/5, fase pendiente y cronómetro en cero', () => {
    const { game, store, tick } = setup();
    game.grab('P1', 'left');
    tick(2000);
    game.release('P1', anchorOf('T1'));
    game.reset();
    assert.equal(store.placedCount(), 0);
    assert.equal(store.getState().phase, PHASE.PENDING);
    assert.equal(store.elapsedMs(10_000), 0);
  });

  test('salir y volver a VR conserva el progreso y pausa el cronómetro', () => {
    const { game, store, tick } = setup();
    game.grab('P1', 'left');
    tick(3000);
    game.release('P1', anchorOf('T1'));
    game.onSessionEnd();
    const paused = store.elapsedMs(0);
    tick(60_000);
    game.onSessionStart();
    assert.equal(store.placedCount(), 1);
    assert.ok(store.elapsedMs(Infinity) >= paused);
    assert.equal(store.isTimerRunning(), true);
  });
});

describe('Cronómetro', () => {
  test('acumula tramos con pausa y reanudación', () => {
    const t = timer.createTimerState();
    timer.startTimer(t, 0);
    timer.pauseTimer(t, 1000);
    timer.startTimer(t, 5000);
    assert.equal(timer.elapsedMs(t, 5500), 1500);
    assert.equal(timer.formatTime(61_500), '01:01.5');
  });
});

describe('Pinza con histéresis', () => {
  const make = () => createPinchDetector({ closeDistance: 0.02, openDistance: 0.035 });

  test('la zona intermedia no genera parpadeos', () => {
    const p = make();
    assert.equal(p.update({ distance: 0.015, palmFacing: false }), PINCH_EVENT.START);
    assert.equal(p.update({ distance: 0.03, palmFacing: false }), null);
    assert.equal(p.update({ distance: 0.019, palmFacing: false }), null);
    assert.equal(p.update({ distance: 0.04, palmFacing: false }), PINCH_EVENT.END);
  });

  test('la pinza con la palma hacia el usuario (gesto del sistema) no inicia acciones', () => {
    const p = make();
    assert.equal(p.update({ distance: 0.01, palmFacing: true }), null);
    assert.equal(p.isPinching(), false);
  });

  test('si la palma gira durante un agarre, la pieza no se suelta por error', () => {
    const p = make();
    p.update({ distance: 0.01, palmFacing: false });
    assert.equal(p.update({ distance: 0.01, palmFacing: true }), null);
    assert.equal(p.isPinching(), true);
  });

  test('umbrales inválidos se rechazan', () => {
    assert.throws(() => createPinchDetector({ closeDistance: 0.04, openDistance: 0.02 }), RangeError);
  });
});
