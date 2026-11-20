/**
 * binDisplays.js — Pequeña pantalla 3D detrás de cada recipiente: avance 0/5 y tiempo
 * de llenado. Complementa al marcador general: la información está donde se mira.
 *
 * Igual que el marcador, solo redibuja su canvas cuando cambia el texto.
 */
import * as THREE from 'three';
import { create2dCanvas, roundRectPath, FONT_STACK } from './canvasText.js';
import { formatTime } from '../logic/timer.js';

const W = 384;
const H = 128;

export function createBinDisplays({ lab, classes, store, binHeight, binOuter }) {
  const classById = new Map(classes.map((c) => [c.id, c]));
  const geometry = new THREE.PlaneGeometry(binOuter - 0.02, (binOuter - 0.02) * (H / W));
  const entries = [];

  for (const bin of lab.bins.values()) {
    const { canvas, ctx } = create2dCanvas(W, H);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, binHeight + 0.075, -binOuter / 2 + 0.01);
    mesh.rotation.x = -0.25;
    bin.group.add(mesh);
    entries.push({ binId: bin.id, cls: classById.get(bin.classId), canvas, ctx, texture, material, mesh, signature: '' });
  }

  function draw(entry, { count, capacity, completedAtMs }) {
    const { ctx, cls } = entry;
    const full = count >= capacity;
    const color = `#${cls.color.toString(16).padStart(6, '0')}`;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = full ? '#14532d' : '#0f172a';
    roundRectPath(ctx, 3, 3, W - 6, H - 6, 18);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = full ? '#22c55e' : color;
    ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f8fafc';
    ctx.font = `800 64px ${FONT_STACK}`;
    ctx.fillText(`${count}/${capacity}`, 22, H / 2 + 2);

    // Mini barra de 5 segmentos
    const segW = 22;
    for (let i = 0; i < capacity; i += 1) {
      ctx.fillStyle = i < count ? '#22c55e' : '#334155';
      roundRectPath(ctx, 170 + i * (segW + 6), 22, segW, 22, 5);
      ctx.fill();
    }
    ctx.fillStyle = full ? '#bbf7d0' : '#94a3b8';
    ctx.font = `600 34px ${FONT_STACK}`;
    ctx.fillText(full ? `✓ ${formatTime(completedAtMs)}` : 'Llenando…', 170, 88, W - 186);
  }

  return {
    update() {
      for (const entry of entries) {
        const bin = store.getBin(entry.binId);
        const signature = `${bin.count}|${bin.completedAtMs}`;
        if (signature === entry.signature) continue;
        entry.signature = signature;
        draw(entry, bin);
        entry.texture.needsUpdate = true;
      }
    },
    dispose() {
      for (const e of entries) {
        e.mesh.parent?.remove(e.mesh);
        e.texture.dispose();
        e.material.dispose();
      }
      geometry.dispose();
    },
  };
}
