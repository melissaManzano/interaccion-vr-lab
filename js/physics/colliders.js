/**
 * colliders.js — Catálogo de figuras: para cada tipo, su MALLA visual (Three.js) y su
 * COLISIONADOR físico (cannon-es), construidos con las MISMAS medidas.
 *
 * | Figura            | Malla Three.js                     | Colisionador cannon-es             | Tipo de colisión          |
 * |-------------------|------------------------------------|------------------------------------|---------------------------|
 * | Cubo              | BoxGeometry(l, l, l)               | Box(l/2, l/2, l/2)                 | Exacto                    |
 * | Esfera            | SphereGeometry(r, 24, 16)          | Sphere(r)                          | Exacto (analítico)        |
 * | Cilindro          | CylinderGeometry(r, r, h, 16)      | Cylinder(r, r, h, 16)              | Poliedro convexo de 16 caras laterales: coincide con la malla |
 * | Prisma triangular | CylinderGeometry(r, r, h, 3)       | Cylinder(r, r, h, 3)               | Poliedro convexo exacto (5 caras) |
 *
 * Notas:
 * - En cannon-es (≥ 0.16) Cylinder está alineado con el eje Y, igual que Three.js.
 * - Con 3 segmentos, Three.js y cannon-es generan los mismos tres vértices
 *   (ángulos 0°, 120°, 240°), así que el prisma visible y el físico coinciden.
 * - Se usan formas primitivas o convexas (no Trimesh) porque son estables y baratas:
 *   cannon-es no detecta bien colisiones entre dos Trimesh.
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export const COLLIDERS = Object.freeze({
  box: {
    description: 'Box (caja, colisión exacta)',
    geometry: ({ side }) => new THREE.BoxGeometry(side, side, side),
    shape: ({ side }) => new CANNON.Box(new CANNON.Vec3(side / 2, side / 2, side / 2)),
    halfHeight: ({ side }) => side / 2,
    flatShading: false,
  },
  sphere: {
    description: 'Sphere (esfera analítica, colisión exacta)',
    geometry: ({ radius }) => new THREE.SphereGeometry(radius, 24, 16),
    shape: ({ radius }) => new CANNON.Sphere(radius),
    halfHeight: ({ radius }) => radius,
    flatShading: false,
  },
  cylinder: {
    description: 'Cylinder (poliedro convexo de 16 lados)',
    geometry: ({ radius, height, segments = 16 }) => new THREE.CylinderGeometry(radius, radius, height, segments),
    shape: ({ radius, height, segments = 16 }) => new CANNON.Cylinder(radius, radius, height, segments),
    halfHeight: ({ height }) => height / 2,
    flatShading: false,
  },
  prism: {
    description: 'Cylinder de 3 lados (poliedro convexo = prisma triangular)',
    geometry: ({ radius, height }) => new THREE.CylinderGeometry(radius, radius, height, 3),
    shape: ({ radius, height }) => new CANNON.Cylinder(radius, radius, height, 3),
    halfHeight: ({ height }) => height / 2,
    flatShading: true,
  },
});

export function getCollider(type) {
  const collider = COLLIDERS[type];
  if (!collider) throw new Error(`Colisionador desconocido: ${type}`);
  return collider;
}
