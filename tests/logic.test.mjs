/**
 * logic.test.mjs — Pruebas automatizadas de las reglas de negocio (sin visor, Three.js ni cannon-es).
 *
 * Ejecutar desde la raíz del proyecto (requiere Node 18+; no usa npm ni dependencias):
 *   node --test tests/logic.test.mjs
 *
 * Cubren lo que se puede comprobar sin hardware: reglas de clasificación, volúmenes de
 * los recipientes, distribución aleatoria, estado único, máquina de estados (aciertos,
 * errores, precisión, tiempos de llenado), cronómetro y la histéresis de la pinza.
 * La física y la interacción con manos reales se validan en el Quest (matriz del README).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../js/config.js';
import {
  isInsideBin, findBinContaining, evaluateDeposit, accuracy, formatAccuracy, accumulateSettle,
  buildBinVolumes, validateSortingConfig, DEPOSIT_RESULT,
} from '../js/validation/sortingRules.js';
import { createRng, shuffle, slotOffsets, generateLayout } from '../js/objects/layoutGenerator.js';
import { createStore, OBJECT_STATUS, PHASE } from '../js/core/state.js';
import { createGameMachine } from '../js/logic/gameMachine.js';
import * as timer from '../js/logic/timer.js';
import { createPinchDetector, PINCH_EVENT } from '../js/xr/pinchDetector.js';

const BINS = buildBinVolumes(CONFIG);
const binOf = (classId) => BINS.find((b) => b.classId === classId);
const centerOf = (bin) => ({ x: bin.x, y: bin.floorY + 0.03, z: bin.z });
const OBJECTS = CONFIG.classes.flatMap((c) =>
  Array.from({ length: CONFIG.perClass }, (_, i) => ({ id: `${c.id}-${i + 1}`, classId: c.id })));

function setup() {
  let clock = 0;
  const calls = [];
  const store = createStore({ objects: OBJECTS, bins: CONFIG.bins, capacity: CONFIG.perClass });
  const hooks = new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args]) });
  const game = createGameMachine({
    store, classes: CONFIG.classes, bins: CONFIG.bins, perClass: CONFIG.perClass,
    rules: CONFIG.rules, hooks, now: () => clock,
  });
  /** Simula un intento completo: tomar, soltar y que la física la deje en reposo en `binId`. */
  const drop = (objectId, binId, hand = 'right') => {
    game.grab(objectId, hand);
    game.release(objectId);
    return game.deposit(objectId, binId);
  };
  game.start(); // la mayoría de las pruebas parten de una ronda iniciada
  return { store, game, calls, drop, tick: (ms) => { clock += ms; } };
}

/** Igual que setup(), pero sin pulsar "Iniciar". */
function setupPending() {
  let clock = 0;
  const store = createStore({ objects: OBJECTS, bins: CONFIG.bins, capacity: CONFIG.perClass });
  const game = createGameMachine({
    store, classes: CONFIG.classes, bins: CONFIG.bins, perClass: CONFIG.perClass,
    rules: CONFIG.rules, now: () => clock,
  });
  return { store, game, tick: (ms) => { clock += ms; } };
}

describe('Configuración de la práctica', () => {
  test('4 clases × 5 = 20 figuras, 4 mesas y 4 recipientes (uno por clase)', () => {
    assert.equal(CONFIG.classes.length, 4);
    assert.equal(CONFIG.perClass, 5);
    assert.equal(OBJECTS.length, 20);
    assert.equal(CONFIG.tables.length, 4);
    assert.equal(validateSortingConfig(CONFIG), true);
  });

  test('una clase sin recipiente o con dos recipientes se rechaza', () => {
    const bins = [...CONFIG.bins.slice(0, 3), { id: 'RX', classId: 'cube' }];
    assert.throws(() => validateSortingConfig({ ...CONFIG, bins }), /más de un recipiente/);
    assert.throws(() => validateSortingConfig({ ...CONFIG, bins: CONFIG.bins.slice(0, 3) }), /un recipiente por clase/);
  });

  test('las figuras caben dentro del recipiente (más pequeñas que su interior)', () => {
    const inner = CONFIG.bin.outer - 2 * CONFIG.bin.wall;
    for (const c of CONFIG.classes) {
      const size = c.size.side ?? 2 * c.size.radius;
      assert.ok(size < inner / 2, `${c.name} es demasiado grande para el recipiente`);
    }
  });

  test('los recipientes no se encimen entre sí sobre el mostrador', () => {
    const xs = CONFIG.bins.map((b) => b.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i += 1) assert.ok(xs[i] - xs[i - 1] >= CONFIG.bin.outer);
    assert.ok(Math.max(...xs.map(Math.abs)) + CONFIG.bin.outer / 2 <= CONFIG.counter.width / 2);
  });
});

describe('Reglas de clasificación (sortingRules)', () => {
  test('el centro del recipiente está dentro; fuera de sus paredes, no', () => {
    const bin = binOf('cube');
    assert.equal(isInsideBin(centerOf(bin), bin), true);
    assert.equal(isInsideBin({ ...centerOf(bin), x: bin.x + bin.innerHalf + 0.01 }, bin), false);
    assert.equal(isInsideBin({ ...centerOf(bin), y: bin.floorY - 0.01 }, bin), false);
    assert.equal(isInsideBin({ ...centerOf(bin), y: bin.floorY + bin.height + 0.2 }, bin), false, 'en el aire, encima');
  });

  test('findBinContaining encuentra el recipiente correcto o null', () => {
    assert.equal(findBinContaining(centerOf(binOf('prism')), BINS).id, binOf('prism').id);
    assert.equal(findBinContaining({ x: 0, y: 1.5, z: 0 }, BINS), null);
  });

  test('evaluateDeposit: clase igual = acierto, distinta = error', () => {
    assert.equal(evaluateDeposit('sphere', binOf('sphere')), DEPOSIT_RESULT.CORRECT);
    assert.equal(evaluateDeposit('sphere', binOf('cube')), DEPOSIT_RESULT.WRONG);
  });

  test('precisión: — sin intentos; aciertos ÷ intentos después', () => {
    assert.equal(accuracy(0, 0), null);
    assert.equal(formatAccuracy(accuracy(0, 0)), '—');
    assert.equal(accuracy(3, 1), 0.75);
    assert.equal(formatAccuracy(accuracy(2, 1)), '67 %');
  });

  test('reposo: se acumula si va lento y se reinicia si se mueve', () => {
    const s = CONFIG.rules.settleSpeed;
    let ms = accumulateSettle(0, s / 2, 100, s);
    ms = accumulateSettle(ms, s / 2, 100, s);
    assert.equal(ms, 200);
    assert.equal(accumulateSettle(ms, s * 3, 16, s), 0);
  });
});

describe('Distribución aleatoria (layoutGenerator)', () => {
  test('mismo generador con la misma semilla = misma distribución (reproducible)', () => {
    const a = generateLayout({ objects: OBJECTS, tables: CONFIG.tables, spawn: CONFIG.spawn, rng: createRng(7) });
    const b = generateLayout({ objects: OBJECTS, tables: CONFIG.tables, spawn: CONFIG.spawn, rng: createRng(7) });
    assert.deepEqual([...a.entries()], [...b.entries()]);
  });

  test('semillas distintas cambian la distribución', () => {
    const a = generateLayout({ objects: OBJECTS, tables: CONFIG.tables, spawn: CONFIG.spawn, rng: createRng(1) });
    const b = generateLayout({ objects: OBJECTS, tables: CONFIG.tables, spawn: CONFIG.spawn, rng: createRng(2) });
    const tableOf = (m) => OBJECTS.map((o) => m.get(o.id).tableId).join();
    assert.notEqual(tableOf(a), tableOf(b));
  });

  test('5 figuras por mesa, todas sobre su mesa y sin encimarse', () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const layout = generateLayout({ objects: OBJECTS, tables: CONFIG.tables, spawn: CONFIG.spawn, rng: createRng(seed) });
      assert.equal(layout.size, 20);
      for (const table of CONFIG.tables) {
        const here = [...layout.values()].filter((p) => p.tableId === table.id);
        assert.equal(here.length, 5);
        for (const p of here) {
          assert.ok(Math.abs(p.x - table.x) < CONFIG.table.width / 2 - CONFIG.table.rimThickness - 0.035);
          assert.ok(Math.abs(p.z - table.z) < CONFIG.table.depth / 2 - CONFIG.table.rimThickness - 0.035);
        }
        for (let i = 0; i < here.length; i += 1) {
          for (let j = i + 1; j < here.length; j += 1) {
            const d = Math.hypot(here[i].x - here[j].x, here[i].z - here[j].z);
            assert.ok(d > 0.09, `figuras encimadas (${d.toFixed(3)} m) con semilla ${seed}`);
          }
        }
      }
    }
  });

  test('shuffle conserva los elementos; la rejilla tiene ranuras suficientes', () => {
    const items = [1, 2, 3, 4, 5, 6];
    assert.deepEqual(shuffle(items, createRng(3)).sort(), items);
    assert.ok(slotOffsets(CONFIG.spawn).length >= CONFIG.perClass);
    assert.throws(() => generateLayout({
      objects: OBJECTS, tables: CONFIG.tables.slice(0, 1), spawn: CONFIG.spawn,
    }), RangeError);
  });
});

describe('Estado único, aciertos y errores (store + gameMachine)', () => {
  test('una figura no puede tomarse con dos manos a la vez', () => {
    const { game, store } = setup();
    assert.equal(game.grab('cube-1', 'left'), true);
    assert.equal(game.grab('cube-1', 'right'), false);
    assert.equal(store.getObject('cube-1').heldBy, 'left');
  });

  test('soltar NO valida: la figura pasa a "en caída" hasta reposar en un recipiente', () => {
    const { game, store } = setup();
    game.grab('cube-1', 'left');
    assert.equal(store.getObject('cube-1').status, OBJECT_STATUS.HELD);
    game.release('cube-1');
    assert.equal(store.getObject('cube-1').status, OBJECT_STATUS.FALLING);
    assert.equal(store.sortedCount(), 0);
  });

  test('se puede volver a tomar una figura en caída, en validación o recuperable', () => {
    const { game, store } = setup();
    for (const status of [OBJECT_STATUS.FALLING, OBJECT_STATUS.VALIDATING, OBJECT_STATUS.RECOVERABLE]) {
      store.setObjectStatus('cube-1', status);
      assert.equal(game.canGrab('cube-1'), true, status);
    }
  });

  test('acierto: suma 1, avanza su recipiente y la figura queda bloqueada', () => {
    const { store, game, drop, calls } = setup();
    assert.equal(drop('cube-1', 'R1'), DEPOSIT_RESULT.CORRECT);
    assert.equal(store.sortedCount(), 1);
    assert.equal(store.getBin('R1').count, 1);
    assert.equal(store.getObject('cube-1').status, OBJECT_STATUS.SORTED);
    assert.equal(game.grab('cube-1', 'left'), false);
    assert.ok(calls.some(([n]) => n === 'onCorrect'));
  });

  test('un mismo depósito correcto no se cuenta dos veces', () => {
    const { store, game, drop } = setup();
    drop('cube-1', 'R1');
    assert.equal(game.deposit('cube-1', 'R1'), null);
    assert.equal(store.sortedCount(), 1);
    assert.equal(store.getState().stats.correct, 1);
  });

  test('error: suma un error, pide expulsar y no avanza el recipiente', () => {
    const { store, drop, calls } = setup();
    assert.equal(drop('cube-1', 'R2'), DEPOSIT_RESULT.WRONG);
    assert.equal(store.getState().stats.errors, 1);
    assert.equal(store.getBin('R2').count, 0);
    assert.equal(store.getObject('cube-1').status, OBJECT_STATUS.FALLING, 'la expulsión la pone en caída');
    assert.ok(calls.some(([n]) => n === 'onEject'));
  });

  test('si la figura equivocada recae en el mismo recipiente, se expulsa otra vez SIN otro error', () => {
    const { store, game, drop, calls } = setup();
    drop('cube-1', 'R2');
    const ejects = () => calls.filter(([n]) => n === 'onEject').length;
    assert.equal(game.deposit('cube-1', 'R2'), null);
    assert.equal(store.getState().stats.errors, 1);
    assert.equal(ejects(), 2);
  });

  test('un nuevo intento (volver a tomarla) sí puede contar un nuevo error', () => {
    const { store, drop } = setup();
    drop('cube-1', 'R2');
    drop('cube-1', 'R2');
    assert.equal(store.getState().stats.errors, 2);
  });

  test('precisión del marcador = aciertos ÷ (aciertos + errores)', () => {
    const { store, drop } = setup();
    drop('cube-1', 'R2');
    drop('cube-1', 'R1');
    drop('sphere-1', 'R2');
    drop('sphere-2', 'R2');
    assert.equal(store.accuracy(), 3 / 4);
  });

  test('pérdida de tracking: la figura se suelta (en caída) y no cuenta', () => {
    const { game, store } = setup();
    game.grab('cube-1', 'left');
    game.cancel('cube-1', 'tracking-lost');
    assert.equal(store.getObject('cube-1').status, OBJECT_STATUS.FALLING);
    assert.equal(store.sortedCount(), 0);
  });

  test('tiempo de llenado: se registra al llegar a 5/5 con el tiempo global de ese momento', () => {
    const { store, drop, tick, calls } = setup();
    for (let i = 1; i <= 5; i += 1) {
      tick(1000);
      drop(`cube-${i}`, 'R1');
    }
    assert.equal(store.getBin('R1').count, 5);
    assert.equal(store.getBin('R1').completedAtMs, 5000);
    assert.equal(store.getBin('R2').completedAtMs, null);
    assert.ok(calls.some(([n, id]) => n === 'onBinFilled' && id === 'R1'));
  });

  test('inicio explícito: antes de "Iniciar" no se puede tomar nada ni corre el tiempo', () => {
    const { game, store, tick } = setupPending();
    assert.equal(store.getState().phase, PHASE.PENDING);
    assert.equal(game.grab('cube-1', 'left'), false);
    tick(5000);
    assert.equal(store.elapsedMs(5000), 0);
    assert.equal(game.start(), true);
    assert.equal(game.start(), false, 'no se inicia dos veces');
    assert.equal(store.getState().phase, PHASE.ACTIVE);
    assert.equal(game.grab('cube-1', 'left'), true);
  });

  test('flujo completo: activo → completado (20/20), cronómetro detenido', () => {
    const { game, store, drop, tick } = setup();
    assert.equal(store.getState().phase, PHASE.ACTIVE);
    for (const o of OBJECTS) {
      tick(500);
      const bin = CONFIG.bins.find((b) => b.classId === o.classId);
      assert.equal(drop(o.id, bin.id), DEPOSIT_RESULT.CORRECT);
      if (store.sortedCount() < 20) assert.equal(store.getState().phase, PHASE.ACTIVE);
    }
    assert.equal(store.sortedCount(), 20);
    assert.equal(store.getState().phase, PHASE.COMPLETED);
    assert.equal(store.isTimerRunning(), false);
    for (const b of CONFIG.bins) assert.notEqual(store.getBin(b.id).completedAtMs, null);
    const final = store.elapsedMs(0);
    tick(5000);
    assert.equal(store.elapsedMs(999999), final, 'el tiempo no avanza tras completar');
    assert.equal(game.grab('cube-1', 'left'), false);
  });

  test('reinicio: 0/20, sin errores, recipientes vacíos, fase pendiente y cronómetro en cero', () => {
    const { game, store, drop, tick, calls } = setup();
    drop('cube-1', 'R1');
    drop('cube-2', 'R3');
    tick(2000);
    game.reset();
    assert.equal(store.sortedCount(), 0);
    assert.equal(store.getState().stats.errors, 0);
    assert.equal(store.accuracy(), null);
    assert.equal(store.getBin('R1').count, 0);
    assert.equal(store.getState().phase, PHASE.PENDING);
    assert.equal(store.elapsedMs(10_000), 0);
    assert.equal(store.countByStatus().available, 20);
    assert.ok(calls.some(([n]) => n === 'onReset'), 'el reinicio pide redistribuir al azar');
  });

  test('salir y volver a VR conserva el progreso y pausa el cronómetro', () => {
    const { game, store, drop, tick } = setup();
    drop('cube-1', 'R1');
    tick(3000);
    game.onSessionEnd();
    const paused = store.elapsedMs(0);
    tick(60_000);
    game.onSessionStart();
    assert.equal(store.sortedCount(), 1);
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

  test('si la palma gira durante un agarre, la figura no se suelta por error', () => {
    const p = make();
    p.update({ distance: 0.01, palmFacing: false });
    assert.equal(p.update({ distance: 0.01, palmFacing: true }), null);
    assert.equal(p.isPinching(), true);
  });

  test('umbrales inválidos se rechazan', () => {
    assert.throws(() => createPinchDetector({ closeDistance: 0.04, openDistance: 0.02 }), RangeError);
  });
});
