// Lector QR local. Requiere ./js/html5-qrcode.min.js, servido desde GitHub Pages.
// Al abrir la PWA intenta iniciar cámara y lectura automáticamente; el botón sirve para reintentar.
(() => {
  'use strict';
  let qrScanner = null;
  let scannerStarting = false;
  let scanHandled = false;
  let lastStatus = '';
  const $ = (id) => document.getElementById(id);

  function setStatus(message) {
    lastStatus = message;
    const el = $('qr-status');
    if (el) el.textContent = message;
  }

  async function stopScanner(hideArea = true) {
    const scanner = qrScanner;
    qrScanner = null;
    if (scanner) {
      try { if (scanner.isScanning) await scanner.stop(); } catch (_) {}
      try { await scanner.clear(); } catch (_) {}
    }
    if (hideArea) {
      const area = $('qr-area');
      if (area) area.hidden = true;
    }
  }

  function insertQr(decodedText) {
    const field = document.querySelector('#record-form [name="caballon"]');
    const value = String(decodedText || '').trim();
    if (!field || !value) return false;
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  async function startScanner(source = 'automatic') {
    const area = $('qr-area');
    const reader = $('qr-reader');
    if (!area || !reader || scannerStarting || (qrScanner && qrScanner.isScanning)) return;
    scannerStarting = true;
    scanHandled = false;
    area.hidden = false;
    setStatus(source === 'automatic' ? 'Iniciando cámara y lector QR…' : 'Preparando cámara y lector QR…');

    if (!window.isSecureContext) {
      setStatus('La cámara necesita HTTPS. Abra la aplicación desde su dirección segura de GitHub Pages.');
      scannerStarting = false;
      return;
    }
    if (typeof window.Html5Qrcode !== 'function') {
      setStatus('No se cargó el lector QR local. Compruebe que js/html5-qrcode.min.js esté publicado.');
      scannerStarting = false;
      return;
    }

    try {
      qrScanner = new window.Html5Qrcode('qr-reader');
      await qrScanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: (w, h) => {
            const side = Math.min(w, h);
            const size = Math.max(150, Math.min(280, Math.floor(side * 0.7)));
            return { width: size, height: size };
          },
          aspectRatio: 1.0
        },
        async (decodedText) => {
          if (scanHandled) return;
          scanHandled = true;
          const value = String(decodedText || '').trim();
          const inserted = insertQr(value);
          setStatus(inserted ? `QR leído. Caballón / lote: ${value}` : `QR leído (${value}), pero no se encontró el campo Caballón / lote.`);
          await stopScanner(false);
        },
        () => { /* No detectar un QR en un fotograma es normal. */ }
      );
      setStatus('Cámara activa. Apunte al QR; al leerlo se llenará Caballón / lote.');
    } catch (error) {
      const detail = error && error.message ? error.message : String(error || 'Error desconocido');
      const normalized = detail.toLowerCase();
      if (normalized.includes('notfound') || normalized.includes('requested device not found')) {
        setStatus('No se encontró una cámara en este dispositivo. Pruebe desde el teléfono o conecte una cámara.');
      } else {
        setStatus(`No se pudo iniciar cámara/QR: ${detail}. Revise el permiso de cámara o pulse Reintentar.`);
      }
      await stopScanner(false);
    } finally {
      scannerStarting = false;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const retry = $('qr-btn');
    const close = $('stop-camera');
    if (retry) retry.addEventListener('click', () => { void startScanner('manual'); });
    if (close) close.addEventListener('click', async () => {
      await stopScanner(true);
      setStatus('Cámara cerrada. Puede volver a abrirla con Reintentar cámara / QR.');
    });
    // Intento automático como solicita la aplicación original. El navegador todavía puede requerir permiso.
    window.addEventListener('load', () => {
      window.setTimeout(() => { void startScanner('automatic'); }, 500);
    }, { once: true });
    window.addEventListener('pagehide', () => { void stopScanner(true); });
  });
  window.FincaCamera = { start: () => startScanner('manual'), stop: () => stopScanner(true), status: () => lastStatus };
})();
