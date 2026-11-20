/**
 * scoreboard.js — Marcador inmersivo 3D (canvas → textura sobre un plano).
 *
 * Muestra: clasificadas X/20, tiempo global, errores, precisión, estado, avance 0/5 de
 * cada recipiente con su tiempo de llenado, mensajes de retroalimentación y el estado
 * de las manos. No es un div: el DOM no existe dentro del visor.
 *
 * Rendimiento: el canvas solo se redibuja cuando cambia algún texto visible (se compara
 * una "firma"). Mientras corre el reto el tiempo va en segundos (≈1 redibujo/s).
 */
import * as THREE from 'three';
import { PHASE, PHASE_LABEL, MESSAGE_KIND } from '../core/state.js';
import { formatTime } from '../logic/timer.js';
import { formatAccuracy } from '../validation/sortingRules.js';
import { create2dCanvas, roundRectPath, wrapText, FONT_STACK } from './canvasText.js';

const CANVAS_W = 1024;
const CANVAS_H = 730;

const PHASE_COLOR = { pending: '#94a3b8', active: '#38bdf8', completed: '#22c55e', error: '#ef4444' };
const MESSAGE_STYLE = {
  [MESSAGE_KIND.INFO]: { bg: '#1e293b', fg: '#e2e8f0' },
  [MESSAGE_KIND.SUCCESS]: { bg: '#14532d', fg: '#bbf7d0' },
  [MESSAGE_KIND.WARNING]: { bg: '#713f12', fg: '#fde68a' },
  [MESSAGE_KIND.ERROR]: { bg: '#7f1d1d', fg: '#fecaca' },
};
const DEFAULT_HINT = {
  pending: 'Apunta al botón "Iniciar" (abajo) y pellizca para comenzar.',
  active: 'Deja cada figura en el recipiente con su misma forma, letra y color.',
  completed: '¡Excelente trabajo! Pulsa "Reinicio aleatorio" para otra ronda.',
};

/** "2 en caída · 1 en validación · 1 recuperable" (solo los estados transitorios presentes). */
function describeStates(counts) {
  const parts = [];
  if (counts.falling) parts.push(`${counts.falling} en caída`);
  if (counts.validating) parts.push(`${counts.validating} en validación`);
  if (counts.recoverable) parts.push(`${counts.recoverable} ${counts.recoverable === 1 ? 'recuperable' : 'recuperables'} (ámbar)`);
  return parts.join(' · ');
}

export function createScoreboard({ parent, store, classes, bins, title, position, width }) {
  const classById = new Map(classes.map((c) => [c.id, c]));
  const { canvas, ctx } = create2dCanvas(CANVAS_W, CANVAS_H);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const height = width * (CANVAS_H / CANVAS_W);
  const group = new THREE.Group();
  group.name = 'Marcador 3D';
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
    const hasMessage = Boolean(msg.text) && !(msg.expiresAt !== null && now > msg.expiresAt);
    const completed = state.phase === PHASE.COMPLETED;
    const showError = hasMessage && msg.kind === MESSAGE_KIND.ERROR;

    let handsText;
    let handsColor = '#94a3b8';
    if (!state.xr.presenting) {
      handsText = 'Vista de escritorio (depuración) · la experiencia real es en el visor';
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
      sorted: store.sortedCount(),
      total: store.totalObjects(),
      time: formatTime(store.elapsedMs(now), completed),
      errors: state.stats.errors,
      accuracy: formatAccuracy(store.accuracy()),
      phaseLabel: showError ? 'Error' : PHASE_LABEL[state.phase],
      phaseColor: showError ? PHASE_COLOR.error : PHASE_COLOR[state.phase],
      bins: bins.map((b) => {
        const s = store.getBin(b.id);
        return `${b.id}:${s.count}:${s.capacity}:${s.completedAtMs ?? ''}`;
      }).join(','),
      messageText: hasMessage ? msg.text : DEFAULT_HINT[state.phase],
      messageKind: hasMessage ? msg.kind : MESSAGE_KIND.INFO,
      handsText,
      handsColor,
      statesText: describeStates(store.countByStatus()),
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
    ctx.font = `700 46px ${FONT_STACK}`;
    ctx.fillText(title, 48, 30, 700);

    // Estado (píldora a la derecha del título)
    ctx.font = `700 30px ${FONT_STACK}`;
    const pillW = Math.max(150, ctx.measureText(view.phaseLabel).width + 48);
    ctx.fillStyle = '#1e293b';
    roundRectPath(ctx, CANVAS_W - 48 - pillW, 30, pillW, 52, 26);
    ctx.fill();
    ctx.fillStyle = view.phaseColor;
    ctx.textAlign = 'center';
    ctx.fillText(view.phaseLabel, CANVAS_W - 48 - pillW / 2, 41);
    ctx.textAlign = 'left';

    ctx.fillStyle = '#94a3b8';
    ctx.font = `400 26px ${FONT_STACK}`;
    ctx.fillText('Apunta · pellizca para tomar · abre los dedos sobre el recipiente correcto', 48, 96, CANVAS_W - 96);

    // Fila de indicadores
    const boxW = 220;
    const gap = (CANVAS_W - 96 - 4 * boxW) / 3;
    drawStat(48, 140, boxW, 'CLASIFICADAS', `${view.sorted}/${view.total}`, '#38bdf8');
    drawStat(48 + (boxW + gap), 140, boxW, 'TIEMPO', view.time, '#f1f5f9', view.time.length > 5 ? 52 : 62);
    drawStat(48 + 2 * (boxW + gap), 140, boxW, 'ERRORES', String(view.errors), view.errors > 0 ? '#fca5a5' : '#f1f5f9');
    drawStat(48 + 3 * (boxW + gap), 140, boxW, 'PRECISIÓN', view.accuracy, '#fde68a');

    // Tabla de recipientes
    bins.forEach((b, i) => {
      const s = store.getBin(b.id);
      const cls = classById.get(b.classId);
      drawBinRow(48, 292 + i * 60, CANVAS_W - 96, cls, s);
    });

    // Mensaje
    const style = MESSAGE_STYLE[view.messageKind] ?? MESSAGE_STYLE.info;
    ctx.fillStyle = style.bg;
    roundRectPath(ctx, 48, 545, CANVAS_W - 96, 108, 20);
    ctx.fill();
    ctx.fillStyle = style.fg;
    ctx.font = `600 31px ${FONT_STACK}`;
    const lines = wrapText(ctx, view.messageText, CANVAS_W - 140).slice(0, 2);
    const startY = lines.length === 1 ? 581 : 561;
    lines.forEach((line, i) => ctx.fillText(line, 70, startY + i * 40));

    ctx.fillStyle = view.handsColor;
    ctx.font = `500 24px ${FONT_STACK}`;
    ctx.fillText(view.handsText, 48, 668, 560);
    ctx.fillStyle = '#fbbf24';
    ctx.textAlign = 'right';
    ctx.fillText(view.statesText, CANVAS_W - 48, 668, 360);
    ctx.textAlign = 'left';
  }

  function drawStat(x, y, w, label, value, color, valueSize = 62) {
    ctx.fillStyle = '#1e293b';
    roundRectPath(ctx, x, y, w, 132, 20);
    ctx.fill();
    ctx.fillStyle = '#94a3b8';
    ctx.font = `600 22px ${FONT_STACK}`;
    ctx.fillText(label, x + 20, y + 16);
    ctx.fillStyle = color;
    ctx.font = `800 ${valueSize}px ${FONT_STACK}`;
    ctx.fillText(value, x + 20, y + 52 + (62 - valueSize) / 2, w - 40);
  }

  function drawBinRow(x, y, w, cls, s) {
    const full = s.count >= s.capacity;
    const color = `#${cls.color.toString(16).padStart(6, '0')}`;
    ctx.fillStyle = full ? '#123524' : '#16213a';
    roundRectPath(ctx, x, y, w, 52, 14);
    ctx.fill();

    // Letra sobre el color de la clase (identificación redundante)
    ctx.fillStyle = color;
    roundRectPath(ctx, x + 8, y + 7, 38, 38, 10);
    ctx.fill();
    ctx.fillStyle = '#0b1220';
    ctx.font = `800 26px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.fillText(cls.label, x + 27, y + 12);
    ctx.textAlign = 'left';

    ctx.fillStyle = '#e2e8f0';
    ctx.font = `600 28px ${FONT_STACK}`;
    ctx.fillText(cls.plural, x + 60, y + 11, 200);

    const segW = 44;
    for (let i = 0; i < s.capacity; i += 1) {
      ctx.fillStyle = i < s.count ? '#22c55e' : '#334155';
      roundRectPath(ctx, x + 270 + i * (segW + 8), y + 16, segW, 20, 6);
      ctx.fill();
    }
    ctx.fillStyle = '#f8fafc';
    ctx.font = `800 30px ${FONT_STACK}`;
    ctx.fillText(`${s.count}/${s.capacity}`, x + 545, y + 10);

    ctx.fillStyle = full ? '#86efac' : '#64748b';
    ctx.font = `600 26px ${FONT_STACK}`;
    ctx.textAlign = 'right';
    ctx.fillText(full ? `✓ lleno en ${formatTime(s.completedAtMs)}` : 'sin completar', x + w - 16, y + 13);
    ctx.textAlign = 'left';
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
