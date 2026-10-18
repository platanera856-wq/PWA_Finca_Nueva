/* Puente JSONP de GitHub Pages a Apps Script. No usa google.script.run ni requiere CORS. */
(() => {
  'use strict';
  let sequence = 0;
  function call(method, payload = null, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const base = window.FINCA_CONFIG && window.FINCA_CONFIG.gasWebAppUrl;
      if (!base || !/\/exec(?:\?|$)/.test(base)) return reject(new Error('Falta una URL de Apps Script terminada en /exec.'));
      const callback = '__fincaJsonp_' + Date.now() + '_' + (++sequence);
      const script = document.createElement('script');
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        try { delete window[callback]; } catch (_) { window[callback] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      };
      const finishError = error => { if (settled) return; settled = true; cleanup(); reject(error instanceof Error ? error : new Error(String(error))); };
      const timer = setTimeout(() => finishError(new Error('Apps Script no respondió a tiempo. Compruebe internet y permisos de la implementación.')), timeoutMs);
      window[callback] = data => {
        if (settled) return;
        settled = true; cleanup();
        if (!data || data.__error || data.exito === false) reject(new Error(data && (data.mensaje || data.message) || 'Apps Script devolvió un error.'));
        else resolve(data);
      };
      script.onerror = () => finishError(new Error('No se pudo cargar la respuesta de Apps Script.'));
      let url = base + (base.includes('?') ? '&' : '?') + 'api=' + encodeURIComponent(method) + '&callback=' + encodeURIComponent(callback);
      if (payload !== null && payload !== undefined) url += '&payload=' + encodeURIComponent(JSON.stringify(payload));
      script.src = url;
      document.head.appendChild(script);
    });
  }
  window.FincaAPI = { call };
})();
