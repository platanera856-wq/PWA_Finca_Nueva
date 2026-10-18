(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const form = $('record-form');
  const cacheKey = (window.FINCA_CONFIG && FINCA_CONFIG.catalogStorageKey) || 'finca-catalogos-cache-v3';
  let catalog = { empleados: [], labores: [], insumos: [], caballones: [] };
  let gps = { latitud: null, longitud: null, ok: false };
  let interviewRunning = false;
  let catalogReady = false;
  let lastFocusedField = null;
  // Progreso dentro de una entrevista interrumpida: evita repetir pasos que ya quedaron completos.
  let voiceProgress = { insumosDone: false, observationsDone: false };

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
  // Validación estricta: solo acepta un nombre o ID que exista en el catálogo descargado.
  // Si el dictado cambia una letra, se vuelve a preguntar; nunca se asigna la coincidencia más cercana.
  function byVoiceMatch(text, items) {
    const query = normalize(text);
    if (!query) return null;
    return items.find(item => normalize(item.nombre) === query || normalize(item.id) === query) || null;
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
      // Las plantas del QR describen el caballón, no necesariamente las plantas trabajadas hoy.
      // El campo de labor queda vacío para que el flujo lo pregunte y lo valide.
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
    const employeeValid = catalog.empleados.some(x => String(x.id) === String($('empleado').value));
    const laborValid = catalog.labores.some(x => String(x.id) === String($('labor').value));
    $('save-btn').disabled = !catalogReady || !employeeValid || !laborValid || !qrValid || !$('horas').value || Number($('horas').value)<0.5 || Number($('horas').value)>8 || !$('matas').value || Number($('matas').value)<=0 || qtyBad;
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
      if (!catalog.empleados.some(x => String(x.id) === String($('empleado').value))) throw new Error('Seleccione un trabajador de la lista oficial de empleados. No se aceptan nombres escritos fuera del catálogo.');
      if (!catalog.labores.some(x => String(x.id) === String($('labor').value))) throw new Error('Seleccione una labor de la lista oficial.');
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
        try {
          await FincaSync.sendRecord(record);
          showNotice('✅ Registro recibido por Apps Script y sincronizado con Google Sheets.', 'success');
          $('sync-status').textContent='Registro enviado. Verifique la fila correspondiente en Google Sheets.';
        } catch (sendError) {
          // Ya existe en IndexedDB; conservarlo pendiente evita volver a crearlo desde el formulario.
          showNotice('El registro quedó guardado en este teléfono, pero no se confirmó el envío a Sheets. Se conserva pendiente para reintentar: ' + sendError.message, 'error');
          $('sync-status').textContent='Registro local guardado; falta confirmar sincronización. Use «Sincronizar pendientes» cuando haya conexión estable.';
        }
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
    voiceProgress = { insumosDone: false, observationsDone: false };
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
  function validEmployeeSelection() { return catalog.empleados.some(x => String(x.id) === String($('empleado').value)); }
  function validLaborSelection() { return catalog.labores.some(x => String(x.id) === String($('labor').value)); }
  function validHoursValue() { const n=Number($('horas').value); return $('horas').value!=='' && Number.isFinite(n) && n>=0.5 && n<=8; }
  function validPlantsValue() { const n=Number($('matas').value); return $('matas').value!=='' && Number.isInteger(n) && n>0; }

  async function startVoiceInterview() {
    if(interviewRunning) return;
    if(!catalogReady) { showNotice('Espere a que carguen los catálogos antes de iniciar la entrevista.','error'); await FincaVoice.say('Espere un momento. Todavía estoy cargando las listas de trabajadores, labores e insumos.'); return; }
    if(!FincaVoice.supportsRecognition()) { const msg='Este navegador no ofrece reconocimiento de voz. Pruebe Chrome actualizado en Android y compruebe que el teléfono tenga activado el servicio de reconocimiento de voz en español.'; showNotice(msg,'error'); FincaVoice.status(msg); await FincaVoice.say(msg); return; }
    interviewRunning=true; const button=$('voice-btn');button.disabled=true;button.textContent='🎙 Entrevista en curso…';
    try {
      // La pulsación del usuario desbloquea audio/micrófono en los navegadores móviles.
      const greeted=await FincaVoice.welcome();
      if(!greeted) await FincaVoice.say('Vamos a registrar una labor. Escuche cada pregunta y responda cuando termine de hablar.');
      if(!matchCaballon($('caballon').value)) {
        await FincaVoice.say('Primero escanearemos el código QR del caballón. La cámara está al inicio de la pantalla.');
        $('qr-area').hidden=false;
        if (window.FincaCamera) void window.FincaCamera.start();
        const qrOk=await waitForQr(90000);
        if(!qrOk) throw new Error('No se recibió un QR válido en 90 segundos. El registro no puede continuar sin un QR válido.');
      }
      if(!validEmployeeSelection()) await askCatalogChoice('¿Quién realizó la labor? Diga el nombre completo de un trabajador que aparezca en la lista.',catalog.empleados,$('empleado'),'trabajador');
      if(!validLaborSelection()) await askCatalogChoice('¿Qué labor realizó? Diga el nombre de una labor que aparezca en la lista.',catalog.labores,$('labor'),'labor');
      if(!validHoursValue()) await askNumeric('¿Cuántas horas trabajó? Diga un número entre cero coma cinco y ocho.',$('horas'),n=>n>=0.5&&n<=8,'Las horas deben ser entre cero coma cinco y ocho.');
      if(!validPlantsValue()) await askNumeric('¿Cuántas plantas trabajó? Diga el número entero de plantas.',$('matas'),n=>Number.isInteger(n)&&n>0,'Diga un número entero de plantas mayor que cero.');
      if(!voiceProgress.insumosDone) {
        const manualInsumoComplete = [...document.querySelectorAll('.insumo-row')].some(row => {
          const id=row.querySelector('.insumo-select').value, qty=row.querySelector('.insumo-qty').value;
          const item=catalog.insumos.find(x=>String(x.id)===String(id));
          return !!item && !!qty && Number(qty)>0 && Number(qty)<=Number(item.disponible);
        });
        if(manualInsumoComplete) voiceProgress.insumosDone=true;
        else { await askInsumos(); voiceProgress.insumosDone=true; }
      }
      if(!voiceProgress.observationsDone) {
        if($('observaciones').value.trim()) { voiceProgress.observationsDone=true; }
        else {
          const observation=await askText('¿Qué observaciones desea registrar? Dicte la observación o diga “sin observaciones”.');
          $('observaciones').value=/\bsin observaciones\b/i.test(normalize(observation))?'':observation;
          $('observaciones').dispatchEvent(new Event('input',{bubbles:true}));
          voiceProgress.observationsDone=true;
        }
      }
      await FincaVoice.say('Entrevista terminada. Revise los datos. Si todo está correcto, guarde el registro.');
      showNotice('Entrevista por voz terminada. Revise los campos y pulse «Guardar registro».','success');
      await locate();
    } catch(error) {
      showNotice(error.message || String(error),'error');
      await FincaVoice.say(error.message || 'La entrevista se detuvo. Corrija el dato indicado y vuelva a continuar.',{silentError:true});
    } finally { interviewRunning=false;button.disabled=false;button.textContent='🎙 Iniciar entrevista guiada';updateSaveButton(); }
  }

  async function askCatalogChoice(question, items, select, name) {
    for(let attempt=1;attempt<=3;attempt++) {
      await FincaVoice.say(question + (attempt>1 ? ` Intento ${attempt} de 3.` : ''));
      try {
        const answer=await FincaVoice.listen(30000); const item=byVoiceMatch(answer,items);
        if(item) {
          const allowed = Array.from(select.options).some(option => option.value === String(item.id));
          if(!allowed) throw new Error('El dato no existe en las opciones cargadas.');
          select.value=String(item.id);
          if(select.value !== String(item.id)) throw new Error('No se pudo seleccionar un valor oficial del catálogo.');
          select.dispatchEvent(new Event('change',{bubbles:true}));
          updateSaveButton();
          showNotice(`${name[0].toUpperCase()+name.slice(1)} validado en el catálogo: ${item.nombre}.`,'success');
          await FincaVoice.say(`${item.nombre}. Confirmado en la lista.`);
          return item;
        }
        await FincaVoice.say('No aceptaré un nombre que no figure en la lista. Diga el nombre completo, tal como aparece en pantalla.');
      } catch(e) { await FincaVoice.say((e.message||'No entendí la respuesta.') + ' Vamos a intentarlo otra vez.'); }
    }
    throw new Error('El dato de ' + name + ' no coincidió con el catálogo después de tres intentos. No se aceptó ningún nombre inventado. Corrija la selección y vuelva a iniciar la entrevista; se continuará desde el primer campo pendiente.');
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
    throw new Error('No se pudo registrar la observación después de tres intentos. Puede dictarla en el campo Observaciones y continuar.');
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
  async function dictateSelectedField() {
    if(interviewRunning) return;
    if(!catalogReady) { showNotice('Todavía se están cargando los catálogos. Espere y vuelva a intentarlo.','error'); return; }
    if(!FincaVoice.supportsRecognition()) { const msg='Este navegador no ofrece reconocimiento de voz. Pruebe Chrome actualizado en Android y compruebe el servicio de voz en español.'; showNotice(msg,'error'); FincaVoice.status(msg); await FincaVoice.say(msg); return; }
    const field = lastFocusedField;
    if(!field || !form.contains(field) || !field.matches('input,select,textarea')) {
      showNotice('Primero toque el campo que quiere dictar y después pulse «Dictar en el campo seleccionado».','error');
      await FincaVoice.say('Primero toque el campo que quiere completar. Después pulse dictar en el campo seleccionado.'); return;
    }
    interviewRunning=true; const button=$('dictate-field-btn'); button.disabled=true;
    try {
      if(field.id==='empleado') { await askCatalogChoice('Diga el nombre completo de un trabajador de la lista.',catalog.empleados,field,'trabajador'); }
      else if(field.id==='labor') { await askCatalogChoice('Diga el nombre de una labor de la lista.',catalog.labores,field,'labor'); }
      else if(field.id==='horas') { await askNumeric('¿Cuántas horas trabajó? Diga entre cero coma cinco y ocho.',field,n=>n>=0.5&&n<=8,'Las horas deben estar entre 0,5 y 8.'); }
      else if(field.id==='matas') { await askNumeric('¿Cuántas plantas trabajó? Diga un número entero mayor que cero.',field,n=>Number.isInteger(n)&&n>0,'Diga un número entero mayor que cero.'); }
      else if(field.id==='observaciones') {
        const answer=await askText('Dicte las observaciones. También puede decir “sin observaciones”.');
        field.value=/\bsin observaciones\b/i.test(normalize(answer))?'':answer; field.dispatchEvent(new Event('input',{bubbles:true}));
      }
      else if(field.id==='caballon') {
        await FincaVoice.say('El caballón debe venir de un código QR válido. No lo inventaré por voz. Escanee el QR con la cámara que está al comienzo de la pantalla.');
        $('qr-area').hidden=false; if(window.FincaCamera) void window.FincaCamera.start();
        const ok=await waitForQr(90000); if(!ok) throw new Error('No se leyó un QR válido.');
      }
      else if(field.classList.contains('insumo-select')) { await askCatalogChoice('Diga el nombre exacto de un insumo de la lista.',catalog.insumos,field,'insumo'); renderInsumoStockText(); }
      else if(field.classList.contains('insumo-qty')) {
        const row=field.closest('.insumo-row'); const id=row && row.querySelector('.insumo-select').value;
        const item=catalog.insumos.find(x=>String(x.id)===String(id));
        if(!item) throw new Error('Primero seleccione un insumo oficial de la lista.');
        const available=Number(item.disponible)||0;
        await askNumeric(`¿Qué cantidad de ${item.nombre} utilizó? Hay ${available} ${item.unidad||''} disponibles.`,field,n=>n>0&&n<=available,`La cantidad debe ser mayor que cero y no superar la existencia de ${available} ${item.unidad||''}.`);
        renderInsumoStockText();
      }
      else if(field.id==='fecha') { throw new Error('La fecha se completa automáticamente. Seleccione otro campo para dictar.'); }
      else { throw new Error('Este campo no tiene dictado de voz configurado.'); }
      showNotice('Dato dictado y validado.','success'); updateSaveButton();
    } catch(error) { showNotice(error.message||String(error),'error'); await FincaVoice.say(error.message||'No se pudo completar el campo.'); }
    finally { interviewRunning=false; button.disabled=false; updateSaveButton(); }
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
  $('dictate-field-btn').addEventListener('click',dictateSelectedField);
  document.addEventListener('focusin', event => {
    const target=event.target;
    if(form.contains(target) && target.matches('input,select,textarea')) lastFocusedField=target;
  });
  // Capture mobile taps too, in case the browser changes focus while opening a native select.
  form.addEventListener('pointerdown', event => {
    const target=event.target.closest('input,select,textarea');
    if(target) lastFocusedField=target;
  }, true);
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
        if (!ok) FincaVoice.status('El navegador bloqueó el saludo automático o no tiene una voz española disponible. Pulse «Iniciar entrevista guiada» para probar audio y micrófono.');
      });
    }, 1200);
  }, {once:true});
  if('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(reg=>reg.update()).catch(err=>console.warn('No se pudo actualizar el caché PWA:',err)));
  }
})();
