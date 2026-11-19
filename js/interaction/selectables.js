/**
 * selectables.js — Lista CERRADA de objetos seleccionables, con categorías y prioridad.
 *
 * El rayo solo prueba los objetos registrados aquí. El piso, las paredes, la mesa,
 * las siluetas y el panel nunca se seleccionan por error.
 *
 * Prioridad: los BOTONES se evalúan antes que las PIEZAS. Si un rayo toca un botón,
 * ninguna pieza se activa con esa misma pinza.
 */
export const CATEGORY = Object.freeze({ BUTTON: 'button', PIECE: 'piece' });

const PRIORITY_ORDER = Object.freeze([CATEGORY.BUTTON, CATEGORY.PIECE]);

export function createSelectableRegistry() {
  const byCategory = new Map(PRIORITY_ORDER.map((c) => [c, []]));
  const byObject = new Map();

  return {
    /**
     * @param {THREE.Object3D} object  malla que recibe el raycast
     * @param {string} category        CATEGORY.BUTTON | CATEGORY.PIECE
     * @param {string} id
     * @param {() => boolean} isEnabled  si devuelve false, el objeto se ignora
     */
    register(object, category, id, isEnabled = () => true) {
      if (!object?.isObject3D) throw new TypeError('register: se esperaba un Object3D.');
      if (!byCategory.has(category)) throw new Error(`Categoría desconocida: ${category}`);
      if (typeof id !== 'string' || !id) throw new TypeError('register: id inválido.');
      if (byObject.has(object)) throw new Error(`El objeto ${id} ya está registrado.`);
      const entry = { object, category, id, isEnabled };
      byCategory.get(category).push(entry);
      byObject.set(object, entry);
    },

    /**
     * Lanza un rayo y devuelve el impacto de mayor prioridad (y más cercano dentro de ella).
     * @returns {{id, category, object, distance, point} | null}
     */
    raycast(raycaster, ray, far) {
      raycaster.ray.copy(ray);
      raycaster.near = 0;
      raycaster.far = far;
      for (const category of PRIORITY_ORDER) {
        const candidates = [];
        for (const entry of byCategory.get(category)) {
          if (entry.object.visible && entry.isEnabled()) candidates.push(entry.object);
        }
        if (candidates.length === 0) continue;
        const hits = raycaster.intersectObjects(candidates, false);
        if (hits.length > 0) {
          const hit = hits[0];
          const entry = byObject.get(hit.object);
          return { id: entry.id, category, object: entry.object, distance: hit.distance, point: hit.point.clone() };
        }
      }
      return null;
    },

    clear() {
      byCategory.forEach((list) => { list.length = 0; });
      byObject.clear();
    },
  };
}
