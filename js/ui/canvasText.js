/**
 * canvasText.js — Utilidades para dibujar texto en <canvas> y usarlo como textura.
 *
 * En VR no existe el DOM: todo texto visible dentro del visor debe dibujarse
 * en un canvas y aplicarse como textura sobre una geometría.
 */
import * as THREE from 'three';

export const FONT_STACK = 'system-ui, "Segoe UI", Roboto, Arial, sans-serif';

/** Traza un rectángulo con esquinas redondeadas (sin depender de ctx.roundRect). */
export function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Divide un texto en líneas que caben en maxWidth. */
export function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function create2dCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo crear un contexto 2D de canvas.');
  return { canvas, ctx };
}

/**
 * Crea una textura con una etiqueta de texto centrada.
 * @param {object} o
 * @param {'rect'|'circle'} [o.shape]
 */
export function createLabelTexture({
  text, width = 256, height = 96, background = '#0f172a', color = '#ffffff',
  font = `700 48px ${FONT_STACK}`, shape = 'rect', radius = 20, border = null,
}) {
  const { canvas, ctx } = create2dCanvas(width, height);
  ctx.fillStyle = background;
  if (shape === 'circle') {
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, Math.min(width, height) / 2 - 2, 0, Math.PI * 2);
  } else {
    roundRectPath(ctx, 2, 2, width - 4, height - 4, radius);
  }
  ctx.fill();
  if (border) {
    ctx.lineWidth = 6;
    ctx.strokeStyle = border;
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // El 4.º argumento (maxWidth) comprime el texto si no cabe, en lugar de cortarlo.
  ctx.fillText(text, width / 2, height / 2 + 2, width - 28);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
