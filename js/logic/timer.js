/**
 * timer.js — Cronómetro puro (sin DOM ni Three.js).
 *
 * El tiempo se acumula en tramos, así que se puede pausar al salir de VR
 * y reanudar al volver sin perder lo transcurrido.
 */

export function createTimerState() {
  return { accumulatedMs: 0, runningSince: null };
}

export function startTimer(timer, now) {
  if (timer.runningSince === null) timer.runningSince = now;
}

export function pauseTimer(timer, now) {
  if (timer.runningSince !== null) {
    timer.accumulatedMs += Math.max(0, now - timer.runningSince);
    timer.runningSince = null;
  }
}

export function resetTimer(timer) {
  timer.accumulatedMs = 0;
  timer.runningSince = null;
}

export function isTimerRunning(timer) {
  return timer.runningSince !== null;
}

export function elapsedMs(timer, now) {
  const running = timer.runningSince === null ? 0 : Math.max(0, now - timer.runningSince);
  return timer.accumulatedMs + running;
}

/**
 * Formatea milisegundos como mm:ss o mm:ss.d
 * @param {number} ms
 * @param {boolean} withTenths  incluye décimas de segundo
 */
export function formatTime(ms, withTenths = true) {
  const safe = Number.isFinite(ms) ? Math.max(0, Math.floor(ms)) : 0;
  const minutes = Math.floor(safe / 60000);
  const seconds = Math.floor(safe / 1000) % 60;
  const base = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return withTenths ? `${base}.${Math.floor(safe / 100) % 10}` : base;
}
