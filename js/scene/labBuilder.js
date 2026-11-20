/**
 * labBuilder.js — RENDERIZADO del mobiliario: cuatro mesas con borde, mostrador central
 * y cuatro recipientes abiertos (cajas sin tapa), con su apariencia de estado.
 *
 * Usa EXACTAMENTE las mismas medidas de config.js que physicsWorld.js, así lo que se
 * ve coincide con lo que colisiona. Aquí no hay física: solo mallas.
 */
import * as THREE from 'three';
import { createLabelTexture, FONT_STACK } from '../ui/canvasText.js';
import { getCollider } from '../physics/colliders.js';

const COLORS = Object.freeze({
  tableTop: 0x3b4658,
  tableRim: 0x60a5fa,
  leg: 0x1f2937,
  counter: 0x2b3546,
  binWall: 0x334155,
  binFloor: 0x1e293b,
  success: 0x22c55e,
  error: 0xef4444,
});

const toCss = (hex) => `#${hex.toString(16).padStart(6, '0')}`;

export function buildLab(parent, config) {
  const root = new THREE.Group();
  root.name = 'Laboratorio';
  parent.add(root);

  const disposables = new Set();
  const keep = (resource) => { disposables.add(resource); return resource; };
  const classById = new Map(config.classes.map((c) => [c.id, c]));

  config.tables.forEach((def) => buildTable(root, def, config.table, keep));
  buildCounter(root, config.counter, keep);

  const bins = new Map();
  const wallMaterial = keep(new THREE.MeshStandardMaterial({ color: COLORS.binWall, roughness: 0.7 }));
  for (const def of config.bins) {
    bins.set(def.id, buildBin(root, def, classById.get(def.classId), config, wallMaterial, keep));
  }

  return {
    root,
    bins,

    flashBin(binId, kind, until) {
      const bin = bins.get(binId);
      if (!bin) return;
      bin.flashUntil = until;
      bin.flashColor = kind === 'success' ? COLORS.success : COLORS.error;
    },

    resetVisuals() {
      for (const bin of bins.values()) bin.flashUntil = 0;
    },

    /** Borde del recipiente: color de su clase; verde si está lleno; destello rojo/verde. */
    updateVisuals(now, getBinState) {
      for (const bin of bins.values()) {
        const { count, capacity } = getBinState(bin.id);
        const full = count >= capacity;
        let color = bin.classColor;
        let intensity = 0.25;
        if (now < bin.flashUntil) { color = bin.flashColor; intensity = 0.9; }
        else if (full) { color = COLORS.success; intensity = 0.6; }
        bin.rimMaterial.color.setHex(color);
        bin.rimMaterial.emissive.setHex(color);
        bin.rimMaterial.emissiveIntensity = intensity;
      }
    },

    dispose() {
      parent.remove(root);
      disposables.forEach((r) => r.dispose?.());
      disposables.clear();
    },
  };
}

function buildTable(root, def, t, keep) {
  const group = new THREE.Group();
  group.name = def.name;
  group.position.set(def.x, 0, def.z);

  const top = new THREE.Mesh(
    keep(new THREE.BoxGeometry(t.width, t.thickness, t.depth)),
    keep(new THREE.MeshStandardMaterial({ color: COLORS.tableTop, roughness: 0.7 })),
  );
  top.position.y = t.topY - t.thickness / 2;
  group.add(top);

  // Borde bajo (rim): también existe en la física (physicsWorld.js).
  const rimMaterial = keep(new THREE.MeshStandardMaterial({ color: COLORS.tableRim, roughness: 0.5 }));
  const rimY = t.topY + t.rimHeight / 2;
  const longRim = keep(new THREE.BoxGeometry(t.width, t.rimHeight, t.rimThickness));
  const shortRim = keep(new THREE.BoxGeometry(t.rimThickness, t.rimHeight, t.depth));
  for (const [geo, x, z] of [
    [longRim, 0, -t.depth / 2 + t.rimThickness / 2],
    [longRim, 0, t.depth / 2 - t.rimThickness / 2],
    [shortRim, -t.width / 2 + t.rimThickness / 2, 0],
    [shortRim, t.width / 2 - t.rimThickness / 2, 0],
  ]) {
    const rim = new THREE.Mesh(geo, rimMaterial);
    rim.position.set(x, rimY, z);
    group.add(rim);
  }

  const legHeight = t.topY - t.thickness;
  const legGeometry = keep(new THREE.BoxGeometry(0.045, legHeight, 0.045));
  const legMaterial = keep(new THREE.MeshStandardMaterial({ color: COLORS.leg, roughness: 0.8 }));
  const dx = t.width / 2 - 0.05;
  const dz = t.depth / 2 - 0.05;
  for (const [x, z] of [[-dx, -dz], [dx, -dz], [-dx, dz], [dx, dz]]) {
    const leg = new THREE.Mesh(legGeometry, legMaterial);
    leg.position.set(x, legHeight / 2, z);
    group.add(leg);
  }

  // Rótulo de la mesa, en el canto frontal (orientado hacia el usuario).
  const label = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(0.2, 0.05)),
    keep(new THREE.MeshBasicMaterial({
      map: keep(createLabelTexture({ text: def.name, width: 320, height: 80, font: `700 40px ${FONT_STACK}`, border: '#60a5fa' })),
      transparent: true,
    })),
  );
  const toUser = Math.atan2(-def.x, -def.z); // gira el rótulo hacia el origen
  const edge = new THREE.Group();
  edge.rotation.y = toUser;
  label.position.set(0, t.topY - t.thickness - 0.035, t.depth / 2 + 0.002);
  edge.add(label);
  group.add(edge);

  root.add(group);
}

function buildCounter(root, c, keep) {
  const top = new THREE.Mesh(
    keep(new THREE.BoxGeometry(c.width, c.thickness, c.depth)),
    keep(new THREE.MeshStandardMaterial({ color: COLORS.counter, roughness: 0.75 })),
  );
  top.name = 'Mostrador';
  top.position.set(0, c.topY - c.thickness / 2, c.centerZ);
  root.add(top);

  // Base sólida (un mueble, no una mesa con patas): da sensación de peso y estabilidad.
  const baseHeight = c.topY - c.thickness;
  const base = new THREE.Mesh(
    keep(new THREE.BoxGeometry(c.width - 0.08, baseHeight, c.depth - 0.08)),
    keep(new THREE.MeshStandardMaterial({ color: 0x1b2333, roughness: 0.9 })),
  );
  base.position.set(0, baseHeight / 2, c.centerZ);
  root.add(base);
}

function buildBin(root, def, cls, config, wallMaterial, keep) {
  const { outer, height, wall, floor } = config.bin;
  const half = outer / 2;
  const group = new THREE.Group();
  group.name = `Recipiente ${def.id} (${cls.plural})`;
  group.position.set(def.x, config.counter.topY, config.counter.centerZ);

  const floorMesh = new THREE.Mesh(
    keep(new THREE.BoxGeometry(outer, floor, outer)),
    keep(new THREE.MeshStandardMaterial({ color: COLORS.binFloor, roughness: 0.9 })),
  );
  floorMesh.position.y = floor / 2;
  group.add(floorMesh);

  const longWall = keep(new THREE.BoxGeometry(outer, height, wall));
  const shortWall = keep(new THREE.BoxGeometry(wall, height, outer - 2 * wall));
  for (const [geo, x, z] of [
    [longWall, 0, -half + wall / 2], [longWall, 0, half - wall / 2],
    [shortWall, -half + wall / 2, 0], [shortWall, half - wall / 2, 0],
  ]) {
    const w = new THREE.Mesh(geo, wallMaterial);
    w.position.set(x, height / 2, z);
    group.add(w);
  }

  // Borde superior con el color de la clase (cambia a verde/rojo como retroalimentación).
  const rimMaterial = keep(new THREE.MeshStandardMaterial({ color: cls.color, emissive: cls.color, emissiveIntensity: 0.25 }));
  const rimLong = keep(new THREE.BoxGeometry(outer + 0.006, 0.012, wall + 0.006));
  const rimShort = keep(new THREE.BoxGeometry(wall + 0.006, 0.012, outer + 0.006));
  for (const [geo, x, z] of [
    [rimLong, 0, -half + wall / 2], [rimLong, 0, half - wall / 2],
    [rimShort, -half + wall / 2, 0], [rimShort, half - wall / 2, 0],
  ]) {
    const r = new THREE.Mesh(geo, rimMaterial);
    r.position.set(x, height + 0.006, z);
    group.add(r);
  }

  // Placa frontal fija con letra + nombre de la clase (identificación por texto, no solo color).
  const plate = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(outer - 0.02, 0.06)),
    keep(new THREE.MeshBasicMaterial({
      map: keep(createLabelTexture({
        text: `${cls.label} · ${cls.plural}`, width: 400, height: 96, border: toCss(cls.color), font: `700 40px ${FONT_STACK}`,
      })),
      transparent: true,
    })),
  );
  plate.position.set(0, height / 2, half + 0.002);
  group.add(plate);

  // Silueta flotante de la figura que va en este recipiente (identificación por forma).
  const collider = getCollider(cls.collider);
  const ghost = new THREE.Mesh(
    keep(collider.geometry(cls.size)),
    keep(new THREE.MeshBasicMaterial({ color: cls.color, wireframe: true, transparent: true, opacity: 0.7 })),
  );
  ghost.position.set(0, height + 0.2, -half + 0.03);
  group.add(ghost);

  root.add(group);
  return {
    id: def.id, classId: cls.id, group, rimMaterial, classColor: cls.color,
    topPosition: new THREE.Vector3(def.x, config.counter.topY + height, config.counter.centerZ),
    flashUntil: 0, flashColor: 0,
  };
}
