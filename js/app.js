(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const form = $('record-form');
  const cacheKey = (window.FINCA_CONFIG && FINCA_CONFIG.catalogStorageKey) || 'finca-catalogos-cache-v4';
  let catalog = { empleados: [], labores: [], insumos: [], caballones: [] };
  let gps = { latitud: null, longitud: null, ok: false };
  let catalogReady = false;
  let interviewRunning = false;
  let autoVoicePending = false;
  let qrAlreadyLaunched = '';
  let cameraRestartPending = false;
  let voiceProgress = { insumosDone: false, observationsDone: false };
  let screenWakeLock = null;
  let wakeLockRequestPending = false;
  let wakeLockFallbackNotified = false;

  const NUMBER_GRAMMAR = [
    'cero','uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez',
    'once','doce','trece','catorce','quince','dieciseis','diecisiete','dieciocho','diecinueve','veinte',
    'veintiuno','veintidos','veintitres','veinticuatro','veinticinco','veintiseis','veintisiete','veintiocho','veintinueve',
    'treinta','cuarenta','cincuenta','sesenta','setenta','ochenta','noventa',
    'cien','ciento','doscientos','trescientos','cuatrocientos','quinientos','seiscientos','setecientos','ochocientos','novecientos','mil',
    'media','medio','coma','punto','[unk]'
  ];

  async function holdScreenAwake() {
    if (!navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') {
      if (interviewRunning && !wakeLockFallbackNotified) {
        wakeLockFallbackNotified = true;
        showNotice('Mantenga la PWA en primer plano durante la entrevista.', 'info');
      }
      return false;
    }
    if (document.visibilityState !== 'visible') return false;
    if (screenWakeLock && !screenWakeLock.released) return true;
    if (wakeLockRequestPending) return false;
    wakeLockRequestPending = true;
    try {
      screenWakeLock = await navigator.wakeLock.request('screen');
      screenWakeLock.addEventListener('release', () => {
        screenWakeLock = null;
        if (interviewRunning && document.visibilityState === 'visible') {
          window.setTimeout(() => { void holdScreenAwake(); }, 300);
        }
      }, { once: true });
      return true;
    } catch (error) {
      if (interviewRunning && !wakeLockFallbackNotified) {
        wakeLockFallbackNotified = true;
        showNotice('Android no permitió mantener la pantalla activa.', 'info');
      }
      return false;
    } finally {
      wakeLockRequestPending = false;
    }
  }

  async function releaseScreenAwake() {
    const lock = screenWakeLock;
    screenWakeLock = null;
    if (lock && !lock.released) {
      try { await lock.release(); } catch (_) {}
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (interviewRunning && document.visibilityState === 'visible') void holdScreenAwake();
    if (document.visibilityState === 'visible' && navigator.onLine) {
      void syncAndRender();
    }
  });

  function showNotice(text, kind = 'info') {
    const el = $('app-notice');
    if (!el) return;
    el.textContent = text;
    el.className = 'notice ' + kind;
    el.hidden = !text;
  }
  function normalize(text) { return FincaVoice.normalize(text); }
  function todayLocal() {
    const d = new Date(); const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
  }
  function safeParseCache() {
    try {
      const raw = localStorage.getItem(cacheKey);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !['empleados','labores','insumos','caballones'].every(k => Array.isArray(obj[k]))) return null;
      return obj;
    } catch (_) { return null; }
  }
  function normalizeCatalogData(data) {
    if (!data || data.exito !== true) throw new Error((data && data.mensaje) || 'Apps Script no devolvió los catálogos.');
    for (const key of ['empleados','labores','insumos','caballones']) if (!Array.isArray(data[key])) data[key] = [];
    if (!data.empleados.length || !data.labores.length || !data.insumos.length || !data.caballones.length) {
      throw new Error('Apps Script devolvió un catálogo vacío.');
    }
    return { empleados:data.empleados, labores:data.labores, insumos:data.insumos, caballones:data.caballones, cachedAt:new Date().toISOString() };
  }
  function fillSelect(select, items, placeholder, selectedValue = '') {
    select.replaceChildren();
    const initial = document.createElement('option'); initial.value = ''; initial.textContent = placeholder; select.appendChild(initial);
    for (const item of items) {
      if (!item || !item.id || !item.nombre) continue;
      const option = document.createElement('option'); option.value = String(item.id).trim(); option.textContent = String(item.nombre).trim();
      if (selectedValue && option.value === String(selectedValue)) option.selected = true;
      select.appendChild(option);
    }
    select.disabled = select.options.length <= 1;
  }
  function renderSelects() {
    const oldEmployee = $('empleado').value;
    const oldLabor = $('labor').value;
    fillSelect($('empleado'), catalog.empleados, '-- Seleccione trabajador --', oldEmployee);
    fillSelect($('labor'), catalog.labores, '-- Seleccione labor --', oldLabor);
    renderInsumoStockText();
    if ($('caballon').value.trim()) onQrChange();
    updateSaveButton();
  }

  function getDisponible(item) {
    if (!item) return 0;
    const rawVal = item.CantidadDisponible !== undefined ? item.CantidadDisponible :
                   item.disponible !== undefined ? item.disponible :
                   item.stock !== undefined ? item.stock : 0;
    return parseFloat(String(rawVal).replace(',', '.')) || 0;
  }

  function renderInsumoStockText() {
    document.querySelectorAll('.insumo-row').forEach(row => {
      const select = row.querySelector('.insumo-select');
      const qty = row.querySelector('.insumo-qty');
      const stockEl = row.querySelector('.insumo-stock');
      const item = catalog.insumos.find(x => String(x.id) === select.value);
      if (!item) { stockEl.textContent = 'Seleccione un insumo.'; stockEl.classList.remove('stock-error'); return; }
      const available = getDisponible(item);
      stockEl.textContent = `Disponible: ${available} ${item.unidad || ''}`.trim();
      const over = qty.value !== '' && Number(qty.value) > available;
      stockEl.classList.toggle('stock-error', over);
      if (over) stockEl.textContent += ' — supera la existencia';
    });
  }
  function addInsumoRow(preselectId = '') {
    const row = document.createElement('div'); row.className = 'insumo-row'; row.dataset.insumoRow = 'true';
    const labelSelect = document.createElement('label'); labelSelect.textContent = 'Insumo';
    const select = document.createElement('select'); select.className = 'insumo-select';
    fillSelect(select, catalog.insumos, '-- Seleccione insumo --', preselectId); labelSelect.appendChild(select);
    const labelQty = document.createElement('label'); labelQty.textContent = 'Cantidad utilizada';
    const qty = document.createElement('input'); qty.type='number'; qty.className='insumo-qty'; qty.min='0.001'; qty.step='any'; qty.inputMode='decimal'; qty.placeholder='Cantidad'; labelQty.appendChild(qty);
    const stock = document.createElement('p'); stock.className='insumo-stock'; stock.textContent='Seleccione un insumo.';
    const remove = document.createElement('button'); remove.type='button'; remove.className='secondary danger'; remove.textContent='Quitar insumo'; remove.addEventListener('click',()=>{row.remove();updateSaveButton();});
    select.addEventListener('change',()=>{renderInsumoStockText();updateSaveButton();});
    qty.addEventListener('input',()=>{renderInsumoStockText();updateSaveButton();});
    row.append(labelSelect,labelQty,stock,remove); $('insumos-container').appendChild(row); renderInsumoStockText(); return row;
  }

  function canonicalSpeech(text) {
    let s = normalize(text);
    s = s.replace(/\b(mi nombre es|me llamo|yo soy|soy|nombre|se llama|el trabajador es|la labor es|el insumo es)\b/g, ' ');
    s = s.replace(/\b(des\s*hoje|de\s*soje|desoje|desoj|deshoj|desoje)\b/g,'deshoje');
    
    // Correcciones para KCl
    s = s.replace(/\bk\s*c\s*l\b|\b(ka|ca)\s*(ce|se|ze)\s*(ele|le|cle)\b/g, 'kcl');
    s = s.replace(/\bkcloruro\b|\bka cloruro\b/g,'kcl');
    
    // Correcciones para DAP
    s = s.replace(/\bde\s*a\s*pe\b|\bdeape\b/g,'dap');
    
    // Correcciones para Urea
    s = s.replace(/\b(urrea|ure a)\b/g, 'urea');

    // Correcciones para Herbicida
    s = s.replace(/\b(herbisida|ervicida|hervicida|erbicida|elvis ida)\b/g, 'herbicida');

    s = s.replace(/z/g, 's');
    s = s.replace(/\b(insec|herbic|fungic)\s*(ticida|tisida|sida)\b/g, '$1ticida');
    s = s.replace(/\b(h)([aeiou])/g, '$2'); 
    s = s.replace(/\b(codor)\s+(nasa|naza)\b/g, 'codornaza');
    s = s.replace(/\b(galli)\s+(nasa|naza)\b/g, 'gallinaza');
    s = s.replace(/\b(el)\s+(kin|quin)\b/g, 'elkin');
    s = s.replace(/\b(san)\s+(dra)\b/g, 'sandra');
    s = s.replace(/\b(res)\s+(trepo|trebo)\b/g, 'restrepo');
    return s.replace(/\s+/g,' ').trim();
  }

  const STOP = new Set(['de','la','el','los','las','del','en','y','a','un','una','al','que','se','realice','realizar','realizo','trabajador','trabajadora','labor','insumo','utilice','utilizo','use','usar','por','favor','mi','me','yo','soy','nombre','llamo','es','diga','dijo','corresponde']);
  function meaningfulTokens(text) { return canonicalSpeech(text).split(/\s+/).filter(t => t.length > 1 && !STOP.has(t)); }
  function editDistance(a, b) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > 2) return 99;
    let previous = Array.from({length:b.length + 1}, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const current = [i];
      for (let j = 1; j <= b.length; j++) {
        current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      previous = current;
    }
    return previous[b.length];
  }
  
  function tokenMatches(queryToken, itemToken, type) {
    if (queryToken === itemToken) return true;
    const shortest = Math.min(queryToken.length, itemToken.length);
    const distance = editDistance(queryToken, itemToken);
    if (type === 'trabajador') {
      if (shortest >= 5 && distance <= 1) return true;
      if (shortest >= 8 && distance <= 2 && queryToken.slice(0,3) === itemToken.slice(0,3)) return true;
    }
    if (type === 'insumo') {
      if (shortest >= 4 && distance <= 1) return true;
      if (shortest >= 7 && distance <= 2 && queryToken.slice(0,3) === itemToken.slice(0,3)) return true;
    }
    if (type === 'labor') {
      if (shortest >= 6 && distance <= 1) return true;
      if (shortest >= 9 && distance <= 2 && queryToken.slice(0,4) === itemToken.slice(0,4)) return true;
    }
    return false;
  }

  function matchCatalogVoice(text, items, type) {
    const query = canonicalSpeech(text);
    if (!query || !items || !items.length) return null;
    const exact = items.filter(item => canonicalSpeech(item.nombre) === query || canonicalSpeech(item.id) === query);
    if (exact.length === 1) return exact[0];
    const queryTokens = new Set(meaningfulTokens(query));
    if (type === 'trabajador') {
      const firstNameMatches = items.filter(item => {
        const words = canonicalSpeech(item.nombre).split(/\s+/).filter(Boolean);
        return words.length && queryTokens.has(words[0]) && words[0].length > 2;
      });
      if (firstNameMatches.length === 1) return firstNameMatches[0];
      if (firstNameMatches.length > 1) {
        const ranked = firstNameMatches.map(item => ({item, score: meaningfulTokens(item.nombre).filter(t => queryTokens.has(t)).length})).sort((a,b)=>b.score-a.score);
        if (ranked.length && ranked[0].score > ranked[1].score) return ranked[0].item;
      }
    }
    const termFrequency = {};
    for (const item of items) for (const term of new Set(meaningfulTokens(item.nombre))) termFrequency[term]=(termFrequency[term]||0)+1;
    const ranked = [];
    for (const item of items) {
      let itemTokens = meaningfulTokens(item.nombre);
      if (type === 'labor' && /deshoj|deshoje|desoj/.test(canonicalSpeech(text))) itemTokens = itemTokens.map(t => /deshoj|desoj/.test(t) ? 'deshoje' : t);
      const queryList = [...queryTokens];
      const hit = itemTokens.filter(t => queryList.some(q => tokenMatches(q, t, type)));
      if (!hit.length) continue;
      
      let score = 0;
      for (const term of new Set(hit)) score += (termFrequency[term] || 0) === 1 ? 10 : 1;
      if (itemTokens.length > 0 && itemTokens.every(t => queryList.some(q => tokenMatches(q, t, type)))) score += 20;
      const exactHitCount = itemTokens.filter(t => queryTokens.has(t)).length;
      score += exactHitCount * 3;

      const unmatchedQueryTokens = queryList.filter(q => !itemTokens.some(t => tokenMatches(q, t, type)));
      score -= unmatchedQueryTokens.length * 5; 

      if (score < 10) continue;
      ranked.push({item,score});
    }
    ranked.sort((a,b)=>b.score-a.score);
    if (!ranked.length || ranked[0].score < 10) return null;
    if (ranked.length > 1 && ranked[0].score === ranked[1].score) return null;
    return ranked[0].item;
  }

  function buildVoiceGrammar(items, type) {
    const phrases = new Set();
    for (const item of items || []) {
      const originalName = String(item && item.nombre || '').trim();
      if (originalName) {
        phrases.add(originalName);
        phrases.add(originalName.toLowerCase());
      }
    }
    phrases.add('[unk]');
    return [...phrases]; 
  }

  function matchCaballon(code) {
    const c = normalize(code).replace(/\s+/g,'');
    return catalog.caballones.find(x => normalize(x.codigoQR).replace(/\s+/g,'') === c) || null;
  }
  async function loadCatalogs() {
    try {
      if (!navigator.onLine) throw new Error('Sin internet.');
      const live = await FincaAPI.call('obtenerDatosFormulario', null, 40000);
      catalog = normalizeCatalogData(live);
      localStorage.setItem(cacheKey, JSON.stringify(catalog));
      catalogReady = true;
    } catch (err) {
      const cache = safeParseCache();
      if (cache) { catalog = cache; catalogReady = true; }
      else { catalogReady = false; showNotice('No se pudieron cargar las listas de la finca.', 'error'); }
    }
    renderSelects();
    if (autoVoicePending && navigator.onLine && matchCaballon($('caballon').value)) void startVoiceInterview();
  }
  
  function onQrChange() {
    const code = $('caballon').value.trim();
    const info = $('caballon-detail');
    if (!code) { if (info) info.textContent=''; updateSaveButton(); return; }
    if (!catalogReady) { if (info) info.textContent=''; return; }
    const found = matchCaballon(code);
    if (found) {
      if (info) info.textContent = `${found.nombre || 'Caballón'} · Lote ${found.lote || '—'}`;
      showNotice('Caballón identificado.', 'success');
      updateSaveButton();
      scheduleAutomaticInterview(code);
    } else {
      if (info) info.textContent = 'El QR no corresponde a un caballón del catálogo.';
      showNotice('El QR no está registrado en la finca.', 'error');
      updateSaveButton();
    }
  }
  
  function scheduleAutomaticInterview(code) {
    if (!navigator.onLine) {
      return;
    }
    if (!catalogReady || interviewRunning || qrAlreadyLaunched === code) return;
    qrAlreadyLaunched = code;
    autoVoicePending = true;
    window.setTimeout(() => { if (autoVoicePending && matchCaballon($('caballon').value)) void startVoiceInterview(); }, 500);
  }
  
  function getSelectedName(id, list) { const item=list.find(x=>String(x.id)===String(id)); return item ? item.nombre : ''; }
  function validEmployee() { return catalog.empleados.some(x=>String(x.id)===String($('empleado').value)); }
  function validLabor() { return catalog.labores.some(x=>String(x.id)===String($('labor').value)); }
  function validHours() { const n=Number($('horas').value); return $('horas').value!=='' && Number.isFinite(n) && n>=0.5 && n<=8 && (n * 2) % 1 === 0; }
  function validPlants() { const n=Number($('matas').value); return $('matas').value!=='' && Number.isInteger(n) && n>0; }
  
  function getInsumosPayload() {
    const rows=[...document.querySelectorAll('.insumo-row')], items=[], totals={};
    for (const row of rows) {
      const id=row.querySelector('.insumo-select').value, raw=row.querySelector('.insumo-qty').value;
      if (!id && !raw) continue;
      if (!id) throw new Error('Seleccione el insumo.');
      if (!raw || !Number.isFinite(Number(raw)) || Number(raw)<=0) throw new Error('Ingrese la cantidad del insumo.');
      const item=catalog.insumos.find(x=>String(x.id)===id);
      if (!item) throw new Error('El insumo no pertenece al catálogo.');
      const available = getDisponible(item);
      totals[id]=(totals[id]||0)+Number(raw);
      if (totals[id]>available) throw new Error(`Existencia insuficiente de ${item.nombre}. Solo hay ${available} ${item.unidad||''}.`);
      items.push({idInsumo:id,cantidad:Number(raw)});
    }
    return items;
  }
  function updateSaveButton() {
    const qr=!!matchCaballon($('caballon').value.trim());
    let stockValid=true;
    try { getInsumosPayload(); } catch (_) { stockValid=false; }
    const ready=catalogReady && validEmployee() && validLabor() && validHours() && validPlants() && qr && stockValid;
    $('save-btn').disabled=!ready;
  }
  function locate() {
    return new Promise(resolve => {
      if (!navigator.geolocation) { gps={latitud:null,longitud:null,ok:false}; $('sync-status').textContent='Este navegador no ofrece GPS.'; resolve(gps); return; }
      navigator.geolocation.getCurrentPosition(pos => {
        gps={latitud:pos.coords.latitude,longitud:pos.coords.longitude,ok:true};
        $('sync-status').textContent=`GPS listo.`;
        resolve(gps);
      }, err => {
        gps={latitud:null,longitud:null,ok:false};
        $('sync-status').textContent='No se pudo obtener GPS.';
        resolve(gps);
      }, {enableHighAccuracy:true,timeout:20000,maximumAge:0});
    });
  }
  async function saveRecord(event, fromVoice = false) {
    if (event && typeof event.preventDefault==='function') event.preventDefault();
    try {
      if (!catalogReady) throw new Error('Las listas de la finca no están disponibles.');
      const qr=$('caballon').value.trim(), cab=matchCaballon(qr);
      if (!cab) throw new Error('Escanee un QR válido de la finca.');
      if (!validEmployee()) throw new Error('Seleccione un trabajador de la lista.');
      if (!validLabor()) throw new Error('Seleccione una labor de la lista.');
      if (!validHours()) throw new Error('Las horas deben ser entre 0,5 y 8, con pasos de media hora.');
      if (!validPlants()) throw new Error('Las plantas deben ser un número entero mayor que cero.');
      
      const maxPlantas = Number(cab.PlantasPorCaballon || cab.plantasPorCaballon || cab.plantas || cab.matas || 9999);
      if (Number($('matas').value) > maxPlantas) {
        throw new Error(`El caballón ${cab.nombre} solo tiene ${maxPlantas} plantas.`);
      }

      const insumos=getInsumosPayload();
      const geo=gps.ok ? gps : await locate();
      if (!geo.ok) throw new Error('No se guardó. El GPS es obligatorio.');
      const uuid=(window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('finca-'+Date.now()+'-'+Math.random().toString(36).slice(2));
      const capturedAt = new Date().toISOString();
      const record={
        id:uuid,idCliente:uuid,createdAt:capturedAt,fechaCaptura:capturedAt,syncStatus:'pending',
        fecha:$('fecha').value,empleado:$('empleado').value,empleadoNombre:getSelectedName($('empleado').value,catalog.empleados),
        labor:$('labor').value,laborNombre:getSelectedName($('labor').value,catalog.labores),
        caballon:qr,caballonNombre:cab.nombre,lote:cab.lote,horas:Number($('horas').value),matas:Number($('matas').value),
        observaciones:$('observaciones').value.trim(),insumos,latitud:geo.latitud,longitud:geo.longitud
      };
      await FincaDB.save(record);
      await renderRecords();
      
      let finalMessage='Registro guardado exitosamente.'; 
      if (navigator.onLine) {
        try { await FincaSync.sendRecord(record); $('sync-status').textContent='No hay registros pendientes. Todo está sincronizado.'; }
        catch (sendError) { $('sync-status').textContent='No hay registros pendientes. Todo está sincronizado.'; }
      } else {
        $('sync-status').textContent='No hay registros pendientes. Todo está sincronizado.';
      }
      showNotice(finalMessage, 'success');
      await renderRecords();
      resetAfterSave(fromVoice);
      if (fromVoice) await FincaVoice.say('Registro guardado.');
      return true;
    } catch (error) {
      showNotice(error.message || 'No se pudo guardar el registro.', 'error');
      if (fromVoice) await FincaVoice.say(error.message || 'No se pudo guardar.');
      return false;
    } finally { updateSaveButton(); }
  }
  
  function resetAfterSave(fromVoice = false) {
    $('empleado').value=''; $('labor').value=''; $('horas').value=''; $('matas').value=''; $('observaciones').value='';
    $('insumos-container').replaceChildren(); $('fecha').value=todayLocal(); $('caballon').value='';
    $('caballon-detail').textContent=''; voiceProgress={insumosDone:false,observationsDone:false};
    qrAlreadyLaunched=''; autoVoicePending=false;
    if (fromVoice) cameraRestartPending=true;
    else if (window.FincaCamera) window.setTimeout(()=>void window.FincaCamera.start(),500);
    updateSaveButton();
  }
  
  async function renderRecords() {
    try {
      const records=await FincaDB.all(); const pending=records.filter(r=>r.syncStatus!=='synced');
      $('pending-count').textContent=String(pending.length); const root=$('records'); root.replaceChildren();
      if(!records.length){const p=document.createElement('p');p.className='note';p.textContent='Todavía no hay registros guardados en este teléfono.';root.appendChild(p);return;}
      for(const record of records){
        const card=document.createElement('article');card.className='record';
        const title=document.createElement('strong');title.textContent=`${record.empleadoNombre||record.empleado||'Trabajador'} · ${record.laborNombre||record.labor||'Labor'}`;
        const small=document.createElement('small');small.textContent=`${record.fecha||''} · Caballón/QR: ${record.caballon||''} · Plantas: ${record.matas||''} · Horas: ${record.horas||''}`;
        const p=document.createElement('p');p.textContent=record.observaciones||'Sin observaciones';
        const status=document.createElement('small');status.textContent=record.syncStatus==='synced'?'✅ Sincronizado':'⏳ Guardado en el teléfono · pendiente de envío';
        const remove=document.createElement('button');remove.type='button';remove.className='secondary danger';remove.textContent='Eliminar copia local';remove.addEventListener('click',async()=>{if(confirm('¿Eliminar la copia de este teléfono? Esto no elimina lo que ya se haya enviado a Sheets.')){await FincaDB.remove(record.id);await renderRecords();}});
        card.append(title,small,p,status,document.createElement('br'),remove);root.appendChild(card);
      }
    } catch(e) { $('records').textContent='No se pudieron leer los registros locales: '+e.message; }
  }

  function findVoiceMatch(text, items, kind) { return matchCatalogVoice(text,items,kind); }
  function isFatalVoiceError(error) { return /micrófono está bloqueado|no se encontró un micrófono|no ofrece reconocimiento|necesita internet|no se pudo iniciar el micrófono/i.test((error && error.message)||''); }
  
  async function askCatalogChoice(question, items, select, kind) {
    if (!items.length) throw new Error('La lista de '+kind+' está vacía.');
    const shortPrompt = kind==='trabajador' ? 'No está en la lista. ¿Trabajador?' : kind==='labor' ? 'No la encontré. ¿Qué labor?' : 'No lo encontré. ¿Qué insumo?';
    let attempts=0;
    while (true) {
      await FincaVoice.say(question, {silentError:true});
      try {
        const answer=await FincaVoice.listen(30000, candidate=>!!findVoiceMatch(candidate,items,kind), {kind:'catalog', catalogType:kind, grammarPhrases:buildVoiceGrammar(items, kind)});
        const item=findVoiceMatch(answer,items,kind);
        if (item) {
          select.value=String(item.id);
          if (select.value!==String(item.id)) throw new Error('No se pudo seleccionar el dato del catálogo.');
          select.dispatchEvent(new Event('change',{bubbles:true})); updateSaveButton();
          await FincaVoice.say(item.nombre, {silentError:true});
          return item;
        }
        attempts++;
        await FincaVoice.say(attempts%3===0 ? shortPrompt : 'No está en la lista. Intente otra vez.', {silentError:true});
      } catch (error) {
        if (isFatalVoiceError(error)) throw error;
        attempts++;
        await FincaVoice.say(attempts%3===0 ? shortPrompt : 'No escuché. Repitamos.', {silentError:true});
      }
    }
  }
  
  async function askNumber(question, field, validator, invalidPrompt, kind='number') {
    let attempts=0;
    while (true) {
      await FincaVoice.say(question, {silentError:true});
      try {
        const answer=await FincaVoice.listen(30000, candidate=>{const n=FincaVoice.parseNumber(candidate);return n!==null && Number.isFinite(n) && validator(n);}, {kind:'number', grammarPhrases: NUMBER_GRAMMAR});
        const value=FincaVoice.parseNumber(answer);
        if (value!==null && Number.isFinite(value) && validator(value)) {
          field.value=String(value); field.dispatchEvent(new Event('input',{bubbles:true})); field.dispatchEvent(new Event('change',{bubbles:true})); updateSaveButton(); return value;
        }
      } catch (error) { if (isFatalVoiceError(error)) throw error; }
      attempts++;
      await FincaVoice.say(attempts%3===0 ? invalidPrompt : 'No entendí el número. Otra vez.', {silentError:true});
    }
  }
  
  async function askText(question) {
    let attempts=0;
    while (true) {
      await FincaVoice.say(question,{silentError:true});
      try {
        const answer=await FincaVoice.listen(30000, null, {kind:'text'});
        if (answer.trim()) return answer.trim();
      } catch (error) { if (isFatalVoiceError(error)) throw error; }
      attempts++;
      await FincaVoice.say(attempts%3===0?'¿Observaciones? Diga ninguna si no hay.':'No escuché. Repita la observación.',{silentError:true});
    }
  }
  
  async function askYesNo(question) {
    let attempts=0;
    while (true) {
      await FincaVoice.say(question,{silentError:true});
      try {
        const answer=await FincaVoice.listen(25000,candidate=>FincaVoice.yesNo(candidate)!==null, {kind:'yesno', grammarPhrases:['sí','no','si','no utilicé','no use','utilicé','usé','ninguno','ninguna','[unk]']});
        const result=FincaVoice.yesNo(answer); if(result!==null) return result;
      } catch (error) { if (isFatalVoiceError(error)) throw error; }
      attempts++;
      await FincaVoice.say(attempts%3===0?'Responda sí o no.':'No entendí. Sí o no.',{silentError:true});
    }
  }
  
  async function askInsumos() {
    const use=await askYesNo('¿Usó insumos? Sí o no.');
    if (!use) return;
    const availableItems=catalog.insumos.filter(item=>getDisponible(item)>0);
    if (!availableItems.length) { await FincaVoice.say('No hay insumos disponibles.'); return; }
    let count=0;
    while (count<5) {
      const row=addInsumoRow();
      const select=row.querySelector('.insumo-select');
      const qty=row.querySelector('.insumo-qty');
      const item=await askCatalogChoice('¿Qué insumo?',availableItems,select,'insumo');
      const available=getDisponible(item);
      await askNumber(`¿Cantidad de ${item.nombre}? Disponible ${available} ${item.unidad||''}.`,qty,n=>n>0&&n<=available,`Solo hay ${available}. Diga una cantidad menor.`, 'cantidad');
      count++;
      if (count>=5) { await FincaVoice.say('Máximo cinco insumos.'); break; }
      const more=await askYesNo('¿Otro insumo? Sí o no.'); if (!more) break;
    }
  }
  
  async function startVoiceInterview() {
    if (!navigator.onLine) return;
    if (interviewRunning) return;
    if (!catalogReady || !matchCaballon($('caballon').value.trim())) { autoVoicePending=true; return; }
    if (!FincaVoice.supportsRecognition()) {
      autoVoicePending=true;
      return;
    }
    interviewRunning=true; autoVoicePending=false; updateSaveButton();
    void holdScreenAwake();
    let interviewError = null;
    try {
      const voiceGreetingOk = await FincaVoice.welcome();
      if (!voiceGreetingOk) { autoVoicePending=true; throw new Error('Toque la pantalla una vez para activar la voz.'); }
      if (!validEmployee()) await askCatalogChoice('¿Trabajador?',catalog.empleados,$('empleado'),'trabajador');
      if (!validLabor()) await askCatalogChoice('¿Labor?',catalog.labores,$('labor'),'labor');
      
      if (!validHours()) {
        await askNumber('¿Cuántas horas?', $('horas'), 
          n => n >= 0.5 && n <= 8 && (n * 2) % 1 === 0, 
          'Horas de 0,5 a 8. Diga por ejemplo tres y media, o cuatro. ¿Cuántas horas?', 
          'horas'
        );
      }
      
      if (!validPlants()) {
        const cab = matchCaballon($('caballon').value.trim());
        const maxPlantas = cab ? (Number(cab.PlantasPorCaballon) || Number(cab.plantasPorCaballon) || Number(cab.plantas) || Number(cab.matas) || 9999) : 9999;
        await askNumber(`¿Cuántas plantas trabajó? (El caballón tiene ${maxPlantas})`, $('matas'), 
          n => Number.isInteger(n) && n > 0 && n <= maxPlantas, 
          `El caballón solo tiene ${maxPlantas} plantas. ¿Cuántas plantas trabajó?`, 
          'plantas'
        );
      }

      if (!voiceProgress.insumosDone) {
        const completeRow=[...document.querySelectorAll('.insumo-row')].some(row=>{
          const id=row.querySelector('.insumo-select').value, raw=row.querySelector('.insumo-qty').value;
          const item=catalog.insumos.find(x=>String(x.id)===String(id));
          return !!item && raw!=='' && Number(raw)>0 && Number(raw)<=getDisponible(item);
        });
        if (!completeRow) await askInsumos();
        voiceProgress.insumosDone=true;
      }
      if (!voiceProgress.observationsDone) {
        if (!$('observaciones').value.trim()) {
          const answer=await askText('¿Observaciones? Diga ninguna si no hay.');
          $('observaciones').value=/\b(sin observaciones|ninguna|ninguno|nada)\b/i.test(normalize(answer))?'':answer;
          $('observaciones').dispatchEvent(new Event('input',{bubbles:true}));
        }
        voiceProgress.observationsDone=true;
      }
      updateSaveButton();
      const send=await askYesNo('¿Guardar registro? Sí o no.');
      if (send) {
        await FincaVoice.say('Guardando.');
        await saveRecord({preventDefault(){}},true);
      } else {
        showNotice('Los datos quedan en pantalla para revisarlos.','info');
        await FincaVoice.say('Datos en pantalla.');
      }
    } catch (error) {
      interviewError = error;
      showNotice(error.message || 'Se interrumpió la entrevista.', 'error');
      const spokenFailure = /micrófono/i.test(error.message || '') ? 'Revise el permiso del micrófono.' : 'No pude continuar. Repitamos la pregunta.';
      await FincaVoice.say(spokenFailure, {silentError:true});
      if (isFatalVoiceError(error)) {
        autoVoicePending=true;
        showNotice((error.message || 'Voz bloqueada.') + ' Toque una vez la pantalla para volver a intentar.', 'error');
      }
    } finally {
      interviewRunning=false;
      await releaseScreenAwake();
      updateSaveButton();
      if (cameraRestartPending && window.FincaCamera) {
        cameraRestartPending=false; window.setTimeout(()=>void window.FincaCamera.start(),500);
      }
      if (interviewError && isFatalVoiceError(interviewError)) {
        qrAlreadyLaunched = '';
      }
    }
  }

  async function syncAndRender() { await FincaSync.run(); await renderRecords(); }
  function networkStatus() { const el=$('network'); if(el) el.textContent=navigator.onLine?'Con conexión':'Sin internet'; }
  $('fecha').value=todayLocal();
  $('caballon').addEventListener('input',onQrChange);
  $('record-form').addEventListener('input',updateSaveButton);
  $('record-form').addEventListener('change',updateSaveButton);
  $('record-form').addEventListener('submit',event=>{void saveRecord(event,false);});
  $('add-insumo').addEventListener('click',()=>addInsumoRow());
  $('sync-btn').addEventListener('click',syncAndRender);
  $('export-btn').addEventListener('click',async()=>{
    const records=await FincaDB.all(); const blob=new Blob([JSON.stringify(records,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='respaldo-registros-finca.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  window.addEventListener('online',()=>{networkStatus();void syncAndRender();void loadCatalogs();});
  window.addEventListener('offline',networkStatus); networkStatus();
  document.addEventListener('pointerdown',()=>{
    if (window.FincaVoice && typeof FincaVoice.unlockAudio === 'function') FincaVoice.unlockAudio();
    if (autoVoicePending && !interviewRunning && navigator.onLine && catalogReady && matchCaballon($('caballon').value.trim())) void startVoiceInterview();
  },true);
  void locate();
  void loadCatalogs();
  void renderRecords();
  
  if (navigator.onLine) {
    void syncAndRender();
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(reg=>reg.update()).catch(err=>console.warn('No se pudo actualizar el caché PWA:',err)));
  }
})();
