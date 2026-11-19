/**
 * desktopPreview.js — Vista previa de DEPURACIÓN en computadora.
 *
 * NO sustituye la experiencia VR. Sirve para probar reglas, contador, cronómetro y
 * panel sin el visor:
 *   - Clic izquierdo: tomar y soltar piezas, o pulsar botones (simula la pinza).
 *   - Clic derecho + arrastrar: girar la cámara.  Rueda: acercar o alejar.
 * El mouse se expone como una "fuente de puntero" igual a una mano.
 * Se desactiva automáticamente durante la sesión VR.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createDesktopPreview({ camera, domElement, position, target }) {
  const homePosition = new THREE.Vector3().fromArray(position);
  const homeTarget = new THREE.Vector3().fromArray(target);

  const controls = new OrbitControls(camera, domElement);
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.minDistance = 0.4;
  controls.maxDistance = 3;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.target.copy(homeTarget);
  controls.update();

  const ndc = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const ray = new THREE.Ray();
  const queue = [];
  let enabled = true;
  let hasPointer = false;
  let buttonDown = false;

  function updateNdc(event) {
    const rect = domElement.getBoundingClientRect();
    ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  const onPointerMove = (event) => { updateNdc(event); hasPointer = true; };
  const onPointerDown = (event) => {
    if (!enabled || event.button !== 0) return;
    updateNdc(event);
    hasPointer = true;
    buttonDown = true;
    domElement.setPointerCapture?.(event.pointerId);
    queue.push('start');
  };
  const onPointerUp = (event) => {
    if (event.button !== 0 || !buttonDown) return;
    buttonDown = false;
    queue.push('end');
  };
  const onPointerLeave = () => { if (!buttonDown) hasPointer = false; };
  const onContextMenu = (event) => event.preventDefault();

  domElement.addEventListener('pointermove', onPointerMove);
  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('pointerup', onPointerUp);
  domElement.addEventListener('pointercancel', onPointerUp);
  domElement.addEventListener('pointerleave', onPointerLeave);
  domElement.addEventListener('contextmenu', onContextMenu);

  return {
    /** Devuelve la fuente "mouse" para este frame. */
    getSource() {
      if (!enabled) return { id: 'mouse', active: false, ray, event: null };
      controls.update();
      camera.updateMatrixWorld();
      raycaster.setFromCamera(ndc, camera);
      ray.copy(raycaster.ray);
      return { id: 'mouse', active: hasPointer || buttonDown, ray, event: queue.shift() ?? null };
    },

    applyFeedback(feedback) {
      const fb = feedback.get('mouse');
      let cursor = 'default';
      if (fb?.state === 'drag') cursor = 'grabbing';
      else if (fb?.state === 'hover') cursor = fb.category === 'button' ? 'pointer' : 'grab';
      domElement.style.cursor = cursor;
    },

    setEnabled(value) {
      enabled = Boolean(value);
      controls.enabled = enabled;
      if (!enabled) {
        queue.length = 0;
        buttonDown = false;
        hasPointer = false;
      }
    },

    /** Restaura la cámara de escritorio tras salir de VR. */
    restoreCamera() {
      camera.position.copy(homePosition);
      camera.quaternion.identity();
      controls.target.copy(homeTarget);
      camera.lookAt(homeTarget);
      controls.update();
    },

    dispose() {
      domElement.removeEventListener('pointermove', onPointerMove);
      domElement.removeEventListener('pointerdown', onPointerDown);
      domElement.removeEventListener('pointerup', onPointerUp);
      domElement.removeEventListener('pointercancel', onPointerUp);
      domElement.removeEventListener('pointerleave', onPointerLeave);
      domElement.removeEventListener('contextmenu', onContextMenu);
      controls.dispose();
    },
  };
}
