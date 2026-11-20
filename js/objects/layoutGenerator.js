/**
 * layoutGenerator.js — Distribución ALEATORIA de las figuras sobre las mesas (función pura).
 *
 * 1. Se barajan los 20 objetos (Fisher–Yates), así las clases quedan mezcladas.
 * 2. Se reparten en partes iguales entre las mesas (20 / 4 = 5 por mesa).
 * 3. En cada mesa se barajan las ranuras de una rejilla y se toman las necesarias,
 *    con un pequeño desplazamiento aleatorio (jitter) y un giro aleatorio en Y.
 *
 * Las ranuras están separadas más que el tamaño de cualquier figura, así que nunca
 * aparecen encimadas (no hay explosiones de física al reiniciar).
 *
 * El generador aleatorio se inyecta: en la app es Math.random; en las pruebas es
 * una semilla fija (createRng) para obtener resultados reproducibles.
 */

/** Generador pseudoaleatorio con semilla (mulberry32). Devuelve números en [0, 1). */
export function createRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Baraja una COPIA del arreglo (Fisher–Yates). */
export function shuffle(items, rng = Math.random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Centros de las ranuras de una mesa, relativos a su centro. */
export function slotOffsets({ cols, rows, spacingX, spacingZ }) {
  const slots = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      slots.push({ dx: (c - (cols - 1) / 2) * spacingX, dz: (r - (rows - 1) / 2) * spacingZ });
    }
  }
  return slots;
}

/**
 * @param {object} p
 * @param {Array<{id:string}>} p.objects  objetos a repartir
 * @param {Array<{id:string,x:number,z:number}>} p.tables
 * @param {{cols:number,rows:number,spacingX:number,spacingZ:number,jitter:number}} p.spawn
 * @param {() => number} [p.rng]
 * @returns {Map<string, {tableId:string, x:number, z:number, yaw:number}>}
 */
export function generateLayout({ objects, tables, spawn, rng = Math.random }) {
  if (!Array.isArray(objects) || !Array.isArray(tables) || tables.length === 0) {
    throw new TypeError('generateLayout: se requieren objetos y mesas.');
  }
  const perTable = Math.ceil(objects.length / tables.length);
  const slots = slotOffsets(spawn);
  if (perTable > slots.length) {
    throw new RangeError(`Cada mesa necesita ${perTable} ranuras y la rejilla solo tiene ${slots.length}.`);
  }
  const maxJitter = Math.max(0, spawn.jitter ?? 0);
  const jitter = () => (rng() * 2 - 1) * maxJitter;

  const layout = new Map();
  const shuffled = shuffle(objects, rng);
  tables.forEach((table, t) => {
    const group = shuffled.slice(t * perTable, (t + 1) * perTable);
    const tableSlots = shuffle(slots, rng);
    group.forEach((obj, i) => {
      const slot = tableSlots[i];
      layout.set(obj.id, {
        tableId: table.id,
        x: table.x + slot.dx + jitter(),
        z: table.z + slot.dz + jitter(),
        yaw: rng() * Math.PI * 2,
      });
    });
  });
  return layout;
}
