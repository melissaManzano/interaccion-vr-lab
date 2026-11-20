/**
 * physicsWorld.js — Mundo físico con cannon-es: gravedad, cuerpos rígidos y colisiones.
 *
 * Responsabilidades:
 *  - Crear el mundo (gravedad, broadphase SAP, solver, sueño de cuerpos en reposo).
 *  - Definir materiales y sus pares (fricción y rebote) para figura–figura,
 *    figura–mesa, figura–recipiente y figura–suelo.
 *  - Crear los colisionadores ESTÁTICOS a partir de la misma configuración que usa
 *    el renderizado: suelo, mesas (con borde), mostrador y recipientes abiertos.
 *  - Avanzar la simulación con PASO FIJO (estable e independiente de los FPS) y
 *    exponer posiciones interpoladas para dibujar sin tirones.
 *
 * No sabe nada de Three.js: el renderizado copia posiciones desde aquí (objectFactory).
 */
import * as CANNON from 'cannon-es';

/**
 * Grupos de colisión. Todo choca con todo; los grupos solo sirven para que el
 * barrido del agarre cinemático (holdController) consulte ÚNICAMENTE los estáticos.
 */
export const GROUP = Object.freeze({ OBJECT: 1, STATIC: 2 });

export function createPhysicsWorld(config) {
  const p = config.physics;
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, p.gravity, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  world.solver.iterations = p.solverIterations;

  // --- Materiales -------------------------------------------------------------
  const materials = {
    object: new CANNON.Material('figura'),
    table: new CANNON.Material('mesa'),
    bin: new CANNON.Material('recipiente'),
    floor: new CANNON.Material('suelo'),
    // Material temporal de una figura que el recipiente está expulsando: sin fricción,
    // para que no quede "encajada" entre otra figura y la pared (la fricción lateral
    // frenaría su subida). Sigue chocando con todo; solo cambia el coeficiente.
    ejecting: new CANNON.Material('expulsion'),
  };
  // Se pasa una COPIA: cannon-es escribe valores por defecto en el objeto y CONFIG está congelado.
  const pair = (a, b, opts) => world.addContactMaterial(new CANNON.ContactMaterial(a, b, { ...opts }));
  pair(materials.object, materials.object, p.materials.objectObject);
  pair(materials.object, materials.table, p.materials.objectTable);
  pair(materials.object, materials.bin, p.materials.objectBin);
  pair(materials.object, materials.floor, p.materials.objectFloor);
  const slippery = { friction: 0, restitution: 0.2 };
  for (const other of [materials.object, materials.table, materials.bin, materials.floor, materials.ejecting]) {
    pair(materials.ejecting, other, slippery);
  }

  // --- Colisionadores estáticos -------------------------------------------------
  const staticBodies = [];
  const addStatic = (body) => {
    body.collisionFilterGroup = GROUP.STATIC;
    world.addBody(body);
    staticBodies.push(body);
    return body;
  };
  const box = (hx, hy, hz) => new CANNON.Box(new CANNON.Vec3(hx, hy, hz));

  // Suelo: plano infinito (la normal de Plane es +Z; se gira para que apunte a +Y).
  const floor = new CANNON.Body({ type: CANNON.Body.STATIC, material: materials.floor, shape: new CANNON.Plane() });
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  addStatic(floor);

  // Mesas: tablero + 4 bordes bajos, en un solo cuerpo compuesto.
  const t = config.table;
  for (const def of config.tables) {
    const body = new CANNON.Body({ type: CANNON.Body.STATIC, material: materials.table });
    body.position.set(def.x, 0, def.z);
    body.addShape(box(t.width / 2, t.thickness / 2, t.depth / 2), new CANNON.Vec3(0, t.topY - t.thickness / 2, 0));
    const rimY = t.topY + t.rimHeight / 2;
    const hx = t.width / 2;
    const hz = t.depth / 2;
    const rt = t.rimThickness / 2;
    body.addShape(box(hx, t.rimHeight / 2, rt), new CANNON.Vec3(0, rimY, -hz + rt));
    body.addShape(box(hx, t.rimHeight / 2, rt), new CANNON.Vec3(0, rimY, hz - rt));
    body.addShape(box(rt, t.rimHeight / 2, hz), new CANNON.Vec3(-hx + rt, rimY, 0));
    body.addShape(box(rt, t.rimHeight / 2, hz), new CANNON.Vec3(hx - rt, rimY, 0));
    addStatic(body);
  }

  // Mostrador central.
  const c = config.counter;
  const counter = new CANNON.Body({ type: CANNON.Body.STATIC, material: materials.table });
  counter.addShape(box(c.width / 2, c.thickness / 2, c.depth / 2));
  counter.position.set(0, c.topY - c.thickness / 2, c.centerZ);
  addStatic(counter);

  // Recipientes abiertos: fondo + 4 paredes (cuerpo compuesto, sin tapa).
  const b = config.bin;
  for (const def of config.bins) {
    const body = new CANNON.Body({ type: CANNON.Body.STATIC, material: materials.bin });
    body.position.set(def.x, c.topY, config.counter.centerZ);
    const half = b.outer / 2;
    const hw = b.wall / 2;
    const wallY = b.height / 2;
    body.addShape(box(half, b.floor / 2, half), new CANNON.Vec3(0, b.floor / 2, 0));
    body.addShape(box(half, b.height / 2, hw), new CANNON.Vec3(0, wallY, -half + hw));
    body.addShape(box(half, b.height / 2, hw), new CANNON.Vec3(0, wallY, half - hw));
    body.addShape(box(hw, b.height / 2, half - b.wall), new CANNON.Vec3(-half + hw, wallY, 0));
    body.addShape(box(hw, b.height / 2, half - b.wall), new CANNON.Vec3(half - hw, wallY, 0));
    addStatic(body);
  }

  // --- Cuerpos dinámicos ----------------------------------------------------------
  function createDynamicBody({ shape, mass, linearDamping = p.linearDamping, angularDamping = p.angularDamping }) {
    const body = new CANNON.Body({
      mass,
      material: materials.object,
      shape,
      linearDamping,
      angularDamping,
      allowSleep: true,
      sleepSpeedLimit: p.sleepSpeedLimit,
      sleepTimeLimit: p.sleepTimeLimit,
      collisionFilterGroup: GROUP.OBJECT,
    });
    world.addBody(body);
    return body;
  }

  /** Coloca un cuerpo en reposo en una pose (reinicio o recuperación). */
  function teleport(body, { x, y, z, yaw = 0 }) {
    body.position.set(x, y, z);
    body.quaternion.setFromEuler(0, yaw, 0);
    body.previousPosition.copy(body.position);
    body.interpolatedPosition.copy(body.position);
    body.previousQuaternion.copy(body.quaternion);
    body.interpolatedQuaternion.copy(body.quaternion);
    body.velocity.setZero();
    body.angularVelocity.setZero();
    body.force.setZero();
    body.torque.setZero();
    body.material = materials.object;
    body.wakeUp();
  }

  const rayResult = new CANNON.RaycastResult();
  const stepListeners = new Set();
  // 'postStep' se emite al final de cada subpaso: el control de agarre se reaplica
  // antes del siguiente subpaso para que el solver de contactos lo respete.
  world.addEventListener('postStep', () => stepListeners.forEach((fn) => fn(p.fixedStep)));

  return {
    world,
    materials,
    createDynamicBody,
    teleport,

    /**
     * Rayo contra los colisionadores ESTÁTICOS (mesas, mostrador, recipientes, suelo).
     * Devuelve { distance, normal } o null.
     */
    raycastStatic(from, to) {
      rayResult.reset();
      world.raycastClosest(from, to, { collisionFilterMask: GROUP.STATIC, skipBackfaces: true }, rayResult);
      return rayResult.hasHit ? { distance: rayResult.distance, normal: rayResult.hitNormalWorld } : null;
    },

    /** Activa o quita el material sin fricción de expulsión. */
    setEjecting(body, on) {
      body.material = on ? materials.ejecting : materials.object;
    },

    /** Registra una función que se ejecuta antes de cada subpaso (además del primero). */
    onSubStep(fn) { stepListeners.add(fn); return () => stepListeners.delete(fn); },

    /** Avanza la simulación el tiempo real transcurrido, en pasos fijos. */
    step(deltaSeconds) {
      world.step(p.fixedStep, deltaSeconds, p.maxSubSteps);
    },

    dispose() {
      for (const body of [...world.bodies]) world.removeBody(body);
      stepListeners.clear();
    },
  };
}
