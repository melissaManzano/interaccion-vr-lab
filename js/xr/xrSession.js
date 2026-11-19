/**
 * xrSession.js — Detección de capacidades y ciclo de vida de la sesión immersive-vr.
 *
 * Solo se usa 'immersive-vr' (fondo virtual opaco). No se usa immersive-ar,
 * passthrough ni cámaras.
 *
 * 'hand-tracking' se pide como OPCIONAL: si fuera obligatorio y el usuario lo
 * tuviera desactivado, la sesión ni siquiera abriría. Así la sesión abre y el HUD
 * avisa que no hay manos.
 */
export const SESSION_INIT = Object.freeze({
  optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
});

const SUPPORT_CHECK_TIMEOUT_MS = 5000;

/** Rechaza si la promesa no se resuelve a tiempo (algunos navegadores nunca responden). */
function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(message), { name: 'TimeoutError' })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function detectXrSupport() {
  const result = {
    secure: window.isSecureContext === true,
    hasWebXR: 'xr' in navigator,
    vrSupported: false,
    error: null,
  };
  if (!result.hasWebXR) return result;
  try {
    result.vrSupported = await withTimeout(
      navigator.xr.isSessionSupported('immersive-vr'),
      SUPPORT_CHECK_TIMEOUT_MS,
      'El navegador no respondió a la consulta de soporte VR',
    );
  } catch (err) {
    result.error = err;
  }
  return result;
}

/** Convierte errores de WebXR en mensajes comprensibles. */
export function describeXrError(err) {
  const name = err?.name ?? 'Error';
  switch (name) {
    case 'NotSupportedError':
      return 'Este navegador o dispositivo no admite sesiones immersive-vr.';
    case 'SecurityError':
      return 'WebXR requiere HTTPS y que la sesión se inicie con un clic del usuario.';
    case 'NotAllowedError':
      return 'Se negó el permiso para usar realidad virtual. Acepta el permiso del navegador e inténtalo de nuevo.';
    case 'InvalidStateError':
      return 'Ya hay una sesión de VR activa.';
    default:
      return `No se pudo iniciar VR (${name}: ${err?.message ?? 'sin detalles'}).`;
  }
}

export function createXrSessionController({ renderer, onStart, onEnd, onError }) {
  let session = null;
  let starting = false;

  function handleEnd() {
    if (!session) return;
    session.removeEventListener('end', handleEnd);
    session = null;
    try {
      onEnd();
    } catch (err) {
      console.error('[xr] Error al cerrar la sesión:', err);
    }
  }

  async function enter() {
    if (session || starting) return;
    if (!navigator.xr) {
      onError(Object.assign(new Error('navigator.xr no existe'), { name: 'NotSupportedError' }));
      return;
    }
    starting = true;
    let pending = null;
    try {
      pending = await navigator.xr.requestSession('immersive-vr', SESSION_INIT);
      pending.addEventListener('end', handleEnd);
      session = pending;
      await renderer.xr.setSession(pending);
      onStart(pending);
    } catch (err) {
      console.error('[xr] Falló el inicio de sesión:', err);
      if (pending) {
        pending.removeEventListener('end', handleEnd);
        session = null;
        pending.end().catch(() => {});
      }
      onError(err);
    } finally {
      starting = false;
    }
  }

  async function exit() {
    if (!session) return;
    try {
      await session.end();
    } catch (err) {
      console.warn('[xr] La sesión ya había terminado:', err);
      handleEnd();
    }
  }

  return {
    enter,
    exit,
    isActive: () => session !== null,
    dispose() {
      if (session) {
        session.removeEventListener('end', handleEnd);
        session.end().catch(() => {});
        session = null;
      }
    },
  };
}
