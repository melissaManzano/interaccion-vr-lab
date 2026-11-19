/**
 * sceneSetup.js — Renderer, cámara, luces y entorno (sala y piso delimitado).
 *
 * Optimización para Quest 3: sin sombras dinámicas, sin posprocesado, dos luces
 * y geometrías de pocos polígonos.
 */
import * as THREE from 'three';

const BACKGROUND_COLOR = 0x0b1220;
const FLOOR_RADIUS = 3;

export function createSceneContext({ container, cameraPosition, cameraTarget }) {
  if (!(container instanceof HTMLElement)) {
    throw new TypeError('createSceneContext: se requiere un contenedor HTML válido.');
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  renderer.domElement.classList.add('preview-canvas');
  renderer.domElement.setAttribute('aria-label', 'Vista previa 3D del laboratorio (depuración)');
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND_COLOR);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 50);
  camera.position.fromArray(cameraPosition);
  camera.lookAt(new THREE.Vector3().fromArray(cameraTarget));

  const environment = buildEnvironment(scene);

  function resize() {
    if (renderer.xr.isPresenting) return; // No se puede cambiar el tamaño durante VR.
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  function dispose() {
    observer.disconnect();
    environment.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return { renderer, scene, camera, resize, dispose };
}

function buildEnvironment(scene) {
  const group = new THREE.Group();
  group.name = 'Entorno';
  const disposables = [];
  const keep = (resource) => { disposables.push(resource); return resource; };

  // Iluminación equilibrada: hemisférica (ambiente) + direccional (volumen).
  const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x1a2030, 1.6);
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(1.2, 3, 1.5);
  group.add(hemi, sun);

  // Piso circular delimitado.
  const floor = new THREE.Mesh(
    keep(new THREE.CircleGeometry(FLOOR_RADIUS, 64)),
    keep(new THREE.MeshStandardMaterial({ color: 0x182133, roughness: 0.95 })),
  );
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);

  const grid = new THREE.GridHelper(FLOOR_RADIUS * 2, 24, 0x334155, 0x223047);
  grid.position.y = 0.002;
  keep(grid.geometry);
  keep(grid.material);
  group.add(grid);

  // Borde luminoso que marca el límite del área de trabajo.
  const border = new THREE.Mesh(
    keep(new THREE.RingGeometry(FLOOR_RADIUS - 0.04, FLOOR_RADIUS, 96)),
    keep(new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide })),
  );
  border.rotation.x = -Math.PI / 2;
  border.position.y = 0.004;
  group.add(border);

  // Paredes lejanas, opacas y suaves, para dar sensación de sala (fondo virtual opaco).
  const walls = new THREE.Mesh(
    keep(new THREE.CylinderGeometry(6, 6, 4, 48, 1, true)),
    keep(new THREE.MeshStandardMaterial({ color: 0x111a2c, roughness: 1, side: THREE.BackSide })),
  );
  walls.position.y = 2;
  group.add(walls);

  scene.add(group);

  return {
    dispose() {
      scene.remove(group);
      disposables.forEach((r) => r.dispose?.());
    },
  };
}
