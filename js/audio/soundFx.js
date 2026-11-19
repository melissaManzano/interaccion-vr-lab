/**
 * soundFx.js — Sonidos breves SINTETIZADOS con Web Audio API.
 *
 * No hay archivos de audio: no hay descargas, ni 404 posibles, ni licencias.
 * El AudioContext solo puede arrancar tras un gesto del usuario, así que se
 * desbloquea con unlock() en el clic de "Entrar a VR" o en el primer clic.
 * Si el audio falla, la app sigue funcionando: el sonido es retroalimentación opcional.
 */
export function createSoundFx({ volume = 0.25 } = {}) {
  let ctx = null;
  let master = null;

  function ensureContext() {
    if (ctx) return ctx;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    ctx = new AudioCtor();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    return ctx;
  }

  function tone(freq, startOffset, duration, type = 'sine', gain = 1) {
    const c = ensureContext();
    if (!c || c.state !== 'running') return;
    const t0 = c.currentTime + startOffset;
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(env).connect(master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  function safe(fn) {
    return (...args) => {
      try {
        fn(...args);
      } catch (err) {
        console.warn('[audio] No se pudo reproducir el sonido:', err);
      }
    };
  }

  return {
    async unlock() {
      try {
        const c = ensureContext();
        if (c && c.state === 'suspended') await c.resume();
      } catch (err) {
        console.warn('[audio] No se pudo activar el audio:', err);
      }
    },
    /** Acierto: dos notas ascendentes. */
    success: safe(() => { tone(660, 0, 0.12, 'triangle', 0.9); tone(990, 0.1, 0.18, 'triangle', 0.9); }),
    /** Error: una nota grave, corta y discreta. */
    error: safe(() => { tone(196, 0, 0.22, 'square', 0.35); }),
    /** Laboratorio completado: arpegio. */
    complete: safe(() => { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.25, 'triangle', 0.8)); }),
    /** Clic de botón. */
    click: safe(() => { tone(880, 0, 0.05, 'sine', 0.5); }),
    dispose() {
      ctx?.close().catch(() => {});
      ctx = null;
    },
  };
}
