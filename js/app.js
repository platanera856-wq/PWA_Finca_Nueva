(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const form = $('record-form');
  const cacheKey = (window.FINCA_CONFIG && FINCA_CONFIG.catalogStorageKey) || 'finca-catalogos-cache-v3';
  let catalog = { empleados: [], labores: [], insumos: [], caballones: [] };
  let gps = { latitud: null, longitud: null, ok: false };
  let interviewRunning = false;
  let catalogReady = false;

  function showNotice(text, kind = 'info') {
    const el = $('app-notice'); if (!el) return;
    el.textContent = text; el.className = 'notice ' + kind;
  }
  function setCatalogStatus(text) { $('catalog-status').textContent = text; }
  function normalize(s) { return FincaVoice.normalize(s); }
  function todayLocal() {
    const d = new Date(); const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
  }
  function safeParseCache() {
    try {
      const raw = localStorage.getItem(cacheKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.empleados) || !Array.isArray(parsed.labores) || !Array.isArray(parsed.insumos) || !Array.isArray(parsed.caballones)) return null;
      return parsed;
    } catch (_) { return null; }
  }
  function normalizeCatalogData(data) {
    if (!data || data.exito !== true) throw new Error((data && data.mensaje) || 'Apps Script no devolvió los catálogos.');
    for (const key of ['empleados','labores','insumos','caballones']) if (!Array.isArray(data[key])) data[key] = [];
    return { empleados:data.empleados, labores:data.labores, insumos:data.insumos, caballones:data.caballones, cachedAt:new Date().toISOString() };
  }
  function fillSelect(select, items, placeholder, selectedValue = '') {
    select.replaceChildren();
    const initial = document.createElement('option'); initial.value = ''; initial.textContent = placeholder; select.appendChild(initial);
    for (const item of items) {
      if (!item || !item.id || !item.nombre) continue;
      const o = document.createElement('option'); o.value = String(item.id).trim(); o.textContent = String(item.nombre).trim();
      if (selectedValue && o.value === selectedValue) o.selected = true;
      select.appendChild(o);
    }
    select.disabled = items.length === 0;
  }
  function renderSelects() {
    fillSelect($('empleado'), catalog.empleados, '-- Seleccione trabajador --');
    fillSelect($('labor'), catalog.labores, '-- Seleccione labor --');
    $('save-btn').disabled = false;
    renderInsumoStockText();
    // Si el QR se leyó antes de terminar la descarga, validarlo ahora que ya existe el catálogo.
    if ($('caballon').value.trim()) onQrChange();
  }
  function renderInsumoStockText() {
    document.querySelectorAll('.insumo-row').forEach(row => {
      const select = row.querySelector('.insumo-select'); const qty = row.querySelector('.insumo-qty'); const stockEl = row.querySelector('.insumo-stock');
      const ins = catalog.insumos.find(x => String(x.id) === select.value);
      if (!ins) { stockEl.textContent = 'Seleccione un insumo para ver su existencia.'; return; }
      const available = Number(ins.disponible) || 0;
      stockEl.textContent = `Disponible: ${available} ${ins.unidad || ''}`.trim();
      const over = qty.value !== '' && Number(qty.value) > available;
      stockEl.classList.toggle('stock-error', over);
      if (over) stockEl.textContent += ' — cantidad superior a la existencia';
    });
  }
  function addInsumoRow(preselectId = '') {
    const row = document.createElement('div'); row.className = 'insumo-row'; row.dataset.insumoRow = 'true';
    const labelSelect = document.createElement('label'); labelSelect.textContent = 'Insumo';
    const select = document.createElement('select'); select.className = 'insumo-select'; select.required = false;
    fillSelect(select, catalog.insumos, '-- Seleccione insumo --', preselectId); labelSelect.appendChild(select);
    const labelQty = document.createElement('label'); labelQty.textContent = 'Cantidad utilizada';
    const qty = document.createElement('input'); qty.type = 'number'; qty.className = 'insumo-qty'; qty.min = '0.001'; qty.step = 'any'; qty.inputMode = 'decimal'; qty.placeholder = 'Cantidad'; labelQty.appendChild(qty);
    const stock = document.createElement('p'); stock.className = 'insumo-stock'; stock.textContent = 'Seleccione un insumo para ver su existencia.';
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary danger'; remove.textContent = 'Quitar insumo'; remove.addEventListener('click', () => row.remove());
    select.addEventListener('change', renderInsumoStockText); qty.addEventListener('input', renderInsumoStockText);
    row.append(labelSelect, labelQty, stock, remove); $('insumos-container').appendChild(row); renderInsumoStockText(); return row;
  }
  function byVoiceMatch(text, items) {
    const query = normalize(text);
    if (!query) return null;
    const exact = items.find(x => normalize(x.nombre) === query || normalize(x.id) === query);
    if (exact) return exact;
    const tokens = query.split(' ').filter(Boolean);
    const scored = items.map(item => {
      const name = normalize(item.nombre), words = name.split(' ');
      let score = 0;
      if (name.includes(query) || query.includes(name)) score = Math.min(1, Math.min(name.length, query.length) / Math.max(name.length, query.length) + 0.35);
      const overlap = tokens.filter(t => words.some(w => w === t || (t.length >= 4 && (w.startsWith(t) || t.startsWith(w))))) .length;
      score = Math.max(score, overlap / Math.max(tokens.length, words.length));
      const dist = editDistance(query, name);
      score = Math.max(score, 1 - dist / Math.max(query.length, name.length, 1));
      return {item,score};
    }).sort((a,b)=>b.score-a.score);
    return scored[0] && scored[0].score >= 0.68 ? scored[0].item : null;
  }
  function editDistance(a,b) {
    const row = Array.from({length:b.length+1}, (_,i)=>i);
    for (let i=1;i<=a.length;i++) { let prev=row[0]; row[0]=i; for(let j=1;j<=b.length;j++){const old=row[j]; row[j]=Math.min(row[j]+1,row[j-1]+1,prev+(a[i-1]===b[j-1]?0:1)); prev=old;} }
    return row[b.length];
  }
  async function loadCatalogs() {
    setCatalogStatus('Conectando con Apps Script para cargar trabajadores, labores, insumos y caballones…');
    try {
      if (!navigator.onLine) throw new Error('El teléfono está sin internet.');
      const live = await FincaAPI.call('obtenerDatosFormulario', null, 40000);
      catalog = normalizeCatalogData(live);
      localStorage.setItem(cacheKey, JSON.stringify(catalog));
      catalogReady = true;
      setCatalogStatus(`✅ Catálogos cargados desde Apps Script: ${catalog.empleados.length} trabajadores, ${catalog.labores.length} labores, ${catalog.insumos.length} insumos y ${catalog.caballones.length} caballones.`);
      showNotice('Los catálogos se descargaron de Google Apps Script y quedaron guardados para uso posterior.', 'success');
    } catch (err) {
      const cache = safeParseCache();
      if (cache) {
        catalog = cache; catalogReady = true;
        setCatalogStatus(`📴 Sin conexión con Apps Script. Se usan los catálogos guardados localmente (copia: ${cache.cachedAt ? new Date(cache.cachedAt).toLocaleString() : 'fecha desconocida'}).`);
        showNotice('Sin internet: se están usando las listas guardadas previamente en este teléfono.', 'info');
      } else {
        catalogReady = false;
        setCatalogStatus('❌ No se pudieron cargar los catálogos y no hay copia local. Abra la aplicación con internet para preparar las listas.');
        showNotice('Error al cargar los catálogos: ' + err.message, 'error');
      }
    }
    renderSelects();
    updateSaveButton();
  }
  function matchCaballon(code) { const c = normalize(code).replace(/\s+/g,''); return catalog.caballones.find(x => normalize(x.codigoQR).replace(/\s+/g,'') === c) || null; }
  function onQrChange() {
    const code = $('caballon').value.trim(); const info = $('caballon-detail');
    if (!code) { info.textContent = 'La cámara intenta abrirse al entrar; si el navegador lo bloquea, pulse «Reintentar cámara / QR».'; updateSaveButton(); return; }
    const found = matchCaballon(code);
    if (found) {
      info.textContent = `✅ ${found.nombre || 'Caballón'} · Lote ${found.lote || '—'} · Plantas registradas en catálogo: ${found.plantas ?? '—'}.`;
      showNotice('QR reconocido y encontrado en el catálogo de la finca.', 'success');
      // Solo propone la cantidad de plantas del catálogo; el trabajador puede cambiarla según la labor de hoy.
      if (!$('matas').value && Number(found.plantas) > 0) $('matas').value = Number(found.plantas);
    } else {
      info.textContent = `Se leyó el código ${code}, pero no aparece en el catálogo descargado. Revise el QR o actualice los catálogos.`;
      showNotice('El código QR se leyó, pero no coincide con los caballones descargados. No se permitirá guardar hasta resolverlo.', 'error');
    }
    updateSaveButton();
  }
  function getSelectedName(id, list) { const item=list.find(x=>String(x.id)===String(id)); return item ? item.nombre : ''; }
  function updateSaveButton() {
    const qr = $('caballon').value.trim(); const qrValid = !!matchCaballon(qr);
    const qtyBad = [...document.querySelectorAll('.insumo-row')].some(row => {
      const id = row.querySelector('.insumo-select').value, q = row.querySelector('.insumo-qty').value;
      if (!id && !q) return false;
      const ins = catalog.insumos.find(x=>String(x.id)===id); return !ins || !q || Number(q)<=0 || Number(q)>(Number(ins.disponible)||0);
    });
    $('save-btn').disabled = !catalogReady || !$('empleado').value || !$('labor').value || !qrValid || !$('horas').value || Number($('horas').value)<0.5 || Number($('horas').value)>8 || !$('matas').value || Number($('matas').value)<=0 || qtyBad;
  }
  function getInsumosPayload() {
    const rows = [...document.querySelectorAll('.insumo-row')];
    const items=[];
    for (const row of rows) {
      const id = row.querySelector('.insumo-select').value; const rawQty = row.querySelector('.insumo-qty').value;
      if (!id && !rawQty) continue;
      if (!id) throw new Error('Seleccione el nombre del insumo.');
      if (!rawQty || !Number.isFinite(Number(rawQty)) || Number(rawQty)<=0) throw new Error('Ingrese una cantidad válida para cada insumo.');
      const ins = catalog.insumos.find(x=>String(x.id)===id);
      if (!ins) throw new Error('El insumo seleccionado no está en el catálogo.');
      const available=Number(ins.disponible)||0;
      if (Number(rawQty)>available) throw new Error(`Stock insuficiente de ${ins.nombre}. Disponible: ${available} ${ins.unidad || ''}. Corrija la cantidad; no se guardó el registro.`);
      items.push({idInsumo:id,cantidad:Number(rawQty)});
    }
    return items;
  }
  function locate() {
    return new Promise(resolve => {
      if (!navigator.geolocation) { gps={latitud:null,longitud:null,ok:false}; resolve(gps); return; }
      navigator.geolocation.getCurrentPosition(pos => {
        gps={latitud:pos.coords.latitude,longitud:pos.coords.longitude,ok:true};
        $('sync-status').textContent = `Ubicación GPS capturada (precisión aproximada ${Math.round(pos.coords.accuracy)} m).`;
        resolve(gps);
      }, error => {
        gps={latitud:null,longitud:null,ok:false};
        const msg=error.code===1?'Permiso de ubicación denegado. Permita la ubicación para este sitio.':error.code===2?'No se pudo determinar la ubicación GPS. Compruebe que la ubicación del teléfono esté activa.':'El GPS tardó demasiado. Intente de nuevo en un lugar abierto.';
        $('sync-status').textContent=msg; resolve(gps);
      }, {enableHighAccuracy:true,timeout:20000,maximumAge:0});
    });
  }
  async function saveRecord(event) {
    event.preventDefault();
    try {
      updateSaveButton();
      if (!catalogReady) throw new Error('No hay catálogos cargados. Conéctese a internet para preparar la aplicación.');
      const qr=$('caballon').value.trim(); const cab=matchCaballon(qr);
      if (!cab) throw new Error('El código QR debe coincidir con un caballón del catálogo.');
      if (!$('empleado').value) throw new Error('Seleccione un trabajador.');
      if (!$('labor').value) throw new Error('Seleccione una labor.');
      const horas=Number($('horas').value), matas=Number($('matas').value);
      if (!Number.isFinite(horas)||horas<0.5||horas>8) throw new Error('Las horas deben estar entre 0,5 y 8.');
      if (!Number.isInteger(matas)||matas<=0) throw new Error('Las plantas trabajadas deben ser un entero mayor que cero.');
      const insumos=getInsumosPayload();
      const geo = gps.ok ? gps : await locate();
      if (!geo.ok) throw new Error('No se guardó el registro: el GPS es obligatorio. ' + $('sync-status').textContent);
      const uuid = crypto.randomUUID ? crypto.randomUUID() : ('finca-' + Date.now() + '-' + Math.random().toString(36).slice(2));
      const record={
        id:uuid,idCliente:uuid,createdAt:new Date().toISOString(),syncStatus:'pending',
        fecha:$('fecha').value, empleado:$('empleado').value, empleadoNombre:getSelectedName($('empleado').value,catalog.empleados),
        labor:$('labor').value, laborNombre:getSelectedName($('labor').value,catalog.labores),
        caballon:qr,caballonNombre:cab.nombre,lote:cab.lote,horas,matas,observaciones:$('observaciones').value.trim(),
        insumos,latitud:geo.latitud,longitud:geo.longitud
      };
      await FincaDB.save(record);
      await renderRecords();
      showNotice('Registro guardado primero en este teléfono. Intentando enviarlo a Google Sheets…','info');
      if (navigator.onLine) {
        await FincaSync.sendRecord(record);
        showNotice('✅ Registro recibido por Apps Script y sincronizado con Google Sheets.', 'success');
        $('sync-status').textContent='Registro enviado. Verifique la fila correspondiente en Google Sheets.';
      } else {
        showNotice('📴 Registro guardado en este teléfono. Se enviará cuando vuelva internet.', 'info');
      }
      await renderRecords();
      resetAfterSave();
    } catch (error) {
      showNotice(error.message || String(error), 'error');
      await FincaVoice.say(error.message || 'Revise los datos del formulario.', {silentError:true});
    } finally { updateSaveButton(); }
  }
  function resetAfterSave() {
    $('empleado').value=''; $('labor').value=''; $('horas').value=''; $('matas').value=''; $('observaciones').value='';
    $('insumos-container').replaceChildren(); $('fecha').value=todayLocal();
    // Se conserva el QR para facilitar múltiples registros en el mismo caballón.
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
  async function startVoiceInterview() {
    if(interviewRunning) return;
    if(!catalogReady) { showNotice('Espere a que carguen los catálogos antes de iniciar la entrevista.','error'); await FincaVoice.say('Espere un momento. Todavía estoy cargando las listas de trabajadores, labores e insumos.'); return; }
    interviewRunning=true; const button=$('voice-btn');button.disabled=true;button.textContent='🎙 Entrevista en curso…';
    try {
      // Este botón es la interacción del usuario que suele desbloquear el audio y el micrófono en Android Chrome.
      const greeted=await FincaVoice.welcome();
      if(!greeted) await FincaVoice.say('Vamos a registrar una labor. Si no escucha mi voz, revise el volumen multimedia del teléfono.');
      await FincaVoice.say('La fecha se registra automáticamente como hoy, ' + new Date().toLocaleDateString('es-CO') + '.');
      if(!matchCaballon($('caballon').value)) {
        await FincaVoice.say('Primero necesito que se lea un código QR válido. Apunte la cámara al código del caballón. Esperaré hasta un minuto y medio.');
        $('qr-area').hidden=false;
        const qrOk=await waitForQr(90000);
        if(!qrOk) throw new Error('No se recibió un QR válido en 90 segundos. Pulse reintentar cámara y vuelva a iniciar las preguntas por voz.');
      }
      await askCatalogChoice('¿Quién realizó la labor? Diga el nombre del trabajador.',catalog.empleados,$('empleado'),'trabajador');
      await askCatalogChoice('¿Qué labor realizó? Diga el nombre de la labor.',catalog.labores,$('labor'),'labor');
      await askNumeric('¿Cuántas horas trabajó? Diga un número entre cero coma cinco y ocho.',$('horas'),n=>n>=0.5&&n<=8,'Las horas deben ser entre cero coma cinco y ocho.');
      await askNumeric('¿Cuántas plantas trabajó? Diga el número de plantas.',$('matas'),n=>Number.isInteger(n)&&n>0,'Diga un número entero de plantas mayor que cero.');
      await askInsumos();
      const observation=await askText('¿Desea registrar alguna observación? Dicte la observación o diga “sin observaciones”.');
      if(observation!==null) $('observaciones').value=/\bsin observaciones\b/i.test(normalize(observation))?'':observation;
      $('observaciones').dispatchEvent(new Event('input',{bubbles:true}));
      await FincaVoice.say('Entrevista terminada. Revise la información en pantalla. Cuando esté correcta, pulse Guardar registro.');
      showNotice('Entrevista por voz terminada. Revise los campos y pulse «Guardar registro».','success');
      await locate();
    } catch(error) {
      showNotice(error.message || String(error),'error');
      await FincaVoice.say(error.message || 'La entrevista se detuvo. Puede revisar los campos y volver a intentarlo.',{silentError:true});
    } finally { interviewRunning=false;button.disabled=false;button.textContent='🎙 Iniciar preguntas por voz';updateSaveButton(); }
  }
  async function askCatalogChoice(question, items, select, name) {
    for(let attempt=1;attempt<=3;attempt++) {
      await FincaVoice.say(question + (attempt>1 ? ` Intento ${attempt} de 3.` : ''));
      try {
        const answer=await FincaVoice.listen(25000); const item=byVoiceMatch(answer,items);
        if(item){select.value=String(item.id);select.dispatchEvent(new Event('change',{bubbles:true}));showNotice(`${name[0].toUpperCase()+name.slice(1)} seleccionado: ${item.nombre}.`,'success');return item;}
        await FincaVoice.say('No encontré ese nombre en la lista. Diga el nombre como aparece en las opciones.');
      } catch(e) { await FincaVoice.say((e.message||'No entendí la respuesta.') + ' Puede intentarlo de nuevo.'); }
    }
    throw new Error('No se pudo reconocer el dato de ' + name + ' después de tres intentos. Puede seleccionarlo en pantalla y volver a iniciar la entrevista.');
  }
  async function askNumeric(question, field, validator, invalidText) {
    for(let attempt=1;attempt<=3;attempt++) {
      await FincaVoice.say(question + (attempt>1 ? ` Intento ${attempt} de 3.` : ''));
      try {
        const raw=await FincaVoice.listen(25000); const value=FincaVoice.parseNumber(raw);
        if(value!==null && Number.isFinite(value) && validator(value)) {field.value=String(value);field.dispatchEvent(new Event('input',{bubbles:true}));return value;}
        await FincaVoice.say(invalidText + ' Escuche la pregunta nuevamente.');
      } catch(e) { await FincaVoice.say((e.message||'No entendí el número.') + ' Voy a repetir la pregunta.'); }
    }
    throw new Error('No se pudo registrar el número después de tres intentos. Corríjalo en pantalla.');
  }
  async function askText(question) {
    for(let attempt=1;attempt<=3;attempt++) {
      await FincaVoice.say(question + (attempt>1 ? ` Intento ${attempt} de 3.` : ''));
      try { const answer=await FincaVoice.listen(25000); if(answer.trim()) return answer.trim(); }
      catch(e) { await FincaVoice.say((e.message||'No entendí la observación.') + ' Puede intentarlo de nuevo.'); }
    }
    return null;
  }
  async function askYesNo(question) {
    for(let attempt=1;attempt<=3;attempt++) {
      await FincaVoice.say(question + (attempt>1 ? ` Intento ${attempt} de 3. Responda sí o no.` : ''));
      try { const answer=await FincaVoice.listen(20000); const result=FincaVoice.yesNo(answer); if(result!==null)return result; }
      catch(_) {}
      await FincaVoice.say('No entendí. Responda sí o no.');
    }
    throw new Error('No se pudo entender la respuesta después de tres intentos.');
  }
  async function askInsumos() {
    const use=await askYesNo('¿Utilizó algún insumo en esta labor? Diga sí o no.');
    if(!use) return;
    let count=0;
    while(count<5) {
      const row=addInsumoRow(); const select=row.querySelector('.insumo-select'); const qty=row.querySelector('.insumo-qty');
      const ins=await askCatalogChoice('¿Qué insumo utilizó? Diga el nombre que aparece en la lista.',catalog.insumos,select,'insumo');
      let quantityAccepted=false;
      for(let attempt=1;attempt<=3;attempt++) {
        const available=Number(ins.disponible)||0;
        await FincaVoice.say(`¿Qué cantidad de ${ins.nombre} utilizó? Hay ${available} ${ins.unidad||''} disponibles. Diga la cantidad.` + (attempt>1?` Intento ${attempt} de 3.`:''));
        try {
          const raw=await FincaVoice.listen(25000); const n=FincaVoice.parseNumber(raw);
          if(n!==null && Number.isFinite(n) && n>0 && n<=available){qty.value=String(n);qty.dispatchEvent(new Event('input',{bubbles:true}));quantityAccepted=true;break;}
          await FincaVoice.say(n!==null&&n>available?`La cantidad supera la existencia. Solo hay ${available} ${ins.unidad||''}. No se registró esa cantidad.`:'La cantidad debe ser un número mayor que cero.');
        } catch(e) { await FincaVoice.say((e.message||'No entendí la cantidad.')+' Voy a repetir la pregunta.'); }
      }
      if(!quantityAccepted) { row.remove(); throw new Error('No se pudo validar la cantidad del insumo. Corrija el dato en pantalla y vuelva a iniciar las preguntas.'); }
      count++;
      if(count>=5) { await FincaVoice.say('Se llegó al máximo de cinco insumos en esta entrevista.'); break; }
      const more=await askYesNo('¿Desea registrar otro insumo? Diga sí o no.'); if(!more) break;
    }
  }
  function waitForQr(timeoutMs) {
    return new Promise(resolve=>{
      if(matchCaballon($('caballon').value)){resolve(true);return;}
      const field=$('caballon'); let done=false;
      const cleanup=()=>{clearTimeout(timer);field.removeEventListener('input',check);};
      const finish=ok=>{if(done)return;done=true;cleanup();resolve(ok);};
      const check=()=>{if(matchCaballon(field.value))finish(true);};
      field.addEventListener('input',check);
      const timer=setTimeout(()=>finish(false),timeoutMs);
    });
  }
  async function syncAndRender() { await FincaSync.run(); await renderRecords(); }
  function networkStatus(){ $('network').textContent=navigator.onLine?'Con conexión':'Sin internet'; }
  $('fecha').value=todayLocal();
  $('voice-btn').addEventListener('click',startVoiceInterview);
  $('add-insumo').addEventListener('click',()=>addInsumoRow());
  $('caballon').addEventListener('input',onQrChange);
  $('record-form').addEventListener('input',updateSaveButton);
  $('record-form').addEventListener('change',updateSaveButton);
  $('record-form').addEventListener('submit',saveRecord);
  $('sync-btn').addEventListener('click',syncAndRender);
  $('export-btn').addEventListener('click',async()=>{
    const records=await FincaDB.all(); const blob=new Blob([JSON.stringify(records,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url;a.download='respaldo-registros-finca.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  window.addEventListener('online',()=>{networkStatus();void syncAndRender();});
  window.addEventListener('offline',networkStatus);networkStatus();
  void locate();
  void loadCatalogs();
  void renderRecords();
  window.addEventListener('load', () => {
    window.setTimeout(() => {
      void FincaVoice.welcome().then(ok => {
        if (!ok) FincaVoice.status('El navegador puede bloquear el saludo automático. Toque «Iniciar preguntas por voz» para activar el audio y el micrófono.');
      });
    }, 1200);
  }, {once:true});
  if('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(reg=>reg.update()).catch(err=>console.warn('No se pudo actualizar el caché PWA:',err)));
  }
})();
