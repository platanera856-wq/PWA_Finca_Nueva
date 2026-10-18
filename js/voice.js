// Voz en español. El reconocimiento del navegador puede necesitar internet; el motor offline aún no está incluido.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let activeRecognition = null;
  let welcomePlayed = false;
  const greetings = [
    'Gracias por su trabajo.',
    'Su labor es importante.',
    'Gracias por cuidar la finca.',
    'Vamos a registrar su labor.',
    'Gracias por su esfuerzo.',
    'Su trabajo cuenta.',
    'Bienvenido. Empecemos.',
    'Gracias por su dedicación.'
  ];
  function status(message) { const el = $('voice-status'); if (el) el.textContent = message; }
  function getVoice() {
    if (!('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices() || [];
    return voices.find(v => /^es-CO$/i.test(v.lang)) || voices.find(v => /^es(-|$)/i.test(v.lang)) || null;
  }
  function supportsRecognition() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }
  function supportsSpeechOutput() { return ('speechSynthesis' in window) && typeof SpeechSynthesisUtterance === 'function'; }
  function say(text, opts = {}) {
    return new Promise(resolve => {
      if (!supportsSpeechOutput()) { status('Este navegador no ofrece salida de voz.'); resolve(false); return; }
      let settled = false;
      let watchdog = null;
      const finish = ok => { if (settled) return; settled = true; if (watchdog) clearTimeout(watchdog); resolve(ok); };
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(String(text || '').trim());
        utterance.lang = 'es-CO'; utterance.rate = 0.92; utterance.pitch = 1; utterance.volume = 1;
        const voice = getVoice(); if (voice) utterance.voice = voice;
        utterance.onstart = () => { if (opts.onStart) opts.onStart(); };
        utterance.onend = () => finish(true);
        utterance.onerror = e => { if (!opts.silentError) status('No se pudo reproducir el audio (' + ((e && e.error) || 'error') + ').'); finish(false); };
        window.speechSynthesis.speak(utterance);
        watchdog = setTimeout(() => finish(false), Math.min(10000, Math.max(3000, String(text).length * 90 + 1700)));
      } catch (_) { finish(false); }
    });
  }
  // acceptCandidate permite seleccionar una alternativa de reconocimiento que coincida
  // con un catálogo o que contenga un número válido, y no quedarse con la primera transcripción errónea.
  function listen(timeoutMs = 25000, acceptCandidate = null) {
    return new Promise((resolve, reject) => {
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition) { reject(new Error('Este navegador no ofrece reconocimiento de voz.')); return; }
      if (activeRecognition) { try { activeRecognition.abort(); } catch (_) {} activeRecognition = null; }
      const rec = new Recognition(); activeRecognition = rec;
      rec.lang = 'es-CO'; rec.continuous = false; rec.interimResults = false; rec.maxAlternatives = 5;
      let done = false, gotText = false;
      const timer = setTimeout(() => finish(new Error('No se escuchó una respuesta.')), timeoutMs);
      function finish(err, text) {
        if (done) return; done = true; clearTimeout(timer);
        if (activeRecognition === rec) activeRecognition = null;
        try { rec.abort(); } catch (_) {}
        if (err) reject(err); else resolve(text);
      }
      rec.onstart = () => status('Escuchando…');
      rec.onresult = event => {
        const result = event.results && event.results[event.results.length - 1];
        if (!result || !result.isFinal) return;
        const candidates = Array.from(result).map(item => String(item.transcript || '').trim()).filter(Boolean);
        if (!candidates.length) return;
        gotText = true;
        let chosen = candidates[0];
        if (typeof acceptCandidate === 'function') {
          try { chosen = candidates.find(candidate => acceptCandidate(candidate)) || candidates[0]; }
          catch (_) { chosen = candidates[0]; }
        }
        finish(null, chosen);
      };
      rec.onerror = event => {
        const err = event && event.error;
        if (err === 'not-allowed' || err === 'service-not-allowed') finish(new Error('El micrófono está bloqueado. Permita su uso para este sitio.'));
        else if (err === 'audio-capture') finish(new Error('No se encontró un micrófono disponible.'));
        else if (err === 'network') finish(new Error('El reconocimiento de voz necesita internet en este navegador.'));
        else if (err === 'no-speech') finish(new Error('No se escuchó una respuesta.'));
        else finish(new Error('No se pudo reconocer la voz (' + (err || 'error') + ').'));
      };
      rec.onend = () => { if (!gotText) finish(new Error('No se escuchó una respuesta.')); };
      try { rec.start(); } catch (e) { finish(new Error('No se pudo iniciar el micrófono.')); }
    });
  }
  function normalize(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9,.\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const smallNumbers = {
    cero:0,un:1,uno:1,una:1,dos:2,tres:3,cuatro:4,cinco:5,sinco:5,sinko:5,cinko:5,seis:6,siete:7,ocho:8,nueve:9,diez:10,
    once:11,doce:12,trece:13,catorce:14,quince:15,dieciseis:16,diecisiete:17,dieciocho:18,diecinueve:19,
    veinte:20,veintiuno:21,veintiun:21,veintiuna:21,veintidos:22,veintitres:23,veinticuatro:24,veinticinco:25,veintiseis:26,veintisiete:27,veintiocho:28,veintinueve:29,
    treinta:30,cuarenta:40,cincuenta:50,sesenta:60,setenta:70,ochenta:80,noventa:90,
    cien:100,ciento:100,doscientos:200,trescientos:300,cuatrocientos:400,quinientos:500,seiscientos:600,setecientos:700,ochocientos:800,novecientos:900,mil:1000,
    media:0.5,medio:0.5
  };
  function parseIntegerWords(section) {
    const tokens = normalize(section).split(' ').filter(t => t && t !== 'y' && !['hora','horas','planta','plantas','mata','matas','kilo','kilos','kilogramo','kilogramos','gramos','litros','galones','unidad','unidades','cc'].includes(t));
    if (!tokens.length) return null;
    let total = 0, current = 0, found = false;
    for (const token of tokens) {
      if (!(token in smallNumbers)) return null;
      found = true; const n = smallNumbers[token];
      if (n === 100) current = (current || 1) * 100;
      else if (n === 1000) { total += (current || 1) * 1000; current = 0; }
      else current += n;
    }
    return found ? total + current : null;
  }
  function parseNumber(text) {
    let raw = normalize(text)
      .replace(/\b(horas?|plantas?|matas?|kilos?|kilogramos?|gramos?|unidades?|litros?|cc|galones?)\b/g, '')
      .replace(/\b(sinco|sinko|cinko)\b/g, 'cinco').trim();
    const numeric = raw.match(/\d+(?:[.,]\d+)?/);
    if (numeric) return Number(numeric[0].replace(',', '.'));
    // 
    // Admite "dos coma cinco" y "dos y media".
    const decimal = raw.split(/\b(?:coma|punto)\b/);
    if (decimal.length > 1) {
      const integer = parseIntegerWords(decimal[0]);
      const fractionTokens = normalize(decimal.slice(1).join(' ')).split(' ').filter(Boolean);
      if (integer === null || !fractionTokens.length || fractionTokens.some(t => !(t in smallNumbers) || smallNumbers[t] < 0 || smallNumbers[t] > 9)) return null;
      return Number(String(integer) + '.' + fractionTokens.map(t => smallNumbers[t]).join(''));
    }
    const half = /\by\s+media\b/.test(raw) || /\bmedia\b/.test(raw) || /\bmedio\b/.test(raw);
    if (half) {
      const withoutHalf = raw.replace(/\by\s+media\b/g, '').replace(/\bmedia\b/g, '').replace(/\bmedio\b/g, '').trim();
      const base = parseIntegerWords(withoutHalf);
      return base === null ? 0.5 : base + 0.5;
    }
    return parseIntegerWords(raw);
  }
  async function welcome() {
    if (welcomePlayed) return true;
    const phrase = greetings[Math.floor(Math.random() * greetings.length)];
    const ok = await say(phrase, {silentError:true});
    if (ok) welcomePlayed = true;
    return ok;
  }
  function yesNo(text) {
    const s = normalize(text);
    if (/\b(no|ninguno|ninguna|ningun|nada|no use|no utilice|no quiero|cancelar)\b/.test(s)) return false;
    if (/\b(si|claro|correcto|afirmativo|utilice|use|listo|guardar|guarde|de acuerdo)\b/.test(s)) return true;
    return null;
  }
  window.FincaVoice = { say, listen, parseNumber, normalize, yesNo, welcome, status, supportsRecognition, supportsSpeechOutput };
})();
