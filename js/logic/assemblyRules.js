/**
 * assemblyRules.js — Reglas de ensamblaje como FUNCIONES PURAS.
 *
 * No dependen de Three.js ni del DOM, así que se pueden probar desde la consola:
 *   const m = await import('./js/logic/assemblyRules.js');
 *   m.evaluateDrop({ pieceTargetId: 'T1', position: {x:0,y:0,z:0}, targets: [...], rules: {...} });
 */

export const DROP_RESULT = Object.freeze({
  SUCCESS: 'success',
  WRONG_TARGET: 'wrong-target',
  TOO_FAR: 'too-far',
  OUT_OF_ZONE: 'out-of-zone',
});

/** Valida la configuración de reglas y lanza un error claro si no es coherente. */
export function validateRuleConfig(rules) {
  if (!rules || typeof rules !== 'object') {
    throw new TypeError('Reglas: se esperaba un objeto de configuración.');
  }
  const { tolerance, detectionRadius } = rules;
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    throw new RangeError(`Reglas: "tolerance" debe ser un número > 0 (recibido: ${tolerance}).`);
  }
  if (!Number.isFinite(detectionRadius) || detectionRadius < tolerance) {
    throw new RangeError(`Reglas: "detectionRadius" debe ser ≥ tolerance (recibido: ${detectionRadius}).`);
  }
  return true;
}

function isVector3Like(v) {
  return v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/** Distancia euclidiana 3D entre dos puntos {x, y, z}, en metros. */
export function distance3(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Busca el destino más cercano a `position` dentro de `maxDistance`.
 * @returns {{ target: object, distance: number } | null}
 */
export function findNearestTarget(position, targets, maxDistance) {
  let best = null;
  for (const target of targets) {
    const d = distance3(position, target.anchor);
    if (d <= maxDistance && (best === null || d < best.distance)) {
      best = { target, distance: d };
    }
  }
  return best;
}

/**
 * Evalúa el resultado de soltar una pieza.
 *
 * La distancia que se mide es la separación euclidiana (m) entre el CENTRO de la
 * pieza y el PUNTO DE ANCLAJE del destino, que es donde quedaría su centro bien colocada.
 *
 * @param {object} params
 * @param {string} params.pieceTargetId  destino correcto de la pieza
 * @param {{x:number,y:number,z:number}} params.position  centro de la pieza al soltar
 * @param {Array<{id:string, anchor:{x:number,y:number,z:number}}>} params.targets
 * @param {{tolerance:number, detectionRadius:number}} params.rules
 */
export function evaluateDrop({ pieceTargetId, position, targets, rules }) {
  validateRuleConfig(rules);
  if (typeof pieceTargetId !== 'string' || pieceTargetId.length === 0) {
    throw new TypeError('evaluateDrop: pieceTargetId inválido.');
  }
  if (!isVector3Like(position)) {
    throw new TypeError('evaluateDrop: position debe tener x, y, z numéricos.');
  }
  if (!Array.isArray(targets) || targets.some((t) => !isVector3Like(t.anchor))) {
    throw new TypeError('evaluateDrop: targets inválidos.');
  }

  const nearest = findNearestTarget(position, targets, rules.detectionRadius);
  if (!nearest) {
    return { result: DROP_RESULT.OUT_OF_ZONE, targetId: null, distance: null };
  }
  const { target, distance } = nearest;
  if (target.id !== pieceTargetId) {
    return { result: DROP_RESULT.WRONG_TARGET, targetId: target.id, distance };
  }
  if (distance > rules.tolerance) {
    return { result: DROP_RESULT.TOO_FAR, targetId: target.id, distance };
  }
  return { result: DROP_RESULT.SUCCESS, targetId: target.id, distance };
}
