// Voz en español con reconocimiento Vosk local; el modelo se guarda en Cache Storage para usarlo sin internet.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let welcomePlayed = false;
  let audioUnlocked = false;
  let firstVoiceListCheck = false;
  // Mantener vivo un AudioContext iniciado durante un gesto real del usuario.
  // En Android, contextos nuevos creados después de hablar pueden quedar suspendidos.
  let localAudioContext = null;
  let localAudioContextReady = Promise.resolve();
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
  function supportsRecognition() { return !!((window.Vosk && typeof window.Vosk.createModel === 'function') || window.SpeechRecognition || window.webkitSpeechRecognition); }
  function supportsSpeechOutput() { return ('speechSynthesis' in window) && typeof SpeechSynthesisUtterance === 'function'; }
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  // Crear/resumir el contexto de audio de entrada en el primer toque del usuario.
  // Lo reutilizamos entre preguntas para no depender de crear AudioContext tras TTS.
  function primeLocalAudioContext() {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return Promise.reject(new Error('Este navegador no permite procesar audio local.'));
    try {
      if (!localAudioContext || localAudioContext.state === 'closed') {
        try { localAudioContext = new AudioContextCtor({ sampleRate: 16000 }); }
        catch (_) { localAudioContext = new AudioContextCtor(); }
      }
      if (localAudioContext.state !== 'running') {
        localAudioContextReady = localAudioContext.resume().catch(error => {
          console.warn('No se pudo activar el contexto de audio:', error);
        });
      } else {
        localAudioContextReady = Promise.resolve();
      }
      return localAudioContextReady;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async function getLocalAudioContext() {
    await primeLocalAudioContext();
    if (!localAudioContext || localAudioContext.state === 'closed') {
      throw new Error('No se pudo activar el audio del micrófono. Toque la pantalla una vez y vuelva a probar.');
    }
    if (localAudioContext.state !== 'running') {
      try { await localAudioContext.resume(); } catch (_) {}
    }
    if (localAudioContext.state !== 'running') {
      throw new Error('El audio del micrófono está suspendido por el navegador. Toque la pantalla una vez y vuelva a probar.');
    }
    return localAudioContext;
  }

  // El mismo toque desbloquea síntesis y audio de entrada, sin crear botones nuevos.
  function unlockAudio() {
    void primeLocalAudioContext().catch(error => console.warn('No se pudo preparar el audio local:', error));
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
    } catch (error) {
      console.warn('No se pudo desbloquear la salida de voz:', error);
      return false;
    }
  }

  async function loadAvailableVoices() {
    if (!supportsSpeechOutput()) return [];
    let voices = window.speechSynthesis.getVoices() || [];
    if (voices.length || firstVoiceListCheck) return voices;
    firstVoiceListCheck = true;
    await new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        try { window.speechSynthesis.removeEventListener('voiceschanged', finish); } catch (_) {}
        resolve();
      };
      try { window.speechSynthesis.addEventListener('voiceschanged', finish); } catch (_) {}
      setTimeout(finish, 900);
    });
    voices = window.speechSynthesis.getVoices() || [];
    return voices;
  }

  function say(text, opts = {}) {
    return new Promise(resolve => {
      if (!supportsSpeechOutput()) { status('Este navegador no ofrece salida de voz.'); resolve(false); return; }
      let settled = false;
      let watchdog = null;
      const phrase = String(text || '').trim();
      const finish = ok => { if (settled) return; settled = true; if (watchdog) clearTimeout(watchdog); resolve(ok); };
      if (!phrase) { finish(true); return; }
      (async () => {
        try {
          const synth = window.speechSynthesis;
          // Get the voice list early; some Android builds populate it asynchronously.
          const voices = await loadAvailableVoices();
          // Cancel only if there is an old utterance, then pause briefly. A zero-delay
          // speak immediately after cancel is unreliable on Chrome for Android.
          if (synth.speaking || synth.pending) {
            synth.cancel();
            await wait(140);
          }
          try { synth.resume(); } catch (_) {}
          const utterance = new SpeechSynthesisUtterance(phrase);
          utterance.lang = 'es-CO'; utterance.rate = 0.90; utterance.pitch = 1; utterance.volume = 1;
          const spanish = voices.find(v => /^es-CO$/i.test(v.lang)) || voices.find(v => /^es(-|$)/i.test(v.lang));
          if (spanish) { utterance.voice = spanish; utterance.lang = spanish.lang || 'es-CO'; }
          utterance.onstart = () => { audioUnlocked = true; if (opts.onStart) opts.onStart(); };
          utterance.onend = () => finish(true);
          utterance.onerror = event => {
            const reason = event && event.error ? event.error : 'error';
            if (!opts.silentError) status('No se pudo reproducir el audio (' + reason + '). Toque una vez la pantalla y vuelva a intentar.');
            finish(false);
          };
          watchdog = setTimeout(() => finish(false), Math.min(16000, Math.max(5000, phrase.length * 145 + 3000)));
          // An extra scheduling turn after cancel avoids dropped utterances on Android.
          await wait(80);
          synth.speak(utterance);
        } catch (error) {
          console.error('Error del sintetizador de voz:', error);
          if (!opts.silentError) status('No se pudo reproducir el audio. Revise el sonido y los permisos del teléfono.');
          finish(false);
        }
      })();
    });
  }
  // acceptCandidate permite seleccionar una alternativa de reconocimiento que coincida
  // con un catálogo o que contenga un número válido, y no quedarse con la primera transcripción errónea.
  // Reconocimiento local Vosk. El modelo comprimido se conserva en Cache Storage para
  // que una apertura posterior en modo avión no necesite descargarlo otra vez.
  const VOSK_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/vosk-browser@0.0.5/dist/vosk.js';
  const VOICE_MODEL_CACHE = 'finca-voice-model-cache-v2';
  const VOICE_MODEL_KEY = new URL('./models/vosk-model-small-es-0.42.tar.gz', location.href).href;
  const VOICE_MODEL_PARTS = [
    './vosk-model-small-es-0.42.part01',
    './vosk-model-small-es-0.42.part02'
  ];
  const VOICE_MODEL_BYTES = 39817091;
  let offlineModel = null;
  let offlineModelPromise = null;
  let archiveObjectUrl = null;
  let activeLocalSession = null;

  async function readResponseBytes(response, index, downloadedBefore) {
    const expected = index === 0 ? 20000000 : 19817091;
    const headerTotal = Number(response.headers.get('content-length')) || expected;
    if (!response.body || !response.body.getReader) {
      const buffer = await response.arrayBuffer();
      const downloaded = downloadedBefore + buffer.byteLength;
      status(`Descargando el reconocimiento local en español: ${Math.min(100, Math.round(downloaded / VOICE_MODEL_BYTES * 100))}%. Mantenga internet activo.`);
      return new Uint8Array(buffer);
    }
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      chunks.push(result.value);
      received += result.value.byteLength;
      const approxTotal = Math.max(expected, headerTotal);
      const projected = downloadedBefore + Math.min(received, approxTotal);
      status(`Descargando el reconocimiento local en español: ${Math.min(100, Math.round(projected / VOICE_MODEL_BYTES * 100))}%. Mantenga internet activo.`);
    }
    const out = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
    return out;
  }

  async function ensureVoskRuntimeCached() {
    if (!('caches' in window)) throw new Error('El navegador no permite guardar el motor de voz en el teléfono.');
    const cache = await caches.open('finca-pwa-v050-voz-local');
    const cached = await cache.match(VOSK_SCRIPT_URL);
    if (cached) return true;
    if (!navigator.onLine) throw new Error('La biblioteca Vosk no está guardada en este teléfono. Abra la aplicación con internet para completar la preparación de voz.');
    const response = await fetch(VOSK_SCRIPT_URL, { mode: 'cors', cache: 'no-cache' });
    if (!response.ok) throw new Error('No se pudo guardar la biblioteca Vosk para usarla sin internet.');
    await cache.put(VOSK_SCRIPT_URL, response.clone());
    return true;
  }

  async function getModelArchive() {
    if (!('caches' in window)) throw new Error('Este navegador no permite conservar el modelo de voz en el teléfono. Actualice Chrome.');
    const cache = await caches.open(VOICE_MODEL_CACHE);
    const cached = await cache.match(VOICE_MODEL_KEY);
    if (cached) {
      status('Modelo de español encontrado en el teléfono. Preparando la voz sin conexión…');
      return await cached.blob();
    }
    if (!navigator.onLine) {
      throw new Error('Todavía no se ha guardado el modelo de voz en este teléfono. Conéctese a internet y espere a que aparezca “Voz sin conexión lista”.');
    }

    const pieces = [];
    let downloaded = 0;
    for (let i = 0; i < VOICE_MODEL_PARTS.length; i++) {
      status(`Descargando el modelo español para uso sin internet (${i + 1} de ${VOICE_MODEL_PARTS.length})…`);
      const url = new URL(VOICE_MODEL_PARTS[i], location.href).href;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`No se pudo descargar la parte ${i + 1} del modelo de voz (HTTP ${response.status}). Revise que los dos archivos estén publicados en la raíz del repositorio.`);
      const bytes = await readResponseBytes(response, i, downloaded);
      pieces.push(bytes);
      downloaded += bytes.byteLength;
    }
    const total = pieces.reduce((sum, item) => sum + item.byteLength, 0);
    if (total < 35000000) throw new Error('La descarga del modelo de voz parece incompleta. Revise los dos archivos part01 y part02 en GitHub.');
    const blob = new Blob(pieces, { type: 'application/gzip' });
    try {
      await cache.put(VOICE_MODEL_KEY, new Response(blob, { headers: { 'Content-Type': 'application/gzip' } }));
    } catch (error) {
      throw new Error('El modelo se descargó, pero el teléfono no pudo guardarlo para futuras sesiones sin internet. Libere espacio de almacenamiento y vuelva a abrir la aplicación con conexión.');
    }
    status('Modelo guardado en el teléfono. Cargando el motor de reconocimiento…');
    return blob;
  }

  async function prepareOffline() {
    if (offlineModel) return true;
    if (offlineModelPromise) return offlineModelPromise;
    offlineModelPromise = (async () => {
      if (!window.Vosk || typeof window.Vosk.createModel !== 'function') {
        throw new Error('No se pudo cargar la biblioteca local de voz. Abra la aplicación con internet una vez y espere a que termine la preparación.');
      }
      await ensureVoskRuntimeCached();
      const archive = await getModelArchive();
      archiveObjectUrl = URL.createObjectURL(archive);
      try {
        status('Inicializando el motor de voz en español. Puede tardar un poco la primera vez…');
        offlineModel = await window.Vosk.createModel(archiveObjectUrl);
        if (!offlineModel || typeof offlineModel.KaldiRecognizer !== 'function') throw new Error('El motor no devolvió un reconocedor válido.');
        
        status('Verificando que el modelo responda sin internet…');
        const testRecognizer = new offlineModel.KaldiRecognizer(16000);
        if (!testRecognizer) throw new Error('El modelo descargado no pudo iniciar el reconocedor.');
        try {
            const dummyBuffer = { length: 16000, numberOfChannels: 1, sampleRate: 16000, getChannelData: () => new Float32Array(16000) };
            testRecognizer.acceptWaveform(dummyBuffer);
        } catch (e) {
            console.warn('Prueba de audio en falso falló, pero el modelo cargó.', e);
        }
        testRecognizer.remove();
        status('Voz sin conexión lista.');
        return true;
      } catch (error) {
        throw new Error('No se pudo inicializar el modelo de español. Verifique que las dos partes del modelo se hayan publicado completas. Detalle: ' + (error && error.message ? error.message : error));
      } finally {
        if (archiveObjectUrl) { URL.revokeObjectURL(archiveObjectUrl); archiveObjectUrl = null; }
      }
    })().catch(error => {
      status(error && error.message ? error.message : 'No se pudo preparar la voz sin conexión.');
      throw error;
    }).finally(() => { offlineModelPromise = null; });
    return offlineModelPromise;
  }

  function listenLocal(timeoutMs = 25000, acceptCandidate = null, options = {}) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let mediaStream = null;
      let audioContext = null;
      let source = null;
      let processor = null;
      let recognizer = null;
      let timer = null;
      let partialTimer = null;
      let oneWordTimer = null;
      let latestPartial = '';
      let latestFinal = '';

      const candidateIsValid = text => {
        if (typeof acceptCandidate !== 'function') return false;
        try { return !!acceptCandidate(text); } catch (_) { return false; }
      };
      const cleanup = async () => {
        if (partialTimer) clearTimeout(partialTimer);
        if (oneWordTimer) clearTimeout(oneWordTimer);
        if (processor) { try { processor.disconnect(); } catch (_) {} processor.onaudioprocess = null; }
        if (source) { try { source.disconnect(); } catch (_) {} }
        if (mediaStream) mediaStream.getTracks().forEach(track => { try { track.stop(); } catch (_) {} });
        if (recognizer) { try { recognizer.remove(); } catch (_) {} }
        // No cerrar el contexto compartido: Android puede suspender los contextos
        // recién creados al comenzar una respuesta automática tras la pregunta.
        if (activeLocalSession && activeLocalSession.recognizer === recognizer) activeLocalSession = null;
      };
      const finish = (error, text) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (partialTimer) clearTimeout(partialTimer);
        if (oneWordTimer) clearTimeout(oneWordTimer);
        void cleanup().then(() => {
          if (error) { status(error.message || 'No se pudo reconocer la respuesta.'); reject(error); }
          else {
            const recognized = String(text || '').trim();
            status(recognized ? 'Respuesta detectada sin internet: ' + recognized : 'No se detectaron palabras.');
            resolve(recognized);
          }
        });
      };

      (async () => {
        try {
          if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
            throw new Error('Este navegador no ofrece acceso al micrófono. Abra la aplicación segura de GitHub Pages en Chrome.');
          }
          if (!offlineModel) await prepareOffline();
          mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 16000 },
            video: false
          });
          audioContext = await getLocalAudioContext();
          // Si el Vosk incluido admite gramática, sesgar la escucha hacia los nombres
          // reales del catálogo para esta pregunta. Si la versión no admite el segundo
          // argumento, volver automáticamente al reconocedor abierto de la 0.5.9.
          if (Array.isArray(options.grammarPhrases) && options.grammarPhrases.length) {
            try {
              recognizer = new offlineModel.KaldiRecognizer(16000, JSON.stringify(options.grammarPhrases));
            } catch (grammarError) {
              console.warn('Esta biblioteca Vosk no admite gramática contextual; se usará el reconocedor normal.', grammarError);
            }
          }
          if (!recognizer) recognizer = new offlineModel.KaldiRecognizer(16000);
          const tokenCount = text => String(text || '').trim().split(/\s+/).filter(Boolean).length;
          const partialSettleMs = text => {
            // Los números y sí/no son breves. Para nombres, labores e insumos
            // damos una pausa mayor cuando solo llegó una palabra (p. ej. "Elkin")
            // para no cortar el apellido que el trabajador todavía está diciendo.
            if (options.kind === 'catalog' && tokenCount(text) < 2) {
              return candidateIsValid(text) ? 2200 : 2800;
            }
            return candidateIsValid(text) ? 1500 : 2500;
          };
          recognizer.on('result', message => {
            if (settled) return;
            const text = String(message && message.result && message.result.text || '').trim();
            if (!text) return;
            latestFinal = text;
            if (partialTimer) clearTimeout(partialTimer);
            latestPartial = '';
            // Si el motor finaliza solo el primer nombre, esperar brevemente a que
            // llegue el apellido. Si no llega más audio, devolver la transcripción
            // para que la aplicación pregunte de nuevo sin esperar 30 segundos.
            if (options.kind === 'catalog' && tokenCount(text) < 2) {
              if (oneWordTimer) clearTimeout(oneWordTimer);
              oneWordTimer = setTimeout(() => finish(null, latestFinal), 2200);
              return;
            }
            finish(null, text);
          });
          recognizer.on('partialresult', message => {
            if (settled) return;
            const partial = String(message && message.result && message.result.partial || '').trim();
            if (!partial) return;
            latestPartial = partial;
            if (oneWordTimer) { clearTimeout(oneWordTimer); oneWordTimer = null; }
            status('Escuchando sin internet… Se reconoce: ' + partial);
            if (partialTimer) clearTimeout(partialTimer);
            // Antes, si el parcial no coincidía con el catálogo, la app podía esperar
            // hasta los 30 s completos aunque ya hubiera silencio. Ahora entrega la
            // transcripción estable para aplicar coincidencias y, si falla, repetir.
            partialTimer = setTimeout(() => {
              if (settled || !latestPartial) return;
              finish(null, latestPartial);
            }, partialSettleMs(partial));
          });
          source = audioContext.createMediaStreamSource(mediaStream);
          processor = audioContext.createScriptProcessor(4096, 1, 1);
          processor.onaudioprocess = event => {
            if (settled || !recognizer) return;
            try { recognizer.acceptWaveform(event.inputBuffer); }
            catch (error) { console.error('Vosk acceptWaveform:', error); }
            const output = event.outputBuffer;
            if (output) for (let channel = 0; channel < output.numberOfChannels; channel++) output.getChannelData(channel).fill(0);
          };
          source.connect(processor);
          processor.connect(audioContext.destination);
          activeLocalSession = { recognizer, mediaStream, audioContext, source, processor };
          // Igual que con internet: el plazo completo para responder empieza solo
          // cuando el micrófono y el reconocedor están activos, no durante su arranque.
          status('Escuchando sin internet… Hable ahora.');
          timer = setTimeout(() => {
            if (latestPartial) finish(null, latestPartial);
            else if (latestFinal) finish(null, latestFinal);
            else finish(new Error('No se escuchó una respuesta.'));
          }, timeoutMs);
        } catch (error) {
          let message = error && error.message ? error.message : String(error || 'Error del micrófono.');
          if (error && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError')) message = 'El micrófono está bloqueado. En Chrome, permita el micrófono para este sitio y vuelva a probar.';
          else if (error && (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError')) message = 'No se encontró un micrófono disponible en el teléfono.';
          finish(new Error(message));
        }
      })();
    });
  }

  function listenBrowser(timeoutMs = 25000, acceptCandidate = null) {
    return new Promise((resolve, reject) => {
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition) { reject(new Error('El reconocimiento de voz del navegador no está disponible.')); return; }
      const rec = new Recognition();
      rec.lang = 'es-CO'; rec.continuous = false; rec.interimResults = true; rec.maxAlternatives = 5;
      let done = false, gotText = false, latestInterim = '';
      let silenceTimer = null;
      let responseTimer = null;
      // No confundir el tiempo de arranque del servicio con el tiempo del trabajador
      // para responder. Si Chrome no inicia la escucha, informar pronto, no esperar 30 s.
      let startTimer = setTimeout(() => finish(new Error('El reconocimiento de voz no inició. Revise el permiso del micrófono y vuelva a intentarlo.')), 7000);
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
          try { return valid.find(candidate => acceptCandidate(candidate)) || valid[0]; } catch (_) {}
        }
        return valid[0];
      }
      function scheduleInterim(text) {
        if (!text) return;
        latestInterim = text;
        gotText = true;
        if (silenceTimer) clearTimeout(silenceTimer);
        // Chrome puede entregar texto provisional y tardar demasiado en marcarlo
        // como final. Si deja de cambiar durante 1.4 s, entregamos lo reconocido.
        silenceTimer = setTimeout(() => finish(null, latestInterim), 1400);
      }
      rec.onstart = () => {
        if (startTimer) { clearTimeout(startTimer); startTimer = null; }
        status('Escuchando con el servicio del navegador…');
        // Los 30 s empiezan únicamente cuando Chrome confirma que está escuchando.
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
        // Algunos Chrome lanzan no-speech/error al cerrar la sesión aunque haya
        // llegado una transcripción provisional útil.
        if (latestInterim && (err === 'no-speech' || err === 'aborted')) { finish(null, latestInterim); return; }
        if (err === 'not-allowed' || err === 'service-not-allowed') finish(new Error('El micrófono está bloqueado. Permita su uso para este sitio.'));
        else if (err === 'audio-capture') finish(new Error('No se encontró un micrófono disponible.'));
        else if (err === 'network') finish(new Error('El reconocimiento del navegador necesita internet. El motor local todavía no está listo.'));
        else if (err === 'no-speech') finish(new Error('No se escuchó una respuesta.'));
        else finish(new Error('No se pudo reconocer la voz (' + (err || 'error') + ').'));
      };
      rec.onend = () => {
        if (latestInterim) finish(null, latestInterim);
        else if (!gotText) finish(new Error('No se escuchó una respuesta.'));
      };
      try { rec.start(); } catch (_) { finish(new Error('No se pudo iniciar el micrófono.')); }
    });
  }

  async function listen(timeoutMs = 25000, acceptCandidate = null, options = {}) {
    // IMPORTANTE: conectado a internet, conservar el reconocimiento del navegador,
    // que responde como en la versión que ya funcionaba. Vosk solo toma el turno
    // cuando no hay conexión o si el navegador no ofrece reconocimiento de voz.
    const BrowserRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (navigator.onLine && BrowserRecognition) {
      try {
        // Con internet se conserva el reconocedor del navegador. No cambiar a Vosk
        // automáticamente tras 30 s sin resultado: eso abría una segunda escucha de
        // otros 30 s y hacía parecer que la app no aceptaba la respuesta.
        return await listenBrowser(timeoutMs, acceptCandidate);
      } catch (error) {
        // Solo usar Vosk si el propio navegador informa un fallo de red del servicio.
        // Errores de silencio/tiempo se devuelven al flujo para repetir la pregunta.
        const message = String(error && error.message || error || '');
        if (/necesita internet|network|conexión.*reconocimiento/i.test(message) && offlineModel) {
          console.warn('Falló el servicio conectado; se probará Vosk local:', error);
          return listenLocal(timeoutMs, acceptCandidate, options);
        }
        throw error;
      }
    }

    if (offlineModel || window.Vosk) {
      if (!offlineModel) await prepareOffline();
      return listenLocal(timeoutMs, acceptCandidate, options);
    }
    if (!navigator.onLine) throw new Error('El reconocimiento local no está preparado. Conéctese una vez y espere a que la voz sin conexión quede lista.');
    throw new Error('Este navegador no ofrece reconocimiento de voz conectado y el motor local no está listo.');
  }

  function normalize(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9,.\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const smallNumbers = {
    cero:0,sero:0,un:1,uno:1,una:1,dos:2,tres:3,cuatro:4,cinco:5,sinco:5,sinko:5,cinko:5,seis:6,sies:6,seiz:6,
    siete:7,siette:7,site:7,ocho:8,nueve:9,nuebe:9,diez:10,dies:10,diezs:10,
    once:11,onse:11,doce:12,dose:12,trece:13,catorce:14,quince:15,quinse:15,
    dieciseis:16,diecisiete:17,dieciocho:18,diecinueve:19,veinte:20,veintiuno:21,veintiun:21,veintiuna:21,
    veintidos:22,veintitres:23,veinticuatro:24,veinticinco:25,veintiseis:26,veintisiete:27,veintiocho:28,veintinueve:29,
    treinta:30,cuarenta:40,cincuenta:50,sesenta:60,setenta:70,ochenta:80,noventa:90,
    cien:100,ciento:100,doscientos:200,trescientos:300,cuatrocientos:400,quinientos:500,seiscientos:600,setecientos:700,ochocientos:800,novecientos:900,mil:1000,
    media:0.5,medio:0.5
  };
  const NUMBER_UNITS = ['hora','horas','planta','plantas','mata','matas','kilo','kilos','kilogramo','kilogramos','gramo','gramos','litro','litros','unidad','unidades','cc','galon','galones'];
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
    raw = normalize(raw).replace(/\b(sinco|sinko|cinko)\b/g, 'cinco')
      .replace(/\b(sies|seiz)\b/g,'seis').replace(/\b(siette|site)\b/g,'siete')
      .replace(/\b(nuebe|nue ve)\b/g,'nueve').replace(/\b(dies|diezs)\b/g,'diez')
      .replace(/\b(quinse)\b/g,'quince').replace(/\b(onse)\b/g,'once').replace(/\b(dose)\b/g,'doce');
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
    let raw = normalize(text)
      .replace(/\b(horas?|plantas?|matas?|kilos?|kilogramos?|gramos?|unidades?|litros?|cc|galones?)\b/g, ' ')
      .replace(/\b(nue\s+ve)\b/g, 'nueve')
      .replace(/\s+/g, ' ').trim();
    if (!raw) return null;
    const numeric = raw.match(/\d+(?:[.,]\d+)?/);
    if (numeric) return Number(numeric[0].replace(',', '.'));
    // Intentar desde cada palabra-numero: admite respuestas con contexto como
    // "son cinco plantas" o "tengo dos coma cinco horas" sin tragarse el resto.
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
  window.FincaVoice = { say, listen, parseNumber, normalize, yesNo, welcome, status, unlockAudio, supportsRecognition, supportsSpeechOutput, prepareOffline, isOfflineReady: () => !!offlineModel };
})();
