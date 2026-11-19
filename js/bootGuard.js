/*
 * bootGuard.js — Script CLÁSICO (no módulo) que se ejecuta antes que main.js.
 *
 * Si el import map no es compatible, el CDN falla o main.js lanza un error,
 * los módulos no muestran nada en pantalla. Este guardián muestra un mensaje
 * útil en la portada en lugar de dejarla congelada en "Cargando…".
 */
(function () {
  'use strict';

  var BOOT_TIMEOUT_MS = 15000;

  function fail(message) {
    var box = document.getElementById('error-box');
    var text = document.getElementById('error-text');
    if (box && text) {
      text.textContent = message;
      box.classList.remove('d-none');
    }
    var label = document.getElementById('btn-enter-label');
    var spinner = document.getElementById('btn-enter-spinner');
    if (label) label.textContent = 'No disponible';
    if (spinner) spinner.classList.add('d-none');
    var status = document.getElementById('xr-status');
    if (status) status.textContent = 'La aplicación no pudo iniciarse. Revisa la consola (F12).';
    var three = document.getElementById('chk-three');
    if (three && three.dataset.state !== 'ok') {
      three.dataset.state = 'fail';
      var detail = three.querySelector('.check-detail');
      if (detail) detail.textContent = 'No se pudo cargar';
    }
  }

  window.labBootGuard = { fail: fail };

  document.addEventListener('DOMContentLoaded', function () {
    var supportsImportMap = typeof HTMLScriptElement !== 'undefined'
      && typeof HTMLScriptElement.supports === 'function'
      && HTMLScriptElement.supports('importmap');
    if (!supportsImportMap) {
      fail('Tu navegador no admite import maps. Usa una versión reciente de Chrome, Edge o Meta Quest Browser.');
      return;
    }
    window.setTimeout(function () {
      if (!window.__labBooted) {
        fail('La aplicación tardó demasiado en cargar. Revisa tu conexión y la pestaña Network (posible fallo del CDN de Three.js).');
      }
    }, BOOT_TIMEOUT_MS);
  });
})();
