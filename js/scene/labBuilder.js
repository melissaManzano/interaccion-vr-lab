/**
 * labBuilder.js — Construye la mesa, las 5 piezas y los 5 destinos, y gestiona su
 * apariencia (resaltado, error, acierto).
 *
 * IMPORTANTE: el grupo raíz del laboratorio está en el origen sin rotación ni escala,
 * así que la posición local de cada pieza coincide con su posición en el mundo.
 * El controlador de arrastre depende de esto.
 */
import * as THREE from 'three';
import { PIECE_STATUS } from '../core/state.js';
import { createLabelTexture, FONT_STACK } from '../ui/canvasText.js';

/** Geometrías generadas por Three.js (no se descargan modelos). */
const SHAPES = Object.freeze({
  cube: { create: () => new THREE.BoxGeometry(0.08, 0.08, 0.08), halfHeight: 0.04 },
  sphere: { create: () => new THREE.SphereGeometry(0.045, 24, 16), halfHeight: 0.045 },
  cone: { create: () => new THREE.ConeGeometry(0.045, 0.1, 24), halfHeight: 0.05 },
  cylinder: { create: () => new THREE.CylinderGeometry(0.038, 0.038, 0.09, 24), halfHeight: 0.045 },
  prism: { create: () => new THREE.CylinderGeometry(0.052, 0.052, 0.09, 3), halfHeight: 0.045 },
});

const COLORS = Object.freeze({
  tableTop: 0x3b4658,
  tableEdge: 0x60a5fa,
  leg: 0x1f2937,
  targetBase: 0x253043,
  success: 0x22c55e,
  error: 0xef4444,
  hover: 0xffffff,
  held: 0x60a5fa,
});

const HOVER_SCALE = 1.08;

export function buildLab(parent, config) {
  validateLabConfig(config);

  const root = new THREE.Group();
  root.name = 'Laboratorio';
  parent.add(root);

  const disposables = new Set();
  const keep = (resource) => { disposables.add(resource); return resource; };

  buildTable(root, config.table, keep);

  // Una geometría por forma, compartida entre la pieza y la silueta de su destino.
  const geometries = new Map();
  for (const def of config.pieces) {
    if (!geometries.has(def.shape)) geometries.set(def.shape, keep(SHAPES[def.shape].create()));
  }

  const pieces = new Map();
  for (const def of config.pieces) {
    pieces.set(def.id, createPiece(root, def, geometries.get(def.shape), config.table, keep));
  }

  const pieceByTarget = new Map(config.pieces.map((d) => [d.targetId, pieces.get(d.id)]));
  const targets = new Map();
  const baseGeometry = keep(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 40));
  const ringGeometry = keep(new THREE.TorusGeometry(0.07, 0.005, 8, 48));
  for (const tdef of config.targets) {
    const piece = pieceByTarget.get(tdef.id);
    targets.set(tdef.id, createTarget(root, tdef, piece, {
      baseGeometry, ringGeometry, pieceGeometry: geometries.get(piece.def.shape), table: config.table, keep,
    }));
  }

  /** Datos mínimos que necesitan las reglas (sin Three.js). */
  const ruleTargets = [...targets.values()].map((t) => ({
    id: t.id,
    anchor: { x: t.anchor.x, y: t.anchor.y, z: t.anchor.z },
  }));

  let hovered = new Set();

  function requirePiece(id) {
    const piece = pieces.get(id);
    if (!piece) throw new Error(`labBuilder: pieza desconocida ${id}`);
    return piece;
  }

  return {
    root,
    pieces,
    targets,
    ruleTargets,

    setHovered(ids) { hovered = ids; },

    /** Ajuste automático: copia posición y orientación del destino (snap-to-target). */
    snapToTarget(pieceId) {
      const piece = requirePiece(pieceId);
      const target = targets.get(piece.def.targetId);
      piece.mesh.position.copy(target.anchor);
      piece.mesh.quaternion.copy(target.quaternion);
    },

    returnHome(pieceId) {
      const piece = requirePiece(pieceId);
      piece.mesh.position.copy(piece.homePosition);
      piece.mesh.quaternion.copy(piece.homeQuaternion);
    },

    flashError(pieceId, targetId, until) {
      requirePiece(pieceId).errorUntil = until;
      const target = targets.get(targetId);
      if (target) target.errorUntil = until;
    },

    resetAll() {
      for (const piece of pieces.values()) {
        piece.mesh.position.copy(piece.homePosition);
        piece.mesh.quaternion.copy(piece.homeQuaternion);
        piece.mesh.scale.setScalar(1);
        piece.errorUntil = 0;
      }
      for (const target of targets.values()) target.errorUntil = 0;
      hovered = new Set();
    },

    /** Aplica la apariencia según el estado. Es barato (5 piezas) y se ejecuta cada frame. */
    updateVisuals(now, getStatus) {
      for (const piece of pieces.values()) {
        const status = getStatus(piece.id);
        let hex = 0x000000;
        let intensity = 0;
        if (status === PIECE_STATUS.PLACED) { hex = COLORS.success; intensity = 0.45; }
        else if (now < piece.errorUntil) { hex = COLORS.error; intensity = 0.9; }
        else if (status === PIECE_STATUS.SELECTED || status === PIECE_STATUS.DRAGGING) { hex = COLORS.held; intensity = 0.45; }
        else if (hovered.has(piece.id)) { hex = COLORS.hover; intensity = 0.25; }
        piece.material.emissive.setHex(hex);
        piece.material.emissiveIntensity = intensity;
        const grow = hovered.has(piece.id) && status === PIECE_STATUS.AVAILABLE;
        piece.mesh.scale.setScalar(grow ? HOVER_SCALE : 1);
      }

      for (const target of targets.values()) {
        const completed = getStatus(target.pieceId) === PIECE_STATUS.PLACED;
        const erroring = !completed && now < target.errorUntil;
        const color = completed ? COLORS.success : erroring ? COLORS.error : COLORS.targetBase;
        target.baseMaterial.color.setHex(color);
        target.baseMaterial.emissive.setHex(completed || erroring ? color : 0x000000);
        target.baseMaterial.emissiveIntensity = completed || erroring ? 0.5 : 0;
        target.ghost.visible = !completed;
        target.check.visible = completed;
      }
    },

    dispose() {
      parent.remove(root);
      disposables.forEach((r) => r.dispose?.());
      disposables.clear();
    },
  };
}

function validateLabConfig(config) {
  const { pieces, targets } = config ?? {};
  if (!Array.isArray(pieces) || !Array.isArray(targets)) throw new Error('Configuración del laboratorio incompleta.');
  if (pieces.length !== 5 || targets.length !== 5) {
    throw new Error(`Se requieren exactamente 5 piezas y 5 destinos (hay ${pieces.length} y ${targets.length}).`);
  }
  const targetIds = new Set(targets.map((t) => t.id));
  const used = new Set();
  for (const p of pieces) {
    if (!SHAPES[p.shape]) throw new Error(`Forma desconocida: ${p.shape}`);
    if (!targetIds.has(p.targetId)) throw new Error(`La pieza ${p.id} apunta a un destino inexistente: ${p.targetId}`);
    if (used.has(p.targetId)) throw new Error(`El destino ${p.targetId} está asignado a más de una pieza.`);
    used.add(p.targetId);
  }
}

function buildTable(root, table, keep) {
  const group = new THREE.Group();
  group.name = 'Mesa';

  const top = new THREE.Mesh(
    keep(new THREE.BoxGeometry(table.width, table.thickness, table.depth)),
    keep(new THREE.MeshStandardMaterial({ color: COLORS.tableTop, roughness: 0.7 })),
  );
  top.position.set(0, table.topY - table.thickness / 2, table.centerZ);
  group.add(top);

  // Filo luminoso frontal para ubicar la mesa con facilidad.
  const edge = new THREE.Mesh(
    keep(new THREE.BoxGeometry(table.width, 0.008, 0.008)),
    keep(new THREE.MeshBasicMaterial({ color: COLORS.tableEdge })),
  );
  edge.position.set(0, table.topY - 0.004, table.centerZ + table.depth / 2);
  group.add(edge);

  const legHeight = table.topY - table.thickness;
  const legGeometry = keep(new THREE.BoxGeometry(0.05, legHeight, 0.05));
  const legMaterial = keep(new THREE.MeshStandardMaterial({ color: COLORS.leg, roughness: 0.8 }));
  const dx = table.width / 2 - 0.06;
  const dz = table.depth / 2 - 0.06;
  for (const [x, z] of [[-dx, -dz], [dx, -dz], [-dx, dz], [dx, dz]]) {
    const leg = new THREE.Mesh(legGeometry, legMaterial);
    leg.position.set(x, legHeight / 2, table.centerZ + z);
    group.add(leg);
  }
  root.add(group);
}

function createPiece(root, def, geometry, table, keep) {
  const shape = SHAPES[def.shape];
  const material = keep(new THREE.MeshStandardMaterial({
    color: def.color, roughness: 0.45, metalness: 0.05, flatShading: def.shape === 'prism',
  }));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `Pieza ${def.id} (${def.name})`;
  mesh.userData = { kind: 'piece', id: def.id };

  const homePosition = new THREE.Vector3(def.start.x, table.topY + shape.halfHeight, def.start.z);
  const homeQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, def.start.rotY ?? 0, 0));
  mesh.position.copy(homePosition);
  mesh.quaternion.copy(homeQuaternion);

  // Letra flotante sobre la pieza (identificación redundante: forma + color + letra).
  const labelTexture = keep(createLabelTexture({
    text: def.label, width: 128, height: 128, shape: 'circle',
    background: '#0f172a', border: `#${def.color.toString(16).padStart(6, '0')}`,
    font: `800 78px ${FONT_STACK}`,
  }));
  const label = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: labelTexture, depthWrite: false })));
  label.scale.set(0.04, 0.04, 1);
  label.position.y = shape.halfHeight + 0.035;
  mesh.add(label);

  root.add(mesh);
  return { id: def.id, def, mesh, material, homePosition, homeQuaternion, errorUntil: 0 };
}

function createTarget(root, tdef, piece, { baseGeometry, ringGeometry, pieceGeometry, table, keep }) {
  const { def } = piece;
  const halfHeight = SHAPES[def.shape].halfHeight;
  const colorCss = `#${def.color.toString(16).padStart(6, '0')}`;

  const group = new THREE.Group();
  group.name = `Destino ${tdef.id} (${def.label})`;
  group.position.set(tdef.x, table.topY, tdef.z);
  group.rotation.y = tdef.rotY ?? 0;

  const baseMaterial = keep(new THREE.MeshStandardMaterial({ color: COLORS.targetBase, roughness: 0.8 }));
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.position.y = 0.006;

  const ring = new THREE.Mesh(ringGeometry, keep(new THREE.MeshBasicMaterial({ color: def.color })));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.0125;

  // Silueta en alambre con la MISMA forma de la pieza que le corresponde.
  const ghost = new THREE.Mesh(pieceGeometry, keep(new THREE.MeshBasicMaterial({
    color: def.color, wireframe: true, transparent: true, opacity: 0.55,
  })));
  ghost.position.y = halfHeight;

  // Etiqueta "A · Cubo": rótulo ELEVADO detrás de la silueta, inclinado hacia el usuario.
  // Antes estaba sobre la mesa, entre la fila de piezas y la de destinos, y las letras
  // flotantes de las piezas la tapaban al mirar desde abajo (usuario sentado) o desde
  // la vista previa. A 20 cm queda por encima de la pieza más alta (10 cm) y del ✓.
  const labelTexture = keep(createLabelTexture({
    text: `${def.label} · ${def.name}`, width: 400, height: 96, background: '#0f172a',
    border: colorCss, font: `700 36px ${FONT_STACK}`,
  }));
  const label = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(0.19, 0.0456)), // misma proporción que el canvas (400×96)
    keep(new THREE.MeshBasicMaterial({ map: labelTexture, transparent: true })),
  );
  label.rotation.x = -0.35;
  label.position.set(0, 0.2, -0.04);

  // Indicador de completado (✓ verde), redundante con el color.
  const checkTexture = keep(createLabelTexture({
    text: '✓', width: 128, height: 128, shape: 'circle', background: '#16a34a',
    font: `800 90px ${FONT_STACK}`,
  }));
  const check = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: checkTexture, depthWrite: false })));
  check.scale.set(0.05, 0.05, 1);
  check.position.y = halfHeight * 2 + 0.05;
  check.visible = false;

  group.add(base, ring, ghost, label, check);
  root.add(group);

  const anchor = new THREE.Vector3(tdef.x, table.topY + halfHeight, tdef.z);
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, tdef.rotY ?? 0, 0));

  return { id: tdef.id, pieceId: def.id, group, baseMaterial, ghost, check, anchor, quaternion, errorUntil: 0 };
}
