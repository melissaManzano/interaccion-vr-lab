/**
 * vrPanel.js — HUD inmersivo hecho en Three.js (canvas → textura sobre un plano).
 *
 * No es un div de Bootstrap: el DOM no existe dentro del visor.
 *
 * Rendimiento: el canvas solo se redibuja cuando cambia algún texto visible.
 * Para eso se compara una "firma" del contenido. Mientras corre el reto, el tiempo
 * se muestra en segundos (≈1 redibujo por segundo); las décimas solo aparecen al final.
 */
import * as THREE from 'three';
import { PHASE, PHASE_LABEL, MESSAGE_KIND } from '../core/state.js';
import { formatTime } from '../logic/timer.js';
import { create2dCanvas, roundRectPath, wrapText, FONT_STACK } from './canvasText.js';

const CANVAS_W = 1024;
const CANVAS_H = 600;

const PHASE_COLOR = { pending: '#94a3b8', active: '#38bdf8', completed: '#22c55e', error: '#ef4444' };
const MESSAGE_STYLE = {
  [MESSAGE_KIND.INFO]: { bg: '#1e293b', fg: '#e2e8f0' },
  [MESSAGE_KIND.SUCCESS]: { bg: '#14532d', fg: '#bbf7d0' },
  [MESSAGE_KIND.WARNING]: { bg: '#713f12', fg: '#fde68a' },
  [MESSAGE_KIND.ERROR]: { bg: '#7f1d1d', fg: '#fecaca' },
};
const DEFAULT_HINT = {
  pending: 'Apunta a una pieza y pellizca para comenzar.',
  active: 'Lleva cada pieza al destino con su misma forma y letra.',
  completed: '¡Excelente trabajo!',
};

export function createVrPanel({ parent, store, title, position, width }) {
  const { canvas, ctx } = create2dCanvas(CANVAS_W, CANVAS_H);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const height = width * (CANVAS_H / CANVAS_W);
  const group = new THREE.Group();
  group.name = 'Panel HUD';
  group.position.fromArray(position);

  const frameGeometry = new THREE.BoxGeometry(width + 0.03, height + 0.03, 0.02);
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.6 });
  const frame = new THREE.Mesh(frameGeometry, frameMaterial);
  frame.position.z = -0.011;

  const screenGeometry = new THREE.PlaneGeometry(width, height);
  const screenMaterial = new THREE.MeshBasicMaterial({ map: texture });
  const screen = new THREE.Mesh(screenGeometry, screenMaterial);

  group.add(frame, screen);
  parent.add(group);

  let lastSignature = '';

  function buildView(now) {
    const state = store.getState();
    const msg = state.message;
    const messageExpired = msg.expiresAt !== null && now > msg.expiresAt;
    const hasMessage = Boolean(msg.text) && !messageExpired;
    const completed = state.phase === PHASE.COMPLETED;
    const showError = hasMessage && msg.kind === MESSAGE_KIND.ERROR;

    let handsText;
    let handsColor = '#94a3b8';
    if (!state.xr.presenting) {
      handsText = 'Vista de escritorio (depuración)';
    } else {
      const { left, right } = state.xr.hands;
      handsText = `Manos:  Izquierda ${left ? '✓' : '✗'}   Derecha ${right ? '✓' : '✗'}`;
      if (!left && !right) {
        handsText = 'No se detectan manos: suelta los mandos y muestra tus manos';
        handsColor = '#fca5a5';
      } else {
        handsColor = '#cbd5e1';
      }
    }

    return {
      placed: store.placedCount(),
      total: store.totalPieces(),
      time: formatTime(store.elapsedMs(now), completed),
      phaseLabel: showError ? 'Error' : PHASE_LABEL[state.phase],
      phaseColor: showError ? PHASE_COLOR.error : PHASE_COLOR[state.phase],
      messageText: hasMessage ? msg.text : DEFAULT_HINT[state.phase],
      messageKind: hasMessage ? msg.kind : MESSAGE_KIND.INFO,
      handsText,
      handsColor,
    };
  }

  function draw(view) {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    const bg = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    bg.addColorStop(0, '#15233d');
    bg.addColorStop(1, '#0b1220');
    ctx.fillStyle = bg;
    roundRectPath(ctx, 0, 0, CANVAS_W, CANVAS_H, 36);
    ctx.fill();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 6;
    roundRectPath(ctx, 3, 3, CANVAS_W - 6, CANVAS_H - 6, 34);
    ctx.stroke();

    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f1f5f9';
    ctx.font = `700 52px ${FONT_STACK}`;
    ctx.fillText(title, 48, 34);

    ctx.fillStyle = '#94a3b8';
    ctx.font = `400 30px ${FONT_STACK}`;
    ctx.fillText('1. Apunta con el rayo   2. Pellizca (índice + pulgar) para tomar', 48, 104);
    ctx.fillText('3. Suelta sobre el destino con la misma forma y letra', 48, 142);

    drawStat(48, 198, 'PROGRESO', `${view.placed}/${view.total}`, '#38bdf8');
    drawStat(367, 198, 'TIEMPO', view.time, '#f1f5f9');
    drawStat(686, 198, 'ESTADO', view.phaseLabel, view.phaseColor, 50);

    // Barra de progreso segmentada (refuerzo visual del contador).
    const segW = (CANVAS_W - 96 - (view.total - 1) * 10) / view.total;
    for (let i = 0; i < view.total; i += 1) {
      ctx.fillStyle = i < view.placed ? '#22c55e' : '#334155';
      roundRectPath(ctx, 48 + i * (segW + 10), 358, segW, 16, 8);
      ctx.fill();
    }

    const style = MESSAGE_STYLE[view.messageKind] ?? MESSAGE_STYLE.info;
    ctx.fillStyle = style.bg;
    roundRectPath(ctx, 48, 396, CANVAS_W - 96, 116, 20);
    ctx.fill();
    ctx.fillStyle = style.fg;
    ctx.font = `600 34px ${FONT_STACK}`;
    const lines = wrapText(ctx, view.messageText, CANVAS_W - 140).slice(0, 2);
    const startY = lines.length === 1 ? 435 : 414;
    lines.forEach((line, i) => ctx.fillText(line, 70, startY + i * 44));

    ctx.fillStyle = view.handsColor;
    ctx.font = `500 28px ${FONT_STACK}`;
    ctx.fillText(view.handsText, 48, 538);
  }

  function drawStat(x, y, label, value, color, valueSize = 70) {
    ctx.fillStyle = '#1e293b';
    roundRectPath(ctx, x, y, 290, 140, 20);
    ctx.fill();
    ctx.fillStyle = '#94a3b8';
    ctx.font = `600 24px ${FONT_STACK}`;
    ctx.fillText(label, x + 22, y + 16);
    ctx.fillStyle = color;
    ctx.font = `800 ${valueSize}px ${FONT_STACK}`;
    ctx.fillText(value, x + 22, y + 50 + (70 - valueSize) / 2);
  }

  return {
    group,
    update(now) {
      const view = buildView(now);
      const signature = Object.values(view).join('|');
      if (signature === lastSignature) return;
      lastSignature = signature;
      draw(view);
      texture.needsUpdate = true;
    },
    dispose() {
      parent.remove(group);
      [frameGeometry, frameMaterial, screenGeometry, screenMaterial, texture].forEach((r) => r.dispose());
    },
  };
}
