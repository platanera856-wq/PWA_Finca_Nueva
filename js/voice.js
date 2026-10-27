(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let welcomePlayed = false;
  let audioUnlocked = false;
  let firstVoiceListCheck = false;
  const greetings = ['Gracias por su trabajo.','Su labor es importante.','Gracias por cuidar la finca.','Vamos a registrar su labor.','Gracias por su esfuerzo.','Su trabajo cuenta.','Bienvenido. Empecemos.','Gracias por su dedicación.'];
  
  function status(message) { const el = $('voice-status'); if (el) el.textContent = message; }
  
  function supportsRecognition() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }
  function supportsSpeechOutput() { return ('speechSynthesis' in window) && typeof SpeechSynthesisUtterance === 'function'; }
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  function unlockAudio() {
    if (audioUnlocked || !supportsSpeechOutput()) return audioUnlocked;
    try {
      const synth = window.speechSynthesis;
      synth.getVoices();
      const unlock = new SpeechSynthesisUtterance(' ');
      unlock.lang = 'es-CO'; unlock.volume = 0; unlock.rate = 1;
      unlock.onstart = () => { audioUnlocked = true; };
      unlock.onend = () => { audioUnlocked = true; };
      unlock.onerror = () => {};
      synth.speak(unlock);
      audioUnlocked = true;
      return true;
    } catch (error) { return false; }
  }

  async function loadAvailableVoices() {
    if (!supportsSpeechOutput()) return [];
    let voices = window.speechSynthesis.getVoices() || [];
    if (voices.length || firstVoiceListCheck) return voices;
    firstVoiceListCheck = true;
    await new Promise(resolve => {
      let settled = false;
      const finish = () => { if (settled) return; settled = true; try { window.speechSynthesis.removeEventListener('voiceschanged', finish); } catch (_) {} resolve(); };
      try { window.speechSynthesis.addEventListener('voiceschanged', finish); } catch (_) {}
      setTimeout(finish, 900);
    });
    return window.speechSynthesis.getVoices() || [];
  }

  function say(text, opts = {}) {
    return new Promise(resolve => {
      if (!supportsSpeechOutput()) { resolve(false); return; }
      let settled = false;
      let watchdog = null;
      const phrase = String(text || '').trim();
      const finish = ok => { if (settled) return; settled = true; if (watchdog) clearTimeout(watchdog); resolve(ok); };
      if (!phrase) { finish(true); return; }
      (async () => {
        try {
          const synth = window.speechSynthesis;
          const voices = await loadAvailableVoices();
          if (synth.speaking || synth.pending) { synth.cancel(); await wait(140); }
          try { synth.resume(); } catch (_) {}
          const utterance = new SpeechSynthesisUtterance(phrase);
          utterance.lang = 'es-CO'; utterance.rate = 0.90; utterance.pitch = 1; utterance.volume = 1;
          const spanish = voices.find(v => /^es-CO$/i.test(v.lang)) || voices.find(v => /^es(-|$)/i.test(v.lang));
          if (spanish) { utterance.voice = spanish; utterance.lang = spanish.lang || 'es-CO'; }
          utterance.onstart = () => { audioUnlocked = true; if (opts.onStart) opts.onStart(); };
          utterance.onend = () => finish(true);
          utterance.onerror = () => { finish(false); };
          watchdog = setTimeout(() => finish(false), Math.min(16000, Math.max(5000, phrase.length * 145 + 3000)));
          await wait(80);
          synth.speak(utterance);
        } catch (error) { finish(false); }
      })();
    });
  }

  function listenBrowser(timeoutMs = 25000, acceptCandidate = null) {
    return new Promise((resolve, reject) => {
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition) { reject(new Error('El reconocimiento de voz no está disponible en este navegador. Use el teclado.')); return; }
      const rec = new Recognition();
      rec.lang = 'es-CO'; rec.continuous = false; rec.interimResults = true; rec.maxAlternatives = 5;
      let done = false, gotText = false, latestInterim = '';
      let silenceTimer = null;
      let responseTimer = null;
      let startTimer = setTimeout(() => finish(new Error('El reconocimiento de voz no inició. Revise el permiso del micrófono.')), 7000);
      
      function finish(err, text) {
        if (done) return;
        done = true;
        if (startTimer) clearTimeout(startTimer);
        if (responseTimer) clearTimeout(responseTimer);
        if (silenceTimer) clearTimeout(silenceTimer);
        try { rec.abort(); } catch (_) {}
        if (err) reject(err); else resolve(text);
      }
      
      function choose(candidates) {
        const valid = candidates.map(value => String(value || '').trim()).filter(Boolean);
        if (!valid.length) return '';
        if (typeof acceptCandidate === 'function') {
          try {
            const match = valid.find(candidate => acceptCandidate(candidate));
            if (match) return match;
          } catch (_) {}
        }
        return valid[0]; // Volvemos a la primera opción si el filtro falla
      }
      
      function scheduleInterim(text) {
        if (!text) return;
        latestInterim = text;
        gotText = true;
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => finish(null, latestInterim), 1400);
      }
      rec.onstart = () => {
        if (startTimer) { clearTimeout(startTimer); startTimer = null; }
        status('Escuchando…');
        responseTimer = setTimeout(() => {
          if (latestInterim) finish(null, latestInterim);
          else finish(new Error('No se escuchó una respuesta.'));
        }, timeoutMs);
      };
      rec.onresult = event => {
        const results = event.results;
        if (!results || !results.length) return;
        const last = results[results.length - 1];
        const candidates = Array.from(last).map(item => String(item.transcript || '').trim()).filter(Boolean);
        if (!candidates.length) return;
        const chosen = choose(candidates);
        if (last.isFinal) {
          gotText = true;
          finish(null, chosen || latestInterim);
        } else {
          scheduleInterim(chosen);
        }
      };
      rec.onerror = event => {
        const err = event && event.error;
        if (latestInterim && (err === 'no-speech' || err === 'aborted')) { finish(null, latestInterim); return; }
        if (err === 'not-allowed' || err === 'service-not-allowed') finish(new Error('El micrófono está bloqueado.'));
        else if (err === 'audio-capture') finish(new Error('No se encontró un micrófono disponible.'));
        else if (err === 'network') finish(new Error('El reconocimiento del navegador necesita internet.'));
        else if (err === 'no-speech') finish(new Error('No se escuchó una respuesta.'));
        else finish(new Error('No se pudo reconocer la voz.'));
      };
      rec.onend = () => {
        if (latestInterim) finish(null, latestInterim);
        else if (!gotText) finish(new Error('No se escuchó una respuesta.'));
      };
      try { rec.start(); } catch (_) { finish(new Error('No se pudo iniciar el micrófono.')); }
    });
  }

  async function listen(timeoutMs = 25000, acceptCandidate = null, options = {}) {
    if (!navigator.onLine) throw new Error('Sin internet. Complete el formulario manualmente.');
    return listenBrowser(timeoutMs, acceptCandidate);
  }

  function normalize(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9,.\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  
  const smallNumbers = { cero:0,un:1,uno:1,una:1,dos:2,tres:3,cuatro:4,cinco:5,seis:6,siete:7,ocho:8,nueve:9,diez:10,once:11,doce:12,trece:13,catorce:14,quince:15,dieciseis:16,diecisiete:17,dieciocho:18,diecinueve:19,veinte:20,veintiuno:21,veintiun:21,veintiuna:21,veintidos:22,veintitres:23,veinticuatro:24,veinticinco:25,veintiseis:26,veintisiete:27,veintiocho:28,veintinueve:29,treinta:30,cuarenta:40,cincuenta:50,sesenta:60,setenta:70,ochenta:80,noventa:90,cien:100,ciento:100,doscientos:200,trescientos:300,cuatrocientos:400,quinientos:500,seiscientos:600,setecientos:700,ochocientos:800,novecientos:900,mil:1000,media:0.5,medio:0.5 };
  const NUMBER_UNITS = ['hora','horas','planta','plantas','mata','matas','kilo','kilos','gramo','gramos','litro','litros','unidad','unidades','cc','galon','galones'];
  
  function parseIntegerWords(section) {
    const tokens = normalize(section).split(' ').filter(t => t && t !== 'y' && !NUMBER_UNITS.includes(t));
    if (!tokens.length) return null;
    let total = 0, current = 0, found = false;
    for (const token of tokens) {
      if (!(token in smallNumbers) || smallNumbers[token] === 0.5) return null;
      found = true; const n = smallNumbers[token];
      if (n === 100) current = (current || 1) * 100;
      else if (n === 1000) { total += (current || 1) * 1000; current = 0; }
      else current += n;
    }
    return found ? total + current : null;
  }
  function parseNumberPhrase(raw) {
    raw = normalize(raw).replace(/\b(sinco|sinko|cinko)\b/g, 'cinco').replace(/\b(sies|seiz)\b/g,'seis').replace(/\b(siette|site)\b/g,'siete').replace(/\b(nuebe|nue ve)\b/g,'nueve').replace(/\b(dies|diezs)\b/g,'diez').replace(/\b(quinse)\b/g,'quince').replace(/\b(onse)\b/g,'once').replace(/\b(dose)\b/g,'doce');
    const decimal = raw.split(/\b(?:coma|punto)\b/);
    if (decimal.length > 1) {
      const integer = parseIntegerWords(decimal[0]);
      const fractionTokens = normalize(decimal.slice(1).join(' ')).split(' ').filter(Boolean);
      if (integer === null || !fractionTokens.length || fractionTokens.some(t => !(t in smallNumbers) || !Number.isInteger(smallNumbers[t]) || smallNumbers[t] < 0 || smallNumbers[t] > 9)) return null;
      return Number(String(integer) + '.' + fractionTokens.map(t => smallNumbers[t]).join(''));
    }
    if (/\b(?:y\s+)?(?:media|medio)\b/.test(raw)) {
      const withoutHalf = raw.replace(/\by\s+media\b/g, '').replace(/\bmedia\b/g, '').replace(/\bmedio\b/g, '').trim();
      const base = parseIntegerWords(withoutHalf);
      return base === null ? 0.5 : base + 0.5;
    }
    return parseIntegerWords(raw);
  }
  function parseNumber(text) {
    let raw = normalize(text).replace(/\b(horas?|plantas?|matas?|kilos?|gramos?|unidades?|litros?|cc|galones?)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (!raw) return null;
    const numeric = raw.match(/\d+(?:[.,]\d+)?/);
    if (numeric) return Number(numeric[0].replace(',', '.'));
    const tokens = raw.split(' ');
    for (let i = 0; i < tokens.length; i++) {
      if (!(tokens[i] in smallNumbers) && !['coma','punto'].includes(tokens[i])) continue;
      for (let j = tokens.length; j > i; j--) {
        const candidate = tokens.slice(i,j).join(' ');
        const parsed = parseNumberPhrase(candidate);
        if (parsed !== null && Number.isFinite(parsed)) return parsed;
      }
    }
    return parseNumberPhrase(raw);
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
  
  window.FincaVoice = { 
    say, listen, parseNumber, normalize, yesNo, welcome, status, unlockAudio, supportsRecognition, supportsSpeechOutput, 
    prepareOffline: async () => true, 
    isOfflineReady: () => true 
  };
})();
