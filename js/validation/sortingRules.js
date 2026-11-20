/**
 * sortingRules.js — Reglas de clasificación como FUNCIONES PURAS.
 *
 * No dependen de Three.js, de cannon-es ni del DOM: se prueban con Node
 * (tests/logic.test.mjs) y desde la consola del navegador.
 *
 * Un recipiente se describe con datos simples:
 *   { id, classId, x, z, floorY, innerHalf, height }
 * donde (x, z) es el centro, floorY la altura del fondo interior, innerHalf la mitad
 * del ancho interior y height la altura de las paredes.
 */

export const DEPOSIT_RESULT = Object.freeze({
  CORRECT: 'correct',
  WRONG: 'wrong',
});

/**
 * Margen vertical sobre el borde. Una figura LIBRE solo puede reposar por encima del
 * borde si la sostienen otras figuras que están dentro (pila), así que sigue contando
 * como depositada. 10 cm cubre una pila de dos figuras sobre el borde.
 */
const TOP_MARGIN = 0.1;

function isVector3Like(v) {
  return v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/** ¿Está el punto dentro del volumen interior del recipiente? */
export function isInsideBin(position, bin) {
  if (!isVector3Like(position)) throw new TypeError('isInsideBin: position debe tener x, y, z numéricos.');
  return Math.abs(position.x - bin.x) <= bin.innerHalf
    && Math.abs(position.z - bin.z) <= bin.innerHalf
    && position.y >= bin.floorY
    && position.y <= bin.floorY + bin.height + TOP_MARGIN;
}

/** Devuelve el recipiente que contiene el punto, o null. */
export function findBinContaining(position, bins) {
  for (const bin of bins) {
    if (isInsideBin(position, bin)) return bin;
  }
  return null;
}

/** Correcto si la clase de la figura coincide con la del recipiente. */
export function evaluateDeposit(objectClassId, bin) {
  if (typeof objectClassId !== 'string' || !objectClassId) throw new TypeError('evaluateDeposit: clase inválida.');
  if (!bin || typeof bin.classId !== 'string') throw new TypeError('evaluateDeposit: recipiente inválido.');
  return objectClassId === bin.classId ? DEPOSIT_RESULT.CORRECT : DEPOSIT_RESULT.WRONG;
}

/**
 * Precisión = aciertos / (aciertos + errores). Devuelve null si aún no hay intentos
 * (así el marcador muestra "—" en vez de un engañoso 0 %).
 */
export function accuracy(correct, errors) {
  const attempts = correct + errors;
  if (!(attempts > 0)) return null;
  return correct / attempts;
}

/** Formatea la precisión como "87 %" o "—". */
export function formatAccuracy(value) {
  return value === null ? '—' : `${Math.round(value * 100)} %`;
}

/**
 * Acumula el tiempo que una figura lleva "casi quieta".
 * Devuelve el nuevo acumulado: se reinicia a 0 si se mueve más rápido que el umbral.
 */
export function accumulateSettle(previousMs, speed, deltaMs, settleSpeed) {
  return speed < settleSpeed ? previousMs + deltaMs : 0;
}

/**
 * Calcula el volumen interior de cada recipiente a partir de la configuración
 * (las mismas medidas que usan el renderizado y la física).
 */
export function buildBinVolumes({ bins, bin, counter }) {
  return bins.map((b) => ({
    id: b.id,
    classId: b.classId,
    x: b.x,
    z: counter.centerZ,
    floorY: counter.topY + bin.floor,
    innerHalf: bin.outer / 2 - bin.wall,
    height: bin.height - bin.floor,
  }));
}

/** Comprueba que la configuración de clases y recipientes sea coherente. */
export function validateSortingConfig({ classes, bins, perClass }) {
  if (!Array.isArray(classes) || classes.length === 0) throw new Error('Se requiere al menos una clase.');
  if (!Number.isInteger(perClass) || perClass < 1) throw new RangeError('perClass debe ser un entero ≥ 1.');
  if (!Array.isArray(bins) || bins.length !== classes.length) {
    throw new Error(`Debe haber un recipiente por clase (hay ${bins?.length ?? 0} recipientes y ${classes.length} clases).`);
  }
  const classIds = new Set();
  for (const c of classes) {
    if (classIds.has(c.id)) throw new Error(`Clase duplicada: ${c.id}`);
    classIds.add(c.id);
  }
  const used = new Set();
  for (const b of bins) {
    if (!classIds.has(b.classId)) throw new Error(`El recipiente ${b.id} usa una clase inexistente: ${b.classId}`);
    if (used.has(b.classId)) throw new Error(`La clase ${b.classId} tiene más de un recipiente.`);
    used.add(b.classId);
  }
  return true;
}
