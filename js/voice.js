// Síntesis y reconocimiento de voz en español. SpeechRecognition del navegador no garantiza modo sin internet.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let activeRecognition = null;
  let welcomePlayed = false;
  let currentGreeting = null;
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
  function status(message) { const el = $('voice-status'); if (el) el.textContent = message; }
  function getVoice() {
    if (!('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices() || [];
    return voices.find(v => /^es-CO$/i.test(v.lang)) || voices.find(v => /^es(-|$)/i.test(v.lang)) || null;
  }
  function say(text, opts = {}) {
    return new Promise(resolve => {
      if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance !== 'function') {
        status('Este navegador no ofrece salida de voz. Puede completar el formulario escribiendo.'); resolve(false); return;
      }
      let settled = false;
      const finish = ok => { if (settled) return; settled = true; clearTimeout(watchdog); resolve(ok); };
      let watchdog;
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(String(text));
        utterance.lang = 'es-CO'; utterance.rate = opts.rate || 0.9; utterance.pitch = 1;
        const voice = getVoice(); if (voice) utterance.voice = voice;
        utterance.onstart = () => { if (opts.onStart) opts.onStart(); };
        utterance.onend = () => finish(true);
        utterance.onerror = e => { if (!opts.silentError) status('No se pudo reproducir el audio (' + (e.error || 'error') + ').'); finish(false); };
        window.speechSynthesis.speak(utterance);
        watchdog = setTimeout(() => finish(false), Math.min(25000, Math.max(6000, String(text).length * 120)));
      } catch (e) { finish(false); }
    });
  }
  function listen(timeoutMs = 25000) {
    return new Promise((resolve, reject) => {
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition) { reject(new Error('Este navegador no ofrece reconocimiento de voz. Use los campos de pantalla o pruebe Chrome en Android.')); return; }
      if (activeRecognition) { try { activeRecognition.abort(); } catch (_) {} activeRecognition = null; }
      const rec = new Recognition(); activeRecognition = rec;
      rec.lang = 'es-CO'; rec.continuous = false; rec.interimResults = false; rec.maxAlternatives = 4;
      let done = false, gotText = false;
      const timer = setTimeout(() => finish(new Error('Se agotó el tiempo de espera para responder.')), timeoutMs);
      function finish(err, text) {
        if (done) return; done = true; clearTimeout(timer);
        if (activeRecognition === rec) activeRecognition = null;
        try { rec.abort(); } catch (_) {}
        if (err) reject(err); else resolve(text);
      }
      rec.onstart = () => status('Escuchando… hable ahora, sin acercarse demasiado al micrófono.');
      rec.onresult = event => {
        const text = event.results && event.results[0] && event.results[0][0] && event.results[0][0].transcript;
        if (text && text.trim()) { gotText = true; status('Respuesta reconocida: ' + text.trim()); finish(null, text.trim()); }
      };
      rec.onerror = event => finish(new Error(event.error === 'not-allowed' ? 'El micrófono está bloqueado. Permita el micrófono para este sitio.' : 'No se pudo reconocer la voz (' + (event.error || 'error') + ').'));
      rec.onend = () => { if (!gotText) finish(new Error('No se detectó una respuesta.')); };
      try { rec.start(); } catch (e) { finish(new Error('No se pudo iniciar el micrófono: ' + (e.message || e))); }
    });
  }
  function normalize(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9,.\s]/g, ' ').replace(/\s+/g, ' ').trim(); }
  const smallNumbers = {cero:0,un:1,uno:1,una:1,dos:2,tres:3,cuatro:4,cinco:5,seis:6,siete:7,ocho:8,nueve:9,diez:10,once:11,doce:12,trece:13,catorce:14,quince:15,dieciseis:16,diecisiete:17,dieciocho:18,diecinueve:19,veinte:20,veintiuno:21,veintiun:21,veintiuna:21,veintidos:22,veintitres:23,veinticuatro:24,veinticinco:25,veintiseis:26,veintisiete:27,veintiocho:28,veintinueve:29,treinta:30,cuarenta:40,cincuenta:50,sesenta:60,setenta:70,ochenta:80,noventa:90,cien:100,ciento:100,doscientos:200,trescientos:300,cuatrocientos:400,quinientos:500,seiscientos:600,setecientos:700,ochocientos:800,novecientos:900,mil:1000};
  function parseNumber(text) {
    const raw = normalize(text).replace(/\b(horas?|plantas?|matas?|kilos?|kilogramos?|gramos?|unidades?|litros?|cc|galones?)\b/g, '').trim();
    const numeric = raw.match(/\d+(?:[.,]\d+)?/);
    if (numeric) return Number(numeric[0].replace(',', '.'));
    const decimal = raw.split(/\b(?:coma|punto)\b/);
    const parseIntegerWords = section => {
      const tokens = normalize(section).split(' ').filter(t => t && t !== 'y');
      if (!tokens.length) return null;
      let total = 0, current = 0;
      for (const token of tokens) {
        if (!(token in smallNumbers)) return null;
        const n = smallNumbers[token];
        if (n === 100) current = (current || 1) * 100;
        else if (n === 1000) { total += (current || 1) * 1000; current = 0; }
        else current += n;
      }
      return total + current;
    };
    if (decimal.length > 1) {
      const integer = parseIntegerWords(decimal[0]);
      const fractionTokens = normalize(decimal.slice(1).join(' ')).split(' ').filter(Boolean);
      if (integer === null || !fractionTokens.length || fractionTokens.some(x => !(x in smallNumbers) || smallNumbers[x] > 9)) return null;
      const fraction = fractionTokens.map(x => smallNumbers[x]).join('');
      return Number(String(integer) + '.' + fraction);
    }
    return parseIntegerWords(raw);
  }
  async function welcome() {
    if (welcomePlayed) return true;
    if (!currentGreeting) currentGreeting = greetings[Math.floor(Math.random() * greetings.length)];
    const ok = await say(currentGreeting, {silentError:true});
    if (ok) welcomePlayed = true;
    return ok;
  }
  function yesNo(text) {
    const s = normalize(text);
    if (/\b(no|ninguno|ninguna|ningun|nada|no use|no utilice)\b/.test(s)) return false;
    if (/\b(si|claro|correcto|afirmativo|utilice|use)\b/.test(s)) return true;
    return null;
  }
  window.FincaVoice = { say, listen, parseNumber, normalize, yesNo, welcome, status };
})();
