// Lector QR local con html5-qrcode. La biblioteca debe estar en ./js/html5-qrcode.min.js.
// Cuando se detecta un QR, su contenido se copia al campo "Caballón / lote".
(() => {
  'use strict';

  let qrScanner = null;
  let scannerStarting = false;
  let scanHandled = false;

  const $ = (id) => document.getElementById(id);

  function setStatus(message) {
    const status = $('qr-status');
    if (status) status.textContent = message;
  }

  async function stopScanner(hideArea = true) {
    const scanner = qrScanner;
    qrScanner = null;

    if (scanner) {
      try {
        if (scanner.isScanning) await scanner.stop();
      } catch (error) {
        // Puede que el escáner ya se haya detenido; continuamos con la limpieza.
      }
      try {
        await scanner.clear();
      } catch (error) {
        // No impedimos cerrar la interfaz si la biblioteca ya limpió el visor.
      }
    }

    if (hideArea) {
      const area = $('qr-area');
      if (area) area.hidden = true;
    }
  }

  function putQrIntoCaballon(decodedText) {
    const field = document.querySelector('#record-form [name="caballon"]');
    const value = String(decodedText || '').trim();
    if (field && value) {
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const qrButton = $('qr-btn');
    const stopButton = $('stop-camera');
    const area = $('qr-area');
    const reader = $('qr-reader');

    if (!qrButton || !stopButton || !area || !reader) {
      console.error('Lector QR: faltan elementos requeridos en index.html.');
      return;
    }

    qrButton.addEventListener('click', async () => {
      if (scannerStarting || (qrScanner && qrScanner.isScanning)) return;

      area.hidden = false;
      setStatus('Preparando cámara…');

      if (!window.isSecureContext) {
        setStatus('La cámara requiere una dirección HTTPS o localhost. Abra la PWA desde GitHub Pages con HTTPS.');
        return;
      }

      if (typeof window.Html5Qrcode !== 'function') {
        setStatus('No se cargó la biblioteca QR local. Revise que js/html5-qrcode.min.js exista y se haya publicado en GitHub Pages.');
        return;
      }

      scannerStarting = true;
      scanHandled = false;

      try {
        qrScanner = new window.Html5Qrcode('qr-reader');
        setStatus('Solicitando permiso de cámara…');

        await qrScanner.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const shortestSide = Math.min(viewfinderWidth, viewfinderHeight);
              const boxSize = Math.max(150, Math.min(280, Math.floor(shortestSide * 0.7)));
              return { width: boxSize, height: boxSize };
            },
            aspectRatio: 1.0
          },
          async (decodedText) => {
            if (scanHandled) return;
            scanHandled = true;

            const wasInserted = putQrIntoCaballon(decodedText);
            const cleanValue = String(decodedText || '').trim();
            setStatus(wasInserted
              ? `QR leído correctamente. Caballón / lote: ${cleanValue}`
              : `QR leído: ${cleanValue}. No se encontró el campo Caballón / lote.`);

            // Detener la cámara tras una lectura correcta, sin ocultar el resultado.
            await stopScanner(false);
          },
          () => {
            // Los errores de cada fotograma son normales mientras se busca un QR.
          }
        );

        setStatus('Cámara activa. Apunte al código QR y manténgalo dentro del recuadro.');
      } catch (error) {
        const detail = error && error.message ? error.message : String(error || 'Error desconocido');
        setStatus(`No se pudo iniciar la cámara o el lector QR: ${detail}. Revise los permisos y que otra aplicación no esté usando la cámara.`);
        await stopScanner(false);
      } finally {
        scannerStarting = false;
      }
    });

    stopButton.addEventListener('click', async () => {
      await stopScanner(true);
      setStatus('Cámara cerrada.');
    });

    window.addEventListener('pagehide', () => {
      void stopScanner(true);
    });
  });
})();
