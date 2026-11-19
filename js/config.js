/**
 * config.js — Configuración central del laboratorio.
 *
 * Todas las medidas están en METROS: en WebXR, 1 unidad de Three.js = 1 m real.
 * El origen (0, 0, 0) es el piso, justo donde está el usuario (espacio 'local-floor').
 * El usuario mira hacia -Z.
 *
 * Aquí se ajusta el comportamiento sin tocar la lógica (por ejemplo, la tolerancia).
 */

const TABLE_TOP_Y = 0.8;

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
    title: 'Laboratorio de ensamblaje 3D',
    author: 'Melissa Manzano',
    course: 'Desarrollo de Ambientes Virtuales',
  },

  /**
   * Reglas de validación (se evalúan SOLO al soltar una pieza).
   * - tolerance: distancia máxima (m) entre el centro de la pieza y el punto de
   *   anclaje de SU destino para considerarla bien colocada.
   * - detectionRadius: radio (m) en el que se busca el destino más cercano.
   *   Si no hay ninguno dentro de este radio, la pieza regresa a su lugar.
   */
  rules: {
    tolerance: 0.08,
    detectionRadius: 0.2,
    errorFlashMs: 1200,
    messageMs: 3500,
  },

  table: {
    topY: TABLE_TOP_Y,
    width: 1.3,
    depth: 0.6,
    centerZ: -0.6,
    thickness: 0.04,
  },

  /**
   * Detección de pinza por articulaciones con histéresis:
   * se cierra por debajo de closeDistance y se abre por encima de openDistance.
   * La zona intermedia evita parpadeos (falsos inicios y finales).
   */
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

  drag: {
    smoothing: 25,
    moveThreshold: 0.01,
    minDistance: 0.12,
    maxDistance: 2.0,
    bounds: {
      minX: -0.9, maxX: 0.9,
      minY: TABLE_TOP_Y + 0.03, maxY: 1.9,
      minZ: -1.15, maxZ: 0.2,
    },
  },

  ray: {
    maxLength: 4,
    idleLength: 1.2,
  },

  panel: {
    position: [0, 1.45, -1.3],
    width: 1.0,
  },

  buttons: [
    { id: 'reset', label: 'Reiniciar', color: 0x2563eb, position: [-0.18, 1.02, -1.27] },
    { id: 'exit', label: 'Salir de VR', color: 0xb91c1c, position: [0.18, 1.02, -1.27] },
  ],

  desktopCamera: {
    position: [0, 1.6, 0.95],
    target: [0, 1.0, -0.75],
  },

  /**
   * Cinco piezas. Cada una tiene forma, color y letra distintos, y un destino (targetId).
   * Se evitan el rojo y el verde puros porque son los colores de error y de acierto.
   */
  pieces: [
    { id: 'P1', label: 'A', name: 'Cubo', shape: 'cube', color: 0xf57c00, colorName: 'naranja',
      start: { x: -0.44, z: -0.42, rotY: 0.5 }, targetId: 'T1' },
    { id: 'P2', label: 'B', name: 'Esfera', shape: 'sphere', color: 0x1e88e5, colorName: 'azul',
      start: { x: -0.22, z: -0.42, rotY: 0 }, targetId: 'T2' },
    { id: 'P3', label: 'C', name: 'Cono', shape: 'cone', color: 0xfdd835, colorName: 'amarillo',
      start: { x: 0, z: -0.42, rotY: 0.3 }, targetId: 'T3' },
    { id: 'P4', label: 'D', name: 'Cilindro', shape: 'cylinder', color: 0xec407a, colorName: 'rosa',
      start: { x: 0.22, z: -0.42, rotY: 0.2 }, targetId: 'T4' },
    { id: 'P5', label: 'E', name: 'Prisma triangular', shape: 'prism', color: 0x8e24aa, colorName: 'morado',
      start: { x: 0.44, z: -0.42, rotY: 0.7 }, targetId: 'T5' },
  ],

  /** Cinco destinos. El orden en la mesa NO coincide con el de las piezas. */
  targets: [
    { id: 'T3', x: -0.44, z: -0.76, rotY: 0 },
    { id: 'T1', x: -0.22, z: -0.76, rotY: 0 },
    { id: 'T5', x: 0, z: -0.76, rotY: 0 },
    { id: 'T2', x: 0.22, z: -0.76, rotY: 0 },
    { id: 'T4', x: 0.44, z: -0.76, rotY: 0 },
  ],
});
