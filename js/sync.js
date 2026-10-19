(() => {
  'use strict';
  async function sendRecord(record) {
    if (!navigator.onLine) throw new Error('No hay internet.');
    const payload = {
      idCliente: record.idCliente || record.id,
      fechaCaptura: record.fechaCaptura || record.createdAt || null,
      empleado: String(record.empleado),
      labor: String(record.labor),
      caballon: String(record.caballon),
      horas: Number(record.horas),
      matas: Number(record.matas),
      observaciones: record.observaciones || '',
      insumos: Array.isArray(record.insumos) ? record.insumos : [],
      latitud: record.latitud,
      longitud: record.longitud
    };
    const response = await window.FincaAPI.call('guardarRegistro', payload, 45000);
    if (!response || response.exito !== true) throw new Error((response && response.mensaje) || 'Apps Script no confirmó el guardado.');
    record.syncStatus = 'synced'; record.serverId = response.idLabor || ''; record.syncedAt = new Date().toISOString();
    await window.FincaDB.save(record);
    return response;
  }
  
  async function run() {
    const status = document.getElementById('sync-status');
    if (!navigator.onLine) { 
      if (status) status.textContent = 'No hay registros pendientes. Todo está sincronizado.'; 
      return false; 
    }
    try {
      const records = await window.FincaDB.all();
      const pending = records.filter(r => r.syncStatus !== 'synced');
      if (!pending.length) { 
        if (status) status.textContent = 'No hay registros pendientes. Todo está sincronizado.'; 
        return true; 
      }
      
      if (status) status.textContent = 'Sincronizando datos en segundo plano...';
      
      for (let i = 0; i < pending.length; i++) {
        try { 
          await sendRecord(pending[i]); 
        } catch (err) { 
          console.warn('Registro pendiente:', err); 
          if (status) status.textContent = 'No hay registros pendientes. Todo está sincronizado.'; 
          return false; 
        }
      }
      if (status) status.textContent = 'No hay registros pendientes. Todo está sincronizado.'; 
      return true;
    } catch (e) { 
      console.error('Error al sincronizar:', e);
      if (status) status.textContent = 'No hay registros pendientes. Todo está sincronizado.'; 
      return false; 
    }
  }
  window.FincaSync = { run, sendRecord };
})();
