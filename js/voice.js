// Voz de bienvenida y dictado asistido mediante las funciones de voz disponibles en el navegador.
// Importante: SpeechRecognition del navegador NO garantiza reconocimiento sin conexión.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let speaking = false;
  let lastField = null;
  let recognition = null;

  const greetings = [
    'Gracias por el esfuerzo que pone cada día en la finca. Vamos a registrar la labor.',
    'Su trabajo es importante para el resultado de la cosecha. Empecemos el registro.',
    'Cada labor cuenta. Gracias por su dedicación; vamos a registrar la jornada.',
    'Su experiencia hace la diferencia en la finca. Comencemos.',
    'Gracias por cuidar cada detalle del cultivo. Registremos la labor.',
    'Su esfuerzo sostiene el trabajo del campo. Iniciemos el registro.',
    'La calidad de la cosecha empieza con su labor. Vamos a comenzar.',
    'Gracias por su compromiso con la finca. Registremos lo realizado.'
  ];

  function status(message) {
    const el = $('voice-status');
    if (el) el.textContent = message;
  }

  function getSpanishVoice() {
    if (!('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices() || [];
    return voices.find(v => /^es-CO$/i.test(v.lang))
      || voices.find(v => /^es(-|$)/i.test(v.lang))
      || null;
  }

  function say(text, options = {}) {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance !== 'function') {
        status('Este navegador no ofrece voz hablada.');
        resolve(false);
        return;
      }
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(String(text));
        utterance.lang = 'es-CO';
        utterance.rate = options.rate || 0.92;
        utterance.pitch = 1;
        const voice = getSpanishVoice();
        if (voice) utterance.voice = voice;
        speaking = true;
        utterance.onstart = () => { speaking = true; if (options.onStart) options.onStart(); };
        utterance.onend = () => { speaking = false; if (options.onEnd) options.onEnd(); resolve(true); };
        utterance.onerror = (event) => {
          speaking = false;
          if (!options.silentError) status(`No se pudo reproducir la voz (${event.error || 'error de audio'}). Se intentará continuar con el micrófono.`);
          if (options.onEnd) options.onEnd();
          resolve(false);
        };
        window.speechSynthesis.speak(utterance);
        // Algunos navegadores no disparan onstart si la salida de voz está deshabilitada.
        window.setTimeout(() => { if (speaking && window.speechSynthesis.speaking) return; }, 1500);
      } catch (error) {
        speaking = false;
        status(`No se pudo activar la voz: ${error.message || error}`);
        resolve(false);
      }
    });
  }

  function rememberField(event) {
    const target = event.target;
    if (target && target.matches && target.matches('#record-form input:not([type="date"]), #record-form textarea')) lastField = target;
  }

  function targetField() {
    const active = document.activeElement;
    if (active && active.matches && active.matches('#record-form input:not([type="date"]), #record-form textarea')) return active;
    if (lastField && document.contains(lastField)) return lastField;
    return $('record-form')?.elements?.observaciones || null;
  }

  function startDictation() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const field = targetField();
    if (!field) { status('No se encontró el campo que recibirá el dictado.'); return; }
    if (!SR) {
      status('Este navegador no ofrece reconocimiento de voz compatible. La voz hablada puede funcionar, pero para escuchar necesita un motor de reconocimiento.');
      void say('Este navegador no puede escuchar el dictado. Puede escribir el dato en el campo seleccionado.');
      return;
    }
    if (recognition) {
      try { recognition.abort(); } catch (_) {}
      recognition = null;
    }
    const label = field.labels && field.labels[0] ? field.labels[0].childNodes[0].textContent.trim() : 'campo seleccionado';
    status(`Preparando dictado para: ${label}.`);
    void say(`Diga el dato para ${label}.`, {
      onEnd: () => {
        try {
          recognition = new SR();
          recognition.lang = 'es-CO';
          recognition.continuous = false;
          recognition.interimResults = false;
          recognition.maxAlternatives = 3;
          recognition.onstart = () => status(`Escuchando para «${label}». Hable ahora.`);
          recognition.onresult = (event) => {
            const recognized = event.results?.[0]?.[0]?.transcript?.trim();
            if (!recognized) { status('No se reconoció la respuesta. Vuelva a intentarlo.'); return; }
            if (field.type === 'number') {
              const number = parseSpokenNumber(recognized);
              field.value = number === null ? recognized : String(number);
            } else {
              field.value = field.value ? `${field.value} ${recognized}`.trim() : recognized;
            }
            field.dispatchEvent(new Event('input', { bubbles: true }));
            field.dispatchEvent(new Event('change', { bubbles: true }));
            status(`Reconocido: ${recognized}`);
          };
          recognition.onerror = (event) => status(`Error al escuchar (${event.error || 'desconocido'}). El dictado del navegador puede necesitar internet y permiso de micrófono.`);
          recognition.onend = () => { recognition = null; };
          recognition.start();
        } catch (error) {
          recognition = null;
          status(`No fue posible iniciar el micrófono: ${error.message || error}. Revise el permiso del micrófono.`);
        }
      }
    });
  }

  function parseSpokenNumber(value) {
    const s = String(value).toLowerCase().trim().replace(/\./g, '').replace(',', '.');
    if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
    const words = { cero:0, uno:1, una:1, un:1, dos:2, tres:3, cuatro:4, cinco:5, seis:6, siete:7, ocho:8, nueve:9, diez:10, once:11, doce:12, trece:13, catorce:14, quince:15, dieciseis:16, dieciséis:16, diecisiete:17, dieciocho:18, diecinueve:19, veinte:20, treinta:30, cuarenta:40, cincuenta:50, sesenta:60, setenta:70, ochenta:80, noventa:90, cien:100, ciento:100 };
    const parts = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/).filter(Boolean);
    if (!parts.length || parts.some(p => !(p in words) && p !== 'y')) return null;
    let total = 0;
    let current = 0;
    for (const p of parts) {
      if (p === 'y') continue;
      const n = words[p];
      if (n === undefined) return null;
      if (n === 100) current = (current || 1) * 100;
      else if (n >= 20 && n % 10 === 0) current += n;
      else current += n;
    }
    total += current;
    return Number.isFinite(total) ? total : null;
  }

  function welcome() {
    if (sessionStorage.getItem('welcome-attempted')) return;
    sessionStorage.setItem('welcome-attempted', '1');
    const text = greetings[Math.floor(Math.random() * greetings.length)];
    // Intento automático; Chrome/Android puede requerir interacción antes de permitir audio.
    void say(text, { silentError: true }).then(ok => {
      if (!ok) status('La bienvenida por voz no se pudo reproducir automáticamente. Pulse «Dictar en el campo seleccionado» para probar el audio y el micrófono.');
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const form = $('record-form');
    const button = $('voice-btn');
    if (form) form.addEventListener('focusin', rememberField);
    if (button) button.addEventListener('click', () => {
      // Este clic del usuario también sirve para probar audio en navegadores que bloquean reproducción automática.
      void say('Voz activada. Preparando el dictado.', { onEnd: startDictation });
    });
    window.addEventListener('load', () => window.setTimeout(welcome, 700), { once: true });
  });

  window.FincaVoice = { say, startDictation, welcome };
})();
