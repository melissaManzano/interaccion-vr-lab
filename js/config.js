/**
 * config.js — Configuración central del laboratorio de clasificación (práctica 3.2).
 *
 * Todas las medidas están en METROS: en WebXR, 1 unidad de Three.js = 1 m real,
 * y cannon-es usa las mismas unidades (m, kg, s), así que ambos mundos coinciden.
 * El origen (0, 0, 0) es el piso, justo donde está el usuario ('local-floor').
 * El usuario mira hacia -Z.
 *
 * Aquí se ajusta el comportamiento sin tocar la lógica.
 */

const TABLE_TOP_Y = 0.75;
const COUNTER_TOP_Y = 0.75;

/** Congela recursivamente un objeto para evitar modificaciones accidentales. */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export const CONFIG = deepFreeze({
  app: {
    title: 'Laboratorio de clasificación geométrica',
    author: 'Melissa Manzano',
    course: 'Desarrollo de Ambientes Virtuales · 3.2 Interacción virtual',
  },

  /**
   * Las cuatro clases de figuras elegidas para esta práctica (5 objetos por clase).
   * - collider: forma física de cannon-es (ver js/physics/colliders.js y docs/04).
   * - size: medidas en metros. mass en kg.
   * Se evitan el rojo y el verde puros: son los colores de error y de acierto.
   */
  perClass: 5,
  classes: [
    { id: 'cube', label: 'A', name: 'Cubo', plural: 'Cubos', color: 0xf57c00, colorName: 'naranja',
      collider: 'box', size: { side: 0.06 }, mass: 0.12 },
    { id: 'sphere', label: 'B', name: 'Esfera', plural: 'Esferas', color: 0x1e88e5, colorName: 'azul',
      collider: 'sphere', size: { radius: 0.034 }, mass: 0.10 },
    { id: 'cylinder', label: 'C', name: 'Cilindro', plural: 'Cilindros', color: 0xec407a, colorName: 'rosa',
      collider: 'cylinder', size: { radius: 0.03, height: 0.07, segments: 16 }, mass: 0.11 },
    { id: 'prism', label: 'D', name: 'Prisma triangular', plural: 'Prismas', color: 0x8e24aa, colorName: 'morado',
      collider: 'prism', size: { radius: 0.042, height: 0.06 }, mass: 0.10 },
  ],

  /**
   * Cuatro mesas donde se reparten AL AZAR las 20 figuras (5 por mesa, clases mezcladas).
   * Cada mesa tiene un borde bajo (rim) para que las esferas no rueden fuera.
   */
  tables: [
    { id: 'M1', name: 'Mesa 1', x: -1.0, z: -0.25 },
    { id: 'M2', name: 'Mesa 2', x: -1.0, z: -1.05 },
    { id: 'M3', name: 'Mesa 3', x: 1.0, z: -1.05 },
    { id: 'M4', name: 'Mesa 4', x: 1.0, z: -0.25 },
  ],
  table: {
    topY: TABLE_TOP_Y,
    width: 0.55,
    depth: 0.55,
    thickness: 0.04,
    rimHeight: 0.025,
    rimThickness: 0.015,
  },

  /** Rejilla de ranuras donde puede aparecer una figura sobre su mesa (se eligen 5 de 6). */
  spawn: {
    cols: 3,
    rows: 2,
    spacingX: 0.15,
    spacingZ: 0.17,
    jitter: 0.015,
    dropHeight: 0.01, // se crean 1 cm sobre la mesa y caen con gravedad
  },

  /** Mostrador central con los cuatro recipientes abiertos. */
  counter: {
    topY: COUNTER_TOP_Y,
    width: 1.3,
    depth: 0.45,
    centerZ: -0.8,
    thickness: 0.05,
  },

  /** Recipientes 3D abiertos (cajas sin tapa). Uno por clase. */
  bins: [
    { id: 'R1', classId: 'cube', x: -0.465 },
    { id: 'R2', classId: 'sphere', x: -0.155 },
    { id: 'R3', classId: 'cylinder', x: 0.155 },
    { id: 'R4', classId: 'prism', x: 0.465 },
  ],
  bin: {
    outer: 0.27, // ancho y fondo exteriores
    height: 0.14, // altura de las paredes
    wall: 0.02, // grosor de pared (más que el paso de física por cuadro)
    floor: 0.015,
  },

  /**
   * Motor de física (cannon-es).
   * fixedStep: paso fijo. 1/90 s coincide con el modo de 90 Hz del Quest 3.
   */
  physics: {
    gravity: -9.82,
    fixedStep: 1 / 90,
    maxSubSteps: 4,
    solverIterations: 12,
    sleepSpeedLimit: 0.05,
    sleepTimeLimit: 0.6,
    materials: {
      // friction (0-1) y restitution (rebote, 0-1) por par de materiales.
      objectObject: { friction: 0.4, restitution: 0.25 },
      objectTable: { friction: 0.5, restitution: 0.2 },
      objectBin: { friction: 0.45, restitution: 0.15 },
      objectFloor: { friction: 0.6, restitution: 0.35 },
    },
    linearDamping: 0.05,
    angularDamping: 0.12,
    sphereAngularDamping: 0.35, // la esfera rueda menos y no cae de la mesa con facilidad
  },

  /** Control de agarre: la figura sigue a la mano por VELOCIDAD (no se teletransporta). */
  hold: {
    stiffness: 18, // 1/s: fracción del error que se corrige por segundo
    maxSpeed: 5, // m/s mientras se sostiene
    maxReleaseSpeed: 3.5, // m/s al soltar (permite lanzar con suavidad)
    heldAngularDamping: 0.9,
  },

  /**
   * Reglas de clasificación.
   * Una figura cuenta como depositada cuando su centro está DENTRO del volumen interior
   * de un recipiente y permanece casi quieta (velocidad < settleSpeed) durante settleMs.
   */
  rules: {
    settleSpeed: 0.12,
    settleMs: 350,
    ejectUp: 2.4, // m/s: el recipiente expulsa una figura equivocada (sube ~29 cm, libra la pared)
    ejectForward: 0.8, // m/s hacia el usuario (cae al piso frente al mostrador)
    errorFlashMs: 1200,
    successFlashMs: 900,
    messageMs: 3500,
    respawnBelowY: -0.5, // por si una figura atraviesa algo o sale de la sala
    respawnRadius: 3.2,
  },

  /** Detección de pinza por articulaciones con histéresis. */
  pinch: {
    closeDistance: 0.02,
    openDistance: 0.035,
    ignorePalmFacing: true,
    palmFacingDot: 0.6,
    lostFramesLimit: 10,
  },

  hands: {
    // 'mesh' descarga un modelo glTF del CDN de WebXR Input Profiles;
    // 'spheres' o 'boxes' no descargan nada (útil si el CDN falla).
    modelProfile: 'mesh',
  },

  /**
   * Arrastre:
   * - nearRadius: si la pinza se cierra a menos de esta distancia del centro de una
   *   figura, se toma DIRECTAMENTE con la mano (agarre cercano).
   * - reelGain: con agarre a distancia, alejar o acercar la mano al cuerpo aleja o
   *   acerca la figura (multiplicado por este factor).
   */
  drag: {
    nearRadius: 0.07,
    reelGain: 2.5,
    minDistance: 0.1,
    maxDistance: 3.0,
    bounds: {
      minX: -2.2, maxX: 2.2,
      minY: 0.05, maxY: 2.0,
      minZ: -2.2, maxZ: 1.2,
    },
  },

  ray: {
    maxLength: 4,
    idleLength: 1.2,
  },

  /** Marcador 3D (encima del mostrador). */
  scoreboard: {
    position: [0, 1.55, -1.32],
    width: 1.15,
  },

  buttons: [
    { id: 'reset', label: 'Reinicio aleatorio', color: 0x2563eb, position: [-0.2, 1.06, -1.28] },
    { id: 'exit', label: 'Salir de VR', color: 0xb91c1c, position: [0.2, 1.06, -1.28] },
  ],

  desktopCamera: {
    position: [0, 1.85, 1.25],
    target: [0, 1.05, -0.75],
  },
});
