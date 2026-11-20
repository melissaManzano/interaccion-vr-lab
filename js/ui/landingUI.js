/**
 * landingUI.js — Controla la portada HTML (Bootstrap) FUERA de VR.
 *
 * Muestra la compatibilidad, la carga, los errores, las clases y un resumen del
 * progreso. Dentro del visor estos elementos no se ven: allí se usa el panel 3D.
 */
const CHECK_STATES = new Set(['pending', 'ok', 'warn', 'fail']);

export function createLandingUI(doc = document) {
  const byId = (id) => {
    const el = doc.getElementById(id);
    if (!el) throw new Error(`Falta el elemento #${id} en index.html`);
    return el;
  };

  const els = {
    enterButton: byId('btn-enter-vr'),
    enterLabel: byId('btn-enter-label'),
    enterSpinner: byId('btn-enter-spinner'),
    status: byId('xr-status'),
    errorBox: byId('error-box'),
    errorText: byId('error-text'),
    objectives: byId('objectives-list'),
    summaryProgress: byId('summary-progress'),
    summaryErrors: byId('summary-errors'),
    summaryAccuracy: byId('summary-accuracy'),
    summaryPhase: byId('summary-phase'),
    summaryTime: byId('summary-time'),
    summaryBins: byId('summary-bins'),
    previewContainer: byId('preview-container'),
  };

  let lastSummary = '';

  return {
    previewContainer: els.previewContainer,

    setCheck(key, state, detail) {
      const item = doc.getElementById(`chk-${key}`);
      if (!item) return;
      item.dataset.state = CHECK_STATES.has(state) ? state : 'pending';
      const detailEl = item.querySelector('.check-detail');
      if (detailEl) detailEl.textContent = detail;
    },

    setStatus(text) {
      els.status.textContent = text;
    },

    setEnterState({ enabled, label, busy = false }) {
      els.enterButton.disabled = !enabled;
      els.enterButton.setAttribute('aria-busy', String(busy));
      els.enterLabel.textContent = label;
      els.enterSpinner.classList.toggle('d-none', !busy);
    },

    onEnterClick(handler) {
      els.enterButton.addEventListener('click', handler);
    },

    showError(message) {
      els.errorText.textContent = message;
      els.errorBox.classList.remove('d-none');
    },

    clearError() {
      els.errorText.textContent = '';
      els.errorBox.classList.add('d-none');
    },

    setPresenting(presenting) {
      doc.body.classList.toggle('xr-presenting', presenting);
    },

    /** Genera la lista de clases a partir de la MISMA configuración que usa la escena. */
    renderObjectives(classes, bins, perClass) {
      const binByClass = new Map(bins.map((b) => [b.classId, b]));
      els.objectives.replaceChildren(...classes.map((c) => {
        const li = doc.createElement('li');
        li.className = 'objective-item';
        const swatch = doc.createElement('span');
        swatch.className = 'objective-swatch';
        swatch.style.setProperty('--swatch', `#${c.color.toString(16).padStart(6, '0')}`);
        swatch.textContent = c.label;
        swatch.setAttribute('aria-hidden', 'true');
        const text = doc.createElement('span');
        const strong = doc.createElement('strong');
        strong.textContent = `${perClass} × ${c.name} ${c.colorName}`;
        const bin = binByClass.get(c.id);
        text.append(strong, doc.createTextNode(` → recipiente ${c.label} · ${c.plural}${bin ? ` (${bin.id})` : ''}`));
        li.append(swatch, text);
        return li;
      }));
    },

    renderSummary({ progress, errors, accuracy, phase, time, bins }) {
      const binsSignature = bins.map((b) => `${b.count}${b.time}`).join(',');
      const signature = `${progress}|${errors}|${accuracy}|${phase}|${time}|${binsSignature}`;
      if (signature === lastSummary) return;
      lastSummary = signature;
      els.summaryProgress.textContent = progress;
      els.summaryErrors.textContent = errors;
      els.summaryAccuracy.textContent = accuracy;
      els.summaryPhase.textContent = phase;
      els.summaryTime.textContent = time;
      els.summaryBins.replaceChildren(...bins.map((b) => {
        const li = doc.createElement('li');
        li.textContent = `${b.id}: ${b.count}/${b.capacity}${b.time ? ` · lleno en ${b.time}` : ''}`;
        return li;
      }));
    },
  };
}
